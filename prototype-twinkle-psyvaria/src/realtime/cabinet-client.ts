import type { ClientMessage, ServerMessage } from "../shared/protocol";

interface CabinetClientHandlers {
  onConnectionChange?: (connected: boolean) => void;
  onMessage?: (message: ServerMessage) => void;
  onError?: (message: string) => void;
}

export interface CabinetClient {
  join(cabinetId: string): void;
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
  let wantsCabinet = false;
  let reconnectTimer: number | null = null;

  function connect() {
    if (!cabinetId || (socket && socket.readyState <= WebSocket.OPEN)) return;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    try {
      socket = new WebSocket(`${protocol}//${window.location.host}/api/cabinets/${cabinetId}/ws`);
    } catch {
      socket = null;
      handlers.onConnectionChange?.(false);
      reconnectTimer = window.setTimeout(connect, 1000);
      return;
    }

    socket.addEventListener("open", () => {
      handlers.onConnectionChange?.(true);
      if (wantsCabinet) send({ type: "joinCabinet" });
    });
    socket.addEventListener("close", () => {
      socket = null;
      handlers.onConnectionChange?.(false);
      if (wantsCabinet) reconnectTimer = window.setTimeout(connect, 1000);
    });
    socket.addEventListener("error", () => handlers.onConnectionChange?.(false));
    socket.addEventListener("message", (event) => {
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

  function join(nextCabinetId: string) {
    if (cabinetId !== nextCabinetId) {
      wantsCabinet = false;
      socket?.close();
      socket = null;
      cabinetId = nextCabinetId;
    }
    wantsCabinet = true;
    send({ type: "joinCabinet" });
  }

  function leave() {
    wantsCabinet = false;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "leaveCabinet" }));
    socket?.close();
    socket = null;
    cabinetId = null;
    handlers.onConnectionChange?.(false);
  }

  function getBufferedAmount() {
    return socket?.bufferedAmount ?? 0;
  }

  return { join, leave, send, getBufferedAmount };
}
