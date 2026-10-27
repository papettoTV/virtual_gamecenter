import { openFeedback } from "./Feedback";

export function ResultFeedbackButton() {
  return <div className="result-feedback"><button type="button" onClick={event => { event.stopPropagation(); openFeedback(); }}>感想・不具合を送る</button></div>;
}
