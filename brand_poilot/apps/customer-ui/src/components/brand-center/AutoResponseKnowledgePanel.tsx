import { useEffect, useState } from "react";
import { FileText, Globe2, Plus, Sparkles } from "lucide-react";
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
  const [sourceUrl, setSourceUrl] = useState("");
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);

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

  return <div className="auto-response-knowledge-stack">
    <section className="panel llm-knowledge-builder" aria-labelledby="llm-knowledge-title">
      <div className="panel-head llm-knowledge-head">
        <div>
          <div className="llm-knowledge-title-row">
            <span className="llm-knowledge-icon" aria-hidden="true"><Sparkles size={18} /></span>
            <div>
              <h2 id="llm-knowledge-title">LLM 답변 정보</h2>
              <p>URL과 문서를 모아 Wiki 답변 정보를 명시적으로 생성합니다.</p>
            </div>
          </div>
        </div>
        <span className="llm-build-state">생성 전</span>
      </div>
      <div className="panel-body llm-knowledge-body">
        <div className="llm-source-grid">
          <section className="llm-source-card">
            <div className="llm-source-card-title"><Globe2 size={18} /><h3>URL 소스</h3></div>
            <label className="llm-source-field">
              <span>참고 URL</span>
              <div>
                <input
                  type="url"
                  value={sourceUrl}
                  placeholder="https://brand.example.com/faq"
                  onChange={(event) => setSourceUrl(event.target.value)}
                />
                <button className="button" type="button" onClick={() => setPreviewNotice("화면 미리보기입니다. URL은 저장되지 않습니다.")}>URL 추가</button>
              </div>
            </label>
            <p>대표 브랜드 URL과 추가 페이지를 답변 근거로 사용합니다.</p>
          </section>
          <section className="llm-source-card">
            <div className="llm-source-card-title"><FileText size={18} /><h3>문서 소스</h3></div>
            <div className="llm-document-row">
              <div><strong>등록된 문서 없음</strong><span>제품 안내서, 정책 문서, 서비스 자료</span></div>
              <button className="button" type="button" onClick={() => setPreviewNotice("화면 미리보기입니다. 문서는 업로드되지 않습니다.")}><Plus size={15} /> 문서 추가</button>
            </div>
          </section>
        </div>
        <div className="llm-build-action">
          <div>
            <strong>사용할 수 있는 정보를 확인한 뒤 생성하세요.</strong>
            <p>생성 버튼을 눌러야만 새 Wiki 정보가 준비되는 흐름입니다.</p>
          </div>
          <button className="button primary" type="button" onClick={() => setPreviewNotice("화면 미리보기입니다. 실제 정보 생성은 실행되지 않습니다.")}>
            <Sparkles size={16} /> LLM 답변 정보 생성
          </button>
        </div>
        {previewNotice ? <p className="llm-preview-notice" role="status">{previewNotice}</p> : null}
      </div>
    </section>

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
  </div>;
}
