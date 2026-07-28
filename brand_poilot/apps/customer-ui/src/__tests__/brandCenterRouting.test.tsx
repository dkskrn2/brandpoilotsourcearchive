import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { LegacyBrandSettingsRedirect } from "../routes";

function LocationProbe() {
  const location = useLocation();
  return <output>{location.pathname}{location.search}</output>;
}

describe("legacy brand settings redirect", () => {
  it("preserves non-conflicting query values and normalizes the canonical section", async () => {
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
});
