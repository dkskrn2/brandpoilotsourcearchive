import { describe, expect, it } from "vitest";
import type {
  ContentGenerationInputV3,
  FinalAttachmentV2,
  FrozenReferenceSnapshotV2,
  FrozenStyleImageV2,
  ImageGenerationPackageV1,
} from "./aiContentContracts.js";
import { parseContentPlanResultV2 } from "./aiContentPlanContracts.js";

const id = (tail: number) => `00000000-0000-4000-8000-${String(tail).padStart(12, "0")}`;
const now = "2026-07-31T00:00:00.000Z";
const sha = (letter: string) => letter.repeat(64);

function finalInput(outputFormat: "card_news" | "blog" | "reel" | "marketing_content" = "card_news"): ContentGenerationInputV3 {
  const blog = outputFormat === "blog";
  const marketing = outputFormat === "reel" || outputFormat === "marketing_content";
  const channel = blog ? "blog_export" : "instagram";
  const aspectRatio = blog ? null : outputFormat === "reel" ? "9:16" : "1:1";
  return {
    contractVersion: "content-generation-input.v3",
    generationId: id(1),
    brandCore: {
      versionId: id(2), companyOverview: "Company", businessDescription: "Description",
      primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults",
      differentiator: "Direct", coreAppeal: "Calm",
    },
    subject: { kind: "topic_text", title: "Tea" }, contentInstruction: null, product: null,
    researchEvidence: {
      contractVersion: "research-evidence.v1", decision: "searched", reason: "Needed",
      queries: ["tea"], capturedAt: now,
      items: [{ id: id(3), title: "Study", url: "https://source.example/study", publisher: "Source", publishedAt: now, capturedAt: now, claimSummary: "Claim", contentHash: sha("a") }],
    },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: {
      id: id(4), conceptKey: "tea-guide", title: "Tea guide", informationalType: "how_to",
      oneLineIntent: "Teach", differentiator: "Simple", differentiationAxes: ["target"], target: "Adults",
      customerContext: "Choosing tea", keyMessage: "Tea helps", hook: "Try tea", selectionReason: "Useful",
      evidenceIds: [id(3)], referenceIds: [], outputFormat, channelTargets: [channel],
      assetCount: blog ? null : 2,
      outline: blog
        ? [{ index: 1, role: "article", headline: "Tea", purpose: "Explain" }]
        : [{ index: 1, role: "cover", headline: "Tea", purpose: "Introduce" }, { index: 2, role: "detail", headline: "Choose", purpose: "Teach" }],
      purposeDetails: { kind: "informational", question: "Which tea?", value: "Clarity", whyNow: "Summer", learningPoints: ["Choose tea"] },
    },
    userImageInstruction: null,
    outputSettings: { outputFormat, channelTargets: [channel], aspectRatio, outputCount: 1, purpose: "informational" },
    capturedAt: now,
  };
}

function imagePackage(outputFormat: "card_news" | "blog" | "reel" | "marketing_content" = "card_news", count = 2): ImageGenerationPackageV1 {
  return {
    contractVersion: "image-generation-package.v1", generationId: id(1), outputFormat,
    purpose: "informational", assetCount: count,
    aspectRatio: outputFormat === "reel" ? "9:16" : "1:1",
    channelTargets: [outputFormat === "blog" ? "blog_export" : "instagram"],
    assets: Array.from({ length: count }, (_, index) => ({
      index: index + 1,
      role: outputFormat === "blog" ? "inline" : index === 0 ? "cover" : "detail",
      copy: `Copy ${index + 1}`, visualDirection: `Visual ${index + 1}`,
      evidenceIds: outputFormat === "blog" ? [] : [id(3)],
      productImageAssetIds: [], attachmentIds: [],
    })),
    product: null, references: [], brandStyleImages: [], avatarStyleImageId: null,
    attachments: [], userImageInstruction: null,
    logoPolicy: { allowGeneratedLogo: false, allowReservedLogoArea: false, allowExternalReferenceLogo: false, allowExistingProductPackagingLogo: true },
  };
}

