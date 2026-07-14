import Link from "next/link";
import {
  ArrowRight,
  Check,
  ShieldCheck,
  UsersThree
} from "@phosphor-icons/react/dist/ssr";
import { serializeJsonLd } from "@/lib/seo";

const plans = [
  {
    name: "운영 시작",
    description: "한 브랜드의 기준을 세우고, 첫 콘텐츠 발행 흐름을 연결합니다.",
    price: "별도 견적",
    note: "첫 운영 범위 기준",
    recommended: false,
    facts: [["브랜드", "1개"], ["검토", "담당자 1명"], ["게시", "Instagram"]],
    features: ["브랜드 자료와 참고 링크 등록", "브랜드 기준을 반영한 콘텐츠 초안", "카드뉴스와 문구 검토", "승인 후 게시 흐름 연결"],
    cta: "운영 시작 상담"
  },
  {
    name: "팀 운영",
    description: "정기 발행팀이 자료, 검토, 게시 상태를 한 흐름으로 관리합니다.",
    price: "별도 견적",
    note: "정기 운영 범위 기준",
    recommended: true,
    facts: [["브랜드", "1개"], ["검토", "복수 담당자"], ["운영", "정기 발행"]],
    features: ["운영 시작 플랜의 전체 기능", "담당자별 검토와 승인 상태", "발행 일정과 운영 기준 관리", "운영 결과를 반영한 기준 업데이트"],
    cta: "팀 운영 상담"
  },
  {
    name: "확장 운영",
    description: "여러 역할과 브랜드를 운영 기준 안에서 함께 다루는 팀을 위한 플랜입니다.",
    price: "별도 견적",
    note: "확장 범위 협의",
    recommended: false,
    facts: [["브랜드", "복수 운영"], ["검토", "역할 분리"], ["연동", "범위 협의"]],
    features: ["복수 브랜드의 자료와 기준 관리", "승인 단계와 책임 범위 설계", "운영 리포트와 개선 흐름", "채널과 시스템 연동 범위 검토"],
    cta: "확장 운영 상담"
  }
] as const;

const comparisonGroups = [
  {
    title: "기본 운영",
    rows: [
      ["브랜드 자료 등록", "포함", "포함", "포함", "맞춤"],
      ["브랜드 기준 설정", "포함", "포함", "포함", "맞춤"],
      ["콘텐츠 초안과 카드뉴스", "포함", "포함", "포함", "맞춤"]
    ]
  },
  {
    title: "검토와 발행",
    rows: [
      ["담당자 검토 승인", "기본", "확장", "역할 분리", "맞춤"],
      ["Instagram 게시 연결", "포함", "포함", "포함", "협의"],
      ["정기 운영 일정", "협의", "포함", "포함", "맞춤"]
    ]
  },
  {
    title: "확장 범위",
    rows: [
      ["복수 브랜드 운영", "-", "협의", "포함", "맞춤"],
      ["운영 결과 리포트", "-", "기본", "포함", "맞춤"],
      ["API와 내부 시스템 연동", "-", "-", "검토", "별도 협의"]
    ]
  }
] as const;

const faqs = [
  {
    question: "왜 정해진 금액 대신 견적으로 안내하나요?",
    answer: "Brand Pilot은 브랜드 수, 월간 콘텐츠 수, 검토 인원과 게시 범위에 따라 필요한 운영량이 달라집니다. 사용하지 않는 범위를 포함한 일괄 요금 대신 현재 운영에 필요한 범위를 확인한 뒤 견적을 안내합니다."
  },
  {
    question: "도입 전에 어떤 정보를 준비해야 하나요?",
    answer: "운영할 브랜드 수, 현재 월간 발행량, 콘텐츠를 검토하는 담당자, 연결할 Instagram 계정과 참고 중인 자료를 알려주시면 됩니다. 정리된 문서가 없어도 상담에서 함께 확인할 수 있습니다."
  },
  {
    question: "초기 설정 비용과 월 운영 비용은 어떻게 구분되나요?",
    answer: "브랜드 자료와 운영 기준을 처음 구성하는 범위는 초기 설정으로, 이후 콘텐츠 생성과 검토, 게시 지원은 월 운영 범위로 구분합니다. 최종 금액과 결제 주기는 견적서 또는 계약서에서 확인할 수 있습니다."
  },
  {
    question: "운영 중에 플랜 범위를 바꿀 수 있나요?",
    answer: "네. 브랜드, 담당자, 발행량 또는 게시 범위가 달라지면 다음 운영 주기부터 범위를 다시 정할 수 있습니다. 변경 시점과 비용은 적용 전에 안내합니다."
  },
  {
    question: "Instagram 외 채널도 연결할 수 있나요?",
    answer: "현재 기본 게시 자동화 범위는 Instagram입니다. 다른 채널은 콘텐츠 형식, 권한과 운영 정책이 달라 맞춤 운영에서 별도로 검토합니다."
  }
] as const;

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: { "@type": "Answer", text: faq.answer }
  }))
};

