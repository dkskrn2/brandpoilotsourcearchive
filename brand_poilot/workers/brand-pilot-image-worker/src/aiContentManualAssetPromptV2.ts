import { buildAiContentBlogAssetPromptV2 } from "./aiContentBlogAssetPromptV2.js";
import { buildAiContentCardNewsAssetPromptV2 } from "./aiContentCardNewsAssetPromptV2.js";
import { buildAiContentReelAssetPromptV2 } from "./aiContentReelAssetPromptV2.js";
import type { AiContentManualAssetPromptV2Input } from "./aiContentManualAssetPromptV2Common.js";

export type { AiContentManualAssetPromptV2Input } from "./aiContentManualAssetPromptV2Common.js";

export function buildAiContentManualAssetPromptV2(input: AiContentManualAssetPromptV2Input): string {
  switch (input.renderContract.outputFormat) {
    case "card_news": return buildAiContentCardNewsAssetPromptV2(input);
    case "reel": return buildAiContentReelAssetPromptV2(input);
    case "blog": return buildAiContentBlogAssetPromptV2(input);
  }
}
