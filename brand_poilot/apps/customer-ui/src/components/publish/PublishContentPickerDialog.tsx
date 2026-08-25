import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type { PublishCalendarManualOptions, PublishCalendarNewContentSetup, PublishItem } from "../../types";
import type { PublishCalendarBulkDraft, PublishCalendarBulkDraftRow } from "../../features/publishing/publishCalendarBulkDraft";
import { publishContentStatusPresentation } from "../../features/publishing/publishPresentation";
import { Badge } from "../ui/Badge";
import { FocusTrap } from "../ui/FocusTrap";
import { ManualPublishProvisioner } from "./ManualPublishProvisioner";
import { PublishManagementPreview, resolvePublishPreview, type PublishCardPreview } from "./PublishManagementPreview";

type PickerTab = "existing_content" | "new_content" | "bulk";

type Props = {
  dateKey: string;
  unreservedItems: PublishItem[];
  generatedPreviews: ReadonlyMap<string, PublishCardPreview>;
  connected: boolean;
  options: PublishCalendarManualOptions | null;
  optionsError: string | null;
  optionsLoading: boolean;
  initialBulkDraft: PublishCalendarBulkDraft | null;
  onScheduleItem(item: PublishItem, dateKey: string, trigger: HTMLButtonElement): void;
  onStartNew(input: { scheduledFor: string; contentFormat: "card_news" | "reel"; setup: PublishCalendarNewContentSetup }): void;
  onStartBulk(rows: PublishCalendarBulkDraftRow[]): void;
  onContinueBulk(draft: PublishCalendarBulkDraft, row: PublishCalendarBulkDraftRow): void;
  onProvisionBatch(draft: PublishCalendarBulkDraft): Promise<boolean>;
  onLoadOptions?(): void;
  onClose(): void;
};

const pageSize = 6;

function generatedMediaPreview(item: PublishItem, generatedPreviews: ReadonlyMap<string, PublishCardPreview>): PublishCardPreview {
  const target = item.targets.find((candidate) => candidate.artifactPublicUrl || candidate.previewBody || candidate.previewTitle) ?? item.targets[0];
  const reviewTarget = item.reviewTargets.find((candidate) => candidate.previewBody || candidate.previewTitle) ?? item.reviewTargets[0];
  const preview = resolvePublishPreview({
    title: item.title,
    artifactPublicUrl: target?.artifactPublicUrl,
    outputJson: target?.outputJson ?? reviewTarget?.outputJson,
    previewBody: target?.previewBody ?? reviewTarget?.previewBody,
    contentStatus: item.contentStatus,
  });
  if (preview.kind === "image" || preview.kind === "video") return preview;
  if (item.contentStatus === "completed" && item.sourceRefs.generationOutputId) {
    return generatedPreviews.get(item.sourceRefs.generationOutputId) ?? preview;
  }
  return preview;
}

function fullDate(key: string) {
  const [year, month, day] = key.split("-");
  return `${Number(year)}년 ${Number(month)}월 ${Number(day)}일`;
}

