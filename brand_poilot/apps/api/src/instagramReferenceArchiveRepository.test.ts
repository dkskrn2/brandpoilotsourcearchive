import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { createInstagramReferenceArchiveRepository } from "./instagramReferenceArchiveRepository.js";

const scope = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000001",
  actorUserId: "30000000-0000-4000-8000-000000000001",
};

describe("instagram reference archive repository", () => {
  it("returns tenant-scoped cached channel media with saved state and provenance", async () => {
    const query = vi.fn(async (sql: string, values?: unknown[]) => {
      expect(values).toEqual([scope.workspaceId, scope.brandId, "channel-1"]);
      expect(sql).toContain("relation.workspace_id=$1");
      expect(sql).toContain("saved.trend_media_id=media.id");
      return {
        rowCount: 1,
        rows: [{
          id: "media-1",
          instagram_media_id: "ig-media-1",
          username: "target.brand",
          caption: "인기 콘텐츠",
          media_type: "VIDEO",
          media_url: "https://cdn.example/media.mp4",
          permalink: "https://www.instagram.com/reel/shortcode/",
          posted_at: "2026-08-12T00:00:00.000Z",
          like_count: 120,
          comments_count: 8,
          last_fetched_at: "2026-08-13T03:00:00.000Z",
          view_count: 1000,
          reference_brand_id: "channel-1",
          handle: "target.brand",
          display_name: "target.brand",
          refreshed_at: "2026-08-13T03:00:00.000Z",
          refresh_status: "fresh",
          is_saved: true,
          total_count: 1,
        }],
      };
    });
    const repository = createInstagramReferenceArchiveRepository({
      pool: { query } as unknown as Pool,
      decryptCredential: String,
      fetchBusinessDiscovery: vi.fn(),
    });

    const page = await repository.listReferenceChannelMedia({
      ...scope,
      referenceBrandId: "channel-1",
    });

    expect(page).toEqual({
      items: [expect.objectContaining({
        id: "media-1",
        kind: "reel",
        isSaved: true,
        sourcePlatform: "instagram",
        author: {
          referenceBrandId: "channel-1",
          handle: "target.brand",
          displayName: "target.brand",
        },
        metrics: { viewCount: 1000, likeCount: 120, commentsCount: 8 },
      })],
      total: 1,
      refreshedAt: "2026-08-13T03:00:00.000Z",
      cacheState: "fresh",
    });
  });
});
