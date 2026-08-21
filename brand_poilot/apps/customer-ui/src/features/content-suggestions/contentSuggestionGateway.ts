import { apiClient } from "../../lib/apiClient";

export type ContentSuggestionIntent = "informational" | "trend";

export interface ContentSuggestion {
  id: string;
  subcategoryCode: string;
  subcategoryName: string;
  intent: ContentSuggestionIntent;
  title: string;
  whyNow: string;
  contentBrief: string;
  sources?: Array<{
    url: string;
    title: string;
    publisher: string;
    publishedAt: string | null;
  }>;
}

export interface ContentSuggestionList {
  category: { code: string; name: string } | null;
  personal: ContentSuggestion[];
  general: ContentSuggestion[];
}

export interface ContentSuggestionGateway {
  list(brandId: string, signal?: AbortSignal): Promise<ContentSuggestionList>;
  listForSelection(
    brandId: string,
    categoryCode: string,
    subcategoryCodes: string[],
    signal?: AbortSignal,
  ): Promise<ContentSuggestionList>;
  get(brandId: string, suggestionId: string, signal?: AbortSignal): Promise<ContentSuggestion>;
}

export function createContentSuggestionGateway(options: { baseUrl?: string; fetcher?: typeof fetch } = {}): ContentSuggestionGateway {
  const client = apiClient(options);
  return {
    list(brandId, signal) {
      return client.requestJson<ContentSuggestionList>(`/brands/${brandId}/content-suggestions`, {
        method: "GET",
        signal,
      });
    },
    listForSelection(brandId, categoryCode, subcategoryCodes, signal) {
      const query = new URLSearchParams({
        categoryCode,
        subcategoryCodes: subcategoryCodes.join(","),
      });
      return client.requestJson<ContentSuggestionList>(
        `/brands/${brandId}/content-suggestions?${query.toString()}`,
        { method: "GET", signal },
      );
    },
    get(brandId, suggestionId, signal) {
      return client.requestJson<ContentSuggestion>(
        `/brands/${brandId}/content-suggestions/${encodeURIComponent(suggestionId)}`,
        { method: "GET", signal },
      );
    },
  };
}

export const contentSuggestionGateway = createContentSuggestionGateway();
