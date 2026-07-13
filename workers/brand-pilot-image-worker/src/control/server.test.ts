import type { AddressInfo } from "node:net";
import { describe, expect, it } from "vitest";
import type { WorkerProcessStatus } from "./processController.js";
import { createControlServer } from "./server.js";

function controller() {
  let state: WorkerProcessStatus = { state: "stopped", mode: null, pid: null, lastResult: null, lastError: null };
  return {
    status: () => state,
    startWatch: () => state = { ...state, state: "watching", mode: "watch", pid: 1234 },
    runOnce: () => state = { ...state, state: "running_once", mode: "run-once", pid: 1234 },
    stop: async () => state = { state: "stopped", mode: null, pid: null, lastResult: null, lastError: null }
  };
}

async function withServer(run: (baseUrl: string) => Promise<void>) {
  const app = createControlServer({
    controller: controller(),
    probeHealth: async () => ({ state: "ok" as const, database: "ok" })
  });
  await new Promise<void>((resolve) => app.listen(0, "127.0.0.1", resolve));
  const { port } = app.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => app.close((error) => error ? reject(error) : resolve()));
  }
}

describe("worker control server", () => {
  it("serves local status without returning credentials", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/status`);
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({
        worker: { state: "stopped", mode: null, pid: null, lastResult: null, lastError: null },
        centralApi: { state: "ok", database: "ok" }
      });
    });
  });

  it("starts watch mode through its fixed local route", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/worker/start`, { method: "POST" });
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ worker: { state: "watching", mode: "watch", pid: 1234 } });
    });
  });

  it("serves the control page only from its local route", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/`);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(await response.text()).toContain("Brand Pilot Worker");
    });
  });
});
