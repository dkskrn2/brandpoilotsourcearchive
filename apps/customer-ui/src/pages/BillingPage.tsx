import { useEffect, useState } from "react";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { PageHeader } from "../components/layout/PageHeader";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { BillingSummary } from "../types";

function statusLabel(status: BillingSummary["subscription"]["status"]) {
  const labels = {
    none: "미구독",
    pending_payment: "결제 대기",
    active: "이용 중",
    cancel_scheduled: "해지 예정",
    suspended: "이용 중지",
    cancelled: "해지됨"
  } as const;
  return labels[status];
}

function statusVariant(status: BillingSummary["subscription"]["status"]) {
  if (status === "active") return "ok" as const;
  if (status === "cancel_scheduled" || status === "pending_payment") return "warn" as const;
  if (status === "suspended") return "bad" as const;
  return "neutral" as const;
}

export function BillingPage() {
  const [summary, setSummary] = useState<BillingSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api.getBillingSummary(DEMO_BRAND_ID)
      .then(setSummary)
      .catch(() => setError("결제 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요."));
  }, []);

  return (
    <section className="content">
      <PageHeader
        title="결제 및 구독"
        description="월 구독 상태와 결제수단, 결제 이력을 관리합니다."
      />

      {error ? <Alert title="결제 정보" variant="bad">{error}</Alert> : null}
      {!summary && !error ? <p className="muted">결제 정보를 확인하고 있습니다.</p> : null}

      {summary ? (
        <div className="grid two">
          <section className="panel">
            <div className="panel-head">
              <h2>현재 이용 상태</h2>
              <Badge variant={statusVariant(summary.subscription.status)}>{statusLabel(summary.subscription.status)}</Badge>
            </div>
            <div className="panel-body">
              {!summary.configured ? (
                <Alert title="결제 설정 준비 중" variant="info">
                  구독 플랜과 결제 설정이 완료되면 이 화면에서 결제수단 등록과 월 구독을 시작할 수 있습니다.
                </Alert>
              ) : null}
              <p>구독을 시작하면 콘텐츠 자동화 기능을 사용할 수 있습니다.</p>
              {summary.entitlement.source === "admin_grant" ? <p className="muted small">관리자가 제공한 이용 기간이 적용되어 있습니다.</p> : null}
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>결제수단</h2></div>
            <div className="panel-body">
              {summary.paymentMethod ? (
                <p>{summary.paymentMethod.label}{summary.paymentMethod.last4 ? ` · ${summary.paymentMethod.last4}` : ""}</p>
              ) : <p className="muted">등록된 결제수단이 없습니다.</p>}
              <button className="button primary" type="button" disabled>결제 설정 완료 후 등록 가능</button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-head"><h2>결제 이력</h2></div>
            <div className="panel-body">
              {summary.payments.length === 0 ? <p className="muted">결제 이력이 없습니다.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </section>
  );
}