export function PublishContentPickerDialog({ dateKey, unreservedItems, generatedPreviews, connected, options, optionsError, optionsLoading, initialBulkDraft, onScheduleItem, onStartNew, onStartBulk, onContinueBulk, onProvisionBatch, onLoadOptions, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<PickerTab>(initialBulkDraft ? "bulk" : "existing_content");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("all");
  const [visibleCount, setVisibleCount] = useState(pageSize);
  const statuses = useMemo(() => Array.from(new Set(unreservedItems.map((item) => item.contentStatus))).sort((left, right) => publishContentStatusPresentation(left).label.localeCompare(publishContentStatusPresentation(right).label, "ko")), [unreservedItems]);
  const filteredItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ko-KR");
    return unreservedItems.filter((item) => (status === "all" || item.contentStatus === status) && (!normalized || item.title.toLocaleLowerCase("ko-KR").includes(normalized)));
  }, [query, status, unreservedItems]);
  const visibleItems = filteredItems.slice(0, visibleCount);
  const remainingCount = Math.max(0, filteredItems.length - visibleItems.length);
  const manualMode = activeTab === "bulk" ? "bulk" : "new_content";
  const tabs: Array<{ id: PickerTab; label: string }> = [
    { id: "existing_content", label: "기존 콘텐츠" },
    { id: "new_content", label: "새 콘텐츠" },
    { id: "bulk", label: "일괄 등록" },
  ];

  function selectTab(tab: PickerTab) {
    setActiveTab(tab);
    if (tab === "existing_content") setVisibleCount(pageSize);
  }

  return <div className="modal-backdrop"><FocusTrap active initialFocusSelector=".publish-content-picker__heading" className="modal-panel publish-content-picker" role="dialog" aria-modal="true" aria-labelledby="publish-content-picker-heading" onKeyDown={(event) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    onClose();
  }}>
    <header className="publish-content-picker__header"><div><span>선택 날짜 {fullDate(dateKey)}</span><h2 id="publish-content-picker-heading" className="publish-content-picker__heading" tabIndex={-1}>콘텐츠 추가</h2><p>기존 콘텐츠를 예약하거나 새 콘텐츠 생성 1단계를 시작합니다.</p></div><button className="button icon-button" type="button" aria-label="닫기" onClick={onClose}><X size={18} /></button></header>
    <div className="publish-content-picker__tabs" role="tablist" aria-label="콘텐츠 추가 방식">{tabs.map((tab) => <button id={`publish-content-picker-tab-${tab.id}`} role="tab" aria-controls={`publish-content-picker-panel-${tab.id}`} aria-selected={activeTab === tab.id} tabIndex={activeTab === tab.id ? 0 : -1} className={`button${activeTab === tab.id ? " is-active" : ""}`} type="button" onClick={() => selectTab(tab.id)} key={tab.id}>{tab.label}</button>)}</div>
    <div id="publish-content-picker-panel-existing_content" role="tabpanel" aria-labelledby="publish-content-picker-tab-existing_content" hidden={activeTab !== "existing_content"} className="publish-content-picker__body">
      <section aria-label="미예약 콘텐츠 보관함" className="publish-calendar-unreserved">
        <div className="publish-calendar-unreserved__header"><div><h3>미예약 콘텐츠</h3><span>{filteredItems.length}개</span></div>{unreservedItems.length > 0 ? <div className="publish-calendar-unreserved__controls"><input type="search" aria-label="미예약 콘텐츠 검색" placeholder="제목 검색" value={query} onChange={(event) => { setQuery(event.target.value); setVisibleCount(pageSize); }} /><select aria-label="미예약 콘텐츠 상태" value={status} onChange={(event) => { setStatus(event.target.value); setVisibleCount(pageSize); }}><option value="all">전체 상태</option>{statuses.map((value) => <option value={value} key={value}>{publishContentStatusPresentation(value).label}</option>)}</select></div> : null}</div>
        {filteredItems.length === 0 ? <p className="publish-calendar-unreserved__empty">{unreservedItems.length === 0 ? "게시 일정을 설정할 콘텐츠가 없습니다." : "검색 조건에 맞는 콘텐츠가 없습니다."}</p> : <div className="publish-calendar-unreserved__list">{visibleItems.map((item) => {
          const preview = generatedMediaPreview(item, generatedPreviews);
          const presentation = publishContentStatusPresentation(item.contentStatus);
          const hasThumbnail = preview.kind === "image" || preview.kind === "video";
          return <article className={`publish-calendar-unreserved__item${hasThumbnail ? " has-thumbnail" : ""}`} aria-label={item.title} data-item-key={item.itemKey} data-publish-focus-key={item.itemKey} tabIndex={-1} key={item.itemKey}>
            <div className="publish-calendar-unreserved__thumbnail"><PublishManagementPreview title={item.title} preview={preview} /></div>
            <div className="publish-calendar-unreserved__body"><strong>{item.title}</strong><div className="publish-calendar-unreserved__footer"><div className="publish-calendar-unreserved__meta"><Badge variant={presentation.variant}>{presentation.label}</Badge><span>{item.contentFormat === "reel" ? "릴스" : item.contentFormat === "card_news" ? "카드뉴스" : "형식 설정 전"}</span></div>{item.schedulable && item.contentFormat ? <button className="button" type="button" onClick={(event) => onScheduleItem(item, dateKey, event.currentTarget)}>게시 설정</button> : null}</div></div>
          </article>;
        })}</div>}
        {remainingCount > 0 ? <button className="button publish-calendar-unreserved__more" type="button" onClick={() => setVisibleCount((count) => count + pageSize)}>더 보기 ({remainingCount}개)</button> : null}
      </section>
    </div>
    <div id={`publish-content-picker-panel-${manualMode}`} role="tabpanel" aria-labelledby={`publish-content-picker-tab-${manualMode}`} hidden={activeTab === "existing_content"} className="publish-content-picker__body">
      {optionsLoading ? <p role="status">콘텐츠 등록 선택 항목을 불러오는 중입니다.</p> : optionsError && !options ? <div><p role="alert">{optionsError}</p>{onLoadOptions ? <button className="button" type="button" onClick={onLoadOptions}>선택 항목 다시 불러오기</button> : null}</div> : <ManualPublishProvisioner mode={manualMode} dateKey={dateKey} connected={connected} options={options} optionsError={optionsError} onStartNew={onStartNew} initialBulkDraft={initialBulkDraft} onStartBulk={onStartBulk} onContinueBulk={onContinueBulk} onProvisionBatch={onProvisionBatch} />}
    </div>
    <footer className="publish-content-picker__footer"><button className="button" type="button" onClick={onClose}>취소</button></footer>
  </FocusTrap></div>;
}
