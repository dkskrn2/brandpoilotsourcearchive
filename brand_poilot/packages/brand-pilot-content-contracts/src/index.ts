export * from "./catalog.js";
export * from "./snapshots.js";
export * from "./orchestration.js";
export * from "./proposal.js";
export * from "./generation.js";
export * from "./plans.js";
export * from "./manifest.js";
export * from "./binding.js";
export * from "./validators.js";

import { ContentOrchestrationV2Schema } from "./orchestration.js";
import {
  ContentProposalRequestV2Schema,
  ContentProposalSetV2Schema,
  ProposalBaseInputSnapshotV2Schema,
  ProposalInputSnapshotV2Schema,
} from "./proposal.js";
import { ResearchEvidenceSnapshotV1Schema } from "./snapshots.js";
import {
  ContentGenerationInputV3Schema,
  ImageGenerationPackageV1Schema,
} from "./generation.js";
import {
  BlogPlanV2Schema,
  CardNewsPlanV2Schema,
  ReelPlanV2Schema,
} from "./plans.js";
import { AiContentManifestV3Schema } from "./manifest.js";
import { ContentPromptBindingSchema } from "./binding.js";

export const ALL_CONTENT_SCHEMAS = {
  contentOrchestrationV2: ContentOrchestrationV2Schema,
  contentProposalRequestV2: ContentProposalRequestV2Schema,
  proposalBaseInputV2: ProposalBaseInputSnapshotV2Schema,
  proposalInputV2: ProposalInputSnapshotV2Schema,
  researchEvidenceV1: ResearchEvidenceSnapshotV1Schema,
  contentProposalV2: ContentProposalSetV2Schema,
  contentGenerationInputV3: ContentGenerationInputV3Schema,
  imageGenerationPackageV1: ImageGenerationPackageV1Schema,
  plans: {
    card_news: CardNewsPlanV2Schema,
    blog: BlogPlanV2Schema,
    reel: ReelPlanV2Schema,
  },
  aiContentV3: AiContentManifestV3Schema,
  contentPromptBindingV1: ContentPromptBindingSchema,
} as const;
