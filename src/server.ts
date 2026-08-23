import { Agent, callable, routeAgentRequest } from "agents";
import webpush from "web-push";

type Subscription = {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
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
    reminders: []
  };

  @callable()
  getVapidPublicKey(): string {
    return this.env.VAPID_PUBLIC_KEY;
  }

  @callable()
  async subscribe(subscription: Subscription): Promise<{ ok: boolean }> {
    const exists = this.state.subscriptions.some(
      (s) => s.endpoint === subscription.endpoint
    );
    if (!exists) {
      this.setState({
        ...this.state,
        subscriptions: [...this.state.subscriptions, subscription]
      });
    }
    return { ok: true };
  }

  @callable()
  async unsubscribe(endpoint: string): Promise<{ ok: boolean }> {
    this.setState({
      ...this.state,
      subscriptions: this.state.subscriptions.filter(
        (s) => s.endpoint !== endpoint
      )
    });
    return { ok: true };
  }

  @callable()
  async createReminder(message: string, delaySeconds: number): Promise<Reminder> {
    const safeDelay = Math.max(5, Math.min(delaySeconds, 60 * 60 * 24 * 30));
    const id = crypto.randomUUID();
    const reminder: Reminder = {
      id,
      message,
      scheduledAt: Date.now() + safeDelay * 1000,
      sent: false
    };

    this.setState({
      ...this.state,
      reminders: [...this.state.reminders, reminder]
    });

    await this.schedule(safeDelay, "sendReminder", { id, message });
    return reminder;
  }

  async sendReminder(payload: { id: string; message: string }) {
    webpush.setVapidDetails(
      this.env.VAPID_SUBJECT,
      this.env.VAPID_PUBLIC_KEY,
      this.env.VAPID_PRIVATE_KEY
    );

    const deadEndpoints: string[] = [];

    await Promise.all(
      this.state.subscriptions.map(async (sub) => {
        try {
          await webpush.sendNotification(
            sub,
            JSON.stringify({
              title: "Rutina Aether + Elahe 👑",
              body: payload.message,
              tag: `reminder-${payload.id}`,
              icon: "/icon.svg"
            })
          );
        } catch (err: unknown) {
          const statusCode =
            err instanceof webpush.WebPushError ? err.statusCode : 0;
          if (statusCode === 404 || statusCode === 410) {
            deadEndpoints.push(sub.endpoint);
          }
        }
      })
    );

    if (deadEndpoints.length) {
      this.setState({
        ...this.state,
        subscriptions: this.state.subscriptions.filter(
          (s) => !deadEndpoints.includes(s.endpoint)
        )
      });
    }

    this.setState({
      ...this.state,
      reminders: this.state.reminders.map((r) =>
        r.id === payload.id ? { ...r, sent: true } : r
      )
    });

    this.broadcast(JSON.stringify({
      type: "reminder_sent",
      id: payload.id,
      timestamp: Date.now()
    }));
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return (
      (await routeAgentRequest(request, env)) ??
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
