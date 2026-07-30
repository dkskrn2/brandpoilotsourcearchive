export type WorkerResourceWorkload = "onboarding";

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
  let heartbeatInFlight = false;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight || controller.signal.aborted) return;
    heartbeatInFlight = true;
    void input.client.heartbeatResource(lease!.id, input.workerId, lease!.leaseToken)
      .catch((error) => controller.abort(
        error instanceof Error ? error : new Error("worker_resource_lease_lost"),
      ))
      .finally(() => { heartbeatInFlight = false; });
  }, input.heartbeatIntervalMs ?? 15_000);
  const running = Promise.resolve().then(() => task(controller.signal));
  const aborted = new Promise<never>((_resolve, reject) => {
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
    await input.client.releaseResource(lease.id, input.workerId, lease.leaseToken).catch(() => undefined);
  }
}
