import { describe, expect, it, vi } from "vitest";
import { createClient } from "./client.js";

describe("reel worker client", () => {
  it("claims only the reel route", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ job: null }), { status: 200 }));
    await createClient("https://api.example", "token", fetchImpl as never).claim("reel-1");
    expect(fetchImpl).toHaveBeenCalledWith("https://api.example/worker/ai-content-jobs/reel/claim", expect.any(Object));
  });
});
