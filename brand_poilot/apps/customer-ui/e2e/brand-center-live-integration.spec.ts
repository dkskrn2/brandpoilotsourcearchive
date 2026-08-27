import { expect, test, type Page, type Route } from "@playwright/test";

const brandId = "00000000-0000-4000-8000-000000000100";
const referenceId = "11111111-1111-4111-8111-111111111111";
const session = {
  user: { id: "user-1", displayName: "테스트 사용자", email: "user@example.com" },
  workspace: { id: "workspace-1", name: "테스트 워크스페이스" },
  brand: { id: brandId, name: "테스트 브랜드" },
};

const analysisResult = {
  contractVersion: "brand-intelligence-result.v1",
  companyOverview: "기존 기업 개요",
  businessDescription: "기존 사업 소개",
  primaryCategory: { code: "software", name: "소프트웨어" },
  subcategories: [{ code: "brand-ops", name: "브랜드 운영" }],
  primaryTarget: "마케팅 팀",
  differentiators: "승인 기반 운영",
  coreAppeal: "일관된 콘텐츠",
  competitors: [{
    name: "경쟁사 A",
    description: "비교 설명",
    sourceUrls: ["https://competitor.example/evidence"],
  }],
  evidence: [{
    field: "companyOverview",
    claim: "기업 근거",
    sourceId: "owned-url",
    sourceUrl: "https://brand.example/about",
  }],
  sourceGaps: ["가격 정보 부족"],
};

const baseCore = {
  contractVersion: "brand-core.v1",
  summary: { oneLine: "승인된 브랜드 문장", description: "승인된 브랜드 설명" },
  audiences: [{
    name: "브랜드 담당자",
    problem: "운영 시간 부족",
    desiredOutcome: "일관된 콘텐츠",
  }],
  valueProposition: {
    primary: "브랜드 운영 자동화",
    differentiators: ["승인 기반"],
    proofPoints: ["버전 이력"],
  },
  messaging: {
    appeals: ["시간 절약"],
    tone: ["명확함"],
    preferredPhrases: ["근거를 바탕으로"],
    brandDirection: "과장 없는 실무형",
    priorityMessages: ["승인 정보 우선"],
  },
};

const baseRules = {
  contractVersion: "brand-rules.v2",
  requiredPhrases: [],
  forbiddenPhrases: [],
  exaggerationRules: [],
  ctaRules: { defaultCta: "", allowed: [] },
  channelRules: {},
  autoApprovalRules: { enabled: false, conditions: [] },
};

function analysis(status: "queued" | "review_ready" | "confirmed") {
  const ready = status !== "queued";
  return {
    id: "analysis-1",
    brandId,
    status,
    input: { ownedUrl: "https://brand.example", uploadIds: [] },
    result: ready ? analysisResult : null,
    editedResult: null,
    effectiveResult: ready ? analysisResult : null,
    errorCode: null,
    errorMessage: null,
    createdAt: "2026-07-29T00:00:00.000Z",
    updatedAt: "2026-07-29T00:00:00.000Z",
    confirmedAt: status === "confirmed" ? "2026-07-29T00:01:00.000Z" : null,
  };
}

async function json(route: Route, body: unknown, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

function captureRuntimeErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}

