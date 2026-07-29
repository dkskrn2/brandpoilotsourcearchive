import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { BrandRules } from "../../features/brand-center/types";
import { StyleReferenceImageBoard, validateStyleReferenceFile } from "./StyleReferenceImageBoard";

const firstId = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";

function rules(): BrandRules {
  return {
    contractVersion: "brand-rules.v1",
    requiredPhrases: ["근거 기반"],
    forbiddenPhrases: [],
    exaggerationRules: [],
    ctaRules: { defaultCta: "", allowed: [] },
    channelRules: {},
    designRules: {
      colors: ["#111111"],
      fonts: ["Pretendard"],
      notes: ["기존 규칙"],
      referenceImages: [{
        referenceItemId: firstId,
        description: "기존 이미지",
        tags: ["차분함"],
      }],
    },
    autoApprovalRules: { enabled: false, conditions: [] },
  };
}

function reference(id: string, title: string, previewUrl: string) {
  return {
    id,
    workspaceId: "workspace-1",
    brandId: "brand-1",
    kind: "upload",
    contentPurpose: "both",
    origin: "Upload",
    title,
    previewUrl,
    sourceUrl: previewUrl,
    format: "image/png",
    metadata: { mimeType: "image/png" },
    favorite: false,
    archivedAt: null,
    referenceBrandId: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
  } as const;
}

function gateway() {
  return {
    getReference: vi.fn(async (_brandId: string, id: string) => (
      reference(id, "기존.png", "https://blob.example/existing.png")
    )),
    uploadReferenceFile: vi.fn(async (
      _brandId: string,
      _file: File,
      options: { onSession?(sessionId: string): void; onProgress?(value: number): void },
    ) => {
      options.onSession?.("session-1");
      options.onProgress?.(100);
      return {
        sessionId: "session-1",
        reference: reference(secondId, "new.png", "https://blob.example/new.png"),
      };
    }),
    cancelReferenceUpload: vi.fn(async () => ({ status: "already_cancelled" as const })),
  };
}

