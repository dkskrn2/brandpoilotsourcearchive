import Image from "next/image";
import Link from "next/link";

const workflow = [
  {
    number: "01",
    label: "SOURCE",
    shortTitle: "소스와 주제",
    shortBody: "발행할 근거를 모읍니다.",
    title: "말할 근거를 모읍니다",
    body: "자사 URL, 참고 URL, 주제표에서 발행 후보를 관리합니다."
  },
  {
    number: "02",
    label: "DRAFT",
    shortTitle: "브랜드 맥락 초안",
    shortBody: "톤과 고객을 반영합니다.",
    title: "브랜드의 관점으로 씁니다",
    body: "브랜드명, 업종, 고객, 서비스 설명, 톤을 바탕으로 초안을 구성합니다."
  },
  {
    number: "03",
    label: "VISUAL",
    shortTitle: "카드뉴스 이미지",
    shortBody: "내용 흐름에 맞춰 만듭니다.",
    title: "읽히는 이미지로 옮깁니다",
    body: "내용에 맞는 수량을 판단해 최대 5장의 카드뉴스 이미지를 생성합니다."
  },
  {
    number: "04",
    label: "PUBLISH",
    shortTitle: "검토와 게시",
    shortBody: "Instagram 발행을 관리합니다.",
    title: "검토하고 게시합니다",
    body: "검토 승인 또는 자동 승인 정책에 따라 Instagram 게시까지 연결합니다."
  }
] as const;

const faqs = [
  {
    question: "어떤 자료를 소스로 등록할 수 있나요?",
    answer: "브랜드의 자사 URL, 시장과 고객을 이해하기 위한 참고 URL, 그리고 내부에서 관리하는 주제표를 사용할 수 있습니다. 각 자료의 역할은 사실 근거와 콘텐츠 관점으로 구분해 관리합니다."
  },
  {
    question: "참고 URL의 문장을 그대로 사용하나요?",
    answer: "아닙니다. 참고 자료는 맥락과 관점을 찾기 위한 자료입니다. 문장이나 표현을 그대로 복제하지 않고, 브랜드 맥락에 맞는 인사이트로 재구성합니다."
  },
  {
    question: "게시 전에 항상 사람이 확인할 수 있나요?",
    answer: "가능합니다. 검토 승인 흐름을 사용하면 콘텐츠와 채널별 결과를 확인한 뒤 게시할 수 있습니다. 자동 승인은 운영 정책이 정해진 콘텐츠에만 적용하는 방식입니다."
  },
  {
    question: "이미지는 항상 5장으로 생성되나요?",
    answer: "아닙니다. 내용 흐름에 필요한 수량을 판단해 생성하며, Instagram 카드뉴스는 최대 5장으로 제한합니다."
  }
] as const;

