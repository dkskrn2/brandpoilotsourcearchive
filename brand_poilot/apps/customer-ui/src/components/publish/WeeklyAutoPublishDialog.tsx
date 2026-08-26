import { ChevronDown, ChevronUp, Plus, Trash2, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import type {
  ChannelConnection,
  ChannelType,
  PublishCalendarWeeklySettings,
  PublishCalendarWeeklySettingsInput,
  PublishCalendarWeeklyUsage,
} from "../../types";
import { FocusTrap } from "../ui/FocusTrap";
import { ChannelLogo } from "../channels/ChannelLogo";

type SaveResult = { ok: true } | { ok: false; message?: string };
type AsyncLoadStatus = "idle" | "loading" | "ready" | "error";
type DayOfWeek = 1 | 2 | 3 | 4 | 5 | 6 | 7;
type DraftRow = PublishCalendarWeeklySettingsInput["weeklySchedule"][number] & { key: string };

const dayNames = ["월요일", "화요일", "수요일", "목요일", "금요일", "토요일", "일요일"] as const;
const channelFallbackLabels: Record<ChannelType, string> = {
  instagram: "Instagram",
  threads: "Threads",
  x: "X",
  linkedin: "LinkedIn",
  youtube: "YouTube",
  tiktok: "TikTok",
};

function kstWeekDates(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(now);
  const value = (type: "year" | "month" | "day") => Number(parts.find((part) => part.type === type)?.value);
  const today = new Date(Date.UTC(value("year"), value("month") - 1, value("day")));
  const weekday = today.getUTCDay() || 7;
  const monday = new Date(today);
  monday.setUTCDate(today.getUTCDate() - weekday + 1);
  return dayNames.map((name, index) => {
    const date = new Date(monday);
    date.setUTCDate(monday.getUTCDate() + index);
    return { dayOfWeek: (index + 1) as DayOfWeek, name, label: `${name} ${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일` };
  });
}

function initialRows(settings: PublishCalendarWeeklySettings): DraftRow[] {
  return settings.weeklySchedule
    .slice()
    .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.sortOrder - right.sortOrder)
    .map((row) => ({ ...row, key: row.id }));
}

