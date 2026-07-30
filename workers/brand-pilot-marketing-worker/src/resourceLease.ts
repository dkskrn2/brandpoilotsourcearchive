import { withFailClosedResourceLease } from "@brand-pilot/worker-runtime";
import type { MarketingClient } from "./contracts.js";

export function withResource<T>(
  client: MarketingClient,
  workerId: string,
  task: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  return withFailClosedResourceLease({
    client: {
      acquireResource: (id) => client.acquire(id),
      heartbeatResource: (id, idOfWorker, token) => client.heartbeatResource(id, idOfWorker, token),
      releaseResource: (id, idOfWorker, token) => client.releaseResource(id, idOfWorker, token),
    },
    workerId,
    workload: "content",
  }, task);
}
