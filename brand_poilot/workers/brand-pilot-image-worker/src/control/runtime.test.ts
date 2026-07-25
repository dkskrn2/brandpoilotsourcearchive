import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildWorkerCommand, probeCentralApi } from "./runtime.js";

describe("worker control runtime", () => {
  it("builds a fixed worker command for watch mode", () => {
    const command = buildWorkerCommand("C:/worker", "watch");

    expect(command.command).toBe(process.execPath);
    expect(command.args).toEqual([
      path.join("C:/worker", "node_modules", "tsx", "dist", "cli.mjs"),
      "src/index.ts",
      "watch"
    ]);
  });

  it("reports only a healthy central API result", async () => {
    const health = await probeCentralApi("https://api.example.com/", async () => new Response(JSON.stringify({ ok: true, database: "ok" }), { status: 200 }));

    expect(health).toEqual({ state: "ok", database: "ok" });
  });
});
