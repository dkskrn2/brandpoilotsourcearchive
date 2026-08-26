import type { BadgeVariant, PublishOperationalStatus } from "../../types";

export type PublishStatusTone = "danger" | "info" | "warning" | "success" | "neutral";

export type PublishErrorAction =
  | "reconnect_channel"
  | "retry_publish"
  | "regenerate_content"
  | "inspect_result";

const statusPresentations: Record<PublishOperationalStatus, {
  label: string;
  tone: PublishStatusTone;
  variant: BadgeVariant;
  className: string;
}> = {
  action_required: { label: "처리 필요", tone: "danger", variant: "bad", className: "is-failed" },
  upcoming: { label: "게시 예정", tone: "info", variant: "info", className: "is-upcoming" },
  delayed_today: { label: "게시 지연", tone: "warning", variant: "warn", className: "is-delayed" },
  publishing: { label: "게시 중", tone: "info", variant: "info", className: "is-upcoming" },
  partially_published: { label: "일부 게시", tone: "warning", variant: "warn", className: "is-delayed" },
  published: { label: "게시 완료", tone: "success", variant: "ok", className: "is-completed" },
  cancelled: { label: "취소", tone: "neutral", variant: "neutral", className: "is-cancelled" },
};

const errorPresentations: Record<string, { message: string; action: PublishErrorAction }> = {
  oauth_required: { message: "Instagram 연결이 만료되었습니다.", action: "reconnect_channel" },
  instagram_publish_failed: { message: "Instagram 게시에 실패했습니다. 잠시 후 다시 시도해 주세요.", action: "inspect_result" },
  provider_not_implemented: { message: "이 채널은 아직 자동 게시를 지원하지 않습니다.", action: "retry_publish" },
  generation_failed: { message: "콘텐츠 생성에 실패했습니다.", action: "regenerate_content" },
  publish_delivery_unknown: { message: "게시 결과를 확인해야 합니다.", action: "inspect_result" },
};

const unknownErrorPresentation = {
  message: "게시 처리에 문제가 발생했습니다. 상세 로그를 확인해 주세요.",
  action: "inspect_result",
} as const;

export function publishStatusPresentation(status: PublishOperationalStatus) {
  return statusPresentations[status];
}

const contentStatusPresentations = {
  pre_generation: { label: "생성 전", variant: "neutral" },
  generating: { label: "생성 중", variant: "info" },
  completed: { label: "생성 완료", variant: "ok" },
  failed: { label: "생성 실패", variant: "bad" },
} as const;

export function publishContentStatusPresentation(status: keyof typeof contentStatusPresentations) {
  return contentStatusPresentations[status];
}

export function publishErrorPresentation(code: string | null | undefined) {
  return code ? errorPresentations[code] ?? unknownErrorPresentation : unknownErrorPresentation;
}