describe("StyleReferenceImageBoard", () => {
  it("accepts only PNG, JPEG, and WebP files up to 5 MiB", () => {
    expect(validateStyleReferenceFile(new File(["image"], "style.png", { type: "image/png" })))
      .toBeNull();
    expect(validateStyleReferenceFile(new File(["image"], "style.svg", { type: "image/svg+xml" })))
      .toBe("PNG, JPEG, WebP 이미지만 등록할 수 있습니다.");
    const oversized = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "style.webp", {
      type: "image/webp",
    });
    expect(validateStyleReferenceFile(oversized)).toBe("이미지는 한 장당 5MB 이하여야 합니다.");
  });

  it("uploads confirmed images and saves only reference identifiers with metadata", async () => {
    const api = gateway();
    const onSave = vi.fn(async (_rules: BrandRules) => undefined);
    const onDirtyChange = vi.fn();
    render(
      <StyleReferenceImageBoard
        brandId="brand-1"
        gateway={api as never}
        rules={rules()}
        onSave={onSave}
        onDirtyChange={onDirtyChange}
      />,
    );

    expect(await screen.findByRole("img", { name: "기존 이미지" }))
      .toHaveAttribute("src", "https://blob.example/existing.png");
    await userEvent.click(screen.getByRole("button", { name: "스타일 이미지 수정" }));
    const input = screen.getByLabelText("스타일 참고 이미지 선택");
    expect(input).toHaveAttribute("accept", ".png,.jpg,.jpeg,.webp");
    await userEvent.upload(input, new File(["image"], "new.png", { type: "image/png" }));

    expect(await screen.findByRole("img", { name: "new.png" }))
      .toHaveAttribute("src", "https://blob.example/new.png");
    const descriptions = screen.getAllByRole("textbox", { name: "이미지 설명" });
    await userEvent.clear(descriptions[1]!);
    await userEvent.type(descriptions[1]!, "새로운 분위기");
    const tags = screen.getAllByRole("textbox", { name: "이미지 태그" });
    await userEvent.type(tags[1]!, "선명함, 제품");
    await userEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      ...rules(),
      designRules: {
        ...rules().designRules,
        referenceImages: [
          rules().designRules.referenceImages[0],
          {
            referenceItemId: secondId,
            description: "새로운 분위기",
            tags: ["선명함", "제품"],
          },
        ],
      },
    });
    expect(JSON.stringify(onSave.mock.calls[0])).not.toContain("blob:");
    expect(JSON.stringify(onSave.mock.calls[0])).not.toContain("https://blob.example");
    expect(onDirtyChange).toHaveBeenCalledWith(true);
  });

  it("cancels failed upload sessions and restores persisted images on cancel", async () => {
    const api = gateway();
    api.uploadReferenceFile.mockImplementationOnce(async (
      _brandId,
      _file,
      options,
    ) => {
      options.onSession?.("failed-session");
      throw new Error("upload failed");
    });
    const onSave = vi.fn(async () => undefined);
    render(
      <StyleReferenceImageBoard
        brandId="brand-1"
        gateway={api as never}
        rules={rules()}
        onSave={onSave}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "스타일 이미지 수정" }));
    await userEvent.upload(
      screen.getByLabelText("스타일 참고 이미지 선택"),
      new File(["image"], "failed.jpg", { type: "image/jpeg" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("이미지를 업로드하지 못했습니다.");
    await waitFor(() => expect(api.cancelReferenceUpload)
      .toHaveBeenCalledWith("brand-1", "failed-session"));
    await userEvent.click(screen.getByRole("button", { name: "변경 취소" }));
    expect(screen.getByRole("img", { name: "기존 이미지" })).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("aborts an in-flight upload, revokes its local preview, and ignores a late completion on cancel", async () => {
    let finishUpload: ((value: Awaited<ReturnType<ReturnType<typeof gateway>["uploadReferenceFile"]>>) => void) | undefined;
    const api = gateway();
    api.uploadReferenceFile.mockImplementationOnce(async (
      _brandId,
      file,
      options,
    ) => new Promise((resolve) => {
      options.onSession?.("active-session");
      options.onProgress?.(20);
      finishUpload = resolve;
    }));
    const createObjectURL = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:pending-style");
    const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const onDirtyChange = vi.fn();
    render(
      <StyleReferenceImageBoard
        brandId="brand-1"
        gateway={api as never}
        rules={rules()}
        onSave={vi.fn(async () => undefined)}
        onDirtyChange={onDirtyChange}
      />,
    );

    await userEvent.click(await screen.findByRole("button", { name: "스타일 이미지 수정" }));
    await userEvent.upload(
      screen.getByLabelText("스타일 참고 이미지 선택"),
      new File(["pending"], "pending.png", { type: "image/png" }),
    );
    expect(await screen.findByRole("img", { name: "pending.png" }))
      .toHaveAttribute("src", "blob:pending-style");
    expect(onDirtyChange).toHaveBeenCalledWith(true);
    await userEvent.click(screen.getByRole("button", { name: "변경 취소" }));

    await waitFor(() => expect(api.cancelReferenceUpload)
      .toHaveBeenCalledWith("brand-1", "active-session"));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:pending-style");
    finishUpload?.({
      sessionId: "active-session",
      reference: reference(secondId, "pending.png", "https://blob.example/late.png"),
    });
    await waitFor(() => expect(screen.queryByRole("img", { name: "pending.png" }))
      .not.toBeInTheDocument());
    expect(screen.getByRole("img", { name: "기존 이미지" })).toBeInTheDocument();
    createObjectURL.mockRestore();
    revokeObjectURL.mockRestore();
  });

  it("does not start later files from a selected batch after the first upload is cancelled", async () => {
    let finishFirst: ((value: Awaited<ReturnType<ReturnType<typeof gateway>["uploadReferenceFile"]>>) => void) | undefined;
    const api = gateway();
    api.uploadReferenceFile.mockImplementationOnce(async (
      _brandId,
      _file,
      options,
    ) => new Promise((resolve) => {
      options.onSession?.("first-session");
      finishFirst = resolve;
    }));
    render(
      <StyleReferenceImageBoard
        brandId="brand-1"
        gateway={api as never}
        rules={rules()}
        onSave={vi.fn(async () => undefined)}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "스타일 이미지 수정" }));
    await userEvent.upload(screen.getByLabelText("스타일 참고 이미지 선택"), [
      new File(["first"], "first.png", { type: "image/png" }),
      new File(["second"], "second.png", { type: "image/png" }),
    ]);
    await waitFor(() => expect(api.uploadReferenceFile).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole("button", { name: "변경 취소" }));
    finishFirst?.({
      sessionId: "first-session",
      reference: reference(secondId, "first.png", "https://blob.example/first.png"),
    });

    await waitFor(() => expect(api.cancelReferenceUpload)
      .toHaveBeenCalledWith("brand-1", "first-session"));
    expect(api.uploadReferenceFile).toHaveBeenCalledTimes(1);
  });

  it("shows a local validation error instead of sending an overlong tag", async () => {
    const api = gateway();
    const onSave = vi.fn(async () => undefined);
    render(
      <StyleReferenceImageBoard
        brandId="brand-1"
        gateway={api as never}
        rules={rules()}
        onSave={onSave}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "스타일 이미지 수정" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "이미지 태그" }));
    await userEvent.type(
      screen.getByRole("textbox", { name: "이미지 태그" }),
      "x".repeat(41),
    );
    await userEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

    expect(await screen.findByRole("alert"))
      .toHaveTextContent("태그는 각각 40자 이하여야 합니다.");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("enforces five images and persists a detach without deleting the library source", async () => {
    const api = gateway();
    const fullRules = rules();
    fullRules.designRules.referenceImages = Array.from({ length: 5 }, (_, index) => ({
      referenceItemId: `${index + 1}1111111-1111-4111-8111-111111111111`,
      description: `참고 ${index + 1}`,
      tags: [],
    }));
    const onSave = vi.fn(async (_rules: BrandRules) => undefined);
    render(
      <StyleReferenceImageBoard
        brandId="brand-1"
        gateway={api as never}
        rules={fullRules}
        onSave={onSave}
      />,
    );
    await userEvent.click(await screen.findByRole("button", { name: "스타일 이미지 수정" }));
    expect(screen.getByLabelText("스타일 참고 이미지 선택")).toBeDisabled();
    await userEvent.click(screen.getAllByRole("button", { name: "보드에서 제외" })[0]!);
    expect(screen.getByLabelText("스타일 참고 이미지 선택")).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: "변경사항 저장" }));

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]![0].designRules.referenceImages).toHaveLength(4);
    expect(api.cancelReferenceUpload).not.toHaveBeenCalled();
  });
});
