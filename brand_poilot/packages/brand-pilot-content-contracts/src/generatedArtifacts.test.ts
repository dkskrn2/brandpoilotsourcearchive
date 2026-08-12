import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { compareUnicodeCodePoints } from "./catalog.js";
import {
  computeContractSourceHash,
  generateArtifactSet,
  generateArtifacts,
  stableJson,
} from "./generateArtifacts.js";

const SCHEMA_FILENAMES = [
  "ai-content-v3.schema.json",
  "blog-plan-v2.schema.json",
  "card-news-plan-v2.schema.json",
  "content-generation-input-v3.schema.json",
  "content-orchestration-v2.schema.json",
  "content-prompt-binding-v1.schema.json",
  "content-proposal-request-v2.schema.json",
  "content-proposal-v2.schema.json",
  "image-generation-package-v1.schema.json",
  "proposal-base-input-v2.schema.json",
  "proposal-input-v2.schema.json",
  "reel-plan-v2.schema.json",
  "research-evidence-v1.schema.json",
] as const;

function objectKeysAreSorted(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(objectKeysAreSorted);
  if (!value || typeof value !== "object") return true;
  const entries = Object.entries(value as Record<string, unknown>);
  const keys = entries.map(([key]) => key);
  const sorted = [...keys].sort(compareUnicodeCodePoints);
  return JSON.stringify(keys) === JSON.stringify(sorted)
    && entries.every(([, child]) => objectKeysAreSorted(child));
}

function schemaProblems(value: unknown): { oneOf: boolean; uniqueItems: boolean; untypedConst: boolean } {
  const serialized = JSON.stringify(value);
  let untypedConst = false;
  const visit = (item: unknown): void => {
    if (Array.isArray(item)) return void item.forEach(visit);
    if (!item || typeof item !== "object") return;
    const record = item as Record<string, unknown>;
    if (Object.hasOwn(record, "const") && !Object.hasOwn(record, "type")) untypedConst = true;
    Object.values(record).forEach(visit);
  };
  visit(value);
  return {
    oneOf: serialized.includes('"oneOf"'),
    uniqueItems: serialized.includes('"uniqueItems"'),
    untypedConst,
  };
}

