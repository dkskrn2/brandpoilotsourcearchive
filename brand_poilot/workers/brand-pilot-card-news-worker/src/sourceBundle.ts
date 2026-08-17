import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";
import type { FrozenManualVisualSelectionV1 } from "@brand-pilot/content-contracts/manual-visual-selection";
import {
  projectManualEditorialProductFacts,
  projectManualEditorialVisualInputs,
} from "@brand-pilot/content-contracts/editorial-visual-context";

export type CardDeckSourceBundle = ReturnType<typeof buildCardDeckSourceBundle>;

export function buildCardDeckSourceBundle(input: ContentGenerationInputV3, selection: FrozenManualVisualSelectionV1) {
  return {
    intent: {
      contentInstruction: input.contentInstruction,
      outputSettings: input.outputSettings,
      selectedProposal: input.selectedProposal,
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
