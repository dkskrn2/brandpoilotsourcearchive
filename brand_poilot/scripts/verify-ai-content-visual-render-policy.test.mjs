import assert from "node:assert/strict";
import test from "node:test";

import { validateVisualRenderPolicyRelease } from "./verify-ai-content-visual-render-policy.mjs";

const h1 = "1".repeat(64);
const h2 = "2".repeat(64);

test("accepts only a new version/hash entry appended after the immutable release prefix", () => {
  assert.doesNotThrow(() => validateVisualRenderPolicyRelease({
    previousEntries: [{ version: "visual-render-policy.d2pp.v1", sha256: h1 }],
    currentEntries: [
      { version: "visual-render-policy.d2pp.v1", sha256: h1 },
      { version: "visual-render-policy.d2pp.v2", sha256: h2 },
    ],
    currentPolicyVersion: "visual-render-policy.d2pp.v2",
    currentPolicySha256: h2,
  }));
});

test("rejects editing an existing version/hash entry", () => {
  assert.throws(() => validateVisualRenderPolicyRelease({
    previousEntries: [{ version: "visual-render-policy.d2pp.v1", sha256: h1 }],
    currentEntries: [{ version: "visual-render-policy.d2pp.v1", sha256: h2 }],
    currentPolicyVersion: "visual-render-policy.d2pp.v1",
    currentPolicySha256: h2,
  }), /visual_render_policy_release_history_mutated/);
});

test("rejects deleting or reordering an existing release entry", () => {
  assert.throws(() => validateVisualRenderPolicyRelease({
    previousEntries: [
      { version: "visual-render-policy.d2pp.v1", sha256: h1 },
      { version: "visual-render-policy.d2pp.v2", sha256: h2 },
    ],
    currentEntries: [{ version: "visual-render-policy.d2pp.v2", sha256: h2 }],
    currentPolicyVersion: "visual-render-policy.d2pp.v2",
    currentPolicySha256: h2,
  }), /visual_render_policy_release_history_mutated/);
});

test("rejects policy content changes without a new registered version/hash", () => {
  assert.throws(() => validateVisualRenderPolicyRelease({
    previousEntries: [{ version: "visual-render-policy.d2pp.v1", sha256: h1 }],
    currentEntries: [{ version: "visual-render-policy.d2pp.v1", sha256: h1 }],
    currentPolicyVersion: "visual-render-policy.d2pp.v1",
    currentPolicySha256: h2,
  }), /visual_render_policy_current_hash_unregistered/);
});
