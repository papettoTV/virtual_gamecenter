import type { ResultPresentation, SharedResultDraft } from "../../domain/shared-result";
import { resultMetric } from "../../features/sharing/result-format";

export function presentSalvageResult(result: SharedResultDraft): ResultPresentation {
  const depth = Math.floor(resultMetric(result, "maxDepth")).toLocaleString("ja-JP");
  const count = resultMetric(result, "discoveredCount");
  const total = resultMetric(result, "totalSpeciesCount") || 21;
  return {
    title: "深海サルベージ", headline: `最大深度 ${depth}m`, accent: "#5de0bc",
    details: [`今回の調査 ${count} / ${total}種`, `SCORE ${Math.round(result.score).toLocaleString("ja-JP")}`, result.cleared ? "巨大深海魚の調査に成功" : "深海調査記録"],
    text: `深海サルベージで${depth}mまで潜航！今回の調査は${count}種。${result.cleared ? "巨大深海魚の調査に成功！" : ""}\n#深海サルベージ #PULBASE`,
    imageLines: [`MAX DEPTH ${depth}m`, `SURVEY ${count} / ${total} SPECIES`, `SCORE ${Math.round(result.score).toLocaleString("en-US")}`],
  };
}
