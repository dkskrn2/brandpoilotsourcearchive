import { createServer, type Server } from "node:http";
import type { WorkerProcessStatus } from "./processController.js";

export interface WorkerController {
  status(): WorkerProcessStatus;
  startWatch(): WorkerProcessStatus;
  runOnce(): WorkerProcessStatus;
  stop(): Promise<WorkerProcessStatus>;
}

export interface CentralApiHealth {
  state: "ok" | "error";
  database?: string;
}

function sendJson(response: import("node:http").ServerResponse, statusCode: number, value: unknown) {
  response.writeHead(statusCode, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(value));
}

const page = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Brand Pilot Worker</title>
<style>
  :root { color: #17212b; background: #f5f7fa; font-family: Arial, sans-serif; }
  body { margin: 0; min-width: 320px; }
  main { max-width: 720px; margin: 0 auto; padding: 32px 20px 48px; }
  h1 { margin: 0 0 8px; font-size: 24px; }
  p { color: #52616f; line-height: 1.5; }
  section { margin-top: 24px; padding: 20px; border: 1px solid #d7dee7; border-radius: 8px; background: #fff; }
  dl { display: grid; grid-template-columns: 150px 1fr; gap: 12px 16px; margin: 0; }
  dt { color: #64748b; }
  dd { margin: 0; overflow-wrap: anywhere; }
  .actions { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 20px; }
  button { min-height: 38px; padding: 0 14px; border: 1px solid #185fa5; border-radius: 6px; background: #185fa5; color: #fff; cursor: pointer; font: inherit; }
  button.secondary { border-color: #8795a1; background: #fff; color: #25313c; }
  button:disabled { cursor: not-allowed; opacity: .5; }
  #message { min-height: 20px; color: #b42318; }
</style>
</head>
<body>
<main>
  <h1>Brand Pilot Worker</h1>
  <p>이 PC에서만 이미지 워커를 제어합니다.</p>
  <section aria-live="polite">
    <dl>
      <dt>워커 상태</dt><dd id="workerState">확인 중</dd>
      <dt>실행 모드</dt><dd id="workerMode">-</dd>
      <dt>프로세스</dt><dd id="workerPid">-</dd>
      <dt>중앙 API</dt><dd id="apiState">확인 중</dd>
      <dt>마지막 작업</dt><dd id="lastResult">-</dd>
      <dt>최근 오류</dt><dd id="lastError">-</dd>
    </dl>
    <div class="actions">
      <button id="start">계속 실행</button>
      <button id="once" class="secondary">한 번 실행</button>
      <button id="stop" class="secondary">중지</button>
    </div>
    <p id="message"></p>
  </section>
</main>
<script>
const fields = ["workerState", "workerMode", "workerPid", "apiState", "lastResult", "lastError"];
const set = (id, value) => document.getElementById(id).textContent = value || "-";
async function refresh() {
  try {
    const response = await fetch("/api/status", { cache: "no-store" });
    const value = await response.json();
    const worker = value.worker;
    set("workerState", worker.state);
    set("workerMode", worker.mode);
    set("workerPid", worker.pid ? String(worker.pid) : null);
    set("apiState", value.centralApi.state === "ok" ? "정상 (DB: " + (value.centralApi.database || "ok") + ")" : "연결 실패");
    set("lastResult", worker.lastResult ? worker.lastResult.status + (worker.lastResult.jobId ? " / " + worker.lastResult.jobId : "") : null);
    set("lastError", worker.lastError);
    document.getElementById("start").disabled = worker.state !== "stopped";
    document.getElementById("once").disabled = worker.state !== "stopped";
    document.getElementById("stop").disabled = worker.state === "stopped";
  } catch { set("apiState", "상태 확인 실패"); }
}
async function action(path) {
  const message = document.getElementById("message");
  message.textContent = "";
  const response = await fetch(path, { method: "POST" });
  if (!response.ok) { message.textContent = (await response.json()).error || "요청에 실패했습니다."; }
  await refresh();
}
document.getElementById("start").addEventListener("click", () => action("/api/worker/start"));
document.getElementById("once").addEventListener("click", () => action("/api/worker/run-once"));
document.getElementById("stop").addEventListener("click", () => action("/api/worker/stop"));
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;

export function createControlServer({
  controller,
  probeHealth
}: {
  controller: WorkerController;
  probeHealth(): Promise<CentralApiHealth>;
}): Server {
  return createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (request.method === "GET" && path === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(page);
      return;
    }
    if (request.method === "GET" && path === "/api/status") {
      const centralApi = await probeHealth().catch(() => ({ state: "error" as const }));
      sendJson(response, 200, { worker: controller.status(), centralApi });
      return;
    }
    try {
      if (request.method === "POST" && path === "/api/worker/start") {
        sendJson(response, 200, { worker: controller.startWatch() });
        return;
      }
      if (request.method === "POST" && path === "/api/worker/run-once") {
        sendJson(response, 200, { worker: controller.runOnce() });
        return;
      }
      if (request.method === "POST" && path === "/api/worker/stop") {
        sendJson(response, 200, { worker: await controller.stop() });
        return;
      }
    } catch (error) {
      if (error instanceof Error && error.message === "worker_already_running") {
        sendJson(response, 409, { error: error.message });
        return;
      }
      sendJson(response, 500, { error: "worker_control_failed" });
      return;
    }
    sendJson(response, 404, { error: "not_found" });
  });
}
