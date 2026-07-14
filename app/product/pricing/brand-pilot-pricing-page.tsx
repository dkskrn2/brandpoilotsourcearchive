import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  Buildings,
  CalendarDots,
  Check,
  FlowArrow,
  ShieldCheck,
  UsersThree
} from "@phosphor-icons/react/dist/ssr";
import { serializeJsonLd } from "@/lib/seo";

const plans = [
  {
    name: "운영 시작",
    description: "한 브랜드의 콘텐츠 운영 기준을 만들고 첫 발행 흐름을 연결합니다.",
    price: "별도 견적",
    period: "월 운영 기준",
    recommended: false,
    facts: [
      ["브랜드", "1개"],
      ["게시 채널", "Instagram"],
      ["검토 방식", "담당자 승인"]
    ],
    features: [
      "웹사이트, 참고 URL, 문서와 노트 등록",
      "브랜드 기준을 반영한 콘텐츠 초안",
      "최대 5장의 카드뉴스 구성",
      "승인 후 Instagram 게시 연결"
    ]
  },
  {
    name: "팀 운영",
    description: "콘텐츠를 정기 발행하는 팀이 자료, 검토, 게시 상태를 함께 관리합니다.",
    price: "별도 견적",
    period: "월 운영 기준",
    recommended: true,
    facts: [
      ["브랜드", "1개부터"],
      ["참여 인원", "복수 담당자"],
      ["운영 방식", "정기 발행"]
    ],
    features: [
      "운영 시작 플랜의 전체 기능",
      "담당자별 검토와 승인 상태 관리",
      "정기 콘텐츠 일정과 발행 범위 설계",
      "운영 결과를 반영한 기준 업데이트"
    ]
  }
] as const;

const pricingFactors = [
  {
    icon: Buildings,
    title: "운영할 브랜드",
    body: "브랜드 수와 각 브랜드에 필요한 말투, 금지 표현, 자료 구조를 확인합니다."
  },
  {
    icon: CalendarDots,
    title: "월간 발행 범위",
    body: "한 달에 필요한 콘텐츠 수와 카드뉴스 구성, 검토 일정을 기준으로 산정합니다."
  },
  {
    icon: FlowArrow,
    title: "승인과 연동 범위",
    body: "담당자 수, 승인 단계, 게시 채널과 별도 시스템 연동 필요 여부를 확인합니다."
  }
] as const;

