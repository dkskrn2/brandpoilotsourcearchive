# Editorial Architecture and Structural Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the approved Vogue ON narrative architecture and bounded structural-label policy to informational and marketing Card News and Reel generation.

**Architecture:** Keep `card-manuscript-plan.v1`, `reel-storyboard.v2`, and `ai-content-visual-session.v1` unchanged. Add content-type-neutral internal planning rules to both existing planner prompts, retain their purpose-specific fact boundaries, and advance the shared render policy append-only from d2pp.v3 to d2pp.v4.

**Tech Stack:** TypeScript, Node.js ESM, Vitest, canonical SHA-256 render-policy release manifest.

---

### Task 1: Card News narrative architecture

**Files:**
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-card-news-worker/src/promptBuilder.ts`

- [ ] **Step 1: Write failing prompt-contract tests**

Add assertions to the existing informational/marketing purpose test and editorial-clustering test:

```ts
expect(prompt).toContain("콘텐츠 전체의 중심 결과를 먼저 결정");
expect(prompt).toContain("핵심 설명이 빠지면 논리가 건너뛰는 bridge Evidence");
expect(prompt).toContain("Scene 1은 hook 또는 cover 기능");
expect(prompt).toContain("Scene 2부터는 바로 앞 Scene과의 의미 관계");
expect(prompt).toContain("설명되지 않은 주제 전환은 허용하지 마세요");
expect(prompt).toContain("headline을 전환 문장으로 소비하지 마세요");
expect(prompt).toContain("Delete test");
expect(prompt).toContain("Missing-link test");
expect(prompt).toContain("Headline-only test");
expect(prompt).toContain("Adjacent-scene test");
```

Keep the existing `it.each(["informational", "marketing"])` test so both purpose paths prove that these common rules are present.

- [ ] **Step 2: Run the targeted test and confirm RED**

Run:

```bash
npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts
```

Expected: FAIL because the new narrative and adjacent-scene strings do not exist.

- [ ] **Step 3: Add the minimal Card News planner rules**

Advance `cardNewsPlanSkillVersion` to `card-manuscript-plan-skill.v5`. In `buildCardNewsPlanPrompt`, add rules that require this internal sequence without changing output JSON:

```ts
"원고 작성을 시작하기 전에 전체 Subject, Evidence Pool과 Proposal Lens를 검토하고 콘텐츠 전체의 중심 결과를 먼저 결정하세요.",
"중심 결과에 도달하기 위해 사용자가 갖게 될 왜·어떻게·그래서 질문과 반드시 필요한 설명을 내부적으로 확인하세요. 모든 콘텐츠에 고정 서사 순서를 강제하지 마세요.",
"단순히 연결하기 쉬운 Evidence보다 핵심 주장에 필요한 Evidence를 우선하고, 핵심 설명이 빠지면 논리가 건너뛰는 bridge Evidence를 보존하세요.",
"Scene 1은 hook 또는 cover 기능으로 중심 긴장·질문·변화·약속·주장 중 적절한 하나를 세우세요.",
"Scene 2부터는 바로 앞 Scene과의 의미 관계를 내부적으로 결정하고, 연결과 동시에 새로운 Editorial Point를 추가하세요.",
"관점이나 하위 주제를 전환할 수 있지만 앞 Scene 또는 중심 결과와 왜 연결되는지가 표시 문구에서 이해되어야 합니다. 설명되지 않은 주제 전환은 허용하지 마세요.",
"장면 연결을 위해 headline을 전환 문장으로 소비하지 마세요. headline은 현재 Scene의 새로운 주장·사실·질문·변화를 전달하고 연결은 정보 순서와 필요할 때 supportingTexts로 표현하세요.",
"Delete test: 현재 Scene을 삭제해도 이해·설득력·긴장이 거의 같으면 재그룹하거나 교체하세요.",
"Missing-link test: 왜·어떻게·그래서 질문이 적절한 후속 Scene에서 해소되지 않으면 누락되거나 잘못 배치된 Evidence를 다시 검토하세요.",
"Headline-only test: headline만 순서대로 읽어도 각 Scene의 새 정보와 중심 결과까지의 전진이 보여야 합니다.",
"Adjacent-scene test: Scene 2부터 앞 Scene과 붙여 읽고 연결 이유가 이해되지 않으면 순서나 표시 문구를 고치되 headline을 접속문으로 약화하지 마세요.",
```

Do not change `purposeRules`, Evidence partition validation instructions, schema, or scene count.

- [ ] **Step 4: Run Card News tests and confirm GREEN**

Run:

```bash
npm test --workspace @brand-pilot/card-news-worker -- --run src/promptBuilder.test.ts src/manuscriptPlan.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Card News planner changes**

