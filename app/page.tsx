import Link from "next/link";
import { ConversionPathVisual, RevenueDiagnosticVisual } from "@/components/explainer-visuals";
import { PerformanceStories } from "@/components/performance-stories";
import { createPageMetadata, serializeJsonLd, webPageJsonLd } from "@/lib/seo";

export const metadata = createPageMetadata({
  title: "GROWTHLINE | 막힌 매출 흐름을 다시 연결합니다",
  description: "유입과 문의, 매출 사이에서 막힌 구간을 찾고 실제 운영 가능한 시스템으로 연결합니다.",
  path: "/",
  absoluteTitle: true,
  localized: true
});

const failureModes = [
  ["잘못된 근거에서 시작", "대표의 경험만으로 시작하면 고객이 멈추는 실제 이유를 놓칩니다."],
  ["현상과 원인을 혼동", "화면만 고치면 같은 문제가 다른 단계에서 다시 나타납니다."],
  ["확장할 수 없는 구조", "운영 데이터가 없으면 성장할 때 처음부터 다시 만들어야 합니다."]
] as const;

const systemSteps = [
  ["현황 구조 점검", "문의, 예약, 결제와 수작업 구간을 한 흐름으로 정리합니다."],
  ["비즈니스 흐름 설계", "실제 운영 방식을 기준으로 화면과 자동화 범위를 정합니다."],
  ["웹서비스 구현", "핵심 기능과 문의, 결제, 외부 도구를 연결합니다."],
  ["운영 데이터 점검", "유입, 문의, 전환과 이탈 지점을 확인합니다."],
  ["개선과 확장", "데이터와 피드백을 바탕으로 필요한 기능만 더합니다."]
] as const;

const homePageJsonLd = webPageJsonLd({
  name: "GROWTHLINE | 막힌 매출 흐름을 다시 연결합니다",
  description: "유입과 문의, 매출 사이에서 막힌 구간을 찾고 실제 운영 가능한 시스템으로 연결합니다.",
  path: "/"
});

export default function Home() {
  return (
    <main className="studio-home">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(homePageJsonLd) }} />
      <section className="studio-home__hero">
        <div className="studio-home__hero-copy">
          <p className="studio-kicker">온라인 사업 구조 설계</p>
          <h1>매출이 막힌 곳을 찾아,<br /><em>움직이는 시스템으로</em> 바꿉니다.</h1>
          <p className="studio-home__hero-lead">유입부터 문의와 운영까지, 끊어진 한 구간을 찾아 실제로 돌아가는 흐름으로 고칩니다.</p>
          <div className="studio-actions">
            <Link className="studio-button" href="/contact">내 사업 병목 진단 받기</Link>
            <Link className="studio-text-link" href="/work">프로젝트 보기 →</Link>
          </div>
        </div>
        <RevenueDiagnosticVisual />
      </section>

      <section className="studio-proof" aria-label="대표 성과">
        <div className="studio-proof__intro">
          <h2>예쁜 화면보다,<br />실제로 움직인 숫자.</h2>
          <p>같은 문제를 반복하지 않도록 원인과 결과를 함께 봅니다.</p>
        </div>
        <dl className="studio-proof__numbers">
          <div><dt>문의 자동 처리</dt><dd>2.4배<small>LG 챗봇 리뉴얼</small></dd></div>
          <div><dt>핵심 페이지 이탈률</dt><dd>38% 감소<small>르노코리아 홈페이지</small></dd></div>
          <div><dt>설문 응답 효율</dt><dd>3배<small>K2 설문 플랫폼</small></dd></div>
        </dl>
      </section>

      <section className="studio-cases">
        <div className="studio-section-heading">
          <h2>문제는 달라도,<br />찾아야 할 지점은 같습니다.</h2>
          <p>고객이 멈추는 순간과 운영이 반복되는 구간을 실제 사례로 확인하세요.</p>
        </div>
        <PerformanceStories />
      </section>

      <section className="studio-problem">
        <ConversionPathVisual />
        <div>
          <h2>온라인 전환이 막힐 때,<br />대부분 확인보다 추측이 앞섭니다.</h2>
          <div className="studio-problem__list">
            {failureModes.map(([title, body]) => (
              <article key={title}><h3>{title}</h3><p>{body}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="studio-system">
        <div className="studio-system__heading">
          <p className="studio-kicker">하나의 운영 흐름</p>
          <h2>만들고 끝내지 않습니다.<br />운영과 개선까지 연결합니다.</h2>
          <Link className="studio-text-link" href="/service">서비스 전체 보기 →</Link>
        </div>
        <div className="studio-system__steps">
          {systemSteps.map(([title, body], index) => (
            <article key={title}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <div><h3>{title}</h3><p>{body}</p></div>
            </article>
          ))}
        </div>
      </section>

      {/* 제품별 가격 정책 확정 전까지 가격 관련 섹션을 숨깁니다.
      <section className="studio-commercial">
        <div className="studio-commercial__statement">
          <h2>초기 비용은 낮추고,<br />성과는 함께 키웁니다.</h2>
          <p>큰 구축비를 먼저 받기보다 사업의 성장에 맞춰 함께 보상받는 방식을 지향합니다.</p>
        </div>
        <div className="studio-commercial__compare">
          <article>
            <span>일반 개발 계약</span>
            <strong>2,000만원 이상</strong>
            <p>높은 초기 구축비와 별도 유지보수 비용이 먼저 발생합니다.</p>
          </article>
          <article>
            <span>GROWTHLINE</span>
            <strong>500만원부터</strong>
            <p>핵심 기능으로 시작하고 성과 기반 운영과 확장으로 이어갑니다.</p>
          </article>
        </div>
      </section>

      <section className="studio-growth">
        <div>
          <h2>지금 필요한 만큼 시작하고,<br />성장할 때 확장합니다.</h2>
          <p>처음부터 크게 만들지 않습니다. 현재 단계에 필요한 범위와 다음 확장 조건을 함께 정합니다.</p>
        </div>
        <div className="studio-growth__paths">
          <article><strong>아이디어 검증</strong><span>500만원부터</span><p>핵심 기능, 실제 고객 반응 확인, 투자 설명을 위한 초기 버전</p></article>
          <article><strong>규모 확장과 자동화</strong><span>별도 협의</span><p>반복 업무 자동화, 거래량 확장, 사내 운영 체계 연결</p></article>
        </div>
      </section>
      */}

      <section className="studio-final-cta">
        <h2>어디가 막혔는지 알면,<br />무엇부터 바꿀지도 선명해집니다.</h2>
        <p>유입, 문의, 결제, 운영 가운데 가장 먼저 바꿔야 할 한 구간을 찾습니다.</p>
        <Link className="studio-button" href="/contact">내 사업 병목 진단 받기</Link>
      </section>
    </main>
  );
}
