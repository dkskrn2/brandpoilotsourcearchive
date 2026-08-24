import { CalendarDays, ChevronLeft, ChevronRight, Clock3, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChannelType, PublishCalendarManualOptions, PublishCalendarNewContentSetup, PublishCalendarSettings, PublishItem } from "../../types";
import { dateKey, monthCells, timeLabel, type CalendarEntry } from "../../features/publishing/publishCalendar";
import { ChannelLogo } from "../channels/ChannelLogo";
import { Badge } from "../ui/Badge";
import { FocusTrap } from "../ui/FocusTrap";
import { ManualPublishProvisioner } from "./ManualPublishProvisioner";
import { PublishManagementPreview, resolvePublishPreview, type PublishCardPreview } from "./PublishManagementPreview";
import type { PublishCalendarBulkDraft, PublishCalendarBulkDraftRow } from "../../features/publishing/publishCalendarBulkDraft";

type Props = {
  monthKey: string;
  entries: CalendarEntry[];
  connectedChannels: ChannelType[];
  settings: PublishCalendarSettings | null;
  settingsError: string | null;
  slotsError: string | null;
  slotsLoading: boolean;
  unreservedItems?: PublishItem[];
  generatedPreviews?: ReadonlyMap<string, PublishCardPreview>;
  focusedItemKey?: string | null;
  onFocusedItemHandled?(): void;
  assignableContents: Array<{ id: string; title: string }>;
  manualOptions: PublishCalendarManualOptions | null;
  manualOptionsError: string | null;
  manualOptionsLoading?: boolean;
  onMonthChange(value: string): void;
  onStartNew(input: { scheduledFor: string; contentFormat: "card_news" | "reel"; setup: PublishCalendarNewContentSetup }): void;
  initialBulkDraft: PublishCalendarBulkDraft | null;
  onStartBulk(rows: PublishCalendarBulkDraftRow[]): void;
  onContinueBulk(draft: PublishCalendarBulkDraft, row: PublishCalendarBulkDraftRow): void;
  onProvisionBatch(draft: PublishCalendarBulkDraft): Promise<boolean>;
  onAssign(slotId: string, content: { id: string; title: string }): Promise<boolean>;
  onCancel(id: string): void;
  onScheduleItem(item: PublishItem, dateKey: string, trigger: HTMLButtonElement): void;
  onLoadManualOptions(): void;
  onSaveSettings(input: Omit<PublishCalendarSettings, "brandId" | "updatedAt">): Promise<{ ok: boolean; message?: string }>;
  saving?: boolean;
};

