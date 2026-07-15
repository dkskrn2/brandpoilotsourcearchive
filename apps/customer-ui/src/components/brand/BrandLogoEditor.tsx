import { useRef, useState } from "react";
import { api, DEMO_BRAND_ID } from "../../lib/apiClient";
import type { BrandProfile } from "../../types";
import { BrandLogo } from "./BrandLogo";

const supportedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);
const maxLogoBytes = 2 * 1024 * 1024;

type BrandLogoClient = Pick<typeof api, "uploadBrandLogo" | "deleteBrandLogo">;

interface BrandLogoEditorProps {
  profile: BrandProfile;
  onProfileChange: (profile: BrandProfile) => void;
  client?: BrandLogoClient;
  brandId?: string;
  disabled?: boolean;
}

function fileBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("brand_logo_file_read_failed"));
    reader.onload = () => {
      const value = typeof reader.result === "string" ? reader.result : "";
      const encoded = value.split(",", 2)[1];
      if (!encoded) reject(new Error("brand_logo_file_read_failed"));
      else resolve(encoded);
    };
    reader.readAsDataURL(file);
  });
}

function uploadErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("brand_logo_storage_not_configured")) return "로고 저장소가 아직 설정되지 않았습니다.";
  if (message.includes("brand_logo_file_too_large")) return "로고 이미지는 2MB 이하여야 합니다.";
  if (message.includes("brand_logo_unsupported_type") || message.includes("brand_logo_invalid_file")) {
    return "PNG, JPEG, WebP 이미지만 등록할 수 있습니다.";
  }
  return "로고를 저장하지 못했습니다. 기존 로고는 유지됩니다.";
}

export function BrandLogoEditor({
  profile,
  onProfileChange,
  client = api,
  brandId = DEMO_BRAND_ID,
  disabled = false
}: BrandLogoEditorProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    if (!supportedMimeTypes.has(file.type)) {
      setError("PNG, JPEG, WebP 이미지만 등록할 수 있습니다.");
      return;
    }
    if (file.size > maxLogoBytes) {
      setError("로고 이미지는 2MB 이하여야 합니다.");
      return;
    }
    setIsWorking(true);
    setError(null);
    try {
      const updated = await client.uploadBrandLogo(brandId, {
        fileName: file.name,
        mimeType: file.type,
        fileBase64: await fileBase64(file)
      });
      onProfileChange(updated);
    } catch (uploadError) {
      setError(uploadErrorMessage(uploadError));
    } finally {
      setIsWorking(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function remove() {
    setIsWorking(true);
    setError(null);
    try {
      onProfileChange(await client.deleteBrandLogo(brandId));
    } catch (deleteError) {
      setError(uploadErrorMessage(deleteError));
    } finally {
      setIsWorking(false);
    }
  }

  return (
    <div className="brand-logo-editor">
      <BrandLogo brandName={profile.name} logoUrl={profile.logoUrl} className="brand-logo-editor-preview" />
      <div className="brand-logo-editor-actions">
        <label className={`button${isWorking || disabled ? " is-disabled" : ""}`}>
          {isWorking ? "처리 중" : profile.logoUrl ? "이미지 변경" : "이미지 등록"}
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            aria-label="로고 이미지 선택"
            accept="image/png,image/jpeg,image/webp"
            disabled={isWorking || disabled}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              if (file) void upload(file);
            }}
          />
        </label>
        {profile.logoUrl ? (
          <button className="button danger" type="button" disabled={isWorking || disabled} onClick={() => void remove()}>
            로고 삭제
          </button>
        ) : null}
      </div>
      <p className="brand-logo-editor-help">PNG, JPEG, WebP · 최대 2MB · 정사각형 권장</p>
      {error ? <p className="brand-logo-editor-error" role="alert">{error}</p> : null}
    </div>
  );
}
