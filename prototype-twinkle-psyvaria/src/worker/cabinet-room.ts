import { DurableObject } from "cloudflare:workers";
import {
  assignCabinetRole,
  createCabinetState,
  reduceCabinetState,
  type CabinetRole,
  type CabinetState,
} from "../domain/cabinet";
import {
  enqueueChallenge,
  getChallengePosition,
  MAX_CHALLENGE_QUEUE_SIZE,
  removeChallenge,
  type ChallengeQueueEntry,
} from "../domain/challenge-queue";
import { syncCabinetDirectory } from "./cabinet-directory";
import { releaseCreditReservationForCabinet } from "./credit-reservations";
import type {
  ClientMessage,
  GameEvent,
  ServerMessage,
  VersusSeat,
  VersusTerminalReport,
} from "../shared/protocol";

interface ConnectionAttachment {
  clientId: string;
  role: CabinetRole;
}

interface PendingChallenge {
  challengerClientId: string;
  reservationId: string;
}

interface VersusMatch {
  id: string;
  hostClientId: string;
  challengerClientId: string;
  challengerReservationId: string;
  hostReady: boolean;
  challengerReady: boolean;
  hostReport: VersusTerminalReport | null;
  challengerReport: VersusTerminalReport | null;
  winner: VersusSeat | "draw" | null;
  resultReason: string;
  rematchRequesterClientId: string | null;
  rematchReservationId: string | null;
}

interface StoredCabinetRoom {
  cabinetId: string;
  state: CabinetState;
  pendingChallenge: PendingChallenge | null;
  challengeQueue: ChallengeQueueEntry[];
  versusMatch: VersusMatch | null;
}

export class CabinetRoom extends DurableObject<Env> {
  private cabinetId = "";
  private state: CabinetState = createCabinetState("");
  private latestKeyframe: Extract<ServerMessage, { type: "viewerKeyframe" }> | null = null;
  private latestMotionFrame: Extract<ServerMessage, { type: "viewerMotionFrame" }> | null = null;
  private eventsSinceKeyframe: Array<Extract<ServerMessage, { type: "viewerEvents" }>> = [];
  private pendingChallenge: PendingChallenge | null = null;
  private challengeQueue: ChallengeQueueEntry[] = [];
  private versusMatch: VersusMatch | null = null;
  private readonly ready: Promise<void>;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ready = this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<StoredCabinetRoom>("cabinet");
      if (stored) {
        this.cabinetId = stored.cabinetId;
        this.state = stored.state;
        this.state.challengeQueueCount = stored.challengeQueue?.length ?? 0;
        this.pendingChallenge = stored.pendingChallenge ?? null;
        this.challengeQueue = stored.challengeQueue ?? [];
        this.versusMatch = stored.versusMatch ?? null;
        const missingChallenge = this.state.status === "challengePending" && !this.pendingChallenge;
        const missingMatch = ["versusReady", "versusPlaying", "result"].includes(this.state.status) && !this.versusMatch;
        if (missingChallenge || missingMatch) {
          this.state = {
            ...this.state,
            status: this.state.playerCount > 0 ? "occupied" : "empty",
            readyCount: 0,
          };
        }
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
    if (message.type === "requestChallenge") {
      await this.requestChallenge(socket, attachment, message.reservationId);
      return;
    }
    if (message.type === "cancelChallenge") {
      await this.cancelChallenge(attachment, "申込をキャンセルしました。");
      return;
    }
    if (message.type === "respondChallenge") {
      await this.respondChallenge(attachment, message.accept);
      return;
    }
    if (message.type === "versusReady") {
      await this.markVersusReady(attachment, message.matchId);
      return;
    }
    if (message.type === "versusProgress") {
      this.relayVersusProgress(attachment, message);
      return;
    }
    if (message.type === "versusAttack") {
      this.relayVersusAttack(attachment, message);
      return;
    }
    if (message.type === "versusTerminal") {
      await this.handleVersusTerminal(attachment, message.matchId, message.report);
      return;
    }
    if (message.type === "requestRematch") {
      await this.requestRematch(attachment, message.matchId, message.reservationId);
      return;
    }
    if (message.type === "respondRematch") {
      await this.respondRematch(attachment, message.matchId, message.accept);
      return;
    }
    if (message.type === "declineRematch") {
      await this.declineRematch(attachment, message.matchId);
      return;
    }

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
    await this.leave(socket);
  }

