import { useSearchParams } from "react-router-dom";
import { ContentProposalFlow } from "../components/ai-content/ContentProposalFlow";
import { aiContentApiGateway } from "../features/ai-content/aiContentApiGateway";
import type {
  AiContentGateway,
  ContentChannelTarget,
  ContentOutputFormatV2,
} from "../features/ai-content/types";
import { DEMO_BRAND_ID } from "../lib/apiClient";

const proposalFormats: readonly ContentOutputFormatV2[] = ["card_news", "blog", "reel"];
const proposalChannels: readonly ContentChannelTarget[] = [
  "instagram",
  "threads",
  "x",
  "linkedin",
  "youtube",
  "tiktok",
  "blog_export",
];

function activeProposalFormat(value: string | null): ContentOutputFormatV2 | null {
  return proposalFormats.includes(value as ContentOutputFormatV2)
    ? value as ContentOutputFormatV2
    : null;
}

function activeProposalChannels(value: string | null): ContentChannelTarget[] {
  return (value ?? "")
    .split(",")
    .filter((channel): channel is ContentChannelTarget => proposalChannels.includes(channel as ContentChannelTarget));
}

export function AiContentWizardPage({
  gateway = aiContentApiGateway,
  brandId = DEMO_BRAND_ID,
}: {
  gateway?: AiContentGateway;
  brandId?: string;
}) {
  const [params, setParams] = useSearchParams();

  return <ContentProposalFlow
    brandId={brandId}
    gateway={gateway}
    initialBatchId={params.get("proposalBatch")}
    initialSeedReferenceId={params.get("reference")}
    initialAnalyzedSubjectId={params.get("analysis")}
    initialSuggestionId={params.get("suggestionId")}
    initialSuggestionView={["today", "suggestions"].includes(params.get("view") ?? "")}
    initialSetup={{
      family: params.get("proposalFamily") === "informational" || params.get("proposalFamily") === "marketing"
        ? params.get("proposalFamily") as "informational" | "marketing"
        : null,
      topic: params.get("proposalTopic") ?? "",
      format: activeProposalFormat(params.get("proposalFormat")),
      channels: activeProposalChannels(params.get("proposalChannels")),
      brief: params.get("proposalBrief") ?? "",
    }}
    onSeedReferenceInvalid={() => {
      const next = new URLSearchParams(params);
      next.delete("reference");
      setParams(next, { replace: true });
    }}
  />;
}
