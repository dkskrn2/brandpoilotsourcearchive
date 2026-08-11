import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AiContentAssetProgress } from "./AiContentAssetProgress";

describe("AiContentAssetProgress", () => {
  it("shows actual planned asset progress and one state per index", () => {
    render(<AiContentAssetProgress progress={{
      phase: "rendering", totalAssets: 3, completedAssets: 1, failedAssets: 0,
      items: [
        { index: 1, role: "cover", status: "completed" },
        { index: 2, role: "detail", status: "processing" },
        { index: 3, role: "cta", status: "queued" },
      ],
      startedAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:04:00.000Z",
    }} />);

    expect(screen.getByRole("region", { name: "콘텐츠 제작 진행률" })).toBeInTheDocument();
    expect(screen.getByText("1 / 3개 완료")).toBeInTheDocument();
    expect(screen.getByText("33%")).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("제작 중")).toBeInTheDocument();
  });

  it("shows finalization without inventing image progress for a zero-image blog", () => {
    render(<AiContentAssetProgress progress={{
      phase: "finalizing", totalAssets: 0, completedAssets: 0, failedAssets: 0, items: [],
      startedAt: "2026-08-11T00:00:00.000Z", updatedAt: "2026-08-11T00:04:00.000Z",
    }} />);

    expect(screen.getByText("최종 파일을 정리하고 있습니다")).toBeInTheDocument();
    expect(screen.queryByText(/%/)).not.toBeInTheDocument();
  });
});
