import Image from "next/image";

type ExplainerImageProps = {
  alt: string;
  caption?: string;
  className?: string;
  priority?: boolean;
  src: string;
};

function ExplainerImage({ alt, caption, className = "", priority = false, src }: ExplainerImageProps) {
  return (
    <figure className={`explainer-image ${className}`.trim()}>
      <Image
        src={src}
        alt={alt}
        width={1536}
        height={1024}
        priority={priority}
        loading={priority ? undefined : "eager"}
        sizes="(max-width: 700px) calc(100vw - 32px), (max-width: 1000px) calc(100vw - 48px), 52vw"
      />
      {caption ? <figcaption>{caption}</figcaption> : null}
    </figure>
  );
}

export function RevenueDiagnosticVisual() {
  return (
    <ExplainerImage
      className="studio-home__hero-media"
      src="/images/generated/revenue-diagnostic-v2.png"
      alt="유입, 탐색, 문의, 운영의 네 단계 가운데 문의 병목을 찾아 개선 항목으로 연결하는 사업 흐름 진단 인포그래픽"
      caption="어디가 막혔는지 먼저 보여주고, 바꿀 순서를 정합니다."
      priority
    />
  );
}

export function ConversionPathVisual() {
  return (
    <ExplainerImage
      src="/images/generated/conversion-path-v2.png"
      alt="방문 후 이탈하는 기존 경로와 핵심 정보, CTA, 문의까지 연결되는 개선 경로를 비교한 전환 설계 인포그래픽"
      caption="화면 한 장이 아니라 고객의 다음 행동까지 설계합니다."
    />
  );
}

export function ServiceArchitectureVisual() {
  return (
    <ExplainerImage
      src="/images/generated/service-architecture-v2.png"
      alt="고객 근거와 데이터가 설계 기준으로 정리되고 글쓰기, 구축, 운영으로 이어지는 서비스 구조 인포그래픽"
      caption="서비스를 따로 고르는 대신 문제 해결 순서에 맞춰 조합합니다."
      priority
    />
  );
}

export function DecisionRulesVisual() {
  return (
    <ExplainerImage
      src="/images/generated/decision-rules-v2.png"
      alt="고객 행동, 고객의 말, 운영 조건이 중앙의 판단 기준을 거쳐 정보 구조, 전환 흐름, 운영 규칙으로 변환되는 인포그래픽"
      caption="고객 근거와 운영 조건을 같은 설계 안에서 정리합니다."
    />
  );
}

export function ContentOperationVisual() {
  return (
    <ExplainerImage
      className="content-flow-image"
      src="/images/generated/content-operations-v2.png"
      alt="소스 수집, 초안 제작, 사람의 승인, 게시, 성과 확인을 거쳐 다시 다음 발행으로 돌아오는 콘텐츠 운영 루프 인포그래픽"
    />
  );
}
