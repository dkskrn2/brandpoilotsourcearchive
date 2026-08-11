import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { ReferenceAvatarStep, type BrandStyleImagePreview } from "./ReferenceAvatarStep";

afterEach(cleanup);

const styles: BrandStyleImagePreview[] = [
  {
    referenceItemId: "style-1",
    title: "차분한 편집 스타일",
    description: "여백이 넓은 구성",
    tags: ["차분함"],
    previewUrl: "https://example.com/style-1.jpg",
  },
  {
    referenceItemId: "style-2",
    title: "선명한 제품 스타일",
    description: "제품 중심 구성",
    tags: ["선명함"],
    previewUrl: "https://example.com/style-2.jpg",
  },
];

function Harness({
  styleImages = styles,
  outputFormat = "card_news" as const,
  loading = false,
  loadError = null as string | null,
  onRetry = vi.fn(),
  onGenerate = vi.fn(),
}: {
  styleImages?: BrandStyleImagePreview[];
  outputFormat?: "card_news" | "blog";
  loading?: boolean;
  loadError?: string | null;
  onRetry?: () => void;
  onGenerate?: () => void;
}) {
  const [avatarId, setAvatarId] = useState<string | null>(null);
  const [instruction, setInstruction] = useState("");
  return <ReferenceAvatarStep
    styleImages={styleImages}
    selectedAvatarStyleImageId={avatarId}
    userImageInstruction={instruction}
    outputFormat={outputFormat}
    loading={loading}
    loadError={loadError}
    submitting={false}
    attachmentsReady
    attachmentUploader={<div>첨부 이미지 영역</div>}
    onAvatarStyleImageChange={setAvatarId}
    onUserImageInstructionChange={setInstruction}
    onRetry={onRetry}
    onGenerate={onGenerate}
  />;
}

describe("ReferenceAvatarStep", () => {
  it("previews only approved Brand Rules images and allows one optional avatar from that exact set", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    expect(screen.getByRole("heading", { name: "브랜드 스타일과 이미지 설정" })).toBeVisible();
    expect(screen.getByRole("img", { name: "차분한 편집 스타일" })).toHaveAttribute("src", styles[0]!.previewUrl);
    expect(screen.getByRole("img", { name: "선명한 제품 스타일" })).toHaveAttribute("src", styles[1]!.previewUrl);
    expect(screen.getAllByText("자동 적용")).toHaveLength(styles.length);
    await user.click(screen.getByRole("radio", { name: /차분한 편집 스타일/ }));
    await user.click(screen.getByRole("radio", { name: /선명한 제품 스타일/ }));
    expect(screen.getByRole("radio", { name: /차분한 편집 스타일/ })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: /선명한 제품 스타일/ })).toBeChecked();
    await user.click(screen.getByRole("radio", { name: "아바타 사용 안 함" }));
    expect(screen.getByRole("radio", { name: "아바타 사용 안 함" })).toBeChecked();

    expect(screen.queryByRole("tablist", { name: /레퍼런스/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/아바타 라이브러리|이번 생성에만 사용할 아바타|아바타 업로드/)).not.toBeInTheDocument();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });

  it("allows an empty style set, a common image instruction, and one final package", async () => {
    const user = userEvent.setup();
    const generate = vi.fn();
    render(<Harness styleImages={[]} onGenerate={generate} />);

    expect(screen.getByText("등록된 브랜드 스타일 이미지 없이 생성합니다")).toBeVisible();
    const prompt = screen.getByLabelText("모든 생성 이미지에 공통 적용할 프롬프트");
    await user.type(prompt, "밝고 정돈된 편집 디자인");
    expect(prompt).toHaveValue("밝고 정돈된 편집 디자인");
    expect(screen.getByText("첨부 이미지 영역")).toBeVisible();
    await user.click(screen.getByRole("button", { name: "최종 콘텐츠 1개 생성" }));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(/생성 개수|output count|2개|3개/i)).not.toBeInTheDocument();
  });

  it("explains deferred blog images and supports retry after a real style load error", async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<Harness outputFormat="blog" loadError="브랜드 스타일 이미지를 불러오지 못했습니다." onRetry={retry} />);

    expect(screen.getByText(/블로그 작성 중 이미지가 필요하다고 판단한 경우에만 적용/)).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("브랜드 스타일 이미지를 불러오지 못했습니다");
    expect(screen.getByRole("button", { name: "최종 콘텐츠 1개 생성" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "브랜드 스타일 다시 불러오기" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
