import { afterEach, describe, expect, it, vi } from "vitest";
import { executePlay } from "../../src/features/platform/play-service";
import { reservePlayCredit, capturePlayCredit, releasePlayCredit } from "../../src/features/platform/platform-client";

vi.mock("../../src/features/platform/platform-client", () => ({
  reservePlayCredit: vi.fn(), capturePlayCredit: vi.fn(), releasePlayCredit: vi.fn(),
}));
afterEach(() => vi.resetAllMocks());

describe("play credit transaction", () => {
  function setup() {
    const wallet = { freeBalance: 4, purchasedBalance: 0, reservedFree: 1, reservedPurchased: 0, availableFree: 3, availablePurchased: 0, availableTotal: 3 };
    vi.mocked(reservePlayCredit).mockResolvedValue({ reservationId: "reservation", wallet } as Awaited<ReturnType<typeof reservePlayCredit>>);
    vi.mocked(capturePlayCredit).mockResolvedValue({ status: "captured", wallet } as Awaited<ReturnType<typeof capturePlayCredit>>);
    vi.mocked(releasePlayCredit).mockResolvedValue({ status: "released", wallet } as Awaited<ReturnType<typeof releasePlayCredit>>);
    return { cabinetId: "cabinet", gameId: "deep-sea-salvage", action: "start" as const, start: vi.fn().mockResolvedValue(true), walletChanged: vi.fn() };
  }
  it("captures exactly once before requesting an authorized game start", async () => {
    const transaction = setup();
    await expect(executePlay(transaction)).resolves.toBe(true);
    expect(reservePlayCredit).toHaveBeenCalledWith("cabinet", "deep-sea-salvage");
    expect(transaction.start).toHaveBeenCalledWith("start", "reservation");
    expect(vi.mocked(capturePlayCredit).mock.invocationCallOrder[0]).toBeLessThan(transaction.start.mock.invocationCallOrder[0]!);
    expect(capturePlayCredit).toHaveBeenCalledOnce();
    expect(releasePlayCredit).not.toHaveBeenCalled();
    expect(transaction.walletChanged).toHaveBeenCalledTimes(2);
  });
  it("releases the reservation when the game was detached before starting", async () => {
    const transaction = setup(); transaction.start.mockResolvedValue(false);
    await expect(executePlay(transaction)).resolves.toBe(false);
    expect(capturePlayCredit).toHaveBeenCalledOnce();
    expect(releasePlayCredit).toHaveBeenCalledWith("reservation");
  });
  it("releases the reservation after a start error", async () => {
    const transaction = setup(); transaction.start.mockRejectedValue(new Error("disconnected"));
    await expect(executePlay(transaction)).rejects.toThrow("disconnected");
    expect(releasePlayCredit).toHaveBeenCalledWith("reservation");
  });
  it("releases the reservation when capture fails", async () => {
    const transaction = setup(); vi.mocked(capturePlayCredit).mockRejectedValue(new Error("capture_failed"));
    await expect(executePlay(transaction)).rejects.toThrow("capture_failed");
    expect(releasePlayCredit).toHaveBeenCalledWith("reservation");
  });
  it("does not report success for a reservation that was not captured", async () => {
    const transaction = setup();
    vi.mocked(capturePlayCredit).mockResolvedValue({ status: "released", wallet: { freeBalance: 4, purchasedBalance: 0, reservedFree: 0, reservedPurchased: 0, availableFree: 4, availablePurchased: 0, availableTotal: 4 } });
    await expect(executePlay(transaction)).rejects.toThrow("credit_not_captured");
    expect(releasePlayCredit).toHaveBeenCalledWith("reservation");
  });
  it("does not claim a refund after an authorized start whose response was lost", async () => {
    const transaction = setup(); transaction.start.mockResolvedValue(false);
    vi.mocked(releasePlayCredit).mockResolvedValue({ status: "captured", wallet: {} } as Awaited<ReturnType<typeof releasePlayCredit>>);
    await expect(executePlay(transaction)).rejects.toThrow("game_start_confirmation_pending");
  });
  it("does not request capture or release when reservation creation fails", async () => {
    const transaction = setup();
    vi.mocked(reservePlayCredit).mockRejectedValue(new Error("insufficient_credit"));
    await expect(executePlay(transaction)).rejects.toThrow("insufficient_credit");
    expect(capturePlayCredit).not.toHaveBeenCalled();
    expect(releasePlayCredit).not.toHaveBeenCalled();
    expect(transaction.start).not.toHaveBeenCalled();
  });
  it("does not claim automatic recovery when the release request also fails", async () => {
    const transaction = setup();
    transaction.start.mockResolvedValue(false);
    vi.mocked(releasePlayCredit).mockRejectedValue(new Error("release_unavailable"));
    await expect(executePlay(transaction)).rejects.toThrow("release_unavailable");
    expect(transaction.walletChanged).toHaveBeenCalledTimes(2);
    expect(releasePlayCredit).toHaveBeenCalledOnce();
  });
});
