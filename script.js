const nombreInput = document.getElementById("nombre");
const horaInput = document.getElementById("hora");
const duracionInput = document.getElementById("duracion");
const btnSolicitar = document.getElementById("btnSolicitar");
const btnCancelar = document.getElementById("btnCancelar");
const descansoList = document.getElementById("descansoList");
const esperaList = document.getElementById("esperaList");
const activosCount = document.getElementById("activosCount");
const esperaCount = document.getElementById("esperaCount");
const capacidadActual = document.getElementById("capacidadActual");
const capacidadMax = document.getElementById("capacidadMax");
const toastContainer = document.getElementById("toastContainer");

const state = {
  descanso: [],
  espera: [],
  max: 3,
};

const pad = (value) => String(value).padStart(2, "0");

const toInitials = (nombre) =>
  nombre
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((parte) => parte.charAt(0).toUpperCase())
    .join("");

const nowTime = () => {
  const now = new Date();
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
};

const formatDuration = (min) => `${min} min`;

const formatTime = (isoString) => {
  if (!isoString) return "";
  const date = new Date(isoString);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const minutesSince = (isoString) => {
  if (!isoString) return 0;
  const diff = Date.now() - new Date(isoString).getTime();
  return Math.max(0, Math.floor(diff / 60000));
};

const remainingMinutes = (startedAt, total) => {
  if (!startedAt) return total;
  return Math.max(0, total - minutesSince(startedAt));
};

const pendingNotified = new Set();
const overtimeNotified = new Set();

const showToast = (message) => {
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 5000);
};

const notifyTurn = (persona) => {
  if (pendingNotified.has(persona.id)) return;
  pendingNotified.add(persona.id);
  showToast(`Turno disponible para ${persona.nombre}.`);
  if ("Notification" in window) {
    if (Notification.permission === "granted") {
      new Notification("Turno disponible", {
        body: `Es tu turno, ${persona.nombre}.`,
      });
    } else if (Notification.permission === "default") {
      Notification.requestPermission().then((perm) => {
        if (perm === "granted") {
          new Notification("Turno disponible", {
            body: `Es tu turno, ${persona.nombre}.`,
          });
        }
      });
    }
  }
};

const api = async (url, payload) => {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {}),
  });
  if (!res.ok) throw new Error("Error de servidor");
  return res.json();
};

