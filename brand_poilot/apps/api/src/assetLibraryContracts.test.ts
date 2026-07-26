import { describe, expect, it } from "vitest";
import {
  parseAvatarInput,
  parseCreateAvatarInput,
  parseAssetUploadInput,
  parseReferenceBrandInput,
  parseReferenceFilters,
  parseReferenceUrlInput,
} from "./assetLibraryContracts.js";

describe("asset library contracts", () => {
  it("accepts trimmed avatar input without likeness-consent fields", () => {
    expect(parseAvatarInput({ name: "  여름 모델  ", description: "  밝은 톤 " })).toEqual({
      name: "여름 모델",
      description: "밝은 톤",
    });
    expect(() => parseAvatarInput({ name: "모델", likenessConsent: true })).toThrow(
      "avatar_validation_failed:likenessConsent",
    );
  });

  it("requires a reserved avatar UUID and 1-5 unique confirmed sessions with one representative", () => {
    const avatarId = "44444444-4444-4444-8444-444444444444";
    const first = "55555555-5555-4555-8555-555555555555";
    const second = "66666666-6666-4666-8666-666666666666";
    expect(parseCreateAvatarInput({
      avatarId, name: " 모델 ", description: "",
      imageSessionIds: [first, second], representativeSessionId: second,
    })).toEqual({
      avatarId, name: "모델", description: "",
      imageSessionIds: [first, second], representativeSessionId: second,
    });
    expect(() => parseCreateAvatarInput({
      avatarId, name: "모델", imageSessionIds: [], representativeSessionId: first,
    })).toThrow("avatar_validation_failed:imageSessionIds");
    expect(() => parseCreateAvatarInput({
      avatarId, name: "모델", imageSessionIds: [first, first], representativeSessionId: first,
    })).toThrow("avatar_validation_failed:imageSessionIds");
    expect(() => parseCreateAvatarInput({
      avatarId, name: "모델", imageSessionIds: [first], representativeSessionId: second,
    })).toThrow("avatar_validation_failed:representativeSessionId");
  });

  it("validates URL references and their content purpose", () => {
    expect(parseReferenceUrlInput({
      url: "https://example.com/campaign",
      contentPurpose: "marketing",
      title: " 캠페인 ",
    })).toEqual({
      url: "https://example.com/campaign",
      contentPurpose: "marketing",
      title: "캠페인",
    });
    expect(() => parseReferenceUrlInput({ url: "file:///tmp/a", contentPurpose: "both" }))
      .toThrow("reference_validation_failed:url");
  });

  it("normalizes all supported list filters", () => {
    expect(parseReferenceFilters({
      kind: "trend",
      contentFamily: "blog",
      strategy: "educational",
      format: " reel ",
      origin: " Acme ",
      favorite: "true",
      recent: "30",
    })).toEqual({
      kind: "trend",
      contentFamily: "blog",
      strategy: "educational",
      format: "reel",
      origin: "Acme",
      favorite: true,
      recent: 30,
    });
    expect(() => parseReferenceFilters({ favorite: "sometimes" }))
      .toThrow("reference_filter_invalid:favorite");
  });

  it("validates upload metadata and reference-brand public identities", () => {
    expect(parseAssetUploadInput({
      fileName: "photo.webp",
      mimeType: "image/webp",
      sizeBytes: 123,
      checksum: "a".repeat(64),
    })).toEqual({
      fileName: "photo.webp",
      mimeType: "image/webp",
      sizeBytes: 123,
      checksum: "a".repeat(64),
    });
    expect(parseReferenceBrandInput({ platform: "instagram", handle: "@acme" })).toEqual({
      platform: "instagram",
      handle: "acme",
      publicSourceUrl: "https://www.instagram.com/acme/",
    });
    expect(() => parseReferenceBrandInput({ platform: "instagram", handle: "not valid!" }))
      .toThrow("reference_brand_validation_failed:handle");
  });
});
