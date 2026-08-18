import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ImageGenerationPackageV1 } from "@brand-pilot/content-contracts";
import { compileCardManuscriptPlanDraftV1 } from "@brand-pilot/content-contracts/card-manuscript-plan";
import { cardManuscriptPlanSha256 } from "@brand-pilot/content-contracts/card-manuscript-plan/node";
import { compileReelStoryboardDraftV1 } from "@brand-pilot/content-contracts/reel-storyboard";
import { reelStoryboardSha256 } from "@brand-pilot/content-contracts/reel-storyboard/node";
import { aiContentVisualSessionCompletionSha256, createAiContentRenderJobsRepository, enqueueAiContentRenderJobs, type AiContentRenderedAsset } from "./aiContentRenderJobs.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001", brand: "20000000-0000-4000-8000-000000000001",
  generation: "30000000-0000-4000-8000-000000000001", output: "40000000-0000-4000-8000-000000000001",
  batch: "50000000-0000-4000-8000-000000000001", proposal: "90000000-0000-4000-8000-000000000001",
};
const blobOutputPrefix = `https://assets.public.blob.vercel-storage.com/ai-content/${ids.brand}/${ids.generation}/${ids.output}`;
const blobAssetUrl = (index: number) => `${blobOutputPrefix}/assets/${String(index).padStart(2, "0")}.png`;
const blobManifestUrl = `${blobOutputPrefix}/manifest.json`;
const blobHtmlUrl = `${blobOutputPrefix}/content.html`;
const blobVideoUrl = `${blobOutputPrefix}/reel.mp4`;

function imagePackage(count = 3): ImageGenerationPackageV1 {
  return {
    contractVersion: "image-generation-package.v1" as const, generationId: ids.generation, outputFormat: "card_news" as const, purpose: "informational" as const,
    assetCount: count, aspectRatio: "1:1" as const, channelTargets: ["instagram"] as ["instagram"],
    assets: Array.from({ length: count }, (_, index) => ({ index: index + 1, role: index ? "detail" : "cover", copy: `Copy ${index + 1}`, visualDirection: `Visual ${index + 1}`, evidenceIds: [], productImageAssetIds: [], attachmentIds: [] })),
    product: null, references: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [], userImageInstruction: null,
    logoPolicy: { allowGeneratedLogo: false as const, allowReservedLogoArea: false as const, allowExternalReferenceLogo: false as const, allowExistingProductPackagingLogo: true as const },
  };
}

function finalInput() {
  const now = "2026-07-31T00:00:00.000Z";
  const evidenceId = "70000000-0000-4000-8000-000000000001";
  return {
    contractVersion: "content-generation-input.v3" as const, generationId: ids.generation,
    brandCore: { versionId: "80000000-0000-4000-8000-000000000001", companyOverview: "Company", businessDescription: "Description", primaryCategory: "Food", detailedCategory: "Tea", primaryTarget: "Adults", differentiator: "Direct", coreAppeal: "Calm" },
    brandRules: { versionId: "80000000-0000-4000-8000-000000000002", version: 1, content: { contractVersion: "brand-rules.v1" as const, requiredPhrases: [], forbiddenPhrases: [], exaggerationRules: [], ctaRules: { defaultCta: "", allowed: [] }, channelRules: {}, designRules: { colors: [], fonts: [], notes: [], referenceImages: [] }, autoApprovalRules: { enabled: false, conditions: [] } }, contentSha256: "67b61ecaeab23a876527fa4148e4046c2721084306d79b60bfec4f96956ba84b" },
    subject: { kind: "topic_text" as const, title: "Tea" }, contentInstruction: null, product: null,
    researchEvidence: { contractVersion: "research-evidence.v1" as const, decision: "searched" as const, reason: "Needed", queries: ["tea"], capturedAt: now, items: [{ id: evidenceId, title: "Study", url: "https://source.example/study", publisher: "Source", publishedAt: now, capturedAt: now, claimSummary: "Claim", contentHash: "a".repeat(64) }] },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: {
      id: "90000000-0000-4000-8000-000000000001", conceptKey: "tea-guide", title: "Tea guide", informationalType: "how_to" as const,
      oneLineIntent: "Teach", differentiator: "Simple", differentiationAxes: ["target"] as ["target"], target: "Adults", customerContext: "Choosing tea", keyMessage: "Tea helps", hook: "Try tea", selectionReason: "Useful",
      evidenceIds: [evidenceId], referenceIds: [], outputFormat: "card_news" as const, channelTargets: ["instagram"] as ["instagram"], assetCount: 3,
      outline: [{ index: 1, role: "cover" as const, headline: "Tea", purpose: "Introduce" }, { index: 2, role: "detail" as const, headline: "Choose", purpose: "Teach" }, { index: 3, role: "detail" as const, headline: "Brew", purpose: "Explain" }],
      purposeDetails: { kind: "informational" as const, question: "Which tea?", value: "Clarity", whyNow: "Summer", learningPoints: ["Choose tea"] },
    },
    userImageInstruction: null,
    outputSettings: { outputFormat: "card_news" as const, channelTargets: ["instagram"] as ["instagram"], aspectRatio: "1:1" as const, outputCount: 1 as const, purpose: "informational" as const },
    capturedAt: now,
  };
}

function blogFinalInput() {
  const input = finalInput();
  return {
    ...input,
    selectedProposal: {
      ...input.selectedProposal,
      outputFormat: "blog" as const,
      channelTargets: ["blog_export"] as ["blog_export"],
      assetCount: null,
      outline: [{ index: 1, role: "article" as const, headline: "Tea", purpose: "Explain" }],
    },
    outputSettings: { ...input.outputSettings, outputFormat: "blog" as const, channelTargets: ["blog_export"] as ["blog_export"], aspectRatio: null },
  };
}

function reelFinalInput() {
  const input = finalInput();
  return {
    ...input,
    selectedProposal: {
      ...input.selectedProposal,
      outputFormat: "reel" as const,
      channelTargets: ["instagram"] as ["instagram"],
      assetCount: 2,
      outline: input.selectedProposal.outline.slice(0, 2),
    },
    outputSettings: { ...input.outputSettings, outputFormat: "reel" as const, aspectRatio: "9:16" as const },
  };
}

async function seedManualLineage(db: PGlite): Promise<void> {
  await db.query("insert into ai_content_proposal_batches(id,workspace_id,brand_id,origin) values($1,$2,$3,'manual')", [ids.batch, ids.workspace, ids.brand]);
  await db.query("insert into ai_content_proposals(id,batch_id,workspace_id,brand_id) values($1,$2,$3,$4)", [ids.proposal, ids.batch, ids.workspace, ids.brand]);
  await db.query("insert into ai_content_generation_prompt_bindings(generation_id,workspace_id,brand_id,selected_proposal_id) values($1,$2,$3,$4)", [ids.generation, ids.workspace, ids.brand, ids.proposal]);
}

