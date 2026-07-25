export type WorkerResourceType = "codex_cli";
export type WorkerResourceWorkload = "dm" | "wiki" | "content";

export interface WorkerResourceLimits {
  total: number;
  dmReserved: number;
  nonDm: number;
}

export function resolveWorkerResourceLimits({
  total,
  dmReserved,
}: {
  total: number;
  dmReserved: number;
}): WorkerResourceLimits {
  if (!Number.isInteger(total) || total < 1 || !Number.isInteger(dmReserved) || dmReserved < 1 || dmReserved >= total) {
    throw new Error("worker_resource_limits_invalid");
  }
  return { total, dmReserved, nonDm: total - dmReserved };
}

export function canAcquireWorkerResource({
  workload,
  activeTotal,
  activeNonDm,
  limits,
}: {
  workload: WorkerResourceWorkload;
  activeTotal: number;
  activeNonDm: number;
  limits: WorkerResourceLimits;
}) {
  return activeTotal < limits.total && (workload === "dm" || activeNonDm < limits.nonDm);
}
