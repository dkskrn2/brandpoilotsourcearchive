import { describe, expect, it, vi } from "vitest";
import {
  parseCreateAiContentAnalysisInput,
  parseUpdateAiContentDraftInput,
} from "./aiContentContracts.js";
import { createAiContentRepository } from "./aiContentRepository.js";
import { parseContentOrchestrationV1 } from "./contentOrchestration.js";
import { asCreatableSupportRequestCategory } from "./httpServer.js";
import { createRepository } from "./repository.js";

const generationScope = {
  workspaceId: "workspace-1",
  brandId: "brand-1",
  generationId: "generation-legacy",
};

function legacyGenerationRow() {
  return {
    id: "generation-legacy",
    workspace_id: "workspace-1",
    brand_id: "brand-1",
    type: "card_news",
    title: "과거 생성",
    status: "completed",
    current_stage: null,
    draft_json: {
      productUrl: "https://example.com/legacy",
      coreAppeal: { id: "appeal-legacy", title: "기존 소구점" },
      personAttachmentId: "attachment-legacy",
    },
    analysis_json: {},
    generation_idempotency_key: null,
    generation_input_snapshot: null,
    subject_analysis_snapshot: null,
    orchestration_snapshot: {},
    avatar_snapshot: {},
    attachments_locked_at: null,
    terminal_at: null,
    retryable_until: null,
    error_code: null,
    error_message: null,
    created_at: "2026-07-18T00:00:00.000Z",
    updated_at: "2026-07-18T00:00:00.000Z",
    completed_at: "2026-07-18T00:01:00.000Z",
  };
}

function orchestration(outputFormat: unknown) {
  return {
    contractVersion: "content-orchestration.v1",
    contentFamily: "informational",
    subject: { mode: "brand_topic", topic: "여름" },
    target: { id: null, snapshot: {} },
    strategy: "how_to",
    outputFormat,
    channelTargets: ["instagram"],
    brief: {},
    references: [],
    avatar: null,
  };
}

describe("legacy data compatibility", () => {
  it("reads a legacy draft and Reel result without exposing mutation capabilities", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from ai_content_generation_outputs")) {
        return {
          rowCount: 1,
          rows: [{
            id: "output-reel",
            generation_id: "generation-legacy",
            output_index: 1,
            title: "과거 Reel",
            status: "completed",
            content_json: { caption: "과거 캡션" },
            artifact_manifest_json: { deliveryFormat: "instagram_reel", outputFormat: "reel", assets: [] },
            manifest_url: "https://cdn.example.com/reel/manifest.json",
            failure_code: null,
            failure_message: null,
            downloaded_at: null,
            created_at: "2026-07-18T00:00:00.000Z",
            updated_at: "2026-07-18T00:01:00.000Z",
            completed_at: "2026-07-18T00:01:00.000Z",
          }],
        };
      }
      if (sql.includes("from ai_content_generation_references")) return { rowCount: 0, rows: [] };
      return { rowCount: 1, rows: [legacyGenerationRow()] };
    });
    const repository = createAiContentRepository({ query } as never);

    const generation = await repository.getAiContentGeneration(generationScope);

    expect(generation?.draft).toMatchObject({
      productUrl: "https://example.com/legacy",
      coreAppeal: { id: "appeal-legacy" },
      personAttachmentId: "attachment-legacy",
    });
    expect(generation?.outputs).toEqual([
      expect.objectContaining({
        title: "과거 Reel",
        legacyReadOnly: true,
        revisionCapabilities: [],
      }),
    ]);
  });

  it("reads the latest historical publish attempt", async () => {
    const query = vi.fn(async (_sql: string) => ({
      rowCount: 1,
      rows: [{
        content_id: "master-legacy",
        content_title: "과거 게시물",
        generated_at: new Date("2026-07-08T01:00:00.000Z"),
        queue_id: "queue-legacy",
        channel_output_id: "output-legacy",
        channel: "instagram",
        status: "failed",
        published_at: null,
        failed_at: new Date("2026-07-08T02:31:00.000Z"),
        channel_title: "과거 채널 결과",
        preview_title: "과거 제목",
        preview_body: "과거 본문",
        output_json: { caption: "과거 본문" },
        artifact_public_url: null,
        external_post_id: "legacy-post-id",
        external_url: "https://instagram.com/p/legacy",
        attempt_error_message: "legacy provider error",
        last_error: "publish failed",
        source_summary: null,
        topic_title: null,
        topic_angle: null,
        reference_url: null,
        source_urls: [],
      }],
    }));
    const repository = createRepository({ query } as never);

    const results = await repository.listPublishResults("brand-1");

    expect(String(query.mock.calls[0]?.[0])).toContain("from publish_attempts");
    expect(results[0]?.channels[0]).toMatchObject({
      queueId: "queue-legacy",
      status: "failed",
      externalPostId: "legacy-post-id",
      externalUrl: "https://instagram.com/p/legacy",
      lastError: "legacy provider error",
    });
  });

  it("reads legacy feature support rows and accepts feature for new requests", async () => {
    const query = vi.fn(async () => ({
      rowCount: 1,
      rows: [{
        id: "support-feature",
        brand_id: "brand-1",
        workspace_id: "workspace-1",
        category: "feature",
        title: "과거 기능 제안",
        message: "기존 문의",
        contact_phone: "010-1234-5678",
        contact_email: null,
        status: "resolved",
        response_message: "피드백으로 이전했습니다.",
        responded_at: "2026-07-12T01:00:00.000Z",
        created_at: "2026-07-12T00:00:00.000Z",
        updated_at: "2026-07-12T01:00:00.000Z",
      }],
    }));
    const repository = createRepository({ query } as never);

    await expect(repository.listSupportRequests("brand-1")).resolves.toEqual([
      expect.objectContaining({ id: "support-feature", category: "feature" }),
    ]);
    expect(asCreatableSupportRequestCategory("feature")).toBe("feature");
    expect(asCreatableSupportRequestCategory("bug")).toBe("bug");
  });

  it.each(["video", "reel", "shorts", "tiktok_video", "video_story"])(
    "rejects unsupported %s generation in create and update contracts",
    (outputFormat) => {
      expect(() => parseContentOrchestrationV1(orchestration(outputFormat)))
        .toThrow("content_orchestration_combination_invalid");
      expect(() => parseCreateAiContentAnalysisInput({
        type: "marketing",
        title: "unsupported",
        draft: {},
        orchestration: orchestration(outputFormat),
        idempotencyKey: "legacy-exclusion-create",
      })).toThrow();
      expect(() => parseUpdateAiContentDraftInput({
        draft: {},
        referenceIds: [],
        orchestration: orchestration(outputFormat),
      })).toThrow();
    },
  );

  it("keeps static Instagram Story outside the video exclusion contract", () => {
    const parsed = parseContentOrchestrationV1({
      ...orchestration("card_news"),
      brief: { aspectRatio: "9:16", deliveryFormat: "instagram_story" },
    });

    expect(parsed.outputFormat).toBe("card_news");
    expect(parsed.brief).toMatchObject({
      aspectRatio: "9:16",
      deliveryFormat: "instagram_story",
    });
  });
});
