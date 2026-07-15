import { CreditCard, ReceiptText } from "lucide-react";
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

function paymentStatusLabel(status: BillingSummary["payments"][number]["status"]) {
  const labels = {
    approved: "결제 완료",
    failed: "결제 실패",
    cancelled: "결제 취소",
    refunded: "환불 완료"
  } as const;
  return labels[status];
}

function formatAmount(amount: number | null) {
  return amount === null ? "가격 준비 중" : `월 ${new Intl.NumberFormat("ko-KR").format(amount)}원`;
}

function formatDate(value: string | null) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("ko-KR", { year: "numeric", month: "long", day: "numeric" }).format(new Date(value));
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
    <section className="content billing-page">
      <PageHeader
        title="결제 및 구독"
        description="월 구독 상태와 결제수단, 결제 이력을 관리합니다."
      />

      {error ? <Alert title="결제 정보" variant="bad">{error}</Alert> : null}
      {!summary && !error ? <p className="muted">결제 정보를 확인하고 있습니다.</p> : null}

      {summary ? (
        <div className="billing-sheet">
          <section className="billing-section" aria-labelledby="billing-plan-heading">
            <div className="billing-section-head">
              <h2 id="billing-plan-heading">청구</h2>
            </div>
            <div className="billing-plan-row">
              <div>
                <strong>{summary.subscription.planName ?? "Brand Pilot 월 구독"}</strong>
                <span>{formatAmount(summary.subscription.monthlyAmount)}</span>
                {summary.subscription.nextBillingAt ? <small>다음 결제일 {formatDate(summary.subscription.nextBillingAt)}</small> : null}
              </div>
              <Badge variant={statusVariant(summary.subscription.status)}>{statusLabel(summary.subscription.status)}</Badge>
              <button className="button" type="button" disabled>구독 시작</button>
            </div>
            {!summary.configured ? (
              <p className="billing-note">토스페이먼츠 연동 후 사용할 수 있습니다.</p>
            ) : null}
          </section>

          <section className="billing-section" aria-labelledby="billing-history-heading">
            <div className="billing-section-head">
              <h2 id="billing-history-heading">청구 내역</h2>
            </div>
            {summary.payments.length === 0 ? (
              <div className="billing-empty-row">
                <ReceiptText size={18} aria-hidden="true" />
                <span>결제 이력이 없습니다.</span>
              </div>
            ) : (
              <div className="billing-history-list">
                {summary.payments.map((payment) => (
                  <div className="billing-history-row" key={payment.id}>
                    <time dateTime={payment.approvedAt ?? undefined}>{formatDate(payment.approvedAt)}</time>
                    <span>{new Intl.NumberFormat("ko-KR").format(payment.amount)}원</span>
                    <Badge variant={payment.status === "approved" ? "ok" : payment.status === "failed" ? "bad" : "neutral"}>
                      {paymentStatusLabel(payment.status)}
                    </Badge>
                    <small>{payment.orderId}</small>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="billing-section" aria-labelledby="billing-profile-heading">
            <div className="billing-section-head">
              <h2 id="billing-profile-heading">결제 정보</h2>
              <button className="button" type="button" disabled>편집</button>
            </div>
            <dl className="billing-profile-list">
              <div><dt>결제 이메일</dt><dd>등록되지 않음</dd></div>
              <div><dt>이름</dt><dd>등록되지 않음</dd></div>
              <div><dt>주소</dt><dd>등록되지 않음</dd></div>
              <div><dt>사업자등록번호</dt><dd>등록되지 않음</dd></div>
            </dl>
          </section>

          <section className="billing-section" aria-labelledby="billing-method-heading">
            <div className="billing-section-head">
              <h2 id="billing-method-heading">결제 방법</h2>
              <button className="button" type="button" disabled>새로 추가</button>
            </div>
            {summary.paymentMethod ? (
              <div className="billing-method-row">
                <CreditCard size={20} aria-hidden="true" />
                <div>
                  <strong>{summary.paymentMethod.label}</strong>
                  {summary.paymentMethod.last4 ? <span>•••• {summary.paymentMethod.last4}</span> : null}
                </div>
              </div>
            ) : (
              <div className="billing-empty-row">
                <CreditCard size={18} aria-hidden="true" />
                <span>등록된 결제수단이 없습니다.</span>
              </div>
            )}
            <p className="billing-security-note">
              카드번호, 유효기간, CVC는 토스페이먼츠에서 직접 입력하며 Brand Pilot에 저장하지 않습니다.
            </p>
          </section>
        </div>
      ) : null}
    </section>
  );
}
