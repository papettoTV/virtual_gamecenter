import { shareTags } from "../../features/sharing/share-tags";
import type { ResultPresentation, SharedResultDraft } from "../../domain/shared-result";
import { resultMetric, resultTime } from "../../features/sharing/result-format";

export function presentBuzzBarrierResult(result: SharedResultDraft): ResultPresentation {
  const score = Math.round(result.score).toLocaleString("ja-JP");
  const versus = result.metrics.mode === "versus";
  const outcome = result.metrics.outcome;
  const headline = versus ? outcome === "win" ? "対戦に勝利！" : outcome === "draw" ? "引き分け" : "今回の対戦" : result.cleared ? "ALL CLEAR" : "今回の挑戦";
  return {
    title: "BUZZ BARRIER", headline, accent: "#69f7ff",
    details: [`SCORE ${score}`, `TIME ${resultTime(result.elapsedTimeMs)}`, `ボス撃破 ${resultMetric(result, "defeatedBossCount")} / LV ${resultMetric(result, "maxLevel")}`],
    text: `BUZZ BARRIER${versus ? outcome === "win" ? "の対戦に勝利！" : outcome === "draw" ? "の対戦は引き分け！" : "の対戦に挑戦！" : result.cleared ? "をクリア！" : "に挑戦！"} ${score}点${result.cleared ? ` / ${resultTime(result.elapsedTimeMs)}` : ""}\n${shareTags("graze-duel")}`,
    imageLines: [versus ? outcome === "win" ? "VICTORY" : outcome === "draw" ? "DRAW" : "VERSUS RESULT" : result.cleared ? "ALL CLEAR" : "CHALLENGE RESULT", `SCORE ${score}`, `TIME ${resultTime(result.elapsedTimeMs)}`],
  };
}
