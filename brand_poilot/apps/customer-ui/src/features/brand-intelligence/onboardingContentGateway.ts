import { apiClient } from "../../lib/apiClient";

export type OnboardingContentState = {
  state: "not_started" | "preparing" | "generating" | "completed" | "failed";
  proposalBatchId: string | null;
  generationId: string | null;
  title: string | null;
  progress: unknown;
  outputs: unknown[];
  errorCode: string | null;
  errorMessage: string | null;
};

export interface OnboardingContentGateway {
  reconcile(brandId: string, analysisId: string, signal?: AbortSignal): Promise<OnboardingContentState>;
  start(brandId: string, analysisId: string, input: {
    categoryCode: string;
    subcategoryCodes: string[];
    suggestionId: string;
    contentInstruction: string | null;
    idempotencyKey: string;
  }): Promise<OnboardingContentState>;
}

export function createOnboardingContentGateway(
  options: { baseUrl?: string; fetcher?: typeof fetch } = {},
): OnboardingContentGateway {
  const client = apiClient(options);
  const path = (brandId: string, analysisId: string) => (
    `/brands/${brandId}/brand-analyses/${analysisId}/onboarding-content`
  );
  return {
    reconcile(brandId, analysisId, signal) {
      return client.requestJson<OnboardingContentState>(`${path(brandId, analysisId)}/reconcile`, {
        method: "POST",
        signal,
      });
    },
    start(brandId, analysisId, input) {
      return client.requestJson<OnboardingContentState>(path(brandId, analysisId), {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
  };
}

export const onboardingContentGateway = createOnboardingContentGateway();