```bash
git add workers/brand-pilot-card-news-worker/src/promptBuilder.ts workers/brand-pilot-card-news-worker/src/promptBuilder.test.ts
git commit -m "feat(card-news): strengthen narrative architecture"
```

### Task 2: Reel narrative architecture

**Files:**
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.test.ts`
- Modify: `workers/brand-pilot-reel-worker/src/promptBuilder.ts`

- [ ] **Step 1: Write failing Reel prompt-contract tests**

Add the same narrative assertions used in Task 1 to a test that runs for both `informational` and `marketing` Reel inputs. Keep existing marketing product-fact and Evidence-boundary assertions.

```ts
it.each(["informational", "marketing"] as const)("adds narrative architecture to %s Reel planning", (purpose) => {
  const prompt = buildReelPlanPrompt(promptInput(purpose), frozenManualVisualSelection);
  expect(prompt).toContain("Scene 1은 hook 또는 cover 기능");
  expect(prompt).toContain("Scene 2부터는 바로 앞 Scene과의 의미 관계");
  expect(prompt).toContain("설명되지 않은 주제 전환은 허용하지 마세요");
  expect(prompt).toContain("bridge Evidence");
  expect(prompt).toContain("Delete test");
  expect(prompt).toContain("Missing-link test");
  expect(prompt).toContain("Headline-only test");
  expect(prompt).toContain("Adjacent-scene test");
});
```

- [ ] **Step 2: Run the targeted test and confirm RED**

```bash
npm test --workspace @brand-pilot/reel-worker -- --run src/promptBuilder.test.ts
```

Expected: FAIL for the missing rules.

- [ ] **Step 3: Add the minimal Reel planner rules**

Advance `reelPlanSkillVersion` to `reel-storyboard-skill.v6`. Add the same internal central-outcome, bridge-Evidence, Scene 1 hook/cover, Scene 2+ adjacent relationship, explained-transition, information-bearing headline, and four self-check rules from Task 1.

Keep existing Reel informational and marketing `purposeRules` intact. Do not add a relationship enum, output field, model call, or fixed `why → how → so what` scene template.

- [ ] **Step 4: Run Reel tests and confirm GREEN**

```bash
npm test --workspace @brand-pilot/reel-worker -- --run src/promptBuilder.test.ts src/contracts.test.ts src/productionRuntime.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Reel planner changes**

```bash
git add workers/brand-pilot-reel-worker/src/promptBuilder.ts workers/brand-pilot-reel-worker/src/promptBuilder.test.ts
git commit -m "feat(reel): strengthen narrative architecture"
```

### Task 3: Shared social-card identity and structural labels

**Files:**
- Modify: `workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.test.ts`
- Modify: `workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.mjs`
- Modify: `workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.releases.json`
- Modify: `workers/brand-pilot-image-worker/src/skillContract.test.ts`
- Modify: `workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md`

- [ ] **Step 1: Write failing shared render-policy tests**

Extend `aiContentVisualSessionPromptCompiler.test.ts`:

```ts
expect(prompt).toContain("one page in a cohesive social editorial card series");
expect(prompt).toContain("not an isolated cinematic poster, magazine cover, or presentation slide");
expect(prompt).toContain("short structural or classification labels");
expect(prompt).toContain("Step 1");
expect(prompt).toContain("new facts, claims, numbers, dates, conditions, sources, or quotations");
expect(prompt).toContain("page numbers, slide counters, pagination badges, or progress markers");
```

Update `skillContract.test.ts` to expect `visual-render-policy.d2pp.v4` and the bounded structural-label wording.

- [ ] **Step 2: Run image prompt tests and confirm RED**

```bash
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentVisualSessionPromptCompiler.test.ts src/skillContract.test.ts
```

Expected: FAIL because v3 still forbids every extra label and lacks the social-card identity.

- [ ] **Step 3: Implement d2pp.v4 policy**

