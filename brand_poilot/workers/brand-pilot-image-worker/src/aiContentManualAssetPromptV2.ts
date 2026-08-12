import { buildAiContentBlogAssetPromptV2 } from "./aiContentBlogAssetPromptV2.js";
import type { AiContentManualAssetPromptV2Input } from "./aiContentManualAssetPromptV2Common.js";

export type { AiContentManualAssetPromptV2Input } from "./aiContentManualAssetPromptV2Common.js";

export function buildAiContentManualAssetPromptV2(input: AiContentManualAssetPromptV2Input): string {
  return buildAiContentBlogAssetPromptV2(input);
}
