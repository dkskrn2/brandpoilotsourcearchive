import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";
import type { FrozenManualVisualSelectionV1 } from "@brand-pilot/content-contracts/manual-visual-selection";
import {
  projectManualEditorialProductFacts,
  projectManualEditorialVisualInputs,
} from "@brand-pilot/content-contracts/editorial-visual-context";

export type CardDeckSourceBundle = ReturnType<typeof buildCardDeckSourceBundle>;

function projectProposalLens(input: ContentGenerationInputV3) {
  const proposal = input.selectedProposal;
  const informational = proposal.purposeDetails?.kind === "informational"
    ? proposal.purposeDetails
    : null;
  return {
    angle: proposal.title,
    target: proposal.target,
    customerContext: proposal.customerContext,
    purposeDetails: proposal.purposeDetails,
    question: informational?.question ?? null,
    whyNow: informational?.whyNow ?? null,
    oneLineIntent: proposal.oneLineIntent,
    keyMessage: proposal.keyMessage,
    differentiator: proposal.differentiator,
    hook: proposal.hook,
    informationalType: proposal.informationalType,
    assetCount: proposal.assetCount,
  };
}

export function buildCardDeckSourceBundle(input: ContentGenerationInputV3, selection: FrozenManualVisualSelectionV1) {
  return {
    intent: {
      contentInstruction: input.contentInstruction,
      outputSettings: input.outputSettings,
      proposalLens: projectProposalLens(input),
    },
    subject: input.subject,
    factualSources: {
      researchEvidence: input.researchEvidence,
      product: projectManualEditorialProductFacts(selection),
    },
    editorialReferences: input.references.selected.map(({ roles, title, sourceUrl, text }) => ({
      roles, title, sourceUrl, text,
    })),
    visualReferences: projectManualEditorialVisualInputs(input, selection),
    brandContext: {
      brandCore: input.brandCore,
      brandRules: input.brandRules,
    },
  };
}
