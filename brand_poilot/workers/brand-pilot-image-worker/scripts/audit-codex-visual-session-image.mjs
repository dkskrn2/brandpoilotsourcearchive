import { open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  applyVisualSessionImageHookEvent,
  createVisualSessionImageAudit,
} from "./visualSessionImageAudit.mjs";

const AUDIT_FILE = "visual-session-hook-audit.json";
const LOCK_FILE = "visual-session-hook-audit.lock";

async function stdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function acquireLock(file) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      return await open(file, "wx", 0o600);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      await delay(25);
    }
  }
  throw new Error("visual_session_image_audit_lock_unavailable");
}

function parseJob(raw) {
  const job = JSON.parse(raw);
  if (job?.contractVersion !== "ai-content-visual-session-render.v1"
    || !Array.isArray(job.expectedSceneIndices)) throw new Error("visual_session_image_job_invalid");
  return job;
}

async function main() {
  const event = JSON.parse(await stdin());
  const workspaceDir = path.resolve(process.cwd());
  if (typeof event?.cwd !== "string" || path.resolve(event.cwd) !== workspaceDir) {
    throw new Error("visual_session_image_hook_cwd_invalid");
  }
  const lockPath = path.join(workspaceDir, LOCK_FILE);
  const lock = await acquireLock(lockPath);
  try {
    const job = parseJob(await readFile(path.join(workspaceDir, "visual-session-job.json"), "utf8"));
    const requiredProductReferencePaths = await readFile(
      path.join(workspaceDir, "required-product-reference-paths.json"),
      "utf8",
    ).then((value) => JSON.parse(value), (error) => {
      if (error?.code === "ENOENT") return [];
      throw error;
    });
    if (!Array.isArray(requiredProductReferencePaths)
      || requiredProductReferencePaths.some((value) => typeof value !== "string" || !value)) {
      throw new Error("visual_session_image_required_product_reference_invalid");
    }
    let audit;
    try {
      audit = JSON.parse(await readFile(path.join(workspaceDir, AUDIT_FILE), "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      audit = createVisualSessionImageAudit(job.expectedSceneIndices);
    }
    const updated = applyVisualSessionImageHookEvent(audit, {
      hookEventName: event.hook_event_name,
      toolName: event.tool_name,
      toolUseId: event.tool_use_id,
      toolInput: event.tool_input,
      workspaceDir,
      requiredProductReferencePaths,
      nowMs: Date.now(),
    });
    if (updated !== audit) {
      await writeFile(path.join(workspaceDir, AUDIT_FILE), `${JSON.stringify(updated)}\n`, { encoding: "utf8", mode: 0o600 });
    }
  } finally {
    await lock.close();
    await rm(lockPath, { force: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 2;
});
