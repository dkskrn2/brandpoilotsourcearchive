import { useEffect, useMemo, useState } from "react";
import type {
  PublishCalendarContentCandidate,
  PublishCalendarManualOptions,
  PublishCalendarManualSlotInput,
  PublishCalendarNewContentSetup,
} from "../../types";
import type { PublishCalendarBulkDraft, PublishCalendarBulkDraftRow } from "../../features/publishing/publishCalendarBulkDraft";

type SourceMode = "generating" | "completed_unpublished" | "new_content" | "bulk";

type Props = {
  dateKey: string;
  connected: boolean;
  options: PublishCalendarManualOptions | null;
  optionsError: string | null;
  onLoadCandidates(kind: "generating" | "completed_unpublished"): Promise<PublishCalendarContentCandidate[]>;
  onProvision(input: PublishCalendarManualSlotInput): Promise<boolean>;
  onStartNew(input: { scheduledFor: string; contentFormat: "card_news" | "reel"; setup: PublishCalendarNewContentSetup }): void;
  initialBulkDraft: PublishCalendarBulkDraft | null;
  onStartBulk(rows: PublishCalendarBulkDraftRow[]): void;
  onContinueBulk(draft: PublishCalendarBulkDraft, row: PublishCalendarBulkDraftRow): void;
  onProvisionBatch(draft: PublishCalendarBulkDraft): Promise<boolean>;
};

function scheduledFor(dateKey: string, time: string) {
  return new Date(`${dateKey}T${time}:00+09:00`).toISOString();
}

