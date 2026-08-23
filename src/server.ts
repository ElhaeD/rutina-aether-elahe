import { Agent, callable, routeAgentRequest } from "agents";
import webpush from "web-push";

type Subscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
};

type Reminder = {
  id: string;
  message: string;
  scheduledAt: number;
  sent: boolean;
};

type ReminderState = {
  subscriptions: Subscription[];
  reminders: Reminder[];
};

export class ReminderAgent extends Agent<Env, ReminderState> {
  initialState: ReminderState = {
    subscriptions: [],
    reminders: [],
  };

  // =========================================================
  // VAPID PUBLIC KEY
  // =========================================================

  @callable()
  getVapidPublicKey(): string {
    const key = this.env.VAPID_PUBLIC_KEY;

    console.log("🔑 Solicitando VAPID public key");
    console.log("Existe:", !!key);
    console.log("Longitud:", key?.length ?? 0);

    return key;
  }

  // =========================================================
  // SUBSCRIBE
  // =========================================================

  @callable()
  async subscribe(
    subscription: Subscription
  ): Promise<{ ok: boolean }> {
    console.log("====================================");
    console.log("📲 NUEVA SUSCRIPCIÓN");
    console.log("====================================");

    console.log("Endpoint:", subscription.endpoint);

    const exists = this.state.subscriptions.some(
      (s) => s.endpoint === subscription.endpoint
    );

    if (!exists) {
      this.setState({
        ...this.state,
        subscriptions: [
          ...this.state.subscriptions,
          subscription,
        ],
      });

      console.log("✅ Suscripción guardada");
    } else {
      console.log("ℹ️ La suscripción ya existía");
    }

    console.log(
      "📦 Total de suscripciones:",
      this.state.subscriptions.length
    );

    return { ok: true };
  }

  // =========================================================
  // UNSUBSCRIBE
  // =========================================================

  @callable()
  async unsubscribe(
    endpoint: string
  ): Promise<{ ok: boolean }> {
    console.log("🗑️ Eliminando suscripción");

    this.setState({
      ...this.state,
      subscriptions: this.state.subscriptions.filter(
        (s) => s.endpoint !== endpoint
      ),
    });

    console.log("✅ Suscripción eliminada");

    return { ok: true };
  }

  // =========================================================
  // CREATE REMINDER
  // =========================================================

  @callable()
  async createReminder(
    message: string,
    delaySeconds: number
  ): Promise<Reminder> {
    console.log("====================================");
    console.log("⏰ CREANDO RECORDATORIO");
    console.log("====================================");

    console.log("Mensaje:", message);
    console.log("Delay recibido:", delaySeconds);

    const safeDelay = Math.max(
      5,
      Math.min(
        delaySeconds,
        60 * 60 * 24 * 30
      )
    );

    const id = crypto.randomUUID();

    const reminder: Reminder = {
      id,
      message,
      scheduledAt:
        Date.now() + safeDelay * 1000,
      sent: false,
    };

    this.setState({
      ...this.state,
      reminders: [
        ...this.state.reminders,
        reminder,
      ],
    });

    console.log("💾 Recordatorio guardado");
    console.log("ID:", id);
    console.log(
      "Ejecutará en:",
      safeDelay,
      "segundos"
    );

    const scheduleResult = await this.schedule(
      safeDelay,
      "sendReminder",
      {
        id,
        message,
      }
    );

    console.log(
      "📅 Schedule creado:",
      scheduleResult
    );

    return reminder;
  }

  // =========================================================
  // SEND REMINDER
  // =========================================================