const label: Record<string, string> = { open: "추천 대기", proposal_assigned: "추천 배정", generation_pending: "생성 대기", content_assigned: "콘텐츠 배정", ready: "게시 준비", pre_generation: "생성 전", generating: "생성 중", completed_unpublished: "미게시", reserved: "예약 · 생성 대기", publish_queued: "게시 대기", scheduled: "예약", deferred: "게시 지연", publishing: "게시 중", partially_published: "일부 게시", publish_delayed: "게시 지연", quota_blocked: "한도 대기", published: "완료", failed: "실패", result_unknown: "결과 확인 필요", cancelled: "취소" };
const variant = (status: string) => status === "published" || status === "ready" ? "ok" : status === "publish_delayed" || status === "quota_blocked" || status === "deferred" || status === "partially_published" || status === "result_unknown" ? "warn" : status === "failed" ? "bad" : status === "cancelled" ? "neutral" : "info" as const;
const channelLabel: Record<ChannelType, string> = { instagram: "Instagram", threads: "Threads", tiktok: "TikTok", youtube: "YouTube", linkedin: "LinkedIn", x: "X" };
const detailTimeFormatter = new Intl.DateTimeFormat("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const unreservedPageSize = 6;

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}
function fullDate(key: string) { const [, month, day] = key.split("-"); return `${Number(month)}월 ${Number(day)}일`; }
function generatedMediaPreview(item: PublishItem, generatedPreviews: ReadonlyMap<string, PublishCardPreview>): PublishCardPreview | null {
  if (item.contentStatus !== "completed") return null;
  const target = item.targets.find((candidate) => candidate.artifactPublicUrl || candidate.previewBody || candidate.previewTitle) ?? item.targets[0];
  const reviewTarget = item.reviewTargets.find((candidate) => candidate.previewBody || candidate.previewTitle) ?? item.reviewTargets[0];
  const preview = resolvePublishPreview({
    title: item.title,
    artifactPublicUrl: target?.artifactPublicUrl,
    outputJson: target?.outputJson ?? reviewTarget?.outputJson,
    previewBody: target?.previewBody ?? reviewTarget?.previewBody
  });
  if (preview.kind === "image" || preview.kind === "video") return preview;
  return item.sourceRefs.generationOutputId
    ? generatedPreviews.get(item.sourceRefs.generationOutputId) ?? null
    : null;
}
function detailTimes(entry: CalendarEntry) {
  if (entry.status === "published") return [{ label: "게시 완료 시각", value: entry.publishedAt ?? entry.calendarDate }];
  if (entry.scheduledFor && entry.effectiveScheduledFor && entry.scheduledFor !== entry.effectiveScheduledFor) {
    return [{ label: "원래 예약 시각", value: entry.scheduledFor }, { label: "지연 후 실제 게시 예정", value: entry.effectiveScheduledFor }];
  }
  return [{ label: "게시 예정 시각", value: entry.scheduledFor ?? entry.effectiveScheduledFor ?? entry.calendarDate }];
}
function SettingsDialog({ settings, channels, onClose, onSave, saving }: { settings: PublishCalendarSettings; channels: ChannelType[]; onClose(): void; onSave: Props["onSaveSettings"]; saving?: boolean }) {
  const [enabled, setEnabled] = useState(settings.enabled);
  const [informationalFormat, setInformationalFormat] = useState(settings.informationalFormat);
  const [trendFormat, setTrendFormat] = useState(settings.trendFormat);
  const [slotTimes, setSlotTimes] = useState(settings.slotTimes.join(", "));
  const [error, setError] = useState<string | null>(null);
  const instagramAvailable = channels.includes("instagram");
  useEffect(() => { setEnabled(settings.enabled); setInformationalFormat(settings.informationalFormat); setTrendFormat(settings.trendFormat); setSlotTimes(settings.slotTimes.join(", ")); }, [settings]);
  async function save() {
    if (enabled && !instagramAvailable) { setError("연결·활성화된 Instagram 채널이 필요합니다."); return; }
    const times = slotTimes.split(",").map((time) => time.trim()).filter(Boolean);
    if (times.length === 0 || times.some((time) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(time))) { setError("게시 시간은 HH:mm 형식으로 입력해 주세요."); return; }
    setError(null);
    const result = await onSave({ enabled, channels: enabled ? ["instagram"] : [], informationalFormat, trendFormat, slotTimes: times });
    if (result.ok) onClose(); else setError(result.message ?? "자동 게시 설정을 저장하지 못했습니다.");
  }
  return <div className="modal-backdrop"><FocusTrap active initialFocusSelector=".auto-publish-settings__close" className="modal-panel auto-publish-settings" role="dialog" aria-modal="true" aria-label="자동 게시 설정" onKeyDown={(event) => event.key === "Escape" && onClose()}>
    <header className="auto-publish-settings__header"><div><span className="publish-calendar-eyebrow"><Settings2 size={15} aria-hidden="true" /> 자동 게시</span><h2>자동 게시 설정</h2><p>기존 일일 추천의 정보성·트렌드 주제와 형식을 미리 선택합니다.</p></div><button className="button icon-button auto-publish-settings__close" type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button></header>
    <div className="auto-publish-settings__body">
      <label className="auto-publish-channel"><input type="checkbox" role="switch" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={!instagramAvailable} /><span><strong>{enabled ? "사용 중" : "사용 안 함"}</strong><small>{instagramAvailable ? "연결·활성화된 Instagram 채널에서만 자동 배정합니다." : "연결·활성화된 Instagram 채널이 없어 자동 배정을 켤 수 없습니다."}</small></span></label>
      <fieldset className="auto-publish-settings__section"><legend>게시 채널</legend><p>{instagramAvailable ? "Instagram 연결됨" : "Instagram 연결 없음"}</p></fieldset>
      <label className="auto-publish-settings__section"><span>게시 시간 (쉼표로 구분)</span><input aria-label="게시 시간" value={slotTimes} onChange={(event) => setSlotTimes(event.target.value)} /></label>
      <fieldset className="auto-publish-settings__section"><legend>정보성 추천 형식</legend><div className="auto-publish-format-grid" role="radiogroup" aria-label="정보성 콘텐츠 형식">{(["card_news", "reel"] as const).map((format) => <label key={format}><input type="radio" name="informational" checked={informationalFormat === format} onChange={() => setInformationalFormat(format)} />{format === "card_news" ? "카드뉴스" : "릴스"}</label>)}</div></fieldset>
      <fieldset className="auto-publish-settings__section"><legend>트렌드성 추천 형식</legend><div className="auto-publish-format-grid" role="radiogroup" aria-label="트렌드성 콘텐츠 형식">{(["card_news", "reel"] as const).map((format) => <label key={format}><input type="radio" name="trend" checked={trendFormat === format} onChange={() => setTrendFormat(format)} />{format === "card_news" ? "카드뉴스" : "릴스"}</label>)}</div></fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </div>
    <footer className="auto-publish-settings__footer"><small>형식을 고르지 않으면 백엔드 기본값이 적용됩니다.</small><div className="actions"><button className="button" type="button" onClick={onClose}>취소</button><button className="button primary" type="button" disabled={saving || slotTimes.trim().length === 0} onClick={save}>설정 저장</button></div></footer>
  </FocusTrap></div>;
}

