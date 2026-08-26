import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { AutoPublishHeaderControl } from "./AutoPublishHeaderControl";

describe("AutoPublishHeaderControl", () => {
  it("shows an explicit controlled OFF switch and a separate edit action", () => {
    render(<AutoPublishHeaderControl enabled={false} canEnable onToggle={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.getByText("자동 게시")).toBeVisible();
    expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toHaveTextContent("OFF");
    expect(screen.getByRole("button", { name: "자동 게시 수정" })).toHaveTextContent("수정");
  });

  it("does not change the controlled state before the server confirms", async () => {
    let resolve!: (value: { ok: true }) => void;
    const onToggle = vi.fn(() => new Promise<{ ok: true }>((next) => { resolve = next; }));
    const { rerender } = render(<AutoPublishHeaderControl enabled={false} canEnable onToggle={onToggle} onEdit={vi.fn()} />);

    await userEvent.click(screen.getByRole("switch", { name: "자동 게시 OFF" }));
    expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toHaveAttribute("aria-checked", "false");
    expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toBeDisabled();

    resolve({ ok: true });
    await waitFor(() => expect(onToggle).toHaveBeenCalledWith(true));
    rerender(<AutoPublishHeaderControl enabled canEnable onToggle={onToggle} onEdit={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "자동 게시 ON" })).toHaveAttribute("aria-checked", "true");
  });

  it("keeps the state rolled back and announces a safe error after a failed toggle", async () => {
    const onToggle = vi.fn(async () => ({ ok: false as const, message: "자동 게시 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요." }));
    render(<AutoPublishHeaderControl enabled={false} canEnable onToggle={onToggle} onEdit={vi.fn()} />);

    await userEvent.click(screen.getByRole("switch", { name: "자동 게시 OFF" }));

    expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toHaveAttribute("aria-checked", "false");
    expect(await screen.findByRole("alert")).toHaveTextContent("자동 게시 상태를 변경하지 못했습니다. 잠시 후 다시 시도하세요.");
  });

  it("disables and explains ON when configuration is incomplete but always permits OFF", () => {
    const reason = "저장된 주간 일정과 게시 가능한 연결 채널이 필요합니다.";
    const { rerender } = render(<AutoPublishHeaderControl enabled={false} canEnable={false} disabledReason={reason} onToggle={vi.fn()} onEdit={vi.fn()} />);

    expect(screen.getByRole("switch", { name: "자동 게시 OFF" })).toBeDisabled();
    expect(screen.getByText(reason)).toBeVisible();

    rerender(<AutoPublishHeaderControl enabled canEnable={false} disabledReason={reason} onToggle={vi.fn()} onEdit={vi.fn()} />);
    expect(screen.getByRole("switch", { name: "자동 게시 ON" })).toBeEnabled();
  });
});