const updateClock = () => {
  const now = new Date();
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(
    now.getSeconds()
  )}`;
  const date = now.toLocaleDateString("es-ES", {
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  document.querySelector("#clock .clock-time").textContent = time;
  document.querySelector("#clock .clock-date").textContent = date;
};

const createCard = (persona, tipo) => {
  const card = document.createElement("div");
  card.className = `person-card ${tipo}`;
  if (persona.estado === "pendiente") {
    card.classList.add("pendiente");
  }

  const header = document.createElement("div");
  header.className = "person-header";

  const avatar = document.createElement("div");
  avatar.className = "avatar";
  avatar.textContent = toInitials(persona.nombre);

  const pill = document.createElement("div");
  if (persona.estado === "pendiente") {
    pill.className = "status-pill pendiente";
    pill.textContent = "Por confirmar";
  } else if (tipo === "espera") {
    pill.className = "status-pill cola";
    pill.textContent = "En cola";
  } else {
    pill.className = "status-pill activo";
    pill.textContent = "En descanso";
  }

  header.appendChild(avatar);
  header.appendChild(pill);

  const name = document.createElement("div");
  name.className = "person-name";
  name.textContent = persona.nombre;

  const meta = document.createElement("div");
  meta.className = "person-meta";
  const metaParts = [
    `<span>Hora solicitada: ${persona.hora}</span>`,
    `<span>Duración: ${formatDuration(persona.duracion)}</span>`,
  ];
  if (persona.estado === "descanso" && persona.started_at) {
    const remaining = remainingMinutes(persona.started_at, persona.duracion);
    metaParts.push(
      `<span>Inicio real: ${formatTime(persona.started_at)}</span>`
    );
    metaParts.push(
      `<span class="elapsed" data-started="${persona.started_at}">Transcurrido: ${minutesSince(
        persona.started_at
      )} min</span>`
    );
    if (remaining > 0) {
      metaParts.push(
        `<span class="remaining" data-started="${persona.started_at}" data-duration="${persona.duracion}">Restante: ${remaining} min</span>`
      );
    } else {
      metaParts.push(
        `<span class="remaining overtime" data-started="${persona.started_at}" data-duration="${persona.duracion}" data-id="${persona.id}" data-name="${persona.nombre}">Exceso: ${Math.abs(
          remaining
        )} min</span>`
      );
    }
  } else if (persona.estado === "pendiente") {
    metaParts.push("<span>Turno disponible</span>");
  }
  meta.innerHTML = metaParts.join("");

  const actions = document.createElement("div");
  actions.className = "person-actions";

  const btnPrimary = document.createElement("button");
  btnPrimary.className = "mini-btn primary";
  if (persona.estado === "pendiente") {
    btnPrimary.textContent = "Confirmar inicio";
    btnPrimary.addEventListener("click", () => confirmarInicio(persona.id));
  } else if (tipo === "espera") {
    btnPrimary.textContent = "Cancelar espera";
    btnPrimary.addEventListener("click", () => cancelarEspera(persona.id));
  } else {
    btnPrimary.textContent = "Finalizar descanso";
    btnPrimary.addEventListener("click", () => finalizarDescanso(persona.id));
  }

  const btnSecondary = document.createElement("button");
  btnSecondary.className = "mini-btn secondary";
  btnSecondary.textContent = "Actualizar";
  btnSecondary.addEventListener("click", () => actualizarPersona(persona.id));

  actions.appendChild(btnPrimary);
  actions.appendChild(btnSecondary);

  card.appendChild(header);
  card.appendChild(name);
  card.appendChild(meta);
  card.appendChild(actions);

  return card;
};

const render = () => {
  descansoList.innerHTML = "";
  esperaList.innerHTML = "";

  state.descanso.forEach((persona) => {
    descansoList.appendChild(createCard(persona, "descanso"));
  });

  state.espera.forEach((persona) => {
    esperaList.appendChild(createCard(persona, "espera"));
  });

  const pendientes = state.espera.filter((persona) => persona.estado === "pendiente").length;
  activosCount.textContent = `${state.descanso.length} activos`;
  esperaCount.textContent = `${state.espera.length} en cola`;
  capacidadActual.textContent = state.descanso.length + pendientes;
  capacidadMax.textContent = state.max;
};

const syncState = (data) => {
  state.descanso = data.descanso || [];
  state.espera = data.espera || [];
  state.max = data.max || 3;
  render();
  state.espera
    .filter((persona) => persona.estado === "pendiente")
    .forEach((persona) => notifyTurn(persona));
  checkOvertime();
};

const checkOvertime = () => {
  state.descanso.forEach((persona) => {
    if (!persona.started_at) return;
    if (remainingMinutes(persona.started_at, persona.duracion) > 0) return;
    if (overtimeNotified.has(persona.id)) return;
    overtimeNotified.add(persona.id);
    showToast(`Descanso excedido: ${persona.nombre}.`);
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification("Descanso excedido", {
        body: `Tiempo cumplido para ${persona.nombre}.`,
      });
    }
  });
};

const solicitarDescanso = async () => {
  const nombre = nombreInput.value.trim();
  if (!nombre) {
    nombreInput.focus();
    return;
  }

  const hora = horaInput.value || nowTime();
  const duracion = Number(duracionInput.value);
  const persona = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    nombre,
    hora,
    duracion,
  };

  try {
    const data = await api("/api/request", persona);
    nombreInput.value = "";
    syncState(data);
  } catch (err) {
    alert("No se pudo registrar. Intenta nuevamente.");
  }
};

const finalizarDescanso = async (id) => {
  try {
    const data = await api("/api/finalize", { id });
    syncState(data);
  } catch (err) {
    alert("No se pudo finalizar.");
  }
};

const cancelarEspera = async (id) => {
  try {
    const data = await api("/api/cancel", { id });
    syncState(data);
  } catch (err) {
    alert("No se pudo cancelar.");
  }
};

const confirmarInicio = async (id) => {
  try {
    const data = await api("/api/confirm", { id });
    syncState(data);
  } catch (err) {
    alert("No se pudo confirmar.");
  }
};

const actualizarPersona = async (id) => {
  const nombre = prompt("Actualizar nombre:", "");
  if (nombre === null) return;
  const hora = prompt("Actualizar hora (HH:MM):", "");
  const duracion = prompt("Actualizar duración (min):", "");
  try {
    const data = await api("/api/update", {
      id,
      nombre,
      hora,
      duracion,
    });
    syncState(data);
  } catch (err) {
    alert("No se pudo actualizar.");
  }
};

const cancelarMiEstado = async () => {
  const nombre = nombreInput.value.trim();
  if (!nombre) {
    nombreInput.focus();
    return;
  }
  try {
    const data = await api("/api/cancel-by-name", { nombre });
    syncState(data);
  } catch (err) {
    alert("No se pudo cancelar.");
  }
};

const initHora = () => {
  horaInput.value = nowTime();
};

btnSolicitar.addEventListener("click", solicitarDescanso);
btnCancelar.addEventListener("click", cancelarMiEstado);

const refreshState = () => {
  fetch("/api/state")
    .then((res) => res.json())
    .then((data) => syncState(data))
    .catch(() => {
      render();
    });
};

initHora();
refreshState();
updateClock();
setInterval(updateClock, 1000);
setInterval(refreshState, 30000);
setInterval(() => {
  document.querySelectorAll(".elapsed").forEach((el) => {
    const started = el.getAttribute("data-started");
    if (!started) return;
    el.textContent = `Transcurrido: ${minutesSince(started)} min`;
  });
  document.querySelectorAll(".remaining").forEach((el) => {
    const started = el.getAttribute("data-started");
    const duration = Number(el.getAttribute("data-duration"));
    if (!started || Number.isNaN(duration)) return;
    const remaining = remainingMinutes(started, duration);
    if (remaining > 0) {
      el.textContent = `Restante: ${remaining} min`;
      el.classList.remove("overtime");
    } else {
      el.textContent = `Exceso: ${Math.abs(remaining)} min`;
      el.classList.add("overtime");
    }
  });
  checkOvertime();
}, 30000);
