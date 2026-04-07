const path = require("path");
const express = require("express");
const sqlite3 = require("sqlite3").verbose();

const app = express();
const PORT = process.env.PORT || 3000;
const MAX_DESCANSO = 3;
const DB_PATH = path.join(__dirname, "descansos.db");

const db = new sqlite3.Database(DB_PATH);

const pad = (value) => String(value).padStart(2, "0");

/** IANA o vacío: sin TZ, se usa la zona del proceso (en Docker suele ser UTC). */
const getQueueTimeZone = () =>
  process.env.TZ ||
  (typeof Intl !== "undefined" &&
    Intl.DateTimeFormat().resolvedOptions().timeZone) ||
  "UTC";

/**
 * HH:MM en la zona usada para la cola. Debe coincidir con la hora local del equipo
 * (la que ve el usuario en el navegador). En Coolify/Docker definir TZ, p. ej. Europe/Madrid.
 */
const getNowTime = () => {
  const timeZone = getQueueTimeZone();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    hourCycle: "h23",
  }).formatToParts(new Date());
  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${pad(hour)}:${pad(minute)}`;
};

const createSchema = (tableName) => `
  CREATE TABLE IF NOT EXISTS ${tableName} (
    id TEXT PRIMARY KEY,
    nombre TEXT NOT NULL,
    hora TEXT NOT NULL,
    duracion INTEGER NOT NULL,
    estado TEXT NOT NULL CHECK (estado IN ('descanso', 'espera', 'pendiente')),
    created_at TEXT NOT NULL,
    started_at TEXT
  )
