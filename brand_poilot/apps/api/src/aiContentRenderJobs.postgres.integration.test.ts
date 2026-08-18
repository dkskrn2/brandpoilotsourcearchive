import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { Pool } from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ImageGenerationPackageV1 } from "@brand-pilot/content-contracts";
import { compileCardManuscriptPlanDraftV1 } from "@brand-pilot/content-contracts/card-manuscript-plan";
import { cardManuscriptPlanSha256 } from "@brand-pilot/content-contracts/card-manuscript-plan/node";
import {
  createAiContentRenderJobsRepository,
  enqueueAiContentRenderJobs,
} from "./aiContentRenderJobs.js";

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  brand: "20000000-0000-4000-8000-000000000001",
  generation: "30000000-0000-4000-8000-000000000001",
  output: "40000000-0000-4000-8000-000000000001",
  batch: "50000000-0000-4000-8000-000000000001",
  proposal: "60000000-0000-4000-8000-000000000001",
  evidence: "70000000-0000-4000-8000-000000000001",
};

function generationInput() {
  const capturedAt = "2026-08-18T00:00:00.000Z";
  const outline = Array.from({ length: 5 }, (_, offset) => ({
    index: offset + 1,
    role: offset === 0 ? "cover" as const : "detail" as const,
    headline: `Outline ${offset + 1}`,
    purpose: `Purpose ${offset + 1}`,
  }));
  return {
    contractVersion: "content-generation-input.v3" as const,
    generationId: ids.generation,
    brandCore: {
      versionId: "80000000-0000-4000-8000-000000000001",
      companyOverview: "Company",
      businessDescription: "Description",
      primaryCategory: "Education",
      detailedCategory: "Creator education",
      primaryTarget: "Creators",
      differentiator: "Evidence-led",
      coreAppeal: "Clarity",
    },
    brandRules: {
      versionId: "80000000-0000-4000-8000-000000000002",
      version: 1,
      content: {
        contractVersion: "brand-rules.v1" as const,
        requiredPhrases: [],
        forbiddenPhrases: [],
        exaggerationRules: [],
        ctaRules: { defaultCta: "", allowed: [] },
        channelRules: {},
        designRules: { colors: [], fonts: [], notes: [], referenceImages: [] },
        autoApprovalRules: { enabled: false, conditions: [] },
      },
      contentSha256: "67b61ecaeab23a876527fa4148e4046c2721084306d79b60bfec4f96956ba84b",
    },
    subject: { kind: "topic_text" as const, title: "Creator policy" },
    contentInstruction: null,
    product: null,
    researchEvidence: {
      contractVersion: "research-evidence.v1" as const,
      decision: "searched" as const,
      reason: "Current facts required",
      queries: ["creator policy"],
      capturedAt,
      items: [{
        id: ids.evidence,
        title: "Policy",
        url: "https://source.example/policy",
        publisher: "Source",
        publishedAt: capturedAt,
        capturedAt,
        claimSummary: "The policy changed.",
        contentHash: "b".repeat(64),
      }],
    },
    references: { selected: [], brandStyleImages: [], avatarStyleImageId: null, attachments: [] },
    selectedProposal: {
      id: ids.proposal,
      conceptKey: "policy-change",
      title: "Policy change",
      informationalType: "trend_insight" as const,
      oneLineIntent: "Explain the change",
      differentiator: "Evidence first",
      differentiationAxes: ["narrative"] as ["narrative"],
      target: "Creators",
      customerContext: "Planning content",
      keyMessage: "Understand the change",
      hook: "What changed?",
      selectionReason: "Timely",
      evidenceIds: [ids.evidence],
      referenceIds: [],
      outputFormat: "card_news" as const,
      channelTargets: ["instagram"] as ["instagram"],
      assetCount: 5,
      outline,
      purposeDetails: {
        kind: "informational" as const,
        question: "What changed?",
        value: "Clarity",
        whyNow: "Current policy",
        learningPoints: ["Understand the change"],
      },
    },
    userImageInstruction: null,
    outputSettings: {
      outputFormat: "card_news" as const,
      channelTargets: ["instagram"] as ["instagram"],
      aspectRatio: "1:1" as const,
      outputCount: 1 as const,
      purpose: "informational" as const,
    },
    capturedAt,
  };
}

function imagePackage(assets: ImageGenerationPackageV1["assets"]): ImageGenerationPackageV1 {
  return {
    contractVersion: "image-generation-package.v1",
    generationId: ids.generation,
    outputFormat: "card_news",
    purpose: "informational",
    assetCount: assets.length,
    aspectRatio: "1:1",
    channelTargets: ["instagram"],
    assets,
    product: null,
    references: [],
    brandStyleImages: [],
    avatarStyleImageId: null,
    attachments: [],
    userImageInstruction: null,
    logoPolicy: {
      allowGeneratedLogo: false,
      allowReservedLogoArea: false,
      allowExternalReferenceLogo: false,
      allowExistingProductPackagingLogo: true,
    },
  };
}

