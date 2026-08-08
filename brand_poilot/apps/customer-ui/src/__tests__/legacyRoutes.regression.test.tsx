import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ContentStrategyStep } from "../components/ai-content/ContentStrategyStep";
import {
  LegacyArchiveRedirect,
  LegacyBrandSettingsRedirect,
  LegacyInstagramTrendsRedirect,
  LegacySourcesRedirect,
  router,
} from "../routes";

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

const componentMappings = [
  ["/brand-settings", "/brand-center?tab=understanding&section=core", LegacyBrandSettingsRedirect, "/brand-center"],
  ["/sources", "/brand-center?tab=understanding&section=sources", LegacySourcesRedirect, "/brand-center"],
  ["/archive", "/references?view=saved-trends", LegacyArchiveRedirect, "/references"],
  ["/instagram-trends", "/references?view=trends", LegacyInstagramTrendsRedirect, "/references"],
] as const;

describe("legacy customer routes", () => {
  it.each(componentMappings)("maps %s to %s", async (legacy, canonical, Redirect, canonicalPath) => {
    render(
      <MemoryRouter initialEntries={[legacy]}>
        <Routes>
          <Route path={legacy} element={<Redirect />} />
          <Route path={canonicalPath} element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(canonical)).toBeVisible();
  });

  it("keeps inline legacy routes, login, and support in the executable route table", () => {
    const shell = router.routes.find((route) => route.path === "/");
    const children = shell?.children ?? [];
    const path = (value: string) => children.find((route) => route.path === value);
    const redirectTarget = (value: string) => {
      const route = path(value);
      return route && "element" in route
        ? (route.element as { props?: { to?: string } } | undefined)?.props?.to
        : undefined;
    };

    expect(redirectTarget("content")).toBe("/publish-queue?status=needs_review");
    expect(redirectTarget("onboarding")).toBe("/onboarding/brand-intelligence");
    expect(router.routes.some((route) => route.path === "/login")).toBe(true);
    expect(path("support")).toBeDefined();
  });

  it("offers only the canonical static content formats", () => {
    render(
      <ContentStrategyStep
        outputFormat="card_news"
        channelTarget={null}
        loading={false}
        capabilityState={{
          status: "ready",
          capabilities: [],
          policy: {
            retryAllowed: false,
            existingDraftMayBeSaved: true,
            generationStartAllowed: true,
          },
        }}
        onFormatChange={() => undefined}
        onChannelChange={() => undefined}
        onSubmit={() => undefined}
      />,
    );

    expect(screen.getAllByRole("radio").map((option) => (option as HTMLInputElement).value)).toEqual([
      "card_news",
      "blog",
      "reel",
    ]);
    expect(screen.queryByText(/Reel|Shorts|TikTok 영상|영상 Story|AI 아바타|얼굴 합성|음성 복제/)).not.toBeInTheDocument();
  });

  it("does not register excluded product surfaces as customer routes", () => {
    const shell = router.routes.find((route) => route.path === "/");
    const paths = (shell?.children ?? []).map((route) => route.path);

    expect(paths).not.toEqual(expect.arrayContaining([
      "period-offers",
      "influencer-marketplace",
      "global-ad-database",
      "realtime-monitoring",
      "dm-automation/comment-triggers",
      "ai-avatar",
      "face-swap",
      "voice-clone",
    ]));
  });
});
