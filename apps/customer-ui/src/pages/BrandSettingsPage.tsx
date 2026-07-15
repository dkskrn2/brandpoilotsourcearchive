import { useEffect, useState } from "react";
import { PageHeader } from "../components/layout/PageHeader";
import { Alert } from "../components/ui/Alert";
import { Badge } from "../components/ui/Badge";
import { Field } from "../components/ui/Field";
import { Switch } from "../components/ui/Switch";
import { BrandLogoEditor } from "../components/brand/BrandLogoEditor";
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
const fixedFormatOrder: InstagramDeliveryFormat[] = [
  "instagram_feed_carousel",
  "instagram_story",
  "instagram_reel"
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
  return { ...settings, formats: formats as BrandContentFormat[] };
}

function formatSettingsMatch(left: InstagramFormatSettings, right: InstagramFormatSettings) {
  return JSON.stringify(left) === JSON.stringify(right);
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

  useEffect(() => {
    let ignore = false;
    Promise.resolve()
      .then(() => api.getBrandProfile(DEMO_BRAND_ID))
      .then((profile) => {
        if (ignore) return;
        setSavedProfile(profile);
        setDraftProfile(profile);
        setPrimaryCustomerEntryMode(
          profile.primaryCustomer && !primaryCustomerOptions.includes(profile.primaryCustomer) ? "custom" : "select"
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

  function updateDraftProfile<K extends keyof BrandProfile>(key: K, value: BrandProfile[K]) {
    setDraftProfile((currentProfile) => currentProfile ? ({ ...currentProfile, [key]: value }) : currentProfile);
    setShowSavedBadge(false);
  }

  function mergeLogoProfile(profile: BrandProfile) {
    setSavedProfile((current) => current ? { ...current, logoUrl: profile.logoUrl } : profile);
    setDraftProfile((current) => current ? { ...current, logoUrl: profile.logoUrl } : profile);
  }

  function updateDraftFormat(format: InstagramDeliveryFormat, enabled: boolean) {
    setDraftFormats((current) => current ? ({
      ...current,
      formats: current.formats.map((candidate) => candidate.format === format ? { ...candidate, enabled } : candidate)
    }) : current);
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
    } else if (current.length < 5) {
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
    if (draftProfile.subcategories.length >= 5) {
      setApiNotice("세부 분야는 최대 5개까지 선택할 수 있습니다.");
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
      const profileInput: BrandProfileInput = {
        name: draftProfile.name,
        primaryCategoryCode: draftProfile.primaryCategory?.code ?? null,
        subcategories: draftProfile.subcategories.map((subcategory) => subcategory.type === "system"
          ? { type: "system", code: subcategory.code! }
          : { type: "custom", name: subcategory.name }),
        primaryCustomer: draftProfile.primaryCustomer,
        description: draftProfile.description,
        tone: draftProfile.tone,
        defaultCta: draftProfile.defaultCta,
        mainLink: draftProfile.mainLink,
        autoApprovalEnabled: draftProfile.autoApprovalEnabled
      };
      const profileRequest = profilesMatch(savedProfile, draftProfile)
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
      setSavedProfile(saved);
      setDraftProfile(saved);
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
            <button className="button primary" type="button" onClick={saveChanges} disabled={isSaving || !draftProfile}>
              {isSaving ? "저장 중" : "저장"}
            </button>
          </>
        }
      />

      {isProfileLoading || areFormatsLoading ? (
        <div role="status" className="muted" style={{ marginBottom: 16 }}>브랜드 설정을 불러오는 중입니다.</div>
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
            <Field label="브랜드명" required>
              <input
                aria-label="브랜드명"
                required
                disabled={isSaving}
                placeholder="예: 제주의 하루 여행 상담"
                value={draftProfile.name}
                onChange={(event) => updateDraftProfile("name", event.currentTarget.value)}
              />
            </Field>
            <Field label="대표 분야" required>
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
                  <span>선택 {draftProfile.subcategories.length}/5</span>
                </div>
                <div className="subcategory-grid">
                  {(selectedCategory?.subcategories ?? []).map((subcategory) => {
                    const checked = draftProfile.subcategories.some((candidate) => candidate.type === "system" && candidate.code === subcategory.code);
                    return (
                      <label className="subcategory-option" key={subcategory.code}>
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={isSaving || (!checked && draftProfile.subcategories.length >= 5)}
                          onChange={() => toggleSystemSubcategory(subcategory.code, subcategory.name)}
                        />
                        <span>{subcategory.name}</span>
                      </label>
                    );
                  })}
                </div>
                <div className="subcategory-custom-row">
                  <input aria-label="직접 입력 세부 분야" placeholder="세부 분야 직접 입력" disabled={isSaving || draftProfile.subcategories.length >= 5} />
                  <button className="button" type="button" aria-label="세부 분야 추가" onClick={addCustomSubcategory} disabled={isSaving || draftProfile.subcategories.length >= 5}>추가</button>
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
            <Field label="핵심 고객" required>
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
            <Field label="기본 CTA">
              <input
                placeholder="예: 무료 상담 신청하기"
                value={draftProfile.defaultCta}
                disabled={isSaving}
                onChange={(event) => updateDraftProfile("defaultCta", event.currentTarget.value)}
              />
            </Field>
            <Field label="주요 링크">
              <input
                placeholder="예: https://brand.example.com"
                value={draftProfile.mainLink}
                disabled={isSaving}
                onChange={(event) => updateDraftProfile("mainLink", event.currentTarget.value)}
              />
            </Field>
          </div>
        </section>
          </div>

          {draftFormats ? (
            <section className="panel" style={{ marginTop: 16 }}>
              <div className="panel-head">
                <div>
                  <h2>Instagram 콘텐츠 형식</h2>
                  <div className="row-meta">고정 순환 순서 · Card News → Story → Reel</div>
                </div>
                <Badge variant="info">선택 설정</Badge>
              </div>
              <div className="panel-body grid">
                <Field label="브랜드 주색">
                  <input
                    aria-label="브랜드 주색"
                    maxLength={30}
                    placeholder="예: 파란색 또는 #2563EB"
                    disabled={isSaving}
                    value={draftFormats.brandColor ?? ""}
                    onChange={(event) => updateBrandColor(event.currentTarget.value)}
                  />
                </Field>
                {draftFormats.formats.map((format) => {
                  const meta = formatMeta[format.format];
                  const storyUnavailable = format.format === "instagram_story" && format.capabilityStatus !== "available";
                  return (
                    <div className="toggle-row" key={format.format}>
                      <div>
                        <strong>{meta.label}</strong>
                        <p className="muted">{meta.description}</p>
                        {storyUnavailable ? (
                          <p className="muted" role="note">Meta 연결 확인이 필요합니다. Story 기능 확인 후 활성화할 수 있습니다.</p>
                        ) : null}
                      </div>
                      <fieldset
                        disabled={storyUnavailable || isSaving}
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
            </section>
          ) : null}

          <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>자동 승인</h2>
          <div className="actions">
            <Badge variant="info">선택 설정</Badge>
            <Badge variant={draftProfile.autoApprovalEnabled ? "auto" : "neutral"}>
              {draftProfile.autoApprovalEnabled ? "전체 켜짐" : "전체 꺼짐"}
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
              checked={draftProfile.autoApprovalEnabled}
              disabled={isSaving}
              onChange={(checked) => updateDraftProfile("autoApprovalEnabled", checked)}
            />
          </div>
          <Alert title="적용 범위" variant="info">
            Instagram, Threads에 동일하게 적용합니다. MVP에서는 채널마다 다른 예외 설정을 제공하지 않습니다.
          </Alert>
          <Alert title="자동 승인 차단 조건" variant="warn">
            Instagram 이미지 생성에 실패하면 자동 승인을 차단합니다. 금지 표현과 근거 품질은 수동 검토에서 확인합니다.
          </Alert>
        </div>
          </section>

          <section className="panel" style={{ marginTop: 16 }}>
        <div className="panel-head">
          <h2>검증 메시지</h2>
          <Badge variant="info">저장 전 확인</Badge>
        </div>
        <div className="panel-body grid">
          {hasRequiredFields ? (
            <Alert title="필수값 충족" variant="ok">
              브랜드명, 대표 분야, 핵심 고객, 서비스 설명이 입력되어 있습니다.
            </Alert>
          ) : (
            <Alert title="필수값 확인 필요" variant="warn">
              브랜드명, 대표 분야, 핵심 고객, 서비스 설명을 모두 입력하세요.
            </Alert>
          )}
          <Alert title="권장 보강" variant="warn">
            고객 사례 URL을 추가하면 생성 콘텐츠의 근거가 좋아집니다.
          </Alert>
        </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
