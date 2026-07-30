import {
  withFailClosedResourceLease,
  type WorkerResourceClient,
  type WorkerResourceLease,
  type WorkerResourceWorkload,
} from "@brand-pilot/worker-runtime";

export type {
  WorkerResourceClient,
  WorkerResourceLease,
  WorkerResourceWorkload,
};

export function withWorkerResourceLease<T>({
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
}, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
  return withFailClosedResourceLease({
    client,
    workerId,
    workload,
    pollIntervalMs,
    heartbeatIntervalMs,
  }, task);
}
