import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SupportRequestHistoryDialog } from "./SupportRequestHistoryDialog";

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>문의 내역 열기</button>
      {open ? (
        <SupportRequestHistoryDialog
          brandId="brand-1"
          listRequests={vi.fn(async () => [])}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

describe("SupportRequestHistoryDialog", () => {
  it("reuses the history state and restores its trigger after Escape", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);

    const trigger = screen.getByRole("button", { name: "문의 내역 열기" });
    await user.click(trigger);

    expect(screen.getByRole("dialog", { name: "문의 내역" })).toBeVisible();
    expect(await screen.findByText("접수한 문의가 없습니다.")).toBeVisible();
    const closeButton = screen.getByRole("button", { name: "문의 내역 닫기" });
    await waitFor(() => expect(closeButton).toHaveFocus());
    await user.tab();
    expect(closeButton).toHaveFocus();

    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "문의 내역" })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it("closes only when the backdrop itself is pressed", async () => {
    const user = userEvent.setup();
    render(<DialogHarness />);
    await user.click(screen.getByRole("button", { name: "문의 내역 열기" }));

    const dialog = screen.getByRole("dialog", { name: "문의 내역" });
    fireEvent.mouseDown(dialog);
    expect(dialog).toBeVisible();

    fireEvent.mouseDown(screen.getByTestId("support-history-backdrop"));
    expect(screen.queryByRole("dialog", { name: "문의 내역" })).not.toBeInTheDocument();
  });
});
