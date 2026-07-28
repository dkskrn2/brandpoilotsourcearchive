import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import type { Avatar } from "../../features/libraries/libraryGateway";
import type { AiContentReference } from "../../features/ai-content/types";
import { ReferenceAvatarStep, type SelectedReference } from "./ReferenceAvatarStep";

afterEach(cleanup);

const references: AiContentReference[] = Array.from({ length: 6 }, (_, index) => ({
  id: `reference-${index + 1}`,
  title: `실제 레퍼런스 ${index + 1}`,
  previewUrl: index === 0 ? "https://example.com/reference.jpg" : null,
  source: "owned",
  format: "blog",
  primaryCategory: "가이드",
  subcategory: null,
  appealIds: [],
  comparableMetric: null,
}));

const avatars: Avatar[] = [1, 2].map((index) => ({
  id: `avatar-${index}`,
  workspaceId: "workspace-1",
  brandId: "brand-1",
  name: `아바타 ${index}`,
  description: "",
  isDefault: index === 1,
  status: "active",
  createdByUserId: "user-1",
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  images: [],
}));

function Harness({ onGenerate = vi.fn() }: { onGenerate?: () => void }) {
  const [selectedReferences, setSelectedReferences] = useState<SelectedReference[]>([]);
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [oneTimeAvatar, setOneTimeAvatar] = useState<File | null>(null);
  return <ReferenceAvatarStep
    references={references}
    avatars={avatars}
    selectedReferences={selectedReferences}
    selectedAvatarId={avatarId}
    oneTimeAvatar={oneTimeAvatar}
    loading={false}
    submitting={false}
    onReferencesChange={setSelectedReferences}
    onAvatarChange={(value) => {
      setAvatarId(value);
      if (value) setOneTimeAvatar(null);
    }}
    onOneTimeAvatarChange={(value) => {
      setOneTimeAvatar(value);
      if (value) setAvatarId(null);
    }}
    onGenerate={onGenerate}
  />;
}

describe("ReferenceAvatarStep", () => {
  it("allows zero references, caps selection at five, and requires a role for selected items", async () => {
    const user = userEvent.setup();
    const generate = vi.fn();
    render(<Harness onGenerate={generate} />);

    await user.click(screen.getByRole("button", { name: "이 구현안으로 생성" }));
    expect(generate).toHaveBeenCalledTimes(1);

    for (let index = 1; index <= 5; index += 1) {
      await user.click(screen.getByRole("button", { name: `레퍼런스 선택: 실제 레퍼런스 ${index}` }));
    }
    expect(screen.getByText("선택 5 / 5")).toBeVisible();
    expect(screen.getByRole("button", { name: "레퍼런스 선택: 실제 레퍼런스 6" })).toBeDisabled();

    await user.click(screen.getAllByRole("button", { name: "기획" })[0]!);
    expect(screen.getByRole("alert")).toHaveTextContent("활용 역할");
    expect(screen.getByRole("button", { name: "이 구현안으로 생성" })).toBeDisabled();
  });

  it("keeps exactly one avatar selected", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("radio", { name: "아바타 1" }));
    await user.click(screen.getByRole("radio", { name: "아바타 2" }));

    expect(screen.getByRole("radio", { name: "아바타 1" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "아바타 2" })).toBeChecked();
  });

  it("keeps a one-time avatar mutually exclusive with the library slot and preserves the local file", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const oneTime = new File(["person"], "campaign-person.png", { type: "image/png" });
    await user.upload(screen.getByLabelText("이번 생성에만 사용할 아바타"), oneTime);

    expect(screen.getByText("campaign-person.png")).toBeVisible();
    expect(screen.getByRole("radio", { name: "아바타 1" })).not.toBeChecked();

    await user.click(screen.getByRole("radio", { name: "아바타 1" }));
    expect(screen.queryByText("campaign-person.png")).not.toBeInTheDocument();
  });

  it("opens direct reference and avatar upload flows from the proposal phase", async () => {
    const user = userEvent.setup();
    const addReference = vi.fn();
    const addAvatar = vi.fn();
    const { rerender } = render(<ReferenceAvatarStep
      references={references}
      avatars={avatars}
      selectedReferences={[]}
      selectedAvatarId={null}
      oneTimeAvatar={null}
      loading={false}
      submitting={false}
      onReferencesChange={vi.fn()}
      onAvatarChange={vi.fn()}
      onOneTimeAvatarChange={vi.fn()}
      onAddReference={addReference}
      onAddAvatar={addAvatar}
      onGenerate={vi.fn()}
    />);

    await user.click(screen.getByRole("tab", { name: "직접 추가" }));
    await user.click(screen.getByRole("button", { name: "레퍼런스 파일 업로드" }));
    await user.click(screen.getByRole("button", { name: "아바타 업로드 후 저장" }));

    expect(addReference).toHaveBeenCalledTimes(1);
    expect(addAvatar).toHaveBeenCalledTimes(1);
    rerender(<></>);
  });
});
