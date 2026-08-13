import { useEffect, useState } from "react";
import { Check, FileSearch, Sparkles, X } from "lucide-react";
import {
  libraryGateway,
  type FaqSuggestionCategory,
  type FaqSuggestionItem,
  type FaqSuggestionRun,
  type LibraryGateway,
  type WikiItem,
} from "../../features/libraries/libraryGateway";
import { Badge } from "../ui/Badge";
import { FaqUtteranceEditor, faqUtteranceValidation } from "./FaqUtteranceEditor";

const categoryOptions: Array<[FaqSuggestionCategory, string]> = [
  ["service", "서비스 문의"],
  ["product", "제품 문의"],
  ["price_payment", "가격·결제"],
  ["location_visit", "위치·방문"],
  ["hours", "운영 시간"],
  ["shipping", "배송"],
  ["exchange_refund", "교환·환불"],
  ["reservation_usage", "예약·이용"],
  ["account_membership", "계정·멤버십"],
  ["other", "기타"],
];

function itemStatus(item: FaqSuggestionItem) {
  if (item.status === "approved") return { label: "승인됨", variant: "ok" as const };
  if (item.status === "dismissed") return { label: "제외됨", variant: "neutral" as const };
  if (item.status === "duplicate") return { label: "중복됨", variant: "neutral" as const };
  return { label: "검토 필요", variant: "warn" as const };
}

