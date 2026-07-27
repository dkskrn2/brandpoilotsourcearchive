import { describe, expect, it } from "vitest";
import type { ChannelCapability, ChannelConnection } from "../../types";
import { channelCapabilityViewModel } from "./channelCapabilityViewModel";

const connectedInstagram: ChannelConnection = {
  type: "instagram",
  label: "Instagram",
  enabled: true,
  oauthState: "connected",
  status: "connected",
  accountLabel: "@mosong",
  lastHealthyAt: "2026-07-27T00:00:00.000Z",
  lastPublishedAt: "-",
};

function capability(overrides: Partial<ChannelCapability> = {}): ChannelCapability {
  return {
    channel: "instagram",
    catalogStatus: "available",
    connectionStatus: "connected",
    canGenerate: true,
    generationFormats: ["card_news", "single_image"],
    exportModes: ["image", "html"],
    publishModes: ["instagram_feed_carousel", "instagram_story"],
    readiness: "ready",
    reasonCode: null,
    ...overrides,
  };
}

describe("channelCapabilityViewModel", () => {
  it("keeps connection, generation, export, and API publishing as independent rows", () => {
    const view = channelCapabilityViewModel(capability(), connectedInstagram);

    expect(view.rows.map((row) => row.label)).toEqual([
      "계정 연결",
      "콘텐츠 생성/변환",
      "파일·텍스트 내보내기",
      "API 실제 게시",
    ]);
    expect(view.rows.map((row) => row.state)).toEqual([
      "연결됨",
      "가능",
      "가능",
      "게시 가능",
    ]);
    expect(view.rows[3].detail).toContain("Instagram 피드");
    expect(view.rows[3].detail).toContain("정적 Story");
    expect(view.repairAction).toEqual({ kind: "oauth", label: "Meta 다시 연결" });
  });

  it.each([
    ["mapping_required", "professional_account_required", "전문 계정 매핑 필요"],
    ["insufficient_permissions", "missing_required_scopes", "게시 권한 승인 필요"],
    ["expired", "credential_expired", "인증 만료"],
    ["needs_attention", "meta_token_invalid", "인증 정보 확인 필요"],
  ] as const)("shows an actionable Instagram repair reason for %s", (
    connectionStatus,
    reasonCode,
    expected,
  ) => {
    const view = channelCapabilityViewModel(capability({
      connectionStatus,
      readiness: "needs_permission",
      reasonCode,
      publishModes: [],
    }), { ...connectedInstagram, status: connectionStatus });

    expect(view.rows[0].state).toBe(expected);
    expect(view.rows[3].state).toBe("게시 불가");
    expect(view.repairAction).toEqual({ kind: "oauth", label: "Meta 다시 연결" });
  });

  it("never presents a planned provider as connected or publishable", () => {
    const view = channelCapabilityViewModel(capability({
      channel: "x",
      catalogStatus: "planned",
      connectionStatus: "connected",
      generationFormats: ["channel_text"],
      exportModes: ["text"],
      publishModes: ["x_post"],
      readiness: "ready",
    }), {
      ...connectedInstagram,
      type: "x",
      label: "X",
    });

    expect(view.rows[0].state).toBe("연결 준비 중");
    expect(view.rows[3].state).toBe("지원 준비 중");
    expect(view.repairAction).toEqual({ kind: "guide", label: "연결 안내 보기" });
  });

  it("explains why video-only generation is outside the current scope", () => {
    const view = channelCapabilityViewModel(capability({
      channel: "youtube",
      catalogStatus: "planned",
      connectionStatus: "not_connected",
      canGenerate: false,
      generationFormats: [],
      exportModes: [],
      publishModes: [],
      readiness: "not_supported",
      reasonCode: "video_generation_out_of_scope",
    }), null);

    expect(view.rows[1]).toMatchObject({
      state: "생성 불가",
      detail: "현재 영상 콘텐츠 생성은 제공하지 않습니다.",
    });
  });
});
