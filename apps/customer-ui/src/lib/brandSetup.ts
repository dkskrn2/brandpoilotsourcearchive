import type { BrandUiStatus } from "../types";

export function isBrandProfileComplete(status: BrandUiStatus | null) {
  if (!status) {
    return false;
  }

  const brandProfileStep = status.onboarding.steps.find((step) => step.id === "brand-profile");
  return brandProfileStep ? brandProfileStep.status === "completed" : true;
}

export function isBrandSetupPath(pathname: string) {
  return pathname === "/onboarding" || pathname === "/brand-settings" || pathname === "/support";
}
