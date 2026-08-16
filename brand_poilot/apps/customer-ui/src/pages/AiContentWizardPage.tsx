import { useSearchParams } from "react-router-dom";
import { ContentProposalFlow } from "../components/ai-content/ContentProposalFlow";
import { aiContentApiGateway } from "../features/ai-content/aiContentApiGateway";
import type {
  AiContentGateway,
  ContentChannelTarget,
  ContentOutputFormatV2,
} from "../features/ai-content/types";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type { PublishCalendarManualSlotInput } from "../types";
import { completePublishCalendarBulkDraftRow, loadPublishCalendarBulkDraft } from "../features/publishing/publishCalendarBulkDraft";

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
  calendarProvisioner = api.provisionPublishCalendarManualSlot,
}: {
  gateway?: AiContentGateway;
  brandId?: string;
  calendarProvisioner?: (brandId: string, input: PublishCalendarManualSlotInput) => Promise<unknown>;
}) {
  const [params, setParams] = useSearchParams();
  const calendarScheduledFor = params.get("calendarScheduledFor");
  const calendarIdempotencyKey = params.get("calendarIdempotencyKey");
  const calendarBatchDraftId = params.get("calendarBatchDraft");
  const calendarBatchRowId = params.get("calendarBatchRow");

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
      topicUrl: params.get("proposalUrl") ?? "",
      productId: params.get("product"),
      subjectMode: params.get("proposalUrl") ? "topic_url" : params.get("suggestionId") ? "suggestion" : params.get("reference") ? "reference" : "topic_text",
      format: activeProposalFormat(params.get("proposalFormat")),
      channels: activeProposalChannels(params.get("proposalChannels")),
      brief: params.get("proposalBrief") ?? "",
    }}
    onGenerationDraftReady={calendarBatchDraftId && calendarBatchRowId ? async ({ generationId }) => {
      const draft = loadPublishCalendarBulkDraft(calendarBatchDraftId);
      if (!draft || !draft.rows.some((row) => row.clientRowId === calendarBatchRowId)) throw new Error("publish_calendar_bulk_draft_missing");
      completePublishCalendarBulkDraftRow(draft, calendarBatchRowId, generationId);
      window.location.assign(`/publish-queue?view=calendar&calendarBatchDraft=${encodeURIComponent(calendarBatchDraftId)}`);
    } : calendarScheduledFor && calendarIdempotencyKey ? async ({ generationId, contentFormat }) => {
      await calendarProvisioner(brandId, {
        scheduledFor: calendarScheduledFor,
        channel: "instagram",
        contentFormat,
        idempotencyKey: calendarIdempotencyKey,
        source: { kind: "existing_generation", generationId },
      });
    } : undefined}
    onSeedReferenceInvalid={() => {
      const next = new URLSearchParams(params);
      next.delete("reference");
      setParams(next, { replace: true });
    }}
  />;
}
