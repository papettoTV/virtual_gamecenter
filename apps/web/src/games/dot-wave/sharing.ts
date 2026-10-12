import type { ResultPresentation, SharedResultDraft } from "../../domain/shared-result";
import { resultMetric } from "../../features/sharing/result-format";

export function presentDotWaveResult(result: SharedResultDraft): ResultPresentation {
  const outcome = result.metrics.outcome;
  const headline = outcome === "win" ? "勝利！" : outcome === "lose" ? "今回の対戦" : outcome === "draw" ? "引き分け" : "今回のプレイ";
  const mode = result.metrics.mode === "versus" ? "対人戦" : "CPU戦";
  return {
    title: "DOT WAVE", headline, accent: "#ff6eb4",
    details: [mode, `${resultMetric(result, "turns")}ターン`, `残りHP ${resultMetric(result, "remainingHp")}`],
    text: `DOT WAVE${mode}${outcome === "win" ? "で勝利！" : outcome === "draw" ? "は引き分け！" : "に挑戦！"} ${resultMetric(result, "turns")}ターンのバトル。\n#DOTWAVE #PULBASE`,
    imageLines: [outcome === "win" ? "VICTORY" : outcome === "draw" ? "DRAW" : "BATTLE RESULT", result.metrics.mode === "versus" ? "VERSUS PLAYER" : "VERSUS CPU", `${resultMetric(result, "turns")} TURNS / HP ${resultMetric(result, "remainingHp")}`],
  };
}
