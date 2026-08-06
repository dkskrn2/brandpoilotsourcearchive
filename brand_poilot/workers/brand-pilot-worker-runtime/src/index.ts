import { execFile, spawn, type ChildProcess } from "node:child_process";

export {
  runControlledSearch,
  type ControlledSearchDependencies,
  type ControlledSearchInput,
} from "./controlledSearch.js";

export {
  parseContentGenerationInputV3,
  parseImageGenerationPackageV1,
  type ContentPurposeV2,
  type ContentOutputFormatV2,
  type ContentChannelTargetV2,
  type ReferenceRoleV2,
  type ContentAspectRatioV2,
  type ApprovedBrandCoreSnapshotV2,
  type ApprovedBrandRulesSnapshotV1,
  type ApprovedProductSnapshotV2,
  type FrozenReferenceSnapshotV2,
  type ResearchEvidenceSnapshotV1,
  type InformationalProposalTypeV2,
  type ContentProposalV2,
  type FrozenStyleImageSnapshotV1,
  type FinalAttachmentSnapshotV1,
  type ContentGenerationInputV3,
  type ImageGenerationPackageV1,
  type WorkerContentPurposeV3,
  type WorkerOutputFormatV3,
  type WorkerChannelV3,
  type WorkerRatioV3,
  type WorkerReferenceRoleV3,
  type WorkerInformationTypeV3,
} from "./aiContentV3.js";

export interface AiContentAttachmentSnapshot {
  id: string;
  generationId: string;
  role: "product" | "person" | "scale" | "visual_reference" | "document";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksum: string;
  storageUrl: string;
  storagePath: string;
  createdAt: string;
}

export type WorkerContentFamily = "informational" | "marketing";
export type WorkerOutputFormat = "card_news" | "blog" | "single_image" | "channel_text";
export type WorkerContentType = "card_news" | "blog" | "marketing";
export type AiContentRevisionAction = "regenerate_hook" | "regenerate_copy" | "regenerate_card";

export interface AiContentRevisionV1 {
  contractVersion: "ai-content-revision.v1";
  action: AiContentRevisionAction;
  idempotencyKey: string;
  cardIndex: number | null;
  previousManifest: Record<string, unknown>;
  previousContent: Record<string, unknown>;
}
export type WorkerMessageStrategy =
  | "problem_solution"
  | "how_to"
  | "comparison"
  | "faq"
  | "insight"
  | "benefit"
  | "social_proof"
  | "brand_story"
  | "cta";

export interface WorkerContentOrchestrationV1 {
  contractVersion: "content-orchestration.v1";
  contentFamily: WorkerContentFamily;
  subject:
    | { mode: "brand_topic"; topic: string }
    | { mode: "product_service"; productServiceId: string }
    | { mode: "new_subject"; subjectAnalysisId: string };
  target: { id: string | null; snapshot: Record<string, unknown> };
  strategy: WorkerMessageStrategy;
  outputFormat: WorkerOutputFormat;
  channelTargets: Array<
    "instagram" | "threads" | "x" | "linkedin" | "youtube" | "tiktok" | "blog_export"
  >;
  brief: Record<string, unknown>;
  references: Array<{
    referenceItemId: string;
    roles: Array<"planning" | "copy_pattern" | "visual_composition">;
  }>;
  avatar: null | {
    mode: "library" | "one_time";
    id: string;
    snapshot: Record<string, unknown>;
  };
}

