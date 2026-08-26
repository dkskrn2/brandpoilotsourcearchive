import { CalendarDays, ChevronLeft, ChevronRight, Settings2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ChannelConnection, ChannelType, PublishCalendarManualOptions, PublishCalendarNewContentSetup, PublishCalendarSettings, PublishCalendarWeeklySettings, PublishCalendarWeeklySettingsInput, PublishCalendarWeeklyUsage, PublishItem } from "../../types";
import { dateKey, monthCells, timeLabel } from "../../features/publishing/publishCalendar";
import { publishStatusPresentation } from "../../features/publishing/publishPresentation";
import { FocusTrap } from "../ui/FocusTrap";
import type { PublishCardPreview } from "./PublishManagementPreview";
import type { PublishCalendarBulkDraft, PublishCalendarBulkDraftRow } from "../../features/publishing/publishCalendarBulkDraft";
import { PublishContentPickerDialog } from "./PublishContentPickerDialog";
import { PublishDateDetail, type PresentedCalendarEntry } from "./PublishDateDetail";
import { PublishMobileAgenda } from "./PublishMobileAgenda";
import { AutoPublishHeaderControl } from "./AutoPublishHeaderControl";
import { WeeklyAutoPublishDialog } from "./WeeklyAutoPublishDialog";

type Props = {
  monthKey: string;
  entries: PresentedCalendarEntry[];
  connectedChannels: ChannelType[];
  channelCatalog?: ChannelConnection[];
  publishableChannels?: ChannelType[];
  settings: PublishCalendarSettings | null;
  weeklyCapability?: boolean | null;
  weeklySettings?: PublishCalendarWeeklySettings | null;
  weeklyUsage?: PublishCalendarWeeklyUsage | null;
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
  onRescheduleItem(itemKey: string, trigger: HTMLButtonElement): void;
  onLoadManualOptions(): void;
  onSaveSettings(input: Omit<PublishCalendarSettings, "brandId" | "updatedAt">): Promise<{ ok: boolean; message?: string }>;
  onSaveWeeklySettings?(input: PublishCalendarWeeklySettingsInput): Promise<{ ok: boolean; message?: string }>;
  onToggleWeekly?(enabled: boolean): Promise<{ ok: boolean; message?: string }>;
  onRetryWeekly?(): void;
  saving?: boolean;
};

function shiftMonth(value: string, amount: number) {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1 + amount, 1));
  return `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}`;
}
function fullDate(key: string) { const [, month, day] = key.split("-"); return `${Number(month)}월 ${Number(day)}일`; }
function useMobileAgenda() {
  const query = "(max-width: 639px)";
  const [mobile, setMobile] = useState(() => window.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = window.matchMedia?.(query);
    if (!media) return;
    const update = () => setMobile(media.matches);
    update();
    media.addEventListener?.("change", update);
    return () => media.removeEventListener?.("change", update);
  }, []);
  return mobile;
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

