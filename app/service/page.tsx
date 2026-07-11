import Link from "next/link";
import {
  ContentOperationVisual,
  DecisionRulesVisual,
  ServiceArchitectureVisual
} from "@/components/explainer-visuals";
import { createPageMetadata } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "Service",
  description: "고객이 어디서 멈추는지 확인하고 필요한 서비스만 골라 유입부터 운영까지 연결합니다.",
  path: "/service"
});

const understandServices = [
  {
    title: "UX Research",
    headline: "결제 직전, 고객이 멈추는 이유를 찾습니다.",
    body: "대표의 직감이 아니라 실제 고객의 목소리와 행동으로 이탈 지점을 확인합니다.",
    scope: "심층 인터뷰 / 고객 여정 지도 / 경쟁사 비교",
    href: "/service/service-research"
  },
  {
    title: "Data Analytics",
    headline: "매출에 영향을 주는 숫자만 추적합니다.",
    body: "PV와 CTR을 나열하지 않고 의사결정에 필요한 지표와 비교 기준을 정합니다.",
    scope: "지표 설계 / 실험 분석 / ROAS 비교",
    href: "/service/service-analytics"
  }
] as const;

const structureServices = [
  {
    title: "Conversion Design",
    headline: "보기 좋은 화면을 다음 행동으로 연결합니다.",
    body: "고객이 무엇을 보고 판단하고 클릭할지 우선순위와 전환 흐름을 설계합니다.",
    scope: "정보 구조 / CTA 동선 / 페이지 연결",
    href: "/service/service-design"
  },
  {
    title: "Business Logic",
    headline: "개발 전에 업무 흐름과 판단 기준부터 고정합니다.",
    body: "To-Be 업무 흐름과 예외 조건, 권한과 상태값을 문서로 정리합니다.",
    scope: "PRD / 운영 규칙 / 관리자 기능",
    href: "/service/service-consulting"
  }
] as const;

export default function ServicePage() {
  return (
    <main className="studio-service">
      <section className="studio-service__hero">
        <div>
          <p className="studio-kicker">필요한 일만 정확하게</p>
          <h1>무엇을 만들지보다,<br /><em>왜 안 팔리는지부터</em> 봅니다.</h1>
          <p>고객이 멈추는 지점을 찾고, 필요한 전문성을 하나의 운영 흐름으로 연결합니다.</p>
          <Link className="studio-button" href="/contact">내 사업에 필요한 서비스 찾기</Link>
        </div>
        <ServiceArchitectureVisual />
      </section>

      <section className="studio-service__understand">
        <div className="studio-service__section-title">
          <span>고객을 이해합니다</span>
          <h2>먼저, 멈춘 이유를<br />증거로 확인합니다.</h2>
          <p>고객의 말과 행동, 실제 데이터를 함께 봐야 문제를 정확히 정의할 수 있습니다.</p>
        </div>
        <div className="studio-service__duo">
          {understandServices.map((service) => (
            <article key={service.title}>
              <p>{service.title}</p>
              <h3>{service.headline}</h3>
              <span>{service.body}</span>
              <small>{service.scope}</small>
              <Link href={service.href}>자세히 보기 →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="studio-service__structure">
        <DecisionRulesVisual />
        <div className="studio-service__structure-copy">
          <h2>그다음, 판단과 운영의<br />기준을 고정합니다.</h2>
          {structureServices.map((service) => (
            <article key={service.title}>
              <p>{service.title}</p>
              <h3>{service.headline}</h3>
              <span>{service.body}</span>
              <small>{service.scope}</small>
              <Link href={service.href}>자세히 보기 →</Link>
            </article>
          ))}
        </div>
      </section>

      <section className="studio-service__ship">
        <div className="studio-service__ship-heading">
          <h2>실제로 출시하고,<br />계속 운영되게 만듭니다.</h2>
          <p>문장과 제품, 콘텐츠 운영까지 같은 기준으로 연결합니다.</p>
        </div>
        <div className="studio-service__ship-grid">
          <article className="studio-service__writing">
            <p>Copywriting</p>
            <h3>고객의 망설임을 문장으로 풀어냅니다.</h3>
            <span>가격과 신뢰, 위험, 대안에 대한 질문에 먼저 답하고 다음 행동을 분명히 씁니다.</span>
            <small>핵심 메시지 / FAQ / CTA 문구</small>
            <Link href="/service/service-writing">카피라이팅 보기 →</Link>
          </article>
          <article className="studio-service__build">
            <p>Build</p>
            <h3>아이디어를 실제 고객이 써볼 수 있게 출시합니다.</h3>
            <span>MVP부터 운영 데이터와 다음 개선 기준까지 함께 설계합니다.</span>
            <small>MVP / 핵심 모듈 / 개선 사이클</small>
            <Link href="/service/service-startup">구축 서비스 보기 →</Link>
          </article>
          <article className="studio-service__brandpilot">
            <div>
              <p>Brand Pilot</p>
              <h3>브랜드의 말투를 지키며 꾸준히 발행합니다.</h3>
              <span>소스를 모으고 초안과 이미지를 만든 뒤, 사람이 확인하고 게시하는 흐름을 운영합니다.</span>
              <small>소스 수집 / 초안 / 이미지 / 게시</small>
              <Link href="/service/brandpilot">Brand Pilot 보기 →</Link>
            </div>
            <ContentOperationVisual />
          </article>
        </div>
      </section>

      <section className="studio-service__closing">
        <h2>서비스를 고르기 어렵다면,<br />문제부터 함께 정의합니다.</h2>
        <p>현재 사이트와 운영 흐름을 확인하고 가장 먼저 바꿔야 할 한 구간을 정리합니다.</p>
        <Link className="studio-button" href="/contact">15분 사전 진단 신청하기</Link>
      </section>
    </main>
  );
}
