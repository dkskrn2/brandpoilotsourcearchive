import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrandRulesPanel } from "./BrandRulesPanel";
import type { BrandRules } from "../../features/brand-center/types";

const rules: BrandRules = {
  contractVersion: "brand-rules.v1",
  requiredPhrases: ["첫 문구"],
  forbiddenPhrases: [],
  exaggerationRules: [],
  ctaRules: { defaultCta: "", allowed: [] },
  channelRules: {},
  designRules: {
    colors: [],
    fonts: [],
    notes: [],
    referenceImages: [],
  },
  autoApprovalRules: { enabled: false, conditions: [] },
};

afterEach(cleanup);

describe("BrandRulesPanel", () => {
  it("keeps raw multiline input while editing and parses it only when saved", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onDirty = vi.fn();
    render(
      <BrandRulesPanel
        rules={rules}
        saving={false}
        editing
        dirty
        canApprove={false}
        onChange={vi.fn()}
        onDirty={onDirty}
        onSave={onSave}
        onApprove={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const editor = screen.getByLabelText("반드시 포함할 문구");
    await user.clear(editor);
    await user.type(editor, "첫 문구\n\n둘째 문구\n");
    expect(editor).toHaveValue("첫 문구\n\n둘째 문구\n");
    expect(onDirty).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "규칙 저장" }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({
      requiredPhrases: ["첫 문구", "둘째 문구"],
    }));
  });

  it("keeps partial channel JSON visible and blocks blur/save with a useful error", async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    render(
      <BrandRulesPanel
        rules={rules}
        saving={false}
        editing
        dirty
        canApprove={false}
        onChange={vi.fn()}
        onDirty={vi.fn()}
        onSave={onSave}
        onApprove={vi.fn()}
        onEdit={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const editor = screen.getByLabelText("채널별 규칙");
    await user.click(editor);
    fireEvent.change(editor, { target: { value: '{"instagram": [' } });
    expect(editor).toHaveValue('{"instagram": [');
    await user.tab();
    expect(screen.getByRole("alert")).toHaveTextContent("채널별 규칙은 올바른 JSON");

    await user.click(screen.getByRole("button", { name: "규칙 저장" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(editor).toHaveValue('{"instagram": [');
  });
});
