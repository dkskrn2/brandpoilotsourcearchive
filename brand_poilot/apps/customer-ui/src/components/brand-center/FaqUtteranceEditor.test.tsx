import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { FaqUtteranceEditor } from "./FaqUtteranceEditor";

describe("FaqUtteranceEditor", () => {
  it("edits one expression per row and supports add and delete", async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <FaqUtteranceEditor values={["배송 언제 와요?"]} onChange={onChange} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "표현 예시 추가" }));
    expect(onChange).toHaveBeenLastCalledWith(["배송 언제 와요?", ""]);

    rerender(<FaqUtteranceEditor
      values={["배송 언제 와요?", "언제 발송해요?"]}
      onChange={onChange}
    />);
    await userEvent.click(screen.getByRole("button", { name: "표현 예시 1 삭제" }));
    expect(onChange).toHaveBeenLastCalledWith(["언제 발송해요?"]);
  });

  it("shows normalized duplicate and length warnings", () => {
    render(<FaqUtteranceEditor
      values={["배송 언제 와요?", "배송 언제 와요!", "가".repeat(81)]}
      onChange={() => undefined}
      minItems={3}
    />);
    expect(screen.getByText("같은 의미의 표현이 중복되었습니다.")).toBeVisible();
    expect(screen.getByText("표현은 80자 이하로 입력해 주세요.")).toBeVisible();
  });

  it("limits expressions to eight", () => {
    render(<FaqUtteranceEditor
      values={Array.from({ length: 8 }, (_, index) => `표현 ${index}`)}
      onChange={() => undefined}
    />);
    expect(screen.getByRole("button", { name: "표현 예시 추가" })).toBeDisabled();
  });
});