  async webSocketError(socket: WebSocket): Promise<void> {
    await this.ready;
    await this.leave(socket);
  }

  private async requestChallenge(
    socket: WebSocket,
    attachment: ConnectionAttachment,
    reservationId: string,
  ): Promise<void> {
    const alreadyApplied =
      this.pendingChallenge?.challengerClientId === attachment.clientId
      || this.challengeQueue.some((entry) => entry.clientId === attachment.clientId)
      || Boolean(this.getMatchSeat(attachment.clientId));
    const challengeOpen = [
      "soloPlaying",
      "challengePending",
      "versusReady",
      "versusPlaying",
      "result",
    ].includes(this.state.status);
    if (attachment.role !== "spectator" || !challengeOpen || alreadyApplied) {
      await this.releaseReservation(reservationId);
      this.send(socket, { type: "challengeRejected", reservationId, reason: "現在は対戦を申し込めません。" });
      return;
    }
    const hostSocket = this.findSocketByRole("player");
    if (!hostSocket) {
      await this.releaseReservation(reservationId);
      this.send(socket, { type: "challengeRejected", reservationId, reason: "プレイヤーが見つかりません。" });
      return;
    }

    if (!this.pendingChallenge && !this.versusMatch && this.state.status === "soloPlaying") {
      this.pendingChallenge = {
        challengerClientId: attachment.clientId,
        reservationId,
      };
      this.state = reduceCabinetState(this.state, { type: "CHALLENGE_REQUESTED" });
      this.send(socket, { type: "challengePending", reservationId });
      this.send(hostSocket, { type: "challengeReceived" });
    } else {
      const nextQueue = enqueueChallenge(this.challengeQueue, {
        clientId: attachment.clientId,
        reservationId,
        createdAt: Date.now(),
      });
      if (!nextQueue) {
        await this.releaseReservation(reservationId);
        this.send(socket, {
          type: "challengeRejected",
          reservationId,
          reason: "対戦申し込み待ちは5人で満員です。",
        });
        return;
      }
      this.challengeQueue = nextQueue;
      this.syncQueueCount();
      this.send(socket, {
        type: "challengeQueued",
        reservationId,
        position: this.challengeQueue.length,
        waitingCount: this.challengeQueue.length,
      });
    }
    await this.persistState();
    this.broadcastState();
  }

  private async cancelChallenge(
    attachment: ConnectionAttachment,
    reason: string,
  ): Promise<void> {
    const challenge = this.pendingChallenge;
    if (challenge?.challengerClientId === attachment.clientId) {
      this.sendToClient(challenge.challengerClientId, {
        type: "challengeRejected",
        reservationId: challenge.reservationId,
        reason,
      });
      await this.releaseReservation(challenge.reservationId);
      this.pendingChallenge = null;
      this.state = reduceCabinetState(this.state, { type: "CHALLENGE_CANCELLED" });
      await this.promoteNextChallenge();
      await this.persistState();
      this.broadcastState();
      return;
    }

    const removal = removeChallenge(this.challengeQueue, attachment.clientId);
    if (!removal.removed) return;
    this.challengeQueue = removal.queue;
    this.syncQueueCount();
    this.sendToClient(attachment.clientId, {
      type: "challengeRejected",
      reservationId: removal.removed.reservationId,
      reason,
    });
    await this.releaseReservation(removal.removed.reservationId);
    await this.persistState();
    this.broadcastState();
  }

