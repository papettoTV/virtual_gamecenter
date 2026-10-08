import type { CabinetRole } from "../../../domain/cabinet";
import type { Engine } from "./MochiDuel";
import type { Side, Match } from "./core";

export const INPUT_GRACE = .3;
export type RemoteTap = { seq: number; turn: number; seconds: number; action?: "down" | "up" };
export type DuelFrame = { engine: Engine; turnStartedAt: number; sentAt: number; matchId: string | null; seq: number; streamId: string };
export interface DuelLink {
  role: CabinetRole;
  side: Side | null;
  connected: boolean;
  matchId: string | null;
  startsAt: number | null;
  startCost: number;
  latest: DuelFrame | null;
  inputs: RemoteTap[];
  now(): number;
  beforeSolo(): Promise<boolean>;
  soloEnded(): void;
  publish(engine: Engine, turnStartedAt: number): void;
  strike(turn: number, seconds: number, action?: "down" | "up"): void;
  finish(match: Match): void;
}

export function validRemoteTap(input: RemoteTap, turn: number, seconds: number, previousSeq: number): boolean {
  return (input.action === undefined || input.action === "down" || input.action === "up") && Number.isSafeInteger(input.seq) && input.seq > previousSeq && input.turn === turn
    && Number.isFinite(input.seconds) && input.seconds >= 0
    && input.seconds <= seconds + .08 && input.seconds >= seconds - INPUT_GRACE;
}

// The best round-trip sample avoids adding transport delay to the rhythm clock.
export class ServerClock {
  private offset = 0;
  private bestRoundTrip = Infinity;
  sample(sentAt: number, serverAt: number, receivedAt: number) {
    const roundTrip = receivedAt - sentAt;
    if (roundTrip >= 0 && roundTrip <= this.bestRoundTrip) {
      this.bestRoundTrip = roundTrip;
      this.offset = serverAt - (sentAt + receivedAt) / 2;
    }
  }
  now() { return Date.now() + this.offset; }
}
