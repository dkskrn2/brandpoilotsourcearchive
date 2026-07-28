export function ContentSubjectStep({ topic, onTopicChange, onComplete }: {
  topic: string;
  onTopicChange(value: string): void;
  onComplete(): void;
}) {
  return <div className="content-subject-step">
    <div className="content-entry-tabs" role="group" aria-label="주제 자료 방식">
      <button type="button" aria-pressed="true">브랜드 주제</button>
      <button type="button" disabled title="제품·서비스 보관함 연동 예정">저장 제품·서비스</button>
      <button type="button" disabled title="기존 분석 흐름에서 사용할 수 있습니다">새 제품·서비스 분석</button>
    </div>
    <label>브랜드 주제
      <input value={topic} onChange={(event) => onTopicChange(event.target.value)} placeholder="예: 여름 피부 관리" />
    </label>
    <p className="wizard-muted">승인된 Brand Core와 Wiki를 근거로 구성안을 만듭니다.</p>
    <button type="button" className="button primary" disabled={!topic.trim()} onClick={onComplete}>주제·자료 완료</button>
  </div>;
}
