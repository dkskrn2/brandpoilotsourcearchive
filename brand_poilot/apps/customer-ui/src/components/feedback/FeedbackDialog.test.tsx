import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FeedbackDialog } from "./FeedbackDialog";

describe("FeedbackDialog", () => {
  it("sends only the inquiry category and message, then clears both after success", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<FeedbackDialog onClose={vi.fn()} onSubmit={onSubmit} bookingUrl="https://booking.example.com/15min" />);

    expect(screen.getByRole("heading", { name: "통화 문의 예약하기" })).toBeVisible();
    expect(screen.getByRole("link", { name: "통화 문의 예약하기" })).toHaveAttribute("href", "https://booking.example.com/15min");
    expect(screen.queryByLabelText(/제목|전화|이메일/)).not.toBeInTheDocument();
    const category = screen.getByLabelText("문의 유형");
    const input = screen.getByRole("textbox", { name: "내용" });
    expect(category).toHaveFocus();
    await userEvent.selectOptions(category, "feature");
    await userEvent.type(input, "결과 미리보기를 개선해 주세요.");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(onSubmit).toHaveBeenCalledWith({
      category: "feature",
      message: "결과 미리보기를 개선해 주세요."
    });
    expect(await screen.findByRole("status")).toHaveTextContent("문의가 접수되었습니다.");
    expect(category).toHaveValue("");
    expect(input).toHaveValue("");
  });

  it("requires both fields, hides booking without a URL, and preserves failed input", async () => {
    const onSubmit = vi.fn(async () => { throw new Error("failed"); });
    render(<FeedbackDialog onClose={vi.fn()} onSubmit={onSubmit} bookingUrl="" />);

    const send = screen.getByRole("button", { name: "보내기" });
    expect(screen.getByRole("textbox", { name: "내용" })).toHaveAttribute("maxlength", "2000");
    expect(send).toBeDisabled();
    expect(screen.queryByRole("heading", { name: "통화 문의 예약하기" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "통화 문의 예약하기" })).not.toBeInTheDocument();

    await userEvent.type(screen.getByRole("textbox", { name: "내용" }), "전송 실패 확인");
    expect(send).toBeDisabled();
    await userEvent.selectOptions(screen.getByLabelText("문의 유형"), "bug");
    await userEvent.click(send);

    expect(await screen.findByRole("alert")).toHaveTextContent("문의를 보내지 못했습니다");
    expect(screen.getByLabelText("문의 유형")).toHaveValue("bug");
    expect(screen.getByRole("textbox", { name: "내용" })).toHaveValue("전송 실패 확인");
  });

  it("locks concurrent submits and does not resend the same successful opinion", async () => {
    let resolveSubmission!: () => void;
    const onSubmit = vi.fn(() => new Promise<void>((resolve) => {
      resolveSubmission = resolve;
    }));
    render(<FeedbackDialog onClose={vi.fn()} onSubmit={onSubmit} bookingUrl="" />);

    const category = screen.getByLabelText("문의 유형");
    const input = screen.getByRole("textbox", { name: "내용" });
    await userEvent.selectOptions(category, "other");
    await userEvent.type(input, "같은 의견은 한 번만 보냅니다.");
    const form = screen.getByRole("button", { name: "보내기" }).closest("form");
    expect(form).not.toBeNull();

    fireEvent.submit(form!);
    fireEvent.submit(form!);
    expect(onSubmit).toHaveBeenCalledTimes(1);

    resolveSubmission();
    expect(await screen.findByRole("status")).toHaveTextContent("문의가 접수되었습니다.");
    await userEvent.selectOptions(category, "other");
    await userEvent.type(input, "같은 의견은 한 번만 보냅니다.");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("closes with Escape and a backdrop click", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<FeedbackDialog onClose={onClose} onSubmit={vi.fn()} bookingUrl="" />);

    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);

    onClose.mockClear();
    rerender(<FeedbackDialog onClose={onClose} onSubmit={vi.fn()} bookingUrl="" />);
    const backdrop = screen.getByTestId("feedback-backdrop");
    await userEvent.click(backdrop);
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
  });
});
