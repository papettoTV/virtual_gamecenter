import { describe, expect, it } from "vitest";
import {
  enqueueChallenge,
  getChallengePosition,
  MAX_CHALLENGE_QUEUE_SIZE,
  removeChallenge,
  type ChallengeQueueEntry,
} from "../../src/domain/challenge-queue";

describe("challenge queue", () => {
  it("keeps FIFO positions and closes at five entries", () => {
    let queue: ChallengeQueueEntry[] = [];
    for (let index = 0; index < MAX_CHALLENGE_QUEUE_SIZE; index += 1) {
      queue = enqueueChallenge(queue, {
        clientId: `client-${index}`,
        reservationId: `reservation-${index}`,
        createdAt: index,
      })!;
    }

    expect(getChallengePosition(queue, "client-0")).toBe(1);
    expect(getChallengePosition(queue, "client-4")).toBe(5);
    expect(enqueueChallenge(queue, {
      clientId: "client-5",
      reservationId: "reservation-5",
      createdAt: 5,
    })).toBeNull();
  });

  it("removes a disconnected entry and closes the gap", () => {
    const queue = [
      { clientId: "a", reservationId: "ra", createdAt: 1 },
      { clientId: "b", reservationId: "rb", createdAt: 2 },
      { clientId: "c", reservationId: "rc", createdAt: 3 },
    ];

    const result = removeChallenge(queue, "b");

    expect(result.removed?.reservationId).toBe("rb");
    expect(getChallengePosition(result.queue, "c")).toBe(2);
  });
});
