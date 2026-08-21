# Reel/Card contract sync implementation plan

1. Add failing contract tests for Reel v2 Evidence partition, factual-scene grounding, duplicate copy and Card-equivalent semantic relations.
2. Add failing Reel prompt/schema tests proving v2 output, complete Evidence partition and absence of planner design fields.
3. Implement Reel v2 and deterministic legacy-plan projection; keep v1 parsing read-only.
4. Wire Reel Worker completion, API validation/storage, render binding and visual-session projection to v2 for new work.
5. Regenerate the Reel output schema and update exact deployment/runtime assertions.
6. Run focused contract/worker/API/render tests, generated drift checks, builds/typechecks and release-impact verification.
7. Stop before merge or production deployment and report exact changed services and rollout requirements.
