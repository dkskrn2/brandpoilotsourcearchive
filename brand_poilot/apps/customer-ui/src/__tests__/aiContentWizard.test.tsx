import { act, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import { createMockAiContentGateway } from "../features/ai-content/mockAiContentGateway";

const proposalFlowSpy = vi.hoisted(() => vi.fn());

vi.mock("../components/ai-content/ContentProposalFlow", () => ({
  ContentProposalFlow: (props: unknown) => {
    proposalFlowSpy(props);
    return <div>V2 콘텐츠 구성안 흐름</div>;
  },
}));

import { ContentProposalFlow } from "../components/ai-content/ContentProposalFlow";
import { AiContentWizardPage } from "../pages/AiContentWizardPage";

function Location() {
  return <span data-testid="location">{useLocation().search}</span>;
}

function renderWizard(path: string, calendarProvisioner?: (brandId: string, input: never) => Promise<unknown>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/ai-content/new" element={<><AiContentWizardPage gateway={createMockAiContentGateway()} brandId="brand-demo" calendarProvisioner={calendarProvisioner as never} /><Location /></>} />
      </Routes>
    </MemoryRouter>,
  );
}

function latestProps() {
  return proposalFlowSpy.mock.calls.at(-1)?.[0] as ComponentProps<typeof ContentProposalFlow>;
}

describe("AiContentWizardPage active entry", () => {
  beforeEach(() => proposalFlowSpy.mockClear());

  it.each(["card_news", "blog", "marketing"])("ignores the retired direct-generation type=%s entry", (type) => {
    renderWizard(`/ai-content/new?type=${type}`);

    expect(screen.getByText("V2 콘텐츠 구성안 흐름")).toBeVisible();
    expect(latestProps().initialSetup!.format).toBeNull();
  });

  it.each(["card_news", "blog", "reel"] as const)("accepts active proposalFormat=%s", (proposalFormat) => {
    renderWizard(`/ai-content/new?proposalFormat=${proposalFormat}&proposalFamily=marketing&proposalChannels=instagram,unknown`);

    expect(latestProps().initialSetup).toMatchObject({
      family: "marketing",
      format: proposalFormat,
      channels: ["instagram"],
    });
  });

  it("rejects retired proposal formats instead of remapping them", () => {
    renderWizard("/ai-content/new?proposalFormat=single_image");
    expect(latestProps().initialSetup!.format).toBeNull();
  });

  it("preserves proposal batch, reference, and analyzed-subject handoff inputs", () => {
    renderWizard("/ai-content/new?proposalBatch=batch-1&reference=reference-1&analysis=analysis-1");
    expect(latestProps()).toMatchObject({
      initialBatchId: "batch-1",
      initialSeedReferenceId: "reference-1",
      initialAnalyzedSubjectId: "analysis-1",
    });
  });

  it("passes the today's-topic deep link to the proposal flow", () => {
    renderWizard("/ai-content/new?view=today&suggestionId=suggestion-1");
    expect(latestProps()).toMatchObject({
      initialSuggestionId: "suggestion-1",
      initialSuggestionView: true,
    });
  });

  it("accepts the legacy suggestions view as an alias for today's topics", () => {
    renderWizard("/ai-content/new?view=suggestions");
    expect(latestProps().initialSuggestionView).toBe(true);
  });

  it("removes only an invalid seed reference from the active URL", () => {
    renderWizard("/ai-content/new?reference=missing&proposalFormat=reel");
    act(() => latestProps().onSeedReferenceInvalid?.());
    expect(screen.getByTestId("location")).toHaveTextContent("?proposalFormat=reel");
  });

  it("provisions the reserved calendar slot only after a proposal creates a generation draft", async () => {
    const calendarProvisioner = vi.fn(async () => ({}));
    renderWizard("/ai-content/new?proposalFamily=informational&proposalFormat=reel&proposalChannels=instagram&proposalTopic=SNS%20마케팅&calendarScheduledFor=2026-09-01T02%3A30%3A00.000Z&calendarIdempotencyKey=calendar-key", calendarProvisioner);

    await latestProps().onGenerationDraftReady?.({ generationId: "generation-1", contentFormat: "reel" });

    expect(calendarProvisioner).toHaveBeenCalledWith("brand-demo", {
      scheduledFor: "2026-09-01T02:30:00.000Z",
      channel: "instagram",
      contentFormat: "reel",
      idempotencyKey: "calendar-key",
      source: { kind: "existing_generation", generationId: "generation-1" },
    });
  });
});
