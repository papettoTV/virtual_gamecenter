import { capturePlayCredit, releasePlayCredit, reservePlayCredit, type WalletSummary } from "./platform-client";
import type { PlayAction } from "../../game-sdk/contracts";

export interface PlayTransaction {
  cabinetId: string;
  gameId: string;
  action: PlayAction;
  start: (action: PlayAction) => Promise<boolean>;
  walletChanged: (wallet: WalletSummary) => void;
}

export async function executePlay(transaction: PlayTransaction): Promise<boolean> {
  const reservation = await reservePlayCredit(transaction.cabinetId, transaction.gameId);
  let captured = false;
  try {
    transaction.walletChanged(reservation.wallet);
    if (!await transaction.start(transaction.action)) return false;
    const result = await capturePlayCredit(reservation.reservationId);
    if (result.status !== "captured") throw new Error("credit_not_captured");
    captured = true;
    transaction.walletChanged(result.wallet);
    return true;
  } finally {
    if (!captured) {
      const result = await releasePlayCredit(reservation.reservationId);
      transaction.walletChanged(result.wallet);
    }
  }
}
