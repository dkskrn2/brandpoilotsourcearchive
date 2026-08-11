import type { AiContentGenerationProgress } from "../../features/ai-content/types";

const phaseLabels: Record<AiContentGenerationProgress["phase"], string> = {
  queued: "생성 순서를 기다리고 있습니다",
  planning: "전체 콘텐츠를 기획하고 있습니다",
  rendering: "장면별 이미지를 제작하고 있습니다",
  finalizing: "최종 파일을 정리하고 있습니다",
};

const roleLabels: Record<string, string> = {
  cover: "표지",
  detail: "상세",
  scene: "장면",
  cta: "마무리",
  article: "본문",
};

const statusLabels: Record<AiContentGenerationProgress["items"][number]["status"], string> = {
  queued: "대기",
  processing: "제작 중",
  completed: "완료",
  failed: "실패",
};

export function AiContentAssetProgress({ progress }: { progress: AiContentGenerationProgress }) {
  const percentage = progress.totalAssets > 0
    ? Math.floor(progress.completedAssets / progress.totalAssets * 100)
    : null;
  return <section className="ai-content-asset-progress" role="region" aria-label="콘텐츠 제작 진행률">
    <header>
      <div>
        <span>현재 생성 상태</span>
        <h2>{phaseLabels[progress.phase]}</h2>
        {progress.totalAssets > 0
          ? <p>{progress.completedAssets} / {progress.totalAssets}개 완료</p>
          : <p>이미지 없이 본문과 결과 파일을 완성합니다.</p>}
      </div>
      {percentage !== null ? <strong>{percentage}%</strong> : null}
    </header>
    {percentage !== null ? <div className="ai-content-asset-progress__bar" aria-hidden="true"><span style={{ width: `${percentage}%` }} /></div> : null}
    {progress.items.length ? <ol>
      {progress.items.map((item) => <li key={item.index} data-status={item.status}>
        <span>{String(item.index).padStart(2, "0")}</span>
        <strong>{roleLabels[item.role] ?? item.role}</strong>
        <small>{statusLabels[item.status]}</small>
      </li>)}
    </ol> : null}
  </section>;
}
