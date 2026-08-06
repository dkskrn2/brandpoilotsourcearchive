import { apiClient } from "../../lib/apiClient";
import type { PerformanceExperiment, PerformanceInsights, PublishArtifact } from "../../types";

type Client = ReturnType<typeof apiClient>;

export function createPerformanceGateway(client: Client = apiClient()) {
  return {
    getInsights(brandId: string) {
      return client.requestJson<PerformanceInsights>(
        `/brands/${brandId}/performance/insights?period=30d`,
        { method: "GET" },
      );
    },
    getArtifact(queueId: string) {
      return client.requestJson<PublishArtifact>(`/publish-queue/${queueId}/artifacts`, { method: "GET" });
    },
    createProposalBatch(brandId: string, experiment: PerformanceExperiment) {
      return client.requestJson<{ batchId: string; status: string }>(
        `/brands/${brandId}/performance-experiments/proposal-batches`,
        {
          method: "POST",
          body: JSON.stringify({
            experimentId: experiment.id,
            evidenceVersion: experiment.evidenceVersion,
          }),
        },
      );
    },
  };
}

export const performanceGateway = createPerformanceGateway();