  private async respondChallenge(
    attachment: ConnectionAttachment,
    accept: boolean,
  ): Promise<void> {
    const challenge = this.pendingChallenge;
    if (!challenge || attachment.role !== "player") return;
    if (!accept) {
      this.sendToClient(challenge.challengerClientId, {
        type: "challengeRejected",
        reservationId: challenge.reservationId,
        reason: "対戦を拒否されました。",
      });
      await this.releaseReservation(challenge.reservationId);
      this.pendingChallenge = null;
      this.state = reduceCabinetState(this.state, { type: "CHALLENGE_CANCELLED" });
      await this.promoteNextChallenge();
      await this.persistState();
      this.broadcastState();
      return;
    }

    const matchId = crypto.randomUUID();
    this.versusMatch = {
      id: matchId,
      hostClientId: attachment.clientId,
      challengerClientId: challenge.challengerClientId,
      challengerReservationId: challenge.reservationId,
      hostReady: false,
      challengerReady: false,
      hostReport: null,
      challengerReport: null,
      winner: null,
      resultReason: "",
      rematchRequesterClientId: null,
      rematchReservationId: null,
    };
    this.pendingChallenge = null;
    this.state = reduceCabinetState(this.state, { type: "CHALLENGE_ACCEPTED" });
    await this.persistState();
    this.sendToClient(attachment.clientId, {
      type: "challengeAccepted",
      matchId,
      seat: "host",
      reservationId: null,
    });
    this.sendToClient(challenge.challengerClientId, {
      type: "challengeAccepted",
      matchId,
      seat: "challenger",
      reservationId: challenge.reservationId,
    });
    this.broadcastState();
  }

  private async markVersusReady(
    attachment: ConnectionAttachment,
    matchId: string,
  ): Promise<void> {
    const match = this.versusMatch;
    if (!match || match.id !== matchId || this.state.status !== "versusReady") return;
    const seat = this.getMatchSeat(attachment.clientId);
    if (seat === "host") match.hostReady = true;
    if (seat === "challenger") match.challengerReady = true;
    if (!seat) return;

    const readyCount = Number(match.hostReady) + Number(match.challengerReady);
    this.state = reduceCabinetState(this.state, { type: "VERSUS_READY", readyCount });
    const readyState: ServerMessage = {
      type: "versusReadyState",
      matchId,
      hostReady: match.hostReady,
      challengerReady: match.challengerReady,
    };
    this.sendToMatch(readyState);
    if (readyCount === 2) {
      this.state = reduceCabinetState(this.state, { type: "VERSUS_STARTED" });
      this.sendToMatch({
        type: "versusCountdown",
        matchId,
        startsAt: Date.now() + 3000,
      });
    }
    await this.persistState();
    this.broadcastState();
  }

  private relayVersusProgress(
    attachment: ConnectionAttachment,
    message: Extract<ClientMessage, { type: "versusProgress" }>,
  ): void {
    const match = this.versusMatch;
    if (!match || match.id !== message.matchId || this.state.status !== "versusPlaying") return;
    const opponentId = this.getOpponentClientId(attachment.clientId);
    if (!opponentId) return;
    this.sendToClient(opponentId, {
      type: "versusOpponentProgress",
      matchId: message.matchId,
      seq: message.seq,
      progress: message.progress,
    });
  }

  private relayVersusAttack(
    attachment: ConnectionAttachment,
    message: Extract<ClientMessage, { type: "versusAttack" }>,
  ): void {
    const match = this.versusMatch;
    if (!match || match.id !== message.matchId || this.state.status !== "versusPlaying") return;
    const opponentId = this.getOpponentClientId(attachment.clientId);
    if (!opponentId) return;
    this.sendToClient(opponentId, {
      type: "versusAttack",
      matchId: message.matchId,
      attackId: message.attackId,
      level: message.level,
      bossAttack: message.bossAttack,
    });
  }

  private async handleVersusTerminal(
    attachment: ConnectionAttachment,
    matchId: string,
    report: VersusTerminalReport,
  ): Promise<void> {
    const match = this.versusMatch;
    if (!match || match.id !== matchId || this.state.status !== "versusPlaying") return;
    const seat = this.getMatchSeat(attachment.clientId);
    if (!seat) return;
    if (seat === "host") match.hostReport = report;
    else match.challengerReport = report;

    if (report.reason === "lifeLost" || report.reason === "disconnect") {
      this.completeVersusResult(
        seat === "host" ? "challenger" : "host",
        report.reason === "disconnect" ? "相手が切断しました。" : "相手が残機を失いました。",
      );
    } else {
      const opponentReport = seat === "host" ? match.challengerReport : match.hostReport;
      if (opponentReport?.reason === "cleared") {
        const winner = this.compareClearedReports(match.hostReport!, match.challengerReport!);
        this.completeVersusResult(winner, winner === "draw" ? "同点です。" : "両者クリア後のスコア差です。");
      } else {
        this.sendToMatch({ type: "versusClearWaiting", matchId });
      }
    }
    await this.persistState();
  }

