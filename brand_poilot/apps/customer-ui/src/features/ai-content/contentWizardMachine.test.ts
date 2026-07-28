import { describe, expect, it } from "vitest";
import {
  createContentWizardState,
  transitionContentWizard,
} from "./contentWizardMachine";

describe("contentWizardMachine", () => {
  it("opens setup sections in order and prevents skipping required sections", () => {
    const initial = createContentWizardState();

    expect(transitionContentWizard(initial, { type: "open_section", section: "sources" })).toEqual(initial);

    const sources = transitionContentWizard(initial, { type: "complete_section", section: "intent" });
    expect(sources).toMatchObject({ phase: "setup", activeSection: "sources", completedSections: ["intent"] });

    expect(transitionContentWizard(sources, { type: "open_section", section: "delivery" })).toEqual(sources);
  });

  it("enters proposal selection only after all setup sections are complete", () => {
    const intent = transitionContentWizard(createContentWizardState(), { type: "complete_section", section: "intent" });
    const sources = transitionContentWizard(intent, { type: "complete_section", section: "sources" });
    const delivery = transitionContentWizard(sources, { type: "complete_section", section: "delivery" });

    expect(delivery).toMatchObject({
      phase: "proposal_selection",
      activeSection: "delivery",
      completedSections: ["intent", "sources", "delivery"],
    });
  });

  it("requires a proposal before generating and returns failed resume attempts to setup", () => {
    const ready = {
      ...createContentWizardState(),
      phase: "proposal_selection" as const,
      completedSections: ["intent", "sources", "delivery"] as const,
    };

    expect(transitionContentWizard(ready, { type: "start_generation" })).toEqual(ready);
    expect(transitionContentWizard(ready, { type: "select_proposal", proposalId: "proposal-1" }))
      .toMatchObject({ selectedProposalId: "proposal-1" });
    expect(transitionContentWizard(ready, { type: "resume_batch_failed" }))
      .toMatchObject({ phase: "setup", activeSection: "delivery" });
  });
});
