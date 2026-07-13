import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Tabs } from "../components/ui/Tabs";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { SupportRequest, SupportRequestCategory, SupportRequestStatus } from "../types";

const supportCategoryLabels: Record<SupportRequestCategory, string> = {
  bug: "오류",
  feature: "기능 건의",
  channel: "채널 연결",
  account: "계정/로그인",
  other: "기타"
};

const supportStatusLabels: Record<SupportRequestStatus, string> = {
  new: "접수",
  in_progress: "처리중",
  resolved: "완료"
};

function supportStatusVariant(status: SupportRequestStatus) {
  if (status === "resolved") return "ok";
  if (status === "in_progress") return "info";
  return "warn";
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("ko-KR", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

export function AdminChannelsPage() {
  const [activeTab, setActiveTab] = useState("support");
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [supportRequests, setSupportRequests] = useState<SupportRequest[]>([]);
  const [supportLoading, setSupportLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== "support") return;
    void loadSupportRequests();
  }, [activeTab]);

  async function loadSupportRequests() {
    setSupportLoading(true);
    try {
      const requests = await api.listSupportRequests(DEMO_BRAND_ID);
      setSupportRequests(requests);
      setApiNotice(null);
    } catch {
      setApiNotice("고객 문의 목록을 불러오지 못했습니다.");
    } finally {
      setSupportLoading(false);
    }
  }

  async function updateSupportStatus(requestId: string, status: SupportRequestStatus) {
    try {
      const updated = await api.updateSupportRequestStatus(requestId, status);
      setSupportRequests((currentRequests) => currentRequests.map((request) => request.id === updated.id ? updated : request));
      setApiNotice("고객 문의 상태가 업데이트됐습니다.");
    } catch {
      setApiNotice("고객 문의 상태 변경에 실패했습니다.");
    }
  }

  return (
    <section className="content">
      <PageHeader
        title="관리자 채널"
        description="고객 문의를 확인하고 처리 상태를 관리합니다."
      />

      {apiNotice ? (
        <section className="panel" style={{ marginBottom: 16 }}>
          <div className="panel-body">
            <Alert title="API 상태" variant={apiNotice.includes("업데이트") ? "ok" : "warn"}>{apiNotice}</Alert>
          </div>
        </section>
      ) : null}

      <Tabs
        defaultId="support"
        activeId={activeTab}
        onChange={setActiveTab}
        items={[
          {
            id: "support",
            label: "고객 문의",
            content: (
              <section className="panel">
                <div className="panel-head">
                  <h2>고객 문의</h2>
                  <div className="actions">
                    {supportLoading ? <Badge variant="info">불러오는 중</Badge> : null}
                    <button className="button" type="button" onClick={loadSupportRequests}>새로고침</button>
                  </div>
                </div>
                <div className="panel-body">
                  {supportRequests.length === 0 ? (
                    <Alert title="접수된 문의 없음" variant="info">
                      아직 고객 문의가 접수되지 않았습니다.
                    </Alert>
                  ) : (
                    <div className="table-wrap">
                      <table className="table">
                        <thead>
                          <tr>
                            <th>접수일</th>
                            <th>문의 유형</th>
                            <th>제목</th>
                            <th>내용 요약</th>
                            <th>연락 이메일</th>
                            <th>상태</th>
                            <th>작업</th>
                          </tr>
                        </thead>
                        <tbody>
                          {supportRequests.map((request) => (
                            <tr key={request.id}>
                              <td>{formatDateTime(request.createdAt)}</td>
                              <td>{supportCategoryLabels[request.category]}</td>
                              <td><strong>{request.title}</strong></td>
                              <td>{request.message}</td>
                              <td>{request.contactEmail ?? "-"}</td>
                              <td><Badge variant={supportStatusVariant(request.status)}>{supportStatusLabels[request.status]}</Badge></td>
                              <td>
                                <div className="actions">
                                  <button
                                    className="button"
                                    type="button"
                                    onClick={() => updateSupportStatus(request.id, "in_progress")}
                                    disabled={request.status === "in_progress" || request.status === "resolved"}
                                  >
                                    처리중
                                  </button>
                                  <button
                                    className="button"
                                    type="button"
                                    onClick={() => updateSupportStatus(request.id, "resolved")}
                                    disabled={request.status === "resolved"}
                                  >
                                    완료
                                  </button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </section>
            )
          }
        ]}
      />
    </section>
  );
}