describe("generated content contract artifacts", () => {
  it("keeps private transient contracts outside canonical source hashing and artifacts", async () => {
    const source = mkdtempSync(join(tmpdir(), "content-contract-private-source-"));
    const canonicalPath = join(source, "canonical.ts");
    const privateDraftPath = join(source, "plannerDrafts.ts");
    const privateStructuredScenePath = join(source, "structuredSceneCopy.ts");
    writeFileSync(canonicalPath, "export const canonical = 'v1';\n", "utf8");
    writeFileSync(privateDraftPath, "export const privateDraft = 'v1';\n", "utf8");
    writeFileSync(privateStructuredScenePath, "export const privateStructuredScene = 'v1';\n", "utf8");

    const originalHash = computeContractSourceHash(source);
    const originalArtifacts = await generateArtifactSet(source);

    writeFileSync(privateDraftPath, "export const privateDraft = 'v2';\n", "utf8");
    writeFileSync(privateStructuredScenePath, "export const privateStructuredScene = 'v2';\n", "utf8");
    expect(computeContractSourceHash(source)).toBe(originalHash);
    expect(await generateArtifactSet(source)).toEqual(originalArtifacts);

    writeFileSync(canonicalPath, "export const canonical = 'v2';\n", "utf8");
    expect(computeContractSourceHash(source)).not.toBe(originalHash);
    expect((await generateArtifactSet(source)).get("content-catalog.json"))
      .not.toBe(originalArtifacts.get("content-catalog.json"));
  });

  it("orders Unicode scalar values instead of UTF-16 code units", () => {
    expect(["\u{10000}", "\uE000"].sort(compareUnicodeCodePoints)).toEqual(["\uE000", "\u{10000}"]);
  });

  it("stableJson recursively sorts by code point and emits exactly one final LF", () => {
    expect(stableJson({ z: 1, a: { ä: 2, Z: 1 }, list: [{ b: 2, a: 1 }] }))
      .toBe('{\n  "a": {\n    "Z": 1,\n    "ä": 2\n  },\n  "list": [\n    {\n      "a": 1,\n      "b": 2\n    }\n  ],\n  "z": 1\n}\n');
  });

  it("produces byte-identical complete output in two temp directories", { timeout: 20_000 }, async () => {
    const left = mkdtempSync(join(tmpdir(), "content-contract-left-"));
    const right = mkdtempSync(join(tmpdir(), "content-contract-right-"));
    await generateArtifacts(left);
    await generateArtifacts(right);

    const expected = ["content-catalog.json", ...SCHEMA_FILENAMES].sort(compareUnicodeCodePoints);
    expect(readdirSync(left).sort(compareUnicodeCodePoints)).toEqual(expected);
    expect(readdirSync(right).sort(compareUnicodeCodePoints)).toEqual(expected);
    for (const filename of expected) {
      expect(readFileSync(join(left, filename))).toEqual(readFileSync(join(right, filename)));
    }
    const before = new Map(expected.map((filename) => [filename, readFileSync(join(left, filename))]));
    await generateArtifacts(left);
    for (const filename of expected) expect(readFileSync(join(left, filename))).toEqual(before.get(filename));
  });

  it("hashes only normalized authored source paths and bytes", () => {
    const sourceDirectory = dirname(fileURLToPath(import.meta.url));
    const files: string[] = [];
    const visit = (directory: string): void => {
      for (const name of readdirSync(directory)) {
        const absolute = join(directory, name);
        if (statSync(absolute).isDirectory()) visit(absolute);
        else if (name.endsWith(".ts") && !name.endsWith(".test.ts")
          && name !== "generateArtifacts.ts" && name !== "checkGenerated.ts"
          && name !== "plannerDrafts.ts" && name !== "structuredSceneCopy.ts") files.push(absolute);
      }
    };
    visit(sourceDirectory);
    files.sort((left, right) => compareUnicodeCodePoints(
      relative(sourceDirectory, left).replaceAll("\\", "/"),
      relative(sourceDirectory, right).replaceAll("\\", "/"),
    ));
    const hash = createHash("sha256");
    for (const absolute of files) {
      hash.update(relative(sourceDirectory, absolute).replaceAll("\\", "/"));
      hash.update("\0");
      hash.update(readFileSync(absolute, "utf8").replaceAll("\r\n", "\n").replaceAll("\r", "\n"));
      hash.update("\0");
    }
    expect(computeContractSourceHash(sourceDirectory)).toBe(hash.digest("hex"));
  });

  it("emits sorted provider-compatible schemas with exact catalog hashes", async () => {
    const output = mkdtempSync(join(tmpdir(), "content-contract-schema-"));
    await generateArtifacts(output);
    const catalog = JSON.parse(readFileSync(join(output, "content-catalog.json"), "utf8")) as Record<string, unknown>;

    for (const filename of SCHEMA_FILENAMES) {
      const bytes = readFileSync(join(output, filename));
      expect(bytes.toString("utf8").endsWith("\n")).toBe(true);
      expect(bytes.toString("utf8").endsWith("\n\n")).toBe(false);
      const schema = JSON.parse(bytes.toString("utf8"));
      expect(objectKeysAreSorted(schema)).toBe(true);
      expect(schemaProblems(schema)).toEqual({ oneOf: false, uniqueItems: false, untypedConst: false });
    }

    const leaves = Object.values(catalog.schemas as Record<string, unknown>);
      // Nested plan leaves are flattened below; the catalog itself is deliberately not hashed.
    const planLeaves = Object.values((catalog.schemas as Record<string, Record<string, unknown>>).plans);
    const schemaLeaves = [...leaves.filter((leaf) => "filename" in (leaf as object)), ...planLeaves] as Array<{ filename: string; sha256: string }>;
    expect(schemaLeaves.map(({ filename }) => filename).sort(compareUnicodeCodePoints)).toEqual([...SCHEMA_FILENAMES]);
    for (const leaf of schemaLeaves) {
      expect(leaf.sha256).toBe(createHash("sha256").update(readFileSync(join(output, leaf.filename))).digest("hex"));
    }
  });
});
