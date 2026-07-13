import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createProcessController } from "./processController.js";
import { createControlServer } from "./server.js";
import { launchWorker, probeCentralApi, stopWorkerProcess } from "./runtime.js";

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_required`);
  return value;
}

function portFromEnvironment() {
  const value = Number(process.env.WORKER_CONTROL_PORT ?? "4174");
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error("WORKER_CONTROL_PORT_invalid");
  return value;
}

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const apiUrl = required("BRAND_PILOT_API_URL");
const controller = createProcessController({
  launch: (mode) => launchWorker(workerRoot, mode),
  stopProcess: stopWorkerProcess
});
const server = createControlServer({
  controller,
  probeHealth: () => probeCentralApi(apiUrl)
});
const port = portFromEnvironment();

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`Brand Pilot worker control: http://127.0.0.1:${port}\n`);
});
