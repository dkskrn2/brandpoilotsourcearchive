import { useEffect, useState } from "react";
import { ArrowLeft, CheckCircle2, PauseCircle, Send, UserRound } from "lucide-react";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { InlineSpinner, ListSkeleton } from "../ui/LoadingState";
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

function manualReplyErrorMessage(error: unknown) {
  const failure = typeof error === "object" && error !== null
    ? error as { errorCode?: unknown; requestId?: unknown; deliveryStatus?: unknown }
    : null;
  const errorCode = typeof failure?.errorCode === "string" ? failure.errorCode : "";
  const requestId = typeof failure?.requestId === "string" ? failure.requestId : null;

  if (errorCode === "dm_manual_reply_channel_not_ready") {
    return "Instagram 채널 인증이 준비되지 않았습니다. 채널 연결 상태를 확인해 주세요.";
  }
  if (["meta_graph_401", "meta_token_invalid"].includes(errorCode)) {
    return "Instagram 연결 토큰이 만료되었거나 메시지 권한이 없습니다. 채널을 다시 연결해 주세요.";
  }
  if (["meta_graph_403", "meta_permission_denied"].includes(errorCode)) {
    return "Instagram의 24시간 응답 시간이 지났거나 Meta 앱에 Human Agent 권한이 없습니다. Human Agent 권한을 승인한 뒤 다시 시도해 주세요.";
  }
  if (errorCode === "meta_graph_400" || errorCode === "meta_recipient_unavailable") {
    return "Instagram의 24시간 응답 가능 시간이 지났거나 수신자에게 메시지를 보낼 수 없습니다.";
  }
  if (failure?.deliveryStatus === "unknown" || /^meta_graph_5\d\d$/.test(errorCode) || errorCode === "meta_delivery_unknown") {
    return "Meta 응답을 확인하지 못해 발송 여부가 불명확합니다. 중복 발송을 피하려면 Instagram에서 먼저 확인해 주세요.";
  }
  if (errorCode === "meta_graph_429" || errorCode === "meta_temporarily_unavailable") {
    return "Meta가 일시적으로 요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
  }
  return `수동 답변 전송 중 알 수 없는 오류가 발생했습니다.${requestId ? ` 요청 ID: ${requestId}` : ""}`;
}

interface DmConversationThreadProps {
  detail: DmConversationDetail | null;
  loading: boolean;
  error: string | null;
  resolving: boolean;
  onBack(): void;
  onResolve(attentionId: string): void;
  onManualReply(body: string): Promise<void>;
}

export function DmConversationThread({ detail, loading, error, resolving, onBack, onResolve, onManualReply }: DmConversationThreadProps) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sendNotice, setSendNotice] = useState<string | null>(null);

  useEffect(() => {
    setBody("");
    setSendError(null);
    setSendNotice(null);
  }, [detail?.id]);

  async function submitManualReply() {
    const trimmed = body.trim();
    if (!trimmed || sending) return;
    setSending(true);
    setSendError(null);
    setSendNotice(null);
    try {
      await onManualReply(trimmed);
      setBody("");
      setSendNotice("수동 답변을 전송했습니다.");
    } catch (error) {
      setSendError(manualReplyErrorMessage(error));
    } finally {
      setSending(false);
    }
  }

  if (loading) return <section className="dm-thread"><ListSkeleton rows={5} columns={1} label="대화 내용을 불러오는 중입니다." /></section>;
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
      <div className="dm-manual-composer">
        <label htmlFor="dm-manual-reply">수동 답변</label>
        <div className="dm-manual-composer-row">
          <textarea
            id="dm-manual-reply"
            aria-label="수동 답변"
            value={body}
            maxLength={1000}
            rows={3}
            placeholder="고객에게 직접 보낼 답변을 입력하세요."
            onChange={(event) => setBody(event.target.value)}
          />
          <button
            className="button primary"
            type="button"
            aria-label="수동 답변 전송"
            aria-busy={sending}
            disabled={!body.trim() || sending}
            onClick={() => void submitManualReply()}
          >
            {sending ? <InlineSpinner label="수동 답변 전송 중" /> : <Send size={16} aria-hidden="true" />} 전송
          </button>
        </div>
        {sendNotice ? <p className="notice success" role="status">{sendNotice}</p> : null}
        {sendError ? <p className="dm-error-text" role="alert">{sendError}</p> : null}
      </div>
    </section>
  );
}