export function buildAiContentRevisionInstruction(
  value: unknown,
  expectedWorkerType: WorkerContentType,
): string {
  if (value === undefined || value === null) return "";
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ai_content_revision_invalid");
  }
  const revision = value as Record<string, unknown>;
  const action = revision.action;
  const previousManifest = revision.previousManifest;
  const previousContent = revision.previousContent;
  if (
    revision.contractVersion !== "ai-content-revision.v1"
    || !["regenerate_hook", "regenerate_copy", "regenerate_card"].includes(String(action))
    || typeof revision.idempotencyKey !== "string"
    || !revision.idempotencyKey.trim()
    || !previousManifest
    || typeof previousManifest !== "object"
    || Array.isArray(previousManifest)
    || !previousContent
    || typeof previousContent !== "object"
    || Array.isArray(previousContent)
  ) {
    throw new Error("ai_content_revision_invalid");
  }
  if (action === "regenerate_card") {
    if (expectedWorkerType !== "card_news") {
      throw new Error("ai_content_revision_worker_mismatch");
    }
    if (!Number.isSafeInteger(revision.cardIndex) || Number(revision.cardIndex) < 1) {
      throw new Error("ai_content_revision_invalid");
    }
  } else if (revision.cardIndex !== null && revision.cardIndex !== undefined) {
    throw new Error("ai_content_revision_invalid");
  }
  const instruction = action === "regenerate_card"
    ? `${Number(revision.cardIndex)}번 카드만 다시 생성하세요. 나머지 카드, 순서, 카피와 메타데이터는 previousManifest/previousContent와 동일하게 보존하세요.`
    : action === "regenerate_hook"
      ? "첫 훅만 다시 작성하세요. 훅 외 본문 카피, 카드/이미지, 순서와 메타데이터는 previousManifest/previousContent와 동일하게 보존하세요."
      : "카피만 다시 작성하세요. 카드/이미지, 순서와 기타 메타데이터는 previousManifest/previousContent와 동일하게 보존하세요.";
  return [
    "부분 재생성 계약(ai-content-revision.v1):",
    instruction,
    "전체 결과 계약은 그대로 출력하되 지정하지 않은 성공 결과를 변경하지 마세요.",
    JSON.stringify(revision, null, 2),
  ].join("\n");
}

function orchestrationInvalid(): never {
  throw new Error("content_generation_orchestration_invalid");
}

function orchestrationRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) orchestrationInvalid();
  return value as Record<string, unknown>;
}

function orchestrationText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function orchestrationClone<T>(value: T): T {
  try {
    const serialized = JSON.stringify(value, (_key, nested) => {
      if (
        nested === undefined
        || typeof nested === "bigint"
        || typeof nested === "function"
        || typeof nested === "symbol"
        || typeof nested === "number" && !Number.isFinite(nested)
      ) orchestrationInvalid();
      return nested;
    });
    if (serialized === undefined) orchestrationInvalid();
    return JSON.parse(serialized) as T;
  } catch {
    orchestrationInvalid();
  }
}

function workerTypeForFormat(format: WorkerOutputFormat): WorkerContentType {
  if (format === "card_news") return "card_news";
  if (format === "blog") return "blog";
  return "marketing";
}

function assertSupportedStaticBrief(brief: Record<string, unknown>): void {
  const serialized = JSON.stringify(brief);
  if (/\b(?:reels?|videos?|voice|face[\s_-]*swap)\b|릴스|영상|음성|얼굴\s*합성/i.test(serialized)) {
    throw new Error("content_generation_video_unsupported");
  }
}

