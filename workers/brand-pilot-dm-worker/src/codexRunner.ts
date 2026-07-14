import { spawn as nodeSpawn } from "node:child_process";

function extractJson(stdout: string) {
  for (const line of stdout.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>;
      for (const candidate of [parsed.text, parsed.output, (parsed.item as Record<string, unknown> | undefined)?.text]) {
        if (typeof candidate !== "string") continue;
        try { return JSON.parse(candidate); } catch { /* continue */ }
      }
      if (parsed.decision) return parsed;
    } catch { /* output may include progress lines */ }
  }
  try { return JSON.parse(stdout); } catch { throw new Error("codex_response_invalid"); }
}

export async function runCodexJson({ prompt, runtimeDirectory, timeoutMs = 10_000, spawnImpl = nodeSpawn }: {
  prompt: string;
  runtimeDirectory: string;
  timeoutMs?: number;
  spawnImpl?: typeof nodeSpawn;
}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawnImpl("codex", ["exec", "--skip-git-repo-check", "--ephemeral", "--json", "--sandbox", "read-only", "-C", runtimeDirectory, "-"], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("codex_timeout"));
    }, timeoutMs);
    child.stdout?.on("data", (data) => { stdout += String(data); });
    child.stderr?.on("data", (data) => { stderr += String(data); });
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`codex_failed:${code}:${stderr.slice(0, 300)}`));
      try { resolve(extractJson(stdout)); } catch (error) { reject(error); }
    });
    child.stdin?.end(prompt);
  });
}
