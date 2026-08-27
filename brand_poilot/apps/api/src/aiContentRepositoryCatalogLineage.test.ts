import type { Pool } from "pg";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("node:fs");
  vi.resetModules();
});

it("accepts the exact generated Proposal catalog", async () => {
  const { createAiContentProposalV2Repository } = await import("./aiContentRepository.js");
  expect(() => createAiContentProposalV2Repository({} as Pool)).not.toThrow();
}, 20_000);

it("fails closed when the generated Proposal catalog has a different tuple and file hash", async () => {
  vi.doMock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return {
      ...actual,
      readFileSync(path: Parameters<typeof actual.readFileSync>[0], ...args: unknown[]) {
        const original = (actual.readFileSync as (...values: unknown[]) => Buffer | string)(path, ...args);
        if (!String(path).replaceAll("\\", "/").endsWith("/content-catalog.json")) return original;
        const catalog = JSON.parse(original.toString());
        catalog.proposalContracts.promptVersion = "proposal.writer.v3";
        const mutated = `${JSON.stringify(catalog, null, 2)}\n`;
        return typeof original === "string" ? mutated : Buffer.from(mutated);
      },
    };
  });

  const { createAiContentProposalV2Repository } = await import("./aiContentRepository.js");
  expect(() => createAiContentProposalV2Repository({} as Pool))
    .toThrow("content_contract_catalog_hash_mismatch");
}, 20_000);