export function BrandPilotPricingPage() {
  return (
    <main className="brand-pilot-pricing">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }} />

      <section className="bpp-hero">
        <div className="bpp-shell">
          <header className="bpp-hero__head">
            <p>BRAND PILOT 요금제</p>
            <h1>운영 범위에 맞는<br />플랜을 선택하세요.</h1>
            <span>브랜드 수, 발행 리듬, 검토 구조를 기준으로 필요한 운영만 견적에 담습니다.</span>
          </header>

          <div className="bpp-plans" aria-label="Brand Pilot 운영 플랜">
            {plans.map((plan) => (
              <article className={plan.recommended ? "bpp-plan bpp-plan--recommended" : "bpp-plan"} key={plan.name}>
                {plan.recommended ? <strong className="bpp-plan__badge">추천 플랜</strong> : null}
                <header>
                  <h2>{plan.name}</h2>
                  <p>{plan.description}</p>
                </header>
                <div className="bpp-plan__price">
                  <strong>{plan.price}</strong>
                  <span>{plan.note}</span>
                </div>
                <dl className="bpp-plan__facts">
                  {plan.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
                <ul className="bpp-plan__features">
                  {plan.features.map((feature) => <li key={feature}><Check aria-hidden size={16} weight="bold" />{feature}</li>)}
                </ul>
                <Link className={plan.recommended ? "bpp-button bpp-button--light" : "bpp-button"} href="/contact">{plan.cta}<ArrowRight aria-hidden size={16} /></Link>
              </article>
            ))}
          </div>

          <article className="bpp-custom">
            <div className="bpp-custom__icon"><ShieldCheck aria-hidden size={26} weight="duotone" /></div>
            <div className="bpp-custom__intro">
              <h2>맞춤 운영</h2>
              <p>조직별 승인 흐름, 보안 조건, SLA, API와 내부 시스템 연동을 함께 설계합니다.</p>
            </div>
            <ul aria-label="맞춤 운영 제공 범위">
              <li>복수 브랜드 운영 구조</li>
              <li>역할과 승인 흐름 설계</li>
              <li>SLA와 보안 조건 협의</li>
              <li>내부 시스템 연동 검토</li>
            </ul>
            <Link className="bpp-button bpp-button--outline" href="/contact">맞춤 운영 상담<ArrowRight aria-hidden size={16} /></Link>
          </article>
        </div>
      </section>

      <section className="bpp-section bpp-comparison" aria-labelledby="comparison-title">
        <div className="bpp-shell bpp-shell--wide">
          <header className="bpp-section__head bpp-section__head--center">
            <h2 id="comparison-title">플랜별 운영 범위</h2>
            <p>기본 운영부터 역할 분리와 연동 검토까지, 팀이 실제로 필요한 범위를 비교하세요.</p>
          </header>
          <p className="bpp-comparison__scroll-hint">표를 좌우로 밀어 전체 플랜을 비교하세요.</p>
          <div className="bpp-comparison__table-wrap" tabIndex={0}>
            <table>
              <thead>
                <tr><th scope="col">운영 항목</th><th scope="col">운영 시작</th><th scope="col">팀 운영</th><th scope="col">확장 운영</th><th scope="col">맞춤 운영</th></tr>
              </thead>
              {comparisonGroups.map((group) => <tbody key={group.title} className="bpp-comparison__group">
                  <tr className="bpp-comparison__group-title"><th colSpan={5} scope="colgroup">{group.title}</th></tr>
                  {group.rows.map(([feature, start, team, expand, custom]) => (
                    <tr key={feature}><th scope="row">{feature}</th><td>{start}</td><td>{team}</td><td>{expand}</td><td>{custom}</td></tr>
                  ))}
                </tbody>)}
            </table>
          </div>
          <p className="bpp-comparison__note">최종 제공 범위, 결제 주기와 환불 조건은 견적서, 신청 화면 또는 계약서에서 확정합니다.</p>
        </div>
      </section>

      <section className="bpp-section bpp-faq" aria-labelledby="faq-title">
        <div className="bpp-shell bpp-faq__inner">
          <header className="bpp-section__head bpp-section__head--center">
            <h2 id="faq-title">자주 묻는 질문</h2>
            <p>도입 범위와 견적을 정하기 전에 많이 확인하는 내용을 정리했습니다.</p>
          </header>
          <div className="bpp-faq__list">
            {faqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}
          </div>
        </div>
      </section>

      <section className="bpp-closing">
        <div className="bpp-shell">
          <UsersThree aria-hidden size={32} weight="duotone" />
          <h2>지금 운영하는 방식에<br />맞춰 시작하세요.</h2>
          <p>브랜드와 월간 발행량, 검토 인원을 확인한 뒤 맞는 운영 범위와 견적을 안내합니다.</p>
          <Link className="bpp-button" href="/contact">운영 범위 상담<ArrowRight aria-hidden size={16} /></Link>
        </div>
      </section>
    </main>
  );
}
