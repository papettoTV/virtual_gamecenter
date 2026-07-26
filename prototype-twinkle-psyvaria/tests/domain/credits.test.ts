import { describe, expect, it } from "vitest";
import { applyCreditTransaction } from "../../src/domain/credits";

describe("credit account", () => {
  const account = {
    id: "account-1",
    playerId: "player-1",
    balance: 2,
    updatedAt: 1,
  };

  it("consumes a credit immutably", () => {
    const next = applyCreditTransaction(account, {
      id: "transaction-1",
      accountId: account.id,
      type: "consume",
      amount: -1,
      playSessionId: "session-1",
      createdAt: 2,
    });
    expect(next.balance).toBe(1);
    expect(account.balance).toBe(2);
  });

  it("rejects an insufficient balance", () => {
    expect(() =>
      applyCreditTransaction(account, {
        id: "transaction-2",
        accountId: account.id,
        type: "consume",
        amount: -3,
        playSessionId: "session-1",
        createdAt: 2,
      }),
    ).toThrow("insufficient_credit");
  });
});
