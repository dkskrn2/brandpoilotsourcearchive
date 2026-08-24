# Visual session final-message diagnostics implementation plan

1. Add failing contract tests for JSON, contract, and scene/index diagnostics.
2. Add one parser entry point for the raw final message and preserve strict validation.
3. Use that entry point only for shared visual sessions in the Codex runner script.
4. Run targeted image-worker and API tests, typechecks, builds, and diff checks.
5. Reconcile with remote `main` and the actual production release before merge.
6. Deploy only API and image worker with immutable digests and retained rollback targets.
7. Re-run the same content input as a new production generation and inspect its DB/log timeline.