  private async requestRematch(
    attachment: ConnectionAttachment,
    matchId: string,
    reservationId: string,
  ): Promise<void> {
    const match = this.versusMatch;
    if (!match || match.id !== matchId || this.state.status !== "result") {
      await this.releaseReservation(reservationId);
      return;
    }
    const loserId = this.getLoserClientId();
    const winnerId = this.getWinnerClientId();
    if (!loserId || !winnerId || attachment.clientId !== loserId || match.rematchReservationId) {
      await this.releaseReservation(reservationId);
      return;
    }
    match.rematchRequesterClientId = loserId;
    match.rematchReservationId = reservationId;
    this.sendToClient(winnerId, {
      type: "rematchRequested",
      matchId,
      deadline: Date.now() + 10000,
    });
    await this.persistState();
  }

  private async respondRematch(
    attachment: ConnectionAttachment,
    matchId: string,
    accept: boolean,
  ): Promise<void> {
    const match = this.versusMatch;
    if (!match || match.id !== matchId || attachment.clientId !== this.getWinnerClientId()) return;
    if (!match.rematchReservationId || !match.rematchRequesterClientId) return;
    if (!accept) {
      this.sendToClient(match.rematchRequesterClientId, {
        type: "rematchRejected",
        matchId,
        reservationId: match.rematchReservationId,
      });
      await this.endVersus("再挑戦を拒否しました。");
      return;
    }

    const requesterId = match.rematchRequesterClientId;
    const reservationId = match.rematchReservationId;
    match.hostReady = false;
    match.challengerReady = false;
    match.hostReport = null;
    match.challengerReport = null;
    match.winner = null;
    match.resultReason = "";
    match.rematchRequesterClientId = null;
    match.rematchReservationId = null;
    this.state = reduceCabinetState(this.state, { type: "CHALLENGE_ACCEPTED" });
    this.sendToClient(match.hostClientId, {
      type: "challengeAccepted",
      matchId,
      seat: "host",
      reservationId: requesterId === match.hostClientId ? reservationId : null,
    });
    this.sendToClient(match.challengerClientId, {
      type: "challengeAccepted",
      matchId,
      seat: "challenger",
      reservationId: requesterId === match.challengerClientId ? reservationId : null,
    });
    await this.persistState();
    this.broadcastState();
  }

  private async declineRematch(
    attachment: ConnectionAttachment,
    matchId: string,
  ): Promise<void> {
    const match = this.versusMatch;
    if (!match || match.id !== matchId) return;
    const canDecline =
      attachment.clientId === this.getLoserClientId()
      || (match.winner === "draw" && attachment.clientId === match.hostClientId);
    if (!canDecline) return;
    await this.endVersus("再挑戦しませんでした。");
  }

  private completeVersusResult(winner: VersusSeat | "draw", reason: string): void {
    const match = this.versusMatch;
    if (!match || this.state.status === "result") return;
    match.winner = winner;
    match.resultReason = reason;
    this.state = reduceCabinetState(this.state, { type: "VERSUS_RESULT" });
    this.sendToMatch({
      type: "versusResult",
      matchId: match.id,
      winner,
      reason,
      host: match.hostReport,
      challenger: match.challengerReport,
    });
    this.broadcastState();
  }

  private compareClearedReports(
    host: VersusTerminalReport,
    challenger: VersusTerminalReport,
  ): VersusSeat | "draw" {
    if (host.score !== challenger.score) return host.score > challenger.score ? "host" : "challenger";
    const hostTime = host.clearTimeMs ?? Number.POSITIVE_INFINITY;
    const challengerTime = challenger.clearTimeMs ?? Number.POSITIVE_INFINITY;
    if (hostTime !== challengerTime) return hostTime < challengerTime ? "host" : "challenger";
    return "draw";
  }

