export const productionApiBaseUrl = "https://api.danbammsg.co.kr";

type CustomerBuildEnv = Record<string, string | undefined>;

export function assertCustomerBuildEnv(env: CustomerBuildEnv): string {
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim() ?? "";
  const isProductionBuild =
    env.VERCEL === "1" || env.VERCEL_ENV === "production";

  if (!isProductionBuild) {
    return apiBaseUrl;
  }

  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL_required");
  }

  if (apiBaseUrl !== productionApiBaseUrl) {
    throw new Error("VITE_API_BASE_URL_invalid");
  }

  return apiBaseUrl;
}
