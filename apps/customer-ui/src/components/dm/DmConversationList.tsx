import { AlertCircle, MessageCircle, UserRound } from "lucide-react";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import { InlineSpinner, ListSkeleton } from "../ui/LoadingState";
import type { DmConversationFilter, DmConversationSummary } from "../../types";

const filters: Array<{ id: DmConversationFilter; label: string }> = [
  { id: "all", label: "전체" },
  { id: "complaint", label: "불만" },
  { id: "unanswered", label: "미답변" },
  { id: "error", label: "오류" }
];

function participantLabel(item: DmConversationSummary) {
  return item.participant.displayName || item.participant.username || `사용자-${item.participant.instagramScopedId.slice(-6)}`;
}

function participantHandle(item: DmConversationSummary) {
  return item.participant.username ? `@${item.participant.username.replace(/^@/, "")}` : "Instagram 사용자";
}

interface DmConversationListProps {
  conversations: DmConversationSummary[];
  selectedId: string | null;
  filter: DmConversationFilter;
  loading: boolean;
  loadingMore: boolean;
  nextCursor: string | null;
  error: string | null;
  onFilterChange(filter: DmConversationFilter): void;
  onSelect(conversationId: string): void;
  onLoadMore(): void;
}

export function DmConversationList({
  conversations,
  selectedId,
  filter,
  loading,
  loadingMore,
  nextCursor,
  error,
  onFilterChange,
  onSelect,
  onLoadMore
}: DmConversationListProps) {
  return (
    <aside className="dm-conversation-list" aria-label="DM 대화 목록">
      <div className="dm-list-head">
        <div>
          <h2>대화</h2>
          <span className="muted small">최근 메시지 순</span>
        </div>
        <Badge variant="info">{conversations.length}개</Badge>
      </div>
      <div className="dm-filter-row" role="group" aria-label="대화 필터">
        {filters.map((item) => (
          <button
            className="dm-filter-button"
            type="button"
            key={item.id}
            aria-pressed={filter === item.id}
            onClick={() => onFilterChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      {error ? <div className="dm-inline-error"><AlertCircle size={16} />{error}</div> : null}
      {loading ? <ListSkeleton rows={6} columns={1} label="대화 목록을 불러오는 중입니다." /> : null}
      {!loading && !error && conversations.length === 0 ? (
        <EmptyState title="대화가 없습니다" description="선택한 조건에 해당하는 Instagram DM 대화가 없습니다." />
      ) : null}
      {!loading && !error ? (
        <div className="dm-conversation-rows">
          {conversations.map((item) => (
            <button
              className="dm-conversation-row"
              data-selected={selectedId === item.id}
              type="button"
              key={item.id}
              onClick={() => onSelect(item.id)}
              aria-label={`${participantLabel(item)} 대화 열기`}
            >
              <span className="dm-avatar" aria-hidden="true">
                {item.participant.profileImageUrl ? <img src={item.participant.profileImageUrl} alt="" /> : <UserRound size={19} />}
              </span>
              <span className="dm-conversation-copy">
                <span className="dm-conversation-title">
                  <strong>{participantLabel(item)}</strong>
                  <time>{item.lastMessage ? new Date(item.lastMessage.createdAt).toLocaleString("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "-"}</time>
                </span>
                <span className="dm-handle">{participantHandle(item)}</span>
                <span className="dm-last-message">
                  {item.lastMessage?.direction === "outbound" ? "보냄: " : ""}{item.lastMessage?.body || "텍스트 외 메시지"}
                </span>
                <span className="dm-row-badges">
                  {item.attentionStatus === "open" ? <Badge variant="warn"><AlertCircle size={12} /> 확인 필요</Badge> : null}
                  {item.unreadCount > 0 ? <Badge variant="info"><MessageCircle size={12} /> {item.unreadCount}</Badge> : null}
                </span>
              </span>
            </button>
          ))}
          {nextCursor ? (
            <button className="button secondary dm-load-more" type="button" aria-label="대화 더 보기" aria-busy={loadingMore} disabled={loadingMore} onClick={onLoadMore}>
              {loadingMore ? <InlineSpinner label="대화 목록 추가 로딩 중" /> : null} 대화 더 보기
            </button>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
