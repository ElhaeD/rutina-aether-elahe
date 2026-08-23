import { AgentClient } from "agents/client";

const KEY = "rae-v2";

const today = () =>
  new Date().toLocaleDateString("es-PE", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });

let state = JSON.parse(localStorage.getItem(KEY) || "null");

if (!state || state.date !== today()) {
  state = {
    date: today(),
    game: 0,
    study: 0,
    routine: {
      bed: false,
      sweep: false,
      wipe: false
    },
    session: null
  };
}

const save = () =>
  localStorage.setItem(KEY, JSON.stringify(state));

const $ = (id: string) =>
  document.getElementById(id) as HTMLElement;

const agent = new AgentClient({
  agent: "ReminderAgent",
  name: "elahe"
});

let vapidPublicKey: string | null = null;

function render() {
  $("dateText").textContent =
    new Date().toLocaleDateString("es-PE", {
      weekday: "long",
      day: "numeric",
      month: "long"
    });

  $("gameStat").textContent = `${Math.round(state.game)} min`;
  $("studyStat").textContent = `${Math.round(state.study)} min`;

  document.querySelectorAll<HTMLInputElement>("[data-r]").forEach(
    (x) => {
      x.checked = !!state.routine[x.dataset.r!];
    }
  );

  const done = Object.values(state.routine).filter(Boolean).length;

  $("routineStat").textContent = `${done}/3`;
  (document.getElementById("routineBar") as HTMLElement).style.width =
    `${(done / 3) * 100}%`;

  if (done === 3) {
    $("coach").textContent =
      "🔥 Rutina completa. Casa en orden, rey.";
  }

  if (state.session) {
    $("sessionCard").classList.remove("hidden");
    showSession();
  } else {
    $("sessionCard").classList.add("hidden");
  }
}

function b64ToUint8(base64url: string) {
  const padded =
    base64url + "=".repeat((4 - (base64url.length % 4)) % 4);

  const binary = atob(
    padded.replace(/-/g, "+").replace(/_/g, "/")
  );

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

async function enablePush() {
  try {
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      $("pushStatus").textContent =
        "Este navegador no admite Push API.";
      return;
    }

    const permission = await Notification.requestPermission();

    if (permission !== "granted") {
      $("pushStatus").textContent =
        "Permiso de notificaciones no concedido.";
      return;
    }

    await navigator.serviceWorker.register("/sw.js");

    vapidPublicKey =
      vapidPublicKey ||
      await agent.call("getVapidPublicKey");

    const reg = await navigator.serviceWorker.ready;

    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey:
          b64ToUint8(vapidPublicKey)
      });
    }

    const j = sub.toJSON();

    await agent.call("subscribe", [
      {
        endpoint: j.endpoint,
        expirationTime: j.expirationTime ?? null,
        keys: j.keys
      }
    ]);

    $("pushStatus").textContent =
      "✅ Push activado. Aether puede avisarte aunque cierres la app.";

    $("coach").textContent =
      "Bien. Ahora sí te puedo perseguir con notificaciones. 😈";
  } catch (e) {
    console.error(e);

    $("pushStatus").textContent =
      "No se pudo activar el push. Revisa permisos y vuelve a intentar.";
  }
}

async function createReminder(
  message: string,
  seconds: number
) {
  try {
    if (!vapidPublicKey) {
      await enablePush();
    }

    if (Notification.permission !== "granted") return;

    await agent.call("createReminder", [
      message,
      seconds
    ]);
  } catch (e) {
    console.error(e);

    $("coach").textContent =
      "No pude programar el push. Primero activa notificaciones.";
  }
}

function start(type: "game" | "study") {
  if (state.session) {
    $("coach").textContent =
      "Ya tienes una sesión activa. Primero ciérrala.";
    return;
  }

  const limit =
    type === "game"
      ? Number(
          (document.getElementById("gameLimit") as HTMLSelectElement)
            .value
        )
      : 50;

  state.session = {
    type,
    start: Date.now(),
    limit
  };

  save();
  showSession();
  tick();

  const seconds = limit * 60;

  const msg =
    type === "game"
      ? "🎮 MI KING, SE ACABÓ EL GAMING. Guarda la partida y sal. 👑"
      : "📚 Terminó tu bloque. Descansa 10 minutos.";

  createReminder(msg, seconds);
}

function showSession() {
  $("sessionCard").classList.remove("hidden");

  $("sessionTitle").textContent =
    state.session.type === "game"
      ? "🎮 Gaming"
      : "📚 Estudio";

  $("sessionPill").textContent =
    state.session.type === "game"
      ? "LÍMITE ACTIVO"
      : "BLOQUE ACTIVO";
}

function tick() {
  if (!state.session) return;

  const left =
    state.session.limit * 60000 -
    (Date.now() - state.session.start);

  const sec = Math.floor(Math.abs(left) / 1000);

  $("timer").textContent =
    (left < 0 ? "+" : "") +
    String(Math.floor(sec / 60)).padStart(2, "0") +
    ":" +
    String(sec % 60).padStart(2, "0");

  $("sessionHint").textContent =
    left > 0
      ? "Tiempo restante recomendado"
      : state.session.type === "game"
      ? "⏰ LÍMITE ALCANZADO — guarda y sal."
      : "⏰ Bloque terminado — descansa 10 minutos.";

  clearTimeout((window as any).__rae);

  (window as any).__rae = setTimeout(tick, 1000);
}

function finish() {
  if (!state.session) return;

  const mins = Math.max(
    1,
    Math.round(
      (Date.now() - state.session.start) / 60000
    )
  );

  const type = state.session.type;

  state[type] += mins;
  state.session = null;

  save();

  clearTimeout((window as any).__rae);

  render();

  $("coach").textContent =
    type === "game"
      ? "Gaming registrado. Bien cerrado. 👑"
      : "Buen bloque. Descansa 10 minutos.";
}

document
  .querySelectorAll<HTMLInputElement>("[data-r]")
  .forEach((x) =>
    x.addEventListener("change", () => {
      state.routine[x.dataset.r!] = x.checked;
      save();
      render();
    })
  );

$("enablePush").addEventListener("click", enablePush);

$("testPush").addEventListener("click", () =>
  createReminder(
    "🔔 PRUEBA DE RUTINA AETHER + ELAHE. Si cerraste la app, este push debería aparecer igual. 👑",
    10
  )
);

$("startGame").addEventListener("click", () =>
  start("game")
);

$("startStudy").addEventListener("click", () =>
  start("study")
);

$("finishBtn").addEventListener("click", finish);

$("continueBtn").addEventListener("click", () => {
  if (state.session) {
    state.session.start = Date.now();
    save();

    $("coach").textContent =
      "Seguimos. Pero te estoy vigilando. 😈";

    tick();
  }
});

$("resetBtn").addEventListener("click", () => {
  if (confirm("¿Reiniciar los datos de hoy?")) {
    localStorage.removeItem(KEY);
    location.reload();
  }
});

navigator.serviceWorker
  ?.register("/sw.js")
  .catch(() => {});

render();