export function BrandPilotPage() {
  return (
    <main className="brand-pilot-page">
      <section className="bp-hero">
        <div className="bp-shell bp-hero__grid">
          <div className="bp-hero__copy">
            <p className="bp-kicker">BRAND PILOT</p>
            <h1>콘텐츠가 자꾸 멈춘다면,<br /><em>글감보다 운영 기준이 먼저입니다.</em></h1>
            <p className="bp-lead">Brand Pilot은 무엇을 왜 말할지 정리하고, 초안·카드뉴스 이미지·Instagram 게시까지 한 흐름으로 관리합니다. 담당자가 바뀌어도 브랜드의 말투와 근거가 남습니다.</p>
            <div className="bp-actions">
              <Link className="button" href="/contact">Brand Pilot 상담하기</Link>
              <a className="bp-text-link" href="#workflow">운영 흐름 보기 <span aria-hidden>↓</span></a>
            </div>
          </div>

          <aside className="bp-hero__system" aria-label="Brand Pilot 운영 흐름 요약">
            <div className="bp-system__head">
              <span>CONTENT OPERATIONS</span>
              <i aria-hidden />
            </div>
            <strong>무엇을 쓸지 찾는 일부터<br />게시까지 한곳에서 봅니다.</strong>
            <ol>
              {workflow.map((item) => (
                <li key={item.number}>
                  <span>{item.number}</span>
                  <div><b>{item.shortTitle}</b><small>{item.shortBody}</small></div>
                </li>
              ))}
            </ol>
          </aside>
        </div>
      </section>

      <section className="bp-loop" aria-labelledby="bp-loop-title">
        <div className="bp-shell bp-loop__frame">
          <div className="bp-loop__image">
            <Image src="/images/generated/content-operations-loop.webp" alt="소스 수집부터 초안, 이미지 제작, 검토와 게시까지 이어지는 콘텐츠 운영 흐름" width={1536} height={1024} priority sizes="(max-width: 760px) calc(100vw - 32px), 65vw" />
          </div>
          <div className="bp-loop__copy">
            <p>CONTENT LOOP</p>
            <h2 id="bp-loop-title">한 번의 아이디어를 검토 가능한 발행 흐름으로 연결합니다.</h2>
            <span>브랜드 맥락을 기준으로 소스를 모으고 초안과 이미지를 만든 뒤, 사람이 확인하고 게시합니다.</span>
            <ul aria-label="콘텐츠 운영 단계">
              {workflow.map((item) => <li key={item.number}><b>{item.number}</b>{item.shortTitle}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="bp-section" id="workflow">
        <div className="bp-shell">
          <div className="bp-section__head">
            <p className="bp-kicker">HOW IT WORKS</p>
            <h2>글감을 찾는 일부터<br />검토와 게시까지 연결합니다.</h2>
            <p>외부 자료를 그대로 옮겨 적지 않습니다. 브랜드 프로필과 등록한 소스를 바탕으로 고객에게 필요한 관점을 찾고, 발행할 수 있는 형태로 정리합니다.</p>
          </div>
          <div className="bp-workflow">
            {workflow.map((item) => (
              <article key={item.number}>
                <div><span>{item.number}</span><small>{item.label}</small></div>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="bp-context">
        <div className="bp-shell bp-context__grid">
          <div className="bp-context__intro">
            <p className="bp-kicker bp-kicker--dark">BRAND CONTEXT</p>
            <h2>브랜드 밖의 말이 아니라,<br />우리 브랜드가 할 말을 찾습니다.</h2>
            <p>콘텐츠 수를 늘리는 것보다 먼저, 무엇을 근거로 어떤 목소리로 말할지 고정합니다.</p>
          </div>
          <ul className="bp-context__rules">
            <li><span>01</span><p>브랜드의 업종, 고객, 서비스 설명, 목소리를 초안의 기준으로 사용합니다.</p></li>
            <li><span>02</span><p>자사 소스는 핵심 사실 근거로, 참고 소스는 시장 맥락과 콘텐츠 각도를 찾는 데 사용합니다.</p></li>
            <li><span>03</span><p>입력에 없는 숫자, 가격, 효능, 보장처럼 근거 없는 주장은 만들지 않습니다.</p></li>
          </ul>
        </div>
      </section>

      <section className="bp-section bp-principles">
        <div className="bp-shell bp-principles__grid">
          <article>
            <span>01</span>
            <h3>처음부터 빈 화면을 보지 않도록</h3>
            <p>담당자는 매번 글감을 새로 찾고 톤을 맞추는 일을 반복하지 않아도 됩니다. 발행 후보와 브랜드 기준을 먼저 쌓고, 그 안에서 콘텐츠 초안을 관리합니다.</p>
          </article>
          <article>
            <span>02</span>
            <h3>사람의 판단을 지우지 않도록</h3>
            <p>자동화는 게시의 반복을 줄이기 위한 수단입니다. 검토가 필요한 콘텐츠는 승인 후 발행하고, 운영 정책이 정해진 경우에만 자동 승인 흐름을 사용할 수 있습니다.</p>
          </article>
          <article>
            <span>03</span>
            <h3>현재는 Instagram 중심으로</h3>
            <p>카드뉴스 이미지 생성과 Instagram 게시 흐름을 중심으로 운영합니다. 채널별 형식과 게시 정책은 같은 콘텐츠라도 별도로 관리해야 합니다.</p>
          </article>
        </div>
      </section>

      <section className="bp-section bp-teams">
        <div className="bp-shell">
          <div className="bp-section__head">
            <p className="bp-kicker">FOR TEAMS</p>
            <h2>이런 팀에게 맞습니다.</h2>
          </div>
          <div className="bp-teams__grid">
            <article><span>기준이 필요한 팀</span><h3>콘텐츠를 계속해야 하지만 기준이 없는 팀</h3><p>무엇을 써야 할지보다, 어떤 기준으로 계속 발행할지가 더 어려운 팀을 위한 구조입니다.</p></article>
            <article><span>일관성이 필요한 팀</span><h3>브랜드 목소리가 매번 달라지는 팀</h3><p>작성자가 바뀌어도 브랜드의 고객, 서비스, 톤을 놓치지 않는 콘텐츠 운영 기준이 필요할 때 적합합니다.</p></article>
          </div>
        </div>
      </section>

      <section className="bp-section bp-faq">
        <div className="bp-shell bp-faq__grid">
          <div className="bp-section__head"><p className="bp-kicker">FAQ</p><h2>자주 묻는 질문</h2><p>도입 전에 가장 많이 확인하는 운영 범위를 정리했습니다.</p></div>
          <div className="bp-faq__list">
            {faqs.map((faq, index) => <details key={faq.question}><summary><span>{String(index + 1).padStart(2, "0")}</span>{faq.question}</summary><p>{faq.answer}</p></details>)}
          </div>
        </div>
      </section>

      <section className="bp-closing">
        <div className="bp-shell">
          <p>START WITH A STANDARD</p>
          <h2>더 많이 만들기 전에,<br />계속 만들 수 있는 기준부터 정해보세요.</h2>
          <span>현재 운영 방식에 Brand Pilot이 맞는지, 어떤 소스와 기준부터 쌓아야 하는지 함께 확인합니다.</span>
          <Link className="button" href="/contact">Brand Pilot 상담하기</Link>
        </div>
      </section>
    </main>
  );
}
