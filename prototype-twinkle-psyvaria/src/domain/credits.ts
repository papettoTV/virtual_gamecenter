export type CreditTransactionType = "grant" | "consume" | "refund" | "adjustment";

export interface CreditAccount {
  id: string;
  playerId: string;
  balance: number;
  updatedAt: number;
}

export interface CreditTransaction {
  id: string;
  accountId: string;
  type: CreditTransactionType;
  amount: number;
  playSessionId: string | null;
  createdAt: number;
}

export function applyCreditTransaction(
  account: CreditAccount,
  transaction: CreditTransaction,
): CreditAccount {
  const nextBalance = account.balance + transaction.amount;
  if (nextBalance < 0) throw new Error("insufficient_credit");
  return { ...account, balance: nextBalance, updatedAt: transaction.createdAt };
}
