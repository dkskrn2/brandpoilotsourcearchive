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
    enabled: true,
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

  it("labels the V2 reel and marketing content generation formats", () => {
    const view = channelCapabilityViewModel(capability({
      generationFormats: ["reel", "marketing_content"],
    }), connectedInstagram);

    expect(view.rows[1].detail).toBe("릴스(세로 이미지), 마케팅 콘텐츠");
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
    expect(view.accountLabel).toBe("연결 준비 중");
    expect(view.rows[0].detail).toBe("연결 준비 중");
    expect(view.rows[0].detail).not.toContain("@mosong");
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

  it("keeps Threads generation and export available while naming its missing API publisher", () => {
    const view = channelCapabilityViewModel(capability({
      channel: "threads",
      catalogStatus: "available",
      connectionStatus: "not_connected",
      canGenerate: true,
      generationFormats: ["channel_text"],
      exportModes: ["text"],
      publishModes: [],
      readiness: "not_supported",
      reasonCode: "provider_not_implemented",
    }), null);

    expect(view.rows[0].state).toBe("미연결");
    expect(view.rows[1]).toMatchObject({ state: "가능", detail: "채널 텍스트" });
    expect(view.rows[2]).toMatchObject({ state: "가능", detail: "텍스트" });
    expect(view.rows[3]).toMatchObject({
      state: "게시 미지원",
      detail: "Threads API 자동 게시는 아직 구현되지 않았습니다.",
    });
  });

  it("keeps a connected Instagram account connected when publishing is disabled by service settings", () => {
    const view = channelCapabilityViewModel(capability({
      publishModes: [],
      readiness: "not_supported",
      reasonCode: "publishing_disabled",
    }), connectedInstagram);

    expect(view.rows[0].state).toBe("연결됨");
    expect(view.rows[3]).toMatchObject({
      state: "게시 중지됨",
      detail: "서비스 운영 설정에서 Instagram API 게시가 비활성화되어 있습니다.",
    });
    expect(view.repairAction).toEqual({ kind: "guide", label: "게시 설정 안내" });
  });

  it("names an unsupported credential provider instead of a generic permission problem", () => {
    const view = channelCapabilityViewModel(capability({
      connectionStatus: "needs_attention",
      publishModes: [],
      readiness: "needs_permission",
      reasonCode: "provider_not_supported",
    }), { ...connectedInstagram, status: "needs_attention" });

    expect(view.rows[0].state).toBe("지원되지 않는 인증 제공자");
    expect(view.rows[3].detail).toBe("현재 연결된 인증 제공자는 Instagram 게시에 사용할 수 없습니다.");
    expect(view.repairAction).toEqual({ kind: "oauth", label: "Meta 다시 연결" });
  });
});
