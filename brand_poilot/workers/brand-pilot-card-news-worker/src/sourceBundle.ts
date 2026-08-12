import type { ContentGenerationInputV3 } from "@brand-pilot/content-contracts";
import {
  projectEditorialProductFacts,
  projectEditorialVisualInputs,
} from "@brand-pilot/content-contracts/editorial-visual-context";

export type CardDeckSourceBundle = ReturnType<typeof buildCardDeckSourceBundle>;

export function buildCardDeckSourceBundle(input: ContentGenerationInputV3) {
  return {
    intent: {
      contentInstruction: input.contentInstruction,
      outputSettings: input.outputSettings,
      selectedProposal: input.selectedProposal,
    },
    subject: input.subject,
    factualSources: {
      researchEvidence: input.researchEvidence,
      product: projectEditorialProductFacts(input),
    },
    editorialReferences: input.references.selected.map(({ roles, title, sourceUrl, text }) => ({
      roles, title, sourceUrl, text,
    })),
    visualReferences: projectEditorialVisualInputs(input),
    brandContext: {
      brandCore: input.brandCore,
      brandRules: input.brandRules,
    },
  };
}
