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

// ======================================================
// AETHER AGENT
// ======================================================

const agent = new AgentClient({
  agent: "ReminderAgent",
  name: "elahe",
  host: window.location.host
});

let vapidPublicKey: string | null = null;

// ======================================================
// RENDER
// ======================================================

function render() {
  $("dateText").textContent =
    new Date().toLocaleDateString("es-PE", {
      weekday: "long",
      day: "numeric",
      month: "long"
    });

  $("gameStat").textContent =
    `${Math.round(state.game)} min`;

  $("studyStat").textContent =
    `${Math.round(state.study)} min`;

  document
    .querySelectorAll<HTMLInputElement>("[data-r]")
    .forEach((x) => {
      x.checked = !!state.routine[x.dataset.r!];
    });

  const done =
    Object.values(state.routine).filter(Boolean).length;

  $("routineStat").textContent =
    `${done}/3`;

  (document.getElementById("routineBar") as HTMLElement)
    .style.width =
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

// ======================================================
// VAPID BASE64URL → UINT8ARRAY
// ======================================================

function b64ToUint8(base64url: string): Uint8Array {
  const padded =
    base64url +
    "=".repeat(
      (4 - (base64url.length % 4)) % 4
    );

  const binary = atob(
    padded
      .replace(/-/g, "+")
      .replace(/_/g, "/")
  );

  let bytes =
    new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] =
      binary.charCodeAt(i);
  }

  console.log(
    "VAPID bytes antes de normalizar:",
    bytes.length
  );

  // Una clave pública P-256 en formato
  // no comprimido debe tener:
  //
  // 1 byte de prefijo 0x04
  // + 32 bytes X
  // + 32 bytes Y
  //
  // Total = 65 bytes.
  //
  // Nuestro servidor actualmente está
  // devolviendo X + Y = 64 bytes.
  // Agregamos el prefijo 0x04.

  if (bytes.length === 64) {
    const fixed =
      new Uint8Array(65);

    fixed[0] = 0x04;

    fixed.set(bytes, 1);

    bytes = fixed;
  }

  console.log(
    "VAPID bytes finales:",
    bytes.length
  );

  if (bytes.length !== 65) {
    throw new Error(
      `La VAPID public key debe tener 65 bytes. Tiene ${bytes.length}.`
    );
  }

  return bytes;
}

// ======================================================
// ACTIVAR PUSH
// ======================================================

async function enablePush() {
  try {
    console.log(
      "🔔 Iniciando activación de Push..."
    );

    // Verificar soporte
    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window)
    ) {
      $("pushStatus").textContent =
        "Este navegador no admite Push API.";

      return;
    }

    // Pedir permiso al navegador
    const permission =
      await Notification.requestPermission();

    console.log(
      "Permiso de notificaciones:",
      permission
    );

    if (permission !== "granted") {
      $("pushStatus").textContent =
        "Permiso de notificaciones no concedido.";

      return;
    }

    // Registrar Service Worker
    console.log(
      "Registrando Service Worker..."
    );

    await navigator.serviceWorker.register(
      "/sw.js"
    );

    // Obtener VAPID pública desde Cloudflare
    console.log(
      "Solicitando VAPID public key..."
    );

    vapidPublicKey =
      vapidPublicKey ||
      await agent.call(
        "getVapidPublicKey"
      );

    console.log(
      "Respuesta VAPID recibida:",
      vapidPublicKey
    );

    if (
      !vapidPublicKey ||
      typeof vapidPublicKey !== "string"
    ) {
      throw new Error(
        "Cloudflare no devolvió una VAPID public key válida."
      );
    }

    console.log(
      "VAPID public key recibida correctamente."
    );

    // Obtener Service Worker listo
    const reg =
      await navigator.serviceWorker.ready;

    // Buscar suscripción existente
    let sub =
      await reg.pushManager.getSubscription();

    // Crear suscripción si no existe
    if (!sub) {
      console.log(
        "Creando nueva suscripción Push..."
      );

      const applicationServerKey =
        b64ToUint8(vapidPublicKey);

      sub =
        await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey
        });
    }

    console.log(
      "Push subscription creada:",
      sub
    );

    const j = sub.toJSON();

    // Guardar suscripción en nuestro Agent
    await agent.call(
      "subscribe",
      [
        {
          endpoint: j.endpoint,
          expirationTime:
            j.expirationTime ?? null,
          keys: j.keys
        }
      ]
    );

    console.log(
      "✅ Suscripción guardada correctamente."
    );

    $("pushStatus").textContent =
      "✅ Push activado. Aether puede avisarte aunque cierres la app.";

    $("coach").textContent =
      "Bien. Ahora sí te puedo perseguir con notificaciones. 😈";

  } catch (e) {
    console.error(
      "❌ ERROR ACTIVANDO PUSH:",
      e
    );

    $("pushStatus").textContent =
      "No se pudo activar el push. Revisa permisos y vuelve a intentar.";
  }
}

// ======================================================
// CREAR RECORDATORIO
// ======================================================

