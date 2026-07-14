import { ArrowLeft, CheckCircle2, PauseCircle, UserRound } from "lucide-react";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { DmConversationDetail, DmConversationMessage, DmReasonCode } from "../../types";

const reasonLabels: Record<DmReasonCode, string> = {
  direct_faq: "FAQ 직접 답변",
  wiki_answer: "Wiki 답변",
  restricted_action: "제한 요청",
  complaint: "불만",
  knowledge_gap: "지식 부족",
  low_confidence: "낮은 신뢰도",
  processing_error: "처리 오류",
  system_event: "시스템 처리"
};

function dateKey(value: string) {
  return new Date(value).toLocaleDateString("ko-KR", { year: "numeric", month: "long", day: "numeric" });
}

function directionLabel(detail: DmConversationDetail, message: DmConversationMessage) {
  const user = detail.participant.username ? `@${detail.participant.username.replace(/^@/, "")}` : "@사용자";
  return message.direction === "inbound" ? `${user} → @브랜드` : `@브랜드 → ${user}`;
}

interface DmConversationThreadProps {
  detail: DmConversationDetail | null;
  loading: boolean;
  error: string | null;
  resolving: boolean;
  onBack(): void;
  onResolve(attentionId: string): void;
}

export function DmConversationThread({ detail, loading, error, resolving, onBack, onResolve }: DmConversationThreadProps) {
  if (loading) return <section className="dm-thread dm-thread-centered">대화 내용을 불러오는 중입니다.</section>;
  if (error) return <section className="dm-thread dm-thread-centered dm-error-text">{error}</section>;
  if (!detail) return <section className="dm-thread"><EmptyState title="대화를 선택하세요" description="왼쪽 목록에서 확인할 Instagram DM 대화를 선택하세요." /></section>;

  let previousDate = "";
  const openAttention = detail.attentionItems.find((item) => item.status === "open");
  const participantName = detail.participant.displayName || detail.participant.username || `사용자-${detail.participant.instagramScopedId.slice(-6)}`;

  return (
    <section className="dm-thread" aria-label={`${participantName} 대화 내용`}>
      <header className="dm-thread-head">
        <button className="dm-mobile-back" type="button" onClick={onBack} aria-label="대화 목록으로 돌아가기"><ArrowLeft size={18} /></button>
        <span className="dm-avatar" aria-hidden="true">
          {detail.participant.profileImageUrl ? <img src={detail.participant.profileImageUrl} alt="" /> : <UserRound size={19} />}
        </span>
        <div>
          <h2>{participantName}</h2>
          <span className="muted small">{detail.participant.username ? `@${detail.participant.username.replace(/^@/, "")}` : "Instagram 사용자"}</span>
        </div>
        <Badge variant={detail.automationStatus === "active" ? "ok" : "warn"}>{detail.automationStatus === "active" ? "자동응답 중" : "자동응답 중지"}</Badge>
      </header>

      {detail.automationStatus === "paused" ? (
        <div className="dm-pause-band">
          <PauseCircle size={20} />
          <div><strong>담당자 확인이 필요합니다</strong><span>확인을 완료하면 이 대화의 자동응답이 다시 시작됩니다.</span></div>
          <button className="button primary" type="button" disabled={!openAttention || resolving} onClick={() => openAttention && onResolve(openAttention.id)}>
            <CheckCircle2 size={16} /> {resolving ? "처리 중" : "확인 완료"}
          </button>
        </div>
      ) : null}

      <div className="dm-message-stream">
        {detail.messages.length === 0 ? <EmptyState title="메시지가 없습니다" description="이 대화에 저장된 메시지가 없습니다." /> : null}
        {detail.messages.map((message) => {
          const currentDate = dateKey(message.createdAt);
          const showDate = currentDate !== previousDate;
          previousDate = currentDate;
          return (
            <div key={message.id}>
              {showDate ? <div className="dm-date-divider"><span>{currentDate}</span></div> : null}
              <article className={`dm-message ${message.direction}`}>
                <span className="dm-direction-label">{directionLabel(detail, message)}</span>
                <div className="dm-bubble">{message.body || "텍스트 외 메시지"}</div>
                <div className="dm-message-meta">
                  <time>{new Date(message.createdAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}</time>
                  {message.reasonCode ? <span>{reasonLabels[message.reasonCode]}</span> : null}
                  {message.sourceLabel ? <span>근거: {message.sourceLabel}</span> : null}
                  {message.deliveryStatus ? <span>발송: {message.deliveryStatus}</span> : null}
                </div>
              </article>
            </div>
          );
        })}
      </div>
    </section>
  );
}
