import type { ResultSummary } from "./result-summary";

export function ResultSummaryView({ title, score, details, note }: ResultSummary) {
  return <div className="game-result-summary">
    <h2>{title}</h2>
    <strong className="result-score">{score.toLocaleString("ja-JP")}</strong>
    <span className="result-score-label">SCORE</span>
    <dl className="result-metrics">{details.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    {note && <small>{note}</small>}
  </div>;
}