  private async endVersus(reason: string): Promise<void> {
    const match = this.versusMatch;
    if (!match) return;
    if (match.rematchReservationId) {
      await this.releaseReservation(match.rematchReservationId);
    }
    const winnerId = this.getWinnerClientId() ?? match.hostClientId;
    const loserId = winnerId === match.hostClientId ? match.challengerClientId : match.hostClientId;
    const winnerSocket = this.findSocketByClientId(winnerId);
    const loserSocket = this.findSocketByClientId(loserId);

    if (winnerSocket && this.attachment(winnerSocket).role !== "player") {
      winnerSocket.serializeAttachment({ ...this.attachment(winnerSocket), role: "player" } satisfies ConnectionAttachment);
      this.send(winnerSocket, { type: "roleChanged", role: "player" });
    }
    if (loserSocket && this.attachment(loserSocket).role !== "spectator") {
      loserSocket.serializeAttachment({ ...this.attachment(loserSocket), role: "spectator" } satisfies ConnectionAttachment);
      this.send(loserSocket, { type: "roleChanged", role: "spectator" });
    }

    if (winnerSocket) this.send(winnerSocket, { type: "versusEnded", matchId: match.id, nextRole: "player", reason });
    if (loserSocket) this.send(loserSocket, { type: "versusEnded", matchId: match.id, nextRole: "spectator", reason });
    this.versusMatch = null;
    this.state = reduceCabinetState(this.state, { type: "VERSUS_ENDED" });
    this.latestKeyframe = null;
    this.latestMotionFrame = null;
    this.eventsSinceKeyframe = [];
    await this.promoteNextChallenge();
    await this.persistState();
    this.broadcastState();
  }

  private async promoteNextChallenge(): Promise<void> {
    if (this.pendingChallenge || this.versusMatch || this.state.status !== "soloPlaying") return;
    while (this.challengeQueue.length > 0) {
      const nextChallenge = this.challengeQueue.shift()!;
      this.syncQueueCount();
      const challengerSocket = this.findSocketByClientId(nextChallenge.clientId);
      if (!challengerSocket) {
        await this.releaseReservation(nextChallenge.reservationId);
        continue;
      }
      const hostSocket = this.findSocketByRole("player");
      if (!hostSocket) {
        await this.releaseReservation(nextChallenge.reservationId);
        this.send(challengerSocket, {
          type: "challengeRejected",
          reservationId: nextChallenge.reservationId,
          reason: "プレイヤーが筐体を離れました。",
        });
        continue;
      }
      this.pendingChallenge = {
        challengerClientId: nextChallenge.clientId,
        reservationId: nextChallenge.reservationId,
      };
      this.state = reduceCabinetState(this.state, { type: "CHALLENGE_REQUESTED" });
      this.send(challengerSocket, {
        type: "challengePending",
        reservationId: nextChallenge.reservationId,
      });
      this.send(hostSocket, { type: "challengeReceived" });
      return;
    }
  }

  private syncQueueCount(): void {
    this.state = {
      ...this.state,
      challengeQueueCount: this.challengeQueue.length,
      updatedAt: Date.now(),
    };
  }

  private async releaseReservation(reservationId: string): Promise<void> {
    try {
      await releaseCreditReservationForCabinet(this.env.DB, reservationId, this.cabinetId);
    } catch (error) {
      console.error("Failed to release challenge reservation", reservationId, error);
    }
  }

  private getMatchSeat(clientId: string): VersusSeat | null {
    const match = this.versusMatch;
    if (!match) return null;
    if (clientId === match.hostClientId) return "host";
    if (clientId === match.challengerClientId) return "challenger";
    return null;
  }

  private getOpponentClientId(clientId: string): string | null {
    const match = this.versusMatch;
    if (!match) return null;
    if (clientId === match.hostClientId) return match.challengerClientId;
    if (clientId === match.challengerClientId) return match.hostClientId;
    return null;
  }

  private getWinnerClientId(): string | null {
    const match = this.versusMatch;
    if (!match || !match.winner || match.winner === "draw") return null;
    return match.winner === "host" ? match.hostClientId : match.challengerClientId;
  }

  private getLoserClientId(): string | null {
    const match = this.versusMatch;
    const winnerId = this.getWinnerClientId();
    if (!match || !winnerId) return null;
    return winnerId === match.hostClientId ? match.challengerClientId : match.hostClientId;
  }