Advance `AI_CONTENT_VISUAL_RENDER_POLICY_VERSION` to `visual-render-policy.d2pp.v4`. Replace the two blanket extra-text prohibitions with bounded rules:

```js
"Treat every output as one page in a cohesive social editorial card series, not an isolated cinematic poster, magazine cover, or presentation slide. Use clear modular hierarchy while keeping the chosen primary medium consistent.",
"You may add short structural or classification labels such as Step 1, 핵심, 사례, 포인트, or relation-valid Before/After only to organize locked content without adding substantive meaning.",
"Structural labels must not introduce new facts, claims, numbers, dates, conditions, sources, quotations, causal interpretations, product promises, or recommendations.",
"Do not add invented CTA copy, button labels, page numbers, slide counters, pagination badges, progress markers, invented brands or product names, decorative slogans, speech bubbles, pseudo-UI copy, or long explanatory text.",
```

Keep the existing one-medium, typography consistency, relation semantics, native canvas, exact call-count, and no-retry rules.

- [ ] **Step 4: Update the image-render skill and append release manifest entry**

Change the skill's canonical version to v4 and describe the same bounded structural-label allowance. Compute the exact policy SHA after editing:

```bash
node --input-type=module -e "import('./workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.mjs').then((m) => console.log(m.AI_CONTENT_VISUAL_RENDER_POLICY_SHA256))"
```

Append a new manifest entry with `version` exactly `visual-render-policy.d2pp.v4` and `sha256` exactly equal to that command's 64-character output. Do not alter the v1-v3 entries.

- [ ] **Step 5: Run policy and image tests and confirm GREEN**

```bash
npm test --workspace @brand-pilot/image-worker -- --run src/aiContentVisualSessionPromptCompiler.test.ts src/skillContract.test.ts
node scripts/verify-ai-content-visual-render-policy.mjs --base 29e0aea8b8d6754d7be84b5e64a9ac1415bbc431
```

Expected: tests PASS and verifier prints `visual_render_policy_release_ok:visual-render-policy.d2pp.v4:<sha256>`.

- [ ] **Step 6: Commit shared render changes**

```bash
git add workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.mjs workers/brand-pilot-image-worker/src/aiContentVisualRenderPolicy.releases.json workers/brand-pilot-image-worker/src/aiContentVisualSessionPromptCompiler.test.ts workers/brand-pilot-image-worker/src/skillContract.test.ts workers/brand-pilot-image-worker/.codex/skills/image-render/SKILL.md
git commit -m "feat(image): allow bounded structural labels"
```

### Task 4: Cross-format verification and one-off quality checkpoint

**Files:**
- Verify only: Card News, Reel, Image Worker, root policy scripts
- Reuse locally: the frozen Vogue one-off fixture and comparison tooling outside production runtime

- [ ] **Step 1: Run all affected worker tests**

```bash
npm test --workspace @brand-pilot/card-news-worker
npm test --workspace @brand-pilot/reel-worker
npm test --workspace @brand-pilot/image-worker
```

Expected: PASS.

- [ ] **Step 2: Run builds and immutable-policy verification**

```bash
npm run build --workspace @brand-pilot/card-news-worker
npm run build --workspace @brand-pilot/reel-worker
npm run build --workspace @brand-pilot/image-worker
node scripts/verify-ai-content-visual-render-policy.mjs --base 29e0aea8b8d6754d7be84b5e64a9ac1415bbc431
git diff --check
```

Expected: all builds and checks PASS.

- [ ] **Step 3: Verify the four purpose/format combinations**

Confirm prompt tests cover:

```text
Card News informational
Card News marketing
Reel informational
Reel marketing
```

Expected: shared narrative rules appear in all four, while existing purpose-specific factual and CTA restrictions remain.

- [ ] **Step 4: Repeat the approved Vogue one-off quality check**

Use the frozen Vogue Subject, Proposal Lens, five Evidence items, and five scenes. Run planner and shared image session outside production DB, API, queue, and usage accounting. Confirm:

```text
Scene 1 establishes the hook/central claim.
Scene 2 restores the social-media scarcity bridge.
Later scenes progress through examples, scale, and practical principle.
Headlines add information instead of acting only as transitions.
Structural labels may appear, but no new factual copy, CTA, source, or page counter appears.
```

- [ ] **Step 5: Stop for user review**

Show the manuscript and image comparison. Do not merge, push, or deploy until the user approves the implementation result.
