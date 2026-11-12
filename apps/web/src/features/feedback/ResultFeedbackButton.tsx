import { openFeedback } from "./Feedback";

export function ResultFeedbackButton() {
  return <div className="result-feedback"><button type="button" onClick={event => { event.stopPropagation(); openFeedback(); }}>ご意見・感想を送る</button></div>;
}
