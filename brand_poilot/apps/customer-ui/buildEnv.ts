export const productionApiBaseUrl = "https://api.danbammsg.co.kr";
export const productionSupabaseUrl = "https://ehrtffyawkcmamnjnowu.supabase.co";

type CustomerBuildEnv = Record<string, string | undefined>;

export function assertCustomerBuildEnv(env: CustomerBuildEnv): string {
  const apiBaseUrl = env.VITE_API_BASE_URL?.trim() ?? "";
  const authDestination = env.VITE_AUTH_DESTINATION?.trim() ?? "";
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim() ?? "";
  const supabasePublishableKey = env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? "";
  const isProductionBuild =
    env.VERCEL === "1" || env.VERCEL_ENV === "production";

  if (
    (authDestination && authDestination !== "preview")
    || (env.VERCEL_ENV === "production" && authDestination)
  ) {
    throw new Error("VITE_AUTH_DESTINATION_invalid");
  }

  if (!isProductionBuild) {
    return apiBaseUrl;
  }

  if (!apiBaseUrl) {
    throw new Error("VITE_API_BASE_URL_required");
  }

  if (apiBaseUrl !== productionApiBaseUrl) {
    throw new Error("VITE_API_BASE_URL_invalid");
  }

  if (!supabaseUrl) {
    throw new Error("VITE_SUPABASE_URL_required");
  }

  if (supabaseUrl !== productionSupabaseUrl) {
    throw new Error("VITE_SUPABASE_URL_invalid");
  }

  if (!supabasePublishableKey) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY_required");
  }

  if (!supabasePublishableKey.startsWith("sb_publishable_")) {
    throw new Error("VITE_SUPABASE_PUBLISHABLE_KEY_invalid");
  }

  return apiBaseUrl;
}
