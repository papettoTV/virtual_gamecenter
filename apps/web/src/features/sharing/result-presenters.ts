import { getGameDefinition } from "../../domain/game";
import type { ResultPresentation, SharedResultDraft } from "../../domain/shared-result";
import { presentBuzzBarrierResult } from "../../games/graze-duel/sharing";
import { presentSalvageResult } from "../../games/deep-sea-salvage/sharing";
import { presentDotWaveResult } from "../../games/dot-wave/sharing";

export type ResultPresenter = (result: SharedResultDraft) => ResultPresentation;

const resultPresenters: Readonly<Record<string, ResultPresenter>> = {
  "graze-duel": presentBuzzBarrierResult,
  "deep-sea-salvage": presentSalvageResult,
  "dot-wave": presentDotWaveResult,
};

export function presentResult(result: SharedResultDraft): ResultPresentation {
  const presenter = resultPresenters[result.gameId];
  if (presenter) return presenter(result);
  const title = getGameDefinition(result.gameId)?.localizedTitle ?? result.gameId;
  const score = Math.round(result.score).toLocaleString("ja-JP");
  return { title, headline: result.cleared ? "クリア！" : "プレイ結果", accent: "#69f7ff", details: [`SCORE ${score}`], text: `${title}に挑戦！${score}点\n#PULBASE`, imageLines: [result.cleared ? "CLEAR" : "PLAY RESULT", `SCORE ${score}`] };
}
