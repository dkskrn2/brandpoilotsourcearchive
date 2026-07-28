export function startWorkerInstanceHeartbeat({
  heartbeat,
  workerId,
  intervalMs,
  onError = (error) => console.error("content_proposal_worker_heartbeat_failed", error),
}: {
  heartbeat: (workerId: string) => Promise<unknown>;
  workerId: string;
  intervalMs: number;
  onError?: (error: unknown) => void;
}): () => void {
  const send = () => {
    void heartbeat(workerId).catch(onError);
  };
  send();
  const timer = setInterval(send, Math.max(1_000, intervalMs));
  timer.unref?.();
  return () => clearInterval(timer);
}
