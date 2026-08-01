# Brand intelligence Codex output-schema hotfix

## Problem

The production brand-intelligence worker passes one permissive schema to every Codex stage:

```json
{"type":"object","additionalProperties":true}
```

Codex Structured Outputs requires object schemas to use `additionalProperties: false`. The eight stages return different object shapes, so one permissive schema is both invalid for Codex and unable to describe the actual contracts. Codex rejects the request with HTTP 400 before model execution. The runner then reports only the empty stderr suffix, hiding the JSON error emitted on stdout.

## Chosen approach

Remove `--output-schema` and the generated schema file from the Codex invocation. Keep `--output-last-message`, the stage-specific JSON instructions, `extractJson`, and the existing stage contract validators. This restores the original boundary: Codex produces JSON, the application parses it, and each consumer validates the exact stage contract.

On a non-zero Codex exit, extract a bounded diagnostic from stderr or stdout so production records identify schema, authentication, quota, and other CLI failures without logging prompts or secrets.

## Alternatives rejected

- Eight strict per-stage schemas would provide stronger generation constraints but are too broad for this production hotfix and would duplicate the existing TypeScript contracts.
- A strict envelope containing stringified JSON would satisfy Structured Outputs but adds double encoding and a new failure mode without improving validation.

## Safety and validation

- Add a regression test proving the runner no longer passes `--output-schema` and no longer generates the invalid permissive schema.
- Add a regression assertion that non-zero exits can include bounded stdout diagnostics.
- Run the focused worker tests, the full brand-intelligence worker suite, and the package build.
- Publish the worker image, redeploy only the brand-intelligence worker, verify its image revision and restart count, then run a minimal real Codex JSON invocation without `--output-schema`.
- Do not claim end-to-end analysis success unless a real queued/retried analysis advances beyond `owned_facts_1`.
