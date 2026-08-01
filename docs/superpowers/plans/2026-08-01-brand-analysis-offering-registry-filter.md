# Brand Analysis Offering Registry Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent cross-batch fact-ID retry waste and preserve valid representative offerings and FAQs when a model emits one unregistered fact reference, without weakening structural or evidence validation.

**Architecture:** Canonicalize strictly validated owned-fact IDs at the server boundary so independent model calls cannot collide. Add one typed parser beside the owned-fact parser; it validates structure first, then either rejects registry mismatches by default or drops the complete invalid suggestion when the runner explicitly requests `drop-item`. The runner records trusted removal counts and passes only filtered data downstream.

**Tech Stack:** TypeScript, Node.js ESM runner, Vitest, existing worker integration harness

---

### Task 1: Add the strict offering-stage parser

**Files:**
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/stageContracts.ts`
- Test: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/stageContracts.test.ts`

- [ ] **Step 1: Write failing parser tests**

Add fixtures with one valid and one unregistered `sourceFactIds` value. Assert strict mode throws `brand_intelligence_offering_registry_mismatch`, while `drop-item` returns the valid sibling and these trusted counts:

```ts
expect(parsed.dropped).toEqual({ companyNameSuggestion: 1, offerings: 1, faqSuggestions: 1 });
expect(parsed.output.companyNameSuggestion).toBeNull();
expect(parsed.output.offerings).toEqual([validOffering]);
expect(parsed.output.faqSuggestions).toEqual([validFaq]);
```

Also assert malformed fields, unknown keys, excessive array lengths, empty ID arrays, and non-string IDs remain hard failures.

- [ ] **Step 2: Run the focused test and observe failure**

Run:

```powershell
npm --workspace workers/brand-pilot-brand-intelligence-worker test -- --run src/stageContracts.test.ts
```

Expected: failure because `parseOfferingSuggestions` is not exported.

- [ ] **Step 3: Implement structure-first parsing**

Export the normalized types and parser with this interface:

```ts
export function parseOfferingSuggestions(
  value: unknown,
  factIds: ReadonlySet<string>,
  options: { registryMismatch?: "reject" | "drop-item" } = {},
): {
  output: OfferingSuggestions;
  dropped: { companyNameSuggestion: number; offerings: number; faqSuggestions: number };
}
```

Use `strictObject` and `text` for every retained scalar. Validate every `sourceFactIds` as a non-empty bounded string array before registry checks. On a mismatch, call `fail("brand_intelligence_offering_registry_mismatch")` unless `drop-item` is selected; in `drop-item` mode remove the whole company-name suggestion, offering, or FAQ.

- [ ] **Step 4: Run the focused parser tests**

Run the Task 1 command again. Expected: all `stageContracts.test.ts` tests pass.

- [ ] **Step 5: Commit the parser and tests**

```powershell
git add -- brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/stageContracts.ts brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/stageContracts.test.ts
git commit -m "fix: filter ungrounded offering suggestions"
```

### Task 2: Integrate the parser into the runner

**Files:**
- Modify: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs`
- Test: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/runnerRetry.test.ts`
- Test: `brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts`

- [ ] **Step 1: Write a failing runner regression test**

Make all four owned-fact fake responses reuse the same model ID, then make the offering stage return valid siblings plus invalid company, offering, and FAQ references. Assert the runner creates unique canonical IDs, uses no duplicate-ID retry, still makes all eight logical stage calls, removes invalid items, preserves valid siblings, and adds only a trusted count message to `sourceGaps`.

```ts
expect(output.result.offerings).toEqual([validOffering]);
expect(output.result.faqSuggestions).toEqual([validFaq]);
expect(output.result.sourceGaps).toContain(
  "근거 ID가 일치하지 않은 회사명 1건, 상품·서비스 1건, FAQ 1건을 제외함",
);
expect(progress.filter((event) => event.physicalAttempt === 2)).toEqual([]);
expect(new Set(output.registry.ownedFactIds).size).toBe(output.registry.ownedFactIds.length);
```

- [ ] **Step 2: Run the focused runner tests and observe failure**

Run:

```powershell
npm --workspace workers/brand-pilot-brand-intelligence-worker test -- --run src/runnerRetry.test.ts src/worker.test.ts
```

Expected: the runner throws `brand_intelligence_offering_registry_mismatch`.

- [ ] **Step 3: Canonicalize fact IDs, use the parser, and add the trusted gap**

After a fact batch validates, replace each accepted model ID before registration:

```js
const canonicalFacts = parsedFactBatch.output.map((fact, ordinal) => ({
  ...fact,
  id: `owned-${batchIndex + 1}-${ordinal + 1}`,
}));
```

Then import `parseOfferingSuggestions`, parse with `{ registryMismatch: "drop-item" }`, and derive the three runner values from `parsed.output`. Add one server-authored source gap only when the total dropped count is positive:

```js
const parsedOfferings = parseOfferingSuggestions(response, factIds, {
  registryMismatch: "drop-item",
});
const offeringSourceGaps = totalDropped === 0 ? [] : [
  `근거 ID가 일치하지 않은 회사명 ${companyDropped}건, 상품·서비스 ${offeringDropped}건, FAQ ${faqDropped}건을 제외함`,
];
```

Merge `offeringSourceGaps` with existing server-owned gaps before final validation. Do not send unfiltered values to core, external research, final audit, or output.

- [ ] **Step 4: Run focused and full worker tests**

Run:

```powershell
npm --workspace workers/brand-pilot-brand-intelligence-worker test -- --run src/stageContracts.test.ts src/runnerRetry.test.ts src/worker.test.ts
npm --workspace workers/brand-pilot-brand-intelligence-worker test -- --run
```

Expected: both commands pass.

- [ ] **Step 5: Commit runner integration**

```powershell
git add -- brand_poilot/workers/brand-pilot-brand-intelligence-worker/scripts/run-codex-brand-intelligence.mjs brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/runnerRetry.test.ts brand_poilot/workers/brand-pilot-brand-intelligence-worker/src/worker.test.ts
git commit -m "fix: keep grounded offering siblings"
```

### Task 3: Review, publish, and verify production

**Files:**
- Verify only; no unrelated application files

- [ ] **Step 1: Run repository verification**

Run the worker suite, repository contract suite, build/type checks used by CI, and `git diff --check`. Expected: all pass and only the planned worker/docs files differ from `origin/main`.

- [ ] **Step 2: Run independent correctness and security reviews**

Confirm structure failures remain strict, no fact ID is guessed, dropped values never reach downstream prompts/results/evidence, external evidence is unchanged, and zero-supported-fact scrubbing remains intact.

- [ ] **Step 3: Push and merge a focused PR**

Push `codex/brand-analysis-offering-registry-filter`, open a PR against the latest `main`, wait for official CI and image publication, then merge only after required checks succeed.

- [ ] **Step 4: Deploy only the official worker image**

Use the existing targeted release workflow and deployment lock. Verify no analysis is running, deploy only `brand-intelligence-worker`, preserve global `current`/`previous` pointers, and compare all other container snapshot rows byte-for-byte.

- [ ] **Step 5: Retry the official UI exactly once**

Verify one visible enabled `다시 분석` button, click it once, monitor metadata through `review_ready`, confirm the editable review UI, and do not confirm or save the analysis.
