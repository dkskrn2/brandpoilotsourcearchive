# Brand analysis offering registry filter

## Context

The production run reached `representative_offerings` after all owned-fact batches completed. Two cross-batch owned-fact duplicate-ID retries had already consumed the global retry budget, so one `brand_intelligence_offering_registry_mismatch` rejected the entire run. Each of the four independent model calls creates IDs without seeing prior-batch IDs, which makes global model-generated uniqueness unreliable even when every fact is otherwise valid.

The offering stage currently treats one invalid `sourceFactIds` reference in a company-name suggestion, offering, or FAQ as a stage-wide failure. This is stricter than the approved owned-fact policy, which discards an ungrounded atomic item while preserving verified siblings.

## Options

1. Increase the global retry budget. This hides stochastic output but adds cost and still permits one bad item to discard valid siblings.
2. Fuzzy-match or rewrite fact IDs. This can attach content to the wrong evidence and is unsafe.
3. Drop only the complete suggestion whose fact registry reference is invalid, while retaining strict structural validation. This is selected.

## Design

Add a typed offering-stage parser in `stageContracts.ts`. It first validates the full response structure, limits, scalar fields, and `sourceFactIds` shape. Structural failures remain hard errors. It then checks IDs against the server-owned supported-fact registry.

After each owned-fact response passes strict source, quote, and within-envelope duplicate validation, the runner replaces model-generated IDs with deterministic server-owned IDs based on batch and accepted ordinal. Model IDs remain untrusted parsing inputs, while downstream linkage uses collision-free IDs. Failed attempts and dropped facts never reserve an ID.

By default, a registry mismatch remains a hard error for compatibility. The runner opts into `drop-item`: an invalid company-name suggestion becomes `null`, and each invalid offering or FAQ is removed as a whole. IDs are never guessed, rewritten, or partially removed from an otherwise retained item.

The parser returns counts for dropped company-name, offering, and FAQ suggestions. The runner adds a trusted, content-free source-gap message when any item is removed. Only filtered values reach the core, external-research candidate, final audit, output, and evidence validation.

## Safety invariants

- Only `supported` owned facts can enter the allowed fact registry.
- Cross-batch model ID collisions cannot spend retry budget or affect downstream linkage.
- Invalid references never reach the result, registry, evidence, or downstream prompts.
- Malformed envelopes, fields, limits, or ID arrays still fail closed and can use the existing retry path.
- Valid company-name, offering, and FAQ siblings are preserved unchanged.
- External competitors, market context, and evidence behavior is unchanged.
- The deployment remains worker-only and must preserve all other production containers and global release pointers.

## Verification

- Unit tests cover strict default behavior, drop-item behavior, mixed valid/invalid siblings, malformed structure, and empty registries.
- Runner integration covers repeated model IDs across batches and an offering response with one invalid reference. It verifies eight logical calls with no duplicate-ID retry, completion, absence of the invalid item, and the trusted source gap.
- Existing worker tests, repository contract tests, CI, production image identity, and a one-click official UI retry must pass before completion.
