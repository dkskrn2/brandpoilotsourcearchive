import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import type { AiContentGateway, GenerationAttachment, GenerationAttachmentUpdate } from "../../features/ai-content/types";
import { ApiRequestError } from "../../lib/apiClient";
import { AiContentAttachmentUploader } from "./AiContentAttachmentUploader";

function gateway(overrides: Partial<AiContentGateway> = {}) {
  return {
    uploadAttachment: vi.fn(async (_brandId, _generationId, attachment, onProgress) => {
      onProgress?.(100);
      return { ...attachment, file: undefined, storagePath: "stored/product.png", storageUrl: "https://blob.example/product.png" };
    }),
    removeAttachment: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as AiContentGateway;
}

function applyAttachmentUpdate(current: GenerationAttachment[], update: GenerationAttachmentUpdate) {
  return typeof update === "function" ? update(current) : update;
}

function renderControlled(api: AiContentGateway, initial: Parameters<typeof AiContentAttachmentUploader>[0]["attachments"] = []) {
  const onChange = vi.fn();
  function Harness() {
    const [attachments, setAttachments] = useState(initial);
    return <AiContentAttachmentUploader
      gateway={api}
      brandId="brand-1"
      generationId="generation-1"
      attachments={attachments}
      onChange={(update) => {
        setAttachments((current) => {
          const next = applyAttachmentUpdate(current, update);
          onChange(next);
          return next;
        });
      }}
    />;
  }
  return { onChange, view: render(<Harness />) };
}

describe("AiContentAttachmentUploader", () => {
  it("guards selection, retry, and removal callbacks while disabled and restores them when enabled", async () => {
    const api = gateway();
    const failed = {
      id: "failed-1", role: "product" as const, fileName: "failed.png", mimeType: "image/png", size: 5,
      file: new File(["image"], "failed.png", { type: "image/png" }), uploadStatus: "failed" as const,
      uploadRetryable: true,
    };
    const onChange = vi.fn();
    const view = render(<AiContentAttachmentUploader
      gateway={api} brandId="brand-1" generationId="generation-1"
      attachments={[failed]} onChange={onChange} disabled
    />);

    const input = screen.getByLabelText("제품 이미지");
    expect(input).toBeDisabled();
    fireEvent.change(input, { target: { files: [new File(["new"], "new.png", { type: "image/png" })] } });
    fireEvent.click(screen.getByRole("button", { name: "failed.png 다시 업로드" }));
    fireEvent.click(screen.getByRole("button", { name: "failed.png 삭제" }));
    expect(api.uploadAttachment).not.toHaveBeenCalled();
    expect(api.removeAttachment).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();

    view.rerender(<AiContentAttachmentUploader
      gateway={api} brandId="brand-1" generationId="generation-1"
      attachments={[failed]} onChange={onChange} disabled={false}
    />);
    expect(screen.getByLabelText("제품 이미지")).toBeEnabled();
  });

  it("uploads and keeps only the confirmed attachment", async () => {
    const api = gateway();
    const { onChange } = renderControlled(api);

    const file = new File(["image"], "product.png", { type: "image/png" });
    expect(screen.getByRole("button", { name: "제품 이미지 추가" })).toBeVisible();
    expect(screen.getByLabelText("제품 이미지")).toHaveClass("visually-hidden");
    fireEvent.change(screen.getByLabelText("제품 이미지"), { target: { files: [file] } });

    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledWith("brand-1", "generation-1", expect.objectContaining({ fileName: "product.png" }), expect.any(Function)));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ storagePath: "stored/product.png", file: undefined })]));
  });

  it("applies the server image size limit before upload", async () => {
    const api = gateway();
    render(<AiContentAttachmentUploader gateway={api} brandId="brand-1" generationId="generation-1" attachments={[]} onChange={vi.fn()} />);

    const file = new File([new Uint8Array(5_000_001)], "large.png", { type: "image/png" });
    fireEvent.change(screen.getByLabelText("제품 이미지"), { target: { files: [file] } });

    expect(await screen.findByRole("alert")).toHaveTextContent("이미지는 5MB 이하여야 합니다.");
    expect(api.uploadAttachment).not.toHaveBeenCalled();
  });

  it("keeps both attachments when parallel uploads finish out of order", async () => {
    const uploads = new Map<string, (attachment: Parameters<AiContentGateway["uploadAttachment"]>[2]) => void>();
    const api = {
      uploadAttachment: vi.fn(async (_brandId, _generationId, attachment) => new Promise<typeof attachment>((resolve) => {
        uploads.set(attachment.fileName, resolve);
      })),
    } as unknown as AiContentGateway;
    const { onChange } = renderControlled(api);

    fireEvent.change(screen.getByLabelText("제품 이미지"), {
      target: { files: [new File(["product"], "product.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByLabelText("인물 이미지"), {
      target: { files: [new File(["person"], "person.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(uploads.size).toBe(2));
    uploads.get("person.png")?.({
      id: "person-uploaded",
      role: "person",
      fileName: "person.png",
      mimeType: "image/png",
      size: 6,
      storagePath: "stored/person.png",
      storageUrl: "https://blob.example/person.png",
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fileName: "product.png", uploadStatus: "pending" }),
      expect.objectContaining({ fileName: "person.png", uploadStatus: "confirmed" }),
    ]));

    uploads.get("product.png")?.({
      id: "product-uploaded",
      role: "product",
      fileName: "product.png",
      mimeType: "image/png",
      size: 7,
      storagePath: "stored/product.png",
      storageUrl: "https://blob.example/product.png",
    });
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fileName: "product.png" }),
      expect.objectContaining({ fileName: "person.png" }),
    ]));
  });

  it("atomically merges same-tick completions from separate role uploaders", async () => {
    const completions = new Map<string, (attachment: any) => void>();
    const api = gateway({
      uploadAttachment: vi.fn(async (_brandId, _generationId, attachment) => new Promise<GenerationAttachment>((resolve) => {
        completions.set(attachment.fileName, resolve);
      })),
    });
    function Harness() {
      const [attachments, setAttachments] = useState<Parameters<typeof AiContentAttachmentUploader>[0]["attachments"]>([]);
      const onChange = (update: any) => setAttachments((current) => typeof update === "function" ? update(current) : update);
      return <>
        <AiContentAttachmentUploader gateway={api} brandId="brand-1" generationId="generation-1" attachments={attachments} allowedRoles={["product"]} onChange={onChange} />
        <AiContentAttachmentUploader gateway={api} brandId="brand-1" generationId="generation-1" attachments={attachments} allowedRoles={["document"]} onChange={onChange} />
      </>;
    }
    render(<Harness />);
    await userEvent.upload(screen.getByLabelText("제품 이미지"), new File(["p"], "product.png", { type: "image/png" }));
    await userEvent.upload(screen.getByLabelText("문서"), new File(["d"], "brief.md", { type: "text/markdown" }));
    await waitFor(() => expect(completions.size).toBe(2));
    completions.get("product.png")?.({ id: "product-server", role: "product", fileName: "product.png", mimeType: "image/png", size: 1, storageUrl: "https://blob/p", storagePath: "p" });
    completions.get("brief.md")?.({ id: "document-server", role: "document", fileName: "brief.md", mimeType: "text/markdown", size: 1, storageUrl: "https://blob/d", storagePath: "d" });
    await waitFor(() => expect(screen.getByText("product.png")).toBeVisible());
    expect(screen.getByText("brief.md")).toBeVisible();
    expect(screen.queryByText("업로드 중")).not.toBeInTheDocument();
  });

  it("reserves in-flight uploads against the shared five-file limit", async () => {
    let finishUpload: ((attachment: Parameters<AiContentGateway["uploadAttachment"]>[2]) => void) | undefined;
    const api = {
      uploadAttachment: vi.fn(async (_brandId, _generationId, attachment) => new Promise<typeof attachment>((resolve) => {
        finishUpload = resolve;
      })),
    } as unknown as AiContentGateway;
    const existing = Array.from({ length: 4 }, (_, index) => ({
      id: `existing-${index}`,
      role: "visual_reference" as const,
      fileName: `existing-${index}.png`,
      mimeType: "image/png",
      size: 10,
      storagePath: `stored/existing-${index}.png`,
      storageUrl: `https://blob.example/existing-${index}.png`,
    }));
    const { onChange } = renderControlled(api, existing);

    fireEvent.change(screen.getByLabelText("제품 이미지"), {
      target: { files: [new File(["product"], "product.png", { type: "image/png" })] },
    });
    fireEvent.change(screen.getByLabelText("인물 이미지"), {
      target: { files: [new File(["person"], "person.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("alert")).toHaveTextContent("첨부 파일은 최대 5개입니다.");
    finishUpload?.({
      id: "product-uploaded",
      role: "product",
      fileName: "product.png",
      mimeType: "image/png",
      size: 7,
      storagePath: "stored/product.png",
      storageUrl: "https://blob.example/product.png",
    });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
  });

  it("allows exactly five concurrent local reservations before rejecting the sixth", async () => {
    const api = gateway({
      uploadAttachment: vi.fn(async (..._args: Parameters<AiContentGateway["uploadAttachment"]>) => new Promise<Awaited<ReturnType<AiContentGateway["uploadAttachment"]>>>(() => undefined)),
    });
    renderControlled(api);
    const input = screen.getByLabelText("제품 이미지");

    for (let index = 1; index <= 6; index += 1) {
      await userEvent.upload(input, new File([`image-${index}`], `product-${index}.png`, { type: "image/png" }));
    }

    expect(api.uploadAttachment).toHaveBeenCalledTimes(5);
    expect(await screen.findByRole("alert")).toHaveTextContent("첨부 파일은 최대 5개입니다.");
  });

  it("shows the five-file message for an API attachment limit error", async () => {
    const api = {
      uploadAttachment: vi.fn(async () => {
        throw new ApiRequestError({ status: 400, errorCode: "ai_content_attachment_limit_exceeded" });
      }),
    } as unknown as AiContentGateway;
    render(<AiContentAttachmentUploader gateway={api} brandId="brand-1" generationId="generation-1" attachments={[]} onChange={vi.fn()} />);

    fireEvent.change(screen.getByLabelText("제품 이미지"), {
      target: { files: [new File(["product"], "product.png", { type: "image/png" })] },
    });

    expect(await screen.findByRole("alert")).toHaveTextContent("첨부 파일은 최대 5개입니다.");
  });

  it.each([
    ["ai_content_upload_session_expired", "업로드 시간이 만료되었습니다. 파일을 다시 선택해 주세요.", false],
    ["ai_content_attachments_locked", "첨부가 잠겼습니다. 새 콘텐츠 생성을 시작해 주세요.", false],
    ["ai_content_attachment_storage_unavailable", "저장소 연결이 원활하지 않습니다. 현재 파일은 유지됩니다. 다시 시도해 주세요.", true],
  ])("keeps the failed file and maps %s guidance", async (errorCode, message, retryable) => {
    const api = gateway({
      uploadAttachment: vi.fn(async () => {
        throw new ApiRequestError({ status: 503, errorCode });
      }),
    });
    const { onChange } = renderControlled(api);

    const file = new File(["image"], "product.png", { type: "image/png" });
    await userEvent.upload(screen.getByLabelText("제품 이미지"), file);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ file, fileName: "product.png", uploadStatus: "failed" }),
    ]);
    expect(screen.getByText("product.png")).toBeVisible();
    if (retryable) expect(screen.getByRole("button", { name: "product.png 다시 업로드" })).toBeVisible();
    else expect(screen.queryByRole("button", { name: "product.png 다시 업로드" })).not.toBeInTheDocument();
    if (errorCode === "ai_content_attachments_locked") {
      expect(screen.getByRole("link", { name: "새 콘텐츠 생성" })).toHaveAttribute("href", "/ai-content/new");
    }
  });

  it("counts failed visible Files toward the five-item memory bound", async () => {
    const failed = Array.from({ length: 5 }, (_, index) => ({
      id: `failed-${index}`, role: "product" as const, fileName: `failed-${index}.png`,
      mimeType: "image/png", size: 5,
      file: new File(["image"], `failed-${index}.png`, { type: "image/png" }),
      uploadStatus: "failed" as const,
    }));
    const api = gateway();
    renderControlled(api, failed);
    await userEvent.upload(screen.getByLabelText("제품 이미지"), new File(["new"], "new.png", { type: "image/png" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("첨부 파일은 최대 5개입니다.");
    expect(api.uploadAttachment).not.toHaveBeenCalled();
    expect(screen.getAllByText(/^failed-\d\.png$/)).toHaveLength(5);
  });

  it("reselecting the same failed file replaces its row and starts a fresh gateway session", async () => {
    const file = new File(["image"], "product.png", { type: "image/png" });
    const api = gateway();
    renderControlled(api, [{
      id: "failed-original", role: "product", fileName: file.name, mimeType: file.type,
      size: file.size, file, uploadStatus: "failed",
    }]);
    await userEvent.upload(screen.getByLabelText("제품 이미지"), file);
    expect(api.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "product.png 다시 업로드" })).not.toBeInTheDocument();
    expect(screen.getAllByText("product.png")).toHaveLength(1);
  });

  it("rejects an active duplicate but retries a failed same file with a fresh gateway call", async () => {
    const api = gateway({
      uploadAttachment: vi.fn()
        .mockRejectedValueOnce(new ApiRequestError({ status: 503, errorCode: "ai_content_attachment_storage_unavailable" }))
        .mockResolvedValueOnce({
          id: "server-product",
          role: "product",
          fileName: "product.png",
          mimeType: "image/png",
          size: 5,
          storageUrl: "https://blob.example/product.png",
          storagePath: "fresh-session/product.png",
          uploadStatus: "confirmed",
        }),
    });
    const { onChange } = renderControlled(api);
    const file = new File(["image"], "product.png", { type: "image/png" });

    await userEvent.upload(screen.getByLabelText("제품 이미지"), file);
    await userEvent.click(await screen.findByRole("button", { name: "product.png 다시 업로드" }));
    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledTimes(2));
    expect(onChange).toHaveBeenLastCalledWith([expect.objectContaining({ id: "server-product", uploadStatus: "confirmed" })]);

    await userEvent.upload(screen.getByLabelText("제품 이미지"), file);

    expect(await screen.findByRole("alert")).toHaveTextContent("같은 파일이 이미 첨부되어 있습니다.");
    expect(api.uploadAttachment).toHaveBeenCalledTimes(2);
  });

  it("starts a fresh upload attempt after the visible same file is fully removed", async () => {
    const file = new File(["image"], "product.png", { type: "image/png" });
    const api = gateway();
    const { onChange } = renderControlled(api, [{
      id: "attachment-1",
      role: "product",
      fileName: file.name,
      mimeType: file.type,
      size: file.size,
      storageUrl: "https://blob.example/product.png",
      storagePath: "confirmed/product.png",
      uploadStatus: "confirmed",
    }]);

    await userEvent.click(screen.getByRole("button", { name: "product.png 삭제" }));
    await waitFor(() => expect(screen.queryByText("product.png")).not.toBeInTheDocument());
    await userEvent.upload(screen.getByLabelText("제품 이미지"), file);

    expect(api.removeAttachment).toHaveBeenCalledWith("brand-1", "generation-1", "attachment-1");
    expect(api.uploadAttachment).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenLastCalledWith([
      expect.objectContaining({ fileName: "product.png", uploadStatus: "confirmed" }),
    ]);
  });

  it("awaits confirmed removal before replacing the fifth attachment", async () => {
    let finishRemoval: (() => void) | undefined;
    const api = gateway();
    vi.mocked(api.removeAttachment).mockImplementation(async () => new Promise<void>((resolve) => {
      finishRemoval = resolve;
    }));
    const existing = Array.from({ length: 5 }, (_, index) => ({
      id: `attachment-${index}`,
      role: "visual_reference" as const,
      fileName: `existing-${index}.png`,
      mimeType: "image/png",
      size: 10,
      storagePath: `stored/existing-${index}.png`,
      storageUrl: `https://blob.example/existing-${index}.png`,
    }));
    const { onChange } = renderControlled(api, existing);

    fireEvent.click(screen.getByRole("button", { name: "existing-0.png 삭제" }));
    expect(api.removeAttachment).toHaveBeenCalledWith("brand-1", "generation-1", "attachment-0");
    expect(onChange).not.toHaveBeenCalled();

    finishRemoval?.();
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(existing.slice(1)));
    fireEvent.change(screen.getByLabelText("제품 이미지"), {
      target: { files: [new File(["replacement"], "replacement.png", { type: "image/png" })] },
    });

    await waitFor(() => expect(api.uploadAttachment).toHaveBeenCalledWith(
      "brand-1",
      "generation-1",
      expect.objectContaining({ fileName: "replacement.png" }),
      expect.any(Function),
    ));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith([
      ...existing.slice(1),
      expect.objectContaining({ fileName: "replacement.png" }),
    ]));
  });

  it("preserves a confirmed attachment and shows an error when server removal fails", async () => {
    const api = gateway();
    vi.mocked(api.removeAttachment).mockRejectedValueOnce(new Error("network_failed"));
    const attachment = {
      id: "attachment-1",
      role: "document" as const,
      fileName: "brief.md",
      mimeType: "text/markdown",
      size: 10,
      storagePath: "stored/brief.md",
      storageUrl: "https://blob.example/brief.md",
    };
    const onChange = vi.fn();
    render(<AiContentAttachmentUploader gateway={api} brandId="brand-1" generationId="generation-1" attachments={[attachment]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "brief.md 삭제" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("brief.md 파일을 삭제하지 못했습니다. 다시 시도해 주세요.");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByText("brief.md")).toBeVisible();
  });

  it("removes an unconfirmed local attachment without calling the server", async () => {
    const api = gateway();
    const local = {
      id: "local-1",
      role: "document" as const,
      fileName: "local.md",
      mimeType: "text/markdown",
      size: 10,
      file: new File(["local"], "local.md", { type: "text/markdown" }),
    };
    const onChange = vi.fn((update: GenerationAttachmentUpdate) => applyAttachmentUpdate([local], update));
    render(<AiContentAttachmentUploader gateway={api} brandId="brand-1" generationId={null} attachments={[local]} onChange={onChange} />);

    fireEvent.click(screen.getByRole("button", { name: "local.md 삭제" }));

    expect(api.removeAttachment).not.toHaveBeenCalled();
    expect(applyAttachmentUpdate([local], onChange.mock.calls[0][0])).toEqual([]);
  });

  it("shows only allowed roles and accepts every analysis document format locally", async () => {
    const onChange = vi.fn((update: GenerationAttachmentUpdate) => applyAttachmentUpdate([], update));
    const view = render(<AiContentAttachmentUploader
      gateway={gateway()}
      brandId="brand-1"
      generationId={null}
      attachments={[]}
      onChange={onChange}
      {...({ allowedRoles: ["document"] } as object)}
    />);

    expect(screen.getByLabelText("문서")).toHaveAttribute("accept", expect.stringContaining(".xlsx"));
    expect(screen.queryByLabelText("제품 이미지")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("인물 이미지")).not.toBeInTheDocument();

    const documents = [
      new File(["pdf"], "brief.pdf", { type: "application/pdf" }),
      new File(["txt"], "brief.txt", { type: "text/plain" }),
      new File(["md"], "brief.md", { type: "text/markdown" }),
      new File(["csv"], "brief.csv", { type: "text/csv" }),
      new File(["xlsx"], "brief.xlsx", { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
      new File(["md"], "windows.md", { type: "" }),
      new File(["csv"], "windows.csv", { type: "application/vnd.ms-excel" }),
    ];

    for (const file of documents) {
      fireEvent.change(screen.getByLabelText("문서"), { target: { files: [file] } });
      view.rerender(<AiContentAttachmentUploader
        gateway={gateway()}
        brandId="brand-1"
        generationId={null}
        attachments={[]}
        onChange={onChange}
        {...({ allowedRoles: ["document"] } as object)}
      />);
    }

    expect(onChange).toHaveBeenCalledTimes(documents.length);
    expect(onChange.mock.calls.some(([update]) => (
      applyAttachmentUpdate([], update)[0]?.fileName === "windows.md"
      && applyAttachmentUpdate([], update)[0]?.mimeType === "text/markdown"
    ))).toBe(true);
    expect(onChange.mock.calls.some(([update]) => (
      applyAttachmentUpdate([], update)[0]?.fileName === "windows.csv"
      && applyAttachmentUpdate([], update)[0]?.mimeType === "text/csv"
    ))).toBe(true);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