export function PublishCalendar({ monthKey, entries, connectedChannels, channelCatalog = [], publishableChannels = [], settings, weeklyCapability = false, weeklySettings = null, weeklyUsage = null, settingsError, slotsError, slotsLoading, unreservedItems = [], generatedPreviews = new Map(), focusedItemKey, onFocusedItemHandled, assignableContents, manualOptions, manualOptionsError, manualOptionsLoading, onMonthChange, onStartNew, initialBulkDraft, onStartBulk, onContinueBulk, onProvisionBatch, onAssign, onCancel, onScheduleItem, onRescheduleItem, onLoadManualOptions, onSaveSettings, onSaveWeeklySettings, onToggleWeekly, onRetryWeekly, saving }: Props) {
  const mobileAgenda = useMobileAgenda();
  const cells = useMemo(() => monthCells(monthKey), [monthKey]);
  const byDate = useMemo(() => entries.reduce((map, entry) => { const key = dateKey(entry.calendarDate); map.set(key, [...(map.get(key) ?? []), entry]); return map; }, new Map<string, PresentedCalendarEntry[]>()), [entries]);
  const today = dateKey(new Date());
  const [selectedDate, setSelectedDate] = useState(today.startsWith(monthKey) ? today : `${monthKey}-01`);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [contentPickerOpen, setContentPickerOpen] = useState(Boolean(initialBulkDraft));
  const contentPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const contentPickerWasOpenRef = useRef(false);
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
  useEffect(() => {
    if (!initialBulkDraft || manualOptions || manualOptionsLoading || bulkOptionsRequestedRef.current) return;
    bulkOptionsRequestedRef.current = true;
    onLoadManualOptions();
  }, [initialBulkDraft, manualOptions, manualOptionsLoading, onLoadManualOptions]);
  useEffect(() => { if (settingsWasOpenRef.current && !settingsOpen) settingsTriggerRef.current?.focus(); settingsWasOpenRef.current = settingsOpen; }, [settingsOpen]);
  useEffect(() => { if (contentPickerWasOpenRef.current && !contentPickerOpen) contentPickerTriggerRef.current?.focus(); contentPickerWasOpenRef.current = contentPickerOpen; }, [contentPickerOpen]);
  const dateEntries = (byDate.get(selectedDate) ?? []).sort((a, b) => Date.parse(a.calendarDate) - Date.parse(b.calendarDate));
  const selectMobileDate = (key: string) => { setSelectedDate(key); setSelectedId(null); if (!key.startsWith(monthKey)) onMonthChange(key.slice(0, 7)); };
  const shiftMobileWeek = (key: string) => { selectMobileDate(key); };
  const usableSelectedChannel = Boolean(weeklySettings?.channels.some((type) => publishableChannels.includes(type) && channelCatalog.some((channel) => channel.type === type && channel.enabled && channel.status === "connected" && channel.oauthState === "connected")));
  const canEnableWeekly = Boolean(weeklySettings && weeklySettings.weeklySchedule.length > 0 && weeklySettings.channels.length > 0 && usableSelectedChannel);
  const weeklyDisabledReason = !weeklySettings
    ? settingsError ?? "주간 자동 게시 설정을 불러오는 중입니다."
    : weeklySettings.weeklySchedule.length === 0
      ? "자동 게시를 켜려면 먼저 주간 일정을 한 개 이상 저장해 주세요."
      : weeklySettings.channels.length === 0
        ? "자동 게시를 켜려면 게시 채널을 한 개 이상 저장해 주세요."
        : !usableSelectedChannel
          ? "자동 게시를 켜려면 선택한 채널 중 게시 가능한 연결 채널이 필요합니다."
          : null;
  return <section className="publish-calendar-layout" aria-label={mobileAgenda ? "주간 게시 계획" : "월간 게시 일정"}>
    <div className="publish-calendar-card"><header className="publish-calendar-toolbar"><div><span className="publish-calendar-eyebrow"><CalendarDays size={15} /> {mobileAgenda ? "주간 게시 계획" : "월간 게시 계획"}</span><h2>{monthKey.replace("-", "년 ")}월</h2></div><div className="actions">{weeklyCapability === true
      ? weeklySettings
        ? <AutoPublishHeaderControl enabled={weeklySettings.enabled} canEnable={canEnableWeekly} disabledReason={weeklyDisabledReason} onToggle={onToggleWeekly ?? (async () => ({ ok: false, message: "자동 게시 상태를 변경할 수 없습니다." }))} onEdit={() => setSettingsOpen(true)} editButtonRef={settingsTriggerRef} />
        : <div className="auto-publish-header-control"><div className="auto-publish-header-control__main"><span className="auto-publish-header-control__label">자동 게시</span><span role="status">자동 게시 상태 확인 불가</span><button className="button" type="button" aria-label="자동 게시 다시 시도" onClick={onRetryWeekly}>다시 시도</button><button ref={settingsTriggerRef} className="button" type="button" onClick={() => setSettingsOpen(true)}>수정</button></div><small>{settingsError ?? "주간 자동 게시 설정을 불러오는 중입니다."}</small></div>
      : <button ref={settingsTriggerRef} className="button" type="button" disabled={weeklyCapability === null} onClick={() => setSettingsOpen(true)}>자동 게시 설정</button>}{!mobileAgenda ? <><button className="button icon-button" type="button" aria-label="이전 달" onClick={() => onMonthChange(shiftMonth(monthKey, -1))}><ChevronLeft size={18} /></button><button className="button icon-button" type="button" aria-label="다음 달" onClick={() => onMonthChange(shiftMonth(monthKey, 1))}><ChevronRight size={18} /></button></> : null}</div></header>
      {mobileAgenda ? <PublishMobileAgenda anchorDate={selectedDate} selectedDate={selectedDate} selectedId={selectedId} entries={entries} onSelectDate={selectMobileDate} onSelectEntry={(key, id) => { setSelectedDate(key); setSelectedId(id); if (!key.startsWith(monthKey)) onMonthChange(key.slice(0, 7)); }} onWeekChange={shiftMobileWeek} /> : <div className="publish-calendar-scroll" role="region" aria-label="게시 캘린더 스크롤"><div className="publish-calendar-weekdays" aria-hidden="true">{["월", "화", "수", "목", "금", "토", "일"].map((day) => <span key={day}>{day}</span>)}</div>
      <div className="publish-calendar-grid" role="grid" aria-label="게시 캘린더">{Array.from({ length: 6 }, (_, week) => <div role="row" className="publish-calendar-row" key={week}>{cells.slice(week * 7, week * 7 + 7).map((cell) => { const slots = byDate.get(cell.key) ?? []; return <div role="gridcell" aria-label={fullDate(cell.key)} className={`publish-calendar-cell${cell.current ? "" : " is-outside"}`} key={cell.key}><button className="publish-calendar-cell__button" type="button" aria-label={`${fullDate(cell.key)} 일정 보기`} onClick={() => { setSelectedDate(cell.key); setSelectedId(null); }}><span>{cell.day}</span></button>{slots.slice(0, 3).map((entry) => { const presentation = publishStatusPresentation(entry.operationalStatus); return <button className={`publish-calendar-cell__entry ${presentation.className}`} type="button" data-publish-focus-key={entry.id} aria-label={`${entry.title} ${presentation.label} 슬롯 상세 보기`} onClick={() => { setSelectedDate(cell.key); setSelectedId(entry.id); }} key={entry.id}><span>{timeLabel(entry)}</span><span className="publish-calendar-cell__status">{presentation.label}</span><strong>{entry.title}</strong></button>; })}{slots.length > 3 ? <span>+{slots.length - 3}</span> : null}</div>; })}</div>)}</div></div>}
    </div>
    <PublishDateDetail dateKey={selectedDate} entries={dateEntries} selectedId={selectedId} slotsLoading={slotsLoading} slotsError={slotsError} assignableContents={assignableContents} onSelectEntry={setSelectedId} onAssign={onAssign} onCancel={onCancel} onRescheduleItem={onRescheduleItem} onOpenContentPicker={(trigger) => { contentPickerTriggerRef.current = trigger; setContentPickerOpen(true); onLoadManualOptions(); }} hideEntryList={mobileAgenda} />
    {contentPickerOpen ? <PublishContentPickerDialog dateKey={selectedDate} unreservedItems={unreservedItems} generatedPreviews={generatedPreviews} connected={connectedChannels.includes("instagram")} options={manualOptions} optionsError={manualOptionsError} optionsLoading={Boolean(manualOptionsLoading)} initialBulkDraft={initialBulkDraft} onScheduleItem={(item, key, trigger) => { const restoreTarget = contentPickerTriggerRef.current ?? trigger; contentPickerWasOpenRef.current = false; setContentPickerOpen(false); onScheduleItem(item, key, restoreTarget); }} onStartNew={onStartNew} onStartBulk={onStartBulk} onContinueBulk={onContinueBulk} onProvisionBatch={onProvisionBatch} onLoadOptions={onLoadManualOptions} onClose={() => setContentPickerOpen(false)} /> : null}
    {settingsOpen ? weeklyCapability === true
      ? weeklySettings
        ? <WeeklyAutoPublishDialog settings={weeklySettings} channels={channelCatalog} publishableChannels={publishableChannels} usage={weeklyUsage} saving={saving} onClose={() => setSettingsOpen(false)} onSave={onSaveWeeklySettings ?? (async () => ({ ok: false, message: "주간 자동 게시 설정을 저장할 수 없습니다." }))} />
        : <SettingsUnavailableDialog message={settingsError ?? "주간 자동 게시 설정을 불러오는 중입니다."} onClose={() => setSettingsOpen(false)} />
      : settings
        ? <SettingsDialog settings={settings} channels={connectedChannels} saving={saving} onClose={() => setSettingsOpen(false)} onSave={onSaveSettings} />
        : <SettingsUnavailableDialog message={settingsError ?? "자동 게시 설정을 불러오는 중입니다."} onClose={() => setSettingsOpen(false)} />
    : null}
  </section>;
}