function SettingsUnavailableDialog({ message, onClose }: { message: string; onClose(): void }) {
  return <div className="modal-backdrop"><FocusTrap active initialFocusSelector=".auto-publish-settings__close" className="modal-panel auto-publish-settings" role="dialog" aria-modal="true" aria-label="자동 게시 설정" onKeyDown={(event) => event.key === "Escape" && onClose()}><header className="auto-publish-settings__header"><div><h2>자동 게시 설정</h2><p>{message}</p></div><button className="button icon-button auto-publish-settings__close" type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button></header><div className="auto-publish-settings__body"><p role="alert">설정을 불러온 뒤에만 변경할 수 있습니다.</p></div></FocusTrap></div>;
}

export function PublishCalendar({ monthKey, entries, connectedChannels, settings, settingsError, slotsError, slotsLoading, unreservedItems = [], generatedPreviews = new Map(), focusedItemKey, onFocusedItemHandled, assignableContents, manualOptions, manualOptionsError, manualOptionsLoading, onMonthChange, onStartNew, initialBulkDraft, onStartBulk, onContinueBulk, onProvisionBatch, onAssign, onCancel, onScheduleItem, onLoadManualOptions, onSaveSettings, saving }: Props) {
  const cells = useMemo(() => monthCells(monthKey), [monthKey]);
  const byDate = useMemo(() => entries.reduce((map, entry) => { const key = dateKey(entry.calendarDate); map.set(key, [...(map.get(key) ?? []), entry]); return map; }, new Map<string, CalendarEntry[]>()), [entries]);
  const today = dateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today.startsWith(monthKey) ? today : `${monthKey}-01`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [creationTrayOpen, setCreationTrayOpen] = useState(Boolean(initialBulkDraft));
  const [assignedContentId, setAssignedContentId] = useState("");
  const [unreservedQuery, setUnreservedQuery] = useState("");
  const [unreservedStatus, setUnreservedStatus] = useState("all");
  const [unreservedVisibleCount, setUnreservedVisibleCount] = useState(unreservedPageSize);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsWasOpenRef = useRef(false);
  const bulkOptionsRequestedRef = useRef(false);
  useEffect(() => { if (!selectedDate.startsWith(monthKey)) { setSelectedDate(today.startsWith(monthKey) ? today : `${monthKey}-01`); setSelectedId(null); } }, [monthKey, selectedDate, today]);
  useEffect(() => {
    if (!focusedItemKey) return;
    const entry = entries.find((candidate) => candidate.id === focusedItemKey);
    if (!entry) return;
    setSelectedDate(dateKey(entry.calendarDate));
    setSelectedId(entry.id);
    onFocusedItemHandled?.();
  }, [entries, focusedItemKey, onFocusedItemHandled]);
  useEffect(() => { setAssignedContentId(""); }, [selectedDate, selectedId]);
  useEffect(() => {
    if (!initialBulkDraft || manualOptions || manualOptionsLoading || bulkOptionsRequestedRef.current) return;
    bulkOptionsRequestedRef.current = true;
    onLoadManualOptions();
  }, [initialBulkDraft, manualOptions, manualOptionsLoading, onLoadManualOptions]);
  useEffect(() => { if (settingsWasOpenRef.current && !settingsOpen) settingsTriggerRef.current?.focus(); settingsWasOpenRef.current = settingsOpen; }, [settingsOpen]);
  const dateEntries = (byDate.get(selectedDate) ?? []).sort((a, b) => Date.parse(a.calendarDate) - Date.parse(b.calendarDate));
  const selected = dateEntries.find((entry) => entry.id === selectedId) ?? null;
  const unreservedStatuses = useMemo(() => Array.from(new Set(unreservedItems.map((item) => item.status))).sort((a, b) => (label[a] ?? a).localeCompare(label[b] ?? b, "ko")), [unreservedItems]);
  const filteredUnreservedItems = useMemo(() => {
    const query = unreservedQuery.trim().toLocaleLowerCase("ko-KR");
    return unreservedItems.filter((item) => (unreservedStatus === "all" || item.status === unreservedStatus) && (!query || item.title.toLocaleLowerCase("ko-KR").includes(query)));
  }, [unreservedItems, unreservedQuery, unreservedStatus]);
  const visibleUnreservedItems = filteredUnreservedItems.slice(0, unreservedVisibleCount);
  const remainingUnreservedCount = Math.max(0, filteredUnreservedItems.length - visibleUnreservedItems.length);
  useEffect(() => { setUnreservedVisibleCount(unreservedPageSize); }, [unreservedItems, unreservedQuery, unreservedStatus]);
  useEffect(() => { if (selected) { const stacked = window.matchMedia?.("(max-width: 980px)").matches; detailHeadingRef.current?.focus(stacked ? undefined : { preventScroll: true }); if (stacked) detailHeadingRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); } }, [selected]);
  return <section className="publish-calendar-layout" aria-label="월간 게시 일정">
    <div className="publish-calendar-card"><header className="publish-calendar-toolbar"><div><span className="publish-calendar-eyebrow"><CalendarDays size={15} /> 월간 게시 계획</span><h2>{monthKey.replace("-", "년 ")}월</h2></div><div className="actions"><button ref={settingsTriggerRef} className="button" type="button" onClick={() => setSettingsOpen(true)}>자동 게시 설정</button><button className="button icon-button" type="button" aria-label="이전 달" onClick={() => onMonthChange(shiftMonth(monthKey, -1))}><ChevronLeft size={18} /></button><button className="button icon-button" type="button" aria-label="다음 달" onClick={() => onMonthChange(shiftMonth(monthKey, 1))}><ChevronRight size={18} /></button></div></header>
      <div className="publish-calendar-scroll" role="region" aria-label="게시 캘린더 스크롤"><div className="publish-calendar-weekdays" aria-hidden="true">{["월", "화", "수", "목", "금", "토", "일"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="publish-calendar-grid" role="grid" aria-label="게시 캘린더">{Array.from({ length: 6 }, (_, week) => <div role="row" className="publish-calendar-row" key={week}>{cells.slice(week * 7, week * 7 + 7).map((cell) => { const slots = byDate.get(cell.key) ?? []; return <div role="gridcell" aria-label={fullDate(cell.key)} className={`publish-calendar-cell${cell.current ? "" : " is-outside"}`} key={cell.key}><button className="publish-calendar-cell__button" type="button" aria-label={`${fullDate(cell.key)} 일정 보기`} onClick={() => { setSelectedDate(cell.key); setSelectedId(null); }}><span>{cell.day}</span></button>{slots.slice(0, 3).map((entry) => <button className="publish-calendar-cell__entry" type="button" data-publish-focus-key={entry.id} aria-label={`${entry.title} 슬롯 상세 보기`} onClick={() => { setSelectedDate(cell.key); setSelectedId(entry.id); }} key={entry.id}><span>{timeLabel(entry)}</span><strong>{entry.title}</strong></button>)}{slots.length > 3 ? <span>+{slots.length - 3}</span> : null}</div>; })}</div>)}</div></div>
    </div>
    <aside className="publish-calendar-detail" aria-label={selected ? `${selected.title} 슬롯 상세` : `${fullDate(selectedDate)} 게시 일정`}>
      <header className="publish-calendar-detail__header"><div><span>{selected ? "슬롯 상세" : "선택한 날짜"}</span><h2 ref={detailHeadingRef} tabIndex={-1}>{selected ? selected.title : fullDate(selectedDate)}</h2></div><Badge variant={selected ? variant(selected.status) : "neutral"}>{selected ? label[selected.status] ?? selected.status : `${dateEntries.length}개 일정`}</Badge></header>
      {slotsLoading ? <p role="status" aria-label="캘린더 슬롯을 불러오는 중입니다.">캘린더 슬롯을 불러오는 중입니다.</p> : slotsError ? <p role="alert">{slotsError}</p> : selected ? <div className="publish-calendar-slot-detail">
        <div className="publish-calendar-slot-detail__time"><Clock3 size={18} /><span>{detailTimes(selected).map((time) => <span key={time.label}><small>{time.label}</small><strong>{detailTimeFormatter.format(new Date(time.value))}</strong></span>)}</span></div>
        <dl><div><dt>게시 방식</dt><dd>{selected.mode === "automatic" ? "자동" : "수동"} 게시</dd></div>{selected.recommendationKind ? <div><dt>추천 종류</dt><dd>{selected.recommendationKind === "trend" ? "트렌드성 추천" : "정보성 추천"}</dd></div> : null}<div><dt>콘텐츠 형식</dt><dd>{selected.contentFormat === "reel" ? "릴스" : selected.contentFormat === "card_news" ? "카드뉴스" : "설정 전"}</dd></div><div><dt>게시 채널</dt><dd>{selected.channels.map((channel) => channelLabel[channel]).join(", ") || "채널 설정 전"}</dd></div>{selected.lastError ? <div><dt>상태·오류</dt><dd>{selected.lastError}</dd></div> : null}</dl>
        {selected.status === "open" ? <div className="publish-calendar-manual-form"><label>배정할 콘텐츠<select aria-label="배정할 콘텐츠" value={assignedContentId} onChange={(event) => setAssignedContentId(event.target.value)}><option value="">콘텐츠 선택</option>{assignableContents.map((content) => <option value={content.id} key={content.id}>{content.title}</option>)}</select></label><button className="button primary" type="button" disabled={!assignedContentId} onClick={() => { const content = assignableContents.find((item) => item.id === assignedContentId); if (content) void onAssign(selected.id, content).then((assigned) => { if (assigned) setAssignedContentId(""); }); }}>선택 콘텐츠 배정</button></div> : null}
        {(selected.cancellable ?? !["published", "cancelled", "publishing"].includes(selected.status)) ? <button className="button" type="button" onClick={() => onCancel(selected.id)}>슬롯 취소</button> : null}<button className="button" type="button" onClick={() => setSelectedId(null)}>전체 일정 보기</button>
      </div> : <div className="publish-calendar-detail__list">
        {dateEntries.map((entry) => <button className="publish-calendar-entry" type="button" onClick={() => setSelectedId(entry.id)} key={entry.id}><span>{timeLabel(entry)}</span><strong>{entry.title}</strong><Badge variant={variant(entry.status)}>{label[entry.status] ?? entry.status}</Badge></button>)}
        <section aria-label="미예약 콘텐츠 보관함" className="publish-calendar-unreserved">
          <div className="publish-calendar-unreserved__header"><div><h3>미예약 콘텐츠</h3><span>{filteredUnreservedItems.length}개</span></div>{unreservedItems.length > 0 ? <div className="publish-calendar-unreserved__controls"><input type="search" aria-label="미예약 콘텐츠 검색" placeholder="제목 검색" value={unreservedQuery} onChange={(event) => setUnreservedQuery(event.target.value)} /><select aria-label="미예약 콘텐츠 상태" value={unreservedStatus} onChange={(event) => setUnreservedStatus(event.target.value)}><option value="all">전체 상태</option>{unreservedStatuses.map((status) => <option value={status} key={status}>{label[status] ?? status}</option>)}</select></div> : null}</div>
          {filteredUnreservedItems.length === 0 ? <p className="publish-calendar-unreserved__empty">{unreservedItems.length === 0 ? "게시 일정을 설정할 콘텐츠가 없습니다." : "검색 조건에 맞는 콘텐츠가 없습니다."}</p> : <div className="publish-calendar-unreserved__list">{visibleUnreservedItems.map((item) => {
            const preview = generatedMediaPreview(item, generatedPreviews);
            return <article className={`publish-calendar-unreserved__item${preview ? " has-thumbnail" : ""}`} aria-label={item.title} data-item-key={item.itemKey} data-publish-focus-key={item.itemKey} tabIndex={-1} key={item.itemKey}>
              {preview ? <div className="publish-calendar-unreserved__thumbnail"><PublishManagementPreview title={item.title} preview={preview} /></div> : null}
              <div className="publish-calendar-unreserved__body"><strong>{item.title}</strong><div className="publish-calendar-unreserved__footer"><div className="publish-calendar-unreserved__meta"><Badge variant="neutral">{label[item.status] ?? item.status}</Badge><span>{item.contentFormat === "reel" ? "릴스" : item.contentFormat === "card_news" ? "카드뉴스" : "형식 설정 전"}</span></div>{item.schedulable && item.contentFormat ? <button className="button" type="button" onClick={(event) => onScheduleItem(item, selectedDate, event.currentTarget)}>게시 설정</button> : null}</div></div>
            </article>;
          })}</div>}
          {remainingUnreservedCount > 0 ? <button className="button publish-calendar-unreserved__more" type="button" onClick={() => setUnreservedVisibleCount((count) => count + unreservedPageSize)}>더 보기 ({remainingUnreservedCount}개)</button> : null}
        </section>
        {!creationTrayOpen ? <button className="button" type="button" onClick={() => { setCreationTrayOpen(true); onLoadManualOptions(); }}>새 콘텐츠·일괄 등록</button> : manualOptionsLoading ? <p role="status">콘텐츠 등록 선택 항목을 불러오는 중입니다.</p> : manualOptionsError && !manualOptions ? <div><p role="alert">{manualOptionsError}</p><button className="button" type="button" onClick={onLoadManualOptions}>선택 항목 다시 불러오기</button></div> : <ManualPublishProvisioner dateKey={selectedDate} connected={connectedChannels.includes("instagram")} options={manualOptions} optionsError={manualOptionsError} onStartNew={onStartNew} initialBulkDraft={initialBulkDraft} onStartBulk={onStartBulk} onContinueBulk={onContinueBulk} onProvisionBatch={onProvisionBatch} />}
      </div>}
    </aside>
    {settingsOpen ? settings ? <SettingsDialog settings={settings} channels={connectedChannels} saving={saving} onClose={() => setSettingsOpen(false)} onSave={onSaveSettings} /> : <SettingsUnavailableDialog message={settingsError ?? "자동 게시 설정을 불러오는 중입니다."} onClose={() => setSettingsOpen(false)} /> : null}
  </section>;
}
