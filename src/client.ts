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

/* =========================================================
   UTILIDADES
========================================================= */

function b64ToUint8(base64url: string): Uint8Array {
  const normalized = base64url
    .trim()
    .replace(/"/g, "")
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded =
    normalized +
    "=".repeat((4 - (normalized.length % 4)) % 4);

  const binary = atob(padded);

  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

/* =========================================================
   RENDER
========================================================= */

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

  (
    document.getElementById("routineBar") as HTMLElement
  ).style.width =
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

/* =========================================================
   PUSH NOTIFICATIONS
========================================================= */

async function enablePush() {
  try {
    /* -----------------------------------------------------
       1. Verificar soporte del navegador
    ----------------------------------------------------- */

    if (
      !("serviceWorker" in navigator) ||
      !("PushManager" in window) ||
      !("Notification" in window)
    ) {
      $("pushStatus").textContent =
        "Este navegador no admite las notificaciones Push.";

      return;
    }

    /* -----------------------------------------------------
       2. Pedir permiso al usuario
    ----------------------------------------------------- */

    const permission =
      await Notification.requestPermission();

    if (permission !== "granted") {
      $("pushStatus").textContent =
        "Permiso de notificaciones no concedido.";

      return;
    }

    /* -----------------------------------------------------
       3. Registrar Service Worker
    ----------------------------------------------------- */

    await navigator.serviceWorker.register("/sw.js");

    /* -----------------------------------------------------
       4. Obtener VAPID public key desde Cloudflare
    ----------------------------------------------------- */

    const response =
      await agent.call("getVapidPublicKey");

    console.log(
      "Respuesta VAPID recibida:",
      response
    );

    if (!response) {
      throw new Error(
        "Cloudflare no devolvió una VAPID public key."
      );
    }

    vapidPublicKey = String(response).trim();

    console.log(
      "VAPID public key recibida correctamente."
    );

    /* -----------------------------------------------------
       5. Convertir la clave a Uint8Array
    ----------------------------------------------------- */

    const keyBytes =
      b64ToUint8(vapidPublicKey);

    console.log(
      "VAPID key bytes:",
      keyBytes.length
    );

    /* -----------------------------------------------------
       6. Validar tamaño de clave P-256
    ----------------------------------------------------- */

    if (keyBytes.length !== 65) {
      throw new Error(
        `La VAPID public key debe tener 65 bytes. Tiene ${keyBytes.length}.`
      );
    }

    /* -----------------------------------------------------
       7. Esperar Service Worker
    ----------------------------------------------------- */

    const reg =
      await navigator.serviceWorker.ready;

    /* -----------------------------------------------------
       8. Buscar suscripción existente
    ----------------------------------------------------- */

    let sub =
      await reg.pushManager.getSubscription();

    /* -----------------------------------------------------
       9. Crear suscripción Push
    ----------------------------------------------------- */

    if (!sub) {
      sub =
        await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: keyBytes
        });
    }

    /* -----------------------------------------------------
       10. Convertir suscripción a JSON
    ----------------------------------------------------- */

    const j = sub.toJSON();

    console.log(
      "Push subscription creada:",
      j
    );

    /* -----------------------------------------------------
       11. Enviar suscripción al Agent
    ----------------------------------------------------- */

    await agent.call("subscribe", [
      {
        endpoint: j.endpoint,
        expirationTime:
          j.expirationTime ?? null,
        keys: j.keys
      }
    ]);

    /* -----------------------------------------------------
       12. ÉXITO
    ----------------------------------------------------- */

    $("pushStatus").textContent =
      "✅ Push activado. Aether puede avisarte aunque cierres la app.";

    $("coach").textContent =
      "Bien. Ahora sí te puedo perseguir con notificaciones. 😈";

  } catch (e) {
    console.error(
      "ERROR ACTIVANDO PUSH:",
      e
    );

    $("pushStatus").textContent =
      "❌ No se pudo activar el push.";

    $("coach").textContent =
      "Falló la activación del push. Mira la consola para ver el error.";
  }
}

/* =========================================================
   CREAR RECORDATORIO
========================================================= */

async function createReminder(
  message: string,
  seconds: number
) {
  try {
    if (!vapidPublicKey) {
      await enablePush();
    }

    if (
      !("Notification" in window) ||
      Notification.permission !== "granted"
    ) {
      return;
    }

    await agent.call("createReminder", [
      message,
      seconds
    ]);

  } catch (e) {
    console.error(
      "ERROR CREANDO RECORDATORIO:",
      e
    );

    $("coach").textContent =
      "No pude programar el push. Primero activa las notificaciones.";
  }
}

/* =========================================================
   GAMING / ESTUDIO
========================================================= */

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

function showSession() {
  $("sessionCard").classList.remove(
    "hidden"
  );

  $("sessionTitle").textContent =
    state.session.type === "game"
      ? "🎮 Gaming"
      : "📚 Estudio";

  $("sessionPill").textContent =
    state.session.type === "game"
      ? "LÍMITE ACTIVO"
      : "BLOQUE ACTIVO";
}

/* =========================================================
   TIMER
========================================================= */

function tick() {
  if (!state.session) return;

  const left =
    state.session.limit * 60000 -
    (
      Date.now() -
      state.session.start
    );

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
      : state.session.type === "game"
      ? "⏰ LÍMITE ALCANZADO — guarda y sal."
      : "⏰ Bloque terminado — descansa 10 minutos.";

  clearTimeout(
    (window as any).__rae
  );

  (
    window as any
  ).__rae =
    setTimeout(
      tick,
      1000
    );
}

/* =========================================================
   FINALIZAR SESIÓN
========================================================= */

function finish() {
  if (!state.session) return;

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

/* =========================================================
   CHECKLIST DE RUTINA
========================================================= */

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

/* =========================================================
   BOTÓN ACTIVAR PUSH
========================================================= */

$("enablePush")
  .addEventListener(
    "click",
    enablePush
  );

/* =========================================================
   BOTÓN PRUEBA PUSH
========================================================= */

$("testPush")
  .addEventListener(
    "click",
    () =>
      createReminder(
        "🔔 PRUEBA DE RUTINA AETHER + ELAHE. Si cerraste la app, este push debería aparecer igual. 👑",
        10
      )
  );

/* =========================================================
   BOTÓN GAMING
========================================================= */

$("startGame")
  .addEventListener(
    "click",
    () =>
      start("game")
  );

/* =========================================================
   BOTÓN ESTUDIO
========================================================= */

$("startStudy")
  .addEventListener(
    "click",
    () =>
      start("study")
  );

/* =========================================================
   BOTÓN FINALIZAR
========================================================= */

$("finishBtn")
  .addEventListener(
    "click",
    finish
  );

/* =========================================================
   CONTINUAR SESIÓN
========================================================= */

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

/* =========================================================
   RESET
========================================================= */

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

/* =========================================================
   REGISTRAR SERVICE WORKER
========================================================= */

navigator.serviceWorker
  ?.register("/sw.js")
  .catch(
    (e) =>
      console.error(
        "No se pudo registrar sw.js:",
        e
      )
  );

/* =========================================================
   INICIO
========================================================= */

render();
