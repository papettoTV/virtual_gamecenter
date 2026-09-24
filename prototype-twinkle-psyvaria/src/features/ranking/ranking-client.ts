import { notifications } from "../notifications/notifications";
export interface RankingSubmission {
  gameId: string;
  elapsedTimeMs: number;
  cleared: boolean;
  score: number;
  maxLevel: number;
  defeatedBossCount: number;
  clientVersion: string;
}

export async function loadRankingWithNotice(gameId: string, load: () => Promise<void>) {
  const isActive = notifications.captureScope(gameId);
  try {
    await load();
    if (isActive()) notifications.dismiss(`ranking-load:${gameId}`);
  } catch {
    if (!isActive()) return;
    notifications.show({
      id: `ranking-load:${gameId}`, scope: gameId, type: "error",
      message: "ランキングを読み込めませんでした。",
      action: { label: "再試行", run: () => loadRankingWithNotice(gameId, load) },
    });
  }
}

export interface RankingEntry {
  player_name: string;
  play_time_ms: number;
  cleared: number;
  score: number;
  max_level: number;
  defeated_boss_count: number;
  created_at: string;
}

function getApiBase(): string {
  return localStorage.getItem("grazeDuelRankingApiBase")?.replace(/\/$/, "") ?? "";
}

export async function submitRankingEntry(
  submission: RankingSubmission,
): Promise<void> {
  const isActive = notifications.captureScope(submission.gameId);
  try {
    const response = await fetch(`${getApiBase()}/api/ranking`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(submission),
    });
    if (!response.ok) {
      throw new Error(`ranking post failed: ${response.status}`);
    }
    if (isActive()) notifications.show({ id: "ranking-submit", scope: submission.gameId, type: "success", message: "スコアを登録しました。" });
  } catch (error) {
    if (isActive()) notifications.show({ id: "ranking-submit", scope: submission.gameId, type: "error", message: "スコアを登録できませんでした。登録ボタンから再試行してください。" });
    throw error;
  }
}

export async function fetchScoreRanking(
  gameId: string,
  limit = 20,
  clientVersion?: string,
): Promise<RankingEntry[]> {
  const versionQuery = clientVersion ? `&version=${encodeURIComponent(clientVersion)}` : "";
  const response = await fetch(
    `${getApiBase()}/api/ranking?gameId=${encodeURIComponent(gameId)}&type=score&limit=${encodeURIComponent(limit)}${versionQuery}`,
  );
  if (!response.ok) {
    throw new Error(`ranking get failed: ${response.status}`);
  }
  const data = (await response.json()) as { rankings?: RankingEntry[] };
  return data.rankings ?? [];
}
