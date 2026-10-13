import type { ClientMessage, ServerMessage } from "../shared/protocol";

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

  function connect() {
    if (!cabinetId || (socket && socket.readyState <= WebSocket.OPEN)) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
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
        handlers.onMessage?.(JSON.parse(event.data));
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
    watch = asViewer;
    if (cabinetId !== nextCabinetId || gameId !== nextGameId) {
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
