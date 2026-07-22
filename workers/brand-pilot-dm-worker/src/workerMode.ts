export type DmWorkerMode = "dm" | "wiki";

export function resolveWorkerMode(commandLineMode?: string, environmentMode?: string): DmWorkerMode {
  const mode = commandLineMode?.trim() || environmentMode?.trim() || "dm";
  if (mode !== "dm" && mode !== "wiki") throw new Error("worker_mode_invalid");
  return mode;
}
