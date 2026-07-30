import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, ...rest] = arg.replace(/^--/, "").split("=");
  args.set(key, rest.join("="));
}

const required = (name) => {
  const value = args.get(name);
  if (!value) throw new Error(`subject_analysis_runner_${name}_required`);
  return value;
};

const jobFile = required("job-file");
const outputFile = required("output-file");
const runtimeDir = required("runtime-dir");
function codexInvocation() {
  const override = process.env.SUBJECT_ANALYSIS_CODEX_COMMAND?.trim();
  const globalEntrypoint = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
    : "";
  if ((!override || override === "codex") && globalEntrypoint && existsSync(globalEntrypoint)) {
    return { command: process.execPath, argsPrefix: [globalEntrypoint] };
  }
  return { command: override || "codex", argsPrefix: [] };
}

function childEnvironment(source) {
  const keys = ["APPDATA", "CODEX_HOME", "COMSPEC", "HOME", "LANG", "LC_ALL", "LOCALAPPDATA", "NODE_EXTRA_CA_CERTS", "NO_PROXY", "OPENAI_API_KEY", "PATH", "PATHEXT", "SSL_CERT_FILE", "SYSTEMROOT", "TEMP", "TMP", "USERPROFILE", "WINDIR", "HTTP_PROXY", "HTTPS_PROXY"];
  return Object.fromEntries(keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
}

const codex = codexInvocation();
const model = process.env.SUBJECT_ANALYSIS_CODEX_MODEL || "gpt-5.4";
const effort = process.env.SUBJECT_ANALYSIS_CODEX_REASONING_EFFORT || "low";
const fast = process.env.SUBJECT_ANALYSIS_CODEX_FAST_MODE?.toLowerCase() !== "false";
const prompt = await readFile(jobFile, "utf8");

const child = spawn(codex.command, [
  ...codex.argsPrefix,
  "exec", "--ignore-user-config", "-m", model,
  "-c", `model_reasoning_effort=\"${effort}\"`,
  ...(fast ? ["--enable", "fast_mode", "-c", "service_tier=\"fast\""] : []),
  "--skip-git-repo-check", "--ephemeral", "--json", "--sandbox", "read-only", "-C", runtimeDir, "-",
], { shell: false, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: childEnvironment(process.env) });

let stdout = "";
let stderr = "";
child.stdout.on("data", (chunk) => { stdout += String(chunk); });
child.stderr.on("data", (chunk) => { stderr += String(chunk); });
child.stdin.end(prompt);

const code = await new Promise((resolve, reject) => {
  child.once("error", reject);
  child.once("close", resolve);
});
if (code !== 0) throw new Error(`subject_analysis_codex_failed:${code}:${stderr.slice(0, 500)}`);

function extract(value) {
  for (const line of value.trim().split(/\r?\n/).reverse()) {
    try {
      const parsed = JSON.parse(line);
      for (const candidate of [parsed.text, parsed.output, parsed.item?.text]) {
        if (typeof candidate !== "string") continue;
        try { return JSON.parse(candidate); } catch { /* next candidate */ }
      }
      if (parsed.contractVersion === "subject-analysis-result.v1") return parsed;
    } catch { /* progress event */ }
  }
  throw new Error("subject_analysis_codex_json_invalid");
}

await writeFile(outputFile, `${JSON.stringify(extract(stdout))}\n`, "utf8");
