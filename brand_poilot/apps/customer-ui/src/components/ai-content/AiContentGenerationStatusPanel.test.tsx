import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { AiGenerationStatus } from "../../features/ai-content/types";
import { AiContentGenerationStatusPanel } from "./AiContentGenerationStatusPanel";

afterEach(cleanup);

const labels: Record<AiGenerationStatus, string> = {
  draft: "생성 준비 중입니다.",
  analyzing: "입력 내용을 분석하고 있습니다.",
  analysis_ready: "분석을 완료하고 생성을 준비하고 있습니다.",
  queued: "생성 순서를 기다리고 있습니다.",
  planning: "선택한 구성안으로 콘텐츠를 기획하고 있습니다.",
  generating: "콘텐츠를 생성하고 있습니다.",
  completed: "콘텐츠 생성이 완료되었습니다.",
  partial_failed: "일부 결과만 완료되었습니다.",
  failed: "콘텐츠 생성에 실패했습니다.",
};

describe("AiContentGenerationStatusPanel", () => {
  it.each(Object.entries(labels) as Array<[AiGenerationStatus, string]>)
  ("renders only the real %s status", (status, label) => {
    render(<AiContentGenerationStatusPanel status={status} generationId="generation-123456789" />);

    expect(screen.getByRole("status")).toHaveTextContent(label);
    expect(screen.getByText("generation-123456789")).toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
    expect(screen.queryByText(/현재.*장면|예상 완료|남은 시간/)).not.toBeInTheDocument();
  });
});