`;

db.serialize(() => {
  db.all("PRAGMA table_info(personas)", (err, columns) => {
    if (err || columns.length === 0) {
      db.run(createSchema("personas"));
      return;
    }
    const hasStartedAt = columns.some((col) => col.name === "started_at");
    if (hasStartedAt) return;

    db.run("BEGIN TRANSACTION");
    db.run("DROP TABLE IF EXISTS personas_mig", (dropErr) => {
      if (dropErr) {
        db.run("ROLLBACK");
        return;
      }
      db.run(createSchema("personas_mig"), (createErr) => {
        if (createErr) {
          db.run("ROLLBACK");
          return;
        }
        db.run(
          `
          INSERT INTO personas_mig (id, nombre, hora, duracion, estado, created_at, started_at)
          SELECT id, nombre, hora, duracion,
            CASE WHEN estado = 'descanso' THEN 'descanso' ELSE 'espera' END,
            created_at,
            CASE WHEN estado = 'descanso' THEN created_at ELSE NULL END
          FROM personas
        `,
          (insertErr) => {
            if (insertErr) {
              db.run("ROLLBACK");
              return;
            }
            db.run("DROP TABLE personas", (dropErr2) => {
              if (dropErr2) {
                db.run("ROLLBACK");
                return;
              }
              db.run("ALTER TABLE personas_mig RENAME TO personas", (renameErr) => {
                if (renameErr) {
                  db.run("ROLLBACK");
                  return;
                }
                db.run("COMMIT");
              });
            });
          }
        );
      });
    });
  });
});

app.use(express.json());
app.use(express.static(__dirname));

/** Una sola transacción del mover a la vez: evita "cannot start a transaction within a transaction". */
let moverWaiters = [];
let moverRunning = false;

const moverColaSiHayEspacioOnce = (callback) => {
  const nowTime = getNowTime();
  const done = (err) => {
    try {
      callback(err);
    } catch (e) {
      console.error(e);
    }
  };
  const rollback = (err, next) => {
    db.run("ROLLBACK", (rbErr) => {
      if (rbErr) console.error(rbErr);
      next(err);
    });
  };

  db.serialize(() => {
    db.run("BEGIN TRANSACTION", (beginErr) => {
      if (beginErr) return done(beginErr);
      db.get(
        "SELECT COUNT(*) as total FROM personas WHERE estado IN ('descanso', 'pendiente')",
        (err, row) => {
          if (err) return rollback(err, done);
          const faltan = Math.max(0, MAX_DESCANSO - row.total);
          if (faltan === 0) {
            return db.run("COMMIT", (ce) => {
              if (ce) return done(ce);
              done(null);
            });
          }
          db.all(
            "SELECT id FROM personas WHERE estado = 'espera' AND hora <= ? ORDER BY hora ASC, created_at ASC LIMIT ?",
            [nowTime, faltan],
            (err2, rows) => {
              if (err2) return rollback(err2, done);
              const ids = rows.map((r) => r.id);
              if (ids.length === 0) {
                return db.run("COMMIT", (ce) => {
                  if (ce) return done(ce);
                  done(null);
                });
              }
              const placeholders = ids.map(() => "?").join(",");
              db.run(
                `UPDATE personas SET estado = 'pendiente' WHERE id IN (${placeholders})`,
                ids,
                (err3) => {
                  if (err3) return rollback(err3, done);
                  db.run("COMMIT", (ce) => {
                    if (ce) return done(ce);
                    done(null);
                  });
                }
              );
            }
          );
        }
      );
    });
  });
};

const drainMoverQueue = () => {
  if (moverRunning || moverWaiters.length === 0) return;
  moverRunning = true;
  const batch = moverWaiters;
  moverWaiters = [];
  moverColaSiHayEspacioOnce((err) => {
    batch.forEach((cb) => {
      try {
        cb(err);
      } catch (e) {
        console.error(e);
      }
    });
    moverRunning = false;
    drainMoverQueue();
  });
};

const moverColaSiHayEspacio = (callback) => {
  moverWaiters.push(callback);
  drainMoverQueue();
};

const getState = (res) => {
  moverColaSiHayEspacio((err) => {
    if (err) {
      return res.status(500).json({ error: "Error al actualizar cola." });
    }
    db.all("SELECT * FROM personas", (err2, rows) => {
      if (err2) {
        return res.status(500).json({ error: "Error al leer datos." });
      }
      const descanso = rows
        .filter((r) => r.estado === "descanso")
        .sort((a, b) => {
          const aKey = a.started_at || a.created_at;
          const bKey = b.started_at || b.created_at;
          return aKey.localeCompare(bKey);
        });
      const espera = rows
        .filter((r) => r.estado === "espera" || r.estado === "pendiente")
        .sort((a, b) => {
          if (a.estado !== b.estado) {
            return a.estado === "pendiente" ? -1 : 1;
          }
          if (a.hora === b.hora) {
            return a.created_at.localeCompare(b.created_at);
          }
          return a.hora.localeCompare(b.hora);
        });
      return res.json({ descanso, espera, max: MAX_DESCANSO });
    });
  });
};

app.get("/api/state", (req, res) => {
  getState(res);
});

app.post("/api/request", (req, res) => {
  const { id, nombre, hora, duracion } = req.body;
  if (!id || !nombre || !hora || !duracion) {
    return res.status(400).json({ error: "Datos incompletos." });
  }
  if (!/^\d{2}:\d{2}$/.test(hora)) {
    return res.status(400).json({ error: "Hora inválida." });
  }
  const createdAt = new Date().toISOString();
  const nowTime = getNowTime();
  db.get(
    "SELECT COUNT(*) as total FROM personas WHERE estado IN ('descanso', 'pendiente')",
    (err, row) => {
    if (err) return res.status(500).json({ error: "Error al guardar." });
    const horaFutura = hora > nowTime;
    const estado = !horaFutura && row.total < MAX_DESCANSO ? "pendiente" : "espera";
    db.run(
      "INSERT INTO personas (id, nombre, hora, duracion, estado, created_at, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, nombre, hora, duracion, estado, createdAt, null],
      (err2) => {
        if (err2) return res.status(500).json({ error: "Error al guardar." });
        return getState(res);
      }
    );
  });
});

app.post("/api/finalize", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "ID requerido." });
  db.run("DELETE FROM personas WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: "Error al actualizar." });
    return getState(res);
  });
});

app.post("/api/cancel", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "ID requerido." });
  db.run("DELETE FROM personas WHERE id = ?", [id], (err) => {
    if (err) return res.status(500).json({ error: "Error al actualizar." });
    return getState(res);
  });
});

app.post("/api/cancel-by-name", (req, res) => {
  const { nombre } = req.body;
  if (!nombre) return res.status(400).json({ error: "Nombre requerido." });
  db.run(
    "DELETE FROM personas WHERE LOWER(nombre) = LOWER(?)",
    [nombre],
    (err) => {
      if (err) return res.status(500).json({ error: "Error al actualizar." });
      return getState(res);
    }
  );
});

app.post("/api/update", (req, res) => {
  const { id, nombre, hora, duracion } = req.body;
  if (!id) return res.status(400).json({ error: "ID requerido." });

  db.get("SELECT * FROM personas WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "No encontrado." });
    const nextNombre = nombre && nombre.trim() ? nombre.trim() : row.nombre;
    const nextHora = hora && /^\d{2}:\d{2}$/.test(hora) ? hora : row.hora;
    const nextDuracion = Number.isFinite(Number(duracion))
      ? Number(duracion)
      : row.duracion;
    const nowTime = getNowTime();
    const shouldWait = row.estado !== "descanso" && nextHora > nowTime;
    const nextEstado = shouldWait ? "espera" : row.estado;
    db.run(
      "UPDATE personas SET nombre = ?, hora = ?, duracion = ?, estado = ? WHERE id = ?",
      [nextNombre, nextHora, nextDuracion, nextEstado, id],
      (err2) => {
        if (err2) return res.status(500).json({ error: "Error al actualizar." });
        return getState(res);
      }
    );
  });
});

app.post("/api/confirm", (req, res) => {
  const { id } = req.body;
  if (!id) return res.status(400).json({ error: "ID requerido." });
  const nowTime = getNowTime();
  const startedAt = new Date().toISOString();
  db.get("SELECT * FROM personas WHERE id = ?", [id], (err, row) => {
    if (err || !row) return res.status(404).json({ error: "No encontrado." });
    if (row.estado !== "pendiente") {
      return res.status(400).json({ error: "No está en estado confirmable." });
    }
    if (row.hora > nowTime) {
      return res.status(400).json({ error: "Aún no es la hora." });
    }
    db.run(
      "UPDATE personas SET estado = 'descanso', started_at = ? WHERE id = ?",
      [startedAt, id],
      (err2) => {
        if (err2) return res.status(500).json({ error: "Error al confirmar." });
        return getState(res);
      }
    );
  });
});

setInterval(() => {
  moverColaSiHayEspacio(() => {});
}, 60 * 1000);

app.listen(PORT, () => {
  console.log(`Servidor listo en http://localhost:${PORT}`);
  console.log(
    `[Cola] Zona horaria para comparar horas: ${getQueueTimeZone()} (definir TZ en el servidor si no coincide con el reloj del personal)`
  );
});
