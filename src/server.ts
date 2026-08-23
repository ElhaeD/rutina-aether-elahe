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

  @callable()
  getVapidPublicKey(): string {
    console.log("🔑 Entregando VAPID public key");
    return this.env.VAPID_PUBLIC_KEY;
  }

  @callable()
  async subscribe(
    subscription: Subscription
  ): Promise<{ ok: boolean }> {
    console.log("📲 Nueva suscripción recibida");
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

    return { ok: true };
  }

  @callable()
  async createReminder(
    message: string,
    delaySeconds: number
  ): Promise<Reminder> {
    console.log("⏰ Creando recordatorio...");
    console.log("Mensaje:", message);
    console.log("Delay:", delaySeconds);

    const safeDelay = Math.max(
      5,
      Math.min(delaySeconds, 60 * 60 * 24 * 30)
    );

    const id = crypto.randomUUID();

    const reminder: Reminder = {
      id,
      message,
      scheduledAt: Date.now() + safeDelay * 1000,
      sent: false,
    };

    this.setState({
      ...this.state,
      reminders: [
        ...this.state.reminders,
        reminder,
      ],
    });

    console.log("💾 Recordatorio guardado:", id);

    const schedule = await this.schedule(
      safeDelay,
      "sendReminder",
      {
        id,
        message,
      }
    );

    console.log("📅 Schedule creado:", schedule);

    return reminder;
  }

  async sendReminder(payload: {
    id: string;
    message: string;
  }) {
    console.log("====================================");
    console.log("🚀 INICIANDO ENVÍO DE PUSH");
    console.log("Reminder ID:", payload.id);
    console.log("Mensaje:", payload.message);
    console.log("====================================");

    try {
      console.log("🔐 Configurando VAPID...");

      webpush.setVapidDetails(
        this.env.VAPID_SUBJECT,
        this.env.VAPID_PUBLIC_KEY,
        this.env.VAPID_PRIVATE_KEY
      );

      console.log("✅ VAPID configurada");

      console.log(
        "📦 Suscripciones encontradas:",
        this.state.subscriptions.length
      );

      if (this.state.subscriptions.length === 0) {
        console.error(
          "❌ NO HAY SUSCRIPCIONES GUARDADAS"
        );
        return;
      }

      const deadEndpoints: string[] = [];

      await Promise.all(
        this.state.subscriptions.map(
          async (sub, index) => {
            console.log(
              `📤 Enviando push ${index + 1}/${this.state.subscriptions.length}`
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
                    tag: `reminder-${payload.id}`,
                    icon: "/icon.svg",
                  })
                );

              console.log(
                "✅ PUSH ENVIADO CORRECTAMENTE"
              );

              console.log(
                "Resultado:",
                result
              );
            } catch (err: unknown) {
              console.error(
                "❌ ERROR ENVIANDO PUSH"
              );

              console.error(
                "Error completo:",
                err
              );

              if (
                err instanceof webpush.WebPushError
              ) {
                console.error(
                  "Status:",
                  err.statusCode
                );

                console.error(
                  "Headers:",
                  err.headers
                );

                console.error(
                  "Body:",
                  err.body
                );

                console.error(
                  "Endpoint:",
                  err.endpoint
                );

                if (
                  err.statusCode === 404 ||
                  err.statusCode === 410
                ) {
                  deadEndpoints.push(
                    sub.endpoint
                  );
                }
              }
            }
          }
        )
      );

      if (deadEndpoints.length > 0) {
        console.log(
          "🗑️ Eliminando suscripciones inválidas:",
          deadEndpoints.length
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
      }

      this.setState({
        ...this.state,
        reminders:
          this.state.reminders.map((r) =>
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

      console.log(
        "===================================="
      );
      console.log(
        "🏁 SEND REMINDER TERMINADO"
      );
      console.log(
        "===================================="
      );
    } catch (err) {
      console.error(
        "🔥 ERROR GENERAL EN sendReminder:",
        err
      );

      throw err;
    }
  }
}

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
      new Response("Not found", {
        status: 404,
      })
    );
  },
} satisfies ExportedHandler<Env>;
