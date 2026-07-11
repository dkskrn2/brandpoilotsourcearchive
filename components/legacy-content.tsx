import "server-only";

import fs from "node:fs";
import path from "node:path";
import { LegacyInteractiveContent } from "@/components/legacy-interactive-content";

const hrefMap: Record<string, string> = {
  "index.html": "/",
  "service.html": "/service",
  "work.html": "/work",
  "contact.html": "/contact",
  "detail.html": "/detail",
  "brand-pilot-privacy.html": "/brand-pilot-privacy",
  "brand-pilot-terms.html": "/brand-pilot-terms",
  "brand-pilot-data-deletion.html": "/brand-pilot-data-deletion",
  "service/brandpilot.html": "/service/brandpilot",
  "service/service-research.html": "/service/service-research",
  "service/service-analytics.html": "/service/service-analytics",
  "service/service-design.html": "/service/service-design",
  "service/service-consulting.html": "/service/service-consulting",
  "service/service-writing.html": "/service/service-writing",
  "service/service-startup.html": "/service/service-startup"
};

type ServiceVisual = {
  image: string;
  alt: string;
  label: string;
  title: string;
  description: string;
  steps: string[];
  reverse?: boolean;
};

const serviceVisuals: Record<string, ServiceVisual> = {
  "service/service-research.html": {
    image: "/images/generated/ux-research-journey.webp",
    alt: "고객 행동과 인터뷰 기록이 하나의 고객 여정으로 연결되는 리서치 시각화",
    label: "RESEARCH LENS",
    title: "행동을 보고, 이유를 묻고, 멈춘 지점을 연결합니다.",
    description: "한 가지 조사 방법에 기대지 않고 관찰과 질문, 여정 분석을 이어 붙여 이탈의 맥락을 확인합니다.",
    steps: ["행동 관찰", "이유 확인", "여정 연결"]
  },
  "service/service-analytics.html": {
    image: "/images/generated/data-decision-system.webp",
    alt: "여러 데이터 흐름이 하나의 의사결정 지점으로 모이는 분석 시각화",
    label: "DECISION SYSTEM",
    title: "데이터를 더 모으기보다, 결정에 필요한 흐름부터 정리합니다.",
    description: "흩어진 지표를 비교 가능한 기준으로 묶고 다음 행동을 고를 수 있는 정보로 바꿉니다.",
    steps: ["수집", "비교", "결정"],
    reverse: true
  },
  "service/service-design.html": {
    image: "/images/generated/conversion-blueprint.webp",
    alt: "복잡한 선택지가 하나의 명확한 행동 경로로 정리되는 전환 설계 시각화",
    label: "CONVERSION PATH",
    title: "복잡한 화면을 한 번에 이해되는 결정 경로로 바꿉니다.",
    description: "정보의 양을 늘리는 대신 고객이 무엇을 보고 판단하고 행동할지 순서를 설계합니다.",
    steps: ["정보", "판단", "행동"]
  },
  "service/service-consulting.html": {
    image: "/images/generated/conversion-blueprint.webp",
    alt: "복잡한 업무 규칙이 일관된 운영 경로로 정리되는 비즈니스 로직 시각화",
    label: "OPERATING LOGIC",
    title: "사람마다 다르게 처리하던 일을 하나의 운영 기준으로 맞춥니다.",
    description: "업무 흐름과 예외 조건, 완료 기준을 먼저 정리해 기능이 늘어도 운영이 흔들리지 않게 합니다.",
    steps: ["업무 흐름", "판단 규칙", "운영 기준"],
    reverse: true
  },
  "service/service-writing.html": {
    image: "/images/generated/content-operations-loop.webp",
    alt: "아이디어가 문장과 이미지, 검토와 발행을 거쳐 개선되는 콘텐츠 제작 흐름",
    label: "MESSAGE FLOW",
    title: "고객의 망설임을 근거와 다음 행동이 있는 문장으로 바꿉니다.",
    description: "설명을 늘리기보다 결정을 늦추는 질문에 먼저 답하고, 버튼을 누른 뒤의 일까지 분명히 씁니다.",
    steps: ["망설임", "근거", "다음 행동"]
  },
  "service/service-startup.html": {
    image: "/images/generated/content-operations-loop.webp",
    alt: "아이디어가 MVP 출시와 측정, 다음 개선으로 순환하는 제품 운영 흐름",
    label: "LAUNCH LOOP",
    title: "첫 버전은 완성품이 아니라 다음 판단을 만드는 도구입니다.",
    description: "가설을 검증할 범위만 출시하고 실제 사용 데이터를 모아 다음 기능의 우선순위를 정합니다.",
    steps: ["가설", "MVP 출시", "학습"],
    reverse: true
  },
  "service/brandpilot.html": {
    image: "/images/generated/content-operations-loop.webp",
    alt: "소스 아이디어가 초안과 이미지, 검토와 게시를 거쳐 다시 개선되는 콘텐츠 운영 흐름",
    label: "CONTENT LOOP",
    title: "한 번의 아이디어를 검토 가능한 발행 흐름으로 연결합니다.",
    description: "브랜드 맥락을 기준으로 소스를 모으고 초안과 이미지를 만든 뒤, 사람이 확인하고 게시합니다.",
    steps: ["소스", "초안", "검토", "게시"]
  }
};

