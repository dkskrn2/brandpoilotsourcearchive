import { ChangeEvent, useEffect, useMemo, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { FileUploadButton } from "../components/ui/FileUploadButton";
import { ListSkeleton } from "../components/ui/LoadingState";
import { Tabs } from "../components/ui/Tabs";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { BadgeVariant, SourceCrawlRun, SourceSnapshot, SourceUrl, TopicRow, TopicUploadSummary } from "../types";

const topicStatusMeta: Record<TopicRow["status"], { label: string; variant: BadgeVariant }> = {
  uploaded: { label: "생성 후보", variant: "info" },
  queued: { label: "생성 예정", variant: "info" },
  used: { label: "사용 완료", variant: "ok" },
  skipped: { label: "제외", variant: "warn" },
  invalid: { label: "입력 오류", variant: "bad" },
  failed: { label: "처리 실패", variant: "bad" },
  disabled: { label: "비활성", variant: "neutral" }
};

const sourceTypeLabels: Record<SourceUrl["sourceType"], string> = {
  owned: "자사 URL",
  reference: "참고 URL"
};
const maxReferenceSourceUrls = 10;
const referenceSourceLimitMessage = "참고 URL은 최대 10개까지 등록할 수 있습니다.";
const duplicateSourceMessage = "같은 유형에 이미 등록된 URL입니다. 다른 URL을 입력하거나 유형을 변경하세요.";
const invalidSourceUrlMessage = "http:// 또는 https://로 시작하는 올바른 URL을 입력하세요.";

const errorLabels: Record<string, string> = {
  duplicate_existing_topic: "기존 주제 중복",
  topic_title_required: "주제 제목 누락",
  topic_angle_required: "주제 관점 누락",
  topic_title_malformed_text: "주제 제목 인코딩 오류",
  topic_angle_malformed_text: "주제 관점 인코딩 오류",
  target_customer_malformed_text: "타깃 고객 인코딩 오류",
  region_malformed_text: "지역 인코딩 오류",
  season_malformed_text: "시즌 인코딩 오류",
  notes_malformed_text: "메모 인코딩 오류"
};

function hasMalformedText(value: string | null | undefined) {
  return typeof value === "string" && (value.includes("\uFFFD") || /\?{2,}/.test(value));
}

function safeTopicDisplay(value: string | null | undefined, fallback = "인코딩 오류") {
  if (hasMalformedText(value)) return fallback;
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed.length > 0 ? trimmed : "-";
}

function stripBom(value: string) {
  return value.charCodeAt(0) === 0xFEFF ? value.slice(1) : value;
}

function sourceSaveErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("source_reference_limit_exceeded")) return referenceSourceLimitMessage;
  if (message.includes("source_url_duplicate")) return duplicateSourceMessage;
  if (message.includes("source_url_invalid") || message.includes("invalid_url")) return invalidSourceUrlMessage;
  return "API 저장에 실패했습니다. URL을 다시 확인하세요.";
}

function decodeText(buffer: ArrayBuffer, encoding: string, fatal = false) {
  return stripBom(new TextDecoder(encoding, { fatal }).decode(buffer));
}

function readFileArrayBuffer(file: File) {
  if (typeof file.arrayBuffer === "function") {
    return file.arrayBuffer();
  }
  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error("file_read_failed"));
    reader.readAsArrayBuffer(file);
  });
}

async function readTopicCsvFile(file: File) {
  const buffer = await readFileArrayBuffer(file);
  try {
    return decodeText(buffer, "utf-8", true);
  } catch {
    return decodeText(buffer, "euc-kr");
  }
}

interface EditingSource {
  id: string;
  url: string;
  sourceType: SourceUrl["sourceType"];
}

