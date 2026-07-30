import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const childEnvironmentKeys = [
  "CODEX_HOME",
  "HOME",
  "LANG",
  "LC_ALL",
  "TMPDIR",
  "TMP",
  "TEMP",
  "SSL_CERT_FILE",
  "NODE_EXTRA_CA_CERTS",
  "PATHEXT",
];

export function codexChildEnv(source = process.env) {
  const env = {};
  const pathValue = source.PATH ?? source.Path;
  if (pathValue) env.PATH = pathValue;
  const systemRoot = source.SYSTEMROOT ?? source.SystemRoot;
  if (systemRoot) env.SYSTEMROOT = systemRoot;
  const commandShell = source.COMSPEC ?? source.ComSpec;
  if (commandShell) env.COMSPEC = commandShell;
  for (const key of childEnvironmentKeys) {
    if (source[key]) env[key] = source[key];
  }
  return env;
}

export function buildCodexArgs(outputDir) {
  return [
    "--strict-config",
    "-c",
    'default_permissions="worker"',
    "-c",
    'permissions.worker.filesystem={":minimal"="read","/codex"="deny","/codex/generated_images"="read",":workspace_roots"={"."="write"}}',
    "-c",
    "permissions.worker.network.enabled=false",
    "--enable",
    "image_generation",
    "--enable",
    "shell_tool",
    "--disable",
    "shell_snapshot",
    "--ask-for-approval",
    "never",
    "exec",
    "--ignore-user-config",
    "--skip-git-repo-check",
    "--ephemeral",
    "-C",
    outputDir,
    "-",
  ];
}

export function codexSpawnOptions(outputDir, source = process.env) {
  return {
    cwd: outputDir,
    env: codexChildEnv(source),
    stdio: ["pipe", "inherit", "inherit"],
    shell: false,
  };
}

function argument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`${name}_required`);
  return path.resolve(process.argv[index + 1]);
}

export async function main() {
  const jobFile = argument("--job");
  const outputDir = argument("--output");
  const payload = JSON.parse(await readFile(jobFile, "utf8"));
  const prompt = String(payload.prompt);
  const child = spawn(
    process.env.CODEX_COMMAND ?? "codex",
    buildCodexArgs(outputDir),
    codexSpawnOptions(outputDir),
  );
  child.stdin.end(
    `${prompt}\n\n산출물을 다음 절대 경로에 저장하세요: ${outputDir}\n`
      + "파일 작성과 생성 이미지 복사는 shell tool을 사용해도 됩니다.",
  );
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`codex_blog_failed:${exitCode}`);
}

if (
  process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
