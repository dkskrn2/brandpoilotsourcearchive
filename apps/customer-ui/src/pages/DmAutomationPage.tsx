import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { EmptyState } from "../components/ui/EmptyState";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { InstagramDmHistory } from "../types";

export function DmAutomationPage() {
  const [history, setHistory] = useState<InstagramDmHistory[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    api.listInstagramDmHistory(DEMO_BRAND_ID).then(setHistory).catch(() => setNotice("DM 처리 이력을 불러오지 못했습니다."));
  }, []);
  return <section className="content">
    <PageHeader title="DM 자동답변" description="Instagram DM의 자동 처리 이력과 근거 기반 답변 결과를 확인합니다." />
    {notice ? <Alert title="API 상태" variant="warn">{notice}</Alert> : null}
    <section className="panel">
      <div className="panel-head"><h2>최근 처리</h2><Badge variant="info">최근 {history.length}건</Badge></div>
      <div className="panel-body">
        {history.length === 0 ? <EmptyState title="처리 이력이 없습니다" description="자동답변을 켜고 Instagram DM을 받으면 처리 결과가 여기에 표시됩니다." /> : <table className="table"><thead><tr><th>방향</th><th>내용</th><th>결정</th><th>시간</th></tr></thead><tbody>{history.map((item) => <tr key={item.id}><td><Badge variant={item.direction === "inbound" ? "info" : "ok"}>{item.direction === "inbound" ? "수신" : "발신"}</Badge></td><td>{item.body ?? "텍스트 외 메시지"}</td><td>{item.decision ?? "-"}</td><td>{new Date(item.createdAt).toLocaleString("ko-KR")}</td></tr>)}</tbody></table>}
      </div>
    </section>
  </section>;
}
