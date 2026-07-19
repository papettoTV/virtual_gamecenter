import { randomUUID } from "node:crypto";
import { defineConfig } from "vite";
import { WebSocket, WebSocketServer } from "ws";

const CABINET_PATH = "/api/cabinets/cabinet-1/ws";

function localCabinetServer() {
  return {
    name: "local-cabinet-server",
    configureServer(server) {
      const clients = new Map();
      let playerSocket = null;
      let status = "empty";

      const webSocketServer = new WebSocketServer({ noServer: true });

      function cabinetState() {
        const spectators = [...clients.values()].filter((client) => client.role === "spectator").length;
        return {
          cabinetId: "cabinet-1",
          gameId: "graze-duel",
          status,
          freePlay: true,
          playerCount: playerSocket ? 1 : 0,
          spectatorCount: spectators,
          updatedAt: Date.now(),
        };
      }

      function send(socket, message) {
        if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
      }

      function broadcast(message, predicate = () => true) {
        for (const [socket, client] of clients) {
          if (predicate(client)) send(socket, message);
        }
      }

      function broadcastState() {
        broadcast({ type: "cabinetState", state: cabinetState() });
      }

      function leaveCabinet(socket) {
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

      webSocketServer.on("connection", (socket) => {
        const client = { id: randomUUID(), role: "visitor" };
        clients.set(socket, client);
        send(socket, { type: "connected", clientId: client.id });
        send(socket, { type: "cabinetState", state: cabinetState() });

        socket.on("message", (rawMessage) => {
          let message;
          try {
            message = JSON.parse(rawMessage.toString());
          } catch {
            send(socket, { type: "error", message: "メッセージを読み取れませんでした。" });
            return;
          }

          if (message.type === "joinCabinet") {
            if (client.role !== "visitor") leaveCabinet(socket);
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

          if (message.type === "leaveCabinet") leaveCabinet(socket);
        });

        socket.on("close", () => {
          leaveCabinet(socket);
          clients.delete(socket);
          broadcastState();
        });
      });

      server.httpServer?.on("upgrade", (request, socket, head) => {
        const requestUrl = new URL(request.url ?? "/", "http://localhost");
        if (requestUrl.pathname !== CABINET_PATH) return;
        webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
          webSocketServer.emit("connection", webSocket, request);
        });
      });

      server.httpServer?.on("close", () => webSocketServer.close());
    },
  };
}

export default defineConfig({
  plugins: [localCabinetServer()],
});
