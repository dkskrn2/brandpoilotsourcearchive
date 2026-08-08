export type JobLeaseState = "active" | "lease_lost" | "cancelled";

export interface JobLeaseGuard {
  readonly signal: AbortSignal;
  state(): Promise<JobLeaseState>;
  finish(): Promise<JobLeaseState>;
}

export function startJobLeaseGuard(input: {
  heartbeat(): Promise<void>;
  shutdownSignal?: AbortSignal;
  intervalMs?: number;
}): JobLeaseGuard {
  const controller = new AbortController();
  let currentState: JobLeaseState = "active";
  let stopped = false;
  let pending: Promise<void> | null = null;

  const cancel = (state: Exclude<JobLeaseState, "active">, reason: Error) => {
    if (currentState !== "active") return;
    currentState = state;
    controller.abort(reason);
  };
  const onShutdown = () => cancel("cancelled", new Error("ai_content_worker_shutdown"));
  if (input.shutdownSignal?.aborted) onShutdown();
  else input.shutdownSignal?.addEventListener("abort", onShutdown, { once: true });

  const pulse = () => {
    if (stopped || currentState !== "active" || pending) return;
    const running = Promise.resolve()
      .then(() => input.heartbeat())
      .catch((error: unknown) => {
        cancel("lease_lost", new Error("ai_content_job_lease_lost", { cause: error }));
      })
      .finally(() => {
        if (pending === running) pending = null;
      });
    pending = running;
  };
  const timer = setInterval(pulse, input.intervalMs ?? 30_000);

  const state = async () => {
    await pending;
    return currentState;
  };
  const finish = async () => {
    if (!stopped) {
      stopped = true;
      clearInterval(timer);
      input.shutdownSignal?.removeEventListener("abort", onShutdown);
    }
    return state();
  };
  return { signal: controller.signal, state, finish };
}