  async sendReminder(payload: {
    id: string;
    message: string;
  }) {
    console.log("");
    console.log("====================================");
    console.log("🚀 INICIANDO SEND REMINDER");
    console.log("====================================");

    console.log("Reminder ID:", payload.id);
    console.log("Mensaje:", payload.message);

    try {
      // -----------------------------------------------------
      // 1. COMPROBAR VARIABLES
      // -----------------------------------------------------

      console.log("");
      console.log("🔐 COMPROBANDO VAPID");
      console.log("------------------------------------");

      const subject =
        this.env.VAPID_SUBJECT;

      const publicKey =
        this.env.VAPID_PUBLIC_KEY;

      const privateKey =
        this.env.VAPID_PRIVATE_KEY;

      console.log(
        "VAPID_SUBJECT existe:",
        !!subject
      );

      console.log(
        "VAPID_PUBLIC_KEY existe:",
        !!publicKey
      );

      console.log(
        "VAPID_PRIVATE_KEY existe:",
        !!privateKey
      );

      console.log(
        "Public key length:",
        publicKey?.length ?? 0
      );

      console.log(
        "Private key length:",
        privateKey?.length ?? 0
      );

      // -----------------------------------------------------
      // 2. LIMPIAR ESPACIOS ACCIDENTALES
      // -----------------------------------------------------

      const cleanSubject =
        subject?.trim();

      const cleanPublicKey =
        publicKey?.trim();

      const cleanPrivateKey =
        privateKey?.trim();

      console.log(
        "Public key length después de trim:",
        cleanPublicKey?.length ?? 0
      );

      console.log(
        "Private key length después de trim:",
        cleanPrivateKey?.length ?? 0
      );

      // -----------------------------------------------------
      // 3. VALIDAR QUE EXISTAN
      // -----------------------------------------------------

      if (
        !cleanSubject ||
        !cleanPublicKey ||
        !cleanPrivateKey
      ) {
        throw new Error(
          "Faltan variables VAPID en Cloudflare."
        );
      }

      // -----------------------------------------------------
      // 4. CONFIGURAR VAPID
      // -----------------------------------------------------

      console.log("");
      console.log(
        "🔑 Ejecutando webpush.setVapidDetails()..."
      );

      webpush.setVapidDetails(
        cleanSubject,
        cleanPublicKey,
        cleanPrivateKey
      );

      console.log(
        "✅ VAPID configurada correctamente"
      );

      // -----------------------------------------------------
      // 5. COMPROBAR SUSCRIPCIONES
      // -----------------------------------------------------

      console.log("");
      console.log("📦 SUSCRIPCIONES");
      console.log("------------------------------------");

      const subscriptions =
        this.state.subscriptions;

      console.log(
        "Total:",
        subscriptions.length
      );

      if (subscriptions.length === 0) {
        console.error(
          "❌ NO HAY SUSCRIPCIONES GUARDADAS"
        );

        return;
      }

      // -----------------------------------------------------
      // 6. ENVIAR PUSH
      // -----------------------------------------------------

      const deadEndpoints: string[] = [];

      for (
        let index = 0;
        index < subscriptions.length;
        index++
      ) {
        const sub =
          subscriptions[index];

        console.log("");
        console.log(
          `📤 ENVIANDO PUSH ${index + 1}/${subscriptions.length}`
        );

        console.log(
          "Endpoint:",
          sub.endpoint
        );

        try {
          const result =
            await webpush.sendNotification(
              sub,
              JSON.stringify({
                title:
                  "Rutina Aether + Elahe 👑",
                body: payload.message,
                tag:
                  `reminder-${payload.id}`,
                icon: "/icon.svg",
              })
            );

          console.log(
            "✅ PUSH ENVIADO"
          );

          console.log(
            "Status code:",
            result.statusCode
          );
        } catch (err: unknown) {
          console.error(
            "❌ ERROR ENVIANDO PUSH"
          );

          if (
            err instanceof webpush.WebPushError
          ) {
            console.error(
              "Status:",
              err.statusCode
            );

            console.error(
              "Body:",
              err.body
            );

            console.error(
              "Headers:",
              err.headers
            );

            if (
              err.statusCode === 404 ||
              err.statusCode === 410
            ) {
              console.log(
                "🗑️ Suscripción expirada/inválida"
              );

              deadEndpoints.push(
                sub.endpoint
              );
            }
          } else {
            console.error(
              "Error:",
              err
            );
          }
        }
      }

      // -----------------------------------------------------
      // 7. ELIMINAR SUSCRIPCIONES MUERTAS
      // -----------------------------------------------------

      if (
        deadEndpoints.length > 0
      ) {
        console.log("");
        console.log(
          "🗑️ ELIMINANDO SUSCRIPCIONES INVÁLIDAS"
        );

        this.setState({
          ...this.state,
          subscriptions:
            this.state.subscriptions.filter(
              (s) =>
                !deadEndpoints.includes(
                  s.endpoint
                )
            ),
        });

        console.log(
          "Eliminadas:",
          deadEndpoints.length
        );
      }

      // -----------------------------------------------------
      // 8. MARCAR RECORDATORIO COMO ENVIADO
      // -----------------------------------------------------

      this.setState({
        ...this.state,
        reminders:
          this.state.reminders.map(
            (r) =>
              r.id === payload.id
                ? {
                    ...r,
                    sent: true,
                  }
                : r
          ),
      });

      console.log(
        "✅ Recordatorio marcado como enviado"
      );

      // -----------------------------------------------------
      // 9. BROADCAST
      // -----------------------------------------------------

      this.broadcast(
        JSON.stringify({
          type: "reminder_sent",
          id: payload.id,
          timestamp: Date.now(),
        })
      );

      console.log(
        "📡 Broadcast enviado"
      );

      console.log("");
      console.log("====================================");
      console.log(
        "🏁 SEND REMINDER TERMINADO"
      );
      console.log("====================================");

    } catch (err: unknown) {
      console.error("");
      console.error("====================================");
      console.error(
        "🔥 ERROR GENERAL EN SEND REMINDER"
      );
      console.error("====================================");

      console.error(
        "Error:",
        err
      );

      console.error(
        "Mensaje:",
        err instanceof Error
          ? err.message
          : String(err)
      );

      console.error(
        "Stack:",
        err instanceof Error
          ? err.stack
          : "sin stack"
      );

      console.error(
        "===================================="
      );

      throw err;
    }
  }
}

// =========================================================
// WORKER ENTRYPOINT
// =========================================================

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ) {
    return (
      (await routeAgentRequest(
        request,
        env
      )) ??
      new Response(
        "Not found",
        {
          status: 404,
        }
      )
    );
  },
} satisfies ExportedHandler<Env>;
