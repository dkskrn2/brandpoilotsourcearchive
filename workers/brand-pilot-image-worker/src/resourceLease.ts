export type WorkerResourceWorkload = "dm" | "wiki" | "content";

export interface WorkerResourceLease {
  id: string;
  leaseToken: string;
  expiresAt: string;
}

export interface WorkerResourceClient {
  acquireResource(workerId: string, workload: WorkerResourceWorkload): Promise<WorkerResourceLease | null>;
  heartbeatResource(id: string, workerId: string, leaseToken: string): Promise<unknown>;
  releaseResource(id: string, workerId: string, leaseToken: string): Promise<unknown>;
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function withWorkerResourceLease<T>({
  client,
  workerId,
  workload,
  pollIntervalMs = 1_000,
  heartbeatIntervalMs = 15_000,
}: {
  client: WorkerResourceClient;
  workerId: string;
  workload: WorkerResourceWorkload;
  pollIntervalMs?: number;
  heartbeatIntervalMs?: number;
}, task: () => Promise<T>): Promise<T> {
  let lease: WorkerResourceLease | null = null;
  while (!lease) {
    lease = await client.acquireResource(workerId, workload);
    if (!lease) await delay(Math.max(1, pollIntervalMs));
  }

  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let activeHeartbeat = Promise.resolve();
  const scheduleHeartbeat = () => {
    timer = setTimeout(() => {
      if (stopped || !lease) return;
      activeHeartbeat = Promise.resolve(client.heartbeatResource(lease.id, workerId, lease.leaseToken))
        .catch((error) => console.error("worker_resource_heartbeat_failed", error))
        .then(() => {
          if (!stopped) scheduleHeartbeat();
        });
    }, Math.max(1, heartbeatIntervalMs));
  };
  scheduleHeartbeat();

  try {
    return await task();
  } finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    await activeHeartbeat;
    await client.releaseResource(lease.id, workerId, lease.leaseToken).catch((error) => {
      console.error("worker_resource_release_failed", error);
    });
  }
}