function blogPlanHtml(
  imageCount = 0,
  evidence: Array<{ id: string; url: string }> = [],
): string {
  const images = Array.from(
    { length: imageCount },
    (_, index) => `<img src="asset://${String(index + 1).padStart(2, "0")}" alt="차 이미지 ${index + 1}">`,
  ).join("");
  const links = evidence.map(({ id, url }) => `<a data-evidence-id="${id}" href="${url}">근거</a>`).join(" ");
  return `<article><h1>Tea</h1><section data-summary="true"><p>한 줄 요약</p><p>두 줄 요약</p><p>세 줄 요약</p></section><section><h2>차를 어떻게 고를까요?</h2><p>${"충분한 본문 ".repeat(700)} ${links}${images}</p></section><section data-references="true"><h2>어떤 자료를 참고했나요?</h2><p>본문에서 실제 사용한 자료입니다.</p><ul>${links}</ul></section></article>`;
}

function finalBlogHtml(imageUrls: string[] = []): string {
  const images = imageUrls.map((url, index) => `<img src="${url}" alt="차 이미지 ${index + 1}">`).join("");
  return `<article><h1>Tea</h1><div><p>한 줄 요약</p><p>두 줄 요약</p><p>세 줄 요약</p></div>${images}<h2>차를 어떻게 고를까요?</h2><p>${"충분한 본문 ".repeat(700)}</p></article>`;
}

