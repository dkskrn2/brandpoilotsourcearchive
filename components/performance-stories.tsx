"use client";

import { useState } from "react";

const stories = [
  {
    company: "LG 챗봇 리뉴얼",
    problem: "문의는 많은데, 응대할 사람이 없었습니다.",
    result: "2.4배",
    resultLabel: "고객 문의 자동 처리율 개선",
    before: ["반복되는 단순 문의로 CS 인력 소모", "상담 품질 편차로 고객 불만 누적", "기존 챗봇의 실사용이 거의 없음"],
    after: ["반복 문의 자동 분기 처리", "사람이 개입할 문의만 선별", "실제 고객 언어를 반영한 시나리오"]
  },
  {
    company: "르노코리아 홈페이지 리뉴얼",
    problem: "방문자는 있는데, 왜 그냥 나가버릴까요?",
    result: "38% 감소",
    resultLabel: "핵심 페이지 이탈률",
    before: ["핵심 정보가 여러 페이지에 분산", "다음 행동이 보이지 않는 화면", "디자인과 전환 흐름의 단절"],
    after: ["방문 목적별 정보 구조 재설계", "다음 행동을 분명히 보여주는 콘텐츠", "핵심 정보 우선 배치"]
  },
  {
    company: "K2 설문조사 플랫폼 고도화",
    problem: "데이터는 쌓이는데, 결정은 계속 늦어졌습니다.",
    result: "3배",
    resultLabel: "설문 응답 효율 개선",
    before: ["낮은 설문 참여율", "결과 취합과 정리에 많은 시간 소요", "감각에 의존하는 의사결정"],
    after: ["중간 이탈을 줄이는 응답 흐름", "모바일 중심 참여 환경", "바로 판단할 수 있는 결과 구조"]
  }
] as const;

export function PerformanceStories() {
  const [active, setActive] = useState(0);
  const story = stories[active];

  return (
    <div className="studio-stories">
      <div className="studio-stories__tabs" role="tablist" aria-label="프로젝트 사례 선택">
        {stories.map((item, index) => (
          <button
            aria-selected={active === index}
            className={active === index ? "is-active" : ""}
            key={item.company}
            onClick={() => setActive(index)}
            role="tab"
            type="button"
          >
            <span>{item.company}</span>
            <strong>{item.problem}</strong>
          </button>
        ))}
      </div>
      <article className="studio-story" role="tabpanel" aria-live="polite">
        <div className="studio-story__top">
          <div><span>{story.company}</span><h3>{story.problem}</h3></div>
          <div><strong>{story.result}</strong><span>{story.resultLabel}</span></div>
        </div>
        <div className="studio-story__compare">
          <div><h4>바꾸기 전</h4>{story.before.map((item) => <p key={item}>{item}</p>)}</div>
          <div><h4>바꾼 뒤</h4>{story.after.map((item) => <p key={item}>{item}</p>)}</div>
        </div>
      </article>
    </div>
  );
}
