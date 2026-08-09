import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { CONTENT_PLANNER_MODEL_ID } from "@brand-pilot/content-contracts";

const childEnvironmentKeys = ["CODEX_HOME", "HOME", "LANG", "LC_ALL", "TMPDIR", "TMP", "TEMP", "SSL_CERT_FILE", "NODE_EXTRA_CA_CERTS", "PATHEXT"];
export function codexChildEnv(source = process.env) {
  const env = {}; const pathValue = source.PATH ?? source.Path; if (pathValue) env.PATH = pathValue;
  const systemRoot = source.SYSTEMROOT ?? source.SystemRoot; if (systemRoot) env.SYSTEMROOT = systemRoot;
  const commandShell = source.COMSPEC ?? source.ComSpec; if (commandShell) env.COMSPEC = commandShell;
  for (const key of childEnvironmentKeys) if (source[key]) env[key] = source[key];
  return env;
}
export function codexSpawnOptions(outputDir, source = process.env) { return { cwd: outputDir, env: codexChildEnv(source), stdio: ["pipe", "inherit", "inherit"], shell: false }; }
export function buildCodexPrompt(prompt) { return `${prompt}\n\n제공된 고정 JSON만 사용하고 파일이나 웹을 조회하지 마세요. 도구를 호출하지 말고 JSON 외의 설명을 반환하지 마세요.`; }
export function buildCodexArgs(outputDir) {
  return [
    "--model", CONTENT_PLANNER_MODEL_ID,
    "--strict-config", "-c", 'default_permissions="writer"',
    "-c", 'permissions.writer.filesystem={":minimal"="read","/codex"="deny","/codex-accounts"="deny",":workspace_roots"={"."="deny"}}',
    "-c", "permissions.writer.network.enabled=false",
    "--disable", "shell_tool", "--disable", "image_generation", "--disable", "shell_snapshot",
    "--disable", "apps", "--disable", "browser_use", "--disable", "browser_use_external", "--disable", "in_app_browser",
    "--disable", "computer_use", "--disable", "multi_agent", "--disable", "plugins",
    "--ask-for-approval", "never", "exec", "--ignore-user-config", "--skip-git-repo-check", "--ignore-rules", "--ephemeral",
    "--output-schema", path.resolve(
      import.meta.dirname,
      "../../../packages/brand-pilot-content-contracts/generated/blog-plan-v2.schema.json",
    ),
    "--output-last-message", path.join(outputDir, "blog-plan.json"), "-C", outputDir, "-",
  ];
}
function argument(name) { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name}_required`); return path.resolve(process.argv[index + 1]); }
export async function main() {
  const jobFile = argument("--job"); const outputDir = argument("--output"); await mkdir(outputDir, { recursive: true });
  const payload = JSON.parse(await readFile(jobFile, "utf8"));
  const child = spawn(process.env.CODEX_COMMAND ?? "codex", buildCodexArgs(outputDir), codexSpawnOptions(outputDir));
  child.stdin.end(buildCodexPrompt(String(payload.prompt)));
  const exitCode = await new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", (code) => resolve(code ?? 1)); });
  if (exitCode !== 0) throw new Error(`codex_blog_v2_plan_failed:${exitCode}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`); process.exitCode = 1; });
