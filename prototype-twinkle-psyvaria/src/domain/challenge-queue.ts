export const MAX_CHALLENGE_QUEUE_SIZE = 5;

export interface ChallengeQueueEntry {
  clientId: string;
  reservationId: string;
  createdAt: number;
}

export function enqueueChallenge(
  queue: ChallengeQueueEntry[],
  entry: ChallengeQueueEntry,
): ChallengeQueueEntry[] | null {
  if (queue.length >= MAX_CHALLENGE_QUEUE_SIZE) return null;
  if (queue.some((queued) => queued.clientId === entry.clientId)) return queue;
  return [...queue, entry];
}

export function removeChallenge(
  queue: ChallengeQueueEntry[],
  clientId: string,
): { queue: ChallengeQueueEntry[]; removed: ChallengeQueueEntry | null } {
  const removed = queue.find((entry) => entry.clientId === clientId) ?? null;
  if (!removed) return { queue, removed: null };
  return {
    queue: queue.filter((entry) => entry.clientId !== clientId),
    removed,
  };
}

export function getChallengePosition(
  queue: ChallengeQueueEntry[],
  clientId: string,
): number | null {
  const index = queue.findIndex((entry) => entry.clientId === clientId);
  return index < 0 ? null : index + 1;
}
