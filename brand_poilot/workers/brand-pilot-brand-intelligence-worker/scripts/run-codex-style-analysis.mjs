import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";

const values = new Map();
const images = [];
for (const argument of process.argv.slice(2)) {
  const [key, ...rest] = argument.replace(/^--/, "").split("=");
  const value = rest.join("=");
  if (key === "image") images.push(value); else values.set(key, value);
}
const required = (key) => {
  const value = values.get(key);
  if (!value) throw new Error(`design_style_runner_${key}_required`);
  return value;
};
const promptFile = required("prompt-file");
const outputFile = required("output-file");
const schemaFile = required("schema-file");
if (images.length < 1 || images.length > 5 || images.some((value) => !existsSync(value))) {
  throw new Error("design_style_runner_images_invalid");
}

const override = process.env.BRAND_INTELLIGENCE_CODEX_COMMAND?.trim();
const globalEntrypoint = process.env.APPDATA
  ? path.join(process.env.APPDATA, "npm", "node_modules", "@openai", "codex", "bin", "codex.js")
  : "";
const command = (!override || override === "codex") && globalEntrypoint && existsSync(globalEntrypoint)
  ? process.execPath : (override || "codex");
const prefix = command === process.execPath ? [globalEntrypoint] : [];
const model = process.env.BRAND_INTELLIGENCE_CODEX_MODEL || "gpt-5.4";
const effort = process.env.BRAND_INTELLIGENCE_CODEX_REASONING_EFFORT || "low";
const args = [
  ...prefix, "exec", "--ignore-user-config", "--ignore-rules", "-m", model,
  "-c", `model_reasoning_effort="${effort}"`,
  ...images.flatMap((file) => ["--image", file]),
  "--disable", "shell_tool", "--disable", "apps", "--disable", "browser_use",
  "--disable", "image_generation", "--disable", "multi_agent",
  "--output-schema", schemaFile, "--output-last-message", outputFile,
  "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "-",
];
const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ["pipe", "inherit", "inherit"] });
child.stdin.end(await readFile(promptFile, "utf8"));
child.once("error", (error) => { throw error; });
child.once("close", (code) => { if (code !== 0) process.exitCode = code || 1; });
