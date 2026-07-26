import type { AiContentUsage } from "../ai-content/types";
import type {
  BrandUiStatus,
  Dashboard,
  DashboardKpi,
  DashboardPriority,
} from "../../types";

export interface DashboardViewModelInput {
  dashboard: Dashboard;
  brandStatus: BrandUiStatus | null;
  usage: AiContentUsage | null;
}

export interface DashboardViewModel {
  kpis: DashboardKpi[];
  priorities: DashboardPriority[];
  usage: AiContentUsage | null;
  performance: {
    lastCollectedAt: string | null;
    dailyExposure: Dashboard["dailyExposure"];
    channelPerformance: Dashboard["channelPerformance"];
    topContents: Dashboard["topContents"];
    attentionItems: Dashboard["attentionItems"];
  };
}

const priorityRank: Record<DashboardPriority["kind"], number> = {
  publish_failure: 0,
  brand_review: 1,
  channel_attention: 2,
  content_review: 3,
  dm_attention: 4,
};

export function createDashboardViewModel({
  dashboard,
  brandStatus,
  usage,
}: DashboardViewModelInput): DashboardViewModel {
  const kpis: DashboardKpi[] = [
    {
      label: "발행 완료",
      value: dashboard.summary.publishedCount,
      unit: "건",
      description: "최근 30일 동안 발행된 콘텐츠",
    },
    {
      label: "조회·노출",
      value: dashboard.summary.exposureCount,
      unit: "회",
      description: "연결된 채널에서 수집된 조회·노출",
    },
    {
      label: "검토 필요",
      value: dashboard.summary.pendingReviewCount,
      unit: "건",
      description: "확인 후 게시할 수 있는 콘텐츠",
    },
    {
      label: "게시 실패",
      value: dashboard.summary.failedPublishCount,
      unit: "건",
      description: "조치가 필요한 게시 작업",
      tone: dashboard.summary.failedPublishCount > 0 ? "danger" : undefined,
    },
  ];

  const priorities: DashboardPriority[] = [];
  if (dashboard.summary.failedPublishCount > 0) {
    priorities.push({
      kind: "publish_failure",
      severity: "critical",
      count: dashboard.summary.failedPublishCount,
      title: "게시 실패 확인",
      description: "실패 원인을 확인하고 다시 게시해 주세요.",
      href: "/publish-queue?status=failed",
      actionLabel: "실패 확인",
    });
  }
  if (brandStatus && brandStatus.navigation.onboardingRemaining > 0) {
    priorities.push({
      kind: "brand_review",
      severity: "warning",
      count: brandStatus.navigation.onboardingRemaining,
      title: "브랜드 정보 검토",
      description: "AI가 정리한 브랜드 정보를 확인해 주세요.",
      href: "/brand-settings",
      actionLabel: "브랜드 검토",
    });
  }
  if (brandStatus && brandStatus.navigation.channelIssues > 0) {
    priorities.push({
      kind: "channel_attention",
      severity: "warning",
      count: brandStatus.navigation.channelIssues,
      title: "채널 연결 확인",
      description: "연결 또는 권한 확인이 필요한 채널이 있습니다.",
      href: "/channels",
      actionLabel: "채널 확인",
    });
  }
  if (dashboard.summary.pendingReviewCount > 0) {
    priorities.push({
      kind: "content_review",
      severity: "info",
      count: dashboard.summary.pendingReviewCount,
      title: "생성 결과 검토",
      description: "생성된 콘텐츠를 확인하고 다음 작업을 진행해 주세요.",
      href: "/ai-content",
      actionLabel: "결과 검토",
    });
  }

  priorities.sort((left, right) => priorityRank[left.kind] - priorityRank[right.kind]);

  return {
    kpis,
    priorities,
    usage,
    performance: {
      lastCollectedAt: dashboard.lastCollectedAt,
      dailyExposure: dashboard.dailyExposure,
      channelPerformance: dashboard.channelPerformance,
      topContents: dashboard.topContents,
      attentionItems: dashboard.attentionItems,
    },
  };
}
