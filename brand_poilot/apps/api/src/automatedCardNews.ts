import { parseContentGenerationInputV2, type ContentGenerationInputV2 } from "./aiContentGenerationInput.js";
import { randomUUID } from "node:crypto";

type Queryable = {
  query(sql: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
};

export interface AutomatedCardNewsInput {
  contentTopicId: string;
  brand: {
    name: string;
    categoryContext?: string | null;
    primaryCustomer?: string | null;
    description?: string | null;
    tone?: string | null;
    brandColor?: string | null;
    intelligence?: { versionId: string; profile: Record<string, unknown> } | null;
  };
  topic: {
    title: string;
    angle: string;
    targetCustomer?: string | null;
    region?: string | null;
    season?: string | null;
    notes?: string | null;
  };
  representativeUrl: string | null;
  sourceMaterials: Array<{
    sourceType: string;
    contentUrl: string;
    content: string;
  }>;
}

export interface EnqueueAutomatedCardNewsInput extends AutomatedCardNewsInput {
  workspaceId: string;
  brandId: string;
  channelOutputId: string;
}

function compact(value: string | null | undefined, maxLength = 6_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function buildAutomatedCardNewsInput(input: AutomatedCardNewsInput): ContentGenerationInputV2 {
  const sourceUrl = compact(input.representativeUrl)
    || compact(input.sourceMaterials[0]?.contentUrl)
    || `urn:brand-pilot:topic:${input.contentTopicId}`;
  const targetName = compact(input.topic.targetCustomer)
    || compact(input.brand.primaryCustomer)
    || "브랜드 고객";
  const targetId = `scheduled-target-${input.contentTopicId}`;
  const appealId = `scheduled-appeal-${input.contentTopicId}`;
  const appealTitle = compact(input.topic.angle) || compact(input.topic.title) || "핵심 정보";
  const selectedColor = compact(input.brand.brandColor) || "#2563eb";
  const pages = input.sourceMaterials.map((source, index) => ({
    type: source.sourceType,
    title: `콘텐츠 근거 ${index + 1}`,
    summary: compact(source.content, 500),
    content: compact(source.content),
    url: compact(source.contentUrl),
    structuredData: {},
  }));
  const facts = input.sourceMaterials.map((source, index) => ({
    key: `source_evidence_${index + 1}`,
    value: compact(source.content),
    sourceUrl: compact(source.contentUrl),
    sourceType: source.sourceType,
  }));
  if (!facts.length) {
    facts.push({
      key: "topic_brief",
      value: [input.topic.title, input.topic.angle, compact(input.topic.notes)].filter(Boolean).join(" - "),
      sourceUrl,
      sourceType: "topic",
    });
  }

  return parseContentGenerationInputV2({
    contractVersion: "content-generation-input.v2",
    contentType: "card_news",
    brandContext: {
      ready: pages.length > 0,
      brandName: input.brand.name,
      ownedUrl: input.sourceMaterials.find((source) => source.sourceType === "owned")?.contentUrl ?? null,
      sourceStatus: pages.length ? "crawled" : null,
      lastCrawledAt: null,
      wikiVersionId: null,
      wikiUpdatedAt: null,
      summary: compact(input.brand.description) || null,
      pageCount: pages.length,
      context: {
        brand: {
          name: input.brand.name,
          categoryContext: compact(input.brand.categoryContext),
          primaryCustomer: compact(input.brand.primaryCustomer),
          description: compact(input.brand.description),
          tone: compact(input.brand.tone),
          brandColor: compact(input.brand.brandColor),
        },
        brandIntelligence: input.brand.intelligence ?? null,
        wiki: { versionId: null, pages },
      },
    },
    subject: {
      analysisId: `scheduled-analysis-${input.contentTopicId}`,
      analysisVersion: 1,
      type: "service",
      sourceUrl,
      facts,
      research: {
        topic: {
          title: input.topic.title,
          angle: input.topic.angle,
          region: compact(input.topic.region),
          season: compact(input.topic.season),
          notes: compact(input.topic.notes),
        },
      },
      selectedImages: [],
    },
    message: {
      target: {
        id: targetId,
        name: targetName,
        description: compact(input.topic.notes) || compact(input.brand.description),
      },
      appeal: {
        id: appealId,
        targetId,
        title: appealTitle,
        description: `${input.topic.title}: ${appealTitle}`,
      },
      qualityBrief: { sourceGaps: [] },
    },
    creativeDirection: {
      prompts: [
        `주제: ${input.topic.title}\n관점: ${input.topic.angle}\n제공된 URL과 근거를 확인해 사용자에게 도움이 되고 저장하거나 공유할 가치가 있는 카드뉴스를 작성하세요. 원본 내용을 구체적으로 반영하세요.`,
      ],
      brandColor: compact(input.brand.brandColor),
      selectedColor,
      aspectRatio: "1:1",
      outputCount: 1,
    },
    references: [],
    attachments: [],
  });
}

export async function enqueueAutomatedCardNews(
  client: Queryable,
  input: EnqueueAutomatedCardNewsInput,
) {
  const generationId = randomUUID();
  const outputId = randomUUID();
  const jobId = randomUUID();
  const contract = buildAutomatedCardNewsInput(input);
  const idempotencyKey = `scheduled:${input.channelOutputId}`;

  await client.query(
    `insert into ai_content_generations (
       id, workspace_id, brand_id, type, title, status, current_stage,
       draft_json, analysis_json, analysis_idempotency_key,
       generation_idempotency_key, subject_analysis_snapshot
     )
     values ($1, $2, $3, 'card_news', $4, 'analyzing', 'analysis', $5, '{}'::jsonb, $6, $6, $7)`,
    [
      generationId,
      input.workspaceId,
      input.brandId,
      input.topic.title,
      JSON.stringify({
        origin: "scheduled_automation",
        contentTopicId: input.contentTopicId,
        channelOutputId: input.channelOutputId,
        brief: { aspectRatio: "1:1", outputCount: 1 },
      }),
      idempotencyKey,
      JSON.stringify(contract),
    ],
  );
  await client.query(
    `insert into ai_content_generation_outputs (
       id, generation_id, workspace_id, brand_id, output_index, status
     ) values ($1, $2, $3, $4, 1, 'queued')`,
    [outputId, generationId, input.workspaceId, input.brandId],
  );
  await client.query(
    `update channel_outputs
        set ai_content_generation_output_id = $2, updated_at = now()
      where id = $1 and workspace_id = $3 and brand_id = $4`,
    [input.channelOutputId, outputId, input.workspaceId, input.brandId],
  );
  await client.query(
    `insert into ai_content_generation_jobs (
       id, generation_id, workspace_id, brand_id, job_type, content_type, status, payload_json
     ) values ($1, $2, $3, $4, 'analyze', 'card_news', 'queued', $5)`,
    [
      jobId,
      generationId,
      input.workspaceId,
      input.brandId,
      JSON.stringify({
        generationId,
        finalizeGeneration: true,
        origin: "scheduled_automation",
        channelOutputId: input.channelOutputId,
      }),
    ],
  );

  return { generationId, outputId, jobId };
}
