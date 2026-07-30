import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";

const value = (name) => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name}_required`); return path.resolve(process.argv[index + 1]); };
const jobFile = value("--job");
const outputDir = value("--output");
await mkdir(outputDir, { recursive: true });
const payload = JSON.parse(await readFile(jobFile, "utf8"));
const outputFile = path.join(outputDir, "editorial-plan.json");
const schemaFile = path.resolve(import.meta.dirname, "editorial-plan.schema.json");
const prompt = `${payload.prompt}\n\n도구를 호출하거나 파일을 읽지 말고 제공된 입력만 판단하세요. 최종 응답에는 JSON 외의 설명을 포함하지 마세요.`;
const command = process.env.CODEX_COMMAND ?? "codex";
const args = ["--disable", "shell_snapshot", "--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--ignore-rules", "--ephemeral", "--sandbox", "read-only", "--output-schema", schemaFile, "--output-last-message", outputFile, "-C", outputDir, "-"];
const child = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
child.stdin.end(prompt);
child.on("exit", (code) => { process.exitCode = code ?? 1; });
