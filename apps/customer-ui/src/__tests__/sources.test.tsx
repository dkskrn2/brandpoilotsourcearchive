import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SourceSnapshot, SourceUrl, TopicRow } from "../types";

const sourceRows: SourceUrl[] = [
  { id: "owned-1", brandId: "brand-1", sourceType: "owned", url: "https://api.example.com", title: "Homepage", status: "active", enabled: true, lastCrawledAt: null, lastError: null },
  { id: "ref-1", brandId: "brand-1", sourceType: "reference", url: "https://news.example.com/travel", title: "Travel reference", status: "active", enabled: true, lastCrawledAt: null, lastError: null }
];

const maxReferenceSourceRows: SourceUrl[] = [
  sourceRows[0],
  ...Array.from({ length: 10 }, (_, index) => ({
    id: `ref-${index + 1}`,
    brandId: "brand-1",
    sourceType: "reference" as const,
    url: `https://news.example.com/reference-${index + 1}`,
    title: null,
    status: "active" as const,
    enabled: true,
    lastCrawledAt: null,
    lastError: null
  }))
];

const sourceSnapshots: SourceSnapshot[] = [
  {
    id: "snapshot-1",
    sourceUrlId: "owned-1",
    sourceType: "owned",
    url: "https://crawl.example.com/owned",
    title: "Homepage",
    status: "succeeded",
    fetchedAt: "2026-07-06T00:00:00.000Z",
    summary: "Owned source summary",
    errorMessage: null
  },
  {
    id: "snapshot-2",
    sourceUrlId: "ref-1",
    sourceType: "reference",
    url: "https://crawl.example.com/reference",
    title: "Travel report",
    status: "failed",
    fetchedAt: "2026-07-06T01:00:00.000Z",
    summary: null,
    errorMessage: "fetch_failed"
  }
];

const topicRows: TopicRow[] = [
  {
    id: "topic-row-1",
    uploadId: "upload-1",
    rowNumber: 2,
    status: "uploaded",
    topicTitle: "API topic",
    topicAngle: "API angle",
    targetCustomer: "new customers",
    region: "Seoul",
    season: null,
    referenceUrl: null,
    priority: 10,
    notes: null,
    validationErrors: [],
    createdAt: "2026-07-06T00:00:00.000Z",
    usedAt: null
  }
];

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetModules();
  vi.clearAllMocks();
});

async function renderSourcesPage(apiOverrides: Partial<Record<string, ReturnType<typeof vi.fn>>> = {}) {
  const api = {
    listSources: vi.fn(async () => sourceRows),
    listSourceSnapshots: vi.fn(async () => sourceSnapshots),
    listSourceCrawlRuns: vi.fn(async () => []),
    listTopicRows: vi.fn(async () => topicRows),
    createSource: vi.fn(async (_brandId: string, payload: { sourceType: SourceUrl["sourceType"]; url: string }) => ({
      source: {
        id: "created-1",
        brandId: "brand-1",
        sourceType: payload.sourceType,
        url: payload.url,
        title: null,
        status: "crawled",
        enabled: true,
        lastCrawledAt: "2026-07-12T00:00:10.000Z",
        lastError: null
      },
      initialCrawl: {
        id: "run-created-1", brandId: "brand-1", sourceUrlId: "created-1",
        trigger: "new_source", status: "succeeded", attempt: 0,
        processed: 1, created: 1, updated: 1, failed: 0,
        startedAt: "2026-07-12T00:00:00.000Z", finishedAt: "2026-07-12T00:00:10.000Z",
        nextRetryAt: null, lastError: null
      }
    })),
    updateSource: vi.fn(async (_sourceId: string, payload: { sourceType?: SourceUrl["sourceType"]; url?: string }) => ({
      ...sourceRows[0],
      ...payload
    })),
    deleteSource: vi.fn(async (sourceId: string) => ({ id: sourceId })),
    createTopicUpload: vi.fn(),
    crawlSources: vi.fn(async () => ({ processed: 2, created: 2, updated: 2, failed: 0 })),
    ...apiOverrides
  };
  vi.doMock("../lib/apiClient", () => ({
    DEMO_BRAND_ID: "brand-1",
    api
  }));
  const { SourcesPage } = await import("../pages/SourcesPage");
  render(<SourcesPage />);
  return api;
}

