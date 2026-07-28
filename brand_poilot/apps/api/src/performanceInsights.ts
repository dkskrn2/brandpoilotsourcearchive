import type { Channel, PerformanceInsightsDto } from "./types.js";

export type PerformanceWindow = "24h" | "72h" | "7d";

export interface PerformanceInsightSnapshot {
  id: string;
  brandId: string;
  publishQueueId: string;
  title: string;
  channel: Channel;
  deliveryFormat: string | null;
  measurementWindow: PerformanceWindow;
  exposureCount: number | null;
  rawMetrics: Record<string, unknown>;
  contentFeatures: Record<string, unknown>;
  collectedAt: string;
  externalUrl?: string | null;
}

const performanceWindows: readonly PerformanceWindow[] = ["24h", "72h", "7d"];
const minimumSampleSize = 3;

export function buildPerformanceInsights(input: {
  brandId: string;
  period: "30d";
  snapshots: PerformanceInsightSnapshot[];
}): PerformanceInsightsDto {
  if (input.snapshots.some((snapshot) => snapshot.brandId !== input.brandId)) {
    throw new Error("performance_snapshot_tenant_mismatch");
  }
  const measured = input.snapshots.filter(
    (snapshot) => snapshot.exposureCount !== null && Number.isFinite(snapshot.exposureCount),
  );
  const latestByQueue = new Map<string, PerformanceInsightSnapshot>();
  for (const snapshot of measured) {
    const current = latestByQueue.get(snapshot.publishQueueId);
    if (!current || Date.parse(snapshot.collectedAt) > Date.parse(current.collectedAt)) {
      latestByQueue.set(snapshot.publishQueueId, snapshot);
    }
  }
  const sampleSize = measured.length;
  const dataStatus = latestByQueue.size >= minimumSampleSize ? "sufficient" : "insufficient";
  const exposureValues = measured.map((snapshot) => snapshot.exposureCount as number);
  const averageExposure = exposureValues.length
    ? Math.round(exposureValues.reduce((sum, value) => sum + value, 0) / exposureValues.length)
    : null;

  const windows = performanceWindows.map((window) => {
    const rows = measured.filter((snapshot) => snapshot.measurementWindow === window);
    return {
      window,
      sampleSize: rows.length,
      averageExposure: rows.length
        ? Math.round(rows.reduce((sum, row) => sum + (row.exposureCount as number), 0) / rows.length)
        : null,
    };
  });
  const evidenceSnapshotIds = measured.map((snapshot) => snapshot.id);
  const strongestWindow = windows
    .filter((window) => window.averageExposure !== null)
    .sort((left, right) => (right.averageExposure ?? 0) - (left.averageExposure ?? 0))[0] ?? null;
  const observations: PerformanceInsightsDto["observations"] = sampleSize === 0 ? [] : [{
    id: "average-exposure",
    kind: "observation",
    label: "수집된 콘텐츠의 평균 노출",
    metric: {
      name: "평균 노출",
      value: averageExposure,
      unit: "회",
      sampleSize,
    },
    evidenceSnapshotIds,
    interpretation: dataStatus === "sufficient" && strongestWindow ? {
      kind: "interpretation",
      statement: `${strongestWindow.window} 관측 구간에서 평균 노출이 가장 높았습니다.`,
      confidence: sampleSize >= 7 ? "high" : "medium",
    } : null,
  }];
  if (dataStatus === "sufficient") {
    for (const dimension of ["strategy", "format", "hook", "appeal"] as const) {
      const groups = new Map<string, { total: number; ids: string[] }>();
      for (const snapshot of measured) {
        const raw = snapshot.contentFeatures[dimension];
        if (typeof raw !== "string" || !raw.trim()) continue;
        const group = groups.get(raw) ?? { total: 0, ids: [] };
        group.total += snapshot.exposureCount as number;
        group.ids.push(snapshot.id);
        groups.set(raw, group);
      }
      if (groups.size < 2) continue;
      const ranked = [...groups.entries()]
        .map(([value, group]) => ({
          value,
          average: Math.round(group.total / group.ids.length),
          ids: group.ids,
        }))
        .sort((left, right) => right.average - left.average);
      const winner = ranked[0];
      observations.push({
        id: `${dimension}-comparison`,
        kind: "observation",
        label: `${dimension}별 평균 노출`,
        metric: {
          name: `${dimension} 최고 평균 노출`,
          value: winner.average,
          unit: "회",
          sampleSize: winner.ids.length,
        },
        evidenceSnapshotIds: ranked.flatMap((group) => group.ids),
        interpretation: {
          kind: "interpretation",
          statement: `${winner.value} 항목의 평균 노출이 비교군 중 가장 높았습니다.`,
          confidence: sampleSize >= 7 ? "high" : "medium",
        },
      });
    }
  }
  const experiments: PerformanceInsightsDto["experiments"] = dataStatus === "sufficient" ? [{
    id: "reuse-performing-pattern",
    kind: "experiment",
    title: "성과 패턴을 활용한 다음 구성안",
    hypothesis: "관측된 메시지 구조를 새 주제에 적용하면 초기 노출을 개선할 수 있습니다.",
    contentFamily: "informational",
    channelTargets: ["instagram"],
    outputFormats: ["card_news"],
    performanceSnapshotIds: evidenceSnapshotIds,
  }] : [];

  const topContents = [...latestByQueue.values()]
    .sort((left, right) => (right.exposureCount ?? 0) - (left.exposureCount ?? 0))
    .slice(0, 10)
    .map((snapshot) => ({
      publishQueueId: snapshot.publishQueueId,
      title: snapshot.title,
      channel: snapshot.channel,
      deliveryFormat: snapshot.deliveryFormat,
      exposureCount: snapshot.exposureCount,
      snapshotId: snapshot.id,
      externalUrl: snapshot.externalUrl ?? null,
    }));

  return {
    period: input.period,
    summary: {
      dataStatus,
      measuredContentCount: latestByQueue.size,
      totalExposure: latestByQueue.size
        ? [...latestByQueue.values()].reduce((sum, snapshot) => sum + (snapshot.exposureCount as number), 0)
        : null,
    },
    windows,
    observations,
    experiments,
    sampleSize,
    lastCollectedAt: measured.map((snapshot) => snapshot.collectedAt).sort().at(-1) ?? null,
    topContents,
  };
}
