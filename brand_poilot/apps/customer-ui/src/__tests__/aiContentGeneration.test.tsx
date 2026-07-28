import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockAiContentGateway } from "../features/ai-content/mockAiContentGateway";
import { AiContentGenerationPage } from "../pages/AiContentGenerationPage";
import type { ChannelConnection } from "../types";
import { ApiRequestError } from "../lib/apiClient";
import type { ContentOrchestration } from "../features/ai-content/types";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderGeneration(
  generationId: string,
  instagramConnected = false,
  configureGateway?: (gateway: ReturnType<typeof createMockAiContentGateway>) => void,
) {
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const gateway = createMockAiContentGateway();
  const connectedChannels: ChannelConnection[] = instagramConnected ? [{
    type: "instagram",
    label: "Instagram",
    enabled: true,
    oauthState: "connected",
    status: "connected",
    accountLabel: "@growthline352",
    lastHealthyAt: "2026-07-20T00:00:00.000Z",
    lastPublishedAt: "2026-07-20T00:00:00.000Z",
  }] : [];
  gateway.listChannels = vi.fn(async () => connectedChannels);
  gateway.publishOutput = vi.fn(gateway.publishOutput);
  configureGateway?.(gateway);
  const view = render(
    <MemoryRouter initialEntries={[`/ai-content/${generationId}`]}>
      <Routes>
        <Route path="/ai-content/:generationId" element={<AiContentGenerationPage gateway={gateway} />} />
      </Routes>
    </MemoryRouter>
  );

  return { gateway, ...view };
}

