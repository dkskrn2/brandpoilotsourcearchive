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
  dmWorkersEnabled: boolean;
  activeDmEnabled: boolean;
  dmWorker: WorkerReadinessStatus;
  wikiWorker: WorkerReadinessStatus;
  contentProposalsEnabled: boolean;
  contentProposalWorker: WorkerReadinessStatus;
}

export function assessApiReadiness(input: ApiReadinessInput) {
  const dmRequired = input.dmWorkersEnabled && input.activeDmEnabled;
  const dmDependenciesReady = !dmRequired
    || (input.dmWorker === "online" && input.wikiWorker === "online");
  const contentProposalDependenciesReady = !input.contentProposalsEnabled
    || input.contentProposalWorker === "online";
  const ok = input.database === "ok"
    && dmDependenciesReady
    && contentProposalDependenciesReady;
  return {
    statusCode: ok ? 200 : 503,
    body: {
      ok,
      configuration: "ok" as const,
      database: input.database,
      features: {
        scheduler: input.schedulerEnabled ? "enabled" as const : "disabled" as const,
        publishing: input.publishingEnabled ? "enabled" as const : "disabled" as const,
        dm: dmRequired ? "enabled" as const : "disabled" as const,
        wiki: dmRequired ? "enabled" as const : "disabled" as const,
        contentProposals: input.contentProposalsEnabled ? "enabled" as const : "disabled" as const,
      },
      workers: {
        dm: dmRequired ? input.dmWorker : "not_required" as const,
        wiki: dmRequired ? input.wikiWorker : "not_required" as const,
        contentProposal: input.contentProposalsEnabled
          ? input.contentProposalWorker
          : "not_required" as const,
      },
    },
  };
}
