import { Lightbulb } from "lucide-react";
import { useFeedback } from "./FeedbackContext";

export function FeatureSuggestionBanner() {
  const feedback = useFeedback();

  return (
    <section className="dashboard-feature-suggestion" aria-label="기능 제안">
      <div className="dashboard-feature-suggestion__message">
        <span className="dashboard-feature-suggestion__icon" aria-hidden="true"><Lightbulb size={22} /></span>
        <p><strong>원하는 기능</strong>을 모종 팀에게 제안해 주세요.</p>
      </div>
      <button className="button primary" type="button" onClick={() => feedback?.openFeedback()}>기능 제안하기</button>
    </section>
  );
}