describe("AiContentRenderJobsRepository with postgres semantics", () => {
  type CompletedScope = { workspaceId: string; brandId: string; generationId: string; outputId: string };
  let db: PGlite;
  let repository: ReturnType<typeof createAiContentRenderJobsRepository>;
  let completedHook = vi.fn(async (_input: CompletedScope): Promise<void> => undefined);

  beforeEach(async () => {
    db = await PGlite.create({ extensions: { pgcrypto } });
    await db.exec(`
      create table ai_content_generations(id uuid primary key,workspace_id uuid,brand_id uuid,output_format text,purpose text,title text,status text,current_stage text,draft_json jsonb default '{}',analysis_json jsonb default '{}',operation_id uuid,error_code text,error_message text,created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz,attachments_locked_at timestamptz,terminal_at timestamptz,retryable_until timestamptz);
      create table ai_content_generation_outputs(id uuid primary key,generation_id uuid,workspace_id uuid,brand_id uuid,output_index integer default 1,title text,status text,content_json jsonb default '{}',artifact_manifest_json jsonb default '{}',manifest_url text,failure_code text,failure_message text,downloaded_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz,plan_json jsonb);
      create table ai_content_generation_input_snapshots(generation_id uuid,workspace_id uuid,brand_id uuid,input_json jsonb);
      create table ai_content_proposal_batches(id uuid primary key,workspace_id uuid,brand_id uuid,origin text);
      create table ai_content_proposals(id uuid primary key,batch_id uuid,workspace_id uuid,brand_id uuid);
      create table ai_content_generation_prompt_bindings(generation_id uuid primary key,workspace_id uuid,brand_id uuid,selected_proposal_id uuid);
      create table ai_content_output_research_snapshots(output_id uuid unique,generation_id uuid,workspace_id uuid,brand_id uuid,evidence_json jsonb,created_at timestamptz default now());
      create table ai_content_generation_jobs(id uuid primary key,generation_id uuid,output_id uuid,workspace_id uuid,brand_id uuid,job_type text,output_format text,status text,worker_id text,lease_token uuid,lease_expires_at timestamptz,payload_json jsonb default '{}',created_at timestamptz default now());
      create table ai_content_generation_operations(id uuid primary key,generation_id uuid,status text);
      create table ai_content_usage_ledger(id uuid primary key default gen_random_uuid(),workspace_id uuid,brand_id uuid,generation_id uuid,output_id uuid,usage_type text,quantity integer,usage_date date,idempotency_key text,operation_id uuid,reservation_id uuid,reversal_of_ledger_id uuid,unique(brand_id,idempotency_key));
      create table ai_content_generation_render_jobs(id uuid primary key default gen_random_uuid(),generation_id uuid,output_id uuid,workspace_id uuid,brand_id uuid,job_kind text,asset_index integer,status text default 'queued',payload_json jsonb,result_json jsonb,attempt_count integer default 0,max_attempts integer default 3,available_at timestamptz default now(),worker_id text,lease_token uuid,lease_expires_at timestamptz,error_code text,error_message text,created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz);
      create table audit_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,brand_id uuid,actor_user_id uuid,actor_type text not null,event_type text not null,entity_type text not null,entity_id uuid,before_json jsonb,after_json jsonb,metadata jsonb not null default '{}',created_at timestamptz default now(),actor_external_id text);
      create unique index render_asset_unique on ai_content_generation_render_jobs(output_id,asset_index) where job_kind='image_asset';
      create unique index render_finalize_unique on ai_content_generation_render_jobs(output_id) where job_kind='package_finalize';
      create function transition_ai_content_generation_operation(p_operation_id uuid,p_expected_status text,p_next_status text)
      returns text language sql as $$
        update ai_content_generation_operations set status=p_next_status
         where id=p_operation_id and status=p_expected_status returning status
      $$;
    `);
    await db.query("insert into ai_content_generations(id,workspace_id,brand_id,output_format,purpose,title,status,current_stage,retryable_until) values($1,$2,$3,'card_news','informational','Tea','generating','generation',now()+interval '15 days')", [ids.generation, ids.workspace, ids.brand]);
    await db.query("insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,status) values($1,$2,$3,$4,'generating')", [ids.output, ids.generation, ids.workspace, ids.brand]);
    const pool = { query: db.query.bind(db), connect: async () => ({ query: db.query.bind(db), release() {} }) };
    completedHook = vi.fn(async (_input: CompletedScope): Promise<void> => undefined);
    repository = createAiContentRenderJobsRepository(
      pool as never,
      async () => ({ id: ids.generation, status: "generating" } as never),
      completedHook,
    );
  }, 30_000);

  afterEach(async () => db?.close(), 30_000);

  it("claims and completes all Card images as one atomic visual session", async () => {
    await enqueueCardDeck();
    const rendered = await completeVisualSession("card_news");
    expect(rendered.map(({ index }) => index)).toEqual([1, 2, 3]);
    const states = await db.query<{ job_kind: string; status: string }>(
      "select job_kind,status from ai_content_generation_render_jobs order by job_kind,asset_index",
    );
    expect(states.rows.filter(({ job_kind }) => job_kind === "image_asset").map(({ status }) => status))
      .toEqual(["succeeded", "succeeded", "succeeded"]);
    expect(states.rows.filter(({ job_kind }) => job_kind === "package_finalize")).toHaveLength(1);
  });

  it("queues one finalizer immediately for a blog plan without images", async () => {
    await enqueueAiContentRenderJobs(db as never, { workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation, outputId: ids.output, plan: { contractVersion: "blog-plan.v2", content: { title: "Tea", htmlTemplate: "<article><h1>Tea</h1></article>", metaTitle: "Tea", metaDescription: "Guide", usedEvidenceIds: [] }, imagePackage: null }, finalInput: { contractVersion: "content-generation-input.v3" } as never });
    const rows = await db.query<{ job_kind: string; asset_index: number | null; payload_json: Record<string, unknown> }>("select job_kind,asset_index,payload_json from ai_content_generation_render_jobs");
    expect(rows.rows).toEqual([{
      job_kind: "package_finalize",
      asset_index: null,
      payload_json: {
        contractVersion: "ai-content-render-job.v1",
        jobKind: "package_finalize",
        generationId: ids.generation,
        outputId: ids.output,
      },
    }]);
  });

  async function enqueueCardDeck(count = 3) {
    const baseInput = finalInput();
    const input = {
      ...baseInput,
      selectedProposal: {
        ...baseInput.selectedProposal,
        assetCount: count,
        outline: baseInput.selectedProposal.outline.slice(0, count),
      },
    };
    const evidenceId = input.researchEvidence.items[0]!.id;
    const manuscript = {
      contractVersion: "card-manuscript-plan.v1" as const,
      content: { caption: "Tea", hashtags: [] as string[], cta: "Read" },
      deckNarrative: "One coherent editorial card.",
      evidenceSelection: { selectedEvidenceIds: [evidenceId], excludedEvidenceIds: [] },
      scenes: Array.from({ length: count }, (_, offset) => offset + 1).map((index) => ({
        index,
        editorialRole: index === 1 ? "hook" : "detail",
        purpose: `Purpose ${index}`,
        coreMessage: `Core ${index}`,
        headline: `Headline ${index}`,
        informationRelation: { type: "number" as const, entries: [{ role: "value" as const, label: null, value: `${index} steps` }] },
        supportingTexts: [`Support ${index}`],
        footnote: null,
        evidenceIds: [evidenceId],
        productImageAssetIds: [] as string[],
        avatarImageAssetIds: [] as string[],
      })),
    };
    const draft = compileCardManuscriptPlanDraftV1(manuscript, input.selectedProposal.outline);
    const cardPackage = {
      ...imagePackage(count),
      assets: draft.assets.map((asset) => ({ ...asset, attachmentIds: [] as string[] })),
    };
    const plan = {
      contractVersion: "card-news-plan.v2" as const,
      content: manuscript.content,
      imagePackage: cardPackage,
    };
    const cardManuscriptContract = {
      contractVersion: "card-manuscript-plan.v1" as const,
      manuscriptSha256: cardManuscriptPlanSha256(manuscript),
      plan: manuscript,
    };
    await db.query("insert into ai_content_proposal_batches(id,workspace_id,brand_id,origin) values($1,$2,$3,'manual')", [ids.batch, ids.workspace, ids.brand]);
    await db.query("insert into ai_content_proposals(id,batch_id,workspace_id,brand_id) values($1,$2,$3,$4)", [ids.proposal, ids.batch, ids.workspace, ids.brand]);
    await db.query("insert into ai_content_generation_prompt_bindings(generation_id,workspace_id,brand_id,selected_proposal_id) values($1,$2,$3,$4)", [ids.generation, ids.workspace, ids.brand, ids.proposal]);
    await db.query("insert into ai_content_generation_input_snapshots(generation_id,workspace_id,brand_id,input_json) values($1,$2,$3,$4::jsonb)", [ids.generation, ids.workspace, ids.brand, JSON.stringify(input)]);
    await db.query("update ai_content_generation_outputs set plan_json=$2::jsonb where id=$1", [ids.output, JSON.stringify(plan)]);
    await db.query(
      "insert into ai_content_generation_jobs(id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json) values(gen_random_uuid(),$1,$2,$3,$4,'generate','card_news','succeeded',$5::jsonb)",
      [ids.generation, ids.output, ids.workspace, ids.brand, JSON.stringify({ cardManuscriptContract })],
    );
    await enqueueAiContentRenderJobs(db as never, {
      workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation, outputId: ids.output,
      plan, finalInput: input, cardManuscriptContract,
    });
    return { input, plan, cardManuscriptContract };
  }

  async function enqueueSingleRenderFixture() {
    const result = await enqueueCardDeck();
    await db.query("delete from ai_content_generation_render_jobs where job_kind='image_asset' and asset_index > 1");
    await db.query(`update ai_content_generation_render_jobs
      set payload_json=jsonb_set(
        jsonb_set(payload_json - 'visualSessionBinding','{contractVersion}','\"ai-content-render-job.v2\"'::jsonb,true),
        '{rendererPromptVersion}','\"image-final-pixels.v2\"'::jsonb,true
      ) where job_kind='image_asset'`);
    return result;
  }

  async function enqueueReelStoryboard() {
    const input = reelFinalInput();
    const storyboard = {
      contractVersion: "reel-storyboard.v1" as const,
      content: { caption: "Tea Reel", hashtags: [] as string[], cta: "Save" },
      storyNarrative: "A coherent vertical story.",
      visualSystem: {
        paletteDirection: "Green and cream.", typographyDirection: "Bold vertical Korean hierarchy.",
        graphicLanguage: "Flat editorial symbols.", imageryDirection: "Tea-led subject imagery.",
        invariants: ["Keep the visual system stable."],
      },
      scenes: [1, 2].map((index) => ({
        index, editorialRole: index === 1 ? "hook" : "detail", purpose: `Purpose ${index}`,
        coreMessage: `Core ${index}`, headline: `Headline ${index}`,
        keyVisual: { type: "number" as const, entries: [{ role: "value" as const, label: null, value: `${index} steps` }] },
        supportingTexts: [`Support ${index}`], footnote: null,
        visualThesis: `Make ${index} steps dominant.`, layoutArchetype: "stat_focus" as const,
        evidenceIds: [] as string[], productImageAssetIds: [] as string[],
      })),
    };
    const draft = compileReelStoryboardDraftV1(storyboard, input.selectedProposal.outline);
    const reelPackage = {
      ...imagePackage(2), outputFormat: "reel" as const, aspectRatio: "9:16" as const,
      assets: draft.assets.map((asset) => ({ ...asset, attachmentIds: [] as string[] })),
    };
    const plan = { contractVersion: "reel-plan.v2" as const, outputFormat: "reel" as const, content: storyboard.content, imagePackage: reelPackage };
    const reelStoryboardContract = {
      contractVersion: "reel-storyboard.v1" as const,
      storyboardSha256: reelStoryboardSha256(storyboard), storyboard,
    };
    await db.query("update ai_content_generations set output_format='reel' where id=$1", [ids.generation]);
    await db.query("insert into ai_content_proposal_batches(id,workspace_id,brand_id,origin) values($1,$2,$3,'manual')", [ids.batch, ids.workspace, ids.brand]);
    await db.query("insert into ai_content_proposals(id,batch_id,workspace_id,brand_id) values($1,$2,$3,$4)", [ids.proposal, ids.batch, ids.workspace, ids.brand]);
    await db.query("insert into ai_content_generation_prompt_bindings(generation_id,workspace_id,brand_id,selected_proposal_id) values($1,$2,$3,$4)", [ids.generation, ids.workspace, ids.brand, ids.proposal]);
    await db.query("insert into ai_content_generation_input_snapshots(generation_id,workspace_id,brand_id,input_json) values($1,$2,$3,$4::jsonb)", [ids.generation, ids.workspace, ids.brand, JSON.stringify(input)]);
    await db.query("update ai_content_generation_outputs set plan_json=$2::jsonb where id=$1", [ids.output, JSON.stringify(plan)]);
    await db.query(
      "insert into ai_content_generation_jobs(id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json) values(gen_random_uuid(),$1,$2,$3,$4,'generate','reel','succeeded',$5::jsonb)",
      [ids.generation, ids.output, ids.workspace, ids.brand, JSON.stringify({ reelStoryboardContract })],
    );
    await enqueueAiContentRenderJobs(db as never, {
      workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation, outputId: ids.output,
      plan, finalInput: input, reelStoryboardContract,
    });
    return { input, plan, reelStoryboardContract };
  }

  async function completeVisualSession(outputFormat: "card_news" | "reel"): Promise<AiContentRenderedAsset[]> {
    const claim = await repository.claim({
      workerId: "image-worker", leaseSeconds: 180, capabilities: ["ai-content-visual-session.v1"],
    });
    if (!claim || !("kind" in claim)) throw new Error("expected_visual_session");
    const jobs = claim.jobs.map(({ id, assetIndex, leaseToken }) => ({ jobId: id, assetIndex: assetIndex!, leaseToken }));
    const assets = jobs.map(({ assetIndex }) => ({
      index: assetIndex,
      url: blobAssetUrl(assetIndex),
      storagePath: `ai-content/${ids.brand}/${ids.generation}/${ids.output}/assets/${String(assetIndex).padStart(2, "0")}.png`,
      mimeType: "image/png" as const,
      width: 1080,
      height: outputFormat === "reel" ? 1920 : 1080,
      checksum: String(assetIndex).repeat(64),
    }));
    const diagnostics = jobs.map(({ assetIndex }) => ({
      contractVersion: "ai-content-editorial-render-diagnostic.v1" as const,
      sourceContractVersion: claim.visualSession.source.contractVersion,
      sourceSha256: claim.visualSession.source.sha256,
      sceneIndex: assetIndex,
      compiledPromptVersion: "image-visual-session.v1" as const,
      compiledPromptSha256: "a".repeat(64),
      actualToolArgumentsObservation: "not_emitted_by_runner" as const,
      actualToolArgumentsSha256: null,
    }));
    const completion = { outputId: claim.outputId, workerId: "image-worker", jobs, assets, diagnostics };
    await repository.completeVisualSession({
      ...completion,
      bodySha256: aiContentVisualSessionCompletionSha256(completion),
    });
    return assets;
  }

  it("binds supplemental blog research immutably to the current generate lease and output", async () => {
    const jobId = "50000000-0000-4000-8000-000000000001";
    const leaseToken = "60000000-0000-4000-8000-000000000001";
    await db.query(
      "insert into ai_content_generation_jobs(id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,worker_id,lease_token,lease_expires_at) values($1,$2,$3,$4,$5,'generate','blog','processing','blog-worker',$6,now()+interval '3 minutes')",
      [jobId, ids.generation, ids.output, ids.workspace, ids.brand, leaseToken],
    );
    const evidence = {
      contractVersion: "research-evidence.v1", decision: "searched", reason: "Supplement needed",
      queries: ["tea study"], capturedAt: "2026-07-31T00:00:00.000Z",
      items: [{ id: "70000000-0000-4000-8000-000000000001", title: "Study", url: "https://source.example/study", publisher: "Source", publishedAt: null, capturedAt: "2026-07-31T00:00:00.000Z", claimSummary: "Claim", contentHash: "a".repeat(64) }],
    };
    const input = { jobId, outputId: ids.output, workerId: "blog-worker", leaseToken, evidence };
    await repository.saveOutputResearch(input);
    await repository.saveOutputResearch(input);
    await expect(repository.saveOutputResearch({ ...input, evidence: { ...evidence, reason: "Different" } }))
      .rejects.toThrow("ai_content_research_snapshot_conflict");
    await expect(repository.saveOutputResearch({ ...input, leaseToken: "70000000-0000-4000-8000-000000000002" }))
      .rejects.toThrow("ai_content_render_job_lease_invalid");
  });

  it("authenticates terminal render failure replays with the original worker and lease", async () => {
    await enqueueSingleRenderFixture();
    const job = await repository.claim({ workerId: "image-worker", leaseSeconds: 180 });
    const failure = { jobId: job!.id, workerId: "image-worker", leaseToken: job!.leaseToken, errorCode: "render_failed", errorMessage: "failed", retryable: false };
    await repository.fail(failure);

    await expect(repository.fail({ ...failure, workerId: "other-worker" })).rejects.toThrow("ai_content_render_job_lease_invalid");
    await expect(repository.fail({ ...failure, leaseToken: "60000000-0000-4000-8000-000000000099" })).rejects.toThrow("ai_content_render_job_lease_invalid");
    await expect(repository.fail(failure)).resolves.toBeUndefined();
    expect((await db.query<{ count: number }>(
      "select count(*)::integer count from audit_events where entity_id=$1 and event_type='ai_content_render_attempt_failed'",
      [job!.id],
    )).rows[0]?.count).toBe(1);
  });

  it("closes a final lease-exhausted V3 render as failed and reverses its reservation", async () => {
    const operationId = "a0000000-0000-4000-8000-000000000001";
    const reservationId = "b0000000-0000-4000-8000-000000000001";
    await db.query("insert into ai_content_generation_operations(id,generation_id,status) values($1,$2,'started')", [operationId, ids.generation]);
    await db.query("update ai_content_generations set operation_id=$2 where id=$1", [ids.generation, operationId]);
    await db.query(
      `insert into ai_content_usage_ledger(
         id,workspace_id,brand_id,generation_id,output_id,usage_type,quantity,usage_date,
         idempotency_key,operation_id,reservation_id,reversal_of_ledger_id
       ) values($1,$2,$3,$4,null,'generation',1,'2026-08-06','reservation-1',$5,$1,null)`,
      [reservationId, ids.workspace, ids.brand, ids.generation, operationId],
    );
    await enqueueSingleRenderFixture();
    await db.query("update ai_content_generation_render_jobs set max_attempts=1");
    await repository.claim({ workerId: "image-worker", leaseSeconds: 180 });
    await db.query("update ai_content_generation_render_jobs set lease_expires_at=now()-interval '1 second'");

    await expect(repository.claim({ workerId: "image-worker", leaseSeconds: 180 })).resolves.toBeNull();

    expect((await db.query<{ status: string }>("select status from ai_content_generation_render_jobs")).rows[0]?.status).toBe("failed");
    expect((await db.query<{ status: string }>("select status from ai_content_generation_outputs where id=$1", [ids.output])).rows[0]?.status).toBe("failed");
    expect((await db.query<{ status: string }>("select status from ai_content_generations where id=$1", [ids.generation])).rows[0]?.status).toBe("failed");
    expect((await db.query<{ status: string }>("select status from ai_content_generation_operations where id=$1", [operationId])).rows[0]?.status).toBe("reversed");
    expect((await db.query<{ usage_type: string; quantity: number }>("select usage_type,quantity from ai_content_usage_ledger order by quantity desc")).rows)
      .toEqual([{ usage_type: "generation", quantity: 1 }, { usage_type: "reversal", quantity: -1 }]);
  });

  it("rolls back final lease exhaustion when its reservation graph cannot be reversed", async () => {
    const operationId = "a0000000-0000-4000-8000-000000000002";
    await db.query("insert into ai_content_generation_operations(id,generation_id,status) values($1,$2,'started')", [operationId, ids.generation]);
    await db.query("update ai_content_generations set operation_id=$2 where id=$1", [ids.generation, operationId]);
    await enqueueSingleRenderFixture();
    await db.query("update ai_content_generation_render_jobs set max_attempts=1");
    await repository.claim({ workerId: "image-worker", leaseSeconds: 180 });
    await db.query("update ai_content_generation_render_jobs set lease_expires_at=now()-interval '1 second'");

    await expect(repository.claim({ workerId: "image-worker", leaseSeconds: 180 }))
      .rejects.toThrow("ai_content_generation_reservation_missing");

    expect((await db.query<{ status: string }>("select status from ai_content_generation_render_jobs")).rows[0]?.status).toBe("processing");
    expect((await db.query<{ status: string }>("select status from ai_content_generation_outputs where id=$1", [ids.output])).rows[0]?.status).toBe("generating");
    expect((await db.query<{ status: string }>("select status from ai_content_generations where id=$1", [ids.generation])).rows[0]?.status).toBe("generating");
    expect((await db.query<{ status: string }>("select status from ai_content_generation_operations where id=$1", [operationId])).rows[0]?.status).toBe("started");
  });

  it("requires final manifest PNG assets to match each successful render result in asset order", async () => {
    const { plan } = await enqueueCardDeck();
    const rendered = await completeVisualSession("card_news");
    rendered.sort((left, right) => left.index - right.index);
    const finalizer = await repository.claim({ workerId: "finalizer", leaseSeconds: 180 });
    const manifest = {
      version: "ai-content.v3" as const, purpose: "informational" as const, outputFormat: "card_news" as const,
      title: "Tea", assets: rendered.map((asset) => ({ role: "slide" as const, index: asset.index, url: asset.url, fileName: `slide-${asset.index}.png`, mimeType: asset.mimeType, width: asset.width, height: asset.height })),
      content: plan.content,
    };
    const complete = (assets: typeof manifest.assets) => repository.completePackage({ jobId: finalizer!.id, workerId: "finalizer", leaseToken: finalizer!.leaseToken, jobKind: "package_finalize", manifest: { ...manifest, assets }, manifestUrl: blobManifestUrl });

    await expect(complete([{ ...manifest.assets[0], url: rendered[1].url }, { ...manifest.assets[1], url: rendered[0].url }, manifest.assets[2]])).rejects.toThrow("ai_content_render_manifest_invalid");
    await expect(complete([{ ...manifest.assets[0] }, { ...manifest.assets[1], url: rendered[0].url }, manifest.assets[2]])).rejects.toThrow("ai_content_render_manifest_invalid");
    await expect(complete([{ ...manifest.assets[0], width: 2160, height: 2160 }, manifest.assets[1], manifest.assets[2]])).rejects.toThrow("ai_content_render_manifest_invalid");
    completedHook.mockRejectedValue(new Error("calendar preparation unavailable"));
    await expect(complete(manifest.assets)).resolves.toMatchObject({ id: ids.generation });
    expect(completedHook).toHaveBeenCalledWith({
      workspaceId: ids.workspace,
      brandId: ids.brand,
      generationId: ids.generation,
      outputId: ids.output,
    });
    await expect(complete(manifest.assets)).resolves.toMatchObject({ id: ids.generation });
    expect(completedHook).toHaveBeenCalledTimes(2);
    expect((await db.query<{ status: string }>("select status from ai_content_generation_outputs where id=$1", [ids.output])).rows)
      .toEqual([{ status: "completed" }]);
  });

  it("requires every blog evidence link href to equal its frozen original or supplemental URL", async () => {
    const input = blogFinalInput();
    const baseId = input.researchEvidence.items[0].id;
    const supplementalId = "70000000-0000-4000-8000-000000000002";
    const supplemental = {
      contractVersion: "research-evidence.v1", decision: "searched", reason: "Supplement", queries: ["tea facts"], capturedAt: input.capturedAt,
      items: [{ id: supplementalId, title: "Supplement", url: "https://source.example/supplement", publisher: "Source", publishedAt: null, capturedAt: input.capturedAt, claimSummary: "More", contentHash: "b".repeat(64) }],
    };
    const plan = {
      contractVersion: "blog-plan.v2" as const, imagePackage: null,
      content: { title: "Tea", htmlTemplate: blogPlanHtml(0, [input.researchEvidence.items[0], supplemental.items[0]]), metaTitle: "Tea guide", metaDescription: "Tea description", usedEvidenceIds: [baseId, supplementalId] },
    };
    await db.query("update ai_content_generations set output_format='blog' where id=$1", [ids.generation]);
    await db.query("update ai_content_generation_outputs set plan_json=$2::jsonb where id=$1", [ids.output, JSON.stringify(plan)]);
    await db.query("insert into ai_content_generation_input_snapshots values($1,$2,$3,$4::jsonb)", [ids.generation, ids.workspace, ids.brand, JSON.stringify(input)]);
    await db.query("insert into ai_content_output_research_snapshots(output_id,generation_id,workspace_id,brand_id,evidence_json) values($1,$2,$3,$4,$5::jsonb)", [ids.output, ids.generation, ids.workspace, ids.brand, JSON.stringify(supplemental)]);
    await db.query(
      "insert into ai_content_generation_jobs(id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json) values($1,$2,$3,$4,$5,'generate','blog','succeeded',$6::jsonb)",
      ["50000000-0000-4000-8000-000000000002", ids.generation, ids.output, ids.workspace, ids.brand, JSON.stringify({ planningMode: "selected_proposal", usageDate: "2026-07-31", usageIdempotencyKey: "usage-blog" })],
    );
    await enqueueAiContentRenderJobs(db as never, { workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation, outputId: ids.output, plan, finalInput: input });
    const finalizer = await repository.claim({ workerId: "blog-finalizer", leaseSeconds: 180 });
    const link = (id: string, href: string) => `<a data-evidence-id="${id}" href="${href}">근거</a>`;
    const wrongSupplementUrl = "https://attacker.example/substituted";
    const html = `<article><h1>Tea</h1><div><p>한 줄 요약</p><p>두 줄 요약</p><p>세 줄 요약</p></div><h2>차를 어떻게 고를까요?</h2><p>${"충분한 본문 ".repeat(700)} ${link(baseId, input.researchEvidence.items[0].url)} ${link(supplementalId, wrongSupplementUrl)}</p><section id="references">${link(baseId, input.researchEvidence.items[0].url)} ${link(supplementalId, wrongSupplementUrl)}</section></article>`;
    const complete = (finalHtml: string) => repository.completePackage({
      jobId: finalizer!.id, workerId: "blog-finalizer", leaseToken: finalizer!.leaseToken, jobKind: "package_finalize",
      manifest: { version: "ai-content.v3", purpose: "informational", outputFormat: "blog", title: "Tea", assets: [{ role: "html", index: 1, url: blobHtmlUrl, fileName: "article.html", mimeType: "text/html" }], content: { title: "Tea", summary: "Summary", metaTitle: "Tea guide", metaDescription: "Tea description", html: finalHtml } },
      manifestUrl: blobManifestUrl,
    });
    await expect(complete(html)).rejects.toThrow("ai_content_render_manifest_invalid");
    await expect(complete(html.replaceAll(wrongSupplementUrl, supplemental.items[0].url))).resolves.toMatchObject({ id: ids.generation });
  });

  it("accepts exact frozen HTTP evidence at finalization and rejects unsafe or mismatched hrefs", async () => {
    const input = blogFinalInput();
    input.researchEvidence.items[0].url = "http://source.example/study";
    const evidenceId = input.researchEvidence.items[0].id;
    const plan = {
      contractVersion: "blog-plan.v2" as const, imagePackage: null,
      content: { title: "Tea", htmlTemplate: blogPlanHtml(0, [input.researchEvidence.items[0]]), metaTitle: "Tea guide", metaDescription: "Tea description", usedEvidenceIds: [evidenceId] },
    };
    await db.query("update ai_content_generations set output_format='blog' where id=$1", [ids.generation]);
    await db.query("update ai_content_generation_outputs set plan_json=$2::jsonb where id=$1", [ids.output, JSON.stringify(plan)]);
    await db.query("insert into ai_content_generation_input_snapshots values($1,$2,$3,$4::jsonb)", [ids.generation, ids.workspace, ids.brand, JSON.stringify(input)]);
    await db.query(
      "insert into ai_content_generation_jobs(id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json) values($1,$2,$3,$4,$5,'generate','blog','succeeded',$6::jsonb)",
      ["50000000-0000-4000-8000-000000000003", ids.generation, ids.output, ids.workspace, ids.brand, JSON.stringify({ planningMode: "selected_proposal", usageDate: "2026-07-31", usageIdempotencyKey: "usage-blog-http" })],
    );
    await enqueueAiContentRenderJobs(db as never, { workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation, outputId: ids.output, plan, finalInput: input });
    const finalizer = await repository.claim({ workerId: "blog-finalizer", leaseSeconds: 180 });
    const link = `<a data-evidence-id="${evidenceId}" href="${input.researchEvidence.items[0].url}">근거</a>`;
    const html = `<article><h1>Tea</h1><div><p>한 줄 요약</p><p>두 줄 요약</p><p>세 줄 요약</p></div><h2>차를 어떻게 고를까요?</h2><p>${"충분한 본문 ".repeat(700)} ${link}</p><section id="references">${link}</section></article>`;

    const complete = (finalHtml: string) => repository.completePackage({
      jobId: finalizer!.id, workerId: "blog-finalizer", leaseToken: finalizer!.leaseToken, jobKind: "package_finalize",
      manifest: { version: "ai-content.v3", purpose: "informational", outputFormat: "blog", title: "Tea", assets: [{ role: "html", index: 1, url: blobHtmlUrl, fileName: "article.html", mimeType: "text/html" }], content: { title: "Tea", summary: "Summary", metaTitle: "Tea guide", metaDescription: "Tea description", html: finalHtml } },
      manifestUrl: blobManifestUrl,
    });

    for (const invalidHref of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "file:///tmp/source",
      "/source",
      "https://source.example/study",
      "http://attacker.example/study",
    ]) {
      await expect(complete(html.replaceAll(input.researchEvidence.items[0].url, invalidHref)))
        .rejects.toThrow("ai_content_render_manifest_invalid");
    }
    await expect(complete(html)).resolves.toMatchObject({ id: ids.generation });
  });

  it("requires an image-free blog package to have no PNG manifest assets and no final HTML images", async () => {
    const input = blogFinalInput();
    const plan = {
      contractVersion: "blog-plan.v2" as const, imagePackage: null,
      content: { title: "Tea", htmlTemplate: blogPlanHtml(), metaTitle: "Tea guide", metaDescription: "Tea description", usedEvidenceIds: [] },
    };
    await db.query("update ai_content_generations set output_format='blog' where id=$1", [ids.generation]);
    await db.query("update ai_content_generation_outputs set plan_json=$2::jsonb where id=$1", [ids.output, JSON.stringify(plan)]);
    await db.query("insert into ai_content_generation_input_snapshots values($1,$2,$3,$4::jsonb)", [ids.generation, ids.workspace, ids.brand, JSON.stringify(input)]);
    await db.query(
      "insert into ai_content_generation_jobs(id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json) values($1,$2,$3,$4,$5,'generate','blog','succeeded',$6::jsonb)",
      ["50000000-0000-4000-8000-000000000004", ids.generation, ids.output, ids.workspace, ids.brand, JSON.stringify({ planningMode: "selected_proposal", usageDate: "2026-07-31", usageIdempotencyKey: "usage-blog-no-images" })],
    );
    await enqueueAiContentRenderJobs(db as never, { workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation, outputId: ids.output, plan, finalInput: input });
    const finalizer = await repository.claim({ workerId: "blog-finalizer", leaseSeconds: 180 });
    const complete = (html: string, assets: Array<Record<string, unknown>>) => repository.completePackage({
      jobId: finalizer!.id, workerId: "blog-finalizer", leaseToken: finalizer!.leaseToken, jobKind: "package_finalize",
      manifest: { version: "ai-content.v3", purpose: "informational", outputFormat: "blog", title: "Tea", assets: assets as never, content: { title: "Tea", summary: "Summary", metaTitle: "Tea guide", metaDescription: "Tea description", html } },
      manifestUrl: blobManifestUrl,
    });
    const htmlAsset = { role: "html", index: 1, url: blobHtmlUrl, fileName: "article.html", mimeType: "text/html" };
    const rogueImage = { role: "inline", index: 1, url: "https://external.example/rogue.png", fileName: "inline-01.png", mimeType: "image/png", width: 1080, height: 1080 };

    await expect(complete(finalBlogHtml([rogueImage.url]), [htmlAsset, rogueImage]))
      .rejects.toThrow("ai_content_render_manifest_invalid");
    for (const url of [
      `${blobOutputPrefix}/article.html`,
      "https://attacker.example/ai-content/blog/content.html",
      `${blobOutputPrefix}/tmp/../content.html`,
      `${blobOutputPrefix}/tmp/%2e%2e/content.html`,
      `${blobHtmlUrl}?download=1`,
      `${blobHtmlUrl}#worker-result`,
      `https://assets.public.blob.vercel-storage.com:444/ai-content/${ids.brand}/${ids.generation}/${ids.output}/content.html`,
    ]) {
      await expect(complete(finalBlogHtml(), [{ ...htmlAsset, url }]))
        .rejects.toThrow("ai_content_render_manifest_invalid");
    }
    await expect(complete(finalBlogHtml(), [htmlAsset])).resolves.toMatchObject({ id: ids.generation });
  });

  it("binds blog final HTML image src order exactly to successful rendered assets", async () => {
    const input = blogFinalInput();
    const pkg = imagePackage(2);
    pkg.outputFormat = "blog";
    pkg.channelTargets = ["blog_export"];
    const plan = {
      contractVersion: "blog-plan.v2" as const, imagePackage: pkg,
      content: { title: "Tea", htmlTemplate: blogPlanHtml(2), metaTitle: "Tea guide", metaDescription: "Tea description", usedEvidenceIds: [] },
    };
    await db.query("update ai_content_generations set output_format='blog' where id=$1", [ids.generation]);
    await db.query("update ai_content_generation_outputs set plan_json=$2::jsonb where id=$1", [ids.output, JSON.stringify(plan)]);
    await db.query("insert into ai_content_generation_input_snapshots values($1,$2,$3,$4::jsonb)", [ids.generation, ids.workspace, ids.brand, JSON.stringify(input)]);
    await db.query(
      "insert into ai_content_generation_jobs(id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json) values($1,$2,$3,$4,$5,'generate','blog','succeeded',$6::jsonb)",
      ["50000000-0000-4000-8000-000000000005", ids.generation, ids.output, ids.workspace, ids.brand, JSON.stringify({ planningMode: "selected_proposal", usageDate: "2026-07-31", usageIdempotencyKey: "usage-blog-images" })],
    );
    await seedManualLineage(db);
    await enqueueAiContentRenderJobs(db as never, { workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation, outputId: ids.output, plan, finalInput: input });
    const rendered: AiContentRenderedAsset[] = [];
    for (let index = 1; index <= 2; index += 1) {
      const job = await repository.claim({ workerId: "image-worker", leaseSeconds: 180 });
      const assetIndex = job!.assetIndex!;
      const asset = { index: assetIndex, url: blobAssetUrl(assetIndex), storagePath: `ai-content/${ids.brand}/${ids.generation}/${ids.output}/assets/${String(assetIndex).padStart(2, "0")}.png`, mimeType: "image/png" as const, width: 1080, height: 1080, checksum: String(assetIndex).repeat(64) };
      await repository.completeAsset({ jobId: job!.id, workerId: "image-worker", leaseToken: job!.leaseToken, jobKind: "image_asset", asset });
      rendered.push(asset);
    }
    rendered.sort((left, right) => left.index - right.index);
    const finalizer = await repository.claim({ workerId: "blog-finalizer", leaseSeconds: 180 });
    const manifestAssets = [
      { role: "html" as const, index: 1, url: blobHtmlUrl, fileName: "article.html", mimeType: "text/html" as const },
      ...rendered.map((asset) => ({ role: "inline" as const, index: asset.index, url: asset.url, fileName: `inline-0${asset.index}.png`, mimeType: asset.mimeType, width: asset.width, height: asset.height })),
    ];
    const complete = (html: string) => repository.completePackage({
      jobId: finalizer!.id, workerId: "blog-finalizer", leaseToken: finalizer!.leaseToken, jobKind: "package_finalize",
      manifest: { version: "ai-content.v3", purpose: "informational", outputFormat: "blog", title: "Tea", assets: manifestAssets, content: { title: "Tea", summary: "Summary", metaTitle: "Tea guide", metaDescription: "Tea description", html } },
      manifestUrl: blobManifestUrl,
    });

    await expect(complete(finalBlogHtml([rendered[1].url, rendered[0].url])))
      .rejects.toThrow("ai_content_render_manifest_invalid");
    await expect(complete(finalBlogHtml(rendered.map((asset) => asset.url)))).resolves.toMatchObject({ id: ids.generation });
  });

  it("binds the final reel video to its exact deterministic canonical Blob URL", async () => {
    const { plan } = await enqueueReelStoryboard();
    const rendered = await completeVisualSession("reel");
    rendered.sort((left, right) => left.index - right.index);
    const finalizer = await repository.claim({ workerId: "reel-finalizer", leaseSeconds: 180 });
    const video = { role: "video" as const, index: 1, url: blobVideoUrl, fileName: "reel.mp4", mimeType: "video/mp4" as const, width: 1080, height: 1920, durationSeconds: 8, videoCodec: "h264" as const, fps: 30 as const, audioCodec: null };
    const complete = (videoUrl: string) => repository.completePackage({
      jobId: finalizer!.id, workerId: "reel-finalizer", leaseToken: finalizer!.leaseToken, jobKind: "package_finalize",
      manifest: {
        version: "ai-content.v3", purpose: "informational", outputFormat: "reel", title: "Tea",
        assets: [
          ...rendered.map((asset) => ({ role: "scene" as const, index: asset.index, url: asset.url, fileName: `scene-0${asset.index}.png`, mimeType: asset.mimeType, width: asset.width, height: asset.height })),
          { ...video, url: videoUrl },
        ],
        content: plan.content,
      },
      manifestUrl: blobManifestUrl,
    });

    for (const url of [
      `${blobOutputPrefix}/video.mp4`,
      "https://attacker.example/ai-content/reel/reel.mp4",
      `${blobOutputPrefix}/tmp/../reel.mp4`,
      `${blobOutputPrefix}/tmp/%2e%2e/reel.mp4`,
      `${blobVideoUrl}?download=1`,
      `${blobVideoUrl}#worker-result`,
      `https://assets.public.blob.vercel-storage.com:444/ai-content/${ids.brand}/${ids.generation}/${ids.output}/reel.mp4`,
    ]) {
      await expect(complete(url)).rejects.toThrow("ai_content_render_manifest_invalid");
    }
    await expect(complete(blobVideoUrl)).resolves.toMatchObject({ id: ids.generation });
  });

  it.each([
    ["img srcset", (url: string) => finalBlogHtml([url]).replace(`<img src="${url}"`, `<img src="${url}" srcset="https://attacker.example/alternate.png 2x"`)],
    ["expected img onerror", (url: string) => finalBlogHtml([url]).replace(`<img src="${url}"`, `<img src="${url}" onerror="alert(1)"`)],
    ["picture source srcset", (url: string) => finalBlogHtml([url]).replace("</div>", '</div><picture><source srcset="https://attacker.example/picture.png 2x"></picture>')],
    ["SVG image href", (url: string) => finalBlogHtml([url]).replace("</div>", '</div><svg><image href="https://attacker.example/vector.png"></image></svg>')],
    ["SVG image xlink:href", (url: string) => finalBlogHtml([url]).replace("</div>", '</div><svg><image xlink:href="https://attacker.example/vector-xlink.png"></image></svg>')],
    ["meta refresh", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><meta http-equiv="refresh" content="0;url=https://attacker.example/redirect">')],
    ["base", (url: string) => finalBlogHtml([url]).replace("<article>", "<article><base>")],
    ["anchor ping", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><a href="https://attacker.example/click" ping="https://attacker.example/beacon">링크</a>')],
    ["anchor javascript URL", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><a href="javascript:alert(1)">링크</a>')],
    ["formaction", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><button formaction="https://attacker.example/submit">전송</button>')],
    ["action", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><div action="https://attacker.example/submit">전송</div>')],
    ["srcdoc", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><div srcdoc="&lt;script&gt;alert(1)&lt;/script&gt;">내용</div>')],
    ["manifest", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><div manifest="https://attacker.example/app.webmanifest">내용</div>')],
    ["inline style url", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><div style="background-image: url(https://attacker.example/background.png)">배경</div>')],
    ["CSS-escaped inline style url", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><div style="background-image: u\\72l(https://attacker.example/escaped.png)">배경</div>')],
    ["ordinary inline style", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><div style="color: red">본문</div>')],
    ["style block url", (url: string) => finalBlogHtml([url]).replace("<article>", '<article><style>.hero { background-image: url(https://attacker.example/style.png); }</style>')],
  ])("rejects blog image URL bypass through %s", async (_name, maliciousHtml) => {
    const input = blogFinalInput();
    const pkg = imagePackage(1);
    pkg.outputFormat = "blog";
    pkg.channelTargets = ["blog_export"];
    const plan = {
      contractVersion: "blog-plan.v2" as const, imagePackage: pkg,
      content: { title: "Tea", htmlTemplate: blogPlanHtml(1), metaTitle: "Tea guide", metaDescription: "Tea description", usedEvidenceIds: [] },
    };
    await db.query("update ai_content_generations set output_format='blog' where id=$1", [ids.generation]);
    await db.query("update ai_content_generation_outputs set plan_json=$2::jsonb where id=$1", [ids.output, JSON.stringify(plan)]);
    await db.query("insert into ai_content_generation_input_snapshots values($1,$2,$3,$4::jsonb)", [ids.generation, ids.workspace, ids.brand, JSON.stringify(input)]);
    await db.query(
      "insert into ai_content_generation_jobs(id,generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json) values($1,$2,$3,$4,$5,'generate','blog','succeeded',$6::jsonb)",
      ["50000000-0000-4000-8000-000000000006", ids.generation, ids.output, ids.workspace, ids.brand, JSON.stringify({ planningMode: "selected_proposal", usageDate: "2026-07-31", usageIdempotencyKey: "usage-blog-url-bypass" })],
    );
    await seedManualLineage(db);
    await enqueueAiContentRenderJobs(db as never, { workspaceId: ids.workspace, brandId: ids.brand, generationId: ids.generation, outputId: ids.output, plan, finalInput: input });
    const imageJob = await repository.claim({ workerId: "image-worker", leaseSeconds: 180 });
    const rendered = {
      index: 1, url: blobAssetUrl(1),
      storagePath: `ai-content/${ids.brand}/${ids.generation}/${ids.output}/assets/01.png`,
      mimeType: "image/png" as const, width: 1080, height: 1080, checksum: "a".repeat(64),
    };
    await repository.completeAsset({ jobId: imageJob!.id, workerId: "image-worker", leaseToken: imageJob!.leaseToken, jobKind: "image_asset", asset: rendered });
    const finalizer = await repository.claim({ workerId: "blog-finalizer", leaseSeconds: 180 });

    await expect(repository.completePackage({
      jobId: finalizer!.id, workerId: "blog-finalizer", leaseToken: finalizer!.leaseToken, jobKind: "package_finalize",
      manifest: {
        version: "ai-content.v3", purpose: "informational", outputFormat: "blog", title: "Tea",
        assets: [
          { role: "html", index: 1, url: blobHtmlUrl, fileName: "article.html", mimeType: "text/html" },
          { role: "inline", index: 1, url: rendered.url, fileName: "inline-01.png", mimeType: "image/png", width: 1080, height: 1080 },
        ],
        content: { title: "Tea", summary: "Summary", metaTitle: "Tea guide", metaDescription: "Tea description", html: maliciousHtml(rendered.url) },
      },
      manifestUrl: blobManifestUrl,
    })).rejects.toThrow("ai_content_render_manifest_invalid");
  });
});
