import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

const expectedCategories = [
  ["travel_tourism", "여행·관광"],
  ["hospitality_leisure", "숙박·레저"],
  ["food_dining", "식음료·외식"],
  ["shopping_commerce", "쇼핑·커머스"],
  ["beauty_fashion", "뷰티·패션"],
  ["health_fitness", "건강·운동"],
  ["education_learning", "교육·학습"],
  ["parenting_family", "육아·가족"],
  ["pets", "반려동물"],
  ["real_estate_home", "부동산·주거"],
  ["finance_insurance", "금융·보험"],
  ["it_software", "IT·소프트웨어"],
  ["business_professional", "비즈니스·전문 서비스"],
  ["culture_content", "문화·콘텐츠"],
  ["local_lifestyle", "지역·생활 서비스"],
];

const expectedTimes = Array.from({ length: 15 }, (_, index) => {
  const minutes = 4 * 60 + index * 5;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
});

test("GPT Scheduled task definitions cover the exact production category catalog", async () => {
  const tasks = JSON.parse(await readFile(
    "docs/operations/gpt-scheduled-content-suggestion-tasks.json",
    "utf8",
  ));

  assert.equal(tasks.contractVersion, "content-suggestion-scheduled-tasks.v1");
  assert.equal(tasks.tasks.length, 15);
  assert.deepEqual(
    tasks.tasks.map((task) => [task.categoryCode, task.categoryName]),
    expectedCategories,
  );
  assert.deepEqual(tasks.tasks.map((task) => task.schedule.time), expectedTimes);
  assert.equal(new Set(tasks.tasks.map((task) => task.categoryCode)).size, 15);
  assert.equal(new Set(tasks.tasks.map((task) => task.name)).size, 15);

  for (const task of tasks.tasks) {
    assert.equal(task.name, `Brand Pilot 오늘의 콘텐츠 - ${task.categoryName}`);
    assert.equal(task.schedule.frequency, "daily");
    assert.equal(task.schedule.timezone, "Asia/Seoul");
    assert.match(task.prompt, /get_content_suggestion_scope/);
    assert.match(task.prompt, /publish_content_suggestion_batch/);
    assert.match(task.prompt, new RegExp(task.categoryCode));
    assert.match(task.prompt, /정보성/);
    assert.match(task.prompt, /트렌드성/);
    assert.match(task.prompt, /각각 최대 2개/);
    assert.match(task.prompt, /해당 슬롯을 생략/);
    assert.match(task.prompt, /전체에서 유효한 제안이 0개/);
    assert.match(task.prompt, /status가 published/);
    assert.match(task.prompt, /batchId/);
    assert.doesNotMatch(task.prompt, /광고성/);
    assert.doesNotMatch(task.prompt, /누락 사유/);
    assert.doesNotMatch(task.prompt, /CONTENT_SUGGESTION_PLUGIN_TOKEN|Bearer\s+[A-Za-z0-9_-]+/);
  }
});
