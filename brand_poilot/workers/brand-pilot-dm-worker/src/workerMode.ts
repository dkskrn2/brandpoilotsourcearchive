export type DmWorkerMode = "dm" | "wiki" | "faq";

export function resolveWorkerMode(commandLineMode?: string, environmentMode?: string): DmWorkerMode {
  const mode = commandLineMode?.trim() || environmentMode?.trim() || "dm";
  if (mode !== "dm" && mode !== "wiki" && mode !== "faq") throw new Error("worker_mode_invalid");
  return mode;
}

export function selectWorkerLane(
  mode: DmWorkerMode,
  lanes: Record<DmWorkerMode, () => Promise<{ status: string }>>,
): () => Promise<{ status: string }> {
  return lanes[mode];
}

export function usesDmWorkerHeartbeat(mode: DmWorkerMode): boolean {
  return mode !== "faq";
}
