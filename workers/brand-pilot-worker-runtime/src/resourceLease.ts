export type WorkerResourceWorkload = "dm" | "wiki" | "content" | "onboarding";

export interface WorkerResourceLease {
  id: string;
  leaseToken: string;
  expiresAt?: string;
}

export interface WorkerResourceClient {
  acquireResource(
    workerId: string,
    workload: WorkerResourceWorkload,
  ): Promise<WorkerResourceLease | null>;
  heartbeatResource(
    id: string,
    workerId: string,
    leaseToken: string,
  ): Promise<unknown>;
  releaseResource(
    id: string,
    workerId: string,
    leaseToken: string,
  ): Promise<unknown>;
}

const delay = (milliseconds: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const timer = setTimeout(resolve, milliseconds);
  signal?.addEventListener("abort", () => {
    clearTimeout(timer);
    reject(signal.reason);
  }, { once: true });
});

export async function withFailClosedResourceLease<T>({
  client,
  workerId,
  workload,
  pollIntervalMs = 1_000,
  heartbeatIntervalMs = 15_000,
  maximumWaitMs = 60 * 60 * 1_000,
  signal,
  onWait,
}: {
  client: WorkerResourceClient;
  workerId: string;
  workload: WorkerResourceWorkload;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
  maximumWaitMs?: number;
  signal?: AbortSignal;
  onWait?: () => Promise<unknown>;
}, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const waitStartedAt = Date.now();
  let lease: WorkerResourceLease | null = null;
  while (!lease) {
    if (signal?.aborted) throw signal.reason;
    lease = await client.acquireResource(workerId, workload);
    if (lease) break;
    if (Date.now() - waitStartedAt >= maximumWaitMs) {
      throw new Error("worker_resource_queue_timeout");
    }
    await onWait?.();
    await delay(Math.max(1, pollIntervalMs), signal);
  }

  const controller = new AbortController();
  const forwardAbort = () => controller.abort(signal?.reason);
  if (signal?.aborted) forwardAbort();
  else signal?.addEventListener("abort", forwardAbort, { once: true });

  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || controller.signal.aborted) return;
    heartbeatInFlight = true;
    void client.heartbeatResource(lease!.id, workerId, lease!.leaseToken)
      .catch((error) => controller.abort(
        error instanceof Error ? error : new Error("worker_resource_lease_lost"),
      ))
      .finally(() => { heartbeatInFlight = false; });
  }, Math.max(1, heartbeatIntervalMs));

  const aborted = new Promise<never>((_resolve, reject) => {
    controller.signal.addEventListener("abort", () => reject(
      controller.signal.reason ?? new Error("worker_resource_lease_lost"),
    ), { once: true });
  });
  const taskPromise = Promise.resolve().then(() => task(controller.signal));
  try {
    return await Promise.race([taskPromise, aborted]);
  } catch (error) {
    if (!controller.signal.aborted) controller.abort(error);
    await taskPromise.catch(() => undefined);
    throw error;
  } finally {
    clearInterval(heartbeat);
    signal?.removeEventListener("abort", forwardAbort);
    await Promise.resolve(client.releaseResource(lease.id, workerId, lease.leaseToken))
      .catch(() => undefined);
  }
}