async function createReminder(
  message: string,
  seconds: number
) {
  try {
    if (!vapidPublicKey) {
      await enablePush();
    }

    if (
      Notification.permission !==
      "granted"
    ) {
      return;
    }

    await agent.call(
      "createReminder",
      [
        message,
        seconds
      ]
    );

    console.log(
      "⏰ Recordatorio creado:",
      message
    );

  } catch (e) {
    console.error(
      "❌ Error creando recordatorio:",
      e
    );

    $("coach").textContent =
      "No pude programar el push. Primero activa notificaciones.";
  }
}

// ======================================================
// INICIAR SESIÓN
// ======================================================

function start(
  type: "game" | "study"
) {
  if (state.session) {
    $("coach").textContent =
      "Ya tienes una sesión activa. Primero ciérrala.";

    return;
  }

  const limit =
    type === "game"
      ? Number(
          (
            document.getElementById(
              "gameLimit"
            ) as HTMLSelectElement
          ).value
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

  const seconds =
    limit * 60;

  const msg =
    type === "game"
      ? "🎮 MI KING, SE ACABÓ EL GAMING. Guarda la partida y sal. 👑"
      : "📚 Terminó tu bloque. Descansa 10 minutos.";

  createReminder(
    msg,
    seconds
  );
}

// ======================================================
// MOSTRAR SESIÓN
// ======================================================

function showSession() {
  $("sessionCard")
    .classList
    .remove("hidden");

  $("sessionTitle").textContent =
    state.session.type === "game"
      ? "🎮 Gaming"
      : "📚 Estudio";

  $("sessionPill").textContent =
    state.session.type === "game"
      ? "LÍMITE ACTIVO"
      : "BLOQUE ACTIVO";
}

// ======================================================
// TIMER
// ======================================================

function tick() {
  if (!state.session) {
    return;
  }

  const left =
    state.session.limit * 60000 -
    (Date.now() -
      state.session.start);

  const sec =
    Math.floor(
      Math.abs(left) / 1000
    );

  $("timer").textContent =
    (left < 0 ? "+" : "") +
    String(
      Math.floor(sec / 60)
    ).padStart(2, "0") +
    ":" +
    String(
      sec % 60
    ).padStart(2, "0");

  $("sessionHint").textContent =
    left > 0
      ? "Tiempo restante recomendado"
      : state.session.type ===
        "game"
      ? "⏰ LÍMITE ALCANZADO — guarda y sal."
      : "⏰ Bloque terminado — descansa 10 minutos.";

  clearTimeout(
    (window as any).__rae
  );

  (window as any).__rae =
    setTimeout(
      tick,
      1000
    );
}

// ======================================================
// FINALIZAR SESIÓN
// ======================================================

function finish() {
  if (!state.session) {
    return;
  }

  const mins =
    Math.max(
      1,
      Math.round(
        (
          Date.now() -
          state.session.start
        ) / 60000
      )
    );

  const type =
    state.session.type;

  state[type] += mins;

  state.session = null;

  save();

  clearTimeout(
    (window as any).__rae
  );

  render();

  $("coach").textContent =
    type === "game"
      ? "Gaming registrado. Bien cerrado. 👑"
      : "Buen bloque. Descansa 10 minutos.";
}

// ======================================================
// CHECKBOXES DE RUTINA
// ======================================================

document
  .querySelectorAll<HTMLInputElement>(
    "[data-r]"
  )
  .forEach((x) =>
    x.addEventListener(
      "change",
      () => {
        state.routine[
          x.dataset.r!
        ] = x.checked;

        save();

        render();
      }
    )
  );

// ======================================================
// BOTÓN ACTIVAR PUSH
// ======================================================

$("enablePush")
  .addEventListener(
    "click",
    enablePush
  );

// ======================================================
// BOTÓN TEST PUSH
// ======================================================

$("testPush")
  .addEventListener(
    "click",
    () =>
      createReminder(
        "🔔 PRUEBA DE RUTINA AETHER + ELAHE. Si cerraste la app, este push debería aparecer igual. 👑",
        10
      )
  );

// ======================================================
// BOTÓN GAMING
// ======================================================

$("startGame")
  .addEventListener(
    "click",
    () =>
      start("game")
  );

// ======================================================
// BOTÓN ESTUDIO
// ======================================================

$("startStudy")
  .addEventListener(
    "click",
    () =>
      start("study")
  );

// ======================================================
// BOTÓN FINALIZAR
// ======================================================

$("finishBtn")
  .addEventListener(
    "click",
    finish
  );

// ======================================================
// CONTINUAR SESIÓN
// ======================================================

$("continueBtn")
  .addEventListener(
    "click",
    () => {
      if (state.session) {
        state.session.start =
          Date.now();

        save();

        $("coach").textContent =
          "Seguimos. Pero te estoy vigilando. 😈";

        tick();
      }
    }
  );

// ======================================================
// REINICIAR DATOS
// ======================================================

$("resetBtn")
  .addEventListener(
    "click",
    () => {
      if (
        confirm(
          "¿Reiniciar los datos de hoy?"
        )
      ) {
        localStorage.removeItem(
          KEY
        );

        location.reload();
      }
    }
  );

// ======================================================
// SERVICE WORKER
// ======================================================

navigator.serviceWorker
  ?.register("/sw.js")
  .catch(() => {});

// ======================================================
// INICIALIZAR
// ======================================================

render();
