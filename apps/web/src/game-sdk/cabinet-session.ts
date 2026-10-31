import { ensurePlatformSession } from "../features/platform/platform-client";
import { createCabinetClient, type CabinetClient, type CabinetClientHandlers } from "../realtime/cabinet-client";
import type { CabinetRole, CabinetState } from "../domain/cabinet";
import type { ServerMessage } from "../shared/protocol";
import type { GameLifetime } from "./lifetime";

interface SessionOptions {
  gameId: string;
  lifetime?: GameLifetime;
  onConnectionChange?: (connected: boolean) => void;
  onMessage?: (message: ServerMessage) => void;
  onError?: (message: string) => void;
}
export interface CabinetSession extends CabinetClient {
  readonly role: CabinetRole;
  readonly state: CabinetState | null;
  readonly connected: boolean;
  waitForPlayer(timeoutMs?: number): Promise<boolean>;
  startSolo(reservationId: string): Promise<boolean>;
}

export function createCabinetSession(options: SessionOptions, createClient: (handlers: CabinetClientHandlers) => CabinetClient = createCabinetClient): CabinetSession {
  let role: CabinetRole = "visitor";
  let state: CabinetState | null = null;
  let connected = false;
  const waiters = new Set<(ready: boolean) => void>();
  let soloPending: { reservationId: string; resolve: (ready: boolean) => void } | null = null;
  const finishWaiting = (ready: boolean) => { for (const resolve of [...waiters]) resolve(ready); };
  const client = createClient({
    onConnectionChange(value) {
      connected = value;
      if (!value) { role = "visitor"; finishWaiting(false); soloPending?.resolve(false); }
      options.onConnectionChange?.(value);
    },
    onMessage(message) {
      if (message.type === "soloStarted" && message.reservationId === soloPending?.reservationId) soloPending?.resolve(true);
      if (message.type === "error") soloPending?.resolve(false);
      if (message.type === "joinedCabinet" || message.type === "roleChanged") {
        role = message.role;
        // A spectator acknowledgement from the initial watch join may still be
        // in flight when the player-seat request is sent on the same socket.
        if (role === "player") finishWaiting(true);
      }
      if (message.type === "cabinetState") state = message.state;
      options.onMessage?.(message);
    },
    onError: options.onError,
  });
  const session: CabinetSession = {
    get role() { return role; },
    get state() { return state; },
    get connected() { return connected; },
    join(cabinetId, gameId = options.gameId, watch = false) {
      finishWaiting(false);
      role = "visitor";
      state = null;
      connected = false;
      client.join(cabinetId, gameId, watch);
    },
    leave() { role = "visitor"; state = null; connected = false; finishWaiting(false); soloPending?.resolve(false); client.leave(); },
    send: client.send,
    getBufferedAmount: client.getBufferedAmount,
    startSolo(reservationId) {
      if (soloPending || role !== "player") return Promise.resolve(false);
      return new Promise(resolve => {
        const timer = window.setTimeout(() => complete(false), 5000);
        const complete = (ready: boolean) => { window.clearTimeout(timer); soloPending = null; resolve(ready); };
        soloPending = { reservationId, resolve: complete };
        if (!client.send({ type: "startSolo", reservationId })) complete(false);
      });
    },
    waitForPlayer(timeoutMs = 5000) {
      if (role === "player") return Promise.resolve(true);
      return new Promise(resolve => {
        let timer: number | undefined;
        const complete = (ready: boolean) => { window.clearTimeout(timer); waiters.delete(complete); resolve(ready); };
        waiters.add(complete);
        // The admission timeout measures server participation, not guest creation.
        void ensurePlatformSession().then(() => {
          if (waiters.has(complete)) timer = window.setTimeout(() => complete(false), timeoutMs);
        }, () => complete(false));
      });
    },
  };
  options.lifetime?.own(() => session.leave());
  return session;
}
