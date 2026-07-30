import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FileUploadButton } from "./FileUploadButton";
import { UploadProgress } from "./UploadProgress";

describe("FileUploadButton", () => {
  it("exposes only the styled picker in the keyboard tab order", async () => {
    const user = userEvent.setup();
    render(
      <FileUploadButton
        inputLabel="회사 문서 선택"
        buttonLabel="문서 추가"
        accept=".pdf,.txt"
        onFiles={vi.fn()}
      />,
    );

    const input = screen.getByLabelText("회사 문서 선택");
    const picker = screen.getByRole("button", { name: "문서 추가" });
    expect(input).toHaveAttribute("tabindex", "-1");
    await user.tab();
    expect(picker).toHaveFocus();
  });

  it("keeps the file input accessible while using a styled picker", async () => {
    const onFiles = vi.fn();
    render(
      <FileUploadButton
        inputLabel="회사 문서 선택"
        buttonLabel="문서 추가"
        accept=".pdf,.txt"
        multiple
        onFiles={onFiles}
      />,
    );

    const input = screen.getByLabelText("회사 문서 선택");
    const picker = screen.getByRole("button", { name: "문서 추가" });
    expect(input).toHaveClass("visually-hidden");
    expect(input).toHaveAttribute("accept", ".pdf,.txt");
    expect(input).toHaveAttribute("multiple");

    const click = vi.spyOn(input, "click");
    picker.focus();
    fireEvent.keyDown(picker, { key: "Enter" });
    expect(click).toHaveBeenCalledOnce();

    const file = new File(["brief"], "brief.txt", { type: "text/plain" });
    await userEvent.upload(input, file);
    expect(onFiles).toHaveBeenCalledWith([file]);
  });

  it("shows selected files with size and removes an item", async () => {
    const onRemove = vi.fn();
    render(
      <FileUploadButton
        inputLabel="이미지 선택"
        buttonLabel="이미지 추가"
        accept="image/png"
        items={[{ id: "asset-1", name: "product.png", size: 1536, status: "selected" }]}
        onFiles={vi.fn()}
        onRemove={onRemove}
      />,
    );

    expect(screen.getByText("product.png")).toBeVisible();
    expect(screen.getByText(/1\.5 KB/)).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "product.png 삭제" }));
    expect(onRemove).toHaveBeenCalledWith("asset-1");
  });
});

describe("UploadProgress", () => {
  it("exposes the current percentage to assistive technology", () => {
    render(<UploadProgress value={42.4} label="brief.pdf 업로드" />);

    expect(screen.getByRole("progressbar", { name: "brief.pdf 업로드" })).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByText("42%")).toBeVisible();
  });
});
