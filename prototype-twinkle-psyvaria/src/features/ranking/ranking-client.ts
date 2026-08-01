export interface RankingSubmission {
  clearTimeMs: number;
  score: number;
  maxLevel: number;
  defeatedBossCount: number;
  clientVersion: string;
}

export interface RankingEntry {
  player_name: string;
  clear_time_ms: number;
  score: number;
  max_level: number;
  created_at: string;
}

function getApiBase(): string {
  return localStorage.getItem("grazeDuelRankingApiBase")?.replace(/\/$/, "") ?? "";
}

export async function submitRankingEntry(
  submission: RankingSubmission,
): Promise<void> {
  const response = await fetch(`${getApiBase()}/api/ranking`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(submission),
  });
  if (!response.ok) {
    throw new Error(`ranking post failed: ${response.status}`);
  }
}

export async function fetchScoreRanking(limit = 20, clientVersion?: string): Promise<RankingEntry[]> {
  const versionQuery = clientVersion ? `&version=${encodeURIComponent(clientVersion)}` : "";
  const response = await fetch(
    `${getApiBase()}/api/ranking?type=score&limit=${encodeURIComponent(limit)}${versionQuery}`,
  );
  if (!response.ok) {
    throw new Error(`ranking get failed: ${response.status}`);
  }
  const data = (await response.json()) as { rankings?: RankingEntry[] };
  return data.rankings ?? [];
}