export function WeeklyAutoPublishDialog({
  settings,
  channels,
  publishableChannels,
  metadataStatus = "ready",
  usage,
  usageStatus = "ready",
  now = new Date(),
  saving = false,
  onClose,
  onSave,
  onRetryMetadata,
  onRetryUsage,
}: {
  settings: PublishCalendarWeeklySettings;
  channels: ChannelConnection[];
  publishableChannels: ChannelType[];
  metadataStatus?: AsyncLoadStatus;
  usage: PublishCalendarWeeklyUsage | null;
  usageStatus?: AsyncLoadStatus;
  now?: Date;
  saving?: boolean;
  onClose(): void;
  onSave(input: PublishCalendarWeeklySettingsInput): Promise<SaveResult>;
  onRetryMetadata?(): void;
  onRetryUsage?(): void;
}) {
  const nextRowKey = useRef(0);
  const [selectedChannels, setSelectedChannels] = useState<ChannelType[]>(() => [...settings.channels]);
  const [informationalFormat, setInformationalFormat] = useState(settings.informationalFormat ?? "card_news");
  const [trendFormat, setTrendFormat] = useState(settings.trendFormat ?? "reel");
  const [rows, setRows] = useState<DraftRow[]>(() => initialRows(settings));
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const saveButtonRef = useRef<HTMLButtonElement>(null);
  const weekDates = useMemo(() => kstWeekDates(now), [now]);
  const metadataReady = metadataStatus === "ready";
  const usageReady = usageStatus === "ready" && usage !== null;
  const limit = usageReady ? usage.publishing.limit : null;

  const catalog = useMemo(() => {
    const byType = new Map((metadataReady ? channels : []).map((channel) => [channel.type, channel]));
    for (const type of settings.channels) {
      if (!byType.has(type)) {
        byType.set(type, {
          type,
          label: channelFallbackLabels[type],
          enabled: false,
          oauthState: "not_connected",
          status: "not_connected",
          accountLabel: "연결 상태를 확인할 수 없음",
          lastHealthyAt: "",
          lastPublishedAt: "",
        });
      }
    }
    return [...byType.values()];
  }, [channels, metadataReady, settings.channels]);

  function channelUsable(channel: ChannelConnection) {
    return publishableChannels.includes(channel.type)
      && channel.enabled
      && channel.status === "connected"
      && channel.oauthState === "connected";
  }

  function toggleChannel(type: ChannelType) {
    setSelectedChannels((current) => current.includes(type)
      ? current.filter((channel) => channel !== type)
      : [...current, type]);
  }

  function addRow(dayOfWeek: DayOfWeek) {
    if (!usageReady || limit === null || rows.length >= limit) return;
    const dayRows = rows.filter((row) => row.dayOfWeek === dayOfWeek);
    if (dayRows.length >= 24) return;
    const key = `new-${nextRowKey.current++}`;
    setRows((current) => [...current, { id: null, dayOfWeek, time: "11:30", sortOrder: dayRows.length, key }]);
  }

  function updateTime(key: string, time: string) {
    setRows((current) => current.map((row) => row.key === key ? { ...row, time } : row));
  }

  function deleteRow(key: string) {
    setRows((current) => current.filter((row) => row.key !== key));
  }

  function moveRow(dayOfWeek: DayOfWeek, index: number, amount: -1 | 1) {
    const dayRows = rows.filter((row) => row.dayOfWeek === dayOfWeek);
    const target = index + amount;
    if (target < 0 || target >= dayRows.length) return;
    const order = dayRows.map((row) => row.key);
    [order[index], order[target]] = [order[target], order[index]];
    const positions = new Map(order.map((key, position) => [key, position]));
    setRows((current) => current.map((row) => row.dayOfWeek === dayOfWeek
      ? { ...row, sortOrder: positions.get(row.key) ?? row.sortOrder }
      : row));
  }

  async function save() {
    if (!metadataReady || !usageReady) return;
    const orderedRows = rows
      .slice()
      .sort((left, right) => left.dayOfWeek - right.dayOfWeek || left.sortOrder - right.sortOrder);
    if (orderedRows.some((row) => !/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time))) {
      setError("게시 시간을 HH:mm 형식으로 입력해 주세요.");
      return;
    }
    if (limit !== null && orderedRows.length > limit) {
      setError(`주간 게시 계획은 현재 플랜 한도 ${limit}건까지 저장할 수 있습니다.`);
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const result = await onSave({
        channels: selectedChannels,
        informationalFormat,
        trendFormat,
        weeklySchedule: orderedRows.map(({ key: _key, ...row }, index, allRows) => ({
          ...row,
          sortOrder: allRows.slice(0, index).filter((candidate) => candidate.dayOfWeek === row.dayOfWeek).length,
        })),
      });
      if (result.ok) onClose();
      else {
        setError(result.message ?? "주간 자동 게시 설정을 저장하지 못했습니다.");
        window.setTimeout(() => saveButtonRef.current?.focus(), 0);
      }
    } catch {
      setError("주간 자동 게시 설정을 저장하지 못했습니다.");
      window.setTimeout(() => saveButtonRef.current?.focus(), 0);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop">
      <FocusTrap
        active
        initialFocusSelector=".weekly-auto-publish-dialog__title"
        className="modal-panel weekly-auto-publish-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="weekly-auto-publish-title"
        onKeyDown={(event) => {
          if (event.key === "Escape" && !submitting && !saving) onClose();
        }}
      >
        <header className="weekly-auto-publish-dialog__header">
          <div>
            <span className="publish-calendar-eyebrow">자동 게시</span>
            <h2 id="weekly-auto-publish-title" className="weekly-auto-publish-dialog__title" tabIndex={-1}>주간 자동 게시 설정</h2>
            <p>요일별 게시 시간과 추천 콘텐츠 형식을 설정합니다.</p>
          </div>
          <button className="button icon-button" type="button" aria-label="닫기" onClick={onClose} disabled={submitting || saving}><X size={18} aria-hidden="true" /></button>
        </header>

        <div className="weekly-auto-publish-dialog__body">
          <section className="weekly-auto-publish-dialog__section" aria-labelledby="weekly-auto-channel-title">
            <div className="weekly-auto-publish-dialog__section-heading">
              <div><h3 id="weekly-auto-channel-title">게시 채널</h3><p>게시 가능한 연결 채널만 새로 선택할 수 있습니다.</p></div>
            </div>
            {metadataStatus === "loading" || metadataStatus === "idle" ? <p role="status">게시 채널 정보를 확인하는 중입니다.</p> : null}
            {metadataStatus === "error" ? <p role="alert">게시 채널 정보를 확인하지 못했습니다. <button className="button" type="button" aria-label="게시 채널 다시 시도" onClick={onRetryMetadata}>다시 시도</button></p> : null}
            <div className="weekly-auto-publish-dialog__channels">
              {catalog.map((channel) => {
                const usable = channelUsable(channel);
                const selected = selectedChannels.includes(channel.type);
                const savedUnavailable = selected && !usable;
                const publishable = publishableChannels.includes(channel.type);
                const status = !metadataReady
                  ? selected ? "채널 상태 확인 필요 · 저장된 선택 유지" : "채널 상태 확인 필요"
                  : usable
                  ? "연결됨"
                  : !publishable
                    ? savedUnavailable ? "자동 게시 미지원 · 저장된 선택 유지" : "자동 게시 미지원"
                    : savedUnavailable ? "미연결 · 저장된 선택 유지" : "미연결";
                return <label className={`weekly-auto-publish-channel${usable ? " is-usable" : " is-unavailable"}`} key={channel.type}>
                  <input
                    type="checkbox"
                    checked={selected}
                    disabled={!metadataReady || !usable}
                    aria-label={`${channel.label} ${status}`}
                    onChange={() => toggleChannel(channel.type)}
                  />
                  <ChannelLogo channel={channel.type} decorative size={20} />
                  <span><strong>{channel.label}</strong><small>{status}</small></span>
                </label>;
              })}
            </div>
          </section>

          <section className="weekly-auto-publish-dialog__section" aria-labelledby="weekly-auto-format-title">
            <div className="weekly-auto-publish-dialog__section-heading"><div><h3 id="weekly-auto-format-title">추천 콘텐츠 형식</h3><p>정보성 추천과 트렌드 추천의 기본 형식을 각각 정합니다.</p></div></div>
            <div className="weekly-auto-publish-dialog__formats">
              <label><span>정보성 콘텐츠 형식</span><select aria-label="정보성 콘텐츠 형식" value={informationalFormat} onChange={(event) => setInformationalFormat(event.target.value as "card_news" | "reel")}><option value="card_news">카드뉴스</option><option value="reel">릴스</option></select></label>
              <label><span>트렌드 콘텐츠 형식</span><select aria-label="트렌드 콘텐츠 형식" value={trendFormat} onChange={(event) => setTrendFormat(event.target.value as "card_news" | "reel")}><option value="card_news">카드뉴스</option><option value="reel">릴스</option></select></label>
            </div>
          </section>

          <section className="weekly-auto-publish-dialog__section" aria-labelledby="weekly-auto-schedule-title">
            <div className="weekly-auto-publish-dialog__section-heading">
              <div><h3 id="weekly-auto-schedule-title">주간 게시 계획</h3><p>{usageReady ? `주간 게시 계획 ${rows.length}/${limit}건` : `저장된 주간 게시 계획 ${rows.length}건`}</p></div>
            </div>
            {usageStatus === "loading" || usageStatus === "idle" ? <p role="status">주간 게시 한도를 확인하는 중입니다.</p> : null}
            {usageStatus === "error" || (usageStatus === "ready" && !usage) ? <p role="alert">주간 게시 한도를 확인하지 못했습니다. <button className="button" type="button" aria-label="사용량 다시 시도" onClick={onRetryUsage}>다시 시도</button></p> : null}
            <div className="weekly-auto-publish-dialog__week">
              {weekDates.map((day) => {
                const dayRows = rows.filter((row) => row.dayOfWeek === day.dayOfWeek).sort((left, right) => left.sortOrder - right.sortOrder);
                return <fieldset className="weekly-auto-publish-day" aria-label={day.label} key={day.dayOfWeek}>
                  <legend><span>{day.name}</span><small>{day.label.replace(`${day.name} `, "")}</small></legend>
                  <div className="weekly-auto-publish-day__rows">
                    {dayRows.map((row, index) => <div className="weekly-auto-publish-row" role="group" aria-label={`${day.name} ${index + 1}번째 게시 일정`} key={row.key}>
                      <label><span className="visually-hidden">{day.name} {index + 1}번째 게시 시간</span><input type="time" step="60" aria-label={`${day.name} ${index + 1}번째 게시 시간`} value={row.time} disabled={!usageReady} onChange={(event) => updateTime(row.key, event.target.value)} /></label>
                      <div className="weekly-auto-publish-row__actions">
                        <button className="button icon-button" type="button" aria-label={`${day.name} ${index + 1}번째 일정을 위로 이동`} disabled={!usageReady || index === 0} onClick={() => moveRow(day.dayOfWeek, index, -1)}><ChevronUp size={16} aria-hidden="true" /></button>
                        <button className="button icon-button" type="button" aria-label={`${day.name} ${index + 1}번째 일정을 아래로 이동`} disabled={!usageReady || index === dayRows.length - 1} onClick={() => moveRow(day.dayOfWeek, index, 1)}><ChevronDown size={16} aria-hidden="true" /></button>
                        <button className="button icon-button" type="button" aria-label={`${day.name} ${index + 1}번째 일정 삭제`} disabled={!usageReady} onClick={() => deleteRow(row.key)}><Trash2 size={16} aria-hidden="true" /></button>
                      </div>
                    </div>)}
                  </div>
                  <button className="button weekly-auto-publish-day__add" type="button" aria-label={`${day.name} 일정 추가`} disabled={!usageReady || limit === null || rows.length >= limit || dayRows.length >= 24} onClick={() => addRow(day.dayOfWeek)}><Plus size={15} aria-hidden="true" /> 시간 추가</button>
                </fieldset>;
              })}
            </div>
          </section>

          <p className="weekly-auto-publish-dialog__notice">설정을 바꾸거나 자동 게시를 꺼도 기존 예약은 유지됩니다.</p>
          {error ? <p className="weekly-auto-publish-dialog__error" role="alert">{error}</p> : null}
        </div>

        <footer className="weekly-auto-publish-dialog__footer">
          <button className="button" type="button" onClick={onClose} disabled={submitting || saving}>취소</button>
          <button ref={saveButtonRef} className="button primary" type="button" aria-busy={submitting || saving} disabled={submitting || saving || !metadataReady || !usageReady} onClick={() => void save()}>설정 저장</button>
        </footer>
      </FocusTrap>
    </div>
  );
}
