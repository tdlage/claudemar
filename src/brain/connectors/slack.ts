import { SocketModeClient } from "@slack/socket-mode";
import { WebClient } from "@slack/web-api";
import { config } from "../../config.js";
import { emitCanonicalEvent } from "../canonical.js";
import { getRedis, incrMetric } from "../redis.js";
import { dayKeyInTz } from "../text.js";
import { brainSchedulers } from "../schedulers.js";
import type { CanonicalEvent } from "../types.js";

const CURSOR_KEY = "brain:cursor:slack";
const CATCHUP_LIMIT = 200;

interface SlackMessageEvent {
  type?: string;
  subtype?: string;
  channel?: string;
  channel_type?: string;
  user?: string;
  bot_id?: string;
  text?: string;
  ts?: string;
  thread_ts?: string;
  team?: string;
}

class SlackManager {
  private socket: SocketModeClient | null = null;
  private web: WebClient | null = null;
  private teamId = "slack";
  private starting = false;
  connected = false;
  lastError = "";
  private userNames = new Map<string, string>();
  private channelNames = new Map<string, { name: string; type: string }>();

  enabledByEnv(): boolean {
    return Boolean(config.slackAppToken && config.slackBotToken);
  }

  private async userName(userId: string): Promise<string> {
    if (!userId) return "desconhecido";
    const cached = this.userNames.get(userId);
    if (cached) return cached;
    try {
      const res = await this.web!.users.info({ user: userId });
      const name = res.user?.profile?.display_name || res.user?.real_name || res.user?.name || userId;
      this.userNames.set(userId, name);
      return name;
    } catch {
      return userId;
    }
  }

  private async channelInfo(channelId: string): Promise<{ name: string; type: string }> {
    const cached = this.channelNames.get(channelId);
    if (cached) return cached;
    try {
      const res = await this.web!.conversations.info({ channel: channelId });
      const c = res.channel as { name?: string; is_im?: boolean; is_mpim?: boolean; is_group?: boolean } | undefined;
      const type = c?.is_im ? "im" : c?.is_mpim ? "mpim" : "channel";
      const info = { name: c?.name ? `#${c.name}` : channelId, type };
      this.channelNames.set(channelId, info);
      return info;
    } catch {
      return { name: channelId, type: "channel" };
    }
  }

  private async toCanonical(event: SlackMessageEvent): Promise<CanonicalEvent | null> {
    if (!event.channel || !event.ts) return null;
    if (event.subtype && event.subtype !== "thread_broadcast" && event.subtype !== "file_share") return null;
    if (event.bot_id) return null;
    const text = (event.text ?? "").trim();
    if (!text) return null;

    const channel = await this.channelInfo(event.channel);
    const isDirect = channel.type === "im";
    const senderName = await this.userName(event.user ?? "");
    const occurredMs = Number(event.ts.split(".")[0]) * 1000;
    const threadPart = event.thread_ts ?? `${event.channel}:${dayKeyInTz(new Date(occurredMs), config.brainTz)}`;

    return {
      channel: "slack",
      subchannel: isDirect ? "direct" : "group",
      account: this.teamId,
      external_id: `slack:${this.teamId}:${event.channel}:${event.ts}`,
      thread_key: `slack:${this.teamId}:${threadPart}`,
      occurred_at: new Date(occurredMs).toISOString(),
      participants: [{ name: senderName, handle: `slack:${event.user ?? "?"}`, role: "from" }],
      subject: isDirect ? `DM com ${senderName}` : channel.name,
      body_text: text,
      attachments: [],
    };
  }

  private async ingestEvent(event: SlackMessageEvent): Promise<void> {
    try {
      const canonical = await this.toCanonical(event);
      if (!canonical) return;
      const result = await emitCanonicalEvent(canonical);
      if (result === "emitted") {
        await incrMetric("events:slack");
        if (event.channel && event.ts) {
          await getRedis().hset(CURSOR_KEY, event.channel, event.ts).catch(() => {});
        }
      }
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
    }
  }

  private async catchUp(): Promise<void> {
    const redis = getRedis();
    const cursors = (await redis.hgetall(CURSOR_KEY).catch(() => ({}))) as Record<string, string>;
    for (const [channel, oldest] of Object.entries(cursors)) {
      try {
        const res = await this.web!.conversations.history({ channel, oldest, limit: CATCHUP_LIMIT });
        const messages = (res.messages ?? []) as SlackMessageEvent[];
        for (const message of messages.reverse()) {
          if (message.ts === oldest) continue;
          await this.ingestEvent({ ...message, channel });
        }
      } catch {}
    }
  }

  socketAlive(): boolean {
    return this.socket?.websocket?.isActive() === true;
  }

  async ensureStarted(): Promise<void> {
    if (this.starting) return;
    if (this.connected && this.socketAlive()) return;
    if (!this.enabledByEnv()) throw new Error("SLACK_APP_TOKEN/SLACK_BOT_TOKEN ausentes");
    this.starting = true;
    try {
      await this.disposeSocket();
      this.web = new WebClient(config.slackBotToken);
      const auth = await this.web.auth.test();
      this.teamId = (auth.team_id as string | undefined) ?? "slack";

      const socket = new SocketModeClient({ appToken: config.slackAppToken });
      socket.on("message", (args: { event: SlackMessageEvent; ack: () => Promise<void> }) => {
        void (async () => {
          try {
            await args.ack();
            await this.ingestEvent(args.event);
          } catch (err) {
            this.lastError = err instanceof Error ? err.message : String(err);
          }
        })();
      });
      socket.on("connected", () => {
        this.connected = true;
        this.lastError = "";
      });
      socket.on("reconnecting", () => {
        this.connected = false;
      });
      socket.on("disconnected", () => {
        this.connected = false;
      });
      this.socket = socket;
      await socket.start();
      this.connected = true;
      this.lastError = "";
      await this.catchUp();
    } catch (err) {
      this.lastError = err instanceof Error ? err.message : String(err);
      this.connected = false;
      await this.disposeSocket();
      throw err;
    } finally {
      this.starting = false;
    }
  }

  private async disposeSocket(): Promise<void> {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    socket.removeAllListeners();
    await socket.disconnect().catch(() => {});
  }

  async stop(): Promise<void> {
    await this.disposeSocket();
    this.connected = false;
  }
}

export const slackManager = new SlackManager();

brainSchedulers.register({
  name: "slack",
  cadenceMs: (s) => s.cadences.slackMs,
  disabledReason: () => (slackManager.enabledByEnv() ? null : "SLACK_APP_TOKEN/SLACK_BOT_TOKEN ausentes"),
  run: async () => {
    await slackManager.ensureStarted();
    return slackManager.socketAlive()
      ? "socket conectado"
      : `erro:${slackManager.lastError || "socket sem conexão ativa"}`;
  },
});
