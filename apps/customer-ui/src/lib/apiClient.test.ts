import { describe, expect, it, vi } from "vitest";
import { apiClient } from "./apiClient";

describe("apiClient", () => {
  it("fetches a brand profile from the API", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ name: "API 브랜드" }), { status: 200 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock });

    const profile = await client.getBrandProfile("brand-1");

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/brands/brand-1/profile", expect.objectContaining({ method: "GET" }));
    expect(profile).toEqual({ name: "API 브랜드" });
  });

  it("fetches brand UI status for shell and onboarding", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      brandId: "brand-1",
      brandName: "API 브랜드",
      lastGeneratedAt: "2026-07-06T01:00:00.000Z",
      navigation: {
        onboardingRemaining: 2,
        contentReview: 4,
        publishIssues: 1,
        channelIssues: 2
      },
      onboarding: {
        completedCount: 7,
        totalCount: 9,
        remainingCount: 2,
        steps: []
      }
    }), { status: 200 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock });

    const status = await client.getBrandUiStatus("brand-1");

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/brands/brand-1/ui-status", expect.objectContaining({ method: "GET" }));
    expect(status).toMatchObject({ brandName: "API 브랜드", navigation: { onboardingRemaining: 2 } });
  });

  it("posts to the auth logout endpoint", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock });

    await expect(client.logout()).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/auth/logout", expect.objectContaining({ method: "POST" }));
  });

  it("throws when the API returns an error response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock });

    await expect(client.getBrandProfile("missing")).rejects.toThrow("API request failed: 404");
  });

  it("includes API error codes in thrown errors", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ error: "source_url_duplicate" }), { status: 409 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock });

    await expect(client.updateSource("source-1", { sourceType: "owned", url: "https://example.com" }))
      .rejects.toThrow("source_url_duplicate");
  });

  it("does not send a JSON content-type header for requests without a body", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ id: "source-1" }), { status: 200 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock as typeof fetch });

    await client.deleteSource("source-1");

    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.body).toBeUndefined();
    expect(init.headers).not.toHaveProperty("content-type");
  });

  it("uses the DM operations endpoints and filter query", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/dm/conversations?")) return new Response(JSON.stringify({ items: [], nextCursor: null }), { status: 200 });
      if (href.endsWith("/dm/conversations/conversation-1")) return new Response(JSON.stringify({ id: "conversation-1", messages: [], attentionItems: [] }), { status: 200 });
      if (href.endsWith("/dm/attention-items/attention-1") && init?.method === "PATCH") return new Response(JSON.stringify({ conversationId: "conversation-1", automationStatus: "active", attentionStatus: "resolved" }), { status: 200 });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock as typeof fetch });

    await client.listDmConversations("brand-1", { filter: "attention", limit: 20 });
    await client.getDmConversation("brand-1", "conversation-1");
    await client.resolveDmAttentionItem("attention-1");

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/brands/brand-1/dm/conversations?filter=attention&limit=20", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/brands/brand-1/dm/conversations/conversation-1", expect.objectContaining({ method: "GET" }));
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/dm/attention-items/attention-1", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ status: "resolved" }) }));
  });

  it("sends the knowledge entry type and reads Wiki status", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const href = String(url);
      if (href.endsWith("/wiki/status")) return new Response(JSON.stringify({ activeVersion: null, latestFailedVersion: null, importStats: { total: 0, succeeded: 0, failed: 0, faqRows: 0, productRows: 0 } }), { status: 200 });
      return new Response(JSON.stringify({ id: "import-1", entryType: "product" }), { status: 200 });
    });
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock as typeof fetch });

    await client.importKnowledge("brand-1", { entryType: "product", fileName: "products.csv", fileBase64: "YQ==" });
    await client.getWikiStatus("brand-1");

    expect(fetchMock).toHaveBeenCalledWith("http://api.test/brands/brand-1/knowledge-imports", expect.objectContaining({ body: JSON.stringify({ entryType: "product", fileName: "products.csv", fileBase64: "YQ==" }) }));
    expect(fetchMock).toHaveBeenCalledWith("http://api.test/brands/brand-1/wiki/status", expect.objectContaining({ method: "GET" }));
  });

  it("creates sources, reviews content, reads queue, and uploads topic csv", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const href = String(url);
      if (href.endsWith("/sources") && init?.method === "GET") {
        return new Response(JSON.stringify([{ id: "source-1", brandId: "brand-1", sourceType: "owned", url: "https://example.com", title: null, status: "active", enabled: true, lastCrawledAt: null, lastError: null }]), { status: 200 });
      }
      if (href.endsWith("/sources") && init?.method === "POST") {
        return new Response(JSON.stringify({ id: "source-2", brandId: "brand-1", sourceType: "reference", url: "https://news.example.com", title: null, status: "active", enabled: true, lastCrawledAt: null, lastError: null }), { status: 201 });
      }
      if (href.endsWith("/sources/source-2") && init?.method === "PUT") {
        return new Response(JSON.stringify({ id: "source-2", brandId: "brand-1", sourceType: "owned", url: "https://example.com/updated", title: null, status: "active", enabled: true, lastCrawledAt: null, lastError: null }), { status: 200 });
      }
      if (href.endsWith("/sources/source-2") && init?.method === "DELETE") {
        return new Response(JSON.stringify({ id: "source-2" }), { status: 200 });
      }
      if (href.endsWith("/content-outputs")) {
        return new Response(JSON.stringify([{ id: "output-1", title: "Draft", channel: "instagram", status: "pending_review", previewTitle: "Preview", previewBody: "Body", sourceSummary: "Source", blockReasons: [], generatedAt: "2026-07-06T01:00:00.000Z" }]), { status: 200 });
      }
      if (href.endsWith("/content-outputs/output-1/review")) {
        return new Response(JSON.stringify({ id: "output-1", status: "approved" }), { status: 200 });
      }
      if (href.endsWith("/publish-queue")) {
        return new Response(JSON.stringify([{
          id: "queue-1",
          title: "Draft",
          channel: "instagram",
          status: "queued",
          approvalType: "manual",
          scheduledFor: null,
          lastError: null,
          sourceType: "mixed",
          sourceLabel: "Topic row",
          sourceDetail: "Angle | https://example.com",
          sourceUrls: ["https://brand.example.com/faq"],
          queuedAt: "2026-07-07T01:00:00.000Z"
        }]), { status: 200 });
      }
      if (href.endsWith("/support-requests") && init?.method === "GET") {
        return new Response(JSON.stringify([{
          id: "support-1",
          brandId: "brand-1",
          workspaceId: "workspace-1",
          category: "bug",
          title: "채널 연결 오류",
          message: "인스타 연결이 실패합니다.",
          contactEmail: "user@example.com",
          status: "new",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:00:00.000Z"
        }]), { status: 200 });
      }
      if (href.endsWith("/support-requests") && init?.method === "POST") {
        return new Response(JSON.stringify({
          id: "support-2",
          brandId: "brand-1",
          workspaceId: "workspace-1",
          category: "feature",
          title: "예약 기능 개선",
          message: "채널별 예약 시간을 더 세분화하고 싶습니다.",
          contactEmail: null,
          status: "new",
          createdAt: "2026-07-11T00:05:00.000Z",
          updatedAt: "2026-07-11T00:05:00.000Z"
        }), { status: 201 });
      }
      if (href.endsWith("/support-requests/support-1") && init?.method === "PATCH") {
        return new Response(JSON.stringify({
          id: "support-1",
          brandId: "brand-1",
          workspaceId: "workspace-1",
          category: "bug",
          title: "채널 연결 오류",
          message: "인스타 연결이 실패합니다.",
          contactEmail: "user@example.com",
          status: "resolved",
          createdAt: "2026-07-11T00:00:00.000Z",
          updatedAt: "2026-07-11T00:10:00.000Z"
        }), { status: 200 });
      }
      if (href.endsWith("/publish-results")) {
        return new Response(JSON.stringify([{
          contentId: "master-1",
          title: "제주 가족 숙소 카드뉴스",
          generatedAt: "2026-07-08T01:00:00.000Z",
          sourceType: "mixed",
          sourceLabel: "가족 숙소 체크리스트",
          sourceDetail: "위치 중심 | 자사 FAQ 요약",
          sourceUrls: ["https://brand.example.com/faq"],
          channels: [{
            queueId: "queue-1",
            channelOutputId: "output-1",
            channel: "instagram",
            status: "published",
            publishedAt: "2026-07-08T02:30:00.000Z",
            failedAt: null,
            title: "인스타 카드뉴스",
            previewTitle: "제주 숙소 선택 기준",
            previewBody: "캡션 내용",
            outputJson: { caption: "캡션 내용" },
            artifactPublicUrl: "https://cdn.example.com/manifest.json",
            externalPostId: "ig-post-1",
            externalUrl: "https://instagram.com/p/ig-post-1",
            lastError: null,
            sourceSummary: "자사 FAQ 요약"
          }]
        }]), { status: 200 });
      }
      if (href.endsWith("/publish-queue/download")) {
        return new Response("zip-content", {
          status: 200,
          headers: {
            "content-type": "application/zip",
            "content-disposition": "attachment; filename=\"published-results.zip\""
          }
        });
      }
      if (href.endsWith("/topic-uploads")) {
        return new Response(JSON.stringify({ id: "upload-1", fileName: "topics.csv", status: "validated", totalRows: 1, validRows: 1, duplicateRows: 0, invalidRows: 0 }), { status: 201 });
      }
      if (href.endsWith("/topic-rows?status=skipped")) {
        return new Response(JSON.stringify([{
          id: "topic-row-1",
          uploadId: "upload-1",
          rowNumber: 2,
          status: "skipped",
          topicTitle: "Jeju food",
          topicAngle: "local guide",
          targetCustomer: null,
          region: "Jeju",
          season: null,
          referenceUrl: null,
          priority: 10,
          notes: null,
          validationErrors: ["duplicate_existing_topic"],
          createdAt: "2026-07-06T00:00:00.000Z",
          usedAt: null
        }]), { status: 200 });
      }
      if (href.endsWith("/sources/crawl")) {
        return new Response(JSON.stringify({ processed: 2, created: 2, updated: 2, failed: 0 }), { status: 200 });
      }
      if (href.endsWith("/content-generation/run")) {
        return new Response(JSON.stringify({ processed: 1, created: 3, updated: 1, failed: 0 }), { status: 200 });
      }
      if (href.endsWith("/publish-queue/schedule")) {
        return new Response(JSON.stringify({ processed: 3, created: 0, updated: 3, failed: 0 }), { status: 200 });
      }
      if (href.endsWith("/publish-queue/queue-1/publish")) {
        return new Response(JSON.stringify({ id: "queue-1", status: "published", publishedUrl: "mock://instagram/output-1" }), { status: 200 });
      }
      return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 });
    });
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock as typeof fetch });

    expect(await client.listSources("brand-1")).toHaveLength(1);
    expect(await client.createSource("brand-1", { sourceType: "reference", url: "https://news.example.com" })).toMatchObject({ sourceType: "reference" });
    expect(await client.updateSource("source-2", { sourceType: "owned", url: "https://example.com/updated" })).toMatchObject({ sourceType: "owned", url: "https://example.com/updated" });
    expect(await client.deleteSource("source-2")).toEqual({ id: "source-2" });
    expect(await client.listContentOutputs("brand-1")).toHaveLength(1);
    expect(await client.reviewContentOutput("output-1", "approve")).toMatchObject({ status: "approved" });
    expect(await client.listPublishQueue("brand-1")).toEqual([expect.objectContaining({
      id: "queue-1",
      status: "queued",
      sourceType: "mixed",
      sourceLabel: "Topic row",
      sourceDetail: "Angle | https://example.com",
      sourceUrls: ["https://brand.example.com/faq"]
    })]);
    expect(await client.listSupportRequests("brand-1")).toEqual([expect.objectContaining({ id: "support-1", status: "new" })]);
    expect(await client.createSupportRequest("brand-1", {
      category: "feature",
      title: "예약 기능 개선",
      message: "채널별 예약 시간을 더 세분화하고 싶습니다.",
      contactEmail: null
    })).toMatchObject({ id: "support-2", category: "feature", status: "new" });
    expect(await client.updateSupportRequestStatus("support-1", "resolved")).toMatchObject({ id: "support-1", status: "resolved" });
    expect(await client.listPublishResults("brand-1")).toEqual([expect.objectContaining({
      contentId: "master-1",
      channels: [expect.objectContaining({ channel: "instagram", status: "published", previewBody: "캡션 내용" })]
    })]);
    const download = await client.downloadPublishedResults("brand-1");
    expect(download.fileName).toBe("published-results.zip");
    expect(await download.blob.text()).toBe("zip-content");
    expect(await client.createTopicUpload("brand-1", { fileName: "topics.csv", csvText: "topic_title,topic_angle\nA,B" })).toMatchObject({ validRows: 1 });
    expect(await client.listTopicRows("brand-1", "skipped")).toEqual([expect.objectContaining({ status: "skipped", topicTitle: "Jeju food" })]);
    expect(await client.crawlSources("brand-1")).toMatchObject({ processed: 2 });
    expect(await client.generateContent("brand-1")).toMatchObject({ created: 3 });
    expect(await client.schedulePublishQueue("brand-1")).toMatchObject({ updated: 3 });
    expect(await client.publishQueueItem("queue-1")).toMatchObject({ status: "published" });
  });

  it("sends raw channel secret under secretValue so the API owns encryption", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({
      channel: "instagram",
      status: "needs_attention",
      accountLabel: "Meta OAuth",
      lastHealthyAt: null,
      lastPublishedAt: null,
      lastError: null
    }), { status: 200 }));
    const client = apiClient({ baseUrl: "http://api.test", fetcher: fetchMock as typeof fetch });

    await client.saveChannelCredentials("brand-1", "instagram", {
      accountLabel: "Meta OAuth",
      secretValue: "meta-token",
      provider: "meta",
      credentialType: "oauth"
    });

    const requestInit = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(requestInit.body));
    expect(body).toMatchObject({ secretValue: "meta-token" });
    expect(body).not.toHaveProperty("encryptedPayload");
  });
});
