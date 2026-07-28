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
        `/brands/${brandId}/ai-content/proposal-batches`,
        {
          method: "POST",
          body: JSON.stringify({
            idempotencyKey: `performance-${experiment.id}-${experiment.performanceSnapshotIds[0] ?? "none"}-${experiment.performanceSnapshotIds.length}`,
            request: {
              contractVersion: "content-proposal-request.v1",
              contentFamily: experiment.contentFamily,
              subjectInput: {
                topic: experiment.title,
                hypothesis: experiment.hypothesis,
                source: "performance_experiment",
              },
              channelTargets: experiment.channelTargets,
              outputFormats: experiment.outputFormats,
              sourceSnapshotIds: [],
              performanceSnapshotIds: experiment.performanceSnapshotIds,
            },
          }),
        },
      );
    },
  };
}

export const performanceGateway = createPerformanceGateway();
