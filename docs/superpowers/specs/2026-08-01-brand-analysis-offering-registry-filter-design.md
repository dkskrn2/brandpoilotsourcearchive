# Brand analysis offering registry filter

## Context

The production run reached `representative_offerings` after all owned-fact batches completed. Two owned-fact duplicate-ID retries had already consumed the global retry budget, so one `brand_intelligence_offering_registry_mismatch` rejected the entire run.

The offering stage currently treats one invalid `sourceFactIds` reference in a company-name suggestion, offering, or FAQ as a stage-wide failure. This is stricter than the approved owned-fact policy, which discards an ungrounded atomic item while preserving verified siblings.

## Options

1. Increase the global retry budget. This hides stochastic output but adds cost and still permits one bad item to discard valid siblings.
2. Fuzzy-match or rewrite fact IDs. This can attach content to the wrong evidence and is unsafe.
3. Drop only the complete suggestion whose fact registry reference is invalid, while retaining strict structural validation. This is selected.

## Design

Add a typed offering-stage parser in `stageContracts.ts`. It first validates the full response structure, limits, scalar fields, and `sourceFactIds` shape. Structural failures remain hard errors. It then checks IDs against the server-owned supported-fact registry.

By default, a registry mismatch remains a hard error for compatibility. The runner opts into `drop-item`: an invalid company-name suggestion becomes `null`, and each invalid offering or FAQ is removed as a whole. IDs are never guessed, rewritten, or partially removed from an otherwise retained item.

The parser returns counts for dropped company-name, offering, and FAQ suggestions. The runner adds a trusted, content-free source-gap message when any item is removed. Only filtered values reach the core, external-research candidate, final audit, output, and evidence validation.

## Safety invariants

- Only `supported` owned facts can enter the allowed fact registry.
- Invalid references never reach the result, registry, evidence, or downstream prompts.
- Malformed envelopes, fields, limits, or ID arrays still fail closed and can use the existing retry path.
- Valid company-name, offering, and FAQ siblings are preserved unchanged.
- External competitors, market context, and evidence behavior is unchanged.
- The deployment remains worker-only and must preserve all other production containers and global release pointers.

## Verification

- Unit tests cover strict default behavior, drop-item behavior, mixed valid/invalid siblings, malformed structure, and empty registries.
- Runner integration covers an offering response with one invalid reference and no retry budget, verifies completion, verifies the invalid item is absent, and checks the trusted source gap.
- Existing worker tests, repository contract tests, CI, production image identity, and a one-click official UI retry must pass before completion.
