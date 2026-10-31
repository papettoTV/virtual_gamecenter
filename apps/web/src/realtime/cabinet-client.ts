import { ensurePlatformSession } from "../features/platform/platform-client";
import type { ClientMessage, ServerMessage } from "../shared/protocol";
import { publishCabinetPresence } from "./cabinet-presence";

export interface CabinetClientHandlers {
  onConnectionChange?: (connected: boolean) => void;
  onMessage?: (message: ServerMessage) => void;
  onError?: (message: string) => void;
}

export interface CabinetClient {
  join(cabinetId: string, gameId: string, watch?: boolean): void;
  leave(): void;
  send(message: ClientMessage | Record<string, unknown>): boolean;
  getBufferedAmount(): number;
}

export function createCabinetClient(handlers: CabinetClientHandlers = {}): CabinetClient {
  if (window.location.protocol === "file:") {
    window.location.replace("http://localhost:5174/");
    return { join() {}, leave() {}, send() { return false; }, getBufferedAmount() { return 0; } };
  }

  let socket: WebSocket | null = null;
  let cabinetId: string | null = null;
  let gameId: string | null = null;
  let wantsCabinet = false;
  let watch = false;
  let reconnectTimer: number | null = null;
  let reconnectAttempts = 0;
  function scheduleReconnect() {
    const delay = Math.min(1000 * 2 ** reconnectAttempts++, 30_000);
    reconnectTimer = window.setTimeout(connect, delay);
  }

  let generation = 0;
  let connecting = false;
  async function connect() {
    if (!wantsCabinet || connecting || !cabinetId || (socket && socket.readyState <= WebSocket.OPEN)) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const attempt = generation;
    connecting = true;
    try {
      await ensurePlatformSession();
    } catch {
      if (attempt === generation) {
        handlers.onConnectionChange?.(false);
        handlers.onError?.("プレイヤー情報を初期化できませんでした。");
      }
      return;
    } finally {
      if (attempt === generation) connecting = false;
    }
    if (attempt !== generation || !wantsCabinet || !cabinetId) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    try {
      socket = new WebSocket(
        `${protocol}//${window.location.host}/api/cabinets/${cabinetId}/ws?gameId=${encodeURIComponent(gameId ?? "")}`,
      );
    } catch {
      socket = null;
      handlers.onConnectionChange?.(false);
      scheduleReconnect();
      return;
    }

    const connection = socket;
    connection.addEventListener("open", () => {
      if (socket !== connection) return;
      reconnectAttempts = 0;
      handlers.onConnectionChange?.(true);
      if (wantsCabinet && gameId) send({ type: "joinCabinet", gameId, watch });
    });
    connection.addEventListener("close", event => {
      if (socket !== connection) return;
      socket = null;
      handlers.onConnectionChange?.(false);
      if ([1008, 1009, 1003].includes(event.code)) wantsCabinet = false;
      if (wantsCabinet) scheduleReconnect();
    });
    connection.addEventListener("error", () => { if (socket === connection) handlers.onConnectionChange?.(false); });
    connection.addEventListener("message", (event) => {
      if (socket !== connection) return;
      try {
        const message = JSON.parse(event.data) as ServerMessage;
        if ((message.type === "soloStarted" || message.type === "versusCountdown") && message.startReceipt
          && typeof message.startReceipt.attemptId === "string" && message.startReceipt.attemptId.length > 0 && message.startReceipt.attemptId.length <= 64
          && typeof message.startReceipt.token === "string" && message.startReceipt.token.length > 0 && message.startReceipt.token.length <= 64) {
          try { connection.send(JSON.stringify({ type: "startReceipt", attemptId: message.startReceipt.attemptId, token: message.startReceipt.token })); }
          catch {}
        }
        handlers.onMessage?.(message);
        if (cabinetId && gameId && (message.type === "cabinetState" || message.type === "playerLeft")) {
          publishCabinetPresence({ cabinetId, gameId, playerCount: message.type === "cabinetState" ? message.state.playerCount : 0 });
        }
      } catch {
        handlers.onError?.("筐体サーバーからの応答を読み取れませんでした。");
      }
    });
  }

  function send(message: ClientMessage | Record<string, unknown>) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    connect();
    return false;
  }

  function join(nextCabinetId: string, nextGameId: string, asViewer = false) {
    const params = new URLSearchParams(window.location.search);
    watch = asViewer || params.get("watch") === "1";
    if (cabinetId !== nextCabinetId || gameId !== nextGameId) {
      generation++;
      connecting = false;
      wantsCabinet = false;
      socket?.close();
      socket = null;
      cabinetId = nextCabinetId;
      gameId = nextGameId;
    }
    wantsCabinet = true;
    send({ type: "joinCabinet", gameId: nextGameId, watch });
  }

  function leave() {
    generation++;
    connecting = false;
    wantsCabinet = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leaveCabinet" }));
    socket?.close();
    socket = null;
    cabinetId = null;
    gameId = null;
    handlers.onConnectionChange?.(false);
  }

  function getBufferedAmount() {
    return socket?.bufferedAmount ?? 0;
  }

  return { join, leave, send, getBufferedAmount };
}
