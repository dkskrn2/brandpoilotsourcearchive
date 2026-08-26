import { Clock3 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PublishOperationalReason, PublishOperationalStatus } from "../../types";
import { formatPublishDateTime, timeLabel, type CalendarEntry } from "../../features/publishing/publishCalendar";
import { publishErrorPresentation, publishStatusPresentation } from "../../features/publishing/publishPresentation";
import { Badge } from "../ui/Badge";
import { PublishManagementPreview, type PublishCardPreview } from "./PublishManagementPreview";

export type PresentedCalendarEntry = CalendarEntry & {
  operationalStatus: PublishOperationalStatus;
  operationalReason: PublishOperationalReason;
  preview?: PublishCardPreview;
};

type Props = {
  dateKey: string;
  entries: PresentedCalendarEntry[];
  selectedId: string | null;
  slotsLoading: boolean;
  slotsError: string | null;
  assignableContents: Array<{ id: string; title: string }>;
  onSelectEntry(id: string | null): void;
  onAssign(slotId: string, content: { id: string; title: string }): Promise<boolean>;
  onCancel(id: string): void;
  onRescheduleItem(itemKey: string, trigger: HTMLButtonElement): void;
  onOpenContentPicker(trigger: HTMLButtonElement): void;
  hideEntryList?: boolean;
};

const channelLabel = { instagram: "Instagram", threads: "Threads", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", x: "X" } as const;

function fullDate(key: string) {
  const [, month, day] = key.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

function detailTimes(entry: CalendarEntry) {
  if (entry.status === "published") return [{ label: "게시 완료 시각", value: entry.publishedAt ?? entry.calendarDate }];
  if (entry.scheduledFor && entry.effectiveScheduledFor && entry.scheduledFor !== entry.effectiveScheduledFor) {
    return [{ label: "원래 예약 시각", value: entry.scheduledFor }, { label: "지연 후 실제 게시 예정", value: entry.effectiveScheduledFor }];
  }
  return [{ label: "게시 예정 시각", value: entry.scheduledFor ?? entry.effectiveScheduledFor ?? entry.calendarDate }];
}

export function PublishDateDetail({ dateKey, entries, selectedId, slotsLoading, slotsError, assignableContents, onSelectEntry, onAssign, onCancel, onRescheduleItem, onOpenContentPicker, hideEntryList = false }: Props) {
  const [assignedContentId, setAssignedContentId] = useState("");
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const selectedPresentation = selected ? publishStatusPresentation(selected.operationalStatus) : null;

  useEffect(() => { setAssignedContentId(""); }, [dateKey, selectedId]);
  useEffect(() => {
    if (!selected) return;
    const stacked = window.matchMedia?.("(max-width: 980px)").matches;
    detailHeadingRef.current?.focus(stacked ? undefined : { preventScroll: true });
    if (stacked) detailHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [selected]);

  return <aside className="publish-calendar-detail" aria-label={selected ? `${selected.title} 슬롯 상세` : `${fullDate(dateKey)} 게시 일정`}>
    <header className="publish-calendar-detail__header"><div><span>{selected ? "슬롯 상세" : "선택한 날짜"}</span><h2 ref={detailHeadingRef} tabIndex={-1}>{selected ? selected.title : fullDate(dateKey)}</h2></div><Badge variant={selectedPresentation?.variant ?? "neutral"}>{selectedPresentation?.label ?? `${entries.length}개 일정`}</Badge></header>
    {slotsLoading ? <p role="status" aria-label="캘린더 슬롯을 불러오는 중입니다.">캘린더 슬롯을 불러오는 중입니다.</p> : slotsError ? <p role="alert">{slotsError}</p> : selected ? <div className="publish-calendar-slot-detail">
      {selected.preview ? <div className="publish-calendar-slot-detail__preview"><PublishManagementPreview title={selected.title} preview={selected.preview} /></div> : null}
      <div className="publish-calendar-slot-detail__time"><Clock3 size={18} /><span>{detailTimes(selected).map((time) => <span key={time.label}><small>{time.label}</small><strong>{formatPublishDateTime(time.value)}</strong></span>)}</span></div>
      <dl><div><dt>게시 방식</dt><dd>{selected.mode === "automatic" ? "자동" : "수동"} 게시</dd></div>{selected.recommendationKind ? <div><dt>추천 종류</dt><dd>{selected.recommendationKind === "trend" ? "트렌드성 추천" : "정보성 추천"}</dd></div> : null}<div><dt>콘텐츠 형식</dt><dd>{selected.contentFormat === "reel" ? "릴스" : selected.contentFormat === "card_news" ? "카드뉴스" : "설정 전"}</dd></div><div><dt>게시 채널</dt><dd>{selected.channels.map((channel) => channelLabel[channel]).join(", ") || "채널 설정 전"}</dd></div>{selected.lastError ? <div><dt>상태·오류</dt><dd>{publishErrorPresentation(selected.lastError).message}</dd></div> : null}</dl>
      {selected.status === "open" ? <div className="publish-calendar-manual-form"><label>배정할 콘텐츠<select aria-label="배정할 콘텐츠" value={assignedContentId} onChange={(event) => setAssignedContentId(event.target.value)}><option value="">콘텐츠 선택</option>{assignableContents.map((content) => <option value={content.id} key={content.id}>{content.title}</option>)}</select></label><button className="button primary" type="button" disabled={!assignedContentId} onClick={() => { const content = assignableContents.find((item) => item.id === assignedContentId); if (content) void onAssign(selected.id, content).then((assigned) => { if (assigned) setAssignedContentId(""); }); }}>선택 콘텐츠 배정</button></div> : null}
      {selected.reschedulable ? <button className="button primary" type="button" onClick={(event) => onRescheduleItem(selected.id, event.currentTarget)}>예약 변경</button> : null}
      {(selected.cancellable ?? !["published", "cancelled", "publishing"].includes(selected.status)) ? <button className="button" type="button" onClick={() => onCancel(selected.id)}>슬롯 취소</button> : null}
      <button className="button" type="button" onClick={() => onSelectEntry(null)}>전체 일정 보기</button>
    </div> : hideEntryList ? null : <div className="publish-calendar-detail__list">
      {entries.map((entry) => { const presentation = publishStatusPresentation(entry.operationalStatus); return <button className={`publish-calendar-entry ${presentation.className}`} type="button" aria-label={`${entry.title} ${presentation.label} 일정 선택`} onClick={() => onSelectEntry(entry.id)} key={entry.id}><span>{timeLabel(entry)}</span><strong>{entry.title}</strong><Badge variant={presentation.variant}>{presentation.label}</Badge></button>; })}
    </div>}
    <div className="publish-calendar-detail__actions"><button className="button primary" type="button" onClick={(event) => onOpenContentPicker(event.currentTarget)}>콘텐츠 추가</button></div>
  </aside>;
}
