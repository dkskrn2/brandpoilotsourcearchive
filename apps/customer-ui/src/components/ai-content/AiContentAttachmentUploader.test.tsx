import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { AiContentGateway } from "../../features/ai-content/types";
import { AiContentAttachmentUploader } from "./AiContentAttachmentUploader";

function gateway() {
  return {
    uploadAttachment: vi.fn(async (_brandId, _generationId, attachment, onProgress) => {
      onProgress?.(100);
      return { ...attachment, file: undefined, storagePath: "stored/product.png", storageUrl: "https://blob.example/product.png" };
    }),
  } as unknown as AiContentGateway;
}

describe("AiContentAttachmentUploader", () => {
  it("uploads and keeps only the confirmed attachment", async () => {
    const api = gateway();
    const onChange = vi.fn();
    render(<AiContentAttachmentUploader gateway={api} brandId="brand-1" generationId="generation-1" attachments={[]} onChange={onChange} />);

    const file = new File(["image"], "product.png", { type: "image/png" });
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

  it("shows only allowed roles and accepts every analysis document format locally", async () => {
    const onChange = vi.fn();
    render(<AiContentAttachmentUploader
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
    }

    expect(onChange).toHaveBeenCalledTimes(documents.length);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ fileName: "windows.md", mimeType: "text/markdown" })]);
    expect(onChange).toHaveBeenCalledWith([expect.objectContaining({ fileName: "windows.csv", mimeType: "text/csv" })]);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
