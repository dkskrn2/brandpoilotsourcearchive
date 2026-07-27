import { execFile, spawn, type ChildProcess } from "node:child_process";

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
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new Error("ai_content_attachment_storage_unavailable"));
    }, dependencies.timeoutMs ?? ATTACHMENT_PREFLIGHT_TIMEOUT_MS);
  });
  try {
    const outcomes = snapshots.map(async (snapshot) => {
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
            return "terminal" as const;
          }
        }
        return "available" as const;
      } catch (error) {
        return isNotFound(error) ? "terminal" as const : "transient" as const;
      }
    });
    const settled = await Promise.race([Promise.all(outcomes), deadline]);
    if (settled.some((outcome) => outcome === "terminal")) {
      throw new Error("ai_content_attachment_blob_unavailable");
    }
    if (settled.some((outcome) => outcome === "transient")) {
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
  timeoutMs: number;
  timeoutErrorCode: string;
  processErrorCode: string;
}): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(input.command, {
      shell: true,
      stdio: "inherit",
      windowsHide: true,
      detached: process.platform !== "win32",
    });
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback();
    };
    const timer = setTimeout(() => {
      void terminateProcessTree(child).finally(() => finish(() => reject(new Error(input.timeoutErrorCode))));
    }, input.timeoutMs);
    child.once("error", (error) => finish(() => reject(error)));
    child.once("close", (code) => finish(() => code === 0
      ? resolve()
      : reject(new Error(`${input.processErrorCode}:${code}`))));
  });
}

export function isRetryableContentWorkerError(error: unknown): boolean {
  if (error instanceof SyntaxError) return false;
  const code = error instanceof Error ? error.message.split(":")[0] : String(error);
  if (code === "ai_content_attachment_blob_unavailable") return false;
  if (code === "ai_content_attachment_storage_unavailable") return true;
  if (code === "ENOENT" || code.includes("output_id_required")) return false;
  return !/_(?:invalid|required|mismatch)$/.test(code);
}
