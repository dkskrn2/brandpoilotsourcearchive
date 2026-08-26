import { X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { PublishCalendarManualOptions, PublishCalendarManualSlotInput, PublishCalendarManualSlotSource, PublishItem } from "../../types";
import { dateKey, defaultScheduleTime, formatPublishDateTime } from "../../features/publishing/publishCalendar";
import { FocusTrap } from "../ui/FocusTrap";

type SubmitResult =
  | { ok: true; refreshFailed: boolean }
  | { ok: false; errorCode: string | null; existingCalendarDate?: string | null };

type Props = {
  mode?: "create" | "edit";
  item: PublishItem;
  options: PublishCalendarManualOptions | null;
  optionsError: string | null;
  optionsLoading: boolean;
  initialDateKey: string;
  preferredTimes?: readonly string[];
  onSubmit(input: PublishCalendarManualSlotInput | { scheduledFor: string }): Promise<SubmitResult>;
  onSaved(result: { refreshFailed: boolean }): void;
  onOpenExistingReservation(itemKey: string, calendarDate: string | null): void;
  onRetryOptions(): void;
  onClose(): void;
};

const contentFormatLabel = { card_news: "카드뉴스", reel: "릴스" } as const;

export function publishScheduleSource(item: PublishItem): PublishCalendarManualSlotSource | null {
  if (item.sourceRefs.generationOutputId) return { kind: "existing_output", generationOutputId: item.sourceRefs.generationOutputId };
  if (item.sourceRefs.generationId) return { kind: "existing_generation", generationId: item.sourceRefs.generationId };
  if (item.sourceRefs.contentTopicId) return { kind: "existing_content_topic", contentTopicId: item.sourceRefs.contentTopicId };
  return null;
}

export function canSchedulePublishItem(item: PublishItem) {
  return item.schedulable
    && item.calendarPlacement === "unreserved"
    && ["pre_generation", "generating", "completed_unpublished"].includes(item.status)
    && item.contentFormat !== null
    && publishScheduleSource(item) !== null;
}

function sourceLabel(source: PublishCalendarManualSlotSource | null) {
  if (source?.kind === "existing_output") return "생성 완료 콘텐츠";
  if (source?.kind === "existing_generation") return "생성 중 콘텐츠";
  if (source?.kind === "existing_content_topic") return "생성 전 주제";
  return "예약 불가 콘텐츠";
}

export function scheduleErrorMessage(errorCode: string | null, options: PublishCalendarManualOptions | null) {
  if (errorCode === "publish_calendar_subscription_inactive") return "게시 예약을 사용하려면 구독 플랜을 확인해 주세요.";
  if (errorCode === "publish_weekly_quota_exceeded") {
    const reset = options?.usage.endsAt
      ? new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }).format(new Date(options.usage.endsAt))
      : "다음 게시 주기";
    return `이번 게시 주기의 남은 예약 한도가 없습니다. ${reset} 이후 다시 예약해 주세요.`;
  }
  if (errorCode === "publish_calendar_time_past") return "선택한 게시 시각이 지났습니다. 미래 시각을 선택해 주세요.";
  if (errorCode === "publish_calendar_channel_not_connected") return "게시하려면 Instagram 연결이 필요합니다.";
  if (errorCode === "publish_calendar_content_format_mismatch") return "콘텐츠 형식이 Instagram 게시 형식과 일치하지 않습니다.";
  if (errorCode === "publish_calendar_content_already_scheduled") return "이미 예약된 콘텐츠입니다. 기존 예약 상세를 엽니다.";
  if (errorCode === "publish_calendar_slot_not_reschedulable") return "게시가 시작되었거나 결과 확인이 필요한 예약은 변경할 수 없습니다.";
  if (errorCode === "publish_calendar_slot_not_found") return "예약 정보를 찾지 못했습니다. 목록을 새로고침해 주세요.";
  if (errorCode === "tenant_scope_rejected" || errorCode === "workspace_access_denied") {
    return "이 콘텐츠는 현재 브랜드에서 예약할 수 없습니다.";
  }
  return "게시 예약을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.";
}

function toScheduledFor(date: string, time: string) {
  const value = new Date(`${date}T${time}:00+09:00`);
  return Number.isFinite(value.getTime()) ? value : null;
}

