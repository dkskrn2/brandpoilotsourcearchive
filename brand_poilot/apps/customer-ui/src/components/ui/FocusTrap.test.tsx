import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { FocusTrap } from "./FocusTrap";

function Harness() {
  const [active, setActive] = useState(true);
  return (
    <>
      <button type="button">바깥 버튼</button>
      <FocusTrap active={active} initialFocusSelector="[data-initial]">
        <button type="button" onClick={() => setActive(false)}>닫기</button>
        <a href="/dashboard" data-initial>대시보드</a>
        <button type="button">마지막 작업</button>
      </FocusTrap>
    </>
  );
}

describe("FocusTrap", () => {
  it("focuses the requested element and loops Tab within the active region", () => {
    render(<Harness />);

    expect(screen.getByRole("link", { name: "대시보드" })).toHaveFocus();

    const lastAction = screen.getByRole("button", { name: "마지막 작업" });
    lastAction.focus();
    fireEvent.keyDown(lastAction, { key: "Tab" });
    expect(screen.getByRole("button", { name: "닫기" })).toHaveFocus();

    const closeButton = screen.getByRole("button", { name: "닫기" });
    closeButton.focus();
    fireEvent.keyDown(closeButton, { key: "Tab", shiftKey: true });
    expect(lastAction).toHaveFocus();
  });
});
