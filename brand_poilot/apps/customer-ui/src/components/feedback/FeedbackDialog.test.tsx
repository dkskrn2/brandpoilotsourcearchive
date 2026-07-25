import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FeedbackDialog } from "./FeedbackDialog";

describe("FeedbackDialog", () => {
  it("sends feedback and clears the opinion after success", async () => {
    const onSubmit = vi.fn(async () => undefined);
    render(<FeedbackDialog onClose={vi.fn()} onSubmit={onSubmit} bookingUrl="https://booking.example.com/15min" />);

    expect(screen.getByRole("heading", { name: "통화 문의 예약하기" })).toBeVisible();
    expect(screen.getByRole("link", { name: "통화 문의 예약하기" })).toHaveAttribute("href", "https://booking.example.com/15min");
    const input = screen.getByRole("textbox", { name: "의견" });
    expect(input).toHaveFocus();
    await userEvent.type(input, "결과 미리보기를 개선해 주세요.");
    await userEvent.click(screen.getByRole("button", { name: "보내기" }));

    expect(onSubmit).toHaveBeenCalledWith("결과 미리보기를 개선해 주세요.");
    expect(await screen.findByRole("status")).toHaveTextContent("의견을 보내주셔서 감사합니다.");
    expect(input).toHaveValue("");
  });

  it("blocks blank feedback and reports submission failures", async () => {
    const onSubmit = vi.fn(async () => { throw new Error("failed"); });
    render(<FeedbackDialog onClose={vi.fn()} onSubmit={onSubmit} bookingUrl="" />);

    const send = screen.getByRole("button", { name: "보내기" });
    expect(send).toBeDisabled();
    expect(screen.getByRole("link", { name: "통화 문의 예약하기" })).toHaveAttribute(
      "href",
      "/support?category=other#support-request-form"
    );
    await userEvent.type(screen.getByRole("textbox", { name: "의견" }), "전송 실패 확인");
    await userEvent.click(send);

    expect(await screen.findByRole("alert")).toHaveTextContent("피드백을 보내지 못했습니다");
    expect(screen.getByRole("textbox", { name: "의견" })).toHaveValue("전송 실패 확인");
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
