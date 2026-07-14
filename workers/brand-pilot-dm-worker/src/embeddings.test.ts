import { describe, expect, it, vi } from "vitest";
import { createEmbedding } from "./embeddings.js";

describe("DM embeddings", () => {
  it("requests the fixed 1536-dimension embedding model", async () => {
    const embedding = Array.from({ length: 1536 }, () => 0.1);
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ model: "text-embedding-3-small", dimensions: 1536 });
      return new Response(JSON.stringify({ data: [{ embedding }] }), { status: 200 });
    }) as unknown as typeof fetch;
    await expect(createEmbedding({ text: "환불", apiKey: "key", fetchImpl })).resolves.toHaveLength(1536);
  });
});
