import { spawn } from "node:child_process";
import { copyFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const childEnvironmentKeys = ["CODEX_HOME", "HOME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "PATHEXT"];

function childEnv(source = process.env) {
  const env = {};
  const pathValue = source.PATH ?? source.Path;
  if (pathValue) env.PATH = pathValue;
  const systemRoot = source.SYSTEMROOT ?? source.SystemRoot;
  if (systemRoot) env.SYSTEMROOT = systemRoot;
  const commandShell = source.COMSPEC ?? source.ComSpec;
  if (commandShell) env.COMSPEC = commandShell;
  for (const key of childEnvironmentKeys) if (source[key]) env[key] = source[key];
  return env;
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name}_required`);
  return path.resolve(process.argv[index + 1]);
}

export function buildCodexPrompt(prompt, allowBrowserUse = false) {
  const sourceRule = allowBrowserUse
    ? "prompt에 지정된 topic_url 원문만 브라우저로 직접 확인하고, 파일·shell·image_generation 도구는 호출하지 마세요. "
    : "고정 JSON만 사용하고 웹을 조회하지 마세요. 도구를 호출하지 마세요. ";
  return `${prompt}\n\n${sourceRule}JSON 외 설명은 반환하지 마세요.`;
}

export function buildCodexArgs(outputDir, allowBrowserUse = false) {
  return [
    "--strict-config", "-c", 'default_permissions="planner"',
    "-c", 'model_reasoning_effort="high"',
    "-c", 'permissions.planner.filesystem={":minimal"="read","/codex"="deny","/codex-accounts"="deny",":workspace_roots"={"."="deny"}}',
    "-c", `permissions.planner.network.enabled=${allowBrowserUse ? "true" : "false"}`,
    "--disable", "shell_tool", "--disable", "image_generation", "--disable", "multi_agent", "--disable", "plugins",
    allowBrowserUse ? "--enable" : "--disable", "browser_use",
    "--ask-for-approval", "never", "exec", "--model", "gpt-5.6-sol", "--ignore-user-config", "--skip-git-repo-check", "--ignore-rules", "--ephemeral",
    "--output-schema", path.join(path.resolve(outputDir), "reel-storyboard-v2.schema.json"),
    "--output-last-message", path.join(outputDir, "reel-plan.json"), "-C", outputDir, "-",
  ];
}

export async function writeReelStoryboardSchema(outputDir) {
  const schemaPath = path.join(path.resolve(outputDir), "reel-storyboard-v2.schema.json");
  await mkdir(outputDir, { recursive: true });
  await copyFile(fileURLToPath(new URL("./reel-storyboard-v2.schema.json", import.meta.url)), schemaPath);
  return schemaPath;
}

export async function main() {
  const jobFile = argument("--job");
  const outputDir = argument("--output");
  await mkdir(outputDir, { recursive: true });
  await writeReelStoryboardSchema(outputDir);
  const payload = JSON.parse(await readFile(jobFile, "utf8"));
  const allowBrowserUse = payload.allowBrowserUse === true;
  const child = spawn(process.env.CODEX_COMMAND ?? "codex", buildCodexArgs(outputDir, allowBrowserUse), {
    cwd: outputDir, env: childEnv(), stdio: ["pipe", "inherit", "inherit"], shell: false,
  });
  child.stdin.end(buildCodexPrompt(String(payload.prompt), allowBrowserUse));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`codex_reel_plan_failed:${exitCode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
