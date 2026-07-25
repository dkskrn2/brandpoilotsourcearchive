import { CheckCircle2 } from "lucide-react";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { BadgeVariant, DmAttentionItem, DmAttentionType } from "../../types";

const typeMeta: Record<DmAttentionType, { label: string; variant: BadgeVariant }> = {
  restricted_action: { label: "제한 요청", variant: "warn" },
  complaint: { label: "불만", variant: "bad" },
  knowledge_gap: { label: "지식 부족", variant: "info" },
  delivery_unknown: { label: "발송 불명확", variant: "warn" },
  processing_error: { label: "처리 오류", variant: "bad" }
};

interface DmAttentionPanelProps {
  items: DmAttentionItem[];
  filter: DmAttentionType | "all";
  loading: boolean;
  error: string | null;
  resolvingId: string | null;
  onFilterChange(filter: DmAttentionType | "all"): void;
  onResolve(item: DmAttentionItem): void;
}

export function DmAttentionPanel({ items, filter, loading, error, resolvingId, onFilterChange, onResolve }: DmAttentionPanelProps) {
  return (
    <section className="dm-attention-panel">
      <div className="dm-section-toolbar">
        <div><h2>확인 필요</h2><p>자동응답이 중지된 요청을 검토하고 다시 시작합니다.</p></div>
        <Badge variant="warn">열림 {items.filter((item) => item.status === "open").length}건</Badge>
      </div>
      <div className="dm-filter-row" role="group" aria-label="확인 필요 유형 필터">
        <button className="dm-filter-button" type="button" aria-pressed={filter === "all"} onClick={() => onFilterChange("all")}>전체</button>
        {Object.entries(typeMeta).map(([type, meta]) => (
          <button className="dm-filter-button" type="button" key={type} aria-pressed={filter === type} onClick={() => onFilterChange(type as DmAttentionType)}>{meta.label}</button>
        ))}
      </div>
      {error ? <div className="dm-inline-error">{error}</div> : null}
      {loading ? <p className="dm-list-status">확인 필요 항목을 불러오는 중입니다.</p> : null}
      {!loading && !error && items.length === 0 ? <EmptyState title="확인할 항목이 없습니다" description="현재 담당자 확인이 필요한 DM 요청이 없습니다." /> : null}
      {!loading && !error ? (
        <div className="dm-attention-list">
          {items.map((item) => {
            const meta = typeMeta[item.type];
            return (
              <article className="dm-attention-row" key={item.id}>
                <div className="dm-attention-main">
                  <div className="actions"><Badge variant={meta.variant}>{meta.label}</Badge><Badge variant={item.status === "open" ? "warn" : "neutral"}>{item.status === "open" ? "자동응답 중지" : "확인 완료"}</Badge></div>
                  <blockquote>{item.originalMessage || "원문 메시지가 없습니다."}</blockquote>
                  <p>{item.reason || "담당자 확인이 필요한 요청입니다."}</p>
                  <span className="muted small">{new Date(item.createdAt).toLocaleString("ko-KR")} · 자동 안내 {item.autoReplyStatus === "sent" ? "발송됨" : item.autoReplyStatus === "not_sent" ? "미발송" : "확인 필요"}</span>
                </div>
                {item.status === "open" ? <button className="button primary" type="button" disabled={resolvingId === item.id} onClick={() => onResolve(item)}><CheckCircle2 size={16} /> {resolvingId === item.id ? "처리 중" : "확인 완료"}</button> : null}
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