describe.skipIf(process.env.RUN_POSTGRES_INTEGRATION !== "true")(
  "AI content visual-session render leases on PostgreSQL 16",
  () => {
    let container: StartedPostgreSqlContainer | null = null;
    let pool: Pool;

    beforeAll(async () => {
      container = await new PostgreSqlContainer("postgres:16-alpine")
        .withDatabase("brand_pilot_visual_session")
        .withUsername("brand_pilot")
        .withPassword("brand_pilot")
        .start();
      pool = new Pool({ connectionString: container.getConnectionUri(), max: 8 });
      await pool.query("create extension if not exists pgcrypto");
      await pool.query(`
        create table ai_content_generations(id uuid primary key,workspace_id uuid,brand_id uuid,output_format text,purpose text,title text,status text,current_stage text,draft_json jsonb default '{}',analysis_json jsonb default '{}',operation_id uuid,error_code text,error_message text,created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz,attachments_locked_at timestamptz,terminal_at timestamptz,retryable_until timestamptz);
        create table ai_content_generation_outputs(id uuid primary key,generation_id uuid,workspace_id uuid,brand_id uuid,output_index integer default 1,title text,status text,content_json jsonb default '{}',artifact_manifest_json jsonb default '{}',manifest_url text,failure_code text,failure_message text,downloaded_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz,plan_json jsonb);
        create table ai_content_generation_input_snapshots(generation_id uuid,workspace_id uuid,brand_id uuid,input_json jsonb);
        create table ai_content_proposal_batches(id uuid primary key,workspace_id uuid,brand_id uuid,origin text);
        create table ai_content_proposals(id uuid primary key,batch_id uuid,workspace_id uuid,brand_id uuid);
        create table ai_content_generation_prompt_bindings(generation_id uuid primary key,workspace_id uuid,brand_id uuid,selected_proposal_id uuid);
        create table ai_content_output_research_snapshots(output_id uuid unique,generation_id uuid,workspace_id uuid,brand_id uuid,evidence_json jsonb,created_at timestamptz default now());
        create table ai_content_generation_jobs(id uuid primary key default gen_random_uuid(),generation_id uuid,output_id uuid,workspace_id uuid,brand_id uuid,job_type text,output_format text,status text,worker_id text,lease_token uuid,lease_expires_at timestamptz,payload_json jsonb default '{}',created_at timestamptz default now());
        create table ai_content_generation_render_jobs(id uuid primary key default gen_random_uuid(),generation_id uuid,output_id uuid,workspace_id uuid,brand_id uuid,job_kind text,asset_index integer,status text default 'queued',payload_json jsonb,result_json jsonb,attempt_count integer default 0,max_attempts integer default 3,available_at timestamptz default now(),worker_id text,lease_token uuid,lease_expires_at timestamptz,error_code text,error_message text,created_at timestamptz default now(),updated_at timestamptz default now(),completed_at timestamptz);
        create table ai_content_generation_operations(id uuid primary key,generation_id uuid,status text);
        create table ai_content_usage_ledger(id uuid primary key default gen_random_uuid(),workspace_id uuid,brand_id uuid,generation_id uuid,output_id uuid,usage_type text,quantity integer,usage_date date,idempotency_key text,operation_id uuid,reservation_id uuid,reversal_of_ledger_id uuid,unique(brand_id,idempotency_key));
        create table audit_events(id uuid primary key default gen_random_uuid(),workspace_id uuid,brand_id uuid,actor_user_id uuid,actor_type text not null,event_type text not null,entity_type text not null,entity_id uuid,before_json jsonb,after_json jsonb,metadata jsonb not null default '{}',created_at timestamptz default now(),actor_external_id text);
        create unique index render_asset_unique on ai_content_generation_render_jobs(output_id,asset_index) where job_kind='image_asset';
        create unique index render_finalize_unique on ai_content_generation_render_jobs(output_id) where job_kind='package_finalize';
        create function transition_ai_content_generation_operation(p_operation_id uuid,p_expected_status text,p_next_status text)
        returns text language sql as $$
          update ai_content_generation_operations set status=p_next_status
           where id=p_operation_id and status=p_expected_status returning status
        $$;
      `);
    }, 120_000);

    afterAll(async () => {
      await pool?.end();
      await container?.stop();
    }, 120_000);

    beforeEach(async () => {
      await pool.query(`truncate ai_content_generation_render_jobs,ai_content_generation_jobs,
        ai_content_generation_prompt_bindings,ai_content_proposals,ai_content_proposal_batches,
        ai_content_generation_input_snapshots,ai_content_generation_outputs,ai_content_generations,
        ai_content_output_research_snapshots,ai_content_usage_ledger,ai_content_generation_operations,
        audit_events`);
      await seedVisualSession();
    });

    async function seedVisualSession(): Promise<void> {
      const input = generationInput();
      const manuscript = {
        contractVersion: "card-manuscript-plan.v1" as const,
        content: { caption: "Policy", hashtags: [] as string[], cta: "Read" },
        deckNarrative: "Explain the policy with advancing evidence.",
        evidenceSelection: { selectedEvidenceIds: [ids.evidence], excludedEvidenceIds: [] as string[] },
        scenes: Array.from({ length: 5 }, (_, offset) => ({
          index: offset + 1,
          editorialRole: offset === 0 ? "hook" as const : "detail" as const,
          purpose: `Purpose ${offset + 1}`,
          coreMessage: `Core ${offset + 1}`,
          headline: `Headline ${offset + 1}`,
          informationRelation: {
            type: "number" as const,
            entries: [{ role: "value" as const, label: null, value: `${offset + 1}` }],
          },
          supportingTexts: [`Support ${offset + 1}`],
          footnote: null,
          evidenceIds: [ids.evidence],
          productImageAssetIds: [] as string[],
          avatarImageAssetIds: [] as string[],
        })),
      };
      const draft = compileCardManuscriptPlanDraftV1(manuscript, input.selectedProposal.outline);
      const cardPackage = imagePackage(draft.assets.map((asset) => ({ ...asset, attachmentIds: [] })));
      const plan = { contractVersion: "card-news-plan.v2" as const, content: manuscript.content, imagePackage: cardPackage };
      const cardManuscriptContract = {
        contractVersion: "card-manuscript-plan.v1" as const,
        manuscriptSha256: cardManuscriptPlanSha256(manuscript),
        plan: manuscript,
      };

      await pool.query("insert into ai_content_generations(id,workspace_id,brand_id,output_format,purpose,title,status,current_stage,retryable_until) values($1,$2,$3,'card_news','informational','Policy','generating','generation',now()+interval '15 days')", [ids.generation, ids.workspace, ids.brand]);
      await pool.query("insert into ai_content_generation_outputs(id,generation_id,workspace_id,brand_id,status,plan_json) values($1,$2,$3,$4,'generating',$5::jsonb)", [ids.output, ids.generation, ids.workspace, ids.brand, JSON.stringify(plan)]);
      await pool.query("insert into ai_content_proposal_batches(id,workspace_id,brand_id,origin) values($1,$2,$3,'manual')", [ids.batch, ids.workspace, ids.brand]);
      await pool.query("insert into ai_content_proposals(id,batch_id,workspace_id,brand_id) values($1,$2,$3,$4)", [ids.proposal, ids.batch, ids.workspace, ids.brand]);
      await pool.query("insert into ai_content_generation_prompt_bindings(generation_id,workspace_id,brand_id,selected_proposal_id) values($1,$2,$3,$4)", [ids.generation, ids.workspace, ids.brand, ids.proposal]);
      await pool.query("insert into ai_content_generation_input_snapshots(generation_id,workspace_id,brand_id,input_json) values($1,$2,$3,$4::jsonb)", [ids.generation, ids.workspace, ids.brand, JSON.stringify(input)]);
      await pool.query("insert into ai_content_generation_jobs(generation_id,output_id,workspace_id,brand_id,job_type,output_format,status,payload_json) values($1,$2,$3,$4,'generate','card_news','succeeded',$5::jsonb)", [ids.generation, ids.output, ids.workspace, ids.brand, JSON.stringify({ cardManuscriptContract })]);
      await enqueueAiContentRenderJobs(pool as never, {
        workspaceId: ids.workspace,
        brandId: ids.brand,
        generationId: ids.generation,
        outputId: ids.output,
        plan,
        finalInput: input,
        cardManuscriptContract,
      });
    }

    it("grants one output batch to only one of two concurrent workers", async () => {
      const repository = createAiContentRenderJobsRepository(
        pool,
        async () => ({ id: ids.generation, status: "generating" } as never),
      );
      const [left, right] = await Promise.all([
        repository.claim({ workerId: "image-worker-a", leaseSeconds: 180, capabilities: ["ai-content-visual-session.v1"] }),
        repository.claim({ workerId: "image-worker-b", leaseSeconds: 180, capabilities: ["ai-content-visual-session.v1"] }),
      ]);
      const claims = [left, right].filter((value) => value && "kind" in value);
      expect(claims).toHaveLength(1);
      expect(claims[0]).toMatchObject({ kind: "visual_session", outputId: ids.output });
      expect(claims[0] && "kind" in claims[0] ? claims[0].jobs.map((job) => job.assetIndex) : [])
        .toEqual([1, 2, 3, 4, 5]);
      expect([left, right].filter((value) => value === null)).toHaveLength(1);

      const states = await pool.query<{ worker_id: string; attempt_count: number }>(
        "select worker_id,attempt_count from ai_content_generation_render_jobs order by asset_index",
      );
      expect(new Set(states.rows.map(({ worker_id }) => worker_id)).size).toBe(1);
      expect(states.rows.map(({ attempt_count }) => attempt_count)).toEqual([1, 1, 1, 1, 1]);
    });
  },
);
