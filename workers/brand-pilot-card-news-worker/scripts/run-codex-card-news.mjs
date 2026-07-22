import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const value = (name) => { const index = process.argv.indexOf(name); if (index < 0 || !process.argv[index + 1]) throw new Error(`${name}_required`); return path.resolve(process.argv[index + 1]); };
const jobFile = value("--job");
const outputDir = value("--output");
const payload = JSON.parse(await readFile(jobFile, "utf8"));
const prompt = `${payload.prompt}\n\n산출물은 반드시 다음 절대 경로에 저장하세요: ${outputDir}\n파일 작성과 생성 이미지 복사는 shell tool을 사용해도 됩니다.`;
const command = process.env.CODEX_COMMAND ?? "codex";
const args = ["--enable", "image_generation", "--enable", "shell_tool", "--disable", "shell_snapshot", "--ask-for-approval", "never", "exec", "--skip-git-repo-check", "--ephemeral", "--sandbox", "danger-full-access", "-C", path.resolve(import.meta.dirname, ".."), "-"];
const child = spawn(command, args, { stdio: ["pipe", "inherit", "inherit"], shell: process.platform === "win32" });
child.stdin.end(prompt);
child.on("exit", (code) => { process.exitCode = code ?? 1; });