const comparisonRows = [
  ["브랜드 자료 등록", "포함", "포함", "맞춤"],
  ["브랜드 기준 설정", "포함", "포함", "맞춤"],
  ["콘텐츠 초안과 카드뉴스", "포함", "포함", "맞춤"],
  ["담당자 검토 승인", "기본", "확장", "맞춤"],
  ["Instagram 게시 연결", "포함", "포함", "협의"],
  ["정기 운영 일정", "협의", "포함", "맞춤"],
  ["복수 브랜드 운영", "-", "협의", "맞춤"],
  ["API와 내부 시스템 연동", "-", "-", "별도 검토"]
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
            <p>BRAND PILOT PRICING</p>
            <h1>운영에 맞는 만큼<br />선택하세요.</h1>
            <span>브랜드 수, 발행량, 검토와 게시 범위를 확인한 뒤 필요한 항목만 견적에 담습니다.</span>
          </header>

          <div className="bpp-plans">
            {plans.map((plan) => (
              <article className={plan.recommended ? "bpp-plan bpp-plan--recommended" : "bpp-plan"} key={plan.name}>
                {plan.recommended ? <strong className="bpp-plan__badge">추천</strong> : null}
                <header>
                  <h2>{plan.name}</h2>
                  <p>{plan.description}</p>
                </header>
                <div className="bpp-plan__price">
                  <strong>{plan.price}</strong>
                  <span>{plan.period}</span>
                </div>
                <dl className="bpp-plan__facts">
                  {plan.facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
                </dl>
                <ul className="bpp-plan__features">
                  {plan.features.map((feature) => <li key={feature}><Check aria-hidden size={18} weight="bold" />{feature}</li>)}
                </ul>
                <Link className={plan.recommended ? "bpp-button bpp-button--light" : "bpp-button"} href="/contact">도입 상담하기</Link>
              </article>
            ))}
          </div>

          <article className="bpp-custom">
            <div className="bpp-custom__intro">
              <ShieldCheck aria-hidden size={30} weight="duotone" />
              <div>
                <h2>맞춤 운영</h2>
                <p>여러 브랜드와 승인 조직을 하나의 운영 기준으로 연결해야 하는 팀을 위한 설계형 플랜입니다.</p>
              </div>
            </div>
            <ul>
              <li>복수 브랜드 운영 구조</li>
              <li>역할과 승인 흐름 설계</li>
              <li>SLA와 보안 조건 협의</li>
              <li>API와 내부 시스템 연동 검토</li>
            </ul>
            <Link className="bpp-button bpp-button--outline" href="/contact">도입 상담하기 <ArrowRight aria-hidden size={18} /></Link>
          </article>
        </div>
      </section>

      <section className="bpp-section bpp-factors">
        <div className="bpp-shell">
          <header className="bpp-section__head">
            <h2>견적을 결정하는<br />세 가지 범위</h2>
            <p>같은 기능을 묶어 판매하기보다 실제 운영량과 협업 방식에 맞춰 시작 범위를 정합니다.</p>
          </header>
          <div className="bpp-factors__list">
            {pricingFactors.map(({ icon: Icon, title, body }) => (
              <article key={title}>
                <Icon aria-hidden size={30} weight="duotone" />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bpp-section bpp-included">
        <div className="bpp-shell bpp-included__grid">
          <figure>
            <Image
              src="/images/product/brand-pilot-workflow-v1.webp"
              alt="자료 수집, 콘텐츠 초안, 검토 승인과 Instagram 게시를 연결한 Brand Pilot 화면"
              width={1536}
              height={1024}
              sizes="(max-width: 960px) calc(100vw - 40px), 54vw"
            />
          </figure>
          <div>
            <h2>어떤 플랜이든<br />운영 흐름은 같습니다.</h2>
            <p>자료와 브랜드 기준을 먼저 정하고, 사람이 확인한 콘텐츠만 게시 흐름으로 보냅니다.</p>
            <ul>
              <li><Check aria-hidden size={18} weight="bold" />근거 자료를 분리해 관리</li>
              <li><Check aria-hidden size={18} weight="bold" />브랜드 기준을 초안에 적용</li>
              <li><Check aria-hidden size={18} weight="bold" />카드뉴스와 문구를 함께 검토</li>
              <li><Check aria-hidden size={18} weight="bold" />승인 결과와 게시 상태를 기록</li>
            </ul>
            <Link className="bpp-text-link" href="/product">제품 소개 보기 <ArrowRight aria-hidden size={18} /></Link>
          </div>
        </div>
      </section>

      <section className="bpp-section bpp-comparison">
        <div className="bpp-shell">
          <header className="bpp-section__head">
            <h2>플랜별 운영 범위</h2>
            <p>기본 기능은 함께 제공하고, 협업과 연동이 복잡해질 때 운영 범위를 확장합니다.</p>
          </header>
          <div className="bpp-comparison__table-wrap">
            <table>
              <thead>
                <tr><th scope="col">운영 항목</th><th scope="col">운영 시작</th><th scope="col">팀 운영</th><th scope="col">맞춤 운영</th></tr>
              </thead>
              <tbody>
                {comparisonRows.map(([feature, start, team, custom]) => (
                  <tr key={feature}><th scope="row">{feature}</th><td>{start}</td><td>{team}</td><td>{custom}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="bpp-comparison__note">최종 제공 범위, 결제 주기와 환불 조건은 견적서, 신청 화면 또는 계약서에서 확정합니다.</p>
        </div>
      </section>

      <section className="bpp-section bpp-faq">
        <div className="bpp-shell bpp-faq__grid">
          <header className="bpp-section__head">
            <h2>요금제에 대해<br />자주 묻는 질문</h2>
            <p>도입 범위와 견적을 정하기 전에 많이 확인하는 내용을 정리했습니다.</p>
          </header>
          <div className="bpp-faq__list">
            {faqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}
          </div>
        </div>
      </section>

      <section className="bpp-closing">
        <div className="bpp-shell">
          <UsersThree aria-hidden size={34} weight="duotone" />
          <h2>지금 운영하는 방식부터<br />간단히 알려주세요.</h2>
          <p>브랜드와 월간 발행량, 검토 인원을 확인한 뒤 맞는 플랜과 견적을 안내합니다.</p>
          <Link className="bpp-button" href="/contact">도입 상담하기</Link>
        </div>
      </section>
    </main>
  );
}
