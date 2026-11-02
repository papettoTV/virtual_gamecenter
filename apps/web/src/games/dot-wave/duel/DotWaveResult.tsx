import type { ReactNode } from "react";
import { ResultSummaryView } from "../../../features/game/ResultSummaryView";
import { ResultFeedbackButton } from "../../../features/feedback/ResultFeedbackButton";
import type { ResultSummary } from "../../../features/game/result-summary";

export function DotWaveResult({ summary, ranking, actions, share, spectator = false }: {
  summary: ResultSummary; ranking?: ReactNode; actions?: ReactNode; share?: ReactNode; spectator?: boolean;
}) {
  return <section className="dot-result-card" aria-label="DOT WAVEのプレイ結果" data-player-result={!spectator || undefined}>
    <ResultSummaryView {...summary} />
    {ranking}
    {!spectator && <>
      <div className="dot-result-actions">{actions}</div>
      <div className="ranking-secondary-actions">{share}<ResultFeedbackButton /></div>
    </>}
  </section>;
}
