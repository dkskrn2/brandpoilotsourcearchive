import type { ClaimedDmProfileJob } from "./client.js";

export interface DmProfileWorkerClient {
  claimProfile(workerId: string): Promise<ClaimedDmProfileJob | null>;
  runProfile(jobId: string, workerId: string, leaseToken: string): Promise<unknown>;
  failProfile(jobId: string, workerId: string, leaseToken: string, error: string, retryable: boolean, retryAfterMs: number): Promise<unknown>;
}

export async function runProfileRefreshOnce({ workerId, api }: {
  workerId: string;
  api: DmProfileWorkerClient;
}) {
  const job = await api.claimProfile(workerId);
  if (!job) return { status: "idle" as const };
  try {
    await api.runProfile(job.id, workerId, job.leaseToken);
    return { status: "completed" as const, jobId: job.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : "dm_profile_refresh_failed";
    const retryable = error instanceof TypeError || /timeout|worker_api_failed:5\d\d/.test(message);
    await api.failProfile(job.id, workerId, job.leaseToken, message, retryable, retryable ? 5000 : 0);
    return { status: "failed" as const, jobId: job.id, error: message };
  }
}