function SetupFields({ options, setup, onChange }: {
  options: PublishCalendarManualOptions;
  setup: PublishCalendarNewContentSetup & { contentFormat: "card_news" | "reel" };
  onChange(value: PublishCalendarNewContentSetup & { contentFormat: "card_news" | "reel" }): void;
}) {
  const subject = options.subjectModes.find((item) => item.value === setup.subjectMode);
  return <div className="publish-calendar-setup-fields">
    <label>목적<select aria-label="콘텐츠 목적" value={setup.purpose} onChange={(event) => onChange({ ...setup, purpose: event.target.value as typeof setup.purpose })}>{options.purposes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    <label>주제 방식<select aria-label="주제 방식" value={setup.subjectMode} onChange={(event) => onChange({ ...setup, subjectMode: event.target.value as typeof setup.subjectMode })}>{options.subjectModes.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
    {subject?.requiredField === "topicUrl" ? <label>URL<input aria-label="주제 URL" type="url" value={setup.topicUrl ?? ""} onChange={(event) => onChange({ ...setup, topicUrl: event.target.value })} /></label> : null}
    {subject?.requiredField === "topicText" ? <label>주제<input aria-label="주제" value={setup.topicText ?? ""} onChange={(event) => onChange({ ...setup, topicText: event.target.value })} /></label> : null}
    {subject?.requiredField === "contentSuggestionId" ? <label>추천 주제<select aria-label="추천 주제" value={setup.contentSuggestionId ?? ""} onChange={(event) => onChange({ ...setup, contentSuggestionId: event.target.value })}><option value="">선택</option>{options.suggestions.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
    {subject?.requiredField === "referenceId" ? <label>레퍼런스<select aria-label="레퍼런스" value={setup.referenceId ?? ""} onChange={(event) => onChange({ ...setup, referenceId: event.target.value })}><option value="">선택</option>{options.references.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
    {setup.purpose === "marketing" ? <label>제품·서비스<select aria-label="제품·서비스" value={setup.productId ?? ""} onChange={(event) => onChange({ ...setup, productId: event.target.value })}><option value="">선택</option>{options.products.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label> : null}
    <label>형식<select aria-label="콘텐츠 형식" value={setup.contentFormat} onChange={(event) => onChange({ ...setup, contentFormat: event.target.value as typeof setup.contentFormat })}>{options.channels.find((item) => item.value === "instagram")?.formats.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
  </div>;
}

export function ManualPublishProvisioner({ dateKey, connected, options, optionsError, onLoadCandidates, onProvision, onStartNew, initialBulkDraft, onStartBulk, onContinueBulk, onProvisionBatch }: Props) {
  const [mode, setMode] = useState<SourceMode>(initialBulkDraft ? "bulk" : "generating");
  const [time, setTime] = useState("11:30");
  const [candidates, setCandidates] = useState<PublishCalendarContentCandidate[]>([]);
  const [candidateId, setCandidateId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setup, setSetup] = useState<PublishCalendarNewContentSetup & { contentFormat: "card_news" | "reel" }>({ purpose: "informational", subjectMode: "topic_text", topicText: "", contentFormat: "card_news" });
  const [bulkRows, setBulkRows] = useState<Array<{ clientRowId: string; time: string; setup: typeof setup }>>(() => [
    { clientRowId: crypto.randomUUID(), time: "11:30", setup: { ...setup } },
    { clientRowId: crypto.randomUUID(), time: "12:00", setup: { ...setup } },
  ]);
  const target = useMemo(() => candidates.find((item) => `${item.generationId}:${item.generationOutputId ?? ""}` === candidateId) ?? null, [candidateId, candidates]);

  useEffect(() => {
    setCandidateId("");
    setCandidates([]);
    setError(null);
    if (mode !== "generating" && mode !== "completed_unpublished") return;
    let active = true;
    setLoading(true);
    void onLoadCandidates(mode).then((items) => { if (active) setCandidates(items); }).catch(() => { if (active) setError("콘텐츠 목록을 불러오지 못했습니다."); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [mode, onLoadCandidates]);

  const planned = Date.parse(`${dateKey}T${time}:00+09:00`);
  const invalidTime = !Number.isFinite(planned) || planned <= Date.now();
  const subject = options?.subjectModes.find((item) => item.value === setup.subjectMode);
  const setupReady = Boolean(options && subject && (subject.requiredField === "topicText" ? setup.topicText?.trim() : subject.requiredField === "topicUrl" ? setup.topicUrl?.trim() : subject.requiredField === "contentSuggestionId" ? setup.contentSuggestionId : setup.referenceId) && (setup.purpose !== "marketing" || setup.productId));
  const generationAvailable = options?.usage?.generation?.additionalAvailable;
  const newGenerationUnavailable = typeof generationAvailable === "number" && generationAvailable < 1;
  const bulkGenerationExceeded = typeof generationAvailable === "number" && bulkRows.length > generationAvailable;
  const bulkTimesValid = useMemo(() => {
    const values = bulkRows.map((row) => Date.parse(`${dateKey}T${row.time}:00+09:00`)).sort((a, b) => a - b);
    return values.every((value) => Number.isFinite(value) && value > Date.now()) && values.every((value, index) => index === 0 || value - values[index - 1] >= 30 * 60 * 1000);
  }, [bulkRows, dateKey]);

  async function provision() {
    if (!target) return;
    if (Date.parse(`${dateKey}T${time}:00+09:00`) <= Date.now()) { setError("선택한 게시 시각이 이미 지났습니다. 미래 시각을 선택해 주세요."); return; }
    setError(null);
    const ok = await onProvision({ scheduledFor: scheduledFor(dateKey, time), channel: "instagram", contentFormat: target.contentFormat, idempotencyKey: crypto.randomUUID(), source: target.generationOutputId ? { kind: "existing_output", generationOutputId: target.generationOutputId } : { kind: "existing_generation", generationId: target.generationId } });
    if (!ok) setError("콘텐츠를 게시 일정에 연결하지 못했습니다.");
  }

  return <section className="publish-calendar-manual-form publish-calendar-provisioner" aria-label="콘텐츠가 연결된 게시 추가">
    <strong>게시할 콘텐츠와 시간을 선택하세요</strong>
    {options?.usage?.publishing ? <small>이번 주 추가 예약 가능 {options.usage.publishing.additionalAvailable}건 · 게시 한도 {options.usage.publishing.limit}건{typeof generationAvailable === "number" ? ` · 생성 ${generationAvailable}건 가능` : ""}</small> : null}
    <label>게시 시간<input type="time" aria-label="수동 게시 시간" value={time} onChange={(event) => { setTime(event.target.value); setError(null); }} /></label>
    <fieldset aria-label="추가할 콘텐츠 선택"><legend>콘텐츠 선택</legend>{([
      ["generating", "생성 중 콘텐츠"], ["completed_unpublished", "생성 완료 · 미게시"], ["new_content", "새 콘텐츠 생성"], ["bulk", "여러 주제 일괄 설정"],
    ] as const).map(([value, label]) => <label key={value}><input type="radio" name="manual-publish-source" value={value} checked={mode === value} onChange={() => setMode(value)} />{label}</label>)}</fieldset>
    {!connected ? <p role="alert">연결·활성화된 Instagram 채널이 필요합니다.</p> : null}
    {optionsError ? <p role="alert">{optionsError}</p> : null}
    {(mode === "generating" || mode === "completed_unpublished") ? <>
      <label>콘텐츠<select aria-label="게시할 콘텐츠" value={candidateId} onChange={(event) => setCandidateId(event.target.value)} disabled={loading}><option value="">{loading ? "불러오는 중" : "선택"}</option>{candidates.map((item) => <option key={`${item.generationId}:${item.generationOutputId ?? ""}`} value={`${item.generationId}:${item.generationOutputId ?? ""}`} disabled={!item.assignable}>{item.title}{item.assignable ? "" : ` · ${item.blockedReason ?? "배정 불가"}`}</option>)}</select></label>
      <button className="button primary" type="button" disabled={!connected || !target?.assignable || invalidTime} onClick={() => void provision()}>콘텐츠 연결 후 예약</button>
    </> : null}
    {mode === "new_content" && options ? <>
      <SetupFields options={options} setup={setup} onChange={setSetup} />
      {newGenerationUnavailable ? <p role="alert">이번 구독 주기의 콘텐츠 생성 가능 횟수가 없습니다.</p> : null}
      <button className="button primary" type="button" disabled={!connected || invalidTime || !setupReady || newGenerationUnavailable} onClick={() => { if (Date.parse(`${dateKey}T${time}:00+09:00`) <= Date.now()) { setError("선택한 게시 시각이 이미 지났습니다. 미래 시각을 선택해 주세요."); return; } onStartNew({ scheduledFor: scheduledFor(dateKey, time), contentFormat: setup.contentFormat, setup }); }}>생성 1단계에서 계속</button>
      <small>구성안을 선택해 생성 ID가 확정된 뒤에만 게시 슬롯이 만들어집니다.</small>
    </> : null}
    {mode === "bulk" && options ? <div className="publish-calendar-bulk-intro"><p>목적·주제·형식을 여러 행에 입력하고 각 행의 구성안을 선택한 뒤 한 번에 배정합니다. 시간은 최소 30분 간격이어야 합니다.</p>
      {initialBulkDraft ? <div className="publish-calendar-bulk-progress"><strong>구성안 선택 진행</strong>{initialBulkDraft.rows.map((row, index) => <div key={row.clientRowId}><span>{index + 1}. {row.setup.topicText || row.setup.topicUrl || "선택 주제"}</span><span>{row.generationId ? "구성안 선택 완료" : "구성안 선택 필요"}</span>{!row.generationId ? <button className="button" type="button" onClick={() => onContinueBulk(initialBulkDraft, row)}>구성안 선택</button> : null}</div>)}<button className="button primary" type="button" disabled={initialBulkDraft.rows.some((row) => !row.generationId)} onClick={() => void onProvisionBatch(initialBulkDraft)}>전체 게시 일정 배정</button></div> : <>
        <div className="publish-calendar-bulk-table" role="table" aria-label="일괄 주제 설정"><div role="row" className="publish-calendar-bulk-table__head"><span>시간</span><span>목적·주제·형식</span><span>관리</span></div>{bulkRows.map((row, index) => <div role="row" key={row.clientRowId}><label>시간<input aria-label={`${index + 1}행 게시 시간`} type="time" value={row.time} onChange={(event) => setBulkRows((current) => current.map((item) => item.clientRowId === row.clientRowId ? { ...item, time: event.target.value } : item))} /></label><SetupFields options={options} setup={row.setup} onChange={(value) => setBulkRows((current) => current.map((item) => item.clientRowId === row.clientRowId ? { ...item, setup: value } : item))} /><button className="button" type="button" disabled={bulkRows.length <= 1} onClick={() => setBulkRows((current) => current.filter((item) => item.clientRowId !== row.clientRowId))}>행 삭제</button></div>)}</div>
        {!bulkTimesValid ? <p role="alert">모든 게시 시간은 미래이며 서로 최소 30분 간격이어야 합니다.</p> : null}
        {bulkGenerationExceeded ? <p role="alert">생성 가능 횟수는 {generationAvailable}건이며 현재 {bulkRows.length}개 주제가 입력되었습니다.</p> : null}
        <div className="actions"><button className="button" type="button" onClick={() => setBulkRows((current) => { const last = current.at(-1)?.time ?? "11:30"; const [hour, minute] = last.split(":").map(Number); const total = (hour * 60 + minute + 30) % 1440; return [...current, { clientRowId: crypto.randomUUID(), time: `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`, setup: { ...setup } }]; })}>행 추가 (+30분)</button><button className="button primary" type="button" disabled={!connected || !bulkTimesValid || bulkGenerationExceeded || bulkRows.some((row) => !row.time || (!row.setup.topicText?.trim() && !row.setup.topicUrl?.trim() && !row.setup.contentSuggestionId && !row.setup.referenceId) || (row.setup.purpose === "marketing" && !row.setup.productId))} onClick={() => onStartBulk(bulkRows.map((row) => ({ clientRowId: row.clientRowId, scheduledFor: scheduledFor(dateKey, row.time), contentFormat: row.setup.contentFormat, setup: row.setup, generationId: null })))}>일괄 설정 시작</button></div>
      </>}
    </div> : null}
    {invalidTime ? <small role="alert">과거 시각에는 게시 일정을 추가할 수 없습니다.</small> : null}
    {error ? <p role="alert">{error}</p> : null}
  </section>;
}
