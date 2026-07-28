import { parseContentGenerationInputV2, type ContentGenerationInputV2 } from "./aiContentGenerationInput.js";

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
    sourceSnapshotId?: string;
    sourceType: string;
    contentUrl: string;
    content: string;
  }>;
}

export interface EnqueueAutomatedCardNewsInput extends AutomatedCardNewsInput {
  workspaceId: string;
  brandId: string;
  channelOutputId: string;
  sourceSnapshotIds?: string[];
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
  options: {
    automatedContentEnabled?: boolean;
    mode?: "proposal";
  } = {},
) {
  if (!options.automatedContentEnabled) {
    return { mode: "disabled" as const };
  }
  if ((options.mode ?? "proposal") === "proposal") {
    const requestedSnapshotIds = [...new Set(
      input.sourceSnapshotIds
        ?? input.sourceMaterials.flatMap((material) => material.sourceSnapshotId ? [material.sourceSnapshotId] : []),
    )];
    const sourceResult = await client.query(
      `with candidate_sources as (
         select distinct source.id
           from source_urls source
           left join source_snapshots triggering
             on triggering.source_url_id=source.id
            and triggering.workspace_id=source.workspace_id
            and triggering.brand_id=source.brand_id
          where source.workspace_id=$1 and source.brand_id=$2
            and source.enabled=true and source.deleted_at is null
            and (
              (cardinality($3::uuid[]) > 0 and triggering.id=any($3::uuid[]))
              or (cardinality($3::uuid[]) = 0 and source.url=$4)
            )
       )
       select latest.id,source.url,latest.fetched_at,latest.content_hash,
              coalesce(latest.summary,left(latest.extracted_text,2000),'') summary
         from candidate_sources candidate
         join source_urls source on source.id=candidate.id
         join lateral (
           select snapshot.*
             from source_snapshots snapshot
            where snapshot.source_url_id=source.id
              and snapshot.workspace_id=$1 and snapshot.brand_id=$2
              and snapshot.status='succeeded'
            order by snapshot.fetched_at desc,snapshot.id desc
            limit 1
         ) latest on true
        order by latest.fetched_at desc,latest.id desc`,
      [input.workspaceId, input.brandId, requestedSnapshotIds, input.representativeUrl],
    );
    const sourceSnapshots = sourceResult.rows.map((row) => ({
      sourceId: String(row.id),
      url: String(row.url),
      crawledAt: new Date(row.fetched_at).toISOString(),
      contentHash: String(row.content_hash),
      summary: String(row.summary ?? ""),
    }));
    const request = {
      contractVersion: "content-proposal-request.v1",
      contentFamily: "informational",
      subjectInput: {
        contentTopicId: input.contentTopicId,
        title: input.topic.title,
        angle: input.topic.angle,
        representativeUrl: input.representativeUrl,
      },
      channelTargets: ["instagram"],
      outputFormats: ["card_news"],
      sourceSnapshotIds: sourceSnapshots.map((snapshot) => snapshot.sourceId),
      performanceSnapshotIds: [],
    };
    await client.query(
      `insert into source_crawl_runs (
         workspace_id,brand_id,source_url_id,run_key,trigger,status
       )
       select source.workspace_id,source.brand_id,source.id,
              'scheduled-proposal-refresh:' || source.id::text || ':' || current_date::text,
              'scheduled','queued'
         from source_urls source
         left join lateral (
           select snapshot.fetched_at
             from source_snapshots snapshot
            where snapshot.source_url_id=source.id and snapshot.status='succeeded'
            order by snapshot.fetched_at desc,snapshot.id desc limit 1
         ) latest on true
        where source.workspace_id=$1 and source.brand_id=$2
          and source.enabled=true and source.deleted_at is null
          and (latest.fetched_at is null or latest.fetched_at < now() - interval '7 days')
       on conflict (run_key) do nothing`,
      [input.workspaceId, input.brandId],
    );
    const created = await client.query(
      `insert into ai_content_proposal_batches (
         workspace_id,brand_id,origin,content_family,request_json,
         source_snapshot_json,status,idempotency_key,created_by_user_id
       ) values ($1,$2,'scheduled_crawl','informational',$3::jsonb,$5::jsonb,
                 'queued',$4,null)
       on conflict (workspace_id,brand_id,idempotency_key)
       do nothing
       returning id`,
      [
        input.workspaceId,
        input.brandId,
        JSON.stringify(request),
        `scheduled-proposal:${input.channelOutputId}`,
        JSON.stringify(sourceSnapshots),
      ],
    );
    let batchId = created.rows[0]?.id ? String(created.rows[0].id) : "";
    if (!batchId) {
      const existing = await client.query(
        `select id
           from ai_content_proposal_batches
          where workspace_id=$1 and brand_id=$2 and idempotency_key=$3`,
        [
          input.workspaceId,
          input.brandId,
          `scheduled-proposal:${input.channelOutputId}`,
        ],
      );
      batchId = existing.rows[0]?.id ? String(existing.rows[0].id) : "";
      if (!batchId) throw new Error("ai_content_proposal_batch_conflict");
    } else {
      await client.query(
        `insert into ai_content_proposal_jobs (workspace_id,brand_id,batch_id,status)
         values ($1,$2,$3,'queued')`,
        [input.workspaceId, input.brandId, batchId],
      );
    }
    return { batchId, mode: "proposal" as const };
  }
  return { mode: "disabled" as const };
}
