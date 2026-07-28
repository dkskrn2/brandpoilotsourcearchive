import type { ContentCreationPhase, ContentSetupSection } from "./types";

export interface ContentWizardState {
  phase: ContentCreationPhase;
  activeSection: ContentSetupSection;
  completedSections: readonly ContentSetupSection[];
  selectedProposalId: string | null;
}

export type ContentWizardEvent =
  | { type: "open_section"; section: ContentSetupSection }
  | { type: "complete_section"; section: ContentSetupSection }
  | { type: "select_proposal"; proposalId: string }
  | { type: "start_generation" }
  | { type: "start_review" }
  | { type: "resume_batch_failed" };

const setupOrder: ContentSetupSection[] = ["intent", "sources", "delivery"];

export function createContentWizardState(): ContentWizardState {
  return { phase: "setup", activeSection: "intent", completedSections: [], selectedProposalId: null };
}

export function transitionContentWizard(state: ContentWizardState, event: ContentWizardEvent): ContentWizardState {
  if (event.type === "open_section") {
    const requestedIndex = setupOrder.indexOf(event.section);
    const firstIncomplete = setupOrder.findIndex((section) => !state.completedSections.includes(section));
    if (requestedIndex > (firstIncomplete < 0 ? setupOrder.length - 1 : firstIncomplete)) return state;
    return { ...state, phase: "setup", activeSection: event.section };
  }
  if (event.type === "complete_section") {
    if (state.phase !== "setup" || state.activeSection !== event.section) return state;
    const completedSections = state.completedSections.includes(event.section)
      ? state.completedSections
      : [...state.completedSections, event.section];
    const next = setupOrder.find((section) => !completedSections.includes(section));
    return next
      ? { ...state, activeSection: next, completedSections }
      : { ...state, phase: "proposal_selection", completedSections };
  }
  if (event.type === "select_proposal" && state.phase === "proposal_selection") {
    return { ...state, selectedProposalId: event.proposalId };
  }
  if (event.type === "start_generation" && state.phase === "proposal_selection" && state.selectedProposalId) {
    return { ...state, phase: "generating" };
  }
  if (event.type === "start_review" && state.phase === "generating") return { ...state, phase: "reviewing" };
  if (event.type === "resume_batch_failed") {
    return { ...state, phase: "setup", activeSection: "delivery", selectedProposalId: null };
  }
  return state;
}