const supplementalResearch = {
  contractVersion: "research-evidence.v1" as const, decision: "searched" as const, reason: "Supplement",
  queries: ["supplement"], capturedAt: "2026-07-31T01:00:00.000Z",
  items: [{ id: id(7), title: "Supplement", url: "https://source.example/supplement", publisher: null, publishedAt: null, capturedAt: "2026-07-31T01:00:00.000Z", claimSummary: "Supplement claim", contentHash: sha("f") }],
};

const blogBody = "충분하고 구체적인 본문 설명입니다. ".repeat(220);

function validBlogHtml({
  assetSources = [],
  evidence = [{ id: id(3), url: "https://source.example/study" }],
}: {
  assetSources?: string[];
  evidence?: Array<{ id: string; url: string }>;
} = {}): string {
  const links = evidence.map((item) => `<a href="${item.url}" data-evidence-id="${item.id}">근거</a>`).join(" ");
  const images = assetSources.map((source, index) => `<img src="${source}" alt="설명 이미지 ${index + 1}">`).join("");
  return `<article><h1>차를 어떻게 고를까요?</h1><section data-summary="true"><p>핵심 기준을 먼저 확인합니다.</p><p>고정 근거와 구조를 연결합니다.</p><p>바로 적용할 방법을 정리합니다.</p></section><section><h2>무엇부터 확인해야 할까요?</h2><p>${blogBody} ${links}${images}</p></section><section data-references="true"><h2>어떤 자료를 참고했나요?</h2><p>본문에서 실제 사용한 자료입니다.</p><ul>${evidence.map((item) => `<li><a href="${item.url}" data-evidence-id="${item.id}">출처</a></li>`).join("")}</ul></section></article>`;
}

function frozenVisualInputs(): {
  reference: FrozenReferenceSnapshotV2;
  style: FrozenStyleImageV2;
  attachment: FinalAttachmentV2;
} {
  const reference: FrozenReferenceSnapshotV2 = {
    referenceItemId: id(10), snapshotId: id(11), roles: ["visual_composition"], title: "Reference",
    sourceUrl: "https://reference.example/item", capturedAt: now, contentHash: sha("b"), text: "Reference text",
    image: { storageUrl: "https://blob.example/reference.png", storagePath: "references/reference.png", mimeType: "image/png", checksum: sha("c") },
  };
  const style: FrozenStyleImageV2 = {
    referenceItemId: id(12), description: "Warm editorial", tags: ["warm"],
    storageUrl: "https://blob.example/style.png", storagePath: "styles/style.png", mimeType: "image/png", checksum: sha("d"),
  };
  const attachment: FinalAttachmentV2 = {
    id: id(13), role: "visual_reference", fileName: "attachment.png", mimeType: "image/png", sizeBytes: 100,
    checksum: sha("e"), storageUrl: "https://blob.example/attachment.png", storagePath: "attachments/attachment.png",
  };
  return { reference, style, attachment };
}

