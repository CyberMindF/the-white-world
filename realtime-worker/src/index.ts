import { DurableObject } from "cloudflare:workers";

type ConnectionAttachment = {
  userId: string;
  identity: "lui" | "lei";
  isTest: boolean;
  observer?: boolean;
  path: string;
  visible: boolean;
  activeAt: number;
};

type RealtimeEvent = {
  type: string;
  occurredAt: string;
  [key: string]: unknown;
};

export class RealtimeRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket upgrade required.", { status: 426 });
    }

    const userId = request.headers.get("X-Realtime-User-Id");
    const identity = request.headers.get("X-Realtime-Identity");
    if (!userId || (identity !== "lui" && identity !== "lei")) {
      return new Response("Missing authenticated connection context.", { status: 401 });
    }

    const url = new URL(request.url);
    const now = Date.now();
    const isTest = request.headers.get("X-Realtime-Is-Test") === "true";
    const observer = request.headers.get("X-Realtime-Observer") === "true";
    const path = normalizePath(url.searchParams.get("path"));
    const visible = url.searchParams.get("visible") === "true";

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    const attachment: ConnectionAttachment = { userId, identity, isTest, observer, path, visible, activeAt: now };

    this.ctx.acceptWebSocket(server);
    server.serializeAttachment(attachment);

    if (visible) await this.saveLastSeen(attachment, now);
    server.send(JSON.stringify(await this.presenceEvent(otherIdentity(identity), isTest)));
    if (!observer) await this.broadcastPresence(identity, isTest);

    return new Response(null, { status: 101, webSocket: client });
  }

  async broadcast(event: RealtimeEvent): Promise<number> {
    if (!isRealtimeEvent(event)) {
      throw new TypeError("Invalid realtime event.");
    }

    const message = JSON.stringify(event);
    let delivered = 0;

    for (const socket of this.ctx.getWebSockets()) {
      try {
        socket.send(message);
        delivered += 1;
      } catch (error) {
        console.error(JSON.stringify({
          event: "realtime_broadcast_error",
          message: error instanceof Error ? error.message : "Unknown WebSocket error"
        }));
      }
    }

    return delivered;
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    // Le scritture applicative restano REST; dal client accettiamo soltanto presenza e ping.
    if (message === "ping") {
      socket.send("pong");
      return;
    }

    if (typeof message !== "string") return;
    const payload = parsePresenceUpdate(message);
    if (!payload) return;

    const previous = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (!previous || previous.observer) return;
    const now = Date.now();
    const attachment: ConnectionAttachment = {
      ...previous,
      path: payload.path,
      visible: payload.visible,
      activeAt: now
    };
    socket.serializeAttachment(attachment);
    await this.saveLastSeen(attachment, now);
    await this.broadcastPresence(attachment.identity, attachment.isTest);
  }

  async webSocketClose(socket: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const attachment = socket.deserializeAttachment() as ConnectionAttachment | null;
    if (attachment && !attachment.observer) {
      await this.saveLastSeen(attachment, Date.now());
    }
    socket.close(code, reason);
    if (attachment && !attachment.observer) await this.broadcastPresence(attachment.identity, attachment.isTest, socket);
    console.log(JSON.stringify({ event: "realtime_socket_closed", code, reason, wasClean }));
  }

  webSocketError(_socket: WebSocket, error: unknown): void {
    console.error(JSON.stringify({
      event: "realtime_socket_error",
      message: error instanceof Error ? error.message : "Unknown WebSocket error"
    }));
  }

  private async saveLastSeen(attachment: ConnectionAttachment, timestamp: number): Promise<void> {
    if (attachment.observer) return;
    await this.ctx.storage.put(lastSeenKey(attachment.identity, attachment.isTest), new Date(timestamp).toISOString());
  }

  private async presenceEvent(identity: "lui" | "lei", isTest: boolean, excluded?: WebSocket): Promise<RealtimeEvent> {
    const activeSockets = this.ctx.getWebSockets()
      .filter((socket) => socket !== excluded && socket.readyState === 1)
      .map((socket) => socket.deserializeAttachment() as ConnectionAttachment | null)
      .filter((attachment): attachment is ConnectionAttachment => Boolean(
        attachment
        && !attachment.observer
        && attachment.identity === identity
        && attachment.isTest === isTest
        && attachment.visible
      ))
      .sort((a, b) => b.activeAt - a.activeAt);
    const lastSeen = await this.ctx.storage.get<string>(lastSeenKey(identity, isTest));

    return {
      type: "presence:changed",
      occurredAt: new Date().toISOString(),
      identity,
      isTest,
      online: activeSockets.length > 0,
      path: activeSockets[0]?.path ?? null,
      lastSeen: lastSeen ?? null
    };
  }

  private async broadcastPresence(identity: "lui" | "lei", isTest: boolean, excluded?: WebSocket): Promise<void> {
    const message = JSON.stringify(await this.presenceEvent(identity, isTest, excluded));
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      try {
        socket.send(message);
      } catch (error) {
        console.error(JSON.stringify({
          event: "realtime_presence_broadcast_error",
          message: error instanceof Error ? error.message : "Unknown realtime error"
        }));
      }
    }
  }
}

function normalizePath(value: string | null): string {
  return value?.startsWith("/") ? value.slice(0, 200) : "/";
}

function otherIdentity(identity: "lui" | "lei"): "lui" | "lei" {
  return identity === "lui" ? "lei" : "lui";
}

function lastSeenKey(identity: "lui" | "lei", isTest: boolean): string {
  return `presence:last-seen:${isTest ? "test" : "main"}:${identity}`;
}

function parsePresenceUpdate(message: string): { path: string; visible: boolean } | null {
  try {
    const value: unknown = JSON.parse(message);
    if (!value || typeof value !== "object") return null;
    const candidate = value as Record<string, unknown>;
    if (candidate["type"] !== "presence:update" || typeof candidate["visible"] !== "boolean") return null;
    return { path: normalizePath(typeof candidate["path"] === "string" ? candidate["path"] : null), visible: candidate["visible"] };
  } catch {
    return null;
  }
}

function isRealtimeEvent(value: unknown): value is RealtimeEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate["type"] === "string"
    && candidate["type"].length > 0
    && typeof candidate["occurredAt"] === "string";
}

export default {
  fetch(): Response {
    // Il Worker non espone un endpoint pubblico: Pages accede direttamente al namespace DO.
    return new Response("Not found.", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
