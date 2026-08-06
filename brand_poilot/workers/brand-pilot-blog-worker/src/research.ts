import { spawn } from "node:child_process";
import {
  buildWorkerCliChildEnv,
  runControlledSearch,
  terminateProcessTree,
  type ControlledSearchInput,
} from "@brand-pilot/worker-runtime";
import type { ContentGenerationInputV3, ResearchEvidenceSnapshotV1 } from "@brand-pilot/content-contracts";

export interface BlogResearchDecision { decision: "needed" | "not_needed"; reason: string }
export interface BlogResearch {
  assess(input: ContentGenerationInputV3, signal?: AbortSignal): Promise<BlogResearchDecision>;
  search(input: ContentGenerationInputV3, signal?: AbortSignal): Promise<ResearchEvidenceSnapshotV1>;
}

type AssessmentChild = (input: { args: string[]; prompt: string; signal?: AbortSignal }) => Promise<string>;

function publicSubjectTitle(input: ContentGenerationInputV3): string | null {
  if (input.subject.kind === "topic_text") return input.subject.title;
  if (input.subject.kind === "topic_url") return input.subject.title;
  const selected = new Set(input.subject.referenceIds);
  const title = input.references.selected
    .filter((reference) => selected.has(reference.referenceItemId))
    .map((reference) => reference.title)
    .join(" / ")
    .trim();
  return title ? title.slice(0, 1_000) : null;
}

function publicResearchContext(input: ContentGenerationInputV3): ControlledSearchInput["publicResearchContext"] {
  const purpose = input.outputSettings.purpose;
  return {
    purpose,
    subjectKind: input.subject.kind,
    subjectTitle: publicSubjectTitle(input),
    contentInstruction: input.contentInstruction,
    primaryCategory: input.brandCore.primaryCategory,
    detailedCategory: input.brandCore.detailedCategory,
    selectedProduct: purpose === "marketing" && input.product !== null
      ? { name: input.product.name, category: input.brandCore.detailedCategory }
      : null,
  };
}

export function buildResearchAssessmentArgs(): string[] {
  return [
    "--strict-config", "-c", 'default_permissions="assessor"',
    "-c", 'permissions.assessor.filesystem={":minimal"="read","/codex"="deny",":workspace_roots"={"."="deny"}}',
    "-c", "permissions.assessor.network.enabled=false",
    "--disable", "shell_tool", "--disable", "image_generation", "--disable", "shell_snapshot",
    "--disable", "apps", "--disable", "browser_use", "--disable", "browser_use_external", "--disable", "in_app_browser",
    "--disable", "computer_use", "--disable", "multi_agent", "--disable", "plugins",
    "--ask-for-approval", "never", "exec", "--ignore-user-config", "--skip-git-repo-check",
    "--ignore-rules", "--ephemeral", "-",
  ];
}

function assessmentPrompt(input: ContentGenerationInputV3): string {
  return [
    "네트워크, 파일, 셸과 이미지 도구를 사용하지 말고 제공된 고정 입력만 검토하세요.",
    "선택 구성안을 3,000~10,000자 블로그로 확장할 때 사실 근거가 충분하면 not_needed, 최신 맥락이나 설명 근거가 실제로 부족하면 needed를 선택하세요.",
    "제품 사실은 검색 대상으로 삼지 마세요. informational과 marketing 목적 모두 같은 기준을 적용하세요.",
    '정확히 {"decision":"needed|not_needed","reason":"..."} JSON만 반환하세요.',
    JSON.stringify({ purpose: input.outputSettings.purpose, subject: input.subject, proposal: input.selectedProposal, originalEvidence: input.researchEvidence, product: input.product }),
  ].join("\n");
}

async function productionAssessmentChild({ args, prompt, signal }: { args: string[]; prompt: string; signal?: AbortSignal }): Promise<string> {
  const child = spawn(process.env.BLOG_RESEARCH_CODEX_COMMAND?.trim() || "codex", args, {
    shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"], env: buildWorkerCliChildEnv(process.env),
  });
  return new Promise<string>((resolve, reject) => {
    let stdout = ""; let stderr = ""; let settled = false;
    const stop = (error: Error) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); void terminateProcessTree(child).finally(() => reject(error)); };
    const abort = () => stop(signal?.reason instanceof Error ? signal.reason : new Error("blog_research_assessment_aborted"));
    const timer = setTimeout(() => stop(new Error("blog_research_assessment_timeout")), 120_000);
    signal?.addEventListener("abort", abort, { once: true });
    child.stdout.on("data", (chunk) => { stdout += String(chunk); if (Buffer.byteLength(stdout) > 64 * 1024) stop(new Error("blog_research_assessment_output_limit")); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); if (Buffer.byteLength(stderr) > 64 * 1024) stop(new Error("blog_research_assessment_output_limit")); });
    child.once("error", (error) => stop(error));
    child.once("close", (code) => { if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort); code === 0 ? resolve(stdout) : reject(new Error(`blog_research_assessment_failed:${code}:${stderr.slice(0, 500)}`)); });
    child.stdin.end(prompt);
    if (signal?.aborted) abort();
  });
}

function parseDecision(raw: string): BlogResearchDecision {
  let value: unknown;
  try { value = JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "")); } catch { throw new Error("blog_research_assessment_invalid"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("blog_research_assessment_invalid");
  const source = value as Record<string, unknown>;
  if (Object.keys(source).length !== 2 || !Object.hasOwn(source, "decision") || !Object.hasOwn(source, "reason") || (source.decision !== "needed" && source.decision !== "not_needed") || typeof source.reason !== "string" || !source.reason.trim() || source.reason.length > 4_000) throw new Error("blog_research_assessment_invalid");
  return { decision: source.decision, reason: source.reason.trim() };
}

export async function assessBlogResearchNeed(input: ContentGenerationInputV3, dependencies: { runChild?: AssessmentChild; signal?: AbortSignal } = {}): Promise<BlogResearchDecision> {
  return parseDecision(await (dependencies.runChild ?? productionAssessmentChild)({ args: buildResearchAssessmentArgs(), prompt: assessmentPrompt(input), signal: dependencies.signal }));
}

export async function runBlogSupplementalSearch(input: ContentGenerationInputV3, dependencies: { search?: typeof runControlledSearch; signal?: AbortSignal } = {}): Promise<ResearchEvidenceSnapshotV1> {
  return (dependencies.search ?? runControlledSearch)({
    purpose: input.outputSettings.purpose,
    mode: "blog_supplement",
    publicResearchContext: publicResearchContext(input),
    signal: dependencies.signal,
  });
}

export function createBlogResearch(): BlogResearch {
  return {
    assess: (input, signal) => assessBlogResearchNeed(input, { signal }),
    search: (input, signal) => runBlogSupplementalSearch(input, { signal }),
  };
}
