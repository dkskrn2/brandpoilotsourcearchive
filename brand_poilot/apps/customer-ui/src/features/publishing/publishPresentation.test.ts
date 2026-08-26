import { describe, expect, it } from "vitest";
import { publishErrorPresentation, publishStatusPresentation } from "./publishPresentation";

describe("publishStatusPresentation", () => {
  it.each([
    ["action_required", { label: "처리 필요", tone: "danger", variant: "bad", className: "is-failed" }],
    ["upcoming", { label: "게시 예정", tone: "info", variant: "info", className: "is-upcoming" }],
    ["delayed_today", { label: "게시 지연", tone: "warning", variant: "warn", className: "is-delayed" }],
    ["publishing", { label: "게시 중", tone: "info", variant: "info", className: "is-upcoming" }],
    ["partially_published", { label: "일부 게시", tone: "warning", variant: "warn", className: "is-delayed" }],
    ["published", { label: "게시 완료", tone: "success", variant: "ok", className: "is-completed" }],
    ["cancelled", { label: "취소", tone: "neutral", variant: "neutral", className: "is-cancelled" }],
  ] as const)("maps %s to one shared presentation", (status, expected) => {
    expect(publishStatusPresentation(status)).toMatchObject(expected);
  });
});

describe("publishErrorPresentation", () => {
  it.each([
    ["oauth_required", { message: "Instagram 연결이 만료되었습니다.", action: "reconnect_channel" }],
    ["instagram_publish_failed", { message: "Instagram 게시에 실패했습니다. 잠시 후 다시 시도해 주세요.", action: "inspect_result" }],
    ["provider_not_implemented", { message: "이 채널은 아직 자동 게시를 지원하지 않습니다.", action: "retry_publish" }],
    ["generation_failed", { message: "콘텐츠 생성에 실패했습니다.", action: "regenerate_content" }],
    ["publish_delivery_unknown", { message: "게시 결과를 확인해야 합니다.", action: "inspect_result" }],
  ] as const)("maps %s without exposing the internal code", (code, expected) => {
    expect(publishErrorPresentation(code)).toEqual(expected);
  });

  it("uses a safe inspect-result fallback for unknown errors", () => {
    expect(publishErrorPresentation("provider_detail_changed")).toEqual({
      message: "게시 처리에 문제가 발생했습니다. 상세 로그를 확인해 주세요.",
      action: "inspect_result",
    });
  });
});
