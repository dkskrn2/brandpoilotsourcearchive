import type {
  ContentProposalBatch,
  ContentProposalRecord,
  ContentProposalRecordV2,
  ContentProposalV2,
} from "../../features/ai-content/types";

const informationalTypeLabel: Record<NonNullable<ContentProposalV2["informationalType"]>, string> = {
  problem_solution: "문제 해결",
  how_to: "방법 안내",
  checklist: "체크리스트",
  comparison: "비교·선택 기준",
  trend_insight: "트렌드·인사이트",
  q_and_a: "질문과 답변",
  myth_fact: "오해와 사실",
};

const strategyLabel: Record<string, string> = {
  problem_solution: "문제 해결",
  how_to: "방법 안내",
  comparison: "비교",
  faq: "FAQ",
  insight: "인사이트",
  benefit: "효익",
  social_proof: "사회적 증거",
  brand_story: "브랜드 스토리",
  cta: "행동 유도",
};

function TextList({ values }: { values: string[] }) {
  return values.length
    ? <ul>{values.map((value, index) => <li key={`${index}:${value}`}>{value}</li>)}</ul>
    : <span>없음</span>;
}

export function ContentProposalCard({
  item,
  position,
  selected,
  evidence,
  references,
  disabled = false,
  onSelect,
}: {
  item: ContentProposalRecord | ContentProposalRecordV2;
  position: number;
  selected: boolean;
  evidence: NonNullable<ContentProposalBatch["researchEvidence"]>["items"];
  references: NonNullable<ContentProposalBatch["selectedReferences"]>;
  disabled?: boolean;
  onSelect(): void;
}) {
  const proposal = item.proposal;
  if (!("conceptKey" in proposal)) {
    return <article className={`content-proposal-card${selected ? " is-selected" : ""}`}>
      <header><span>{strategyLabel[proposal.messageStrategy] ?? proposal.messageStrategy}</span><h3>{proposal.title}</h3></header>
      <p className="proposal-reason">{proposal.reasonToCreateNow}</p>
      <dl>
        <div><dt>주제</dt><dd>{proposal.topic}</dd></div>
        <div><dt>훅</dt><dd>{proposal.hook}</dd></div>
        <div><dt>핵심 메시지</dt><dd>{proposal.keyMessage}</dd></div>
        <div><dt>형식·채널</dt><dd>{proposal.outputFormat} · {proposal.channelTargets.join(", ")}</dd></div>
      </dl>
      {proposal.evidence.length ? <div><strong>근거</strong><ul>{proposal.evidence.map((source) => <li key={source.sourceSnapshotId}>{source.summary}</li>)}</ul></div> : null}
      <ol className="proposal-outline">{proposal.outline.map((outline) => <li key={`${outline.heading}-${outline.purpose}`}><strong>{outline.heading}</strong><span>{outline.purpose}</span></li>)}</ol>
      <button type="button" className="button primary" aria-pressed={selected} disabled={disabled} onClick={onSelect}>
        구성안 선택: {proposal.title}
      </button>
    </article>;
  }

  const usedEvidence = evidence.filter((source) => proposal.evidenceIds.includes(source.id));
  const usedReferences = references.filter((reference) => proposal.referenceIds.includes(reference.id));
  const details = proposal.purposeDetails;
  const isBlog = proposal.outputFormat === "blog";

  return <article className={`content-proposal-card${selected ? " is-selected" : ""}`}>
    <header>
      <span>구성안 {position}</span>
      <h3>{proposal.title}</h3>
    </header>
    <dl className="proposal-details">
      <div><dt>기획 의도</dt><dd>{proposal.oneLineIntent}</dd></div>
      <div><dt>이 안의 차별점</dt><dd>{proposal.differentiator}</dd></div>
      <div><dt>대상</dt><dd>{proposal.target}</dd></div>
      <div><dt>상황</dt><dd>{proposal.customerContext}</dd></div>
      <div><dt>핵심 메시지</dt><dd>{proposal.keyMessage}</dd></div>
      <div><dt>훅</dt><dd>{proposal.hook}</dd></div>
      <div><dt>선택 이유</dt><dd>{proposal.selectionReason}</dd></div>
      <div><dt>출력 형식·채널</dt><dd>{proposal.outputFormat} · {proposal.channelTargets.join(", ")}</dd></div>
      {details.kind === "informational" ? <>
        <div><dt>정보 유형</dt><dd>{informationalTypeLabel[proposal.informationalType!]}</dd></div>
        <div><dt>독자 질문</dt><dd>{details.question}</dd></div>
        <div><dt>제공 가치</dt><dd>{details.value}</dd></div>
        <div><dt>지금 다룰 이유</dt><dd>{details.whyNow}</dd></div>
        <div><dt>핵심 학습 포인트</dt><dd><TextList values={details.learningPoints} /></dd></div>
      </> : <>
        <div><dt>캠페인 목적</dt><dd>{details.campaignObjective}</dd></div>
        <div><dt>고객 상황·니즈</dt><dd>{details.situationAndNeed}</dd></div>
        <div><dt>제품</dt><dd>{details.productId}</dd></div>
        <div><dt>타깃 세그먼트</dt><dd>{details.targetSegment}</dd></div>
        <div><dt>강점</dt><dd><TextList values={details.strengths} /></dd></div>
        <div><dt>한계</dt><dd><TextList values={details.limitations} /></dd></div>
        <div><dt>소구점</dt><dd>{details.appeal}</dd></div>
        <div><dt>구매 장벽</dt><dd><TextList values={details.buyingBarriers} /></dd></div>
        <div><dt>CTA</dt><dd>{details.cta}</dd></div>
      </>}
      <div><dt>검색 근거</dt><dd>{usedEvidence.length ? <ul>{usedEvidence.map((source) => <li key={source.id}>
        <a href={source.url} target="_blank" rel="noreferrer">{source.title}</a>{source.publisher ? ` · ${source.publisher}` : ""}
      </li>)}</ul> : "없음"}</dd></div>
      <div><dt>사용 레퍼런스</dt><dd>{usedReferences.length ? <ul>{usedReferences.map((reference) => <li key={reference.id}>
        <span>{reference.title}</span>{reference.preview.url ? <> · <a href={reference.preview.url} target="_blank" rel="noreferrer">{reference.title} 미리보기</a></> : null}
      </li>)}</ul> : "없음"}</dd></div>
      {isBlog
        ? <div><dt>이미지</dt><dd>이미지는 최종 작성 중 필요할 때 결정</dd></div>
        : <div><dt>제안 장수</dt><dd>{proposal.assetCount}장</dd></div>}
    </dl>
    <section>
      <h4>{isBlog ? "글 개요" : "장면별 개요"}</h4>
      <ol aria-label={isBlog ? "글 개요" : "장면별 개요"} className="proposal-outline">
        {proposal.outline.map((outline) => <li key={outline.index}>
          <strong>{outline.index}. {outline.role} · {outline.headline}</strong>
          <span>{outline.purpose}</span>
        </li>)}
      </ol>
    </section>
    <button type="button" className="button primary" aria-pressed={selected} disabled={disabled} onClick={onSelect}>
      구성안 선택: {proposal.title}
    </button>
  </article>;
}
