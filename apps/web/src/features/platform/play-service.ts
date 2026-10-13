import { capturePlayCredit, releasePlayCredit, reservePlayCredit, type WalletSummary } from "./platform-client";
import type { PlayAction } from "../../game-sdk/contracts";

export interface PlayTransaction {
  cabinetId: string;
  gameId: string;
  action: PlayAction;
  start: (action: PlayAction, reservationId: string) => Promise<boolean>;
  walletChanged: (wallet: WalletSummary) => void;
}

export async function executePlay(transaction: PlayTransaction): Promise<boolean> {
  const reservation = await reservePlayCredit(transaction.cabinetId, transaction.gameId);
  let started = false;
  try {
    transaction.walletChanged(reservation.wallet);
    const result = await capturePlayCredit(reservation.reservationId);
    if (result.status !== "captured") throw new Error("credit_not_captured");
    transaction.walletChanged(result.wallet);
    started = await transaction.start(transaction.action, reservation.reservationId);
    if (!started) return false;
    return true;
  } finally {
    if (!started) {
      const result = await releasePlayCredit(reservation.reservationId);
      transaction.walletChanged(result.wallet);
      if (result.status === "captured") throw new Error("game_start_confirmation_pending");
    }
  }
}
