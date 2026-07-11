import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = {
  title: "TV Voice 활용 UX 리서치",
  description: "TV 환경에서 음성 인터랙션을 사용하는 고객 여정과 발화 및 피드백 정책을 살펴본 UX 리서치 사례입니다.",
  robots: { index: false }
};

const researchFrames = [
  {
    number: "01",
    title: "말을 거는 순간",
    body: "사용자가 어떤 상황에서 음성 기능을 선택하고, 첫 발화를 시작하기 전에 무엇을 기대하는지 살펴봅니다."
  },
  {
    number: "02",
    title: "시스템이 듣는 동안",
    body: "듣기 시작했는지, 어디까지 인식했는지, 기다려야 하는지를 화면과 소리로 어떻게 알려야 하는지 확인합니다."
  },
  {
    number: "03",
    title: "결과가 다를 때",
    body: "인식 실패나 예상과 다른 결과가 나왔을 때 사용자가 자연스럽게 다시 시도할 수 있는 회복 경로를 정리합니다."
  }
];

export default function DetailPage() {
  return (
    <main className="case-study">
      <section className="case-study__hero">
        <div className="case-study__hero-copy">
          <p className="case-study__eyebrow">CASE STUDY · UX RESEARCH</p>
          <h1>TV Voice 활용<br /><span>UX 리서치</span></h1>
          <p>TV 환경에서 음성 인터랙션을 사용하는 고객 여정과 니즈를 파악하고, 발화 및 피드백 정책을 설계한 사례를 소개합니다.</p>
          <Link className="case-study__back" href="/work">← 프로젝트 목록으로</Link>
        </div>
        <figure className="case-study__hero-image">
          <Image
            src="/images/generated/tv-voice-ux.webp"
            alt="거실에서 음성으로 TV와 상호작용하고 화면 피드백을 받는 장면"
            width={1600}
            height={1024}
            priority
            sizes="(max-width: 900px) 100vw, 52vw"
          />
        </figure>
      </section>

      <section className="case-study__summary">
        <div>
          <p className="case-study__eyebrow">RESEARCH QUESTION</p>
          <h2>화면을 보지 않아도<br />안심하고 말할 수 있으려면?</h2>
        </div>
        <p>음성 UX는 명령어를 잘 알아듣는 것만으로 끝나지 않습니다. 사용자는 시스템이 듣고 있는지, 요청을 이해했는지, 다음에 무엇을 해야 하는지 계속 확인해야 합니다. 이 사례는 그 확인의 순간을 하나의 여정으로 연결해 살펴봅니다.</p>
      </section>

      <section className="case-study__frames" aria-label="리서치 관점">
        {researchFrames.map((frame) => (
          <article key={frame.number}>
            <span>{frame.number}</span>
            <h2>{frame.title}</h2>
            <p>{frame.body}</p>
          </article>
        ))}
      </section>

      <section className="case-study__flow">
        <div className="case-study__flow-copy">
          <p className="case-study__eyebrow">VOICE FEEDBACK LOOP</p>
          <h2>발화부터 회복까지,<br />끊기지 않는 피드백 흐름</h2>
          <p>공개 가능한 범위에서 리서치의 핵심 관점을 정리했습니다. 실제 프로젝트에서는 사용 맥락과 발화 패턴, 오류 상황을 함께 비교해 정책의 우선순위를 정합니다.</p>
        </div>
        <ol className="case-study__flow-steps">
          <li><span>01</span><strong>호출</strong><small>음성 기능을 시작하는 계기</small></li>
          <li><span>02</span><strong>발화</strong><small>자연스럽게 요청하는 방식</small></li>
          <li><span>03</span><strong>응답</strong><small>듣기·처리·결과 피드백</small></li>
          <li><span>04</span><strong>회복</strong><small>실패 후 다시 시도하는 경로</small></li>
        </ol>
      </section>

      <section className="case-study__cta">
        <p className="case-study__eyebrow">YOUR NEXT QUESTION</p>
        <h2>고객이 어디서 망설이는지<br />함께 확인해보세요.</h2>
        <Link className="button" href="/contact">UX 리서치 상담하기</Link>
      </section>
    </main>
  );
}
