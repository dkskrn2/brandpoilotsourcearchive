import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BRAND_STATUS_CHANGED_EVENT } from "../lib/apiClient";
import { BrandStatusProvider } from "../lib/brandStatus";

const initialStatus = {
  brandId: "brand-1",
  brandName: "Brand",
  lastGeneratedAt: null,
  navigation: {
    onboardingRemaining: 1,
    contentReview: 0,
    publishIssues: 0,
    channelIssues: 0
  },
  onboarding: {
    completedCount: 1,
    totalCount: 2,
    remainingCount: 1,
    steps: []
  }
};

describe("BrandStatusProvider regression", () => {
  it("refreshes shell status when a mutation event is dispatched", async () => {
    const getBrandUiStatus = vi.fn(async () => ({
      ...initialStatus,
      navigation: { ...initialStatus.navigation, onboardingRemaining: 0 },
      onboarding: { ...initialStatus.onboarding, remainingCount: 0 }
    }));
    render(
      <BrandStatusProvider initialStatus={initialStatus} client={{ getBrandUiStatus }}>
        <div>child</div>
      </BrandStatusProvider>
    );

    window.dispatchEvent(new Event(BRAND_STATUS_CHANGED_EVENT));

    await waitFor(() => expect(getBrandUiStatus).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000100"));
  });
});