export function parseWorkerContentOrchestration(
  value: unknown,
  expectedWorkerType: WorkerContentType,
  direction: Record<string, unknown>,
): WorkerContentOrchestrationV1 | null {
  if (value === undefined || value === null) return null;
  const source = orchestrationRecord(value);
  if (source.contractVersion !== "content-orchestration.v1") orchestrationInvalid();

  const informationalStrategies = new Set(["problem_solution", "how_to", "comparison", "faq", "insight"]);
  const marketingStrategies = new Set(["benefit", "social_proof", "brand_story", "cta"]);
  const family = source.contentFamily;
  const format = source.outputFormat;
  const strategy = source.strategy;
  const combinationValid = family === "informational"
    ? informationalStrategies.has(String(strategy)) && (format === "card_news" || format === "blog")
    : family === "marketing"
      && marketingStrategies.has(String(strategy))
      && (format === "single_image" || format === "channel_text");
  if (!combinationValid) orchestrationInvalid();
  if (
    workerTypeForFormat(format as WorkerOutputFormat) !== expectedWorkerType
    || direction.contentFamily !== family
    || direction.outputFormat !== format
  ) {
    throw new Error("content_generation_orchestration_mismatch");
  }

  const subject = orchestrationRecord(source.subject);
  if (
    subject.mode === "brand_topic"
      ? !orchestrationText(subject.topic)
        || Object.prototype.hasOwnProperty.call(subject, "wikiItemIds")
      : subject.mode === "product_service"
        ? !orchestrationText(subject.productServiceId)
        : subject.mode === "new_subject"
          ? !orchestrationText(subject.subjectAnalysisId)
          : true
  ) orchestrationInvalid();

  const target = orchestrationRecord(source.target);
  if (
    target.id !== null && !orchestrationText(target.id)
    || !target.snapshot
    || typeof target.snapshot !== "object"
    || Array.isArray(target.snapshot)
  ) orchestrationInvalid();

  const brief = orchestrationRecord(source.brief);
  assertSupportedStaticBrief(brief);
  const allowedChannels = new Set(["instagram", "threads", "x", "linkedin", "youtube", "tiktok", "blog_export"]);
  if (
    !Array.isArray(source.channelTargets)
    || source.channelTargets.length === 0
    || source.channelTargets.some((channel) => !allowedChannels.has(String(channel)))
  ) orchestrationInvalid();

  const allowedReferenceRoles = new Set(["planning", "copy_pattern", "visual_composition"]);
  if (!Array.isArray(source.references) || source.references.length > 5) orchestrationInvalid();
  const referenceIds = new Set<string>();
  for (const item of source.references) {
    const reference = orchestrationRecord(item);
    if (
      !orchestrationText(reference.referenceItemId)
      || !Array.isArray(reference.roles)
      || reference.roles.length === 0
      || reference.roles.some((role) => !allowedReferenceRoles.has(String(role)))
      || new Set(reference.roles).size !== reference.roles.length
    ) orchestrationInvalid();
    const referenceId = reference.referenceItemId.trim();
    if (referenceIds.has(referenceId)) orchestrationInvalid();
    referenceIds.add(referenceId);
  }

  if (Array.isArray(source.avatar)) orchestrationInvalid();
  if (source.avatar !== null) {
    const avatar = orchestrationRecord(source.avatar);
    if (
      avatar.mode !== "library" && avatar.mode !== "one_time"
      || !orchestrationText(avatar.id)
      || !avatar.snapshot
      || typeof avatar.snapshot !== "object"
      || Array.isArray(avatar.snapshot)
    ) orchestrationInvalid();
  }
  return orchestrationClone(source) as unknown as WorkerContentOrchestrationV1;
}

export type AttachmentHead = (storagePath: string, options: {
  abortSignal: AbortSignal;
}) => Promise<{ size?: number; contentType?: string } | unknown>;

const ATTACHMENT_PREFLIGHT_TIMEOUT_MS = 15_000;
const SHA256 = /^[0-9a-f]{64}$/i;

