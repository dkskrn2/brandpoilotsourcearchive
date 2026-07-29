import { render, screen } from "@testing-library/react";
import { isValidElement } from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { AvatarLibraryPanel } from "../components/brand-center/AvatarLibraryPanel";
import { BrandCenterPage } from "../pages/BrandCenterPage";
import { BrandCenterPreviewPage } from "../pages/BrandCenterPreviewPage";
import { LegacyBrandSettingsRedirect, router } from "../routes";

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

describe("legacy brand settings redirect", () => {
  it("preserves non-conflicting query values for the legacy redirect", async () => {
    render(
      <MemoryRouter initialEntries={["/brand-settings?brandIntelligence=confirmed&tab=old"]}>
        <Routes>
          <Route path="/brand-settings" element={<LegacyBrandSettingsRedirect />} />
          <Route path="/brand-center" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(/brandIntelligence=confirmed/)).toHaveTextContent(
      "/brand-center?brandIntelligence=confirmed&tab=understanding&section=core",
    );
  });

  it("mounts the live six-tab page at the canonical brand-center route", () => {
    const appRoute = router.routes.find((route) => route.path === "/");
    const brandCenterRoute = appRoute?.children?.find(
      (route) => route.path === "brand-center",
    );
    const brandCenterElement = brandCenterRoute && "element" in brandCenterRoute
      ? brandCenterRoute.element
      : null;

    expect(isValidElement(brandCenterElement) && brandCenterElement.type)
      .toBe(BrandCenterPage);
    expect(typeof AvatarLibraryPanel).toBe("function");
  });

  it("uses the preview visual flow for canonical brand intelligence onboarding", () => {
    const appRoute = router.routes.find((route) => route.path === "/");
    const onboardingRoute = appRoute?.children?.find(
      (route) => route.path === "onboarding/brand-intelligence",
    );
    const onboardingElement = onboardingRoute && "element" in onboardingRoute
      ? onboardingRoute.element
      : null;

    expect(isValidElement(onboardingElement) && onboardingElement.type)
      .toBe(BrandCenterPreviewPage);
    expect(isValidElement(onboardingElement) && onboardingElement.props)
      .toMatchObject({ mode: "live" });
  });
});