function seoulTime(value: string | null) {
  if (!value) return "11:30";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(value));
  return `${parts.find((part) => part.type === "hour")?.value}:${parts.find((part) => part.type === "minute")?.value}`;
}

function initialScheduleValue(editing: boolean, item: PublishItem, initialDateKey: string, preferredTimes: readonly string[]) {
  if (editing && item.operationalStatus !== "delayed_today") {
    return { date: initialDateKey, time: seoulTime(item.scheduledFor) };
  }
  const now = new Date();
  const time = defaultScheduleTime(initialDateKey, now, preferredTimes);
  const scheduledFor = toScheduledFor(initialDateKey, time);
  if (initialDateKey === dateKey(now) && scheduledFor && scheduledFor.getTime() <= now.getTime()) {
    const fiveMinutes = 5 * 60 * 1000;
    const earliest = new Date(Math.ceil((now.getTime() + 15 * 60 * 1000) / fiveMinutes) * fiveMinutes);
    return { date: dateKey(earliest), time };
  }
  return { date: initialDateKey, time };
}

export function PublishSchedulePanel({ mode = "create", item, options, optionsError, optionsLoading, initialDateKey, preferredTimes = [], onSubmit, onSaved, onOpenExistingReservation, onRetryOptions, onClose }: Props) {
  const editing = mode === "edit";
  const preferredTimesKey = preferredTimes.join("\u0000");
  const initialValue = initialScheduleValue(editing, item, initialDateKey, preferredTimes);
  const [date, setDate] = useState(initialValue.date);
  const [time, setTime] = useState(initialValue.time);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const dateEditedRef = useRef(false);
  const timeEditedRef = useRef(false);
  const source = publishScheduleSource(item);
  const instagram = options?.channels.find((channel) => channel.value === "instagram") ?? null;
  const connected = Boolean(instagram);
  const formatSupported = Boolean(item.contentFormat && instagram?.formats.some((format) => format.value === item.contentFormat));
  const quotaAvailable = editing || (options?.usage.publishing.additionalAvailable ?? 0) > 0;
  const scheduledFor = toScheduledFor(date, time);
  const past = Boolean(scheduledFor && scheduledFor.getTime() <= Date.now());

  useEffect(() => {
    const next = initialScheduleValue(editing, item, initialDateKey, preferredTimes);
    setDate(next.date);
    setTime(next.time);
    dateEditedRef.current = false;
    timeEditedRef.current = false;
    setError(null);
    setSubmitting(false);
    idempotencyKeyRef.current = crypto.randomUUID();
  }, [editing, initialDateKey, item.itemKey, item.scheduledFor]);

  useEffect(() => {
    if (timeEditedRef.current) return;
    const selectedDate = dateEditedRef.current ? date : initialDateKey;
    const next = initialScheduleValue(editing && !dateEditedRef.current, item, selectedDate, preferredTimesKey ? preferredTimesKey.split("\u0000") : []);
    if (!dateEditedRef.current) setDate(next.date);
    setTime(next.time);
  }, [preferredTimesKey]);

  async function submit() {
    if (submitting) return;
    if (!scheduledFor || past) { setError(scheduleErrorMessage("publish_calendar_time_past", options)); return; }
    if (!editing && !connected) { setError(scheduleErrorMessage("publish_calendar_channel_not_connected", options)); return; }
    if (!editing && (!source || !item.contentFormat || !formatSupported)) { setError("이 콘텐츠 형식은 현재 Instagram 게시 설정과 일치하지 않습니다."); return; }
    if (!editing && !quotaAvailable) { setError(scheduleErrorMessage("publish_weekly_quota_exceeded", options)); return; }
    setSubmitting(true);
    setError(null);
    try {
      const result = await onSubmit(editing
        ? { scheduledFor: scheduledFor.toISOString() }
        : {
            scheduledFor: scheduledFor.toISOString(),
            channel: "instagram",
            contentFormat: item.contentFormat!,
            idempotencyKey: idempotencyKeyRef.current,
            source: source!,
          });
      if (result.ok) {
        onSaved({ refreshFailed: result.refreshFailed });
        onClose();
        return;
      }
      const message = scheduleErrorMessage(result.errorCode, options);
      setError(message);
      if (result.errorCode === "publish_calendar_content_already_scheduled") onOpenExistingReservation(item.itemKey, result.existingCalendarDate ?? null);
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = editing
    ? !scheduledFor || past || submitting
    : optionsLoading || !options || !source || !item.contentFormat || !connected || !formatSupported || !quotaAvailable || !scheduledFor || past || submitting;
  const actionLabel = editing ? "예약 변경" : "게시 예약";
  return <div className="modal-backdrop"><FocusTrap active initialFocusSelector=".publish-schedule-panel__close" className="modal-panel publish-schedule-panel" role="dialog" aria-modal="true" aria-label={`${item.title} ${editing ? "예약 변경" : "게시 설정"}`} onKeyDown={(event) => event.key === "Escape" && onClose()}>
    <header className="publish-calendar-detail__header"><div><span>{editing ? "예약 변경" : "게시 설정"}</span><h2>{item.title}</h2></div><button className="button icon-button publish-schedule-panel__close" type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button></header>
    <div className="publish-calendar-slot-detail">
      <dl>
        <div><dt>선택 콘텐츠</dt><dd>{item.title}</dd></div>
        <div><dt>콘텐츠 상태</dt><dd>{sourceLabel(source)}</dd></div>
        <div><dt>콘텐츠 형식</dt><dd>{item.contentFormat ? contentFormatLabel[item.contentFormat] : "설정 전"}</dd></div>
        <div><dt>게시 채널</dt><dd>{editing ? item.channels.map((channel) => channel === "instagram" ? "Instagram" : channel).join(", ") || "Instagram" : options ? (connected ? "Instagram 연결됨" : "Instagram 연결 필요") : "Instagram"}</dd></div>
        {editing && item.scheduledFor ? <div><dt>원래 예약 시각</dt><dd>{formatPublishDateTime(item.scheduledFor)}</dd></div> : null}
        {editing && item.effectiveScheduledFor && item.effectiveScheduledFor !== item.scheduledFor ? <div><dt>현재 게시 예정 시각</dt><dd>{formatPublishDateTime(item.effectiveScheduledFor)}</dd></div> : null}
      </dl>
      {!editing && optionsLoading ? <p role="status">게시 설정을 불러오는 중입니다.</p> : null}
      {!editing && optionsError ? <div><p role="alert">{optionsError}</p><button className="button" type="button" onClick={onRetryOptions}>게시 설정 다시 불러오기</button></div> : null}
      {!editing && !optionsLoading && options && !connected ? <p role="alert">Instagram 연결이 필요합니다.</p> : null}
      {!editing && !optionsLoading && options && item.contentFormat && connected && !formatSupported ? <p role="alert">이 콘텐츠 형식은 현재 Instagram 게시 설정과 일치하지 않습니다.</p> : null}
      {!editing && options?.usage.publishing ? <p>이번 주 추가 예약 가능 {options.usage.publishing.additionalAvailable}건 · 게시 한도 {options.usage.publishing.limit}건</p> : null}
      {!editing && options && !quotaAvailable ? <p role="alert">{scheduleErrorMessage("publish_weekly_quota_exceeded", options)}</p> : null}
      <div className="publish-calendar-manual-form">
        <label>게시 날짜<input aria-label="게시 날짜" type="date" value={date} onChange={(event) => { dateEditedRef.current = true; const next = initialScheduleValue(false, item, event.target.value, preferredTimes); setDate(next.date); setTime(next.time); setError(null); }} /></label>
        <label>게시 시간<input aria-label="게시 시간" type="time" value={time} onChange={(event) => { timeEditedRef.current = true; setTime(event.target.value); setError(null); }} /></label>
      </div>
      <p><strong>선택한 게시 시각</strong> {scheduledFor ? formatPublishDateTime(scheduledFor) : "날짜와 시간을 선택해 주세요."}</p>
      {past ? <p role="alert">선택한 게시 시각이 지났습니다. 미래 시각을 선택해 주세요.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
    </div>
    <footer className="auto-publish-settings__footer"><button className="button" type="button" onClick={onClose}>취소</button><button className="button primary" type="button" disabled={disabled} onClick={() => void submit()}>{submitting ? (editing ? "변경 중" : "예약 중") : actionLabel}</button></footer>
  </FocusTrap></div>;
}
