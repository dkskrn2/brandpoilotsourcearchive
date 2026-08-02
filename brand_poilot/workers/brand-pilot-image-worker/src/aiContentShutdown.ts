export type AiContentWorkerExitSignal = "SIGTERM" | "SIGINT";

export function createAiContentShutdownCoordinator(input: {
  graceMs: number;
  relaySignal(signal: AiContentWorkerExitSignal): void;
  setGraceTimer(callback: () => void, delayMs: number): unknown;
  clearGraceTimer(timer: unknown): void;
}) {
  const shutdown = new AbortController();
  let aiContentActive = false;
  let handledSignal: AiContentWorkerExitSignal | undefined;
  let graceTimer: unknown;
  let relayed = false;

  const relay = (signal: AiContentWorkerExitSignal) => {
    if (relayed) return;
    relayed = true;
    if (graceTimer !== undefined) {
      input.clearGraceTimer(graceTimer);
      graceTimer = undefined;
    }
    input.relaySignal(signal);
  };

  return {
    signal: shutdown.signal,
    onAiContentActivityChange(active: boolean) {
      aiContentActive = active;
    },
    handleSignal(signal: AiContentWorkerExitSignal) {
      if (relayed) return;
      if (handledSignal) {
        relay(signal);
        return;
      }
      handledSignal = signal;
      if (!aiContentActive) {
        relay(signal);
        return;
      }
      shutdown.abort(new Error("image_worker_shutdown"));
      graceTimer = input.setGraceTimer(() => {
        graceTimer = undefined;
        relay(signal);
      }, input.graceMs);
    },
    dispose() {
      if (graceTimer === undefined) return;
      input.clearGraceTimer(graceTimer);
      graceTimer = undefined;
    },
  };
}