describe("content plan v2 contracts", () => {
  it("rejects image assets that cite evidence outside the frozen final input", () => {
    const input = finalInput();
    const pkg = imagePackage();
    pkg.assets[0]!.evidenceIds = [id(99)];
    expect(() => parseContentPlanResultV2({
      contractVersion: "card-news-plan.v2",
      content: { caption: "Caption", hashtags: [], cta: "Read" },
      imagePackage: pkg,
    }, input)).toThrow("ai_content_plan_invalid");
  });

  it("accepts a visual plan only when generation, format, purpose, count, indexes, roles, and order remain locked", () => {
    const input = finalInput();
    const plan = {
      contractVersion: "card-news-plan.v2",
      content: { caption: "Caption", hashtags: ["#tea"], cta: "Read" },
      imagePackage: imagePackage(),
    };
    expect(parseContentPlanResultV2(plan, input).imagePackage?.assetCount).toBe(2);

    for (const imagePackagePatch of [
      { generationId: id(99) }, { outputFormat: "marketing_content" }, { purpose: "marketing" },
      { assetCount: 1, assets: [imagePackage().assets[0]] },
      { assets: [{ ...imagePackage().assets[0], role: "detail" }, imagePackage().assets[1]] },
      { assets: [{ ...imagePackage().assets[0], index: 2 }, { ...imagePackage().assets[1], index: 1 }] },
    ]) {
      expect(() => parseContentPlanResultV2({ ...plan, imagePackage: { ...imagePackage(), ...imagePackagePatch } }, input))
        .toThrow("ai_content_plan_invalid");
    }
  });

  it("accepts a blog without images only when its HTML has no asset placeholder", () => {
    const input = finalInput("blog");
    const plan = {
      contractVersion: "blog-plan.v2", imagePackage: null,
      content: { title: "Tea", htmlTemplate: validBlogHtml(), metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] },
    };
    expect(parseContentPlanResultV2(plan, input).imagePackage).toBeNull();
    expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, htmlTemplate: `${plan.content.htmlTemplate}<img src="asset://01">` } }, input))
      .toThrow("ai_content_plan_invalid");
  });

  it("requires blog image placeholders to cover exactly every planned asset from 01", () => {
    const input = finalInput("blog");
    const plan = {
      contractVersion: "blog-plan.v2", imagePackage: imagePackage("blog", 2),
      content: { title: "Tea", htmlTemplate: validBlogHtml({ assetSources: ["asset://01", "asset://02"] }), metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] },
    };
    expect(parseContentPlanResultV2(plan, input).imagePackage?.assetCount).toBe(2);
    for (const htmlTemplate of [
      validBlogHtml({ assetSources: ["asset://01"] }),
      validBlogHtml({ assetSources: ["asset://01", "asset://03"] }),
      validBlogHtml({ assetSources: ["asset://00", "asset://01", "asset://02"] }),
    ]) {
      expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, htmlTemplate } }, input))
        .toThrow("ai_content_plan_invalid");
    }
  });

  it("counts only exact asset placeholders used as image src attributes", () => {
    const input = finalInput("blog");
    const plan = {
      contractVersion: "blog-plan.v2", imagePackage: imagePackage("blog", 2),
      content: { title: "Tea", htmlTemplate: validBlogHtml({ assetSources: ["asset://01", "asset://02"] }), metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] },
    };
    for (const htmlTemplate of [
      validBlogHtml({ assetSources: ["asset://01evil", "asset://02"] }),
      validBlogHtml({ assetSources: ["asset://02"] }).replace("</article>", "<p>asset://01</p></article>"),
      validBlogHtml({ assetSources: ["asset://02"] }).replace('<img src="asset://02"', '<img data-src="asset://01"><img src="asset://02"'),
      validBlogHtml({ assetSources: ["asset://01", "https://external.example/02.png"] }),
    ]) {
      expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, htmlTemplate } }, input))
        .toThrow("ai_content_plan_invalid");
    }
  });

  it("requires exact ordered, unique image placeholders and rejects every other raw asset token", () => {
    const input = finalInput("blog");
    const plan = {
      contractVersion: "blog-plan.v2", imagePackage: imagePackage("blog", 2),
      content: { title: "Tea", htmlTemplate: validBlogHtml({ assetSources: ["asset://01", "asset://02"] }), metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] },
    };
    for (const htmlTemplate of [
      validBlogHtml({ assetSources: ["asset://01", "asset://02"] }).replace("</article>", "<p>asset://foo</p></article>"),
      validBlogHtml({ assetSources: ["asset://01", "asset://01", "asset://02"] }),
      validBlogHtml({ assetSources: ["asset://02", "asset://01"] }),
    ]) expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, htmlTemplate } }, input)).toThrow("ai_content_plan_invalid");
  });

  it("allows supplemental blog image evidence only when it is declared in usedEvidenceIds", () => {
    const input = finalInput("blog");
    const pkg = imagePackage("blog", 1); pkg.assets[0]!.evidenceIds = [id(7)];
    const plan = { contractVersion: "blog-plan.v2", imagePackage: pkg, content: { title: "Tea", htmlTemplate: validBlogHtml({ assetSources: ["asset://01"], evidence: [{ id: id(3), url: "https://source.example/study" }, { id: id(7), url: "https://source.example/supplement" }] }), metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3), id(7)] } };
    expect(parseContentPlanResultV2(plan, input, supplementalResearch).imagePackage?.assets[0]?.evidenceIds).toEqual([id(7)]);
    expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, usedEvidenceIds: [id(3)] } }, input, supplementalResearch)).toThrow("ai_content_plan_invalid");
    pkg.assets[0]!.evidenceIds = [id(99)];
    expect(() => parseContentPlanResultV2({ ...plan, imagePackage: pkg }, input, supplementalResearch)).toThrow("ai_content_plan_invalid");
  });

  it("does not extend card or marketing image evidence with a blog supplement", () => {
    const input = finalInput(); const pkg = imagePackage(); pkg.assets[0]!.evidenceIds = [id(7)];
    expect(() => parseContentPlanResultV2({ contractVersion: "card-news-plan.v2", content: { caption: "Caption", hashtags: [], cta: "Read" }, imagePackage: pkg }, input, supplementalResearch)).toThrow("ai_content_plan_invalid");
  });

  it("accepts blog metadata at its authoritative limits and rejects one character over", () => {
    const input = finalInput("blog");
    const plan = { contractVersion: "blog-plan.v2", imagePackage: null, content: { title: "T", htmlTemplate: validBlogHtml(), metaTitle: "M", metaDescription: "D", usedEvidenceIds: [id(3)] } };
    for (const [field, limit] of [["title", 500], ["metaTitle", 500], ["metaDescription", 2_000]] as const) {
      expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, [field]: "가".repeat(limit) } }, input)).not.toThrow();
      expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, [field]: "가".repeat(limit + 1) } }, input)).toThrow("ai_content_plan_invalid");
    }
  });

  it("rejects structurally invalid planner HTML at the API trust boundary", () => {
    const input = finalInput("blog");
    const valid = validBlogHtml();
    const plan = { contractVersion: "blog-plan.v2", imagePackage: null, content: { title: "Tea", htmlTemplate: valid, metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] } };
    expect(parseContentPlanResultV2(plan, input).contractVersion).toBe("blog-plan.v2");
    for (const htmlTemplate of [
      `${valid}${valid}`,
      valid.replace("</h1>", "</h1><h1>중복 제목</h1>"),
      valid.replace('section data-summary="true"', "div"),
      valid.replace("</h1>", "</h1><p>요약 앞 요소</p>"),
      valid.replace("<p>바로 적용할 방법을 정리합니다.</p>", ""),
      valid.replace("<p>핵심 기준을 먼저 확인합니다.</p>", "<p>   </p>"),
      valid.replace("핵심 기준을 먼저 확인합니다.", "가".repeat(301)),
      valid.replace(blogBody, "짧은 본문"),
      valid.replace(blogBody, "매우 긴 본문 ".repeat(1_500)),
      valid.replace("무엇부터 확인해야 할까요?", "확인 기준"),
      valid.replace(`<h2>무엇부터 확인해야 할까요?</h2><p>`, `<h2>무엇부터 확인해야 할까요?</h2><ul><li>답</li></ul><p>`),
      valid.replace(blogBody, `제가 직접 사용해 보니 ${blogBody}`),
      valid.replace(blogBody, `실제 고객의 경험을 재구성 ${blogBody}`),
      valid.replace(blogBody, `가상의 경험담 ${blogBody}`),
      valid.replace(blogBody, `합성된 경험 ${blogBody}`),
    ]) expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, htmlTemplate } }, input)).toThrow("ai_content_plan_invalid");
  });

  it("rejects active, styled, or external-resource HTML bypasses before plan storage", () => {
    const input = finalInput("blog"); const valid = validBlogHtml();
    const plan = { contractVersion: "blog-plan.v2", imagePackage: null, content: { title: "Tea", htmlTemplate: valid, metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] } };
    const injections = [
      "<script>alert(1)</script>", "<style>p{color:red}</style>", '<div style="color:red">x</div>', '<div onclick="x()">x</div>',
      "<form></form>", "<iframe></iframe>", '<link href="https://attacker.example/x.css">', '<source srcset="https://attacker.example/x.png">',
      '<svg><image href="https://attacker.example/x.png"></image></svg>', "<noscript>x</noscript>", '<object data="https://attacker.example/x"></object>',
      '<embed src="https://attacker.example/x">', '<video poster="https://attacker.example/x"></video>', '<audio src="https://attacker.example/x"></audio>',
      '<img src="https://attacker.example/x.png">', '<img srcset="https://attacker.example/x.png 2x">', '<div xlink:href="https://attacker.example/x">x</div>',
      '<div background="https://attacker.example/x">x</div>', '<div data="https://attacker.example/x">x</div>', '<a href="javascript:alert(1)">x</a>',
    ];
    for (const injection of injections) {
      const htmlTemplate = valid.replace("<article>", `<article>${injection}`);
      expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, htmlTemplate } }, input)).toThrow("ai_content_plan_invalid");
    }
  });

  it.each([
    ["meta refresh", '<meta http-equiv="refresh" content="0;url=https://attacker.example/redirect">'],
    ["base", "<base>"],
  ])("rejects passive navigation tag %s before plan storage", (_name, injection) => {
    const input = finalInput("blog"); const valid = validBlogHtml();
    const plan = { contractVersion: "blog-plan.v2", imagePackage: null, content: { title: "Tea", htmlTemplate: valid.replace("<article>", `<article>${injection}`), metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] } };
    expect(() => parseContentPlanResultV2(plan, input)).toThrow("ai_content_plan_invalid");
  });

  it.each([
    ["ping", `<a href="https://source.example/study" data-evidence-id="${id(3)}" ping="https://attacker.example/beacon">근거</a>`],
    ["formaction", '<button formaction="https://attacker.example/submit">전송</button>'],
    ["action", '<div action="https://attacker.example/submit">전송</div>'],
    ["srcdoc", '<div srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">내용</div>'],
    ["manifest", '<div manifest="https://attacker.example/app.webmanifest">내용</div>'],
  ])("rejects passive navigation or beacon attribute %s before plan storage", (_name, injection) => {
    const input = finalInput("blog"); const valid = validBlogHtml();
    const htmlTemplate = _name === "ping"
      ? valid.replace(`<a href="https://source.example/study" data-evidence-id="${id(3)}">근거</a>`, injection)
      : valid.replace("<article>", `<article>${injection}`);
    const plan = { contractVersion: "blog-plan.v2", imagePackage: null, content: { title: "Tea", htmlTemplate, metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] } };
    expect(() => parseContentPlanResultV2(plan, input)).toThrow("ai_content_plan_invalid");
  });

  it("requires frozen HTTPS evidence in body and exactly one matching references section", () => {
    const input = finalInput("blog"); const valid = validBlogHtml();
    const plan = { contractVersion: "blog-plan.v2", imagePackage: null, content: { title: "Tea", htmlTemplate: valid, metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [id(3)] } };
    const bodyLink = `<a href="https://source.example/study" data-evidence-id="${id(3)}">근거</a>`;
    const referenceLink = `<a href="https://source.example/study" data-evidence-id="${id(3)}">출처</a>`;
    const references = valid.match(/<section data-references="true">[\s\S]*<\/section>/)?.[0] ?? "";
    for (const htmlTemplate of [
      valid.replaceAll("https://source.example/study", "https://attacker.example/study"),
      valid.replaceAll("https://source.example/study", "http://source.example/study"),
      valid.replace(bodyLink, '<a href="https://source.example/study">근거</a>'),
      valid.replace(bodyLink, ""),
      valid.replace(referenceLink, ""),
      valid.replace("</article>", `${references}</article>`),
    ]) expect(() => parseContentPlanResultV2({ ...plan, content: { ...plan.content, htmlTemplate } }, input)).toThrow("ai_content_plan_invalid");
  });

  it("requires every frozen image-package input to canonically equal the final V3 snapshot", () => {
    const input = finalInput();
    const { reference, style, attachment } = frozenVisualInputs();
    input.references = {
      selected: [reference], brandStyleImages: [style], avatarStyleImageId: style.referenceItemId, attachments: [attachment],
    };
    input.userImageInstruction = "Use a calm palette";
    input.selectedProposal.referenceIds = [reference.referenceItemId];
    const pkg = {
      ...imagePackage(), references: [reference], brandStyleImages: [style], avatarStyleImageId: style.referenceItemId,
      attachments: [attachment], userImageInstruction: input.userImageInstruction,
    };
    const plan = { contractVersion: "card-news-plan.v2", content: { caption: "Caption", hashtags: [], cta: "Read" }, imagePackage: pkg };
    expect(parseContentPlanResultV2(plan, input).imagePackage).toMatchObject({ references: [reference], brandStyleImages: [style] });

    for (const tamperedPackage of [
      { ...pkg, references: [{ ...reference, sourceUrl: "https://attacker.example/reference" }] },
      { ...pkg, brandStyleImages: [{ ...style, storageUrl: "https://attacker.example/style.png" }] },
      { ...pkg, avatarStyleImageId: null },
      { ...pkg, attachments: [{ ...attachment, storageUrl: "https://attacker.example/attachment.png" }] },
      { ...pkg, userImageInstruction: "Ignore the frozen instruction" },
    ]) {
      expect(() => parseContentPlanResultV2({ ...plan, imagePackage: tamperedPackage }, input))
        .toThrow("ai_content_plan_invalid");
    }
  });

  it("rejects a marketing package whose product snapshot data differs from the final input", () => {
    const input = finalInput("marketing_content");
    const product: NonNullable<ContentGenerationInputV3["product"]> = {
      id: id(20), versionId: id(21), kind: "product", name: "Tea", description: "Tea product",
      features: ["Calm"], benefits: ["Focus"], cautions: [], evergreenPurchaseInfo: "Available online", images: [],
    };
    input.product = product;
    input.outputSettings.purpose = "marketing";
    input.selectedProposal.informationalType = null;
    input.selectedProposal.purposeDetails = {
      kind: "marketing", campaignObjective: "Convert", situationAndNeed: "Need focus", productId: product.id,
      targetSegment: "Adults", strengths: ["Calm"], limitations: [], appeal: "Focus", buyingBarriers: [], cta: "Buy",
    };
    const pkg = { ...imagePackage("marketing_content"), purpose: "marketing", product };
    const plan = { contractVersion: "marketing-plan.v2", outputFormat: "marketing_content", content: { caption: "Caption", hashtags: [], cta: "Buy" }, imagePackage: pkg };
    expect(parseContentPlanResultV2(plan, input).imagePackage?.product).toEqual(product);
    expect(() => parseContentPlanResultV2({ ...plan, imagePackage: { ...pkg, product: { ...product, name: "Tampered" } } }, input))
      .toThrow("ai_content_plan_invalid");
  });

  it("rejects any non-literal no-logo policy", () => {
    const input = finalInput();
    const plan = { contractVersion: "card-news-plan.v2", content: { caption: "Caption", hashtags: [], cta: "Read" }, imagePackage: imagePackage() };
    expect(() => parseContentPlanResultV2({ ...plan, imagePackage: { ...imagePackage(), logoPolicy: { ...imagePackage().logoPolicy, allowGeneratedLogo: true } } }, input))
      .toThrow("ai_content_plan_invalid");
  });

  it("parses marketing-plan.v2 for reel or marketing content without coupling it to purpose", () => {
    const input = finalInput("marketing_content");
    const plan = {
      contractVersion: "marketing-plan.v2", outputFormat: "marketing_content",
      content: { caption: "Caption", hashtags: ["#tea"], cta: "Learn" },
      imagePackage: imagePackage("marketing_content"),
    };
    expect(parseContentPlanResultV2(plan, input)).toMatchObject({
      contractVersion: "marketing-plan.v2", outputFormat: "marketing_content",
    });
    expect(() => parseContentPlanResultV2({ ...plan, outputFormat: "reel" }, input))
      .toThrow("ai_content_plan_invalid");
  });
});
