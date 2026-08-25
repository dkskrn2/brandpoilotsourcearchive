import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo } from "react";
import { dateKey, timeLabel } from "../../features/publishing/publishCalendar";
import { publishStatusPresentation } from "../../features/publishing/publishPresentation";
import type { PresentedCalendarEntry } from "./PublishDateDetail";

type Props = {
  anchorDate: string;
  selectedDate: string;
  selectedId: string | null;
  entries: PresentedCalendarEntry[];
  onSelectDate(value: string): void;
  onSelectEntry(date: string, id: string): void;
  onWeekChange(value: string): void;
};

const weekdays = ["일요일", "월요일", "화요일", "수요일", "목요일", "금요일", "토요일"];

function parseDate(value: string) {
  return new Date(`${value}T00:00:00Z`);
}

export function shiftDate(value: string, amount: number) {
  const next = parseDate(value);
  next.setUTCDate(next.getUTCDate() + amount);
  return next.toISOString().slice(0, 10);
}

export function mobileAgendaDates(anchorDate: string) {
  const anchor = parseDate(anchorDate);
  const mondayOffset = (anchor.getUTCDay() + 6) % 7;
  const monday = shiftDate(anchorDate, -mondayOffset);
  return Array.from({ length: 7 }, (_, index) => shiftDate(monday, index));
}

function dayLabel(value: string) {
  const date = parseDate(value);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일 ${weekdays[date.getUTCDay()]}`;
}

function shortDayLabel(value: string) {
  const date = parseDate(value);
  return `${date.getUTCMonth() + 1}월 ${date.getUTCDate()}일`;
}

export function PublishMobileAgenda({ anchorDate, selectedDate, selectedId, entries, onSelectDate, onSelectEntry, onWeekChange }: Props) {
  const dates = useMemo(() => mobileAgendaDates(anchorDate), [anchorDate]);
  const entriesByDate = useMemo(() => entries.reduce((map, entry) => {
    const key = dateKey(entry.calendarDate);
    map.set(key, [...(map.get(key) ?? []), entry]);
    return map;
  }, new Map<string, PresentedCalendarEntry[]>()), [entries]);
  const selectedEntries = [...(entriesByDate.get(selectedDate) ?? [])].sort((left, right) => Date.parse(left.calendarDate) - Date.parse(right.calendarDate));

  return <section className="publish-mobile-agenda" aria-label="주간 게시 일정">
    <header className="publish-mobile-agenda__header">
      <button className="button icon-button" type="button" aria-label="이전 주" onClick={() => onWeekChange(shiftDate(anchorDate, -7))}><ChevronLeft size={18} aria-hidden="true" /></button>
      <strong>{shortDayLabel(dates[0])} – {shortDayLabel(dates[6])}</strong>
      <button className="button icon-button" type="button" aria-label="다음 주" onClick={() => onWeekChange(shiftDate(anchorDate, 7))}><ChevronRight size={18} aria-hidden="true" /></button>
    </header>
    <div className="publish-mobile-agenda__dates" role="group" aria-label="주간 날짜 선택">
      {dates.map((key) => {
        const date = parseDate(key);
        return <button className={`publish-mobile-agenda__date${selectedDate === key ? " is-selected" : ""}`} type="button" aria-label={`${shortDayLabel(key)} 일정 보기`} aria-current={selectedDate === key ? "date" : undefined} onClick={() => onSelectDate(key)} key={key}>
          <span>{weekdays[date.getUTCDay()].slice(0, 1)}</span>
          <strong>{date.getUTCDate()}</strong>
          <small>{entriesByDate.get(key)?.length ?? 0}개</small>
        </button>;
      })}
    </div>
    <div className="publish-mobile-agenda__selected">
      <h3>{dayLabel(selectedDate)} 일정</h3>
      {selectedEntries.length === 0 ? <p>선택한 날짜에 게시 일정이 없습니다.</p> : <div className="publish-mobile-agenda__slots">{selectedEntries.map((entry) => {
        const presentation = publishStatusPresentation(entry.operationalStatus);
        return <button className={`publish-mobile-agenda__slot ${presentation.className}`} type="button" aria-label={`${entry.title} ${presentation.label} 슬롯 상세 보기`} aria-pressed={selectedId === entry.id} data-publish-focus-key={entry.id} onClick={() => onSelectEntry(selectedDate, entry.id)} key={entry.id}>
          <span className="publish-mobile-agenda__time">{timeLabel(entry)}</span>
          <strong>{entry.title}</strong>
          <span className="publish-mobile-agenda__status">{presentation.label}</span>
        </button>;
      })}</div>}
    </div>
  </section>;
}
