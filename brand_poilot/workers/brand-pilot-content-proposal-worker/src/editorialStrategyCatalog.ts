export const EXPRESSION_METHODS = [
  ["comparison_decision", "선택 기준·차이·트레이드오프를 비교해 판단을 돕는다"],
  ["problem_solution", "독자의 구체적인 문제를 밝히고 실행 가능한 해결로 전개한다"],
  ["data_interpretation", "핵심 수치·변화량·전후 차이의 의미를 해석한다"],
  ["step_tutorial", "목표 달성에 필요한 순서와 행동을 단계적으로 보여 준다"],
  ["checklist", "점검·선택·실행 항목을 빠짐없이 확인하게 한다"],
  ["myth_fact", "흔한 오해와 확인된 사실을 대조해 판단을 교정한다"],
  ["before_after", "상태·방법·결과의 변화를 전후 흐름으로 보여 준다"],
  ["case_situation", "구체적인 상황이나 사례에서 일반화 가능한 판단을 끌어낸다"],
  ["question_answer", "독자의 실제 질문을 중심으로 필요한 답과 근거를 전개한다"],
] as const;

export const EMPHASIS_ANGLES = [
  ["practicality", "바로 적용할 수 있는 실용성"],
  ["empathy", "독자가 자기 상황으로 느끼는 공감"],
  ["humor", "사실을 해치지 않는 관찰형 유머"],
  ["trust", "근거·조건·한계가 보이는 신뢰"],
  ["efficiency", "시간·과정·노력을 줄이는 효율"],
  ["economy", "비용·가치·낭비 방지 관점"],
  ["differentiation", "대안과 구분되는 핵심 차이"],
  ["risk_avoidance", "실수·오해·손실을 피하는 판단"],
  ["discovery", "몰랐던 변화나 의미를 발견하는 관점"],
] as const;

export function editorialStrategyPromptRules(): string[] {
  return [
    `표현방식 후보: ${EXPRESSION_METHODS.map(([id, description]) => `${id}=${description}`).join("; ")}.`,
    `강조 관점 후보: ${EMPHASIS_ANGLES.map(([id, description]) => `${id}=${description}`).join("; ")}.`,
    "각 안을 쓰기 전에 주제·목적·대상·Evidence에 맞는 표현방식 하나와 강조 관점 하나를 내부적으로 선택하되 새 필드로 출력하지 마라.",
    "적합한 후보가 없으면 자유 구성하라. 세 안이 같은 표현방식이나 강조 관점을 사용해도 된다.",
    "같은 조합을 쓸 때도 시작 질문, 중심 Evidence, 핵심 메시지, 전개 순서와 마지막 판단이 같은 내용의 재표현이 되지 않게 하라.",
  ];
}
