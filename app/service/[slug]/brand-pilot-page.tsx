import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  BookOpenText,
  CheckCircle,
  InstagramLogo,
  LinkSimple,
  NotePencil,
  ShieldCheck,
  UsersThree
} from "@phosphor-icons/react/dist/ssr";
import { serializeJsonLd } from "@/lib/seo";

const workflow = [
  {
    icon: LinkSimple,
    title: "근거를 등록합니다",
    body: "자사 웹사이트, 참고 URL, 문서와 노트를 콘텐츠 소스로 모읍니다."
  },
  {
    icon: NotePencil,
    title: "브랜드 초안을 만듭니다",
    body: "고객, 서비스, 말투와 금지 표현을 반영해 처음부터 기준에 맞춰 작성합니다."
  },
  {
    icon: CheckCircle,
    title: "사람이 검토합니다",
    body: "게시 전에 담당자가 문구와 카드뉴스를 확인하고 승인 상태를 남깁니다."
  },
  {
    icon: InstagramLogo,
    title: "게시까지 연결합니다",
    body: "승인된 콘텐츠만 현재 지원 채널인 Instagram 게시 흐름으로 보냅니다."
  }
] as const;

const changes = [
  {
    problem: "글감이 메신저와 문서에 흩어집니다.",
    solution: "근거 자료를 소스로 모읍니다.",
    body: "무엇을 참고했는지 콘텐츠마다 남겨 다음 담당자도 같은 출발점에서 시작합니다."
  },
  {
    problem: "담당자가 바뀔 때마다 말투가 달라집니다.",
    solution: "브랜드 컨텍스트를 먼저 적용합니다.",
    body: "브랜드 설명, 고객, 서비스, 어조와 금지 표현을 초안의 공통 기준으로 사용합니다."
  },
  {
    problem: "검토와 게시가 서로 다른 도구에서 끊깁니다.",
    solution: "승인 상태와 게시 결과를 연결합니다.",
    body: "사람의 판단을 건너뛰지 않으면서 반복되는 전달과 확인 작업을 줄입니다."
  }
] as const;

const comparison = [
  ["자료", "북마크와 파일을 담당자가 따로 보관", "URL, 문서, 노트를 콘텐츠 소스로 관리"],
  ["초안", "매번 빈 화면에서 새로 작성", "브랜드 기준과 근거를 반영해 초안 구성"],
  ["검토", "메신저 피드백과 파일 버전이 분산", "검토 상태와 승인 결과를 한 흐름에 기록"],
  ["게시", "문구와 이미지를 다시 옮겨 수동 게시", "승인된 결과만 Instagram 게시로 연결"]
] as const;

