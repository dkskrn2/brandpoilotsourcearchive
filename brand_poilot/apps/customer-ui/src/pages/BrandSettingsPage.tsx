import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Field } from "../components/ui/Field";
import { Switch } from "../components/ui/Switch";
import { InlineSpinner, PageSkeleton } from "../components/ui/LoadingState";
import { BrandLogoEditor } from "../components/brand/BrandLogoEditor";
import { brandIntelligenceGateway } from "../features/brand-intelligence/brandIntelligenceGateway";
import type { BrandAnalysis } from "../features/brand-intelligence/types";
import { api, DEMO_BRAND_ID } from "../lib/apiClient";
import type {
  BrandContentFormat,
  BrandProfile,
  BrandProfileInput,
  ContentCategory,
  InstagramDeliveryFormat,
  InstagramFormatSettings,
  InstagramFormatSettingsInput
} from "../types";

const primaryCustomerOptions = [
  "신규 창업자",
  "소상공인",
  "1인 사업자",
  "온라인 쇼핑몰 운영자",
  "지역 기반 매장 운영자",
  "기업 실무 담당자",
  "가족 단위 고객"
];

const customOptionValue = "__custom__";
const maxSubcategorySelections = 5;
const fixedFormatOrder: InstagramDeliveryFormat[] = [
  "instagram_feed_carousel",
  "instagram_story",
  "instagram_reel"
];
const displayedFormatOrder: InstagramDeliveryFormat[] = [
  "instagram_feed_carousel",
  "instagram_reel",
  "instagram_story"
];

const formatMeta: Record<InstagramDeliveryFormat, { label: string; description: string }> = {
  instagram_feed_carousel: {
    label: "Card News",
    description: "정방형 이미지 1~5장을 사용하는 피드 카드뉴스"
  },
  instagram_story: {
    label: "Story",
    description: "9:16 세로 이미지 한 장을 사용하는 Story"
  },
  instagram_reel: {
    label: "Reel",
    description: "세로 장면과 커버로 구성한 짧은 MP4 영상"
  }
};

function profilesMatch(left: BrandProfile, right: BrandProfile) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function normalizeFormatSettings(settings: InstagramFormatSettings) {
  const formats = fixedFormatOrder.map((format) => settings.formats.find((candidate) => candidate.format === format));
  if (formats.some((format) => !format)) {
    throw new Error("instagram_format_settings_incomplete");
  }
  return {
    ...settings,
    formats: (formats as BrandContentFormat[]).map((format) => ({
      ...format,
      enabled: format.capabilityStatus === "available" && format.enabled
    }))
  };
}

function normalizeBrandProfile(profile: BrandProfile): BrandProfile {
  return {
    ...profile,
    primaryCategory: profile.primaryCategory ?? null,
    subcategories: Array.isArray(profile.subcategories) ? profile.subcategories.slice(0, maxSubcategorySelections) : [],
    logoUrl: profile.logoUrl ?? null
  };
}

function formatSettingsMatch(left: InstagramFormatSettings, right: InstagramFormatSettings) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function changedBrandProfileInput(saved: BrandProfile, draft: BrandProfile): BrandProfileInput {
  const input: BrandProfileInput = {};
  if (saved.name !== draft.name) input.name = draft.name;
  if (saved.primaryCustomer !== draft.primaryCustomer) input.primaryCustomer = draft.primaryCustomer;
  if (saved.description !== draft.description) input.description = draft.description;
  if (saved.tone !== draft.tone) input.tone = draft.tone;
  if (saved.defaultCta !== draft.defaultCta) input.defaultCta = draft.defaultCta;
  if (saved.mainLink !== draft.mainLink) input.mainLink = draft.mainLink;
  if (saved.autoApprovalEnabled !== draft.autoApprovalEnabled) input.autoApprovalEnabled = draft.autoApprovalEnabled;
  if (saved.primaryCategory?.code !== draft.primaryCategory?.code) {
    input.primaryCategoryCode = draft.primaryCategory?.code ?? null;
  }
  if (JSON.stringify(saved.subcategories) !== JSON.stringify(draft.subcategories)) {
    input.subcategories = draft.subcategories.map((subcategory) => subcategory.type === "system"
      ? { type: "system", code: subcategory.code! }
      : { type: "custom", name: subcategory.name });
  }
  return input;
}

function saveFailureMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  if (message.includes("401:authentication_required")) {
    return "로그인 세션이 만료되어 저장하지 못했습니다. 새로고침 후 다시 로그인하세요.";
  }
  if (message.includes("403:workspace_access_denied")) {
    return "현재 계정으로 이 브랜드를 수정할 수 없습니다. 로그인 계정을 확인하세요.";
  }
  if (message.includes("400:brand_profile_field_too_long")) {
    return "직접 입력한 세부 분야는 30자 이내로 입력하세요.";
  }
  if (message.includes("400:invalid_brand_color")) {
    return "브랜드 주색은 30자 이내로 입력하세요.";
  }
  if (message.includes("story_capability_required")) {
    return "Meta 연결 확인 후 Story 형식을 활성화하세요.";
  }
  return "API 저장에 실패했습니다. 변경사항은 저장되지 않았습니다.";
}

export function BrandSettingsPage() {
  const [savedProfile, setSavedProfile] = useState<BrandProfile | null>(null);
  const [draftProfile, setDraftProfile] = useState<BrandProfile | null>(null);
  const [savedFormats, setSavedFormats] = useState<InstagramFormatSettings | null>(null);
  const [draftFormats, setDraftFormats] = useState<InstagramFormatSettings | null>(null);
  const [isProfileLoading, setIsProfileLoading] = useState(true);
  const [areFormatsLoading, setAreFormatsLoading] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [formatLoadError, setFormatLoadError] = useState<string | null>(null);
  const [categories, setCategories] = useState<ContentCategory[]>([]);
  const [categoryLoadError, setCategoryLoadError] = useState<string | null>(null);
  const [showSavedBadge, setShowSavedBadge] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [apiNotice, setApiNotice] = useState<string | null>(null);
  const [brandIntelligence, setBrandIntelligence] = useState<BrandAnalysis | null>(null);
  const [ownedSourceUrl, setOwnedSourceUrl] = useState<string | null>(null);
  const [areInstagramFormatsExpanded, setAreInstagramFormatsExpanded] = useState(true);
  const [primaryCustomerEntryMode, setPrimaryCustomerEntryMode] = useState<"select" | "custom">("select");
  const hasUnsavedChanges = Boolean(
    savedProfile && draftProfile && !profilesMatch(savedProfile, draftProfile)
  ) || Boolean(
    savedFormats && draftFormats && !formatSettingsMatch(savedFormats, draftFormats)
  );
  const hasRequiredFields = Boolean(
    draftProfile?.name.trim()
    && draftProfile.primaryCategory?.code
    && draftProfile.primaryCustomer.trim()
    && draftProfile.description.trim()
  );
  const selectedCategory = categories.find((category) => category.code === draftProfile?.primaryCategory?.code);
  const availableFormats = draftFormats?.formats.filter((format) => format.capabilityStatus === "available") ?? [];
  const enabledAvailableFormatCount = availableFormats.filter((format) => format.enabled).length;
  const autoApprovalState = enabledAvailableFormatCount === 0
    ? "off"
    : enabledAvailableFormatCount === availableFormats.length
      ? "on"
      : "mixed";

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => api.getBrandProfile(DEMO_BRAND_ID))
      .then((profile) => {
        if (ignore) return;
        const normalizedProfile = normalizeBrandProfile(profile);
        setSavedProfile(normalizedProfile);
        setDraftProfile(normalizedProfile);
        setPrimaryCustomerEntryMode(
          normalizedProfile.primaryCustomer && !primaryCustomerOptions.includes(normalizedProfile.primaryCustomer) ? "custom" : "select"
        );
        setProfileLoadError(null);
      })
      .catch(() => {
        if (ignore) return;
        setProfileLoadError("API 서버가 응답하지 않아 브랜드 설정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!ignore) setIsProfileLoading(false);
      });
    Promise.resolve()
      .then(() => api.getInstagramFormats(DEMO_BRAND_ID))
      .then((settings) => {
        if (ignore) return;
        const normalized = normalizeFormatSettings(settings);
        setSavedFormats(normalized);
        setDraftFormats(normalized);
        setFormatLoadError(null);
      })
      .catch(() => {
        if (ignore) return;
        setFormatLoadError("Instagram 형식 설정을 불러오지 못했습니다.");
      })
      .finally(() => {
        if (!ignore) setAreFormatsLoading(false);
      });
    Promise.resolve()
      .then(() => api.listContentCategories())
      .then((loadedCategories) => {
        if (ignore) return;
        setCategories(loadedCategories);
        setCategoryLoadError(null);
      })
      .catch(() => {
        if (!ignore) setCategoryLoadError("대표 분야를 불러오지 못했습니다.");
      });
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => api.listSources(DEMO_BRAND_ID))
      .then((sources) => {
        if (!ignore) setOwnedSourceUrl(sources.find((source) => source.sourceType === "owned" && source.enabled)?.url ?? null);
      })
      .catch(() => { if (!ignore) setOwnedSourceUrl(null); });
    return () => { ignore = true; };
  }, []);

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => brandIntelligenceGateway.getCurrent(DEMO_BRAND_ID))
      .then((value) => { if (!ignore) setBrandIntelligence(value); })
      .catch(() => { if (!ignore) setBrandIntelligence(null); });
    return () => { ignore = true; };
  }, []);

  function updateDraftProfile<K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) {
    setDraftProfile((currentProfile) => currentProfile ? ({ ...currentProfile, [key]: value }) : currentProfile);
    setShowSavedBadge(false);
  }

  function mergeLogoProfile(profile: BrandProfile) {
    setSavedProfile((current) => current ? { ...current, logoUrl: profile.logoUrl } : profile);
    setDraftProfile((current) => current ? { ...current, logoUrl: profile.logoUrl } : profile);
  }

  function updateDraftFormat(format: InstagramDeliveryFormat, enabled: boolean) {
    if (!draftFormats) return;
    const formats = draftFormats.formats.map((candidate) => candidate.format === format ? { ...candidate, enabled } : candidate);
    setDraftFormats({ ...draftFormats, formats });
    setDraftProfile((current) => current ? ({
      ...current,
      autoApprovalEnabled: formats.some((candidate) => candidate.capabilityStatus === "available" && candidate.enabled)
    }) : current);
    setShowSavedBadge(false);
  }

  function toggleAllAutoApprovalFormats() {
    if (!draftFormats || availableFormats.length === 0) return;
    const enabled = autoApprovalState !== "on";
    setDraftFormats({
      ...draftFormats,
      formats: draftFormats.formats.map((format) => ({
        ...format,
        enabled: format.capabilityStatus === "available" ? enabled : false
      }))
    });
    updateDraftProfile("autoApprovalEnabled", enabled);
    setShowSavedBadge(false);
  }

  function updateBrandColor(brandColor: string) {
    setDraftFormats((current) => current ? { ...current, brandColor } : current);
    setShowSavedBadge(false);
  }

  function cancelChanges() {
    if (savedProfile) {
      setDraftProfile(savedProfile);
      setPrimaryCustomerEntryMode(
        savedProfile.primaryCustomer && !primaryCustomerOptions.includes(savedProfile.primaryCustomer) ? "custom" : "select"
      );
    }
    if (savedFormats) setDraftFormats(savedFormats);
    setShowSavedBadge(false);
  }

  function selectPrimaryCustomer(value: string) {
    if (value === customOptionValue) {
      setPrimaryCustomerEntryMode("custom");
      if (draftProfile && primaryCustomerOptions.includes(draftProfile.primaryCustomer)) updateDraftProfile("primaryCustomer", "");
      return;
    }
    setPrimaryCustomerEntryMode("select");
    updateDraftProfile("primaryCustomer", value);
  }

  function updateSubcategories(subcategories: BrandProfile["subcategories"]) {
    updateDraftProfile("subcategories", subcategories);
  }

  function selectCategory(code: string) {
    if (!draftProfile) return;
    const incompatible = draftProfile.subcategories.filter(
      (subcategory) => subcategory.type === "system" && !categories.find((category) => category.code === code)?.subcategories.some((candidate) => candidate.code === subcategory.code)
    );
    if (incompatible.length > 0 && !window.confirm(`현재 선택한 세부 분야 ${incompatible.length}개가 새 대표 분야와 맞지 않습니다. 제거할까요?`)) return;
    updateDraftProfile("primaryCategory", categories.find((category) => category.code === code) ? { code, name: categories.find((category) => category.code === code)!.name } : null);
    updateSubcategories(draftProfile.subcategories.filter((subcategory) => !incompatible.includes(subcategory)));
  }

  function toggleSystemSubcategory(code: string, name: string) {
    if (!draftProfile) return;
    const current = draftProfile.subcategories;
    const selected = current.some((subcategory) => subcategory.type === "system" && subcategory.code === code);
    if (selected) {
      updateSubcategories(current.filter((subcategory) => !(subcategory.type === "system" && subcategory.code === code)));
    } else if (current.length < maxSubcategorySelections) {
      updateSubcategories([...current, { type: "system", code, name }]);
    }
  }

  function addCustomSubcategory() {
    if (!draftProfile) return;
    const input = document.querySelector<HTMLInputElement>("[aria-label='직접 입력 세부 분야']");
    const value = input?.value ?? "";
    const normalized = value.normalize("NFKC").trim().toLocaleLowerCase();
    if (Array.from(value.normalize("NFKC").trim()).length > 30) {
      setApiNotice("직접 입력한 세부 분야는 30자 이내로 입력하세요.");
      return;
    }
    if (!normalized) return;
    if (draftProfile.subcategories.some((subcategory) => subcategory.name.normalize("NFKC").trim().toLocaleLowerCase() === normalized)) {
      setApiNotice("이미 선택한 세부 분야입니다.");
      return;
    }
    if (draftProfile.subcategories.length >= maxSubcategorySelections) {
      setApiNotice(`세부 분야는 최대 ${maxSubcategorySelections}개까지 선택할 수 있습니다.`);
      return;
    }
    updateSubcategories([...draftProfile.subcategories, { type: "custom", code: null, name: value.normalize("NFKC").trim() }]);
    input!.value = "";
    setApiNotice(null);
  }

  async function saveChanges() {
    if (!draftProfile || !savedProfile) return;
    setIsSaving(true);
    try {
      const profileInput = changedBrandProfileInput(savedProfile, draftProfile);
      const profileRequest = Object.keys(profileInput).length === 0
        ? Promise.resolve(savedProfile)
        : api.updateBrandProfile(DEMO_BRAND_ID, profileInput);
      const formatInput: InstagramFormatSettingsInput | null = draftFormats ? {
        brandColor: draftFormats.brandColor?.trim() || null,
        formats: fixedFormatOrder.map((format) => ({
          format,
          enabled: draftFormats.formats.find((candidate) => candidate.format === format)?.enabled ?? false
        }))
      } : null;
      const formatRequest = savedFormats && draftFormats && formatInput && !formatSettingsMatch(savedFormats, draftFormats)
        ? api.updateInstagramFormats(DEMO_BRAND_ID, formatInput)
        : Promise.resolve(savedFormats);
      const [saved, updatedFormats] = await Promise.all([profileRequest, formatRequest]);
      const normalizedProfile = normalizeBrandProfile(saved);
      setSavedProfile(normalizedProfile);
      setDraftProfile(normalizedProfile);
      if (updatedFormats) {
        const normalized = normalizeFormatSettings(updatedFormats);
        setSavedFormats(normalized);
        setDraftFormats(normalized);
      }
      setApiNotice(null);
      setShowSavedBadge(true);
    } catch (error) {
      setApiNotice(saveFailureMessage(error));
      setShowSavedBadge(false);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="content">
      <PageHeader
        title="브랜드 설정"
        description="콘텐츠 생성에 필요한 브랜드 프로필을 입력하고, 생성 기준과 자동 승인은 선택 설정으로 관리합니다."
        actions={
          <>
            {hasUnsavedChanges ? <Badge variant="warn">변경사항 있음</Badge> : null}
            {showSavedBadge && !hasUnsavedChanges ? <Badge variant="ok">저장됨</Badge> : null}
            <button className="button" type="button" onClick={cancelChanges} disabled={isSaving}>변경 취소</button>
            <button className="button primary" type="button" aria-label="저장" aria-busy={isSaving} onClick={saveChanges} disabled={isSaving || !draftProfile}>
              {isSaving ? <InlineSpinner label="브랜드 설정 저장 중" /> : null} 저장
            </button>
          </>
        }
      />

      {isProfileLoading || areFormatsLoading ? (
        <PageSkeleton label="브랜드 설정을 불러오는 중입니다." />
      ) : null}
      {profileLoadError ? <Alert title="API 상태" variant="warn">{profileLoadError}</Alert> : null}
      {categoryLoadError ? <Alert title="대표 분야" variant="warn">{categoryLoadError}</Alert> : null}
      {formatLoadError ? <Alert title="Instagram 형식" variant="warn">{formatLoadError}</Alert> : null}
      {apiNotice ? <Alert title="API 상태" variant="warn">{apiNotice}</Alert> : null}

      {draftProfile ? (
        <>
          <div className="grid two">

        <section className="panel">
          <div className="panel-head">
            <h2>브랜드 프로필</h2>
            <Badge variant={hasRequiredFields ? "ok" : "warn"}>{hasRequiredFields ? "필수 입력 완료" : "필수 입력 필요"}</Badge>
          </div>
          <div className="panel-body brand-profile-layout">
            <BrandLogoEditor profile={draftProfile} onProfileChange={mergeLogoProfile} disabled={isSaving} />
            <div className="form-grid brand-profile-fields">
            <Field label="브랜드명" full required>
              <input
                aria-label="브랜드명"
                required
                disabled={isSaving}
                placeholder="예: 제주의 하루 여행 상담"
                value={draftProfile.name}
                onChange={(event) => updateDraftProfile("name", event.currentTarget.value)}
              />
            </Field>
            {draftFormats ? (
              <Field label="브랜드 주색" full>
                <input
                  aria-label="브랜드 주색"
                  maxLength={30}
                  placeholder="예: 파란색 또는 #2563EB"
                  disabled={isSaving}
                  value={draftFormats.brandColor ?? ""}
                  onChange={(event) => updateBrandColor(event.currentTarget.value)}
                />
              </Field>
            ) : null}
            <Field label="대표 분야" full required>
              <select
                aria-label="대표 분야 선택"
                required
                disabled={isSaving}
                value={draftProfile.primaryCategory?.code ?? ""}
                onChange={(event) => selectCategory(event.currentTarget.value)}
              >
                <option value="">대표 분야를 선택하세요.</option>
                {categories.map((category) => (
                  <option key={category.code} value={category.code}>{category.name}</option>
                ))}
              </select>
              <div className="subcategory-section" aria-label="세부 분야">
                <div className="subcategory-section__head">
                  <strong>세부 분야</strong>
                  <span>선택 {draftProfile.subcategories.length}/{maxSubcategorySelections}</span>
                </div>
                <div className="subcategory-grid">
                  {(selectedCategory?.subcategories ?? []).map((subcategory) => {
                    const checked = draftProfile.subcategories.some((candidate) => candidate.type === "system" && candidate.code === subcategory.code);
                    return (
                      <label className="subcategory-option" key={subcategory.code}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isSaving || (!checked && draftProfile.subcategories.length >= maxSubcategorySelections)}
                          onChange={() => toggleSystemSubcategory(subcategory.code, subcategory.name)}
                        />
                        <span>{subcategory.name}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="subcategory-custom-row">
                  <input aria-label="직접 입력 세부 분야" placeholder="세부 분야 직접 입력" disabled={isSaving || draftProfile.subcategories.length >= maxSubcategorySelections} />
                  <button className="button" type="button" aria-label="세부 분야 추가" onClick={addCustomSubcategory} disabled={isSaving || draftProfile.subcategories.length >= maxSubcategorySelections}>추가</button>
                </div>
                {draftProfile.subcategories.length > 0 ? (
                  <div className="subcategory-chips" aria-label="선택한 세부 분야">
                    {draftProfile.subcategories.map((subcategory) => (
                      <button className="subcategory-chip" type="button" key={`${subcategory.type}-${subcategory.code ?? subcategory.name}`} aria-label={`${subcategory.name} 제거`} disabled={isSaving} onClick={() => subcategory.type === "system" ? toggleSystemSubcategory(subcategory.code!, subcategory.name) : updateSubcategories(draftProfile.subcategories.filter((candidate) => candidate !== subcategory))}>
                        {subcategory.name}<span aria-hidden="true">×</span>
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </Field>
            <Field label="핵심 고객" full required>
              <select
                aria-label="핵심 고객 선택"
                required
                disabled={isSaving}
                value={primaryCustomerEntryMode === "custom" ? customOptionValue : draftProfile.primaryCustomer}
                onChange={(event) => selectPrimaryCustomer(event.currentTarget.value)}
              >
                <option value="">핵심 고객 예시를 선택하세요</option>
                {primaryCustomerOptions.map((customer) => (
                  <option key={customer} value={customer}>{customer}</option>
                ))}
                <option value={customOptionValue}>직접 입력</option>
              </select>
              {primaryCustomerEntryMode === "custom" ? (
                <input
                  aria-label="핵심 고객 직접 입력"
                  maxLength={30}
                  required
                  disabled={isSaving}
                  placeholder="예: 제주 여행을 처음 준비하는 가족"
                  value={draftProfile.primaryCustomer}
                  onChange={(event) => updateDraftProfile("primaryCustomer", event.currentTarget.value)}
                />
              ) : null}
            </Field>
            <Field label="제품/서비스 설명" full required>
              <textarea
                aria-label="제품/서비스 설명"
                required
                disabled={isSaving}
                placeholder="예: 제주 일정과 숙소 동선을 1:1로 상담해주는 여행 계획 서비스"
                value={draftProfile.description}
                onChange={(event) => updateDraftProfile("description", event.currentTarget.value)}
              />
            </Field>
            </div>
          </div>
        </section>

        <section className="panel">
          <div className="panel-head">
            <h2>생성 기준</h2>
            <Badge variant="info">선택 입력</Badge>
          </div>
          <div className="panel-body form-grid">
            <Field label="톤앤매너" full>
              <textarea
                placeholder="예: 친절하고 과장 없는 전문가 톤"
                value={draftProfile.tone}
                disabled={isSaving}
                onChange={(event) => updateDraftProfile("tone", event.currentTarget.value)}
              />
            </Field>
            <Field label="기본 CTA" full>
              <input
                placeholder="예: 무료 상담 신청하기"
                value={draftProfile.defaultCta}
                disabled={isSaving}
                onChange={(event) => updateDraftProfile("defaultCta", event.currentTarget.value)}
              />
            </Field>
          </div>
        </section>
          </div>

          <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>자동 승인</h2>
          <div className="actions">
            <Badge variant="info">선택 설정</Badge>
            <Badge variant={autoApprovalState === "on" ? "auto" : autoApprovalState === "mixed" ? "info" : "neutral"}>
              {autoApprovalState === "on" ? "전체 켜짐" : autoApprovalState === "mixed" ? "일부 켜짐" : "전체 꺼짐"}
            </Badge>
          </div>
        </div>
        <div className="panel-body grid">
          <div className="toggle-row">
            <div>
              <strong>브랜드 전체 자동 승인</strong>
              <p className="muted">
                켜면 자동 승인 조건을 통과한 콘텐츠가 검토 없이 게시 관리 목록으로 들어갑니다.
                끄면 모든 채널 결과물이 수동 검토 대상으로 생성됩니다.
              </p>
            </div>
            <Switch
              label="브랜드 전체 자동 승인"
              checked={autoApprovalState === "on"}
              indeterminate={autoApprovalState === "mixed"}
              disabled={isSaving || availableFormats.length === 0}
              onChange={toggleAllAutoApprovalFormats}
            />
          </div>
          <Alert title="적용 범위" variant="info">
            Instagram, Threads에 동일하게 적용합니다. MVP에서는 채널마다 다른 예외 설정을 제공하지 않습니다.
          </Alert>
          <Alert title="자동 승인 차단 조건" variant="warn">
            Instagram 이미지 생성에 실패하면 자동 승인을 차단합니다. 금지 표현과 근거 품질은 수동 검토에서 확인합니다.
          </Alert>
          {draftFormats ? (
            <section className="auto-approval-channel" aria-labelledby="instagram-auto-approval-heading">
              <div className="auto-approval-channel__intro">
                <h3 id="instagram-auto-approval-heading">Instagram</h3>
                <p className="muted">Instagram 자동 승인에 사용할 콘텐츠 형식을 선택합니다. 다른 채널의 콘텐츠 형식도 이 영역에 추가됩니다.</p>
              </div>
              <div className="instagram-formats-accordion">
                <div className="instagram-formats-accordion__head">
                  <div>
                    <h4 id="instagram-formats-heading">Instagram 콘텐츠 형식</h4>
                    <div className="row-meta">표시 순서 · Card News → Reel → Story</div>
                  </div>
                  <div className="actions">
                    <Badge variant="info">선택 설정</Badge>
                    <button
                      className="icon-button instagram-formats-accordion__trigger"
                      type="button"
                      aria-label={`Instagram 콘텐츠 형식 ${areInstagramFormatsExpanded ? "접기" : "펼치기"}`}
                      aria-expanded={areInstagramFormatsExpanded}
                      aria-controls="instagram-formats-panel"
                      title={`Instagram 콘텐츠 형식 ${areInstagramFormatsExpanded ? "접기" : "펼치기"}`}
                      onClick={() => setAreInstagramFormatsExpanded((expanded) => !expanded)}
                    >
                      <ChevronDown aria-hidden="true" size={18} />
                    </button>
                  </div>
                </div>
                <div
                  id="instagram-formats-panel"
                  className="instagram-formats-accordion__body grid"
                  role="region"
                  aria-labelledby="instagram-formats-heading"
                  hidden={!areInstagramFormatsExpanded}
                >
                  {displayedFormatOrder.map((formatName) => {
                    const format = draftFormats.formats.find((candidate) => candidate.format === formatName)!;
                    const meta = formatMeta[format.format];
                    const formatUnavailable = format.capabilityStatus !== "available";
                    return (
                      <div className="toggle-row" key={format.format}>
                        <div>
                          <strong>{meta.label}</strong>
                          <p className="muted">{meta.description}</p>
                          {formatUnavailable ? (
                            <p className="muted" role="note">Meta 연결 확인이 필요합니다. 권한과 {meta.label} 기능 확인 후 활성화할 수 있습니다.</p>
                          ) : null}
                        </div>
                        <fieldset
                          disabled={formatUnavailable || isSaving}
                          style={{ minWidth: 0, margin: 0, padding: 0, border: 0 }}
                        >
                          <Switch
                            label={meta.label}
                            checked={format.enabled}
                            disabled={isSaving}
                            onChange={(checked) => updateDraftFormat(format.format, checked)}
                          />
                        </fieldset>
                      </div>
                    );
                  })}
                </div>
              </div>
            </section>
          ) : null}
        </div>
          </section>

        </>
      ) : null}
      <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <div>
            <h2>확정된 브랜드 정보</h2>
            <div className="row-meta">자사 자료를 분석하고 확인한 정보입니다. 콘텐츠 생성과 고객 응답에 공통으로 사용됩니다.</div>
          </div>
          <a className="button" href="/onboarding/brand-intelligence">
            {brandIntelligence ? "브랜드 정보 다시 분석" : "브랜드 정보 만들기"}
          </a>
        </div>
        <div className="panel-body">
          {brandIntelligence?.effectiveResult ? (
            <dl className="brand-intelligence-summary">
              <div><dt>대표 URL</dt><dd>{ownedSourceUrl ?? brandIntelligence.input.ownedUrl ?? "첨부 문서로 분석"}</dd></div>
              <div><dt>기업 개요</dt><dd>{brandIntelligence.effectiveResult.companyOverview}</dd></div>
              <div><dt>사업 소개</dt><dd>{brandIntelligence.effectiveResult.businessDescription}</dd></div>
              <div><dt>분야</dt><dd>{[brandIntelligence.effectiveResult.primaryCategory.name, ...brandIntelligence.effectiveResult.subcategories.map((item) => item.name)].filter(Boolean).join(" · ")}</dd></div>
              <div><dt>핵심 타깃</dt><dd>{brandIntelligence.effectiveResult.primaryTarget}</dd></div>
              <div><dt>차별점</dt><dd>{brandIntelligence.effectiveResult.differentiators}</dd></div>
              <div><dt>핵심 소구점</dt><dd>{brandIntelligence.effectiveResult.coreAppeal}</dd></div>
            </dl>
          ) : <p className="muted">아직 확정된 브랜드 정보가 없습니다.</p>}
        </div>
      </section>
    </section>
  );
}
