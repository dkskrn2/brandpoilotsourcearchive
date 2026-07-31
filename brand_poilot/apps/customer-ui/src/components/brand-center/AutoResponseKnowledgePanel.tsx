import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { BrandCore } from "../../features/brand-center/types";
import {
  libraryGateway,
  type WikiItem,
} from "../../features/libraries/libraryGateway";
import { Alert } from "../ui/Alert";
import { PageSkeleton } from "../ui/LoadingState";

interface AutoResponseKnowledgePanelProps {
  brandId: string;
  core: BrandCore | null;
  gateway?: Pick<typeof libraryGateway, "listWikiItems">;
}

const coreRows: Array<{
  label: string;
  value(core: BrandCore): string;
}> = [
  { label: "기업 개요", value: (core) => core.companyOverview ?? core.summary.oneLine },
  { label: "사업 소개", value: (core) => core.businessDescription ?? core.summary.description },
  { label: "대표 분야", value: (core) => core.primaryCategory?.name ?? "" },
  {
    label: "직접 입력 세부 분야",
    value: (core) => core.subcategories?.map((item) => item.name).join(", ") ?? "",
  },
  { label: "핵심 타깃", value: (core) => core.primaryTarget ?? core.audiences[0]?.name ?? "" },
  {
    label: "차별점",
    value: (core) => (core.differentiators ?? core.valueProposition.differentiators).join("\n"),
  },
  { label: "핵심 소구점", value: (core) => core.coreAppeal ?? core.valueProposition.primary },
];

export function AutoResponseKnowledgePanel({
  brandId,
  core,
  gateway = libraryGateway,
}: AutoResponseKnowledgePanelProps) {
  const [items, setItems] = useState<WikiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void gateway.listWikiItems(brandId)
      .then((loaded) => {
        if (active) setItems(loaded);
      })
      .catch(() => {
        if (active) setError("AI 자동응답 지식을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [brandId, gateway]);

  if (loading) return <PageSkeleton label="AI 자동응답 지식을 불러오는 중" />;
  if (error) return <Alert title="지식 조회 실패" variant="bad">{error}</Alert>;

  const products = items.filter((item) => (
    item.sourceKind === "product_service"
    && item.status === "read_only"
  ));
  const faqs = items.filter((item) => (
    item.sourceKind === "faq"
    && item.status === "active"
  ));

  return (
    <section
      className="panel auto-response-knowledge-panel"
      aria-labelledby="auto-response-knowledge-title"
    >
      <div className="panel-head">
        <div>
          <h2 id="auto-response-knowledge-title">AI 자동응답 지식</h2>
          <p>DM 자동응답이 사용하는 확정된 브랜드 코어, 제품·서비스, FAQ입니다.</p>
        </div>
      </div>
      <div className="panel-body auto-response-knowledge-body">
        <section>
          <div className="section-heading-inline">
            <h3>브랜드 코어</h3>
            <Link to="?tab=core">브랜드 코어에서 수정</Link>
          </div>
          {core ? (
            <dl className="brand-core-grid brand-core-grid--core">
              {coreRows.map((row) => (
                <div key={row.label}>
                  <dt>{row.label}</dt>
                  <dd>{row.value(core) || "등록된 정보 없음"}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="muted">확정된 브랜드 코어가 없습니다.</p>}
        </section>
        <section>
          <div className="section-heading-inline">
            <h3>제품·서비스</h3>
            <Link to="?tab=products">제품·서비스에서 수정</Link>
          </div>
          {products.length ? (
            <ul className="library-card-list">
              {products.map((item) => (
                <li key={item.id}><strong>{item.title}</strong><p>{item.content}</p></li>
              ))}
            </ul>
          ) : <p className="muted">활성 제품·서비스가 없습니다.</p>}
        </section>
        <section>
          <div className="section-heading-inline">
            <h3>FAQ</h3>
            <Link to="?tab=faq">FAQ에서 수정</Link>
          </div>
          {faqs.length ? (
            <dl className="brand-core-grid brand-core-grid--faq">
              {faqs.map((item) => (
                <div key={item.id}>
                  <dt>{item.title}</dt>
                  <dd>{item.content}</dd>
                </div>
              ))}
            </dl>
          ) : <p className="muted">활성 FAQ가 없습니다.</p>}
        </section>
      </div>
    </section>
  );
}
