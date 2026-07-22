import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { BrandEvidenceInputStep } from "./BrandEvidenceInputStep";

describe("BrandEvidenceInputStep", () => {
  it("accumulates files selected in separate picker sessions", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<BrandEvidenceInputStep busy={false} error={null} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("회사 문서 선택");
    const first = new File(["first"], "first.txt", { type: "text/plain" });
    const second = new File(["second"], "second.md", { type: "text/markdown" });

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.change(input, { target: { files: [second] } });
    await userEvent.click(screen.getByRole("button", { name: "분석 시작" }));

    expect(onSubmit).toHaveBeenCalledWith({ ownedUrl: null, files: [first, second] });
  });

  it("removes only the selected item when files have the same name and size", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<BrandEvidenceInputStep busy={false} error={null} onSubmit={onSubmit} />);
    const input = screen.getByLabelText("회사 문서 선택");
    const first = new File(["same"], "brief.txt", { type: "text/plain", lastModified: 1 });
    const second = new File(["same"], "brief.txt", { type: "text/plain", lastModified: 2 });

    fireEvent.change(input, { target: { files: [first] } });
    fireEvent.change(input, { target: { files: [second] } });
    const removeButtons = screen.getAllByRole("button", { name: "brief.txt 삭제" });
    expect(removeButtons).toHaveLength(2);

    await userEvent.click(removeButtons[0]);
    await userEvent.click(screen.getByRole("button", { name: "분석 시작" }));
    expect(onSubmit).toHaveBeenCalledWith({ ownedUrl: null, files: [second] });
  });
});
