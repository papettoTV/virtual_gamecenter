export interface ResultSummary {
  title: string;
  score: number;
  details: [string, string][];
  note?: string;
}

export function renderResultSummary({ title, score, details, note }: ResultSummary) {
  const heading = document.querySelector("#ranking-submit-heading");
  const target = document.querySelector("#ranking-result");
  if (heading) heading.textContent = title;
  if (!target) return;
  const value = document.createElement("strong");
  value.className = "result-score";
  value.textContent = score.toLocaleString("ja-JP");
  const label = document.createElement("span");
  label.className = "result-score-label";
  label.textContent = "SCORE";
  const metrics = document.createElement("dl");
  metrics.className = "result-metrics";
  for (const [name, text] of details) {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    term.textContent = name;
    const description = document.createElement("dd");
    description.textContent = text;
    item.appendChild(term);
    item.appendChild(description);
    metrics.appendChild(item);
  }
  target.replaceChildren(value, label, metrics);
  if (note) {
    const message = document.createElement("small");
    message.textContent = note;
    target.appendChild(message);
  }
}
