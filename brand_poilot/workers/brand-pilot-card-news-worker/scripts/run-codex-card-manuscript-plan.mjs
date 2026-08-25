import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { codexChildEnv, codexSpawnOptions } from "./codex-runtime.mjs";

export { codexChildEnv, codexSpawnOptions };

export function buildCodexPrompt(prompt, allowBrowserUse = false) {
  const sourceRule = allowBrowserUse
    ? "prompt에 지정된 topic_url 원문만 브라우저로 직접 확인하고, 파일·shell·image_generation 도구는 호출하지 마세요. "
    : "제공된 동결 source bundle만 사용하고 파일이나 웹을 조회하지 마세요. 도구를 호출하지 마세요. ";
  return `${prompt}\n\n${sourceRule}최종 응답에는 JSON 외의 설명을 포함하지 마세요.`;
}

export function buildCodexArgs(outputDir, allowBrowserUse = false) {
  const schemaFile = path.resolve(import.meta.dirname, "card-manuscript-plan-v1.schema.json");
  const outputFile = path.join(outputDir, "card-manuscript-plan.json");
  return [
    "--model", "gpt-5.6-sol", "--strict-config",
    "-c", 'model_reasoning_effort="high"',
    "-c", 'default_permissions="planner"',
    "-c", 'permissions.planner.filesystem={":minimal"="read","/codex"="deny","/codex-accounts"="deny",":workspace_roots"={"."="deny"}}',
    "-c", `permissions.planner.network.enabled=${allowBrowserUse ? "true" : "false"}`,
    "--disable", "shell_tool", "--disable", "image_generation", "--disable", "shell_snapshot", "--disable", "multi_agent", "--disable", "plugins",
    allowBrowserUse ? "--enable" : "--disable", "browser_use",
    "--ask-for-approval", "never", "exec", "--ignore-user-config", "--skip-git-repo-check", "--ignore-rules", "--ephemeral",
    "--output-schema", schemaFile, "--output-last-message", outputFile, "-C", outputDir, "-",
  ];
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name}_required`);
  return path.resolve(process.argv[index + 1]);
}

export async function main() {
  const jobFile = argument("--job");
  const outputDir = argument("--output");
  await mkdir(outputDir, { recursive: true });
  const payload = JSON.parse(await readFile(jobFile, "utf8"));
  const allowBrowserUse = payload.allowBrowserUse === true;
  const child = spawn(process.env.CODEX_COMMAND ?? "codex", buildCodexArgs(outputDir, allowBrowserUse), codexSpawnOptions(outputDir));
  child.stdin.end(buildCodexPrompt(payload.prompt, allowBrowserUse));
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`codex_card_manuscript_plan_failed:${exitCode}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
