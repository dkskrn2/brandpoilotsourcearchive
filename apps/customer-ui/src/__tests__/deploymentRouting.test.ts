import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("customer UI deployment routing", () => {
  it("serves the SPA entry point for direct application routes", () => {
    expect(existsSync("vercel.json")).toBe(true);
    if (!existsSync("vercel.json")) return;

    const config = JSON.parse(readFileSync("vercel.json", "utf8")) as {
      rewrites?: Array<{ source: string; destination: string }>;
    };

    expect(config.rewrites).toContainEqual({
      source: "/(.*)",
      destination: "/index.html",
    });
  });
});