async function installFixture(page: Page) {
  let analysisReads = 0;
  let confirmedDraft: typeof analysisResult | null = null;
  let coreVersion = 1;
  let coreActive = {
    id: "core-1",
    sourceAnalysisId: "analysis-1",
    version: coreVersion,
    status: "approved",
    core: structuredClone(baseCore),
    evidence: [],
    reviewState: {},
    approvedAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
  let coreDraft: typeof coreActive | null = null;
  let rules = structuredClone(baseRules);
  const faq = {
    id: "wiki-faq-1",
    workspaceId: "workspace-1",
    brandId,
    itemType: "faq",
    title: "배송은 얼마나 걸리나요?",
    content: "영업일 기준 2~3일입니다.",
    status: "active",
    origin: "manual",
    provenance: {},
    createdByUserId: "user-1",
    approvedByUserId: "user-1",
    approvedAt: "2026-07-26T00:00:00.000Z",
    sourceKind: "faq",
    sourceId: "wiki-faq-1",
    activeVersionId: "wiki-version-1",
    lastBuiltAt: "2026-07-26T00:00:00.000Z",
    buildStatus: "active",
  };
  const policy = {
    ...faq,
    id: "wiki-policy-1",
    itemType: "policy",
    title: "환불 정책",
    content: "이용 시작 전 환불 가능합니다.",
    sourceKind: "policy",
    sourceId: "wiki-policy-1",
  };
  const guide = {
    ...faq,
    id: "wiki-guide-1",
    itemType: "guide",
    title: "시작 가이드",
    content: "계정 연결 후 시작하세요.",
    sourceKind: "guide",
    sourceId: "wiki-guide-1",
  };
  const howTo = {
    ...faq,
    id: "wiki-how-to-1",
    itemType: "how_to",
    title: "계정 연결 방법",
    content: "설정에서 채널 계정을 연결하세요.",
    sourceKind: "guide",
    sourceId: "wiki-how-to-1",
  };
  const wikiItems = [faq, policy, guide, howTo];
  const productVersion = {
    id: "product-version-1",
    workspaceId: "workspace-1",
    brandId,
    productServiceId: "product-1",
    sourceAnalysisId: null,
    version: 1,
    status: "approved",
    profile: {
      contractVersion: "product-service.v1",
      name: "콘텐츠 운영",
      kind: "service",
      description: "승인된 설명",
      features: ["예약"],
      benefits: ["시간 절약"],
      cautions: [],
      audiences: [],
      appealsByTarget: {},
      evergreenPurchaseInfo: "월 구독",
      sourceUrls: ["https://brand.example/product"],
    },
    evidence: [],
    approvedAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  };
  let product = {
    id: "product-1",
    workspaceId: "workspace-1",
    brandId,
    kind: "service",
    displayName: "콘텐츠 운영",
    status: "active",
    activeVersionId: productVersion.id,
    activeVersion: productVersion,
    draft: null as typeof productVersion | null,
  };
  let designStyles = [{
    id: "style-1",
    workspaceId: "workspace-1",
    brandId,
    name: "비교 카드",
    revision: 1,
    analysisStatus: "ready",
    analysisContractVersion: "design-style-analysis.v1",
    analysis: {},
    analysisSha256: "a".repeat(64),
    analysisErrorCode: null,
    referenceItemIds: [referenceId],
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  }];
  const avatars = [{
    id: "avatar-1",
    workspaceId: "workspace-1",
    brandId,
    revision: 1,
    name: "테스트 아바타",
    description: "비교 카드에 사용하는 캐릭터",
    isDefault: false,
    status: "active",
    createdByUserId: "user-1",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    images: [{
      id: "avatar-image-1",
      position: 0,
      representative: true,
      storagePath: "avatar.png",
      storageUrl: "https://assets.example/avatar.png",
      mimeType: "image/png",
      sizeBytes: 68,
      checksum: "b".repeat(64),
    }],
  }];
  let visualPresets = [{
    id: "preset-1",
    workspaceId: "workspace-1",
    brandId,
    name: "기본 비교형",
    designStyleId: "style-1",
    avatarId: "avatar-1",
    revision: 1,
    isDefault: true,
    usability: { usable: true, reason: null },
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  }, {
    id: "preset-2",
    workspaceId: "workspace-1",
    brandId,
    name: "보조 비교형",
    designStyleId: "style-1",
    avatarId: null,
    revision: 1,
    isDefault: false,
    usability: { usable: true, reason: null },
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
  }];

  await page.addInitScript((auth) => {
    const originalFetch = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof Request
            ? input.url
            : String(input),
        window.location.href,
      );
      if (url.pathname.endsWith("/auth/me")) {
        return new Response(JSON.stringify(auth), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return originalFetch(input, init);
    };
  }, session);

  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    if (url.hostname === "assets.example") {
      return route.fulfill({
        status: 200,
        contentType: "image/png",
        body: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    }
    if (url.port !== "4000" && !path.startsWith("/api/")) return route.continue();
    if (path.endsWith("/auth/me")) return json(route, session);
    if (path.endsWith("/ui-status")) return json(route, {
      brandId,
      brandName: "테스트 브랜드",
      logoUrl: null,
      lastGeneratedAt: null,
      navigation: {
        onboardingRemaining: 0,
        contentReview: 0,
        publishIssues: 0,
        channelIssues: 0,
      },
      onboarding: { completedCount: 1, totalCount: 1, remainingCount: 0, steps: [] },
    });
    if (path.endsWith("/ai-content/usage")) return json(route, {
      generationUsed: 0,
      generationLimit: 10,
      newDownloadUsed: 0,
      newDownloadLimit: 20,
      resetsAt: "2026-07-31T00:00:00+09:00",
    });
    if (path.endsWith("/publish-calendar/usage")) return json(route, {
      startsAt: "2026-07-27T00:00:00.000Z",
      endsAt: "2026-08-03T00:00:00.000Z",
      generation: { limit: 10, succeeded: 0, reserved: 0, remaining: 10, additionalAvailable: 0 },
      publishing: { limit: 20, succeeded: 0, reserved: 0, remaining: 20, additionalAvailable: 0 },
    });

    if (path.endsWith("/brand-intelligence/analyses") && request.method() === "POST") {
      return json(route, analysis("queued"), 202);
    }
    if (/\/brand-intelligence\/analyses\/analysis-1$/.test(path) && request.method() === "GET") {
      analysisReads += 1;
      return json(route, analysis(analysisReads < 3 ? "queued" : "review_ready"));
    }
    if (/\/brand-intelligence\/analyses\/analysis-1$/.test(path) && request.method() === "PATCH") {
      confirmedDraft = request.postDataJSON().editedResult;
      return json(route, {
        ...analysis("review_ready"),
        editedResult: confirmedDraft,
        effectiveResult: confirmedDraft,
      });
    }
    if (path.endsWith("/brand-intelligence/analyses/analysis-1/confirm")) {
      return json(route, analysis("confirmed"));
    }

    if (path.endsWith("/brand-center")) return json(route, {
      source: { state: "ready" },
      analysis: { state: "confirmed" },
      brandCore: { state: "approved" },
      rules: { state: "approved" },
      products: { state: "ready" },
      wiki: { state: "ready" },
      avatars: { state: "ready" },
    });
    if (path.endsWith("/brand-core") && request.method() === "GET") {
      return json(route, {
        active: coreActive,
        draft: coreDraft,
        versions: [coreDraft, coreActive].filter(Boolean),
      });
    }
    if (path.endsWith("/brand-core/drafts") && request.method() === "POST") {
      coreVersion += 1;
      coreDraft = {
        ...coreActive,
        id: `core-${coreVersion}`,
        version: coreVersion,
        status: "draft",
        approvedAt: null,
        updatedAt: "2026-07-30T00:00:00.000Z",
        core: structuredClone(coreActive.core),
      };
      return json(route, coreDraft, 201);
    }
    if (/\/brand-core\/drafts\/core-\d+$/.test(path) && request.method() === "PATCH") {
      const body = request.postDataJSON();
      coreDraft = {
        ...coreDraft!,
        core: body.core,
        reviewState: body.reviewState,
        updatedAt: "2026-07-30T00:01:00.000Z",
      };
      return json(route, coreDraft);
    }
    if (path.endsWith("/brand-rules") && request.method() === "GET") return json(route, {
      active: {
        id: "rules-1",
        version: 1,
        status: "approved",
        rules,
        approvedAt: "2026-07-26T00:00:00.000Z",
        updatedAt: "2026-07-26T00:00:00.000Z",
      },
      draft: null,
      versions: [],
    });
    if (path.endsWith("/brand-rules/draft") && request.method() === "PUT") {
      rules = request.postDataJSON();
      return json(route, {
        id: "rules-draft-2",
        version: 2,
        status: "draft",
        rules,
        approvedAt: null,
        updatedAt: "2026-07-30T00:02:00.000Z",
      });
    }

    if (path.endsWith("/wiki/items") && request.method() === "GET") return json(route, wikiItems);
    if (/\/wiki\/items\/[^/]+$/.test(path) && request.method() === "PATCH") {
      const id = path.split("/").at(-1);
      const item = wikiItems.find((candidate) => candidate.id === id)!;
      Object.assign(item, request.postDataJSON());
      return json(route, item);
    }
    if (path.endsWith("/wiki/issues")) return json(route, []);
    if (path.endsWith("/knowledge-imports")) return json(route, []);
    if (path.endsWith("/wiki/status")) return json(route, {
      activeVersion: null,
      currentVersion: null,
      latestFailedVersion: null,
      importStats: { total: 0, succeeded: 0, failed: 0, faqRows: 0, productRows: 0 },
    });

    if (path.endsWith("/product-services") && request.method() === "GET") {
      return json(route, [product]);
    }
    if (path.endsWith("/product-services/product-1/draft") && request.method() === "PATCH") {
      const profile = request.postDataJSON();
      product = {
        ...product,
        displayName: profile.name,
        draft: {
          ...productVersion,
          id: "product-version-2",
          version: 2,
          status: "draft",
          profile,
          approvedAt: null,
          updatedAt: "2026-07-30T00:03:00.000Z",
        },
      };
      return json(route, product);
    }
    if (path.endsWith("/design-styles") && request.method() === "GET") {
      return json(route, designStyles);
    }
    if (path.endsWith("/design-styles/style-1") && request.method() === "PATCH") {
      designStyles = [{
        ...designStyles[0],
        ...request.postDataJSON(),
        revision: designStyles[0].revision + 1,
        updatedAt: "2026-07-30T00:04:00.000Z",
      }];
      return json(route, designStyles[0]);
    }
    if (path.endsWith("/avatars") && request.method() === "GET") {
      return json(route, avatars);
    }
    if (path.endsWith("/visual-presets") && request.method() === "GET") {
      return json(route, visualPresets);
    }
    if (path.endsWith("/visual-presets/preset-2/default") && request.method() === "POST") {
      visualPresets = visualPresets.map((preset) => ({
        ...preset,
        isDefault: preset.id === "preset-2",
        revision: preset.id === "preset-2" ? preset.revision + 1 : preset.revision,
      }));
      return json(route, visualPresets.find(({ id }) => id === "preset-2"));
    }
    if (path.endsWith(`/references/${referenceId}`)) return json(route, {
      id: referenceId,
      workspaceId: "workspace-1",
      brandId,
      kind: "upload",
      contentPurpose: "both",
      origin: "Upload",
      title: "style.png",
      previewUrl: "https://assets.example/style.png",
      sourceUrl: "https://assets.example/style.png",
      format: "image/png",
      metadata: { mimeType: "image/png" },
      favorite: false,
      archivedAt: null,
      referenceBrandId: null,
      description: null,
      body: null,
      snapshot: null,
      createdAt: "2026-07-26T00:00:00.000Z",
      updatedAt: "2026-07-26T00:00:00.000Z",
    });
    return json(route, []);
  });

  return {
    get analysisReads() {
      return analysisReads;
    },
    get confirmedDraft() {
      return confirmedDraft;
    },
  };
}

test("live onboarding bounds progress and confirms the complete edited payload", async ({ page }) => {
  const runtimeErrors = captureRuntimeErrors(page);
  const state = await installFixture(page);
  await page.goto("/onboarding/brand-intelligence");
  await page.getByRole("textbox", { name: "브랜드 웹사이트 URL" })
    .fill("https://brand.example");
  await page.getByRole("button", { name: "AI 분석 시작" }).click();

  await expect(page.getByText(/수분~10분 정도 소요/)).toBeVisible();
  await expect(page.getByLabel("기업 개요")).toHaveValue("기존 기업 개요", { timeout: 15_000 });
  expect(state.analysisReads).toBeLessThanOrEqual(3);
  await page.getByLabel("대표 분야").fill("브랜드 소프트웨어");
  await page.getByLabel("세부 분야").fill("브랜드 운영\n콘텐츠 운영");
  await page.getByRole("button", { name: "완료", exact: true }).click();
  await expect(page.getByText("브랜드 준비가 완료되었습니다")).toBeVisible();

  expect(state.confirmedDraft).toMatchObject({
    primaryCategory: { code: "software", name: "브랜드 소프트웨어" },
    subcategories: [
      { code: "brand-ops", name: "브랜드 운영" },
      { code: null, name: "콘텐츠 운영" },
    ],
    competitors: analysisResult.competitors,
    evidence: analysisResult.evidence,
    sourceGaps: analysisResult.sourceGaps,
  });
  expect(runtimeErrors).toEqual([]);
});

test("five-tab Brand Center preserves save, visual presets, focus, and mobile width", async ({
  page,
}) => {
  const runtimeErrors = captureRuntimeErrors(page);
  await installFixture(page);
  const dialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
  await page.goto("/brand-center?tab=invalid");

  await expect(page).toHaveURL(/tab=core/);
  await expect(page.getByRole("tab")).toHaveText([
    "브랜드 코어",
    "제품·서비스",
    "FAQ",
    "AI 자동응답 지식",
    "스타일",
  ]);

  await page.getByRole("button", { name: "브랜드 코어 수정" }).click();
  await page.getByLabel("기업 개요").fill("취소할 브랜드 문장");
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByLabel("기업 개요")).toHaveValue("승인된 브랜드 문장");
  await page.getByRole("button", { name: "브랜드 코어 수정" }).click();
  await page.getByLabel("기업 개요").fill("저장된 브랜드 문장");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("브랜드 코어를 저장했습니다.")).toBeVisible();

  await page.getByRole("tab", { name: "FAQ" }).click();
  await page.getByRole("button", { name: /배송은 얼마나 걸리나요/ }).click();
  await page.getByRole("button", { name: "수정" }).click();
  await page.getByLabel("내용").fill("취소할 FAQ");
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByLabel("내용")).toHaveValue("영업일 기준 2~3일입니다.");
  await page.getByRole("button", { name: "수정" }).click();
  await page.getByLabel("내용").fill("저장할 FAQ");
  await page.getByRole("tab", { name: "AI 자동응답 지식" }).click();
  expect(dialogs).toEqual(["저장하지 않은 변경이 있습니다. 이동할까요?"]);
  await expect(page.getByRole("tabpanel", { name: "AI 자동응답 지식" })).toBeVisible();

  await page.getByRole("tab", { name: "FAQ" }).click();
  await page.getByRole("button", { name: /배송은 얼마나 걸리나요/ }).click();
  await page.getByRole("button", { name: "수정" }).click();
  await page.getByLabel("내용").fill("저장된 FAQ");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText("FAQ를 저장했습니다.")).toBeVisible();

  await page.getByRole("tab", { name: "제품·서비스" }).click();
  await page.getByRole("button", { name: /콘텐츠 운영/ }).click();
  await page.getByRole("button", { name: "수정" }).click();
  await page.getByLabel("설명").fill("취소할 제품 설명");
  await page.getByRole("button", { name: "취소" }).click();
  await expect(page.getByLabel("설명")).toHaveValue("승인된 설명");
  await page.getByRole("button", { name: "수정" }).click();
  await page.getByLabel("설명").fill("저장된 제품 설명");
  await page.getByRole("button", { name: "저장", exact: true }).click();
  await expect(page.getByText(/보관함에 저장했습니다. 항목 ID: product-1/)).toBeVisible();

  await page.getByRole("tab", { name: "스타일" }).click();
  const designStylePanel = page.getByRole("region", { name: "디자인 스타일" });
  await designStylePanel.getByRole("button", { name: /비교 카드/ }).click();
  await expect(designStylePanel.getByLabel("스타일 이름")).toHaveValue("비교 카드");
  await designStylePanel.getByLabel("스타일 이름").fill("저장된 비교 카드");
  await designStylePanel.getByRole("button", { name: "스타일 저장" }).click();
  await expect(designStylePanel.getByText(/저장된 비교 카드/)).toBeVisible();
  await expect(page.getByRole("img", { name: "테스트 아바타 대표 이미지" }))
    .toHaveAttribute("src", "https://assets.example/avatar.png");
  const presetPanel = page.getByRole("region", { name: "프리셋" });
  await expect(presetPanel.getByText(/기본 비교형/)).toBeVisible();
  await presetPanel.getByRole("button", { name: "기본으로 설정" }).last().click();
  await expect(presetPanel.getByText(/보조 비교형/)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("tab", { name: "스타일" }))
    .toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("저장된 비교 카드")).toBeVisible();
  await expect(page.getByText(/보조 비교형/)).toBeVisible();

  await page.getByRole("tab", { name: "브랜드 코어" }).click();
  await page.getByRole("tab", { name: "브랜드 코어" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.getByRole("tab", { name: "제품·서비스" })).toBeFocused();
  await expect(page.getByRole("tab", { name: "제품·서비스" })).toHaveAttribute("aria-selected", "true");
  await page.setViewportSize({ width: 320, height: 800 });
  expect(await page.evaluate(() =>
    document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  expect(runtimeErrors).toEqual([]);
});