describe("SourcesPage", () => {
  it("shows the initial crawl result after adding a URL", async () => {
    const api = await renderSourcesPage();
    await userEvent.type(screen.getByRole("textbox", { name: "자사 URL" }), "https://new.example.com");
    await userEvent.click(screen.getByRole("button", { name: "URL 추가" }));

    expect(await screen.findByText(/초기 크롤링 완료/)).toBeInTheDocument();
    expect(api.createSource).toHaveBeenCalledTimes(1);
  });

  it("shows recent automatic crawl status", async () => {
    await renderSourcesPage({
      listSourceCrawlRuns: vi.fn(async () => [{
        id: "run-1", brandId: "brand-1", sourceUrlId: "owned-1",
        trigger: "scheduled", status: "succeeded", attempt: 0,
        processed: 1, created: 1, updated: 1, failed: 0,
        startedAt: "2026-07-12T00:00:00.000Z", finishedAt: "2026-07-12T00:00:10.000Z",
        nextRetryAt: null, lastError: null
      }])
    });
    await userEvent.click(screen.getByRole("tab", { name: "소스 큐" }));
    expect(await screen.findByText("자동 크롤링 성공")).toBeInTheDocument();
  });

  it("renders source management tabs and topic template download", async () => {
    await renderSourcesPage();

    expect(screen.getByRole("heading", { name: "소스" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "자사 URL" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "참고 URL" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "주제표 업로드" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "소스 큐" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "주제 큐" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "전체 크롤링" })).toBeInTheDocument();
    expect(await screen.findByRole("columnheader", { name: "소스 구분" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "제목" })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "주제표 업로드" }));
    expect(screen.getByRole("link", { name: "템플릿 다운로드" })).toHaveAttribute("href", "/topic-template.csv");
    expect(screen.getByRole("textbox", { name: "주제표 CSV 내용" })).toBeInTheDocument();
    expect(screen.getByText("선택 파일: topics.csv")).toBeVisible();
  });

  it("shows source queue crawl records from the API", async () => {
    await renderSourcesPage();

    await userEvent.click(screen.getByRole("tab", { name: "소스 큐" }));

    expect(await screen.findByText("https://crawl.example.com/owned")).toBeVisible();
    expect(screen.getByText("https://crawl.example.com/reference")).toBeVisible();
    expect(screen.queryByText("Travel report")).not.toBeInTheDocument();
    expect(screen.getAllByText("자사 URL").length).toBeGreaterThan(0);
    expect(screen.getAllByText("참고 URL").length).toBeGreaterThan(0);
    expect(screen.getByText("fetch_failed")).toBeVisible();
  });

  it("shows topic queue rows from the API", async () => {
    await renderSourcesPage();

    await userEvent.click(screen.getByRole("tab", { name: "주제 큐" }));

    expect(await screen.findByText("API topic")).toBeVisible();
    expect(screen.getByText("생성 후보")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "주제" })).toBeInTheDocument();
  });

  it("hides malformed topic text and shows encoding validation messages", async () => {
    await renderSourcesPage({
      listTopicRows: vi.fn(async () => [{
        id: "topic-row-broken",
        uploadId: "upload-1",
        rowNumber: 2,
        status: "invalid",
        topicTitle: "??? ???",
        topicAngle: "?? ? ??",
        targetCustomer: "?? ??",
        region: null,
        season: null,
        referenceUrl: null,
        priority: 0,
        notes: "500? ???? ??",
        validationErrors: ["topic_title_malformed_text", "topic_angle_malformed_text"],
        createdAt: "2026-07-06T00:00:00.000Z",
        usedAt: null
      }])
    });

    await userEvent.click(screen.getByRole("tab", { name: "주제 큐" }));

    expect((await screen.findAllByText("인코딩 오류")).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/주제 제목 인코딩 오류/)).toBeVisible();
    expect(screen.queryByText("??? ???")).not.toBeInTheDocument();
    expect(screen.queryByText("?? ? ??")).not.toBeInTheDocument();
  });

  it("decodes EUC-KR topic CSV files before showing the upload preview", async () => {
    await renderSourcesPage();
    await userEvent.click(screen.getByRole("tab", { name: "주제표 업로드" }));
    const cp949Csv = new Uint8Array([
      0x74, 0x6F, 0x70, 0x69, 0x63, 0x5F, 0x74, 0x69, 0x74, 0x6C, 0x65, 0x2C,
      0x74, 0x6F, 0x70, 0x69, 0x63, 0x5F, 0x61, 0x6E, 0x67, 0x6C, 0x65, 0x0A,
      0xC1, 0xA6, 0xC1, 0xD6, 0x20, 0xBF, 0xA9, 0xC7, 0xE0, 0x2C, 0xB0, 0xA1,
      0xC1, 0xB7, 0x20, 0xC0, 0xCF, 0xC1, 0xA4
    ]);
    const file = new File([cp949Csv], "topics-cp949.csv", { type: "text/csv" });

    await userEvent.upload(screen.getByLabelText("주제표 CSV 파일"), file);

    expect(screen.getByRole("textbox", { name: "주제표 CSV 내용" })).toHaveValue("topic_title,topic_angle\n제주 여행,가족 일정");
  });

  it("does not show sample URL or topic rows when API loading fails", async () => {
    await renderSourcesPage({
      listSources: vi.fn(async () => {
        throw new Error("sources_failed");
      }),
      listSourceSnapshots: vi.fn(async () => {
        throw new Error("snapshots_failed");
      }),
      listTopicRows: vi.fn(async () => {
        throw new Error("topics_failed");
      })
    });

    expect(await screen.findByText(/URL 목록을 불러오지 못했습니다/)).toBeVisible();
    expect(screen.queryByText("https://example.com")).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole("tab", { name: "주제 큐" }));
    expect(screen.getByText("등록된 주제가 없습니다")).toBeVisible();
  });

  it("does not add a source locally when API create fails", async () => {
    await renderSourcesPage({
      createSource: vi.fn(async () => {
        throw new Error("create_failed");
      })
    });

    const input = screen.getByRole("textbox", { name: "자사 URL" });
    await userEvent.type(input, "https://local-only.example.com");
    await userEvent.click(screen.getByRole("button", { name: "URL 추가" }));

    expect(await screen.findByText(/API 저장에 실패했습니다/)).toBeVisible();
    expect(screen.queryByText("https://local-only.example.com")).not.toBeInTheDocument();
  });

  it("shows a duplicate URL message when source creation returns a duplicate error", async () => {
    await renderSourcesPage({
      createSource: vi.fn(async () => {
        throw new Error("API request failed: 409:source_url_duplicate");
      })
    });

    const input = screen.getByRole("textbox", { name: "자사 URL" });
    await userEvent.type(input, "https://api.example.com");
    await userEvent.click(screen.getByRole("button", { name: "URL 추가" }));

    expect(await screen.findByText(/같은 유형에 이미 등록된 URL입니다/)).toBeVisible();
  });

  it("shows an invalid URL message when source creation returns a URL validation error", async () => {
    await renderSourcesPage({
      createSource: vi.fn(async () => {
        throw new Error("API request failed: 400:source_url_invalid");
      })
    });

    const input = screen.getByRole("textbox", { name: "자사 URL" });
    await userEvent.type(input, "api.example.com");
    await userEvent.click(screen.getByRole("button", { name: "URL 추가" }));

    expect(await screen.findByText(/http:\/\/ 또는 https:\/\//)).toBeVisible();
  });

  it("prevents adding more than ten reference URLs", async () => {
    const createSource = vi.fn();
    await renderSourcesPage({
      listSources: vi.fn(async () => maxReferenceSourceRows),
      createSource
    });

    await userEvent.click(screen.getByRole("tab", { name: "참고 URL" }));

    expect(await screen.findByText("10/10개 활성")).toBeVisible();
    expect(screen.getByRole("textbox", { name: "참고 URL" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "URL 추가" })).toBeDisabled();
    expect(screen.getByText(/참고 URL은 최대 10개까지 등록할 수 있습니다/)).toBeVisible();
    expect(createSource).not.toHaveBeenCalled();
  });

  it("keeps a source visible when API delete fails", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await renderSourcesPage({
      deleteSource: vi.fn(async () => {
        throw new Error("delete_failed");
      })
    });

    expect(await screen.findByText("https://api.example.com")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "삭제 https://api.example.com" }));

    expect(await screen.findByText(/API 삭제에 실패했습니다/)).toBeVisible();
    expect(screen.getByText("https://api.example.com")).toBeVisible();
  });

  it("retries a failed source through the API instead of changing only the screen", async () => {
    const retrySource = vi.fn(async () => ({
      id: "retry-1", brandId: "brand-1", sourceUrlId: "owned-1",
      trigger: "manual", status: "succeeded", attempt: 0,
      processed: 1, created: 1, updated: 0, failed: 0,
      startedAt: "2026-07-13T01:00:00.000Z", finishedAt: "2026-07-13T01:00:01.000Z",
      nextRetryAt: null, lastError: null
    }));
    await renderSourcesPage({
      listSources: vi.fn(async () => [{ ...sourceRows[0], status: "crawl_failed", lastError: "source_crawl_failed" }]),
      retrySource
    });

    await userEvent.click(await screen.findByRole("button", { name: "재시도 https://api.example.com" }));

    expect(retrySource).toHaveBeenCalledWith("brand-1", "owned-1");
    expect(await screen.findByText(/재크롤링 완료/)).toBeVisible();
  });

  it("disables a source through the API and offers re-enabling it", async () => {
    const updateSource = vi.fn(async () => ({ ...sourceRows[0], enabled: false, status: "disabled" }));
    await renderSourcesPage({ updateSource });

    await userEvent.click(await screen.findByRole("button", { name: "비활성화 https://api.example.com" }));

    expect(updateSource).toHaveBeenCalledWith("owned-1", { enabled: false });
    expect(await screen.findByRole("button", { name: "다시 활성화 https://api.example.com" })).toBeVisible();
  });
});