function makeServiceVisual(visual: ServiceVisual) {
  const steps = visual.steps.map((step, index) => `<li><span>${String(index + 1).padStart(2, "0")}</span>${step}</li>`).join("");
  return `<figure class="service-editorial-visual${visual.reverse ? " service-editorial-visual--reverse" : ""}">
    <div class="service-editorial-visual__image"><img src="${visual.image}" alt="${visual.alt}" width="1600" height="1024" loading="eager" decoding="async"></div>
    <figcaption>
      <span class="service-editorial-visual__label">${visual.label}</span>
      <strong>${visual.title}</strong>
      <p>${visual.description}</p>
      <ol>${steps}</ol>
    </figcaption>
  </figure>`;
}

function makeServiceIndexVisuals() {
  const visuals = [
    ["/images/generated/ux-research-journey.webp", "고객 이해", "행동과 목소리를 연결합니다."],
    ["/images/generated/data-decision-system.webp", "데이터 판단", "숫자를 다음 결정으로 바꿉니다."],
    ["/images/generated/conversion-blueprint.webp", "전환 설계", "복잡한 선택을 한 경로로 정리합니다."],
    ["/images/generated/content-operations-loop.webp", "운영 확장", "출시와 발행을 반복 가능한 흐름으로 만듭니다."]
  ];
  return `<section class="service-visual-index" aria-label="서비스가 해결하는 네 가지 흐름"><div class="inner"><div class="service-visual-index__grid">${visuals.map(([image, title, description]) => `<figure><img src="${image}" alt="" width="1600" height="1024" loading="lazy" decoding="async"><figcaption><strong>${title}</strong><span>${description}</span></figcaption></figure>`).join("")}</div></div></section>`;
}

function extractPageContent(source: string, preferBody = false) {
  const main = preferBody ? undefined : source.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1];
  if (main) return main;

  const body = source.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? source;
  return body
    .replace(/<header\b[\s\S]*?<\/header>/i, "")
    .replace(/<footer\b[\s\S]*?<\/footer>/i, "");
}

function sanitizeTrustedMarkup(source: string, preferBody = false) {
  let html = extractPageContent(source, preferBody)
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, "")
    .replace(/\s(?:on\w+|style)=("[^"]*"|'[^']*')/gi, "")
    .replace(/<i\b[^>]*><\/i>/gi, "")
    .replace(/href=("|')#\1/gi, 'href="/contact"')
    .replace(/src=("|')source\/img\//gi, 'src=$1/images/legacy/');

  Object.entries(hrefMap)
    .sort(([a], [b]) => b.length - a.length)
    .forEach(([from, to]) => {
      html = html.replaceAll(`href="${from}`, `href="${to}`).replaceAll(`href='${from}`, `href='${to}`);
    });

  return html;
}

export function getLegacyHtml(fileName: string) {
  const safePath = path.normalize(fileName).replace(/^(\.\.(\\|\/|$))+/, "");
  const absolutePath = path.join(/* turbopackIgnore: true */ process.cwd(), safePath);
  const source = fs.readFileSync(absolutePath, "utf8");
  let html = sanitizeTrustedMarkup(source, fileName === "service.html" || fileName.startsWith("service/"));

  if (fileName === "service.html") {
    html = html.replace(/<\/section>/i, `</section>${makeServiceIndexVisuals()}`);
  }

  const visual = serviceVisuals[fileName];
  if (visual) {
    html = html.replace(/<\/section>/i, `</section>${makeServiceVisual(visual)}`);
  }

  if (fileName === "brand-pilot-privacy.html") {
    html = html.replace(/<table>/g, '<div class="legal-table-scroll" role="region" tabindex="0" aria-label="표를 좌우로 스크롤할 수 있습니다"><table>')
      .replace(/<\/table>/g, "</table></div>");
  }

  return html;
}

export function LegacyContent({ fileName, pageType }: { fileName: string; pageType?: string }) {
  return <LegacyInteractiveContent html={getLegacyHtml(fileName)} pageType={pageType} />;
}
