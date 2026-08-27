export type WorkerResourceWorkload = "onboarding" | "design_style_analysis";

export interface WorkerResourceLease {
  id: string;
  leaseToken: string;
  expiresAt?: string;
}

export interface WorkerResourceClient {
  acquireResource(workerId: string, workload: WorkerResourceWorkload): Promise<WorkerResourceLease | null>;
  heartbeatResource(id: string, workerId: string, leaseToken: string): Promise<unknown>;
  releaseResource(id: string, workerId: string, leaseToken: string): Promise<unknown>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const HEARTBEAT_RETRY_MS = 2_000;

function retryable(error: unknown): boolean {
  return typeof error === "object" && error !== null && "retryable" in error
    && (error as { retryable?: unknown }).retryable === true;
}

function expiresAt(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function delayUntil(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

export async function withFailClosedResourceLease<T>(
  input: {
    client: WorkerResourceClient;
    workerId: string;
    workload: WorkerResourceWorkload;
    pollIntervalMs?: number;
    heartbeatIntervalMs?: number;
    maximumWaitMs?: number;
  },
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  let lease: WorkerResourceLease | null = null;
  while (!lease) {
    lease = await input.client.acquireResource(input.workerId, input.workload);
    if (lease) break;
    if (Date.now() - startedAt >= (input.maximumWaitMs ?? 60 * 60 * 1_000)) {
      throw new Error("worker_resource_queue_timeout");
    }
    await delay(input.pollIntervalMs ?? 1_000);
  }
  const controller = new AbortController();
  let knownExpiresAt = expiresAt(lease.expiresAt);
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  const abortExpired = () => {
    if (!controller.signal.aborted) controller.abort(new Error("worker_resource_lease_expired"));
  };
  const armExpiry = (nextExpiresAt: number | null) => {
    if (nextExpiresAt === null) return;
    knownExpiresAt = nextExpiresAt;
    if (expiryTimer) clearTimeout(expiryTimer);
    const remaining = nextExpiresAt - Date.now();
    if (remaining <= 0) {
      abortExpired();
      return;
    }
    expiryTimer = setTimeout(abortExpired, remaining);
  };
  armExpiry(knownExpiresAt);
  let heartbeatInFlight = false;
  const maintainHeartbeat = async () => {
    while (!controller.signal.aborted) {
      try {
        const renewed = await input.client.heartbeatResource(
          lease!.id,
          input.workerId,
          lease!.leaseToken,
        );
        if (controller.signal.aborted) return;
        if (typeof renewed === "object" && renewed !== null && "expiresAt" in renewed) {
          armExpiry(expiresAt((renewed as { expiresAt?: unknown }).expiresAt));
        }
        return;
      } catch (error) {
        if (!retryable(error) || knownExpiresAt === null) {
          controller.abort(error instanceof Error ? error : new Error("worker_resource_lease_lost"));
          return;
        }
        const remaining = knownExpiresAt - Date.now();
        if (remaining <= 0) {
          abortExpired();
          return;
        }
        try {
          await delayUntil(Math.min(HEARTBEAT_RETRY_MS, remaining), controller.signal);
        } catch {
          return;
        }
      }
    }
  };
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || controller.signal.aborted) return;
    heartbeatInFlight = true;
    void maintainHeartbeat()
      .finally(() => { heartbeatInFlight = false; });
  }, input.heartbeatIntervalMs ?? 15_000);
  const running = controller.signal.aborted
    ? Promise.reject(controller.signal.reason)
    : Promise.resolve().then(() => task(controller.signal));
  const aborted = controller.signal.aborted
    ? Promise.reject(controller.signal.reason)
    : new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener("abort", () => reject(controller.signal.reason), { once: true });
      });
  try {
    return await Promise.race([running, aborted]);
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
    await running.catch(() => undefined);
    throw error;
  } finally {
    clearInterval(heartbeat);
    if (expiryTimer) clearTimeout(expiryTimer);
    if (!controller.signal.aborted) controller.abort(new Error("worker_resource_lease_released"));
    await input.client.releaseResource(lease.id, input.workerId, lease.leaseToken).catch(() => undefined);
  }
}
