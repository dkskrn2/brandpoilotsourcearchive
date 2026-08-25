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

  return <section className="publish-mobile-agenda" aria-label="주간 게시 일정">
    <header className="publish-mobile-agenda__header">
      <button className="button icon-button" type="button" aria-label="이전 주" onClick={() => onWeekChange(shiftDate(anchorDate, -7))}><ChevronLeft size={18} aria-hidden="true" /></button>
      <strong>{shortDayLabel(dates[0])} – {shortDayLabel(dates[6])}</strong>
      <button className="button icon-button" type="button" aria-label="다음 주" onClick={() => onWeekChange(shiftDate(anchorDate, 7))}><ChevronRight size={18} aria-hidden="true" /></button>
    </header>
    <ol className="publish-mobile-agenda__days">
      {dates.map((key) => {
        const dayEntries = [...(entriesByDate.get(key) ?? [])].sort((left, right) => Date.parse(left.calendarDate) - Date.parse(right.calendarDate));
        return <li className={`publish-mobile-agenda__day${selectedDate === key ? " is-selected" : ""}`} key={key}>
          <div className="publish-mobile-agenda__date">
            <h3><button type="button" aria-label={`${shortDayLabel(key)} 일정 보기`} aria-current={selectedDate === key ? "date" : undefined} onClick={() => onSelectDate(key)}>{dayLabel(key)}</button></h3>
            <span>{dayEntries.length}개 일정</span>
          </div>
          {dayEntries.length === 0 ? <p>일정 없음</p> : <div className="publish-mobile-agenda__slots">{dayEntries.map((entry) => {
            const presentation = publishStatusPresentation(entry.operationalStatus);
            return <button className={`publish-mobile-agenda__slot ${presentation.className}`} type="button" aria-label={`${entry.title} ${presentation.label} 슬롯 상세 보기`} aria-pressed={selectedId === entry.id} data-publish-focus-key={entry.id} onClick={() => onSelectEntry(key, entry.id)} key={entry.id}>
              <span className="publish-mobile-agenda__time">{timeLabel(entry)}</span>
              <strong>{entry.title}</strong>
              <span className="publish-mobile-agenda__status">{presentation.label}</span>
            </button>;
          })}</div>}
        </li>;
      })}
    </ol>
  </section>;
}
