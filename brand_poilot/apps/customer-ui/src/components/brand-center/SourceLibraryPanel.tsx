import { useState } from "react";
import { Alert } from "../ui/Alert";
import { EmptyState } from "../ui/EmptyState";
import { ListSkeleton } from "../ui/LoadingState";
import { useSourceWorkspace } from "../../features/sources/useSourceWorkspace";

export function SourceLibraryPanel() {
  const workspace = useSourceWorkspace();
  const [url, setUrl] = useState("");
  const owned = workspace.sources.filter((source) => source.sourceType === "owned");

  async function add() {
    if (await workspace.add("owned", url)) setUrl("");
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div><span className="brand-center-eyebrow">OWNED SOURCES</span><h2>원본 자료</h2></div>
        <button className="button" type="button" onClick={() => void workspace.crawlAll()}>전체 다시 분석</button>
      </div>
      <div className="panel-body grid">
        <p className="muted">공식 홈페이지·제품 상세페이지처럼 브랜드 사실의 근거가 되는 URL만 등록합니다.</p>
        {workspace.notice && <Alert title="원본 자료 상태" variant="warn">{workspace.notice}</Alert>}
        <div className="inline-form">
          <input aria-label="자사 URL" placeholder="https://brand.example" value={url} onChange={(event) => setUrl(event.target.value)} />
          <button className="button primary" type="button" onClick={() => void add()}>URL 추가</button>
        </div>
        {workspace.loading ? <ListSkeleton rows={3} columns={3} label="원본 자료를 불러오는 중입니다." /> : owned.length === 0
          ? <EmptyState title="등록된 원본 자료가 없습니다" description="공식 URL을 등록하면 초기 크롤링을 바로 실행합니다." />
          : <ul className="source-library-list">
              {owned.map((source) => (
                <li key={source.id}>
                  <div><strong>{source.title ?? source.url}</strong><span>{source.url}</span></div>
                  <span>{source.lastError ? "오류" : source.enabled ? source.status : "비활성"}</span>
                  <div className="actions">
                    {source.lastError && <button className="button" type="button" onClick={() => void workspace.retry(source)}>재시도</button>}
                    <button className="button" type="button" onClick={() => void workspace.update(source.id, { enabled: !source.enabled })}>{source.enabled ? "비활성화" : "활성화"}</button>
                    <button className="button" type="button" onClick={() => {
                      if (window.confirm(`${source.url}을 삭제할까요?`)) void workspace.remove(source);
                    }}>삭제</button>
                  </div>
                </li>
              ))}
            </ul>}
        <a className="button" href="/references?view=external-urls">외부 레퍼런스 URL 관리</a>
      </div>
    </section>
  );
}