const faqs = [
  {
    question: "어떤 자료를 콘텐츠 소스로 등록할 수 있나요?",
    answer: "자사 웹사이트 URL, 시장과 고객을 이해하기 위한 참고 URL, 내부 문서와 노트, 발행 주제를 등록할 수 있습니다. 각 자료는 사실 근거와 콘텐츠 관점으로 구분해 관리합니다."
  },
  {
    question: "참고 URL의 문장을 그대로 사용하나요?",
    answer: "아닙니다. 참고 자료는 시장 맥락과 관점을 찾기 위한 입력입니다. 문장이나 표현을 복제하지 않고, 등록된 브랜드 기준에 맞는 새로운 초안으로 구성합니다."
  },
  {
    question: "게시 전에 담당자가 직접 확인할 수 있나요?",
    answer: "네. 검토 승인 흐름을 사용하면 콘텐츠와 카드뉴스 결과를 확인한 뒤 게시할 수 있습니다. 자동 승인은 운영 정책이 정해진 콘텐츠에만 선택적으로 적용합니다."
  },
  {
    question: "카드뉴스 이미지는 몇 장까지 만들 수 있나요?",
    answer: "내용 흐름에 필요한 수량을 판단해 생성하며, 현재 Instagram 카드뉴스는 최대 5장으로 구성합니다."
  },
  {
    question: "어떤 게시 채널을 지원하나요?",
    answer: "현재 제품 페이지에서 안내하는 게시 자동화 범위는 Instagram입니다. 다른 채널은 형식과 운영 정책이 달라 별도 범위로 검토합니다."
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

export function BrandPilotPage() {
  return (
    <main className="brand-pilot-product">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonLd(faqJsonLd) }} />

      <section className="bp-hero">
        <div className="bp-shell bp-hero__grid">
          <div className="bp-hero__copy">
            <p className="bp-kicker">BRAND PILOT</p>
            <h1>브랜드 기준으로,<br />계속 발행하세요.</h1>
            <p className="bp-lead">자료 수집부터 초안, 카드뉴스, 검수, Instagram 게시까지 한 흐름으로 관리합니다.</p>
            <div className="bp-actions">
              <Link className="button" href="/contact">도입 상담하기</Link>
              <a className="bp-text-link" href="#workflow">제품 흐름 보기 <ArrowRight aria-hidden size={18} /></a>
            </div>
          </div>

          <figure className="bp-hero__visual">
            <Image
              src="/images/product/brand-pilot-workflow-v1.webp"
              alt="자료 수집, 초안 작성, 검토 승인, Instagram 게시를 한 화면에서 관리하는 Brand Pilot 제품 화면"
              width={1536}
              height={1024}
              priority
              sizes="(max-width: 980px) calc(100vw - 40px), 52vw"
            />
          </figure>
        </div>
      </section>

      <section className="bp-scope" aria-label="Brand Pilot 지원 범위">
        <div className="bp-shell bp-scope__inner">
          <strong>한 화면에서 연결되는 범위</strong>
          <ul>
            <li>웹사이트</li>
            <li>참고 URL</li>
            <li>문서와 노트</li>
            <li>콘텐츠 초안</li>
            <li>카드뉴스 1-5장</li>
            <li>Instagram 게시</li>
          </ul>
        </div>
      </section>

      <section className="bp-section bp-changes">
        <div className="bp-shell bp-changes__grid">
          <header className="bp-section__head">
            <h2>많이 만드는 것보다,<br />기준이 끊기지 않는 것이 먼저입니다.</h2>
            <p>Brand Pilot은 콘텐츠 한 편을 대신 쓰는 도구가 아니라, 다음 콘텐츠도 같은 기준으로 이어지게 만드는 운영 제품입니다.</p>
          </header>
          <div className="bp-changes__list">
            {changes.map((item) => (
              <article key={item.problem}>
                <span>{item.problem}</span>
                <h3>{item.solution}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bp-section bp-workflow-section" id="workflow">
        <div className="bp-shell">
          <header className="bp-section__head">
            <p className="bp-kicker">PRODUCT FLOW</p>
            <h2>근거에서 게시까지,<br />네 번의 판단으로 연결합니다.</h2>
            <p>초안을 빠르게 만드는 것보다 무엇을 근거로 썼고 누가 승인했는지 남기는 흐름에 집중했습니다.</p>
          </header>
          <ol className="bp-workflow">
            {workflow.map(({ icon: Icon, title, body }) => (
              <li key={title}>
                <Icon aria-hidden size={28} weight="duotone" />
                <h3>{title}</h3>
                <p>{body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="bp-section bp-evidence">
        <div className="bp-shell bp-evidence__grid">
          <figure className="bp-evidence__visual">
            <Image
              src="/images/generated/content-operations-loop.webp"
              alt="자료와 초안, 검토와 게시가 순환하는 콘텐츠 운영 과정"
              width={1536}
              height={1024}
              sizes="(max-width: 980px) calc(100vw - 40px), 54vw"
            />
          </figure>
          <div className="bp-evidence__copy">
            <h2>브랜드의 말이 되려면,<br />근거가 남아야 합니다.</h2>
            <p>모든 입력을 같은 방식으로 취급하지 않습니다. 자료의 역할을 나누고, 근거 없는 주장이 초안에 섞이지 않도록 운영합니다.</p>
            <dl>
              <div><dt>자사 자료</dt><dd>제품, 서비스, 가격과 같이 틀리면 안 되는 사실</dd></div>
              <div><dt>참고 자료</dt><dd>시장 흐름과 고객 관점을 이해하기 위한 맥락</dd></div>
              <div><dt>브랜드 기준</dt><dd>누구에게 어떤 목소리로 말할지 정하는 규칙</dd></div>
            </dl>
          </div>
        </div>
      </section>

      <section className="bp-section bp-principles">
        <div className="bp-shell">
          <header className="bp-section__head">
            <h2>자동화보다 먼저 지키는<br />세 가지 운영 원칙</h2>
          </header>
          <div className="bp-principles__list">
            <article>
              <BookOpenText aria-hidden size={30} weight="duotone" />
              <div><h3>사실은 지키고 표현은 새롭게</h3><p>참고 자료의 문장을 옮기지 않고, 확인 가능한 근거 안에서 브랜드의 관점으로 다시 씁니다.</p></div>
            </article>
            <article>
              <UsersThree aria-hidden size={30} weight="duotone" />
              <div><h3>사람의 승인을 기본으로</h3><p>자동화가 최종 판단을 대신하지 않습니다. 게시 전 검토가 필요한 콘텐츠는 담당자의 승인을 기다립니다.</p></div>
            </article>
            <article>
              <ShieldCheck aria-hidden size={30} weight="duotone" />
              <div><h3>지원 범위를 분명하게</h3><p>현재 게시 자동화는 Instagram 중심입니다. 채널이 달라지면 형식과 운영 정책도 별도로 설계합니다.</p></div>
            </article>
          </div>
        </div>
      </section>

      <section className="bp-section bp-comparison">
        <div className="bp-shell">
          <header className="bp-section__head">
            <h2>도구를 하나 더 늘리는 대신,<br />끊어진 운영을 하나로 묶습니다.</h2>
          </header>
          <div className="bp-comparison__table-wrap">
            <table>
              <thead><tr><th scope="col">운영 항목</th><th scope="col">지금의 방식</th><th scope="col">Brand Pilot</th></tr></thead>
              <tbody>
                {comparison.map(([label, before, after]) => <tr key={label}><th scope="row">{label}</th><td>{before}</td><td>{after}</td></tr>)}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="bp-section bp-teams">
        <div className="bp-shell">
          <header className="bp-section__head">
            <h2>이런 팀이 먼저<br />효과를 확인할 수 있습니다.</h2>
          </header>
          <div className="bp-teams__grid">
            <article><span>정기 발행이 필요한 팀</span><h3>콘텐츠는 계속 필요하지만 전담 편집자가 없는 팀</h3><p>글감을 찾고 초안을 만들고 확인받는 과정이 반복될수록 운영 기준의 효과가 커집니다.</p></article>
            <article><span>말투 일관성이 필요한 팀</span><h3>작성자가 바뀌어도 브랜드의 목소리를 지켜야 하는 팀</h3><p>여러 담당자와 외부 파트너가 함께 작성할 때 같은 근거와 기준에서 시작할 수 있습니다.</p></article>
          </div>
        </div>
      </section>

      <section className="bp-section bp-faq">
        <div className="bp-shell bp-faq__grid">
          <header className="bp-section__head"><h2>자주 묻는 질문</h2><p>도입 전에 가장 많이 확인하는 자료, 검토와 게시 범위를 정리했습니다.</p></header>
          <div className="bp-faq__list">
            {faqs.map((faq) => <details key={faq.question}><summary>{faq.question}</summary><p>{faq.answer}</p></details>)}
          </div>
        </div>
      </section>

      <section className="bp-closing">
        <div className="bp-shell">
          <h2>다음 게시물부터,<br />같은 기준으로 운영하세요.</h2>
          <p>현재 자료와 승인 방식을 확인하고 Brand Pilot에 맞는 시작 범위를 함께 정리합니다.</p>
          <Link className="button" href="/contact">도입 상담하기</Link>
        </div>
      </section>
    </main>
  );
}
