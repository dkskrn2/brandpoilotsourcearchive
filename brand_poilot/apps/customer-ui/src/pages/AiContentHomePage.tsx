import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { AiContentJobList, type AiContentJobFilter } from "../components/ai-content/AiContentJobList";
import { PageHeader } from "../components/layout/PageHeader";
import { ButtonLink } from "../components/ui/ButtonLink";
import { PageSkeleton } from "../components/ui/LoadingState";
import { aiContentApiGateway } from "../features/ai-content/aiContentApiGateway";
import { DEMO_BRAND_ID } from "../lib/apiClient";
import type { AiContentGateway, AiContentGeneration } from "../features/ai-content/types";
import type { ContentProposalRecord } from "../features/ai-content/types";
import { ContentProposalInbox } from "../components/ai-content/ContentProposalInbox";

interface AiContentHomePageProps {
  gateway?: AiContentGateway;
  brandId?: string;
}

export function AiContentHomePage({ gateway = aiContentApiGateway, brandId = DEMO_BRAND_ID }: AiContentHomePageProps) {
  const [jobs, setJobs] = useState<AiContentGeneration[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<AiContentJobFilter>("all");
  const [error, setError] = useState(false);
  const [proposals, setProposals] = useState<ContentProposalRecord[]>([]);
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      gateway.listGenerations(brandId),
      gateway.listSuggestedProposals(brandId).catch(() => [] as ContentProposalRecord[]),
    ])
      .then(([nextJobs, nextProposals]) => {
        if (!active) return;
        setJobs(nextJobs);
        setProposals(nextProposals);
        setLoading(false);
      })
      .catch(() => { if (active) { setError(true); setLoading(false); } });
    return () => { active = false; };
  }, [brandId, gateway]);

  async function dismissProposal(item: ContentProposalRecord) {
    if (!window.confirm(`"${item.proposal.title}" 제안을 닫을까요?`)) return;
    setDismissingId(item.id);
    try {
      await gateway.dismissProposal(brandId, item.id);
      setProposals((current) => current.filter((candidate) => candidate.id !== item.id));
    } finally {
      setDismissingId(null);
    }
  }

  if (error) return <div className="ai-content-page-state" role="alert"><strong>AI 콘텐츠 화면을 불러오지 못했습니다.</strong><span>잠시 후 다시 시도해 주세요.</span></div>;
  if (loading) return <PageSkeleton label="AI 콘텐츠를 불러오는 중입니다." />;

  return (
    <div className="content ai-content-page">
      <PageHeader
        title="AI 콘텐츠 생성"
        description="브랜드 정보와 레퍼런스를 바탕으로 필요한 콘텐츠를 직접 생성합니다."
        actions={<ButtonLink to="/ai-content/new" variant="primary"><Plus size={16} /> 새 콘텐츠 만들기</ButtonLink>}
      />
      <ContentProposalInbox proposals={proposals} dismissingId={dismissingId} onDismiss={(item) => void dismissProposal(item)} />
      <AiContentJobList jobs={jobs} filter={filter} onFilterChange={setFilter} />
    </div>
  );
}