function SourceTable({
  sources,
  editingSource,
  onEdit,
  onCancelEdit,
  onChangeEdit,
  onSave,
  onDelete,
  onRetry,
  onToggleEnabled
}: {
  sources: SourceUrl[];
  editingSource: EditingSource | null;
  onEdit(source: SourceUrl): void;
  onCancelEdit(): void;
  onChangeEdit(next: EditingSource): void;
  onSave(): void;
  onDelete(source: SourceUrl): void;
  onRetry(source: SourceUrl): void;
  onToggleEnabled(source: SourceUrl): void;
}) {
  if (sources.length === 0) {
    return <EmptyState title="등록된 URL이 없습니다" description="콘텐츠 생성 근거로 사용할 URL을 먼저 추가하세요." />;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>URL</th>
          <th>소스 구분</th>
          <th>상태</th>
          <th>마지막 크롤링</th>
          <th>관리</th>
        </tr>
      </thead>
      <tbody>
        {sources.map((source) => {
          const isEditing = editingSource?.id === source.id;
          return (
            <tr key={source.id}>
              <td>
                {isEditing ? (
                  <input
                    aria-label="수정 URL"
                    value={editingSource.url}
                    onChange={(event) => onChangeEdit({ ...editingSource, url: event.target.value })}
                  />
                ) : source.url}
              </td>
              <td>
                {sourceTypeLabels[source.sourceType]}
              </td>
              <td>
                {source.lastError ? <Badge variant="bad">오류</Badge> : source.enabled ? source.status : <Badge variant="neutral">비활성</Badge>}
                {source.lastError ? <div className="row-meta">{source.lastError}</div> : null}
              </td>
              <td>{source.lastCrawledAt ?? "대기"}</td>
              <td>
                <div className="actions">
                  {isEditing ? (
                    <>
                      <button className="button primary" type="button" onClick={onSave}>저장</button>
                      <button className="button" type="button" onClick={onCancelEdit}>취소</button>
                    </>
                  ) : (
                    <>
                      <button className="button" type="button" aria-label={`수정 ${source.url}`} onClick={() => onEdit(source)}>수정</button>
                      {source.enabled && source.lastError ? <button className="button" type="button" aria-label={`재시도 ${source.url}`} onClick={() => onRetry(source)}>재시도</button> : null}
                      <button className="button" type="button" aria-label={`${source.enabled ? "비활성화" : "다시 활성화"} ${source.url}`} onClick={() => onToggleEnabled(source)}>{source.enabled ? "비활성화" : "다시 활성화"}</button>
                      <button className="button" type="button" aria-label={`삭제 ${source.url}`} onClick={() => onDelete(source)}>삭제</button>
                    </>
                  )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function sourceSnapshotStatus(snapshot: SourceSnapshot) {
  if (snapshot.status === "succeeded") return { label: "성공", variant: "ok" as const };
  if (snapshot.status === "failed") return { label: "실패", variant: "bad" as const };
  return { label: snapshot.status, variant: "neutral" as const };
}

function SourceQueueTable({ snapshots }: { snapshots: SourceSnapshot[] }) {
  if (snapshots.length === 0) {
    return <EmptyState title="크롤링 기록이 없습니다" description="전체 크롤링을 실행하면 자사 URL과 참고 URL의 크롤링 기록이 여기에 누적됩니다." />;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>URL</th>
          <th>유형</th>
          <th>상태</th>
          <th>크롤링 시간</th>
          <th>요약/오류</th>
        </tr>
      </thead>
      <tbody>
        {snapshots.map((snapshot) => {
          const meta = sourceSnapshotStatus(snapshot);
          return (
            <tr key={snapshot.id}>
              <td>
                <strong>{snapshot.url}</strong>
              </td>
              <td>{sourceTypeLabels[snapshot.sourceType]}</td>
              <td><Badge variant={meta.variant}>{meta.label}</Badge></td>
              <td>{new Date(snapshot.fetchedAt).toLocaleString("ko-KR")}</td>
              <td>{snapshot.errorMessage ?? snapshot.summary ?? "-"}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function crawlRunStatus(run: SourceCrawlRun) {
  if (run.status === "succeeded") return { label: "자동 크롤링 성공", variant: "ok" as const };
  if (run.status === "abandoned") return { label: "자동 재시도 종료", variant: "bad" as const };
  if (run.nextRetryAt) return { label: "재시도 예정", variant: "warn" as const };
  return { label: "일부 실패", variant: "bad" as const };
}

function RecentAutomaticCrawls({ runs }: { runs: SourceCrawlRun[] }) {
  const automaticRuns = runs.filter((run) => run.trigger === "scheduled" || run.trigger === "retry").slice(0, 5);
  if (automaticRuns.length === 0) return null;
  return (
    <div className="grid">
      <strong>최근 자동 실행</strong>
      {automaticRuns.map((run) => {
        const meta = crawlRunStatus(run);
        return (
          <div className="actions" key={run.id}>
            <Badge variant={meta.variant}>{meta.label}</Badge>
            <span className="muted">
              {run.finishedAt ? new Date(run.finishedAt).toLocaleString("ko-KR") : "실행 중"}
              {run.nextRetryAt ? ` · 다음 재시도 ${new Date(run.nextRetryAt).toLocaleString("ko-KR")}` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function topicIssueText(row: TopicRow) {
  if (row.validationErrors.length > 0) {
    return row.validationErrors.map((error) => errorLabels[error] ?? error).join(", ");
  }
  if (row.usedAt) {
    return `사용일 ${new Date(row.usedAt).toLocaleDateString("ko-KR")}`;
  }
  return "-";
}

function TopicQueueTable({ rows }: { rows: TopicRow[] }) {
  if (rows.length === 0) {
    return <EmptyState title="등록된 주제가 없습니다" description="주제표를 업로드하면 생성 후보, 중복 제외, 입력 오류 상태를 여기서 확인할 수 있습니다." />;
  }

  return (
    <table className="table">
      <thead>
        <tr>
          <th>주제</th>
          <th>관점</th>
          <th>상태</th>
          <th>우선순위</th>
          <th>제외 사유/사용일</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const meta = topicStatusMeta[row.status];
          const topicTitle = safeTopicDisplay(row.topicTitle);
          const topicAngle = safeTopicDisplay(row.topicAngle);
          const extra = [row.region, row.targetCustomer]
            .filter((value) => value && !hasMalformedText(value))
            .join(" · ");
          return (
            <tr key={row.id}>
              <td>
                <strong>{topicTitle}</strong>
                {extra ? <span className="muted">{extra}</span> : null}
              </td>
              <td>{topicAngle}</td>
              <td><Badge variant={meta.variant}>{meta.label}</Badge></td>
              <td>{row.priority}</td>
              <td>{topicIssueText(row)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export function SourcesPage() {
  const [sources, setSources] = useState<SourceUrl[]>([]);
  const [sourceSnapshots, setSourceSnapshots] = useState<SourceSnapshot[]>([]);
  const [sourceCrawlRuns, setSourceCrawlRuns] = useState<SourceCrawlRun[]>([]);
  const [topicRows, setTopicRows] = useState<TopicRow[]>([]);
  const [referenceUrl, setReferenceUrl] = useState("");
  const [csvText, setCsvText] = useState("");
  const [topicFileName, setTopicFileName] = useState("topics.csv");
  const [selectedTopicFile, setSelectedTopicFile] = useState<File | null>(null);
  const [uploadSummary, setUploadSummary] = useState<TopicUploadSummary | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<EditingSource | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  async function refreshSources() {
    const apiSources = await api.listSources(DEMO_BRAND_ID);
    setSources(apiSources);
  }

  async function refreshSourceSnapshots() {
    const snapshots = await api.listSourceSnapshots(DEMO_BRAND_ID);
    setSourceSnapshots(snapshots);
  }

  async function refreshSourceCrawlRuns() {
    const runs = await api.listSourceCrawlRuns(DEMO_BRAND_ID);
    setSourceCrawlRuns(runs);
  }

  async function refreshTopicRows() {
    const rows = await api.listTopicRows(DEMO_BRAND_ID);
    setTopicRows(rows);
  }

  useEffect(() => {
    let ignore = false;
    const sourcesRequest = api.listSources(DEMO_BRAND_ID)
      .then((apiSources) => {
        if (!ignore) {
          setSources(apiSources);
          setNotice(null);
        }
      })
      .catch(() => {
        if (!ignore) {
          setSources([]);
          setNotice("API 서버가 응답하지 않아 URL 목록을 불러오지 못했습니다.");
        }
      });
    const snapshotsRequest = api.listSourceSnapshots(DEMO_BRAND_ID)
      .then((snapshots) => {
        if (!ignore) setSourceSnapshots(snapshots);
      })
      .catch(() => {
        if (!ignore) setSourceSnapshots([]);
      });
    const crawlRunsRequest = api.listSourceCrawlRuns(DEMO_BRAND_ID)
      .then((runs) => {
        if (!ignore) setSourceCrawlRuns(runs);
      })
      .catch(() => {
        if (!ignore) setSourceCrawlRuns([]);
      });
    const topicRowsRequest = api.listTopicRows(DEMO_BRAND_ID)
      .then((rows) => {
        if (!ignore) setTopicRows(rows);
      })
      .catch(() => {
        if (!ignore) setTopicRows([]);
      });
    void Promise.allSettled([sourcesRequest, snapshotsRequest, crawlRunsRequest, topicRowsRequest]).then(() => {
      if (!ignore) setInitialLoading(false);
    });
    return () => {
      ignore = true;
    };
  }, []);

  const referenceSources = useMemo(() => sources.filter((source) => source.sourceType === "reference"), [sources]);
  const activeReferenceSourceCount = referenceSources.filter((source) => source.enabled).length;
  const referenceLimitReached = activeReferenceSourceCount >= maxReferenceSourceUrls;
  const uploadHasWarnings = Boolean(uploadSummary && (uploadSummary.duplicateRows > 0 || uploadSummary.invalidRows > 0));
  const sourceQueueCounts = useMemo(() => ({
    total: sourceSnapshots.length,
    succeeded: sourceSnapshots.filter((snapshot) => snapshot.status === "succeeded").length,
    failed: sourceSnapshots.filter((snapshot) => snapshot.status === "failed").length
  }), [sourceSnapshots]);
  const topicCounts = useMemo(() => ({
    available: topicRows.filter((row) => row.status === "uploaded" || row.status === "queued").length,
    skipped: topicRows.filter((row) => row.status === "skipped").length,
    invalid: topicRows.filter((row) => row.status === "invalid" || row.status === "failed").length,
    used: topicRows.filter((row) => row.status === "used").length
  }), [topicRows]);

  async function addSource(sourceType: SourceUrl["sourceType"], url: string) {
    const normalizedUrl = url.trim();
    if (!normalizedUrl) return;
    if (sourceType === "reference" && referenceLimitReached) {
      setNotice(referenceSourceLimitMessage);
      return;
    }
    try {
      const created = await api.createSource(DEMO_BRAND_ID, { sourceType, url: normalizedUrl });
      setSources((currentSources) => [created.source, ...currentSources]);
      setSourceCrawlRuns((currentRuns) => [created.initialCrawl, ...currentRuns]);
      setNotice(created.initialCrawl.status === "succeeded"
        ? `초기 크롤링 완료: 새 콘텐츠 ${created.initialCrawl.created}개`
        : `URL은 저장했지만 초기 크롤링에 실패했습니다. 재시도 예정입니다.`);
    } catch (error) {
      setNotice(sourceSaveErrorMessage(error));
      return;
    }
    if (sourceType === "reference") setReferenceUrl("");
  }

  function startEditSource(source: SourceUrl) {
    setEditingSource({ id: source.id, url: source.url, sourceType: source.sourceType });
  }

  async function saveEditedSource() {
    if (!editingSource?.url.trim()) return;
    const originalSource = sources.find((source) => source.id === editingSource.id);
    if (editingSource.sourceType === "reference" && originalSource?.sourceType !== "reference" && referenceLimitReached) {
      setNotice(referenceSourceLimitMessage);
      return;
    }
    try {
      const updated = await api.updateSource(editingSource.id, {
        sourceType: editingSource.sourceType,
        url: editingSource.url.trim()
      });
      setSources((currentSources) => currentSources.map((source) => source.id === updated.id ? updated : source));
      setEditingSource(null);
      setNotice(null);
    } catch (error) {
      setNotice(sourceSaveErrorMessage(error));
    }
  }

  async function deleteSource(source: SourceUrl) {
    if (!window.confirm(`${source.url}을 삭제할까요?`)) return;
    try {
      await api.deleteSource(source.id);
      setSources((currentSources) => currentSources.filter((item) => item.id !== source.id));
      if (editingSource?.id === source.id) setEditingSource(null);
      setNotice(null);
    } catch {
      setNotice("API 삭제에 실패했습니다. API 상태를 확인하세요.");
    }
  }

  async function retrySource(source: SourceUrl) {
    try {
      const run = await api.retrySource(DEMO_BRAND_ID, source.id);
      setSourceCrawlRuns((currentRuns) => [run, ...currentRuns]);
      await Promise.all([refreshSources(), refreshSourceSnapshots()]);
      setNotice(run.status === "succeeded" ? `재크롤링 완료: 새 콘텐츠 ${run.created}개` : "재크롤링을 실행했지만 일부 URL을 처리하지 못했습니다.");
    } catch {
      setNotice("재크롤링을 시작하지 못했습니다. URL 응답 상태와 API 연결을 확인하세요.");
    }
  }

  async function toggleSourceEnabled(source: SourceUrl) {
    try {
      const updated = await api.updateSource(source.id, { enabled: !source.enabled });
      setSources((currentSources) => currentSources.map((candidate) => candidate.id === updated.id ? updated : candidate));
      setNotice(updated.enabled ? "URL을 다시 활성화했습니다." : "URL을 비활성화했습니다. 자동 크롤링과 콘텐츠 생성에서 제외됩니다.");
    } catch {
      setNotice("URL 상태를 저장하지 못했습니다. API 상태를 확인하세요.");
    }
  }

  async function readTopicFile(input: ChangeEvent<HTMLInputElement> | File[]) {
    const file = Array.isArray(input) ? input[0] : input.target.files?.[0];
    if (!file) return;
    setSelectedTopicFile(file);
    setTopicFileName(file.name);
    setCsvText(await readTopicCsvFile(file));
    setUploadSummary(null);
  }

  async function uploadTopics() {
    if (!csvText.trim()) return;
    try {
      const result = await api.createTopicUpload(DEMO_BRAND_ID, { fileName: topicFileName, csvText });
      setUploadSummary(result);
      setNotice(null);
      await refreshTopicRows();
    } catch {
      setUploadSummary(null);
      setNotice("주제표 업로드에 실패했습니다. CSV 필수 헤더(topic_title, topic_angle)와 파일 형식을 확인하세요.");
    }
  }

  async function crawlAllSources() {
    try {
      const result = await api.crawlSources(DEMO_BRAND_ID);
      setNotice(`크롤링 완료: 처리 ${result.processed}개, 성공 ${result.created}개, 실패 ${result.failed}개`);
      await Promise.all([refreshSources(), refreshSourceSnapshots(), refreshSourceCrawlRuns()]);
    } catch {
      setNotice("크롤링 실행에 실패했습니다. API 서버와 URL 응답 상태를 확인하세요.");
    }
  }

  return (
    <section className="content">
      <PageHeader
        title="소스"
        description="참고 URL, 크롤링 기록, 주제표를 관리합니다. 자사 URL은 브랜드 설정에서 관리합니다."
        actions={<button className="button primary" type="button" onClick={crawlAllSources}>전체 크롤링</button>}
      />

      {notice ? <Alert title="API 상태" variant="warn">{notice}</Alert> : null}

      {initialLoading ? (
        <section className="panel"><div className="panel-body"><ListSkeleton rows={6} columns={4} label="소스 데이터를 불러오는 중입니다." /></div></section>
      ) : <Tabs
        defaultId="reference"
        items={[
          {
            id: "reference",
            label: "참고 URL",
            content: (
              <section className="panel">
                <div className="panel-head">
                  <h2>참고 URL</h2>
                  <Badge variant={referenceLimitReached ? "warn" : "info"}>{activeReferenceSourceCount}/{maxReferenceSourceUrls}개 활성</Badge>
                </div>
                <div className="panel-body grid">
                  <Alert title="참고 URL 처리 원칙" variant="warn">원문 문장을 재사용하지 않고, 주장과 관점을 브랜드 콘텐츠로 재해석합니다.</Alert>
                  {referenceLimitReached ? <Alert title="참고 URL 제한" variant="warn">{referenceSourceLimitMessage}</Alert> : null}
                  <div className="inline-form">
                    <input value={referenceUrl} onChange={(event) => setReferenceUrl(event.target.value)} placeholder="https://example.com/report" aria-label="참고 URL" disabled={referenceLimitReached} />
                    <button className="button primary" type="button" onClick={() => addSource("reference", referenceUrl)} disabled={referenceLimitReached}>URL 추가</button>
                  </div>
                  <SourceTable
                    sources={referenceSources}
                    editingSource={editingSource}
                    onEdit={startEditSource}
                    onCancelEdit={() => setEditingSource(null)}
                    onChangeEdit={setEditingSource}
                    onSave={saveEditedSource}
                    onDelete={deleteSource}
                    onRetry={retrySource}
                    onToggleEnabled={toggleSourceEnabled}
                  />
                </div>
              </section>
            )
          },
          {
            id: "upload",
            label: "주제표 업로드",
            content: (
              <section className="panel">
                <div className="panel-head">
                  <h2>주제표 업로드</h2>
                  <Badge variant="info">CSV</Badge>
                </div>
                <div className="panel-body grid">
                  <div className="actions">
                    <a className="button" href="/topic-template.csv">템플릿 다운로드</a>
                    <FileUploadButton
                      inputLabel="주제표 CSV 파일"
                      buttonLabel="CSV 파일 선택"
                      accept=".csv,text/csv"
                      items={selectedTopicFile ? [{ id: "topic-csv", name: selectedTopicFile.name, size: selectedTopicFile.size, status: "selected" }] : []}
                      onFiles={(files) => void readTopicFile(files)}
                      onRemove={() => {
                        setSelectedTopicFile(null);
                        setTopicFileName("topics.csv");
                        setCsvText("");
                        setUploadSummary(null);
                      }}
                    />
                    <button className="button primary" type="button" onClick={uploadTopics}>업로드 반영</button>
                  </div>
                  <textarea value={csvText} onChange={(event) => setCsvText(event.target.value)} rows={8} aria-label="주제표 CSV 내용" placeholder="topic_title,topic_angle,target_customer" />
                  <span className="muted">선택 파일: {topicFileName}</span>
                  {uploadSummary ? (
                    <Alert title={uploadHasWarnings ? "부분 반영 결과" : "검증 결과"} variant={uploadHasWarnings ? "warn" : "ok"}>
                      {uploadSummary.fileName}: 총 {uploadSummary.totalRows}행, 생성 후보 {uploadSummary.validRows}행, 기존 주제 중복 {uploadSummary.duplicateRows}행, 입력 오류 {uploadSummary.invalidRows}행입니다.
                      중복과 오류 행은 저장되지만 자동 생성 후보에서는 제외합니다.
                    </Alert>
                  ) : null}
                </div>
              </section>
            )
          },
          {
            id: "source-queue",
            label: "소스 큐",
            content: (
              <section className="panel">
                <div className="panel-head">
                  <h2>소스 큐</h2>
                  <Badge variant="info">크롤링 기록 {sourceQueueCounts.total}</Badge>
                </div>
                <div className="panel-body grid">
                  <div className="stat-grid">
                    <Badge variant="ok">성공 {sourceQueueCounts.succeeded}</Badge>
                    <Badge variant="bad">실패 {sourceQueueCounts.failed}</Badge>
                  </div>
                  <RecentAutomaticCrawls runs={sourceCrawlRuns} />
                  <SourceQueueTable snapshots={sourceSnapshots} />
                </div>
              </section>
            )
          },
          {
            id: "queue",
            label: "주제 큐",
            content: (
              <section className="panel">
                <div className="panel-head">
                  <h2>주제 큐</h2>
                  <Badge variant="info">업로드 후 생성 후보</Badge>
                </div>
                <div className="panel-body grid">
                  <div className="stat-grid">
                    <Badge variant="info">생성 후보 {topicCounts.available}</Badge>
                    <Badge variant="warn">중복 제외 {topicCounts.skipped}</Badge>
                    <Badge variant="bad">입력 오류 {topicCounts.invalid}</Badge>
                    <Badge variant="ok">사용 완료 {topicCounts.used}</Badge>
                  </div>
                  <TopicQueueTable rows={topicRows} />
                </div>
              </section>
            )
          }
        ]}
      />}
    </section>
  );
}
