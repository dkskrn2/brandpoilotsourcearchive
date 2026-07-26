const steps = ["원본 자료", "AI 분석", "사용자 검토", "실행 규칙"];

export function BrandReadinessJourney({ completed }: { completed: number }) {
  return (
    <ol className="brand-readiness-journey" aria-label="브랜드 준비 과정">
      {steps.map((step, index) => (
        <li className={index < completed ? "is-complete" : index === completed ? "is-current" : ""} key={step}>
          <span>{index + 1}</span>
          <strong>{step}</strong>
        </li>
      ))}
    </ol>
  );
}
