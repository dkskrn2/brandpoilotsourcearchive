import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { ButtonLink } from "../components/ui/ButtonLink";
import { ChecklistItem } from "../components/ui/ChecklistItem";
import { useBrandStatus } from "../lib/brandStatus";
import type { BadgeVariant, OnboardingStatus } from "../types";

const statusMeta: Record<OnboardingStatus, { marker: string; label: string; variant: BadgeVariant }> = {
  completed: { marker: "✓", label: "완료", variant: "ok" },
  needs_attention: { marker: "!", label: "필요", variant: "warn" },
  pending: { marker: "·", label: "대기", variant: "neutral" }
};

function pageTitle(remainingCount: number) {
  return remainingCount > 0
    ? `게시 자동화를 시작하려면 ${remainingCount}개만 해결하세요`
    : "게시 자동화 준비가 완료됐습니다";
}

export function OnboardingPage() {
  const { status, loading, error } = useBrandStatus();
  const onboarding = status?.onboarding;

  return (
    <section className="content">
      <PageHeader
        title={pageTitle(onboarding?.remainingCount ?? 0)}
        description={onboarding
          ? `${onboarding.completedCount}개 항목이 완료됐고 ${onboarding.remainingCount}개 항목이 남았습니다.`
          : "API 상태를 불러오면 필요한 온보딩 항목을 표시합니다."}
        actions={
          <>
            <ButtonLink to="/brand-settings" variant="primary">브랜드 설정</ButtonLink>
            <ButtonLink to="/sources">URL 추가</ButtonLink>
          </>
        }
      />

      <section className="panel">
        <div className="panel-head">
          <h2>온보딩 체크리스트</h2>
          {onboarding ? (
            <Badge variant="info">{onboarding.completedCount} / {onboarding.totalCount} 완료</Badge>
          ) : (
            <Badge variant={error ? "bad" : "info"}>{loading ? "불러오는 중" : "API 확인 필요"}</Badge>
          )}
        </div>
        {onboarding ? (
          <ul className="panel-body checklist" aria-label="온보딩 체크리스트">
            {onboarding.steps.map((step) => {
              const statusInfo = statusMeta[step.status];
              return (
                  <ChecklistItem
                    key={step.id}
                    marker={statusInfo.marker}
                    title={step.title}
                    description={step.description}
                    actionLabel={step.actionLabel}
                    completed={step.status === "completed"}
                    to={step.path}
                    statusLabel={statusInfo.label}
                    statusVariant={statusInfo.variant}
                />
              );
            })}
          </ul>
        ) : (
          <div className="panel-body grid">
            <Alert title={error ? "API 상태 확인 필요" : "온보딩 상태 불러오는 중"} variant={error ? "bad" : "info"}>
              {error ? "API 서버가 응답하지 않아 온보딩 상태를 표시할 수 없습니다." : "브랜드 설정과 채널 연결 상태를 확인하고 있습니다."}
            </Alert>
          </div>
        )}
      </section>
    </section>
  );
}
