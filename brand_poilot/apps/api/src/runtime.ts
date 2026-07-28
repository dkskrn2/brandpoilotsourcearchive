export function resolveServerHost({
  host = process.env.HOST,
  vercel = process.env.VERCEL
}: {
  host?: string;
  vercel?: string;
} = {}) {
  return host ?? (vercel ? "0.0.0.0" : "127.0.0.1");
}

export type WorkerReadinessStatus = "online" | "stale" | "offline";

export interface ApiReadinessInput {
  database: "ok" | "error";
  schedulerEnabled: boolean;
  publishingEnabled: boolean;
  activeDmEnabled: boolean;
  dmWorker: WorkerReadinessStatus;
  wikiWorker: WorkerReadinessStatus;
}

export function assessApiReadiness(input: ApiReadinessInput) {
  const dmDependenciesReady = !input.activeDmEnabled
    || (input.dmWorker === "online" && input.wikiWorker === "online");
  const ok = input.database === "ok" && dmDependenciesReady;
  return {
    statusCode: ok ? 200 : 503,
    body: {
      ok,
      configuration: "ok" as const,
      database: input.database,
      features: {
        scheduler: input.schedulerEnabled ? "enabled" as const : "disabled" as const,
        publishing: input.publishingEnabled ? "enabled" as const : "disabled" as const,
        dm: input.activeDmEnabled ? "enabled" as const : "disabled" as const,
        wiki: input.activeDmEnabled ? "enabled" as const : "disabled" as const,
      },
      workers: {
        dm: input.activeDmEnabled ? input.dmWorker : "not_required" as const,
        wiki: input.activeDmEnabled ? input.wikiWorker : "not_required" as const,
      },
    },
  };
}
