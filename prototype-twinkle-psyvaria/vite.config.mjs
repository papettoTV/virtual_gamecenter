import { randomUUID } from "node:crypto";
import { networkInterfaces } from "node:os";
import { defineConfig } from "vite";
import { WebSocket, WebSocketServer } from "ws";

const CABINET_SOCKET_PATH = /^\/api\/cabinets\/([a-zA-Z0-9-]+)\/ws$/;

function createCabinetRoom(cabinetId, send) {
  const clients = new Map();
  let playerSocket = null;
  let status = "empty";

  function state() {
    const spectatorCount = [...clients.values()].filter((client) => client.role === "spectator").length;
    return {
      cabinetId,
      gameId: "graze-duel",
      status,
      freePlay: true,
      playerCount: playerSocket ? 1 : 0,
      spectatorCount,
      updatedAt: Date.now(),
    };
  }

  function broadcast(message, predicate = () => true) {
    for (const [socket, client] of clients) {
      if (predicate(client)) send(socket, message);
    }
  }

  function broadcastState() {
    broadcast({ type: "cabinetState", state: state() });
  }

  function leave(socket) {
    const client = clients.get(socket);
    if (!client) return;
    if (socket === playerSocket) {
      playerSocket = null;
      status = "empty";
      broadcast({ type: "playerLeft" }, (target) => target.role === "spectator");
    }
    client.role = "visitor";
    broadcastState();
  }

  function connect(socket) {
    const client = { id: randomUUID(), role: "visitor" };
    clients.set(socket, client);
    send(socket, { type: "connected", clientId: client.id });
    send(socket, { type: "cabinetState", state: state() });

    socket.on("message", (rawMessage) => {
      let message;
      try {
        message = JSON.parse(rawMessage.toString());
      } catch {
        send(socket, { type: "error", message: "メッセージを読み取れませんでした。" });
        return;
      }

      if (message.type === "joinCabinet") {
        if (client.role !== "visitor") leave(socket);
        if (!playerSocket) {
          playerSocket = socket;
          client.role = "player";
          status = "occupied";
        } else {
          client.role = "spectator";
        }
        send(socket, { type: "joinedCabinet", clientId: client.id, role: client.role });
        broadcastState();
        return;
      }

      if (message.type === "startSolo" && socket === playerSocket) {
        status = "soloPlaying";
        broadcastState();
        return;
      }

      if (message.type === "gameSnapshot" && socket === playerSocket) {
        broadcast(
          { type: "viewerSnapshot", snapshot: message.snapshot, seq: message.seq },
          (target) => target.role === "spectator",
        );
        return;
      }

      if (message.type === "leaveCabinet") leave(socket);
    });

    socket.on("close", () => {
      leave(socket);
      clients.delete(socket);
      broadcastState();
    });
  }

  return {
    connect,
    isEmpty: () => clients.size === 0,
  };
}

function localCabinetServer() {
  return {
    name: "local-cabinet-server",
    configureServer(server) {
      const rooms = new Map();
      const webSocketServer = new WebSocketServer({ noServer: true });

      function send(socket, message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      }

      server.middlewares.use("/api/local-address", (_request, response) => {
        const addresses = Object.values(networkInterfaces()).flat();
        const lanAddress = addresses.find(
          (address) => address?.family === "IPv4" && !address.internal && !address.address.startsWith("169.254."),
        );
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ address: lanAddress?.address ?? "localhost", port: 5174 }));
      });

      webSocketServer.on("connection", (socket, request, cabinetId) => {
        let room = rooms.get(cabinetId);
        if (!room) {
          room = createCabinetRoom(cabinetId, send);
          rooms.set(cabinetId, room);
        }
        room.connect(socket);
        socket.on("close", () => {
          if (room.isEmpty()) rooms.delete(cabinetId);
        });
      });

      server.httpServer?.on("upgrade", (request, socket, head) => {
        const requestUrl = new URL(request.url ?? "/", "http://localhost");
        const pathMatch = requestUrl.pathname.match(CABINET_SOCKET_PATH);
        if (!pathMatch) return;
        const cabinetId = pathMatch[1];
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          webSocketServer.emit("connection", webSocket, request, cabinetId);
        });
      });

      server.httpServer?.on("close", () => webSocketServer.close());
    },
  };
}

export default defineConfig({
  plugins: [localCabinetServer()],
});
