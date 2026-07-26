import { DurableObject } from "cloudflare:workers";
import {
  assignCabinetRole,
  createCabinetState,
  reduceCabinetState,
  type CabinetRole,
  type CabinetState,
} from "../domain/cabinet";
import type {
  ClientMessage,
  GameEvent,
  ServerMessage,
} from "../shared/protocol";

interface ConnectionAttachment {
  clientId: string;
  role: CabinetRole;
}

export class CabinetRoom extends DurableObject<Env> {
  private cabinetId = "";
  private state: CabinetState = createCabinetState("");
  private latestKeyframe: Extract<ServerMessage, { type: "viewerKeyframe" }> | null = null;
  private latestMotionFrame: Extract<ServerMessage, { type: "viewerMotionFrame" }> | null = null;
  private eventsSinceKeyframe: Array<Extract<ServerMessage, { type: "viewerEvents" }>> = [];
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<{ cabinetId: string; state: CabinetState }>("cabinet");
      if (stored) {
        this.cabinetId = stored.cabinetId;
        this.state = stored.state;
      }
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    if (request.headers.get("Upgrade") !== "websocket") {
      return new Response("Expected WebSocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);
    this.cabinetId = url.pathname.split("/").at(-2) ?? this.cabinetId;
    if (!this.state.cabinetId) this.state = createCabinetState(this.cabinetId);

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    const attachment: ConnectionAttachment = {
      clientId: crypto.randomUUID(),
      role: "visitor",
    };
    server.serializeAttachment(attachment);
    this.send(server, { type: "connected", clientId: attachment.clientId });
    this.send(server, { type: "cabinetState", state: this.state });
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(socket: WebSocket, rawMessage: string | ArrayBuffer): Promise<void> {
    await this.ready;
    if (typeof rawMessage !== "string") {
      this.send(socket, { type: "error", message: "テキストメッセージのみ利用できます。" });
      return;
    }

    let message: ClientMessage;
    try {
      message = JSON.parse(rawMessage) as ClientMessage;
    } catch {
      this.send(socket, { type: "error", message: "メッセージを読み取れませんでした。" });
      return;
    }

    if (message.type === "joinCabinet") {
      await this.join(socket);
      return;
    }
    if (message.type === "leaveCabinet") {
      await this.leave(socket);
      return;
    }

    const attachment = this.attachment(socket);
    if (attachment.role !== "player") return;

    if (message.type === "startSolo") {
      this.state = reduceCabinetState(this.state, { type: "START_SOLO" });
      await this.persistState();
      this.broadcastState();
      return;
    }
    if (message.type === "stopSolo") {
      this.state = reduceCabinetState(this.state, { type: "STOP_SOLO" });
      await this.persistState();
      this.broadcastState();
      return;
    }
    if (message.type === "gameKeyframe") {
      this.latestKeyframe = {
        type: "viewerKeyframe",
        snapshot: message.snapshot,
        seq: message.seq,
      };
      this.eventsSinceKeyframe = [];
      this.broadcast(this.latestKeyframe, "spectator");
      return;
    }
    if (message.type === "gameEvents") {
      const viewerEvents: Extract<ServerMessage, { type: "viewerEvents" }> = {
        type: "viewerEvents",
        events: message.events as GameEvent[],
        seq: message.seq,
      };
      this.eventsSinceKeyframe.push(viewerEvents);
      if (this.eventsSinceKeyframe.length > 100) this.eventsSinceKeyframe.shift();
      this.broadcast(viewerEvents, "spectator");
      return;
    }
    if (message.type === "gameMotionFrame") {
      this.latestMotionFrame = {
        type: "viewerMotionFrame",
        frame: message.frame,
        seq: message.seq,
      };
      this.broadcast(this.latestMotionFrame, "spectator");
    }
  }

  async webSocketClose(socket: WebSocket): Promise<void> {
    await this.ready;
    await this.leave(socket, false);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.ready;
    await this.leave(socket, false);
  }

  private async join(socket: WebSocket): Promise<void> {
    const current = this.attachment(socket);
    if (current.role !== "visitor") await this.leave(socket, false);

    const role = assignCabinetRole(this.state);
    socket.serializeAttachment({ ...current, role } satisfies ConnectionAttachment);
    this.state = reduceCabinetState(
      this.state,
      role === "player" ? { type: "PLAYER_JOINED" } : { type: "SPECTATOR_JOINED" },
    );
    await this.persistState();

    this.send(socket, { type: "joinedCabinet", clientId: current.clientId, role });
    if (role === "spectator") this.replayCurrentGame(socket);
    this.broadcastState();
  }

  private async leave(socket: WebSocket, keepConnection = true): Promise<void> {
    const attachment = this.attachment(socket);
    if (attachment.role === "visitor") return;

    if (attachment.role === "player") {
      this.state = reduceCabinetState(this.state, { type: "PLAYER_LEFT" });
      this.latestKeyframe = null;
      this.latestMotionFrame = null;
      this.eventsSinceKeyframe = [];
      this.broadcast({ type: "playerLeft" }, "spectator");
    } else {
      this.state = reduceCabinetState(this.state, { type: "SPECTATOR_LEFT" });
    }

    if (keepConnection) {
      socket.serializeAttachment({ ...attachment, role: "visitor" } satisfies ConnectionAttachment);
    }
    await this.persistState();
    this.broadcastState();
  }

  private replayCurrentGame(socket: WebSocket): void {
    const messages = [
      this.latestKeyframe,
      ...this.eventsSinceKeyframe,
      this.latestMotionFrame,
    ]
      .filter((message): message is NonNullable<typeof message> => Boolean(message))
      .sort((left, right) => left.seq - right.seq);
    for (const message of messages) this.send(socket, message);
  }

  private broadcast(message: ServerMessage, role?: CabinetRole): void {
    for (const socket of this.ctx.getWebSockets()) {
      if (role && this.attachment(socket).role !== role) continue;
      this.send(socket, message);
    }
  }

  private broadcastState(): void {
    this.broadcast({ type: "cabinetState", state: this.state });
  }

  private send(socket: WebSocket, message: ServerMessage): void {
    if (
      (message.type === "viewerMotionFrame" || message.type === "viewerKeyframe")
      && socket.bufferedAmount > 512 * 1024
    ) {
      return;
    }
    socket.send(JSON.stringify(message));
  }

  private attachment(socket: WebSocket): ConnectionAttachment {
    return socket.deserializeAttachment() as ConnectionAttachment;
  }

  private async persistState(): Promise<void> {
    await this.ctx.storage.put("cabinet", {
      cabinetId: this.cabinetId,
      state: this.state,
    });
  }
}
