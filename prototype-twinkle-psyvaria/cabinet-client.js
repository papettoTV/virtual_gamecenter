export function createCabinetClient(handlers = {}) {
  let socket = null;
  let wantsCabinet = false;
  let reconnectTimer = null;

  function connect() {
    if (socket && socket.readyState <= WebSocket.OPEN) return;
    clearTimeout(reconnectTimer);
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(`${protocol}//${window.location.host}/api/cabinets/cabinet-1/ws`);

    socket.addEventListener("open", () => {
      handlers.onConnectionChange?.(true);
      if (wantsCabinet) send({ type: "joinCabinet" });
    });
    socket.addEventListener("close", () => {
      socket = null;
      handlers.onConnectionChange?.(false);
      reconnectTimer = setTimeout(connect, 1000);
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

  function send(message) {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(message));
      return true;
    }
    connect();
    return false;
  }

  function join() {
    wantsCabinet = true;
    send({ type: "joinCabinet" });
  }

  function leave() {
    wantsCabinet = false;
    send({ type: "leaveCabinet" });
  }

  connect();

  return { join, leave, send };
}