describe("AiContentGenerationPage", () => {
  it("shows card-news completion detail, exact contracts, and disconnected publish action", async () => {
    const user = userEvent.setup();
    renderGeneration("generation-card-complete");

    expect(await screen.findByRole("heading", { name: "생성 결과 상세" })).toBeVisible();
    expect(screen.getByText("유형: 카드뉴스 · 여름 추천 카드뉴스")).toBeVisible();
    expect(screen.getByText("Instagram OAuth 게시 계정 미연결")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "연결하기" })[0]).toHaveAttribute("href", expect.stringContaining("/auth/meta/start"));

    const resultButton = screen.getByRole("button", { name: "카드뉴스 표지 결과 ZIP 다운로드" });
    const zipButton = screen.getByRole("button", { name: "전체 ZIP" });

    await user.click(resultButton);
    expect(screen.getByRole("button", { name: "카드뉴스 표지 결과 ZIP 다운로드" })).toHaveTextContent("결과 ZIP (다운로드됨)");

    await user.click(zipButton);
    expect(screen.getByRole("button", { name: "전체 ZIP" })).toHaveTextContent("전체 ZIP (다운로드됨)");
  });

  it("submits only one download while the same action is already in flight", async () => {
    let finishDownload!: (value: { blob: Blob; fileName: string }) => void;
    const { gateway } = renderGeneration("generation-card-complete", false, (configuredGateway) => {
      configuredGateway.downloadOutput = vi.fn(() => new Promise<{ blob: Blob; fileName: string }>((resolve) => {
        finishDownload = resolve;
      }));
    });
    const button = await screen.findByRole("button", { name: "카드뉴스 표지 결과 ZIP 다운로드" });

    fireEvent.click(button);
    fireEvent.click(button);
    expect(gateway.downloadOutput).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishDownload({ blob: new Blob(["zip"]), fileName: "result.zip" });
      await Promise.resolve();
    });
  });

  it("maps the download quota code to Korean and preserves completed materials", async () => {
    const { gateway } = renderGeneration("generation-card-complete", false, (configuredGateway) => {
      configuredGateway.downloadOutput = vi.fn(async () => {
        throw new ApiRequestError({ status: 429, errorCode: "ai_content_download_limit_reached" });
      });
    });
    const outputButton = await screen.findByRole("button", { name: "카드뉴스 표지 결과 ZIP 다운로드" });

    await userEvent.click(outputButton);

    expect(await screen.findByRole("alert")).toHaveTextContent("오늘 신규 다운로드 20회를 모두 사용했습니다");
    expect(outputButton).toHaveTextContent("결과 ZIP");
    expect(screen.getByRole("button", { name: "전체 ZIP" })).toBeEnabled();
    expect(gateway.downloadOutput).toHaveBeenCalledTimes(1);
  });

  it("shows failed output reason and retry control updates output state after reasoned retry", async () => {
    const user = userEvent.setup();
    renderGeneration("generation-partial");

    const outputRows = await screen.findAllByRole("listitem");
    const failedOutputRow = outputRows[1];
    expect(within(failedOutputRow).getByText("실패 사유: 이미지 생성 실패")).toBeVisible();

    const retryButton = within(failedOutputRow).getByRole("button", { name: /결과 2 다시 생성/ });
    expect(retryButton).toBeDisabled();

    const reasonInput = within(failedOutputRow).getByLabelText("문제 해결형 다시 생성 사유");
    await user.type(reasonInput, "이미지 구성 요소를 재생성해 주세요.");
    expect(retryButton).toBeEnabled();

    await user.click(retryButton);
    expect(await within(failedOutputRow).findByText("대기")).toBeVisible();
    expect(within(failedOutputRow).queryByRole("button", { name: /결과 2 다시 생성/ })).not.toBeInTheDocument();
    expect(within(failedOutputRow).queryByText("실패 사유: 이미지 생성 실패")).not.toBeInTheDocument();
  });

  it("shows the localized retry deadline and form before attachment retention expires", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    renderGeneration("generation-partial", false, (gateway) => {
      const getGeneration = gateway.getGeneration.bind(gateway);
      gateway.getGeneration = vi.fn(async (brandId, generationId) => ({
        ...await getGeneration(brandId, generationId),
        retryableUntil: "2026-07-21T00:00:00.000Z",
      }));
    });

    expect(await screen.findByText(/다시 생성 가능 기한: 2026년 7월 21일 오전 9:00/)).toBeVisible();
    expect(screen.getByRole("button", { name: /결과 2 다시 생성/ })).toBeInTheDocument();
  });

  it("automatically removes retry exactly at the mounted deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    const view = renderGeneration("generation-partial", false, (gateway) => {
      const getGeneration = gateway.getGeneration.bind(gateway);
      gateway.getGeneration = vi.fn(async (brandId, generationId) => ({
        ...await getGeneration(brandId, generationId),
        retryableUntil: "2026-07-20T00:00:01.000Z",
      }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole("button", { name: /결과 2 다시 생성/ })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(screen.getByRole("button", { name: /결과 2 다시 생성/ })).toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.queryByRole("button", { name: /결과 2 다시 생성/ })).not.toBeInTheDocument();
    expect(screen.getByText(/첨부파일 보관 기간이 만료/)).toBeVisible();

    view.unmount();
  });

  it("caps a distant deadline timer and cancels the pending timer on unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    const clearTimeoutSpy = vi.spyOn(window, "clearTimeout");
    const view = renderGeneration("generation-partial", false, (gateway) => {
      const getGeneration = gateway.getGeneration.bind(gateway);
      gateway.getGeneration = vi.fn(async (brandId, generationId) => ({
        ...await getGeneration(brandId, generationId),
        retryableUntil: "2026-08-20T00:00:00.000Z",
      }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 2_147_483_647);
    const pendingTimer = setTimeoutSpy.mock.results.at(-1)?.value;
    view.unmount();
    expect(clearTimeoutSpy).toHaveBeenCalledWith(pendingTimer);
  });

  it.each([null, "not-an-iso-timestamp"])("does not arm a deadline timer for %s retention", async (retryableUntil) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-20T00:00:00.000Z"));
    const setTimeoutSpy = vi.spyOn(window, "setTimeout");
    renderGeneration("generation-partial", false, (gateway) => {
      const getGeneration = gateway.getGeneration.bind(gateway);
      gateway.getGeneration = vi.fn(async (brandId, generationId) => ({
        ...await getGeneration(brandId, generationId),
        retryableUntil,
      }));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByRole("button", { name: /결과 2 다시 생성/ })).toBeInTheDocument();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it.each([
    ["exact deadline", "2026-07-21T00:00:00.000Z"],
    ["after deadline", "2026-07-20T23:59:59.999Z"],
  ])("removes retry at %s and requires a new generation with file re-upload", async (_label, retryableUntil) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-07-21T00:00:00.000Z"));
    renderGeneration("generation-partial", false, (gateway) => {
      const getGeneration = gateway.getGeneration.bind(gateway);
      gateway.getGeneration = vi.fn(async (brandId, generationId) => ({
        ...await getGeneration(brandId, generationId),
        retryableUntil,
      }));
    });

    expect(await screen.findByText(/첨부파일 보관 기간이 만료/)).toBeVisible();
    expect(screen.getByRole("link", { name: "새 콘텐츠 생성" })).toHaveAttribute("href", "/ai-content/new");
    expect(screen.getByText(/파일을 다시 업로드/)).toBeVisible();
    expect(screen.queryByRole("button", { name: /결과 2 다시 생성/ })).not.toBeInTheDocument();
  });

  it("keeps the legacy retry form when the API has no retention timestamp", async () => {
    renderGeneration("generation-partial");

    expect(await screen.findByRole("button", { name: /결과 2 다시 생성/ })).toBeInTheDocument();
    expect(screen.queryByText(/첨부파일 보관 기간이 만료/)).not.toBeInTheDocument();
  });

  it("converges a stale retry after API 410 while preserving completed output actions", async () => {
    const user = userEvent.setup();
    const { gateway } = renderGeneration("generation-partial", true, (configuredGateway) => {
      const getGeneration = configuredGateway.getGeneration.bind(configuredGateway);
      configuredGateway.getGeneration = vi.fn(async (brandId, generationId) => {
        const result = await getGeneration(brandId, generationId);
        return {
          ...result,
          outputs: result.outputs.map((output, index) => index === 0 && output.artifact
            ? {
                ...output,
                artifact: {
                  ...output.artifact,
                  assets: [{
                    role: "asset",
                    url: "https://assets.test/completed.png",
                    fileName: "completed.png",
                    mimeType: "image/png",
                    width: 1080,
                    height: 1080,
                  }],
                },
              }
            : output),
        };
      });
      configuredGateway.retryOutput = vi.fn(async () => {
        throw new ApiRequestError({
          status: 410,
          errorCode: "ai_content_attachment_retention_expired",
        });
      });
    });

    const rows = await screen.findAllByRole("listitem");
    const failedRow = rows[1];
    const publishSelection = screen.getByRole("checkbox", { name: "게시물" });
    await user.click(publishSelection);
    await user.type(within(failedRow).getByLabelText("문제 해결형 다시 생성 사유"), "다시 생성");
    await user.click(within(failedRow).getByRole("button", { name: /결과 2 다시 생성/ }));

    expect(await within(failedRow).findByText(/첨부파일 보관 기간이 만료/)).toBeVisible();
    expect(within(failedRow).queryByRole("button", { name: /결과 2 다시 생성/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "혜택 강조형 결과 ZIP 다운로드" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "전체 ZIP" })).toBeEnabled();
    expect(publishSelection).toBeChecked();
    expect(screen.getByRole("button", { name: "선택한 1개 유형 게시" })).toBeEnabled();
    expect(gateway.retryOutput).toHaveBeenCalledTimes(1);
  });

  it("shows blog/download-only contracts", async () => {
    renderGeneration("generation-completed");

    expect(await screen.findByRole("heading", { name: "생성 결과 상세" })).toBeVisible();
    expect(screen.getByText("유형: 블로그 · 고객이 저장하는 운영 가이드")).toBeVisible();
    expect(screen.queryByRole("button", { name: "게시 관리로 보내기" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "운영 가이드 결과 ZIP 다운로드" })).toBeEnabled();
    expect(screen.getByTitle("블로그 미리보기")).toBeVisible();
    expect(screen.getByText("현재 HTML 결과는 SNS 직접 게시를 지원하지 않습니다.")).toBeVisible();
  });

  it("shows planning state", async () => {
    renderGeneration("generation-planning");
    expect(await screen.findByText("기획 중")).toBeVisible();
  });

  it("shows marketing contracts with selected and all ZIP actions", async () => {
    renderGeneration("generation-partial");

    expect(await screen.findByText("유형: 마케팅 소재 · 신제품 출시 마케팅 소재")).toBeVisible();

    const outputRows = screen.getAllByRole("listitem");
    expect(within(outputRows[0]).getByRole("button", { name: "혜택 강조형 결과 ZIP 다운로드" })).toBeEnabled();

    expect(screen.getByRole("button", { name: "선택 결과 ZIP" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "전체 ZIP" })).toBeEnabled();
  });

  it("moves a completed orchestration into four review tabs and shows its frozen snapshots", async () => {
    const user = userEvent.setup();
    const { gateway } = renderGeneration("generation-card-complete", false, (configuredGateway) => {
      const getGeneration = configuredGateway.getGeneration.bind(configuredGateway);
      configuredGateway.listReferences = vi.fn(configuredGateway.listReferences);
      configuredGateway.retryOutput = vi.fn(configuredGateway.retryOutput);
      configuredGateway.getGeneration = vi.fn(async (brandId, generationId) => {
        const result = await getGeneration(brandId, generationId);
        return {
          ...result,
          evidenceSnapshot: {
            orchestration: {
              contractVersion: "generation-brief.v1",
              proposalId: "proposal-1",
            },
            generationInput: {
              contentType: "card_news",
              subject: { analysisId: "analysis-1" },
            },
            references: [{
              id: "reference-1",
              title: "동결된 레퍼런스 제목",
              url: "https://example.com/frozen-reference",
              previewUrl: "https://cdn.example.com/frozen-reference.png",
              roles: ["planning", "copy_pattern"],
            }],
            avatar: { id: "avatar-1", name: "동결된 브랜드 모델" },
            proposal: { title: "동결된 구현안 제목", hook: "동결된 훅" },
          },
          draft: {
            ...result.draft,
            orchestration: {
              contractVersion: "content-orchestration.v1",
              contentFamily: "informational",
              subject: { mode: "brand_topic", topic: "여름 피부 관리", wikiItemIds: ["wiki-1"] },
              target: { id: "target-1", snapshot: { name: "민감성 피부 고객" } },
              strategy: "how_to",
              outputFormat: "card_news",
              channelTargets: ["instagram"],
              brief: { instruction: "세 단계로 설명" },
              references: [{ referenceItemId: "reference-1", roles: ["planning", "copy_pattern"] }],
              avatar: {
                mode: "library",
                id: "avatar-1",
                snapshot: { name: "브랜드 모델", representativeImageUrl: "https://cdn.example/avatar.png" },
              },
            } satisfies ContentOrchestration,
          },
        };
      });
    });

    expect(await screen.findByRole("tab", { name: "기획 근거" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("tab", { name: "카피" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "완성본" })).toBeVisible();
    expect(screen.getByRole("tab", { name: "게시" })).toBeVisible();
    expect(screen.getByText("여름 피부 관리")).toBeVisible();
    expect(screen.getByText("민감성 피부 고객")).toBeVisible();
    expect(screen.getByText("동결된 구현안 제목")).toBeVisible();
    expect(screen.getByText(/동결된 레퍼런스 제목/)).toBeVisible();
    expect(screen.getByText("동결된 브랜드 모델")).toBeVisible();

    await user.click(screen.getByRole("tab", { name: "카피" }));
    expect(screen.getByText("핵심 메시지: 여름 캠페인 시작")).toBeVisible();
    await user.click(screen.getByRole("tab", { name: "완성본" }));
    expect(screen.getByRole("button", { name: "카드뉴스 표지 결과 ZIP 다운로드" })).toBeEnabled();
    await user.click(screen.getByRole("tab", { name: "게시" }));
    expect(screen.getByText("Instagram OAuth 게시 계정 미연결")).toBeVisible();

    expect(gateway.listReferences).not.toHaveBeenCalled();
    expect(gateway.retryOutput).not.toHaveBeenCalled();
  });

  it("edits and saves structured copy separately from worker-backed regeneration", async () => {
    const user = userEvent.setup();
    const { gateway } = renderGeneration("generation-card-complete", false, (configuredGateway) => {
      const getGeneration = configuredGateway.getGeneration.bind(configuredGateway);
      configuredGateway.getGeneration = vi.fn(async (brandId, generationId) => {
        const result = await getGeneration(brandId, generationId);
        return {
          ...result,
          outputs: result.outputs.map((output) => ({
            ...output,
            copy: {
              hook: "저장 전 훅",
              keyMessage: "저장 전 핵심 메시지",
              body: "저장 전 본문",
              cta: "저장 전 CTA",
              caption: "저장 전 캡션",
              hashtags: ["기존", "태그"],
            },
            revisionCapabilities: [
              "save_copy",
              "regenerate_hook",
              "regenerate_copy",
            ] as NonNullable<typeof output.revisionCapabilities>,
          })),
        };
      });
      configuredGateway.saveOutputCopy = vi.fn(async (_brandId, _outputId, input) => {
        const result = await getGeneration("brand-1", "generation-card-complete");
        return {
          ...result.outputs[0],
          copy: {
            hook: "",
            keyMessage: "",
            body: "",
            cta: "",
            caption: "",
            hashtags: [],
            ...input.fields,
          },
        };
      });
    });

    await user.click(await screen.findByRole("tab", { name: "카피" }));
    expect(screen.getByDisplayValue("저장 전 훅")).toBeVisible();
    expect(screen.getByDisplayValue("저장 전 핵심 메시지")).toBeVisible();
    expect(screen.getByDisplayValue("저장 전 본문")).toBeVisible();
    expect(screen.getByDisplayValue("저장 전 CTA")).toBeVisible();
    expect(screen.getByDisplayValue("저장 전 캡션")).toBeVisible();
    expect(screen.getByDisplayValue("기존, 태그")).toBeVisible();
    expect(screen.getByRole("button", { name: "훅 다시 생성" })).toBeVisible();

    const cta = screen.getByLabelText("카드뉴스 표지 CTA");
    await user.clear(cta);
    await user.type(cta, "지금 확인");
    await user.click(screen.getByRole("button", { name: "카드뉴스 표지 카피 저장" }));

    expect(gateway.saveOutputCopy).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000100",
      "output-card-news",
      expect.objectContaining({
        fields: expect.objectContaining({ cta: "지금 확인" }),
        idempotencyKey: expect.any(String),
      }),
    );
    expect(await screen.findByText("카피를 저장했습니다.")).toBeVisible();
  });

  it("hides unsupported revision and publish actions for a legacy Reel result", async () => {
    renderGeneration("generation-card-complete", true, (gateway) => {
      const getGeneration = gateway.getGeneration.bind(gateway);
      gateway.getGeneration = vi.fn(async (brandId, generationId) => {
        const result = await getGeneration(brandId, generationId);
        return {
          ...result,
          outputs: result.outputs.map((output) => ({
            ...output,
            legacyReadOnly: true,
            revisionCapabilities: [],
            artifact: output.artifact
              ? { ...output.artifact, deliveryFormat: "instagram_reel" as const }
              : null,
          })),
        };
      });
    });

    expect(await screen.findByText("과거 Reel 결과는 읽기 전용입니다.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /훅.*재생성|카피.*재생성|카드.*재생성/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "SNS에 바로 게시" })).not.toBeInTheDocument();
  });

  it("queues supported hook, copy, and individual-card revisions from review", async () => {
    const user = userEvent.setup();
    const { gateway } = renderGeneration("generation-card-complete", false, (configuredGateway) => {
      const getGeneration = configuredGateway.getGeneration.bind(configuredGateway);
      configuredGateway.getGeneration = vi.fn(async (brandId, generationId) => {
        const result = await getGeneration(brandId, generationId);
        return {
          ...result,
          outputs: result.outputs.map((output) => ({
            ...output,
            revisionCapabilities: [
              "regenerate_hook",
              "regenerate_copy",
              "regenerate_card",
            ] as Array<"regenerate_hook" | "regenerate_copy" | "regenerate_card">,
          })),
        };
      });
      configuredGateway.reviseOutput = vi.fn(configuredGateway.reviseOutput);
    });

    await user.click(await screen.findByRole("button", { name: "1번 카드 다시 생성" }));

    expect(gateway.reviseOutput).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000100",
      "output-card-news",
      expect.objectContaining({
        action: "regenerate_card",
        cardIndex: 1,
        idempotencyKey: expect.any(String),
      }),
    );
  });

  it("keeps completed outputs untouched while retrying only a failed output from review", async () => {
    const user = userEvent.setup();
    const { gateway } = renderGeneration("generation-partial", false, (configuredGateway) => {
      configuredGateway.retryOutput = vi.fn(configuredGateway.retryOutput);
    });

    await user.click(await screen.findByRole("tab", { name: "완성본" }));
    const outputRows = screen.getAllByRole("listitem");
    const failedOutputRow = outputRows[1];
    await user.type(within(failedOutputRow).getByLabelText("문제 해결형 다시 생성 사유"), "실패한 이미지만 다시 생성");
    await user.click(within(failedOutputRow).getByRole("button", { name: /결과 2 다시 생성/ }));

    expect(gateway.retryOutput).toHaveBeenCalledTimes(1);
    expect(gateway.retryOutput).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000100",
      "output-marketing-2",
      "실패한 이미지만 다시 생성",
    );
    expect(within(outputRows[0]).getByRole("button", { name: "혜택 강조형 결과 ZIP 다운로드" })).toBeEnabled();
  });

  it("publishes a completed card-news output directly when Instagram is connected", async () => {
    const user = userEvent.setup();
    const { gateway } = renderGeneration("generation-card-complete", true);
    await user.click(await screen.findByRole("checkbox", { name: "게시물" }));
    const publishButton = screen.getByRole("button", { name: "선택한 1개 유형 게시" });
    await user.click(publishButton);
    expect(gateway.publishOutput).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000100", "output-card-news", expect.objectContaining({
      targets: [{ channel: "instagram", deliveryFormat: "instagram_feed_carousel" }],
    }));
    expect(await screen.findByText("게시 완료")).toBeVisible();
    expect(screen.getByRole("link", { name: "게시 큐에서 확인" })).toHaveAttribute(
      "href",
      "/publish-queue?queueId=queue-output-card-news-0",
    );
  });

  it("shows a structured Story preflight failure in Korean", async () => {
    const user = userEvent.setup();
    const { gateway } = renderGeneration("generation-card-complete", true);
    gateway.publishOutput = vi.fn(async () => {
      throw new ApiRequestError({ status: 409, errorCode: "instagram_public_url_required" });
    });

    await user.click(await screen.findByRole("checkbox", { name: "스토리" }));
    await user.click(screen.getByRole("button", { name: "선택한 1개 유형 게시" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Instagram에서 결과물 이미지에 접근하지 못했습니다. 공개 이미지 주소를 확인해 주세요.",
    );
  });

  it("shows the artifact preview before Instagram publish choices", async () => {
    renderGeneration("generation-card-complete", true);

    const publishRegion = await screen.findByRole("region", { name: "SNS에 바로 게시" });
    const previewImage = screen.getByRole("img", { name: "카드뉴스 슬라이드 1" });

    expect(previewImage.compareDocumentPosition(publishRegion) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(within(publishRegion).getByRole("checkbox", { name: "게시물" })).toBeEnabled();
    expect(within(publishRegion).getByRole("checkbox", { name: "스토리" })).toBeEnabled();
    expect(within(publishRegion).queryByRole("checkbox", { name: "릴스" })).not.toBeInTheDocument();
  });
});
