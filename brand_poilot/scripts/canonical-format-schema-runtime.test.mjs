import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const formats = Object.freeze([
  {
    format: "card-news",
    worker: "brand-pilot-card-news-worker",
    runner: "run-codex-card-manuscript-plan.mjs",
    schema: "card-manuscript-plan-v1.schema.json",
  },
  {
    format: "blog",
    worker: "brand-pilot-blog-worker",
    runner: "run-codex-blog-v2-plan.mjs",
    schema: "blog-plan-draft-v1.schema.json",
  },
  {
    format: "reel",
    worker: "brand-pilot-reel-worker",
    runner: "run-codex-reel-plan.mjs",
    schema: "reel-storyboard-v1.schema.json",
  },
]);

test("every format planner executes the canonical generated schema", async () => {
  for (const entry of formats) {
    const [runner, dockerfile] = await Promise.all([
      readFile(`workers/${entry.worker}/scripts/${entry.runner}`, "utf8"),
      readFile(`workers/${entry.worker}/Dockerfile`, "utf8"),
    ]);
    assert.match(runner, new RegExp(entry.schema.replaceAll(".", "\\.")));
    assert.match(dockerfile, new RegExp(entry.schema.replaceAll(".", "\\.")));
  }
});

test("canonical format schemas satisfy the provider structured-output subset", async () => {
  for (const entry of formats) {
    const schemaPath = `workers/${entry.worker}/scripts/${entry.schema}`;
    const schema = JSON.parse(await readFile(schemaPath, "utf8"));
    const serialized = JSON.stringify(schema);
    assert.doesNotMatch(serialized, /"oneOf"|"uniqueItems"/);
    const untypedConstPaths = [];
    const visit = (value, path = "$") => {
      if (Array.isArray(value)) {
        value.forEach((child, index) => visit(child, `${path}[${index}]`));
        return;
      }
      if (!value || typeof value !== "object") return;
      if (Object.hasOwn(value, "const") && !Object.hasOwn(value, "type")) {
        untypedConstPaths.push(path);
      }
      for (const [key, child] of Object.entries(value)) visit(child, `${path}.${key}`);
    };
    visit(schema);
    assert.deepEqual(untypedConstPaths, [], `${entry.format} has untyped const entries`);
  }
});
