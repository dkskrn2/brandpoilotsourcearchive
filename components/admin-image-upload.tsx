"use client";

import Image from "next/image";
import { type ChangeEvent, createContext, type ReactNode, useContext, useState } from "react";

type ImageUploadContextValue = {
  isUploading: boolean;
  setIsUploading: (isUploading: boolean) => void;
};

const ImageUploadContext = createContext<ImageUploadContextValue | null>(null);
const acceptedImageTypes = "image/jpeg,image/png,image/webp,image/gif,image/avif";

export function AdminImageUploadProvider({ children }: { children: ReactNode }) {
  const [isUploading, setIsUploading] = useState(false);
  return <ImageUploadContext.Provider value={{ isUploading, setIsUploading }}>{children}</ImageUploadContext.Provider>;
}

export function useAdminImageUpload() {
  const context = useContext(ImageUploadContext);
  if (!context) throw new Error("AdminImageUploadProvider is required");
  return context;
}

export function AdminImageUpload({ initialImage = "", initialImageAlt = "" }: { initialImage?: string; initialImageAlt?: string }) {
  const [image, setImage] = useState(initialImage);
  const [error, setError] = useState("");
  const { isUploading, setIsUploading } = useAdminImageUpload();

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    setError("");
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.set("file", file);
      const response = await fetch("/api/admin/images", { method: "POST", body: formData });
      const payload = await response.json().catch(() => null) as { url?: unknown; error?: unknown } | null;
      if (!response.ok || !payload || typeof payload.url !== "string") {
        throw new Error(typeof payload?.error === "string" ? payload.error : "이미지를 업로드하지 못했습니다.");
      }
      setImage(payload.url);
      input.value = "";
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "이미지를 업로드하지 못했습니다.");
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="admin-image-upload">
      <input type="hidden" name="image" value={image} />
      <label>
        <span>이미지 파일 (선택)</span>
        <input type="file" accept={acceptedImageTypes} onChange={uploadImage} disabled={isUploading} />
        <small>JPG, PNG, WebP, GIF, AVIF · 최대 4MB</small>
      </label>
      {image ? (
        <div className="admin-image-upload__preview">
          <Image src={image} alt="" width={320} height={200} sizes="160px" />
          <div><strong>{isUploading ? "새 이미지를 업로드하는 중입니다." : "현재 대표 이미지가 설정되어 있습니다."}</strong><button type="button" onClick={() => setImage("")} disabled={isUploading}>이미지 제거</button></div>
        </div>
      ) : <p className="admin-image-upload__empty">대표 이미지는 선택 사항입니다.</p>}
      {error && <p className="admin-form-message is-error" role="alert">{error}</p>}
      <label><span>이미지 설명 (선택)</span><input name="imageAlt" defaultValue={initialImageAlt} placeholder="이미지가 전달하는 내용을 설명하세요" /></label>
    </div>
  );
}