  private async join(socket: WebSocket): Promise<void> {
    const current = this.attachment(socket);
    if (current.role !== "visitor") await this.leave(socket);

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

  private async leave(socket: WebSocket): Promise<void> {
    let attachment = this.attachment(socket);
    if (attachment.role === "visitor") return;

    if (this.pendingChallenge?.challengerClientId === attachment.clientId) {
      await this.releaseReservation(this.pendingChallenge.reservationId);
      this.pendingChallenge = null;
      this.state = reduceCabinetState(this.state, { type: "CHALLENGE_CANCELLED" });
      await this.promoteNextChallenge();
    } else if (this.pendingChallenge && attachment.role === "player") {
      this.sendToClient(this.pendingChallenge.challengerClientId, {
        type: "challengeRejected",
        reservationId: this.pendingChallenge.reservationId,
        reason: "プレイヤーが筐体を離れました。",
      });
      await this.releaseReservation(this.pendingChallenge.reservationId);
      this.pendingChallenge = null;
      this.state = reduceCabinetState(this.state, { type: "CHALLENGE_CANCELLED" });
    }

    const queuedRemoval = removeChallenge(this.challengeQueue, attachment.clientId);
    if (queuedRemoval.removed) {
      this.challengeQueue = queuedRemoval.queue;
      this.syncQueueCount();
      await this.releaseReservation(queuedRemoval.removed.reservationId);
    }

    if (this.getMatchSeat(attachment.clientId)) {
      const seat = this.getMatchSeat(attachment.clientId)!;
      const match = this.versusMatch!;
      if (seat === "host") {
        match.hostReport = { reason: "disconnect", score: 0, clearTimeMs: null, matchElapsedMs: 0 };
      } else {
        match.challengerReport = { reason: "disconnect", score: 0, clearTimeMs: null, matchElapsedMs: 0 };
      }
      this.completeVersusResult(seat === "host" ? "challenger" : "host", "相手が切断しました。");
      await this.endVersus("対戦相手が切断しました。");
      attachment = this.attachment(socket);
    }

    if (attachment.role === "player") {
      for (const queued of this.challengeQueue) {
        await this.releaseReservation(queued.reservationId);
      }
      this.challengeQueue = [];
      this.syncQueueCount();
      this.state = reduceCabinetState(this.state, { type: "PLAYER_LEFT" });
      this.latestKeyframe = null;
      this.latestMotionFrame = null;
      this.eventsSinceKeyframe = [];
      this.broadcast({ type: "playerLeft" }, "spectator");
    } else {
      this.state = reduceCabinetState(this.state, { type: "SPECTATOR_LEFT" });
    }

    socket.serializeAttachment({ ...attachment, role: "visitor" } satisfies ConnectionAttachment);
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
    this.broadcastChallengeQueueStatuses();
  }

  private broadcastChallengeQueueStatuses(): void {
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = this.attachment(socket);
      let status: "none" | "pending" | "queued" | "matched" = "none";
      if (this.pendingChallenge?.challengerClientId === attachment.clientId) status = "pending";
      else if (this.getChallengePosition(attachment.clientId)) status = "queued";
      else if (this.getMatchSeat(attachment.clientId)) status = "matched";
      this.send(socket, {
        type: "challengeQueueStatus",
        waitingCount: this.challengeQueue.length,
        capacity: MAX_CHALLENGE_QUEUE_SIZE,
        position: getChallengePosition(this.challengeQueue, attachment.clientId),
        status,
      });
    }
  }

  private getChallengePosition(clientId: string): number | null {
    return getChallengePosition(this.challengeQueue, clientId);
  }

  private sendToMatch(message: ServerMessage): void {
    const match = this.versusMatch;
    if (!match) return;
    this.sendToClient(match.hostClientId, message);
    this.sendToClient(match.challengerClientId, message);
  }

  private sendToClient(clientId: string, message: ServerMessage): void {
    const socket = this.findSocketByClientId(clientId);
    if (socket) this.send(socket, message);
  }

  private findSocketByClientId(clientId: string): WebSocket | null {
    for (const socket of this.ctx.getWebSockets()) {
      if (this.attachment(socket).clientId === clientId) return socket;
    }
    return null;
  }

  private findSocketByRole(role: CabinetRole): WebSocket | null {
    for (const socket of this.ctx.getWebSockets()) {
      if (this.attachment(socket).role === role) return socket;
    }
    return null;
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
      pendingChallenge: this.pendingChallenge,
      challengeQueue: this.challengeQueue,
      versusMatch: this.versusMatch,
    } satisfies StoredCabinetRoom);
    await syncCabinetDirectory(this.env.DB, this.state);
  }
}
