import { ChangeEvent } from "react";
import { Database, FileSpreadsheet, RefreshCw, Upload } from "lucide-react";
import { Alert } from "../ui/Alert";
import { Badge } from "../ui/Badge";
import { EmptyState } from "../ui/EmptyState";
import type { KnowledgeImport, WikiStatus } from "../../types";

interface DmKnowledgePanelProps {
  imports: KnowledgeImport[];
  wikiStatus: WikiStatus | null;
  loading: boolean;
  error: string | null;
  uploading: "faq" | "product" | null;
  refreshing: boolean;
  notice: string | null;
  onUpload(entryType: "faq" | "product", file: File): void;
  onRefresh(): void;
}

function UploadRow({ entryType, busy, onUpload }: { entryType: "faq" | "product"; busy: boolean; onUpload(file: File): void }) {
  const label = entryType === "faq" ? "FAQ" : "제품";
  const inputId = `knowledge-${entryType}-file`;
  const template = entryType === "faq" ? "/faq-template.csv" : "/product-template.csv";
  function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) onUpload(file);
    event.target.value = "";
  }
  return (
    <div className="dm-upload-row">
      <span className="dm-upload-icon"><FileSpreadsheet size={20} /></span>
      <div><strong>{label} 데이터</strong><span>CSV 또는 XLSX 파일을 추가하면 다음 Wiki 빌드에 반영됩니다.</span></div>
      <div className="actions">
        <a className="button" href={template} download>{label} 템플릿</a>
        <label className={`button primary${busy ? " is-disabled" : ""}`} htmlFor={inputId}><Upload size={16} /> {busy ? "업로드 중" : "파일 업로드"}</label>
        <input id={inputId} className="visually-hidden" type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={busy} onChange={handleFile} aria-label={`${label} 파일`} />
      </div>
    </div>
  );
}

export function DmKnowledgePanel({ imports, wikiStatus, loading, error, uploading, refreshing, notice, onUpload, onRefresh }: DmKnowledgePanelProps) {
  const active = wikiStatus?.activeVersion ?? null;
  const failed = wikiStatus?.latestFailedVersion ?? null;
  return (
    <section className="dm-knowledge-panel">
      <div className="dm-section-toolbar">
        <div><h2>지식 데이터</h2><p>FAQ, 제품 데이터와 자사 URL을 정리해 DM 답변 근거로 사용합니다.</p></div>
        <button className="button primary" type="button" onClick={onRefresh} disabled={refreshing}><RefreshCw size={16} /> {refreshing ? "등록 중" : "Wiki 다시 만들기"}</button>
      </div>
      {error ? <Alert title="API 상태" variant="warn">{error}</Alert> : null}
      {notice ? <Alert title="처리 결과" variant="ok">{notice}</Alert> : null}
      <div className="dm-upload-list">
        <UploadRow entryType="faq" busy={uploading === "faq"} onUpload={(file) => onUpload("faq", file)} />
        <UploadRow entryType="product" busy={uploading === "product"} onUpload={(file) => onUpload("product", file)} />
      </div>
      {loading ? <p className="dm-list-status">Wiki 상태를 불러오는 중입니다.</p> : null}
      {!loading && !error ? (
        <div className="dm-wiki-status">
          <div className="dm-wiki-version">
            <div className="dm-wiki-title"><Database size={20} /><div><strong>활성 Wiki</strong><span>{active ? `버전 ${active.version}` : "활성 버전 없음"}</span></div><Badge variant={active ? "ok" : "neutral"}>{active ? "사용 중" : "준비 필요"}</Badge></div>
            {active ? <div className="dm-stat-grid"><div><span>소스</span><strong>{active.sourceCount}</strong></div><div><span>문서</span><strong>{active.documentCount}</strong></div><div><span>지식 단위</span><strong>{active.knowledgeEntryCount}</strong></div><div><span>Chunk</span><strong>{active.chunkCount}</strong></div></div> : null}
            {active?.activatedAt ? <span className="muted small">마지막 활성화 {new Date(active.activatedAt).toLocaleString("ko-KR")}</span> : null}
          </div>
          {failed ? <Alert title={`최근 Wiki 빌드 실패 · 버전 ${failed.version}`} variant="warn">기존 활성 버전은 계속 사용됩니다. {failed.errorMessage || "오류 원인을 확인한 뒤 다시 만들어 주세요."}</Alert> : null}
        </div>
      ) : null}
      <section className="dm-import-history">
        <div className="panel-head"><h3>최근 업로드</h3><Badge variant="info">{imports.length}건</Badge></div>
        {imports.length === 0 ? <EmptyState title="업로드 이력이 없습니다" description="FAQ 또는 제품 데이터를 업로드하면 처리 결과가 표시됩니다." /> : (
          <div className="table-wrap"><table className="table"><thead><tr><th>구분</th><th>파일</th><th>유효</th><th>중복</th><th>오류</th><th>시간</th></tr></thead><tbody>{imports.map((item) => <tr key={item.id}><td><Badge variant="info">{item.entryType === "faq" ? "FAQ" : "제품"}</Badge></td><td>{item.fileName}</td><td>{item.validRows}</td><td>{item.duplicateRows}</td><td>{item.invalidRows}</td><td>{new Date(item.createdAt).toLocaleString("ko-KR")}</td></tr>)}</tbody></table></div>
        )}
      </section>
    </section>
  );
}
