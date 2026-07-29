import { ArrowRight, Check, ShieldCheck, Users } from "lucide-react";
import { Link } from "react-router-dom";
import {
  billingComparisonGroups,
  billingFaqs,
  billingPlans,
} from "./billingPricingContent";

export function BillingPricing() {
  return (
    <main className="billing-pricing">
      <section className="billing-pricing__hero">
        <header>
          <p>BRAND PILOT 요금제</p>
          <h1>운영 범위에 맞는 플랜을 선택하세요.</h1>
          <span>브랜드 수, 발행 리듬, 검토 구조를 기준으로 필요한 운영만 견적에 담습니다.</span>
        </header>
        <div className="billing-pricing__plans" aria-label="Brand Pilot 운영 플랜">
          {billingPlans.map((plan) => (
            <article
              className={`billing-pricing__plan${plan.recommended ? " billing-pricing__plan--recommended" : ""}`}
              key={plan.name}
            >
              {plan.recommended ? <strong className="billing-pricing__plan-badge">추천 플랜</strong> : null}
              <h2>{plan.name}</h2>
              <p>{plan.description}</p>
              <div className="billing-pricing__price"><strong>{plan.price}</strong><span>{plan.note}</span></div>
              <dl>{plan.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
              <ul>{plan.features.map((feature) => <li key={feature}><Check size={16} aria-hidden="true" />{feature}</li>)}</ul>
              <Link className="billing-pricing__plan-cta" to="/support">{plan.cta}<ArrowRight size={16} aria-hidden="true" /></Link>
            </article>
          ))}
        </div>
        <article className="billing-pricing__custom">
          <ShieldCheck aria-hidden="true" />
          <div><h2>맞춤 운영</h2><p>조직별 승인 흐름, 보안 조건, SLA, API와 내부 시스템 연동을 함께 설계합니다.</p></div>
          <ul aria-label="맞춤 운영 제공 범위">
            <li>복수 브랜드 운영 구조</li><li>역할과 승인 흐름 설계</li><li>SLA와 보안 조건 협의</li><li>내부 시스템 연동 검토</li>
          </ul>
          <Link to="/support">맞춤 운영 상담<ArrowRight size={16} aria-hidden="true" /></Link>
        </article>
      </section>

      <section aria-labelledby="billing-comparison-title">
        <header className="billing-pricing__section-heading">
          <h2 id="billing-comparison-title">플랜별 운영 범위</h2>
          <p>기본 운영부터 역할 분리와 연동 검토까지, 팀이 실제로 필요한 범위를 비교하세요.</p>
        </header>
        <div className="billing-pricing__comparison-scroll" role="region" aria-label="플랜별 운영 범위 표" tabIndex={0}>
          <table className="billing-pricing__comparison">
            <caption className="visually-hidden">플랜별 운영 범위</caption>
            <thead><tr><th scope="col">운영 항목</th><th scope="col">운영 시작</th><th scope="col">팀 운영</th><th scope="col">확장 운영</th><th scope="col">맞춤 운영</th></tr></thead>
            {billingComparisonGroups.map((group) => (
              <tbody key={group.label}>
                <tr><th colSpan={5} scope="colgroup">{group.label}</th></tr>
                {group.rows.map((row) => <tr key={row.feature}><th scope="row">{row.feature}</th><td>{row.start}</td><td>{row.team}</td><td>{row.expand}</td><td>{row.custom}</td></tr>)}
              </tbody>
            ))}
          </table>
        </div>
        <p>최종 제공 범위, 결제 주기와 환불 조건은 견적서, 신청 화면 또는 계약서에서 확정합니다.</p>
      </section>

      <section aria-labelledby="billing-faq-title">
        <header className="billing-pricing__section-heading"><h2 id="billing-faq-title">자주 묻는 질문</h2><p>도입 범위와 견적을 정하기 전에 많이 확인하는 내용을 정리했습니다.</p></header>
        <div className="billing-pricing__faq-list">
          {billingFaqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}
        </div>
      </section>

      <section className="billing-pricing__closing">
        <Users aria-hidden="true" />
        <h2>지금 운영하는 방식에 맞춰 시작하세요.</h2>
        <p>브랜드와 월간 발행량, 검토 인원을 확인한 뒤 맞는 운영 범위와 견적을 안내합니다.</p>
        <Link to="/support">운영 범위 상담<ArrowRight size={16} aria-hidden="true" /></Link>
      </section>
    </main>
  );
}