function attachmentSnapshot(value: unknown): AiContentAttachmentSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const strings = [
    source.id,
    source.generationId,
    source.fileName,
    source.mimeType,
    source.checksum,
    source.storageUrl,
    source.storagePath,
    source.createdAt,
  ];
  if (strings.some((item) => typeof item !== "string" || !item.trim())) return null;
  if (
    source.role !== "product"
    && source.role !== "person"
    && source.role !== "scale"
    && source.role !== "visual_reference"
    && source.role !== "document"
  ) return null;
  if (!Number.isSafeInteger(source.sizeBytes) || Number(source.sizeBytes) <= 0) return null;
  if (!SHA256.test(String(source.checksum))) return null;
  try {
    const url = new URL(String(source.storageUrl));
    if (url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  if (Number.isNaN(Date.parse(String(source.createdAt)))) return null;
  return source as unknown as AiContentAttachmentSnapshot;
}

export function parseAttachmentSnapshots(
  values: unknown,
  errorCode = "content_generation_attachment_invalid",
): AiContentAttachmentSnapshot[] {
  if (!Array.isArray(values) || values.length > 5) throw new Error(errorCode);
  const snapshots = values.map(attachmentSnapshot);
  if (snapshots.some((value) => value === null)) throw new Error(errorCode);
  return snapshots as AiContentAttachmentSnapshot[];
}

function errorStatus(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const source = error as Record<string, unknown>;
  const value = source.status ?? source.statusCode;
  return typeof value === "number" ? value : null;
}

function isNotFound(error: unknown): boolean {
  const status = errorStatus(error);
  if (status === 404) return true;
  const code = error && typeof error === "object" ? (error as Record<string, unknown>).code : null;
  if (code === "BlobNotFound" || code === "not_found" || code === "ENOENT") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /(?:^|\b)(?:404|not[ _-]?found)(?:\b|$)/i.test(message);
}

export async function preflightAttachmentSnapshots(
  values: readonly unknown[],
  dependencies: { head: AttachmentHead; timeoutMs?: number },
): Promise<AiContentAttachmentSnapshot[]> {
  let snapshots: AiContentAttachmentSnapshot[];
  try {
    snapshots = parseAttachmentSnapshots(values);
  } catch {
    throw new Error("ai_content_attachment_blob_unavailable");
  }

  const controller = new AbortController();
  const outcomes: Array<"available" | "terminal" | "transient" | undefined> =
    Array.from({ length: snapshots.length });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<"deadline">((resolve) => {
    timeout = setTimeout(() => {
      controller.abort();
      resolve("deadline");
    }, dependencies.timeoutMs ?? ATTACHMENT_PREFLIGHT_TIMEOUT_MS);
  });
  try {
    const operations = snapshots.map(async (snapshot, index) => {
      try {
        const metadata = await dependencies.head(snapshot.storagePath, { abortSignal: controller.signal });
        if (metadata && typeof metadata === "object") {
          const source = metadata as Record<string, unknown>;
          if (
            (typeof source.size === "number" && source.size !== snapshot.sizeBytes)
            || (typeof source.contentType === "string"
              && source.contentType.split(";", 1)[0]!.trim().toLowerCase()
                !== snapshot.mimeType.split(";", 1)[0]!.trim().toLowerCase())
          ) {
            outcomes[index] = "terminal";
            return;
          }
        }
        outcomes[index] = "available";
      } catch (error) {
        outcomes[index] = isNotFound(error) ? "terminal" : "transient";
      }
    });
    const completion = await Promise.race([
      Promise.all(operations).then(() => "complete" as const),
      deadline,
    ]);
    if (outcomes.some((outcome) => outcome === "terminal")) {
      throw new Error("ai_content_attachment_blob_unavailable");
    }
    if (completion === "deadline" || outcomes.some((outcome) => outcome === "transient")) {
      throw new Error("ai_content_attachment_storage_unavailable");
    }
    return snapshots;
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    controller.abort();
  }
}

type TreeTerminationDependencies = {
  platform?: NodeJS.Platform;
  execFileImpl?: typeof execFile;
  killImpl?: typeof process.kill;
};

export async function terminateProcessTree(
  child: Pick<ChildProcess, "pid" | "kill">,
  dependencies: TreeTerminationDependencies = {},
): Promise<void> {
  if (!child.pid) return;
  const platform = dependencies.platform ?? process.platform;
  if (platform === "win32") {
    const execFileImpl = dependencies.execFileImpl ?? execFile;
    await new Promise<void>((resolve) => {
      execFileImpl("taskkill", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true }, () => resolve());
    });
    return;
  }
  try {
    (dependencies.killImpl ?? process.kill)(-child.pid, "SIGKILL");
  } catch {
    child.kill("SIGKILL");
  }
}

