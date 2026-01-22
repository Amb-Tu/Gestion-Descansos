CREATE TABLE personas (
  id TEXT PRIMARY KEY,
  nombre TEXT NOT NULL,
  hora TEXT NOT NULL,
  duracion INTEGER NOT NULL,
  estado TEXT NOT NULL CHECK (estado IN ('descanso', 'espera', 'pendiente')),
  created_at TEXT NOT NULL,
  started_at TEXT
);
