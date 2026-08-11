export type AiContentDisplayPhase = "setup" | "proposal_selection" | "generating" | "reviewing";

const phases: ReadonlyArray<{ id: AiContentDisplayPhase; label: string; description: string }> = [
  { id: "setup", label: "콘텐츠 설정", description: "목적·원문·형식" },
  { id: "proposal_selection", label: "구성안·스타일", description: "방향·첨부 선택" },
  { id: "generating", label: "콘텐츠 생성", description: "기획·이미지 제작" },
  { id: "reviewing", label: "결과 확인", description: "검토·다운로드·게시" },
];

export function AiContentPhaseProgress({ current }: { current: AiContentDisplayPhase }) {
  const currentIndex = phases.findIndex((phase) => phase.id === current);

  return (
    <ol className="ai-content-phase-progress" aria-label="콘텐츠 생성 단계">
      {phases.map((phase, index) => (
        <li
          key={phase.id}
          data-completed={index < currentIndex ? "true" : undefined}
          aria-current={phase.id === current ? "step" : undefined}
        >
          <span aria-hidden="true">{index + 1}</span>
          <div>
            <strong>{phase.label}</strong>
            <small>{phase.description}</small>
          </div>
        </li>
      ))}
    </ol>
  );
}
