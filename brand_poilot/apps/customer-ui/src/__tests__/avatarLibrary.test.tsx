import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiRequestError } from "../lib/apiClient";
import { AvatarLibraryPanel } from "../components/brand-center/AvatarLibraryPanel";

const avatarId = "00000000-0000-4000-8000-000000000701";
const secondAvatarId = "00000000-0000-4000-8000-000000000702";
const firstSessionId = "00000000-0000-4000-8000-000000000711";
const secondSessionId = "00000000-0000-4000-8000-000000000712";

const avatar = {
  id: avatarId,
  workspaceId: "workspace-1",
  brandId: "brand-1",
  name: "민지",
  description: "제품 소개용 정적 모델",
  isDefault: true,
  status: "active" as const,
  createdByUserId: "user-1",
  createdAt: "2026-07-27T00:00:00.000Z",
  updatedAt: "2026-07-27T00:00:00.000Z",
  images: [
    {
      id: "image-detail",
      position: 0,
      representative: false,
      storagePath: "brands/brand-1/avatar/detail.webp",
      storageUrl: "https://example.com/detail.webp",
      mimeType: "image/webp",
      sizeBytes: 1_024,
      checksum: "a".repeat(64),
    },
    {
      id: "image-representative",
      position: 1,
      representative: true,
      storagePath: "brands/brand-1/avatar/representative.webp",
      storageUrl: "https://example.com/representative.webp",
      mimeType: "image/webp",
      sizeBytes: 1_024,
      checksum: "b".repeat(64),
    },
  ],
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

function gateway(overrides: Record<string, unknown> = {}) {
  return {
    listAvatars: vi.fn(async () => [avatar]),
    createAvatar: vi.fn(async () => avatar),
    updateAvatar: vi.fn(async () => avatar),
    uploadAvatarImage: vi.fn(async () => ({ sessionId: firstSessionId })),
    deleteAvatarImage: vi.fn(async () => undefined),
    setDefaultAvatar: vi.fn(async () => avatar),
    archiveAvatar: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("AvatarLibraryPanel", () => {
  it("renders real avatar cards with representative image, default, and active state", async () => {
    render(<AvatarLibraryPanel brandId="brand-1" gateway={gateway() as never} />);

    const card = await screen.findByRole("article", { name: "민지" });
    expect(within(card).getByRole("img", { name: "민지 대표 이미지" })).toHaveAttribute(
      "src",
      "https://example.com/representative.webp",
    );
    expect(within(card).getByText("기본 아바타")).toBeVisible();
    expect(within(card).getByText("활성")).toBeVisible();
    expect(screen.queryByText(/AI 아바타|얼굴 합성|음성|초상권/)).not.toBeInTheDocument();
  });

  it("keeps representative image separate from the default avatar action", async () => {
    const other = { ...avatar, id: secondAvatarId, name: "소라", isDefault: false };
    const setDefaultAvatar = vi.fn(async () => ({ ...other, isDefault: true }));
    const archiveAvatar = vi.fn(async () => undefined);
    const confirm = vi.spyOn(window, "confirm");
    const api = gateway({
      listAvatars: vi.fn(async () => [avatar, other]),
      setDefaultAvatar,
      archiveAvatar,
    });
    render(<AvatarLibraryPanel brandId="brand-1" gateway={api as never} />);

    const card = await screen.findByRole("article", { name: "소라" });
    expect(within(card).getByRole("img", { name: "소라 대표 이미지" })).toBeVisible();
    await userEvent.click(within(card).getByRole("button", { name: "소라를 기본 아바타로 설정" }));

    expect(setDefaultAvatar).toHaveBeenCalledWith("brand-1", secondAvatarId);
    await userEvent.click(within(card).getByRole("button", { name: "보관" }));
    expect(archiveAvatar).toHaveBeenCalledWith("brand-1", secondAvatarId);
    expect(confirm).not.toHaveBeenCalled();
  });

  it("creates an avatar from reserved-ID staged uploads and the chosen representative image", async () => {
    const uploadAvatarImage = vi.fn()
      .mockResolvedValueOnce({ sessionId: firstSessionId })
      .mockResolvedValueOnce({ sessionId: secondSessionId });
    const createAvatar = vi.fn(async (_brandId, input) => ({
      ...avatar,
      id: input.avatarId,
      name: input.name,
      description: input.description,
      isDefault: false,
    }));
    const api = gateway({ listAvatars: vi.fn(async () => []), uploadAvatarImage, createAvatar });
    render(<AvatarLibraryPanel brandId="brand-1" gateway={api as never} />);

    await userEvent.click(await screen.findByRole("button", { name: "아바타 등록" }));
    await userEvent.type(screen.getByRole("textbox", { name: "이름" }), "지수");
    await userEvent.type(screen.getByRole("textbox", { name: "설명" }), "봄 캠페인 모델");
    const first = new File(["first"], "front.png", { type: "image/png", lastModified: 1 });
    const second = new File(["second"], "side.webp", { type: "image/webp", lastModified: 2 });
    await userEvent.upload(screen.getByLabelText("아바타 이미지 선택"), [first, second]);

    await waitFor(() => expect(uploadAvatarImage).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole("radio", { name: "side.webp 대표 이미지로 설정" }));
    await userEvent.click(screen.getByRole("button", { name: "아바타 저장" }));

    expect(createAvatar).toHaveBeenCalledWith(
      "brand-1",
      expect.objectContaining({
        avatarId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        name: "지수",
        description: "봄 캠페인 모델",
        imageSessionIds: [firstSessionId, secondSessionId],
        representativeSessionId: secondSessionId,
      }),
    );
    expect(screen.queryByRole("dialog", { name: "아바타 등록" })).not.toBeInTheDocument();
  });

  it("enforces image MIME, 5 MB, count, and duplicate limits before upload", async () => {
    const uploadAvatarImage = vi.fn(async () => ({ sessionId: firstSessionId }));
    const api = gateway({ listAvatars: vi.fn(async () => []), uploadAvatarImage });
    render(<AvatarLibraryPanel brandId="brand-1" gateway={api as never} />);
    await userEvent.click(await screen.findByRole("button", { name: "아바타 등록" }));
    const input = screen.getByLabelText("아바타 이미지 선택");
    const unrestrictedUser = userEvent.setup({ applyAccept: false });

    await unrestrictedUser.upload(input, new File(["bad"], "avatar.gif", { type: "image/gif" }));
    expect(screen.getByText("PNG, JPEG, WebP 이미지만 추가할 수 있습니다.")).toBeVisible();
    await userEvent.upload(
      input,
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], "large.png", { type: "image/png" }),
    );
    expect(screen.getByText("이미지는 한 장당 5MB 이하여야 합니다.")).toBeVisible();

    const six = Array.from(
      { length: 6 },
      (_, index) => new File([String(index)], `${index}.png`, { type: "image/png", lastModified: index }),
    );
    await userEvent.upload(input, six);
    expect(screen.getByText("아바타 이미지는 최대 5장까지 추가할 수 있습니다.")).toBeVisible();

    const duplicate = new File(["same"], "same.png", { type: "image/png", lastModified: 9 });
    await userEvent.upload(input, duplicate);
    await waitFor(() => expect(uploadAvatarImage).toHaveBeenCalledOnce());
    await userEvent.upload(input, duplicate);
    expect(screen.getByText("이미 추가한 이미지입니다.")).toBeVisible();
    expect(uploadAvatarImage).toHaveBeenCalledOnce();
  });

  it("shows upload progress and retries only the failed file", async () => {
    const retry = deferred<{ sessionId: string }>();
    const uploadAvatarImage = vi.fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockImplementationOnce((_brandId, _avatarId, _file, onProgress) => {
        onProgress(42);
        return retry.promise;
      });
    const api = gateway({ listAvatars: vi.fn(async () => []), uploadAvatarImage });
    render(<AvatarLibraryPanel brandId="brand-1" gateway={api as never} />);
    await userEvent.click(await screen.findByRole("button", { name: "아바타 등록" }));
    await userEvent.upload(
      screen.getByLabelText("아바타 이미지 선택"),
      new File(["image"], "retry.jpg", { type: "image/jpeg" }),
    );

    await screen.findByText("업로드하지 못했습니다.");
    await userEvent.click(screen.getByRole("button", { name: "retry.jpg 다시 업로드" }));
    expect(screen.getByRole("progressbar", { name: "retry.jpg 업로드" })).toHaveAttribute(
      "aria-valuenow",
      "42",
    );

    await act(async () => retry.resolve({ sessionId: firstSessionId }));
    expect(await screen.findByText("업로드 완료")).toBeVisible();
    expect(uploadAvatarImage).toHaveBeenCalledTimes(2);
  });

  it("traps focus, closes on Escape, and restores focus to the opener", async () => {
    const api = gateway({ listAvatars: vi.fn(async () => []) });
    render(<AvatarLibraryPanel brandId="brand-1" gateway={api as never} />);
    const opener = await screen.findByRole("button", { name: "아바타 등록" });
    opener.focus();
    await userEvent.click(opener);

    expect(screen.getByRole("textbox", { name: "이름" })).toHaveFocus();
    const save = screen.getByRole("button", { name: "아바타 저장" });
    save.focus();
    await userEvent.tab();
    expect(screen.getByRole("button", { name: "아바타 등록 닫기" })).toHaveFocus();

    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "아바타 등록" })).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("shows honest empty and deployment-order states", async () => {
    const { rerender } = render(
      <AvatarLibraryPanel
        brandId="brand-1"
        gateway={gateway({ listAvatars: vi.fn(async () => []) }) as never}
      />,
    );
    expect(await screen.findByText("저장된 아바타가 없습니다")).toBeVisible();

    rerender(
      <AvatarLibraryPanel
        brandId="brand-2"
        gateway={gateway({
          listAvatars: vi.fn(async () => {
            throw new ApiRequestError({ status: 500, errorCode: "asset_library_not_configured" });
          }),
        }) as never}
      />,
    );
    expect(await screen.findByText(/서버의 아바타 보관함 배포가 먼저 필요합니다/)).toBeVisible();
  });
});