export async function runShellCommandWithTimeout(input: {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  timeoutErrorCode: string;
  processErrorCode: string;
}, dependencies: {
  spawnImpl?: typeof spawn;
  terminateProcessTreeImpl?: typeof terminateProcessTree;
} = {}): Promise<void> {
  if (input.signal?.aborted) throw commandAbortError(input.signal);
  const [command, args] = input.args
    ? [input.command, input.args]
    : parseCommandLine(input.command);
  await new Promise<void>((resolve, reject) => {
    const child = (dependencies.spawnImpl ?? spawn)(command, args, {
      cwd: input.cwd ?? process.cwd(),
      env: input.env ?? buildWorkerCliChildEnv(process.env),
      shell: false,
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let settled = false;
    let stopping = false;
    let abortListenerAttached = false;
    let timer: ReturnType<typeof setTimeout>;
    const cleanup = () => {
      clearTimeout(timer);
      if (abortListenerAttached) {
        input.signal?.removeEventListener("abort", abort);
        abortListenerAttached = false;
      }
    };
    const finish = (callback: () => void) => {
      if (settled || stopping) return;
      settled = true;
      cleanup();
      callback();
    };
    const stop = (error: Error) => {
      if (settled || stopping) return;
      stopping = true;
      cleanup();
      void Promise.resolve()
        .then(() => (dependencies.terminateProcessTreeImpl ?? terminateProcessTree)(child))
        .catch(() => undefined)
        .finally(() => {
          settled = true;
          reject(error);
        });
    };
    const abort = () => stop(commandAbortError(input.signal!));
    timer = setTimeout(() => stop(new Error(input.timeoutErrorCode)), input.timeoutMs);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0
      ? resolve()
      : reject(new Error(`${input.processErrorCode}:${code}`))));
    if (input.signal) {
      input.signal.addEventListener("abort", abort, { once: true });
      abortListenerAttached = true;
      if (input.signal.aborted) abort();
    }
  });
}

function commandAbortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  if (typeof signal.reason === "string" && signal.reason.trim()) {
    return new Error(signal.reason);
  }
  return new Error("worker_command_aborted");
}

const WORKER_CLI_ENV_KEYS = [
  "APPDATA",
  "CODEX_HOME",
  "COMSPEC",
  "HOME",
  "LANG",
  "LC_ALL",
  "LOCALAPPDATA",
  "NODE_EXTRA_CA_CERTS",
  "NO_PROXY",
  "PATH",
  "PATHEXT",
  "SSL_CERT_FILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "USERPROFILE",
  "WINDIR",
] as const;

export function buildWorkerCliChildEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const output: NodeJS.ProcessEnv = {};
  for (const key of WORKER_CLI_ENV_KEYS) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  return output;
}

function parseCommandLine(value: string): [command: string, args: string[]] {
  const tokens: string[] = [];
  let token = "";
  let quote: "'" | '"' | null = null;
  let tokenStarted = false;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (quote !== "'" && character === "\\") {
      const next = value[index + 1];
      if (next !== undefined && (next === quote || next === "\\" || /\s/.test(next))) {
        token += next;
        tokenStarted = true;
        index += 1;
        continue;
      }
    }
    if (character === "'" || character === '"') {
      if (quote === character) {
        quote = null;
      } else if (quote === null) {
        quote = character;
        tokenStarted = true;
      } else {
        token += character;
      }
      continue;
    }
    if (quote === null && /\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token);
        token = "";
        tokenStarted = false;
      }
      continue;
    }
    token += character;
    tokenStarted = true;
  }
  if (quote !== null) throw new Error("worker_command_quote_invalid");
  if (tokenStarted) tokens.push(token);
  const [command, ...args] = tokens;
  if (!command) throw new Error("worker_command_required");
  return [command, args];
}

export function isRetryableContentWorkerError(error: unknown): boolean {
  if (error instanceof SyntaxError) return false;
  const code = error instanceof Error ? error.message.split(":")[0] : String(error);
  if (code === "ai_content_attachment_blob_unavailable") return false;
  if (code === "ai_content_attachment_storage_unavailable") return true;
  if (code === "ENOENT" || code.includes("output_id_required")) return false;
  return !/_(?:invalid|required|mismatch)$/.test(code);
}