function runNotice(run: FaqSuggestionRun) {
  if (run.status === "queued") return "FAQ 제안 작업을 기다리고 있습니다.";
  if (run.status === "running") return "브랜드 정보를 바탕으로 FAQ를 만들고 있습니다.";
  if (run.status === "partial") {
    return run.errorCode === "source_missing"
      ? "일부 정보가 없어 생성 가능한 FAQ만 제안했습니다. 근거를 확인해 주세요."
      : "일부 FAQ만 생성되었습니다. 제안 내용과 근거를 확인해 주세요.";
  }
  if (run.status === "failed") {
    return run.errorCode === "source_missing"
      ? "FAQ를 만들 정보가 부족합니다. 브랜드 코어, 제품·서비스, URL 또는 문서를 먼저 등록해 주세요."
      : "FAQ 제안을 만들지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  if (run.status === "completed") return "모든 제안의 검토가 완료되었습니다.";
  return "질문과 답변을 수정한 뒤 필요한 내용만 승인하세요.";
}

function isConflict(error: unknown) {
  return Boolean(error && typeof error === "object" && "status" in error && error.status === 409);
}

interface Props {
  brandId: string;
  gateway?: LibraryGateway;
  onApproved?(wikiItem: WikiItem | null): void;
}

export function FaqSuggestionPreviewPanel({
  brandId,
  gateway = libraryGateway,
  onApproved,
}: Props) {
  const [run, setRun] = useState<FaqSuggestionRun | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [dirtyIds, setDirtyIds] = useState<Set<string>>(() => new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    void gateway.getLatestFaqSuggestionRun(brandId)
      .then(({ run: latest }) => { if (active) setRun(latest); })
      .catch(() => { if (active) setError("기존 FAQ 제안을 불러오지 못했습니다."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [brandId, gateway]);

  useEffect(() => {
    if (!run || (run.status !== "queued" && run.status !== "running")) return;
    let active = true;
    const timer = window.setInterval(() => {
      void gateway.getFaqSuggestionRun(brandId, run.id)
        .then(({ run: latest }) => { if (active) setRun(latest); })
        .catch(() => { if (active) setError("FAQ 제안 진행 상태를 확인하지 못했습니다."); });
    }, 2_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [brandId, gateway, run?.id, run?.status]);

  function replaceItem(next: FaqSuggestionItem) {
    setRun((current) => current ? {
      ...current,
      items: current.items.map((candidate) => candidate.id === next.id ? next : candidate),
    } : current);
  }

  function editItem(id: string, patch: Partial<Pick<FaqSuggestionItem, "category" | "question" | "answer" | "exampleUtterances">>) {
    setRun((current) => current ? {
      ...current,
      items: current.items.map((candidate) => candidate.id === id ? { ...candidate, ...patch } : candidate),
    } : current);
    setDirtyIds((current) => new Set(current).add(id));
    setNotice(null);
  }

  async function reloadLatestRun() {
    if (!run) return;
    const latest = await gateway.getFaqSuggestionRun(brandId, run.id);
    setRun(latest.run);
    setDirtyIds(new Set());
  }

  async function createSuggestions() {
    setCreating(true);
    setError(null);
    setNotice(null);
    try {
      const result = await gateway.createFaqSuggestionRun(brandId);
      setRun(result.run);
      setDirtyIds(new Set());
    } catch {
      setError("FAQ 제안 작업을 시작하지 못했습니다. 브랜드 정보와 연결 상태를 확인해 주세요.");
    } finally {
      setCreating(false);
    }
  }

  async function approve(item: FaqSuggestionItem) {
    if (!run || item.status !== "review") return;
    setBusyItemId(item.id);
    setError(null);
    setNotice(null);
    try {
      const updated = await gateway.updateFaqSuggestionItem(brandId, run.id, item.id, {
        category: item.category,
        question: item.question,
        answer: item.answer,
        exampleUtterances: item.exampleUtterances,
        expectedUpdatedAt: item.updatedAt,
      });
      const persisted = updated.item;
      replaceItem(persisted);
      const result = await gateway.approveFaqSuggestionItem(brandId, run.id, item.id, {
        expectedUpdatedAt: persisted.updatedAt,
      });
      replaceItem(result.item);
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
      if (result.item.status === "duplicate") {
        setNotice("기존 FAQ와 중복되어 새 항목을 추가하지 않았습니다.");
      } else {
        setNotice("FAQ를 승인했습니다. 아래 FAQ 목록에 바로 반영됩니다.");
        onApproved?.(result.wikiItem);
      }
    } catch (cause) {
      if (isConflict(cause)) {
        await reloadLatestRun().catch(() => undefined);
        setNotice("다른 변경이 먼저 반영되어 최신 제안으로 다시 불러왔습니다.");
      } else {
        setError("FAQ를 승인하지 못했습니다. 내용을 확인한 뒤 다시 시도해 주세요.");
      }
    } finally {
      setBusyItemId(null);
    }
  }

  async function dismiss(item: FaqSuggestionItem) {
    if (!run || item.status !== "review") return;
    setBusyItemId(item.id);
    setError(null);
    setNotice(null);
    try {
      const result = await gateway.dismissFaqSuggestionItem(brandId, run.id, item.id, {
        expectedUpdatedAt: item.updatedAt,
      });
      replaceItem(result.item);
      setDirtyIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    } catch (cause) {
      if (isConflict(cause)) {
        await reloadLatestRun().catch(() => undefined);
        setNotice("다른 변경이 먼저 반영되어 최신 제안으로 다시 불러왔습니다.");
      } else {
        setError("FAQ를 제외하지 못했습니다. 잠시 후 다시 시도해 주세요.");
      }
    } finally {
      setBusyItemId(null);
    }
  }

  const reviewCount = run?.items.filter((item) => item.status === "review").length ?? 0;
  const isWorking = run?.status === "queued" || run?.status === "running";

  return (
    <section className="panel faq-suggestion-panel" aria-labelledby="faq-suggestion-title">
      <div className="panel-head faq-suggestion-head">
        <div>
          <div className="faq-suggestion-title-row">
            <span className="faq-suggestion-icon" aria-hidden="true"><Sparkles size={18} /></span>
            <div>
              <h2 id="faq-suggestion-title">FAQ 자동 제안</h2>
              <p>확정된 브랜드 정보에서 자주 묻는 질문 초안을 만듭니다.</p>
            </div>
          </div>
        </div>
        <button className="button primary" type="button" disabled={loading || creating || isWorking} onClick={() => void createSuggestions()}>
          <Sparkles size={16} /> {creating ? "제안 시작 중" : "FAQ 자동 제안"}
        </button>
      </div>

      <div className="panel-body faq-suggestion-body">
        <div className="faq-source-summary" aria-label="FAQ 제안에 사용할 정보">
          <span><Check size={15} /> 브랜드 코어</span>
          <span><Check size={15} /> 제품·서비스</span>
          <span><Check size={15} /> 대표 URL</span>
          <span><FileSearch size={15} /> 등록 문서</span>
        </div>
        {error ? <p className="faq-preview-notice is-error" role="alert">{error}</p> : null}
        {notice ? <p className="faq-preview-notice" role="status">{notice}</p> : null}
        {!run ? (
          <p className="muted faq-suggestion-hint">{loading ? "기존 FAQ 제안을 확인하고 있습니다." : "제안 결과는 초안으로 열리며 직접 수정한 뒤 승인할 수 있습니다."}</p>
        ) : (
          <section className="faq-suggestion-review" aria-labelledby="faq-suggestion-review-title">
            <header className="faq-review-head">
              <div>
                <h3 id="faq-suggestion-review-title">제안된 FAQ 검토</h3>
                <p>{runNotice(run)}</p>
              </div>
              <Badge variant={reviewCount ? "info" : "ok"}>{reviewCount}개 검토 중</Badge>
            </header>

            <div className="faq-suggestion-list">
              {run.items.map((item) => {
                const status = itemStatus(item);
                const actionable = item.status === "review" && busyItemId !== item.id;
                return <article className={`faq-suggestion-card is-${item.status}`} key={item.id}>
                  <header>
                    <label>
                      <span>카테고리</span>
                      <select
                        aria-label={`${item.question} 카테고리`}
                        value={item.category}
                        disabled={!actionable}
                        onChange={(event) => editItem(item.id, { category: event.target.value as FaqSuggestionCategory })}
                      >
                        {categoryOptions.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                      </select>
                    </label>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </header>
                  <div className="faq-editor-grid">
                    <label>
                      <span>질문</span>
                      <textarea
                        aria-label={`${categoryOptions.find(([value]) => value === item.category)?.[1] ?? "FAQ"} 질문`}
                        rows={2}
                        value={item.question}
                        disabled={!actionable}
                        onChange={(event) => editItem(item.id, { question: event.target.value })}
                      />
                    </label>
                    <label>
                      <span>답변</span>
                      <textarea
                        aria-label={`${categoryOptions.find(([value]) => value === item.category)?.[1] ?? "FAQ"} 답변`}
                        rows={4}
                        value={item.answer}
                        disabled={!actionable}
                        onChange={(event) => editItem(item.id, { answer: event.target.value })}
                      />
                    </label>
                  </div>
                  <FaqUtteranceEditor
                    values={item.exampleUtterances}
                    minItems={3}
                    disabled={!actionable}
                    onChange={(exampleUtterances) => editItem(item.id, { exampleUtterances })}
                  />
                  <footer>
                    <p><strong>근거</strong> {item.evidence.map((entry) => entry.label).join(", ") || "근거 없음"}</p>
                    <div className="actions">
                      <button className="button" type="button" disabled={!actionable} onClick={() => void dismiss(item)}>
                        <X size={15} /> 제외
                      </button>
                      <button className="button primary" type="button" disabled={
                        !actionable
                        || !item.question.trim()
                        || !item.answer.trim()
                        || Object.values(faqUtteranceValidation(item.exampleUtterances, 3)).some(Boolean)
                      } onClick={() => void approve(item)}>
                        <Check size={15} /> FAQ 승인
                      </button>
                    </div>
                  </footer>
                </article>;
              })}
              {!run.items.length && !isWorking ? <p className="muted faq-suggestion-hint">검토할 FAQ 제안이 없습니다.</p> : null}
            </div>
          </section>
        )}
      </div>
    </section>
  );
}
