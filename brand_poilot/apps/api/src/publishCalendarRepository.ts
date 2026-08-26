import type { Pool, PoolClient } from "pg";
import { withAiContentTransactionFence } from "./aiContentMaintenance.js";
import {
  batchSlotIdentity,
  manualSlotIdentity,
  normalizeCalendarChannels,
} from "./publishCalendarIdempotency.js";
import {
  reservePublicationUnit,
  subscriptionWeekWindow,
  usageAvailability,
  type UsageAvailability,
} from "./publishCalendarQuota.js";
import type {
  AppliedSubscriptionRenewal,
  Channel,
  PublishCalendarContentCandidateDto,
  PublishCalendarManualOptionsDto,
  PublishCalendarManualSlotSourceDto,
  PublishCalendarSettingsDto,
  PublishCalendarSlotDto,
  PublishCalendarWeeklyScheduleEntryDto,
  PublishCalendarWeeklySettingsDto,
  PublishCalendarWeeklyUsageDto,
} from "./types.js";

type BrandScope = { workspaceId: string; brandId: string };
type ContentFormat = "card_news" | "reel";
type RecommendationKind = "informational" | "trend";
type AssignmentMode = "automatic" | "manual";
type WeeklyScheduleInput = Array<Omit<PublishCalendarWeeklyScheduleEntryDto, "id"> & { id: string | null }>;
type WeeklyConfigurationInput = BrandScope & {
  channels: Channel[];
  informationalFormat: ContentFormat;
  trendFormat: ContentFormat;
  weeklySchedule: WeeklyScheduleInput;
};
type WeeklySettingsInput = WeeklyConfigurationInput & { enabled: boolean };
type ManualSlotProvisionInput = BrandScope & {
  scheduledFor: Date;
  channel: Channel;
  contentFormat: ContentFormat;
  idempotencyKey: string;
  createdByUserId?: string | null;
  source: PublishCalendarManualSlotSourceDto;
};
type PersistedManualSlotProvisionInput = ManualSlotProvisionInput & {
  requestIdentity: { key: string; prefix: string; legacyKey: string };
};
export type AutomaticOccurrenceInput = {
  scheduleEntryId: string;
  scheduledFor: Date;
  recommendationKind: RecommendationKind;
  idempotencyKey: string;
};
export type ProjectedSubscriptionPlan = {
  status: "active";
  startedAt: Date;
  currentPeriodStart: Date;
  currentPeriodEnd: Date;
  weeklyGenerationLimit: number;
  weeklyPublishLimit: number;
};
export type AutomaticOccurrenceResult =
  | { idempotencyKey: string; status: "created" | "existing"; slot: PublishCalendarSlotDto }
  | { idempotencyKey: string; status: "quota_exhausted" | "subscription_ineligible"; slot: null };
export type AutomaticOccurrencePreviewResult =
  | { idempotencyKey: string; status: "existing"; slot: PublishCalendarSlotDto }
  | { idempotencyKey: string; status: "create" | "quota_blocked" | "subscription_ineligible"; slot: null };

type PublishCalendarRepositoryOptions = {
  afterManualSlotProvisioned?: (input: BrandScope & {
    generationId: string;
    outputId: string;
  }) => Promise<void>;
};

export interface PublishCalendarRepository {
  getManualOptions(scope: BrandScope): Promise<PublishCalendarManualOptionsDto>;
  listManualContentCandidates(input: BrandScope & {
    kind: "generating" | "completed_unpublished";
  }): Promise<PublishCalendarContentCandidateDto[]>;
  provisionManualSlot(input: ManualSlotProvisionInput): Promise<PublishCalendarSlotDto>;
  provisionManualSlotsBatch(input: BrandScope & {
    idempotencyKey: string;
    createdByUserId?: string | null;
    rows: Array<Omit<ManualSlotProvisionInput, keyof BrandScope | "idempotencyKey" | "createdByUserId"> & {
      clientRowId: string;
    }>;
  }): Promise<PublishCalendarSlotDto[]>;
  getSettings(scope: BrandScope): Promise<PublishCalendarSettingsDto>;
  saveSettings(input: BrandScope & {
    enabled: boolean;
    channels: Channel[];
    informationalFormat: ContentFormat;
    trendFormat: ContentFormat;
    slotTimes: string[];
  }): Promise<PublishCalendarSettingsDto>;
  getWeeklySettings(scope: BrandScope): Promise<PublishCalendarWeeklySettingsDto>;
  saveWeeklySettings(input: WeeklySettingsInput): Promise<PublishCalendarWeeklySettingsDto>;
  saveWeeklyConfiguration(input: WeeklyConfigurationInput): Promise<PublishCalendarWeeklySettingsDto>;
  setWeeklyEnabled(input: BrandScope & { enabled: boolean }): Promise<PublishCalendarWeeklySettingsDto>;
  listSlots(input: BrandScope & { startsAt: Date; endsAt: Date }): Promise<PublishCalendarSlotDto[]>;
  createSlot(input: BrandScope & {
    scheduledFor: Date;
    assignmentMode: "automatic";
    recommendationKind: RecommendationKind;
    contentFormat: ContentFormat;
    channels: Channel[];
    idempotencyKey: string;
    createdByUserId?: string | null;
  }): Promise<
    | { status: "created" | "existing"; slot: PublishCalendarSlotDto }
    | { status: "quota_exhausted"; slot: null }
  >;
  provisionAutomaticOccurrences(input: BrandScope & {
    occurrences: AutomaticOccurrenceInput[];
  }): Promise<AutomaticOccurrenceResult[]>;
  previewAutomaticOccurrences(input: BrandScope & {
    occurrences: AutomaticOccurrenceInput[];
    subscriptionProjection?: ProjectedSubscriptionPlan;
  }): Promise<AutomaticOccurrencePreviewResult[]>;
  assignSlot(input: BrandScope & {
    slotId: string;
    assignmentMode: AssignmentMode;
    contentSuggestionId?: string | null;
    proposalId?: string | null;
    generationId?: string | null;
    generationOutputId?: string | null;
    topicPublishGroupId?: string | null;
    title?: string | null;
  }): Promise<PublishCalendarSlotDto>;
  rescheduleSlot(input: BrandScope & {
    slotId: string;
    scheduledFor: Date;
  }): Promise<PublishCalendarSlotDto>;
  cancelSlot(input: BrandScope & { slotId: string }): Promise<PublishCalendarSlotDto>;
  getWeeklyUsage(input: BrandScope & { at?: Date }): Promise<PublishCalendarWeeklyUsageDto>;
  applyDueSubscriptionRenewals(now?: Date): Promise<AppliedSubscriptionRenewal[]>;
  previewDueSubscriptionRenewals(now?: Date): Promise<AppliedSubscriptionRenewal[]>;
}

const DEFAULT_SLOT_TIMES = ["11:30", "14:30", "17:30", "20:30"];
const SUPPORTED_CHANNELS = new Set<Channel>(["instagram"]);
const MAX_WEEKLY_SCHEDULE_ENTRIES_PER_DAY = 24;
const MAX_WEEKLY_SCHEDULE_ENTRIES = MAX_WEEKLY_SCHEDULE_ENTRIES_PER_DAY * 7;
const MAX_POSTGRES_INTEGER = 2_147_483_647;
const ACTIVE_RESERVATION_STATUSES = [
  "open", "proposal_assigned", "generation_pending", "content_assigned", "ready",
  "scheduled", "publish_delayed", "quota_blocked",
];

function iso(value: unknown): string {
  return new Date(value as string | number | Date).toISOString();
}

function time(value: unknown): string {
  const match = String(value).match(/^(\d{2}):(\d{2})/);
  if (!match) throw new Error("publish_calendar_time_invalid");
  return `${match[1]}:${match[2]}`;
}

function mapSettings(row: Record<string, unknown> | undefined, brandId: string): PublishCalendarSettingsDto {
  return {
    brandId,
    enabled: row?.enabled === true,
    channels: (row?.channels ?? []) as Channel[],
    informationalFormat: (row?.informational_format ?? "card_news") as ContentFormat,
    trendFormat: (row?.trend_format ?? "reel") as ContentFormat,
    slotTimes: Array.isArray(row?.slot_times) ? row.slot_times.map(time) : DEFAULT_SLOT_TIMES,
    updatedAt: row?.updated_at ? iso(row.updated_at) : null,
  };
}

function mapWeeklyScheduleEntry(row: Record<string, unknown>): PublishCalendarWeeklyScheduleEntryDto {
  return {
    id: String(row.id),
    dayOfWeek: Number(row.day_of_week) as PublishCalendarWeeklyScheduleEntryDto["dayOfWeek"],
    time: time(row.slot_time),
    sortOrder: Number(row.sort_order),
  };
}

function mapWeeklySettings(
  row: Record<string, unknown> | undefined,
  brandId: string,
  scheduleRows: Array<Record<string, unknown>>,
): PublishCalendarWeeklySettingsDto {
  return {
    brandId,
    enabled: row?.enabled === true,
    channels: (row?.channels ?? []) as Channel[],
    informationalFormat: (row?.informational_format ?? "card_news") as ContentFormat,
    trendFormat: (row?.trend_format ?? "reel") as ContentFormat,
    weeklySchedule: scheduleRows.map(mapWeeklyScheduleEntry),
    updatedAt: row?.updated_at ? iso(row.updated_at) : null,
  };
}

function mapSlot(row: Record<string, unknown>): PublishCalendarSlotDto {
  return {
    id: String(row.id),
    workspaceId: String(row.workspace_id),
    brandId: String(row.brand_id),
    scheduledFor: iso(row.scheduled_for),
    effectiveScheduledFor: row.effective_scheduled_for ? iso(row.effective_scheduled_for) : null,
    assignmentMode: row.assignment_mode as AssignmentMode,
    status: row.status as PublishCalendarSlotDto["status"],
    recommendationKind: row.recommendation_kind as RecommendationKind | null,
    contentFormat: row.content_format as ContentFormat,
    channels: (row.channels ?? []) as Channel[],
    contentSuggestionId: row.content_suggestion_id ? String(row.content_suggestion_id) : null,
    proposalId: row.proposal_id ? String(row.proposal_id) : null,
    generationId: row.generation_id ? String(row.generation_id) : null,
    generationOutputId: row.generation_output_id ? String(row.generation_output_id) : null,
    topicPublishGroupId: row.topic_publish_group_id ? String(row.topic_publish_group_id) : null,
    idempotencyKey: row.idempotency_key ? String(row.idempotency_key) : null,
    title: row.title ? String(row.title) : null,
    lastError: row.last_error ? String(row.last_error) : null,
    updatedAt: iso(row.updated_at),
  };
}

function mapContentCandidate(
  row: Record<string, unknown>,
  kind: "generating" | "completed_unpublished",
): PublishCalendarContentCandidateDto {
  const blockedReason = row.blocked_reason ? String(row.blocked_reason) : null;
  return {
    kind,
    generationId: String(row.generation_id),
    generationOutputId: row.generation_output_id ? String(row.generation_output_id) : null,
    topicPublishGroupId: row.topic_publish_group_id ? String(row.topic_publish_group_id) : null,
    title: String(row.title),
    contentFormat: row.content_format as ContentFormat,
    status: String(row.status),
    createdAt: iso(row.created_at),
    assignable: blockedReason === null,
    blockedReason,
  };
}

function validateChannels(channels: Channel[]): Channel[] {
  if (!Array.isArray(channels) || channels.some((channel) => !SUPPORTED_CHANNELS.has(channel))) {
    throw new Error("publish_calendar_channel_invalid");
  }
  return [...new Set(channels)].sort();
}

function isPreservedGenerationReservationConflict(error: unknown): boolean {
  const pgError = error as { code?: string; constraint?: string; message?: string };
  return pgError.code === "23505"
    && (pgError.constraint === "publish_calendar_slots_generation_unique"
      || pgError.message?.includes("publish_calendar_slots_generation_unique") === true);
}

function validateSlotTimes(values: string[]): string[] {
  if (!Array.isArray(values) || values.length < 1 || values.length > 24
    || values.some((value) => !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value))) {
    throw new Error("publish_calendar_time_invalid");
  }
  return [...values];
}

function validateWeeklySchedule(
  values: Array<Omit<PublishCalendarWeeklyScheduleEntryDto, "id"> & { id: string | null }>,
): Array<Omit<PublishCalendarWeeklyScheduleEntryDto, "id"> & { id: string | null }> {
  if (!Array.isArray(values)) throw new Error("publish_calendar_weekly_schedule_invalid");
  if (values.length > MAX_WEEKLY_SCHEDULE_ENTRIES) {
    throw new Error("publish_calendar_schedule_limit_exceeded");
  }
  const perDay = new Map<number, Set<number>>();
  const ids = new Set<string>();
  for (const row of values) {
    if (!Number.isInteger(row.dayOfWeek) || row.dayOfWeek < 1 || row.dayOfWeek > 7) {
      throw new Error("publish_calendar_day_invalid");
    }
    if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time)) {
      throw new Error("publish_calendar_time_invalid");
    }
    if (!Number.isInteger(row.sortOrder) || row.sortOrder < 0 || row.sortOrder > MAX_POSTGRES_INTEGER) {
      throw new Error("publish_calendar_sort_order_invalid");
    }
    const sortOrders = perDay.get(row.dayOfWeek) ?? new Set<number>();
    if (sortOrders.has(row.sortOrder)) throw new Error("publish_calendar_sort_order_invalid");
    sortOrders.add(row.sortOrder);
    perDay.set(row.dayOfWeek, sortOrders);
    if (sortOrders.size > MAX_WEEKLY_SCHEDULE_ENTRIES_PER_DAY) {
      throw new Error("publish_calendar_schedule_limit_exceeded");
    }
    if (row.id !== null) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(row.id)
        || ids.has(row.id)) {
        throw new Error("publish_calendar_weekly_schedule_id_invalid");
      }
      ids.add(row.id);
    }
  }
  return values.map((row) => ({ ...row }));
}

function temporaryWeeklySortOrders(
  existingRows: Array<Record<string, unknown>>,
  incomingRows: Array<Omit<PublishCalendarWeeklyScheduleEntryDto, "id"> & { id: string | null }>,
): Map<string, number> {
  const unavailableByDay = new Map<number, Set<number>>();
  for (const row of existingRows) {
    const day = Number(row.day_of_week);
    const unavailable = unavailableByDay.get(day) ?? new Set<number>();
    unavailable.add(Number(row.sort_order));
    unavailableByDay.set(day, unavailable);
  }
  for (const row of incomingRows) {
    const unavailable = unavailableByDay.get(row.dayOfWeek) ?? new Set<number>();
    unavailable.add(row.sortOrder);
    unavailableByDay.set(row.dayOfWeek, unavailable);
  }

  const temporary = new Map<string, number>();
  for (const row of existingRows) {
    const day = Number(row.day_of_week);
    const unavailable = unavailableByDay.get(day)!;
    const searchLimit = unavailable.size;
    let allocated: number | undefined;
    for (let candidate = 0; candidate <= searchLimit; candidate += 1) {
      if (!unavailable.has(candidate)) {
        allocated = candidate;
        break;
      }
    }
    if (allocated === undefined) throw new Error("publish_calendar_schedule_limit_exceeded");
    temporary.set(String(row.id), allocated);
    unavailable.add(allocated);
  }
  return temporary;
}

async function transaction<T>(pool: Pool, action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const result = await action(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function lockBrand(client: Pick<PoolClient, "query">, brandId: string): Promise<void> {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`publish-calendar:${brandId}`]);
}

type NormalizedAutomaticOccurrence = AutomaticOccurrenceInput & { inputOrder: number };

function normalizeAutomaticOccurrences(
  input: AutomaticOccurrenceInput[],
): NormalizedAutomaticOccurrence[] {
  const seenKeys = new Set<string>();
  return input.map((occurrence, inputOrder) => {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(occurrence.scheduleEntryId)
      || !/^[0-9a-f]{64}$/.test(occurrence.idempotencyKey)
      || seenKeys.has(occurrence.idempotencyKey)) {
      throw new Error("publish_calendar_idempotency_key_invalid");
    }
    if (!Number.isFinite(occurrence.scheduledFor.getTime())) {
      throw new Error("publish_calendar_time_invalid");
    }
    if (occurrence.recommendationKind !== "informational"
      && occurrence.recommendationKind !== "trend") {
      throw new Error("publish_calendar_recommendation_kind_invalid");
    }
    seenKeys.add(occurrence.idempotencyKey);
    return { ...occurrence, inputOrder };
  });
}

async function evaluateAutomaticOccurrences(
  queryable: Pick<PoolClient, "query">,
  input: BrandScope & { subscriptionProjection?: ProjectedSubscriptionPlan },
  occurrences: NormalizedAutomaticOccurrence[],
  lockRows: boolean,
) {
  const lock = lockRows ? " for update" : "";
  const settings = await queryable.query(
    `select settings.enabled,settings.channels,settings.informational_format,
            settings.trend_format
       from publish_calendar_settings settings
      where settings.brand_id=$1::uuid and settings.workspace_id=$2::uuid${lock}`,
    [input.brandId, input.workspaceId],
  );
  const schedule = await queryable.query(
    `select id,day_of_week,slot_time,sort_order
       from publish_calendar_weekly_schedule_entries
      where brand_id=$1::uuid and workspace_id=$2::uuid
      order by day_of_week,sort_order,id${lock}`,
    [input.brandId, input.workspaceId],
  );
  const subscription = await queryable.query(
    `select subscription.status,subscription.started_at,
            subscription.current_period_start,subscription.current_period_end,
            plan.weekly_generation_limit,plan.weekly_publish_limit
       from brand_subscriptions subscription
       join brands brand on brand.id=subscription.brand_id and brand.workspace_id=$2::uuid
       join billing_plan_catalog plan on plan.code=subscription.plan_code and plan.active
      where subscription.brand_id=$1::uuid${lockRows ? " for update of subscription" : ""}`,
    [input.brandId, input.workspaceId],
  );
  const existing = await queryable.query(
    `select slot.* from publish_calendar_slots slot
      where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid
        and slot.idempotency_key=any($3::text[])${lock}`,
    [input.workspaceId, input.brandId, occurrences.map(({ idempotencyKey }) => idempotencyKey)],
  );
  const existingByKey = new Map(existing.rows.map((row) => [String(row.idempotency_key), mapSlot(row)]));
  const scheduleById = new Map(schedule.rows.map((row) => [String(row.id), row]));
  const ordered = [...occurrences].sort((left, right) => {
    const instant = left.scheduledFor.getTime() - right.scheduledFor.getTime();
    if (instant !== 0) return instant;
    const leftSchedule = scheduleById.get(left.scheduleEntryId);
    const rightSchedule = scheduleById.get(right.scheduleEntryId);
    const day = Number(leftSchedule?.day_of_week ?? 8) - Number(rightSchedule?.day_of_week ?? 8);
    if (day !== 0) return day;
    const sort = Number(leftSchedule?.sort_order ?? MAX_POSTGRES_INTEGER)
      - Number(rightSchedule?.sort_order ?? MAX_POSTGRES_INTEGER);
    if (sort !== 0) return sort;
    return left.scheduleEntryId.localeCompare(right.scheduleEntryId) || left.inputOrder - right.inputOrder;
  });
  const databaseClock = await queryable.query("select clock_timestamp() as now");
  const now = new Date(databaseClock.rows[0]?.now ?? Date.now());
  const settingsRow = settings.rows[0];
  const subscriptionRow = input.subscriptionProjection ? {
    status: input.subscriptionProjection.status,
    started_at: input.subscriptionProjection.startedAt,
    current_period_start: input.subscriptionProjection.currentPeriodStart,
    current_period_end: input.subscriptionProjection.currentPeriodEnd,
    weekly_generation_limit: input.subscriptionProjection.weeklyGenerationLimit,
    weekly_publish_limit: input.subscriptionProjection.weeklyPublishLimit,
  } : subscription.rows[0];
  const selectedChannels = settingsRow
    ? validateChannels((settingsRow.channels ?? []) as Channel[]).filter((channel) => SUPPORTED_CHANNELS.has(channel))
    : [];
  const connected = selectedChannels.length > 0
    ? await connectedCalendarChannels(queryable, input, selectedChannels)
    : new Set<Channel>();
  const channels = selectedChannels.filter((channel) => connected.has(channel));
  const currentSubscriptionEligible = Boolean(subscriptionRow)
    && ["active", "cancel_scheduled"].includes(String(subscriptionRow.status))
    && new Date(subscriptionRow.current_period_start).getTime() <= now.getTime()
    && now.getTime() < new Date(subscriptionRow.current_period_end).getTime();
  const missingEntitled = ordered.filter((occurrence) => {
    if (existingByKey.has(occurrence.idempotencyKey)) return false;
    const scheduleRow = scheduleById.get(occurrence.scheduleEntryId);
    const occurrenceParts = occurrenceKstParts(occurrence.scheduledFor);
    const scheduleMatches = Boolean(scheduleRow)
      && Number(scheduleRow.day_of_week) === occurrenceParts.dayOfWeek
      && time(scheduleRow.slot_time) === occurrenceParts.time;
    const beforeCancellation = subscriptionRow?.status !== "cancel_scheduled"
      || occurrence.scheduledFor.getTime() < new Date(subscriptionRow.current_period_end).getTime();
    return settingsRow?.enabled === true && channels.length > 0 && currentSubscriptionEligible
      && scheduleMatches && beforeCancellation && occurrence.scheduledFor.getTime() > now.getTime();
  });
  const windowsByKey = new Map<string, { startsAt: Date; endsAt: Date }>();
  const occurrenceWindowKey = new Map<string, string>();
  if (subscriptionRow) {
    for (const occurrence of missingEntitled) {
      const window = subscriptionWeekWindow({
        subscriptionStartedAt: new Date(subscriptionRow.started_at),
        now: occurrence.scheduledFor,
      });
      const key = window.startsAt.toISOString();
      windowsByKey.set(key, window);
      occurrenceWindowKey.set(occurrence.idempotencyKey, key);
    }
  }
  const availability = await publishUsageForWindows(
    queryable,
    input,
    [...windowsByKey.values()],
    Number(subscriptionRow?.weekly_publish_limit ?? 0),
  );
  return { ordered, existingByKey, occurrenceWindowKey, availability, settingsRow, channels };
}

function planAutomaticOccurrences(
  evaluated: Awaited<ReturnType<typeof evaluateAutomaticOccurrences>>,
) {
  return evaluated.ordered.map((occurrence) => {
    const replay = evaluated.existingByKey.get(occurrence.idempotencyKey);
    if (replay) return { occurrence, status: "existing" as const, slot: replay, contentFormat: null };
    const windowKey = evaluated.occurrenceWindowKey.get(occurrence.idempotencyKey);
    if (!windowKey) {
      return { occurrence, status: "subscription_ineligible" as const, slot: null, contentFormat: null };
    }
    const reserved = reservePublicationUnit(evaluated.availability.get(windowKey)!);
    if (!reserved) return { occurrence, status: "quota_blocked" as const, slot: null, contentFormat: null };
    evaluated.availability.set(windowKey, reserved);
    const contentFormat = occurrence.recommendationKind === "trend"
      ? evaluated.settingsRow.trend_format as ContentFormat
      : evaluated.settingsRow.informational_format as ContentFormat;
    return { occurrence, status: "create" as const, slot: null, contentFormat };
  });
}

async function assertConnectedChannels(
  client: Pick<PoolClient, "query">,
  scope: BrandScope,
  channels: Channel[],
): Promise<void> {
  if (channels.length === 0) throw new Error("publish_calendar_channel_invalid");
  const connected = await connectedCalendarChannels(client, scope, channels);
  if (connected.size !== channels.length) {
    throw new Error("publish_calendar_channel_not_connected");
  }
}

async function connectedCalendarChannels(
  client: Pick<PoolClient, "query">,
  scope: BrandScope,
  channels: Channel[],
): Promise<Set<Channel>> {
  if (channels.length === 0) return new Set();
  const connected = await client.query(
    `select channel from brand_channels
      where brand_id=$1::uuid and workspace_id=$2::uuid and deleted_at is null
        and enabled and status='connected' and channel=any($3::text[])`,
    [scope.brandId, scope.workspaceId, channels],
  );
  return new Set(connected.rows.map(({ channel }) => String(channel) as Channel));
}

type ActiveSubscriptionPlan = {
  startedAt: Date;
  weeklyGenerationLimit: number;
  weeklyPublishLimit: number;
};

async function activeSubscriptionPlan(
  client: Pick<PoolClient, "query">,
  scope: BrandScope,
): Promise<ActiveSubscriptionPlan> {
  const subscription = await client.query(
    `select subscription.started_at,plan.weekly_generation_limit,plan.weekly_publish_limit
       from brand_subscriptions subscription
       join brands brand on brand.id=subscription.brand_id and brand.workspace_id=$2::uuid
       join billing_plan_catalog plan on plan.code=subscription.plan_code and plan.active
      where subscription.brand_id=$1::uuid
        and subscription.status in ('active','cancel_scheduled')
        and subscription.current_period_start<=now()
        and subscription.current_period_end>now()`,
    [scope.brandId, scope.workspaceId],
  );
  if (!subscription.rowCount) throw new Error("publish_calendar_subscription_inactive");
  return {
    startedAt: new Date(subscription.rows[0].started_at),
    weeklyGenerationLimit: Number(subscription.rows[0].weekly_generation_limit),
    weeklyPublishLimit: Number(subscription.rows[0].weekly_publish_limit),
  };
}

async function subscriptionAndPublishUsage(
  client: Pick<PoolClient, "query">,
  scope: BrandScope,
  at: Date,
  excludeSlotId?: string,
): Promise<{
  window: { startsAt: Date; endsAt: Date };
  availability: UsageAvailability;
  generationLimit: number;
}> {
  const plan = await activeSubscriptionPlan(client, scope);
  const window = subscriptionWeekWindow({ subscriptionStartedAt: plan.startedAt, now: at });
  const usage = await client.query(
    `with calendar_publish_groups as (
       select slot.id,slot.status,slot.scheduled_for,
              max(queue.published_at) filter (where queue.status='published') as published_at
         from publish_calendar_slots slot
         left join publish_queue queue on queue.topic_publish_group_id=slot.topic_publish_group_id
        where slot.brand_id=$1::uuid and slot.workspace_id=$2::uuid
          and ($6::uuid is null or slot.id<>$6::uuid)
        group by slot.id,slot.status,slot.scheduled_for
     ), calendar_usage as (
       select count(*) filter (
                where status='published' and published_at >= $3::timestamptz and published_at < $5::timestamptz
              )::integer as published_count,
              count(*) filter (
                where status=any($4::text[])
                  and scheduled_for >= $3::timestamptz and scheduled_for < $5::timestamptz
              )::integer as reserved_count
         from calendar_publish_groups
     ), direct_publish_groups as (
       select coalesce(
                'ai-output:' || output.ai_content_generation_output_id::text,
                'topic:' || output.content_topic_id::text,
                'group:' || queue.topic_publish_group_id::text,
                'channel-output:' || output.id::text,
                'queue:' || queue.id::text
              ) as publication_unit_key,
              bool_or(queue.status='published') as published,
              bool_or(queue.status in ('queued','scheduled','publishing','deferred')) as reserved,
              max(queue.published_at) filter (where queue.status='published') as published_at,
              min(coalesce(queue.scheduled_for,queue.queued_at))
                filter (where queue.status in ('queued','scheduled','publishing','deferred')) as reserved_at
         from publish_queue queue
         left join channel_outputs output
           on output.id=queue.channel_output_id
          and output.workspace_id=queue.workspace_id and output.brand_id=queue.brand_id
        where queue.brand_id=$1::uuid and queue.workspace_id=$2::uuid
          and not exists (
            select 1 from publish_calendar_slots linked_slot
             where linked_slot.topic_publish_group_id=queue.topic_publish_group_id
               and linked_slot.status<>'cancelled'
          )
        group by publication_unit_key
     ), direct_usage as (
       select count(*) filter (
                where published and published_at >= $3::timestamptz and published_at < $5::timestamptz
              )::integer as published_count,
              count(*) filter (
                where not published and reserved
                  and reserved_at >= $3::timestamptz and reserved_at < $5::timestamptz
              )::integer as reserved_count
         from direct_publish_groups
     )
     select calendar_usage.published_count+direct_usage.published_count as published_count,
            calendar_usage.reserved_count+direct_usage.reserved_count as reserved_count
       from calendar_usage cross join direct_usage`,
    [scope.brandId, scope.workspaceId, window.startsAt, ACTIVE_RESERVATION_STATUSES, window.endsAt,
      excludeSlotId ?? null],
  );
  return {
    window,
    availability: usageAvailability({
      limit: plan.weeklyPublishLimit,
      succeeded: Number(usage.rows[0]?.published_count ?? 0),
      reserved: Number(usage.rows[0]?.reserved_count ?? 0),
    }),
    generationLimit: plan.weeklyGenerationLimit,
  };
}

async function publishUsageForWindows(
  client: Pick<PoolClient, "query">,
  scope: BrandScope,
  windows: Array<{ startsAt: Date; endsAt: Date }>,
  weeklyPublishLimit: number,
): Promise<Map<string, UsageAvailability>> {
  if (windows.length === 0) return new Map();
  const usage = await client.query(
    `with target_windows as (
       select (target.ordinality-1)::integer window_index,target.starts_at,target.ends_at
         from unnest($3::timestamptz[],$4::timestamptz[]) with ordinality
           as target(starts_at,ends_at,ordinality)
     ), target_bounds as (
       select min(starts_at) starts_at,max(ends_at) ends_at from target_windows
     ), calendar_usage as (
       select target.window_index,
              count(slot.id) filter (
                where slot.status='published'
                  and published.published_at>=target.starts_at
                  and published.published_at<target.ends_at
              )::integer published_count,
              count(slot.id) filter (
                where slot.status=any($5::text[])
                  and slot.scheduled_for>=target.starts_at
                  and slot.scheduled_for<target.ends_at
              )::integer reserved_count
         from target_windows target
         left join publish_calendar_slots slot
           on slot.brand_id=$1::uuid and slot.workspace_id=$2::uuid
          and ($6::uuid is null or slot.id<>$6::uuid)
          and (
            (slot.status=any($5::text[])
              and slot.scheduled_for>=target.starts_at and slot.scheduled_for<target.ends_at)
            or (slot.status='published' and exists (
              select 1 from publish_queue relevant_calendar_queue
               cross join target_bounds bounds
               where relevant_calendar_queue.topic_publish_group_id=slot.topic_publish_group_id
                 and relevant_calendar_queue.status='published'
                 and relevant_calendar_queue.published_at>=bounds.starts_at
                 and relevant_calendar_queue.published_at<bounds.ends_at
            ))
          )
         left join lateral (
           select max(queue.published_at) filter (where queue.status='published') published_at
             from publish_queue queue
            where queue.topic_publish_group_id=slot.topic_publish_group_id
         ) published on slot.status='published'
        group by target.window_index
     ), relevant_direct_keys as (
       select distinct coalesce(
                'ai-output:' || output.ai_content_generation_output_id::text,
                'topic:' || output.content_topic_id::text,
                'group:' || queue.topic_publish_group_id::text,
                'channel-output:' || output.id::text,
                'queue:' || queue.id::text
              ) publication_unit_key
         from publish_queue queue
         left join channel_outputs output
           on output.id=queue.channel_output_id
          and output.workspace_id=queue.workspace_id and output.brand_id=queue.brand_id
         cross join target_bounds bounds
        where queue.brand_id=$1::uuid and queue.workspace_id=$2::uuid
          and (
            (queue.status='published' and queue.published_at>=bounds.starts_at
              and queue.published_at<bounds.ends_at)
            or (queue.status in ('queued','scheduled','publishing','deferred')
              and coalesce(queue.scheduled_for,queue.queued_at)>=bounds.starts_at
              and coalesce(queue.scheduled_for,queue.queued_at)<bounds.ends_at)
          )
          and not exists (
            select 1 from publish_calendar_slots linked_slot
             where linked_slot.topic_publish_group_id=queue.topic_publish_group_id
               and linked_slot.status<>'cancelled'
          )
     ), direct_publish_groups as (
       select key.publication_unit_key,
              bool_or(queue.status='published') published,
              bool_or(queue.status in ('queued','scheduled','publishing','deferred')) reserved,
              max(queue.published_at) filter (where queue.status='published') published_at,
              min(coalesce(queue.scheduled_for,queue.queued_at))
                filter (where queue.status in ('queued','scheduled','publishing','deferred')) reserved_at
         from relevant_direct_keys key
         join publish_queue queue on queue.brand_id=$1::uuid and queue.workspace_id=$2::uuid
         left join channel_outputs output
           on output.id=queue.channel_output_id
          and output.workspace_id=queue.workspace_id and output.brand_id=queue.brand_id
        where key.publication_unit_key=coalesce(
                'ai-output:' || output.ai_content_generation_output_id::text,
                'topic:' || output.content_topic_id::text,
                'group:' || queue.topic_publish_group_id::text,
                'channel-output:' || output.id::text,
                'queue:' || queue.id::text
              )
          and not exists (
            select 1 from publish_calendar_slots linked_slot
             where linked_slot.topic_publish_group_id=queue.topic_publish_group_id
               and linked_slot.status<>'cancelled'
          )
        group by key.publication_unit_key
     ), direct_usage as (
       select target.window_index,
              count(grouped.publication_unit_key) filter (
                where grouped.published and grouped.published_at>=target.starts_at
                  and grouped.published_at<target.ends_at
              )::integer published_count,
              count(grouped.publication_unit_key) filter (
                where not grouped.published and grouped.reserved
                  and grouped.reserved_at>=target.starts_at
                  and grouped.reserved_at<target.ends_at
              )::integer reserved_count
         from target_windows target
         left join direct_publish_groups grouped on (
           (grouped.published and grouped.published_at>=target.starts_at
             and grouped.published_at<target.ends_at)
           or (not grouped.published and grouped.reserved
             and grouped.reserved_at>=target.starts_at and grouped.reserved_at<target.ends_at)
         )
        group by target.window_index
     )
     select target.window_index,
            coalesce(calendar.published_count,0)+coalesce(direct.published_count,0) published_count,
            coalesce(calendar.reserved_count,0)+coalesce(direct.reserved_count,0) reserved_count
       from target_windows target
       left join calendar_usage calendar on calendar.window_index=target.window_index
       left join direct_usage direct on direct.window_index=target.window_index
      order by target.window_index`,
    [scope.brandId, scope.workspaceId, windows.map(({ startsAt }) => startsAt),
      windows.map(({ endsAt }) => endsAt), ACTIVE_RESERVATION_STATUSES, null],
  );
  const result = new Map<string, UsageAvailability>();
  for (const [index, window] of windows.entries()) {
    const row = usage.rows.find((candidate) => Number(candidate.window_index) === index);
    result.set(window.startsAt.toISOString(), usageAvailability({
      limit: weeklyPublishLimit,
      succeeded: Number(row?.published_count ?? 0),
      reserved: Number(row?.reserved_count ?? 0),
    }));
  }
  return result;
}

function occurrenceKstParts(value: Date): { dayOfWeek: number; time: string } {
  const shifted = new Date(value.getTime() + 9 * 60 * 60 * 1_000);
  return {
    dayOfWeek: shifted.getUTCDay() || 7,
    time: `${String(shifted.getUTCHours()).padStart(2, "0")}:${String(shifted.getUTCMinutes()).padStart(2, "0")}`,
  };
}

function addAnchoredUtcMonth(value: Date, anchorDay: number): Date {
  const year = value.getUTCFullYear();
  const month = value.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(
    year,
    month,
    Math.min(anchorDay, lastDay),
    value.getUTCHours(),
    value.getUTCMinutes(),
    value.getUTCSeconds(),
    value.getUTCMilliseconds(),
  ));
}

type SubscriptionRenewalRow = Record<string, unknown> & {
  brand_id: string;
  plan_code: string;
  pending_plan_code: string | null;
  cancel_at_period_end: boolean;
  started_at: Date | string;
  current_period_start: Date | string;
  current_period_end: Date | string;
  current_plan_active: boolean;
  pending_plan_active: boolean | null;
};

function projectSubscriptionRenewal(
  row: SubscriptionRenewalRow,
  now: Date,
): Extract<AppliedSubscriptionRenewal, { status: "applied" }> {
  const previousPlanCode = String(row.plan_code);
  const cancelled = row.cancel_at_period_end === true;
  if (!cancelled) {
    const targetPlanActive = row.pending_plan_code
      ? row.pending_plan_active
      : row.current_plan_active;
    if (targetPlanActive !== undefined && targetPlanActive !== true) {
      throw new Error("subscription_renewal_plan_inactive");
    }
  }
  const planCode = cancelled ? previousPlanCode : String(row.pending_plan_code ?? previousPlanCode);
  let currentPeriodStart = new Date(row.current_period_start);
  let currentPeriodEnd = new Date(row.current_period_end);
  if (!cancelled) {
    const anchorDay = new Date(row.started_at).getUTCDate();
    while (currentPeriodEnd <= now) {
      currentPeriodStart = currentPeriodEnd;
      currentPeriodEnd = addAnchoredUtcMonth(currentPeriodEnd, anchorDay);
    }
  }
  return {
    status: "applied",
    brandId: String(row.brand_id),
    previousPlanCode,
    planCode,
    currentPeriodStart,
    currentPeriodEnd,
    cancelled,
  };
}

async function loadDueSubscriptionRenewalRows(
  queryable: Pick<Pool, "query"> | Pick<PoolClient, "query">,
  now: Date,
  lock: boolean,
): Promise<SubscriptionRenewalRow[]> {
  const due = await queryable.query(
    `select subscription.brand_id,subscription.plan_code,subscription.pending_plan_code,
            subscription.status,subscription.cancel_at_period_end,
            subscription.started_at,subscription.current_period_start,subscription.current_period_end,
            current_plan.active as current_plan_active,pending_plan.active as pending_plan_active
       from brand_subscriptions subscription
       join billing_plan_catalog current_plan
         on current_plan.code=subscription.plan_code
       left join billing_plan_catalog pending_plan
         on pending_plan.code=subscription.pending_plan_code
      where subscription.current_period_end<=$1::timestamptz
        and subscription.status in ('active','cancel_scheduled')
      order by subscription.brand_id
      ${lock ? "for update of subscription" : ""}`,
    [now],
  );
  return due.rows as SubscriptionRenewalRow[];
}

function previewSubscriptionRenewals(rows: SubscriptionRenewalRow[], now: Date): AppliedSubscriptionRenewal[] {
  return rows.map((row) => {
    try {
      return projectSubscriptionRenewal(row, now);
    } catch (error) {
      return {
        status: "failed" as const,
        brandId: String(row.brand_id),
        previousPlanCode: String(row.plan_code),
        errorCode: error instanceof Error ? error.message : "subscription_renewal_failed",
      };
    }
  });
}

async function saveWeeklySettingsTransaction(
  pool: Pool,
  input: WeeklyConfigurationInput,
  requestedEnabled: boolean | null,
): Promise<PublishCalendarWeeklySettingsDto> {
  const channels = validateChannels(input.channels);
  if (input.informationalFormat !== "card_news" && input.informationalFormat !== "reel") {
    throw new Error("publish_calendar_format_invalid");
  }
  if (input.trendFormat !== "card_news" && input.trendFormat !== "reel") {
    throw new Error("publish_calendar_format_invalid");
  }
  const weeklySchedule = validateWeeklySchedule(input.weeklySchedule);
  return transaction(pool, async (client) => {
    await lockBrand(client, input.brandId);
    const settings = await client.query(
      `select enabled,channels,informational_format,trend_format,updated_at
         from publish_calendar_settings
        where brand_id=$1::uuid and workspace_id=$2::uuid
        for update`,
      [input.brandId, input.workspaceId],
    );
    const enabled = requestedEnabled ?? (settings.rows[0]?.enabled === true);
    if (enabled && (channels.length === 0 || weeklySchedule.length === 0)) {
      throw new Error("publish_calendar_settings_incomplete");
    }
    const existingSchedule = await client.query(
      `select id,workspace_id,brand_id,day_of_week,slot_time,sort_order
         from publish_calendar_weekly_schedule_entries
        where brand_id=$1::uuid and workspace_id=$2::uuid
        order by day_of_week,sort_order,id
        for update`,
      [input.brandId, input.workspaceId],
    );

    if (weeklySchedule.length > 0) {
      const plan = await activeSubscriptionPlan(client, input);
      if (weeklySchedule.length > plan.weeklyPublishLimit) {
        throw new Error("publish_calendar_publish_limit_exceeded");
      }
    }

    const connected = await connectedCalendarChannels(client, input, channels);
    const existingChannels = new Set((settings.rows[0]?.channels ?? []) as Channel[]);
    if (channels.some((channel) => !existingChannels.has(channel) && !connected.has(channel))) {
      throw new Error("publish_calendar_channel_not_connected");
    }
    if (enabled && !channels.some((channel) => connected.has(channel))) {
      throw new Error("publish_calendar_settings_incomplete");
    }

    const existingIds = new Set(existingSchedule.rows.map(({ id }) => String(id)));
    const suppliedIds = weeklySchedule.flatMap(({ id }) => id === null ? [] : [id]);
    if (suppliedIds.some((id) => !existingIds.has(id))) {
      throw new Error("publish_calendar_weekly_schedule_id_invalid");
    }

    const savedSettings = await client.query(
      `insert into publish_calendar_settings(
         brand_id,workspace_id,enabled,channels,informational_format,trend_format
       ) values($1::uuid,$2::uuid,$3,$4::text[],$5,$6)
       on conflict(brand_id) do update set
         workspace_id=excluded.workspace_id,enabled=excluded.enabled,channels=excluded.channels,
         informational_format=excluded.informational_format,trend_format=excluded.trend_format,
         updated_at=now()
       returning enabled,channels,informational_format,trend_format,updated_at`,
      [input.brandId, input.workspaceId, enabled, channels,
        input.informationalFormat, input.trendFormat],
    );

    const temporarySortOrders = temporaryWeeklySortOrders(existingSchedule.rows, weeklySchedule);
    for (const row of existingSchedule.rows) {
      const staged = await client.query(
        `update publish_calendar_weekly_schedule_entries
            set sort_order=$4
          where id=$1::uuid and brand_id=$2::uuid and workspace_id=$3::uuid`,
        [String(row.id), input.brandId, input.workspaceId, temporarySortOrders.get(String(row.id))],
      );
      if (!staged.rowCount) throw new Error("publish_calendar_weekly_schedule_id_invalid");
    }
    await client.query(
      `delete from publish_calendar_weekly_schedule_entries
        where brand_id=$1::uuid and workspace_id=$2::uuid
          and not(id=any($3::uuid[]))`,
      [input.brandId, input.workspaceId, suppliedIds],
    );
    for (const row of weeklySchedule) {
      if (row.id === null) {
        await client.query(
          `insert into publish_calendar_weekly_schedule_entries(
             workspace_id,brand_id,day_of_week,slot_time,sort_order
           ) values($1::uuid,$2::uuid,$3,$4::time,$5)
           returning id,day_of_week,slot_time,sort_order`,
          [input.workspaceId, input.brandId, row.dayOfWeek, row.time, row.sortOrder],
        );
      } else {
        const updated = await client.query(
          `update publish_calendar_weekly_schedule_entries
              set day_of_week=$4,slot_time=$5::time,sort_order=$6,updated_at=now()
            where id=$1::uuid and brand_id=$2::uuid and workspace_id=$3::uuid`,
          [row.id, input.brandId, input.workspaceId, row.dayOfWeek, row.time, row.sortOrder],
        );
        if (!updated.rowCount) throw new Error("publish_calendar_weekly_schedule_id_invalid");
      }
    }
    const savedSchedule = await client.query(
      `select id,day_of_week,slot_time,sort_order
         from publish_calendar_weekly_schedule_entries
        where brand_id=$1::uuid and workspace_id=$2::uuid
        order by day_of_week,sort_order,id`,
      [input.brandId, input.workspaceId],
    );
    return mapWeeklySettings(savedSettings.rows[0], input.brandId, savedSchedule.rows);
  });
}

async function setWeeklyEnabledTransaction(
  pool: Pool,
  input: BrandScope & { enabled: boolean },
): Promise<PublishCalendarWeeklySettingsDto> {
  return transaction(pool, async (client) => {
    await lockBrand(client, input.brandId);
    const settings = await client.query(
      `select enabled,channels,informational_format,trend_format,updated_at
         from publish_calendar_settings
        where brand_id=$1::uuid and workspace_id=$2::uuid
        for update`,
      [input.brandId, input.workspaceId],
    );
    const schedule = await client.query(
      `select id,day_of_week,slot_time,sort_order
         from publish_calendar_weekly_schedule_entries
        where brand_id=$1::uuid and workspace_id=$2::uuid
        order by day_of_week,sort_order,id
        for update`,
      [input.brandId, input.workspaceId],
    );
    if (input.enabled) {
      const selectedChannels = ((settings.rows[0]?.channels ?? []) as Channel[])
        .filter((channel) => SUPPORTED_CHANNELS.has(channel));
      if (schedule.rows.length === 0 || selectedChannels.length === 0) {
        throw new Error("publish_calendar_settings_incomplete");
      }
      const connected = await connectedCalendarChannels(client, input, selectedChannels);
      if (!selectedChannels.some((channel) => connected.has(channel))) {
        throw new Error("publish_calendar_settings_incomplete");
      }
    }
    const saved = await client.query(
      `insert into publish_calendar_settings(brand_id,workspace_id,enabled)
       values($1::uuid,$2::uuid,$3)
       on conflict(brand_id) do update set enabled=excluded.enabled,updated_at=now()
       where publish_calendar_settings.workspace_id=excluded.workspace_id
       returning enabled,channels,informational_format,trend_format,updated_at`,
      [input.brandId, input.workspaceId, input.enabled],
    );
    if (!saved.rowCount) throw new Error("publish_calendar_settings_invalid");
    return mapWeeklySettings(saved.rows[0], input.brandId, schedule.rows);
  });
}

export function createPublishCalendarRepository(
  pool: Pool,
  options: PublishCalendarRepositoryOptions = {},
): PublishCalendarRepository {
  const fencedPool = withAiContentTransactionFence(pool);
  const loadSlotById = async (input: BrandScope & { slotId: string }) => {
    const result = await pool.query(
      `select slot.*,queue_schedule.effective_scheduled_for
         from publish_calendar_slots slot
         left join lateral (
           select coalesce(
                    max(queue.published_at) filter (where queue.status='published'),
                    min(queue.scheduled_for) filter (where queue.status in ('scheduled','publishing','deferred'))
                  ) as effective_scheduled_for
             from publish_queue queue
            where queue.topic_publish_group_id=slot.topic_publish_group_id
         ) queue_schedule on true
        where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid and slot.id=$3::uuid`,
      [input.workspaceId, input.brandId, input.slotId],
    );
    return result.rowCount ? mapSlot(result.rows[0]) : null;
  };
  const loadWeeklyUsage = async (
    queryable: Pick<PoolClient, "query">,
    input: BrandScope & { at?: Date },
  ): Promise<PublishCalendarWeeklyUsageDto> => {
    const at = input.at ?? new Date();
    const { window, availability: publishing, generationLimit } = await subscriptionAndPublishUsage(queryable, input, at);
    const generated = await queryable.query(
      `with net as (
         select ledger.generation_id,sum(ledger.quantity)::integer quantity
           from ai_content_usage_ledger ledger
          where ledger.brand_id=$1::uuid and ledger.workspace_id=$2::uuid
            and ledger.usage_type in ('generation','reversal')
            and ledger.usage_date >= ($3::timestamptz at time zone 'Asia/Seoul')::date
            and ledger.usage_date < ($4::timestamptz at time zone 'Asia/Seoul')::date
          group by ledger.generation_id
       ) select
           coalesce(sum(net.quantity) filter (where generation.status in ('completed','partial_failed')),0)::integer succeeded_count,
           coalesce(sum(net.quantity) filter (
             where generation.status in ('draft','analyzing','analysis_ready','queued','planning','generating')
           ),0)::integer reserved_count
         from net join ai_content_generations generation on generation.id=net.generation_id`,
      [input.brandId, input.workspaceId, window.startsAt, window.endsAt],
    );
    return {
      startsAt: window.startsAt.toISOString(),
      endsAt: window.endsAt.toISOString(),
      generation: usageAvailability({
        limit: generationLimit,
        succeeded: Number(generated.rows[0]?.succeeded_count ?? 0),
        reserved: Number(generated.rows[0]?.reserved_count ?? 0),
      }),
      publishing,
    };
  };
  const validateManualProvisionInput = (input: ManualSlotProvisionInput) => {
    const channels = validateChannels([input.channel]);
    if (!Number.isFinite(input.scheduledFor.getTime())) throw new Error("publish_calendar_time_invalid");
    if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200) {
      throw new Error("publish_calendar_idempotency_key_invalid");
    }
    return channels;
  };
  const loadManualSlotReplay = async (
    client: PoolClient,
    input: PersistedManualSlotProvisionInput,
    channels: Channel[],
  ): Promise<PublishCalendarSlotDto | null> => {
    const replay = await client.query(
      `select slot.*,publish_group.content_topic_id as source_content_topic_id
         from publish_calendar_slots slot
         left join topic_publish_groups publish_group
           on publish_group.id=slot.topic_publish_group_id
          and publish_group.workspace_id=slot.workspace_id and publish_group.brand_id=slot.brand_id
        where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid
          and (
            slot.idempotency_key=$3::text
            or slot.idempotency_key=$4::text
            or slot.idempotency_key like $5::text
          )
        order by case
          when slot.idempotency_key=$3::text then 0
          when slot.idempotency_key=$4::text then 1
          else 2
        end
        for update of slot`,
      [input.workspaceId, input.brandId, input.requestIdentity.key,
        input.requestIdentity.legacyKey, `${input.requestIdentity.prefix}%`],
    );
    if (!replay.rowCount) return null;
    const row = replay.rows[0] as Record<string, unknown>;
    if (String(row.idempotency_key) !== input.requestIdentity.key
      && String(row.idempotency_key) !== input.requestIdentity.legacyKey) {
      throw new Error("publish_calendar_idempotency_conflict");
    }
    // Release A rows only stored the client-key digest. Their lineage comparison remains the
    // compatibility fallback; v2 rows additionally preserve the immutable request source.
    const sourceMatches = input.source.kind === "existing_content_topic"
      ? String(row.source_content_topic_id ?? "") === input.source.contentTopicId
      : input.source.kind === "existing_generation"
        ? String(row.generation_id ?? "") === input.source.generationId
        : String(row.generation_output_id ?? "") === input.source.generationOutputId;
    const matches = row.assignment_mode === "manual"
      && row.recommendation_kind == null
      && row.content_format === input.contentFormat
      && iso(row.scheduled_for) === input.scheduledFor.toISOString()
      && JSON.stringify(normalizeCalendarChannels((row.channels ?? []) as Channel[]))
        === JSON.stringify(channels)
      && sourceMatches;
    if (!matches) throw new Error("publish_calendar_idempotency_conflict");
    return mapSlot(row);
  };
  const provisionManualSlotLocked = async (
    client: PoolClient,
    input: PersistedManualSlotProvisionInput,
    replayChecked = false,
  ): Promise<{ slot: PublishCalendarSlotDto; replayed: boolean }> => {
    const channels = validateManualProvisionInput(input);
    if (!replayChecked) {
      const replay = await loadManualSlotReplay(client, input, channels);
      if (replay) return { slot: replay, replayed: true };
    }
    const future = await client.query(
      "select clock_timestamp() < $1::timestamptz as future",
      [input.scheduledFor],
    );
    if (future.rows[0]?.future !== true) throw new Error("publish_calendar_time_past");
    await assertConnectedChannels(client, input, channels);

    const lineage = input.source.kind === "existing_content_topic"
      ? await client.query(
          `select topic.id as content_topic_id,null::uuid as generation_id,
                  null::uuid as generation_output_id,topic.title,
                  case
                    when topic.selected_instagram_format='instagram_reel' then 'reel'
                    when topic.selected_instagram_format='instagram_feed_carousel' then 'card_news'
                  end as content_format
             from content_topics topic
            where topic.workspace_id=$1::uuid and topic.brand_id=$2::uuid
              and topic.id=$3::uuid and topic.status='selected'
              and case
                    when $4='reel' then topic.selected_instagram_format='instagram_reel'
                    when $4='card_news' then topic.selected_instagram_format='instagram_feed_carousel'
                    else false
                  end
            for update`,
          [input.workspaceId, input.brandId, input.source.contentTopicId, input.contentFormat],
        )
      : input.source.kind === "existing_generation"
        ? await client.query(
          `select generation.id as generation_id,null::uuid as generation_output_id,
                  null::uuid as topic_publish_group_id,generation.title,
                  generation.output_format as content_format
             from ai_content_generations generation
            where generation.workspace_id=$1::uuid and generation.brand_id=$2::uuid
              and generation.id=$3::uuid and generation.output_format=$4
              and generation.status in ('draft','analyzing','analysis_ready','queued','planning','generating')
            for key share`,
          [input.workspaceId, input.brandId, input.source.generationId, input.contentFormat],
        )
        : await client.query(
          `select generation.id as generation_id,output.id as generation_output_id,
                  null::uuid as topic_publish_group_id,
                  coalesce(nullif(output.title,''),generation.title) as title,
                  generation.output_format as content_format
             from ai_content_generation_outputs output
             join ai_content_generations generation
               on generation.id=output.generation_id
              and generation.workspace_id=output.workspace_id and generation.brand_id=output.brand_id
            where output.workspace_id=$1::uuid and output.brand_id=$2::uuid
              and output.id=$3::uuid and output.status='completed'
              and generation.output_format=$4
              and not exists (
                select 1 from channel_outputs channel_output
                join publish_queue queue on queue.channel_output_id=channel_output.id
                where channel_output.workspace_id=output.workspace_id
                  and channel_output.brand_id=output.brand_id
                  and channel_output.ai_content_generation_output_id=output.id
              )
            for key share of output,generation`,
          [input.workspaceId, input.brandId, input.source.generationOutputId, input.contentFormat],
        );
    if (!lineage.rowCount) throw new Error("publish_calendar_content_not_assignable");
    const resolved = lineage.rows[0] as Record<string, unknown>;
    if (input.source.kind === "existing_content_topic") {
      const publishGroup = await client.query(
        `insert into topic_publish_groups(workspace_id,brand_id,content_topic_id,status)
         values($1::uuid,$2::uuid,$3::uuid,'waiting')
         on conflict (content_topic_id) do update
           set content_topic_id=excluded.content_topic_id
         where topic_publish_groups.workspace_id=excluded.workspace_id
           and topic_publish_groups.brand_id=excluded.brand_id
           and topic_publish_groups.status='waiting'
         returning id,status`,
        [input.workspaceId, input.brandId, input.source.contentTopicId],
      );
      if (!publishGroup.rowCount) throw new Error("publish_calendar_content_not_assignable");
      resolved.topic_publish_group_id = publishGroup.rows[0]?.id;
    }
    const duplicate = input.source.kind === "existing_content_topic"
      ? await client.query(
          `select slot.id from publish_calendar_slots slot
            where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid and slot.status<>'cancelled'
              and slot.topic_publish_group_id=$3::uuid
            limit 1 for update`,
          [input.workspaceId, input.brandId, resolved.topic_publish_group_id],
        )
      : await client.query(
        `select slot.id from publish_calendar_slots slot
        where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid and slot.status<>'cancelled'
          and (slot.generation_id=$3::uuid and slot.generation_output_id is null and $4::uuid is null
            or (
              $4::uuid is not null
              and (
                slot.generation_output_id=$4::uuid
                or (slot.generation_id=$3::uuid and slot.generation_output_id is null)
              )
            )
          )
        limit 1 for update`,
      [input.workspaceId, input.brandId, resolved.generation_id, resolved.generation_output_id ?? null],
      );
    if (duplicate.rowCount) throw new Error("publish_calendar_content_already_scheduled");
    const { availability } = await subscriptionAndPublishUsage(client, input, input.scheduledFor);
    if (availability.additionalAvailable < 1) throw new Error("publish_weekly_quota_exceeded");
    const status = input.source.kind === "existing_content_topic"
      ? "generation_pending"
      : resolved.topic_publish_group_id ? "content_assigned" : "generation_pending";
    let result;
    try {
      result = await client.query(
        `insert into publish_calendar_slots(
           workspace_id,brand_id,scheduled_for,assignment_mode,status,recommendation_kind,
           content_format,channels,generation_id,generation_output_id,topic_publish_group_id,
           title,idempotency_key,created_by_user_id
         ) values($1::uuid,$2::uuid,$3::timestamptz,'manual',$12,null,
           $4,$5::text[],$6::uuid,$7::uuid,$8::uuid,$9,$10,$11::uuid)
         returning *`,
        [input.workspaceId, input.brandId, input.scheduledFor, input.contentFormat, channels,
          resolved.generation_id, resolved.generation_output_id ?? null,
          resolved.topic_publish_group_id ?? null, String(resolved.title), input.idempotencyKey,
          input.createdByUserId ?? null, status],
      );
    } catch (error) {
      if (isPreservedGenerationReservationConflict(error)) {
        throw new Error("publish_calendar_content_already_scheduled");
      }
      throw error;
    }
    return { slot: mapSlot(result.rows[0]), replayed: false };
  };
  return {
    async getManualOptions(scope) {
      const [channels, products, suggestions, references, usage] = await Promise.all([
        pool.query(
          `select channel from brand_channels
            where workspace_id=$1::uuid and brand_id=$2::uuid and deleted_at is null
              and enabled and status='connected' and channel='instagram'
            order by channel`,
          [scope.workspaceId, scope.brandId],
        ),
        pool.query(
          `select item.id, item.display_name as label
             from product_services item
             join product_service_versions version
               on version.id=item.active_version_id
              and version.product_service_id=item.id
              and version.workspace_id=item.workspace_id
              and version.brand_id=item.brand_id
              and version.status='approved'
            where item.workspace_id=$1::uuid and item.brand_id=$2::uuid and item.status='active'
            order by item.display_name,item.id`,
          [scope.workspaceId, scope.brandId],
        ),
        pool.query(
          `select suggestion.id,suggestion.title as label,suggestion.intent
             from content_suggestions suggestion
             join content_suggestion_batches batch on batch.id=suggestion.batch_id
             join brand_profiles profile
               on profile.workspace_id=$1::uuid and profile.brand_id=$2::uuid
              and profile.primary_category_id=batch.category_id
            where batch.id=(
              select latest.id from content_suggestion_batches latest
               where latest.category_id=profile.primary_category_id
               order by latest.generation_date desc,latest.published_at desc,latest.id desc
               limit 1
            )
            order by suggestion.position,suggestion.id`,
          [scope.workspaceId, scope.brandId],
        ),
        pool.query(
          `select item.id,coalesce(nullif(item.title,''),'이름 없는 레퍼런스') as label
             from reference_items item
            where item.workspace_id=$1::uuid and item.brand_id=$2::uuid and item.archived_at is null
            order by item.created_at desc,item.id`,
          [scope.workspaceId, scope.brandId],
        ),
        loadWeeklyUsage(pool, scope),
      ]);
      return {
        purposes: [
          { value: "informational", label: "정보성" },
          { value: "marketing", label: "마케팅성" },
        ],
        subjectModes: [
          { value: "topic_text", label: "직접 입력", requiredField: "topicText" },
          { value: "topic_url", label: "URL", requiredField: "topicUrl" },
          { value: "suggestion", label: "오늘의 주제", requiredField: "contentSuggestionId" },
          { value: "reference", label: "레퍼런스", requiredField: "referenceId" },
        ],
        channels: channels.rows.map(() => ({
          value: "instagram" as const,
          label: "Instagram",
          formats: [
            { value: "card_news" as const, label: "카드뉴스" },
            { value: "reel" as const, label: "릴스" },
          ],
        })),
        products: products.rows.map((row) => ({ value: String(row.id), label: String(row.label) })),
        suggestions: suggestions.rows.map((row) => ({
          value: String(row.id),
          label: String(row.label),
          intent: row.intent as "informational" | "trend",
        })),
        references: references.rows.map((row) => ({ value: String(row.id), label: String(row.label) })),
        usage,
      };
    },

    async listManualContentCandidates(input) {
      if (input.kind === "generating") {
        const result = await pool.query(
          `select generation.id as generation_id,null::uuid as generation_output_id,
                  null::uuid as topic_publish_group_id,generation.title,
                  generation.output_format as content_format,generation.status,generation.created_at,
                  case when active_slot.id is not null then 'already_scheduled' end as blocked_reason
             from ai_content_generations generation
             left join lateral (
               select slot.id from publish_calendar_slots slot
                where slot.workspace_id=generation.workspace_id and slot.brand_id=generation.brand_id
                  and slot.generation_id=generation.id and slot.status<>'cancelled'
                order by slot.scheduled_for,slot.id limit 1
             ) active_slot on true
            where generation.workspace_id=$1::uuid and generation.brand_id=$2::uuid
              and generation.status in ('draft','analyzing','analysis_ready','queued','planning','generating')
              and generation.output_format in ('card_news','reel')
            order by generation.created_at desc,generation.id`,
          [input.workspaceId, input.brandId],
        );
        return result.rows.map((row) => mapContentCandidate(row, input.kind));
      }
      const result = await pool.query(
        `select generation.id as generation_id,output.id as generation_output_id,
                queue_context.topic_publish_group_id,
                coalesce(nullif(output.title,''),generation.title) as title,
                generation.output_format as content_format,output.status,output.created_at,
                case
                  when active_slot.id is not null then 'already_scheduled'
                  when queue_context.has_published then 'already_published'
                  when queue_context.has_any then 'already_scheduled'
                end as blocked_reason
           from ai_content_generation_outputs output
           join ai_content_generations generation
             on generation.id=output.generation_id
            and generation.workspace_id=output.workspace_id and generation.brand_id=output.brand_id
           left join lateral (
             select slot.id from publish_calendar_slots slot
              where slot.workspace_id=output.workspace_id and slot.brand_id=output.brand_id
                and slot.generation_output_id=output.id and slot.status<>'cancelled'
              order by slot.scheduled_for,slot.id limit 1
           ) active_slot on true
           left join lateral (
             select min(queue.topic_publish_group_id::text)::uuid as topic_publish_group_id,
                    count(*) > 0 as has_any,
                    bool_or(queue.status='published') as has_published
               from channel_outputs channel_output
               join publish_queue queue on queue.channel_output_id=channel_output.id
              where channel_output.workspace_id=output.workspace_id
                and channel_output.brand_id=output.brand_id
                and channel_output.ai_content_generation_output_id=output.id
           ) queue_context on true
          where generation.workspace_id=$1::uuid and generation.brand_id=$2::uuid
            and generation.output_format in ('card_news','reel') and output.status='completed'
          order by output.created_at desc,output.id`,
        [input.workspaceId, input.brandId],
      );
      return result.rows.map((row) => mapContentCandidate(row, input.kind));
    },

    async provisionManualSlot(input) {
      validateManualProvisionInput(input);
      const requestIdentity = manualSlotIdentity(input.idempotencyKey, input.source);
      const persistedInput: PersistedManualSlotProvisionInput = {
        ...input,
        idempotencyKey: requestIdentity.key,
        requestIdentity,
      };
      const result = await transaction(fencedPool, async (client) => {
        await lockBrand(client, input.brandId);
        return provisionManualSlotLocked(client, persistedInput);
      });
      const { slot } = result;
      if (input.source.kind === "existing_output" && slot.generationId) {
        await options.afterManualSlotProvisioned?.({
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          generationId: slot.generationId,
          outputId: input.source.generationOutputId,
        });
        return await loadSlotById({
          workspaceId: input.workspaceId,
          brandId: input.brandId,
          slotId: slot.id,
        }) ?? slot;
      }
      return slot;
    },

    async provisionManualSlotsBatch(input) {
      if (!input.idempotencyKey.trim() || input.idempotencyKey.length > 200
        || !Array.isArray(input.rows) || input.rows.length < 1 || input.rows.length > 50) {
        throw new Error("publish_calendar_batch_invalid");
      }
      const normalizedRowIds = input.rows.map(({ clientRowId }) => clientRowId.trim());
      const rowIds = new Set(normalizedRowIds);
      if (rowIds.size !== input.rows.length || normalizedRowIds.some((value) => !value || value.length > 100)) {
        throw new Error("publish_calendar_batch_invalid");
      }
      const rows = input.rows.map((row, index) => {
        const requestIdentity = batchSlotIdentity(
          input.idempotencyKey,
          normalizedRowIds[index],
          row.source,
        );
        return {
          ...input,
          ...row,
          clientRowId: normalizedRowIds[index],
          idempotencyKey: requestIdentity.key,
          requestIdentity,
          createdByUserId: input.createdByUserId ?? null,
        } satisfies PersistedManualSlotProvisionInput & { clientRowId: string };
      });
      rows.forEach(validateManualProvisionInput);
      const results = await transaction(fencedPool, async (client) => {
        await lockBrand(client, input.brandId);
        const replays: Array<PublishCalendarSlotDto | null> = [];
        for (const row of rows) {
          replays.push(await loadManualSlotReplay(client, row, validateChannels([row.channel])));
        }
        const unstartedGenerationIds = [...new Set(rows.flatMap((row, index) => (
          !replays[index] && row.source.kind === "existing_generation" ? [row.source.generationId] : []
        )))];
        if (unstartedGenerationIds.length > 0) {
          const unstarted = await client.query(
            `select count(*)::integer count
               from ai_content_generations generation
              where generation.workspace_id=$1::uuid and generation.brand_id=$2::uuid
                and generation.id=any($3::uuid[]) and generation.status='draft'`,
            [input.workspaceId, input.brandId, unstartedGenerationIds],
          );
          const unstartedCount = Number(unstarted.rows[0]?.count ?? 0);
          if (unstartedCount > 0) {
            const usage = await loadWeeklyUsage(client, input);
            if (unstartedCount > usage.generation.additionalAvailable) {
              throw new Error("publish_calendar_generation_quota_exceeded");
            }
          }
        }
        const provisioned: Array<{ slot: PublishCalendarSlotDto; replayed: boolean }> = [];
        for (let index = 0; index < rows.length; index += 1) {
          provisioned.push(replays[index]
            ? { slot: replays[index]!, replayed: true }
            : await provisionManualSlotLocked(client, rows[index], true));
        }
        return provisioned;
      });
      const slots = results.map(({ slot }) => slot);
      for (let index = 0; index < rows.length; index += 1) {
        const row = rows[index];
        const slot = slots[index];
        if (row.source.kind === "existing_output" && slot?.generationId) {
          await options.afterManualSlotProvisioned?.({
            workspaceId: input.workspaceId,
            brandId: input.brandId,
            generationId: slot.generationId,
            outputId: row.source.generationOutputId,
          });
          slots[index] = await loadSlotById({
            workspaceId: input.workspaceId,
            brandId: input.brandId,
            slotId: slot.id,
          }) ?? slot;
        }
      }
      return slots;
    },

    async getSettings(scope) {
      const result = await pool.query(
        "select * from publish_calendar_settings where brand_id=$1::uuid and workspace_id=$2::uuid",
        [scope.brandId, scope.workspaceId],
      );
      return mapSettings(result.rows[0], scope.brandId);
    },

    async saveSettings(input) {
      const channels = validateChannels(input.channels);
      if (input.enabled && channels.length === 0) throw new Error("publish_calendar_channel_invalid");
      const slotTimes = validateSlotTimes(input.slotTimes);
      return transaction(fencedPool, async (client) => {
        if (input.enabled) await assertConnectedChannels(client, input, channels);
        const result = await client.query(
          `insert into publish_calendar_settings(
             brand_id,workspace_id,enabled,channels,informational_format,trend_format,slot_times
           ) values($1::uuid,$2::uuid,$3,$4::text[],$5,$6,$7::time[])
           on conflict(brand_id) do update set
             workspace_id=excluded.workspace_id,enabled=excluded.enabled,channels=excluded.channels,
             informational_format=excluded.informational_format,trend_format=excluded.trend_format,
             slot_times=excluded.slot_times,updated_at=now()
           returning *`,
          [input.brandId, input.workspaceId, input.enabled, channels,
            input.informationalFormat, input.trendFormat, slotTimes],
        );
        return mapSettings(result.rows[0], input.brandId);
      });
    },

    async getWeeklySettings(scope) {
      return transaction(pool, async (client) => {
        await lockBrand(client, scope.brandId);
        const settings = await client.query(
          `select enabled,channels,informational_format,trend_format,updated_at
             from publish_calendar_settings
            where brand_id=$1::uuid and workspace_id=$2::uuid`,
          [scope.brandId, scope.workspaceId],
        );
        const schedule = await client.query(
          `select id,day_of_week,slot_time,sort_order
             from publish_calendar_weekly_schedule_entries
            where brand_id=$1::uuid and workspace_id=$2::uuid
            order by day_of_week,sort_order,id`,
          [scope.brandId, scope.workspaceId],
        );
        return mapWeeklySettings(settings.rows[0], scope.brandId, schedule.rows);
      });
    },

    async saveWeeklySettings(input) {
      return saveWeeklySettingsTransaction(fencedPool, input, input.enabled);
    },

    async saveWeeklyConfiguration(input) {
      return saveWeeklySettingsTransaction(fencedPool, input, null);
    },

    async setWeeklyEnabled(input) {
      return setWeeklyEnabledTransaction(fencedPool, input);
    },

    async listSlots(input) {
      if (!Number.isFinite(input.startsAt.getTime()) || !Number.isFinite(input.endsAt.getTime())
        || input.startsAt >= input.endsAt) throw new Error("publish_calendar_period_invalid");
      const result = await pool.query(
        `select slot.*,queue_schedule.effective_scheduled_for
           from publish_calendar_slots slot
           left join lateral (
             select coalesce(
                      max(queue.published_at) filter (where queue.status='published'),
                      min(queue.scheduled_for) filter (where queue.status in ('scheduled','publishing','deferred'))
                    ) as effective_scheduled_for
               from publish_queue queue
              where queue.topic_publish_group_id=slot.topic_publish_group_id
           ) queue_schedule on true
          where slot.brand_id=$1::uuid and slot.workspace_id=$2::uuid
            and slot.scheduled_for >= $3::timestamptz and slot.scheduled_for < $4::timestamptz
          order by slot.scheduled_for,slot.id`,
        [input.brandId, input.workspaceId, input.startsAt, input.endsAt],
      );
      return result.rows.map(mapSlot);
    },

    async createSlot(input) {
      const channels = validateChannels(input.channels);
      const idempotencyKey = input.idempotencyKey;
      if (input.assignmentMode !== "automatic"
        || !/^[0-9a-f]{64}$/.test(idempotencyKey)) {
        throw new Error("publish_calendar_idempotency_key_invalid");
      }
      if (!Number.isFinite(input.scheduledFor.getTime())) throw new Error("publish_calendar_time_invalid");
      return transaction(fencedPool, async (client) => {
        await lockBrand(client, input.brandId);
        const replay = await client.query(
          `select slot.* from publish_calendar_slots slot
            where slot.workspace_id=$1::uuid and slot.brand_id=$2::uuid
              and slot.idempotency_key=$3::text
            for update`,
          [input.workspaceId, input.brandId, idempotencyKey],
        );
        if (replay.rowCount) return { status: "existing", slot: mapSlot(replay.rows[0]) };
        const future = await client.query(
          "select clock_timestamp() < $1::timestamptz as future",
          [input.scheduledFor],
        );
        if (future.rows[0]?.future !== true) throw new Error("publish_calendar_time_past");
        await assertConnectedChannels(client, input, channels);
        const { availability } = await subscriptionAndPublishUsage(client, input, input.scheduledFor);
        if (availability.additionalAvailable < 1) {
          return { status: "quota_exhausted", slot: null };
        }
        const result = await client.query(
          `insert into publish_calendar_slots(
             workspace_id,brand_id,scheduled_for,assignment_mode,status,recommendation_kind,
             content_format,channels,created_by_user_id,idempotency_key
           ) values($1::uuid,$2::uuid,$3::timestamptz,$4,'open',$5,$6,$7::text[],$8::uuid,$9)
           on conflict(brand_id,idempotency_key) where idempotency_key is not null
           do update set updated_at=publish_calendar_slots.updated_at
           returning *`,
          [input.workspaceId, input.brandId, input.scheduledFor, input.assignmentMode,
            input.recommendationKind, input.contentFormat, channels,
            input.createdByUserId ?? null, idempotencyKey],
        );
        return { status: "created", slot: mapSlot(result.rows[0]) };
      });
    },

    async provisionAutomaticOccurrences(input) {
      const occurrences = normalizeAutomaticOccurrences(input.occurrences);
      if (occurrences.length === 0) return [];
      return transaction(fencedPool, async (client) => {
        await lockBrand(client, input.brandId);
        const evaluated = await evaluateAutomaticOccurrences(client, input, occurrences, true);
        const planned = planAutomaticOccurrences(evaluated);
        const results: AutomaticOccurrenceResult[] = [];
        for (const item of planned) {
          if (item.status === "existing") {
            results.push({
              idempotencyKey: item.occurrence.idempotencyKey,
              status: "existing",
              slot: item.slot,
            });
            continue;
          }
          if (item.status === "subscription_ineligible") {
            results.push({
              idempotencyKey: item.occurrence.idempotencyKey,
              status: "subscription_ineligible",
              slot: null,
            });
            continue;
          }
          if (item.status === "quota_blocked") {
            results.push({
              idempotencyKey: item.occurrence.idempotencyKey,
              status: "quota_exhausted",
              slot: null,
            });
            continue;
          }
          const inserted = await client.query(
            `insert into publish_calendar_slots(
               workspace_id,brand_id,scheduled_for,assignment_mode,status,recommendation_kind,
               content_format,channels,created_by_user_id,idempotency_key
             ) values($1::uuid,$2::uuid,$3::timestamptz,'automatic','open',$4,$5,$6::text[],null,$7)
             on conflict(brand_id,idempotency_key) where idempotency_key is not null
             do update set updated_at=publish_calendar_slots.updated_at
             returning *`,
            [input.workspaceId, input.brandId, item.occurrence.scheduledFor,
              item.occurrence.recommendationKind, item.contentFormat,
              evaluated.channels, item.occurrence.idempotencyKey],
          );
          results.push({
            idempotencyKey: item.occurrence.idempotencyKey,
            status: "created",
            slot: mapSlot(inserted.rows[0]),
          });
        }
        return results;
      });
    },

    async previewAutomaticOccurrences(input) {
      const occurrences = normalizeAutomaticOccurrences(input.occurrences);
      if (occurrences.length === 0) return [];
      const evaluated = await evaluateAutomaticOccurrences(pool, input, occurrences, false);
      return planAutomaticOccurrences(evaluated).map((item): AutomaticOccurrencePreviewResult => {
        if (item.status === "existing") {
          return { idempotencyKey: item.occurrence.idempotencyKey, status: "existing", slot: item.slot };
        }
        return {
          idempotencyKey: item.occurrence.idempotencyKey,
          status: item.status,
          slot: null,
        };
      });
    },

    async assignSlot(input) {
      if (![input.contentSuggestionId, input.proposalId, input.generationId,
        input.generationOutputId, input.topicPublishGroupId].some(Boolean)) {
        throw new Error("publish_calendar_assignment_missing");
      }
      return transaction(fencedPool, async (client) => {
        await lockBrand(client, input.brandId);
        const existing = await client.query(
          `select slot.* from publish_calendar_slots slot
            where slot.id=$1::uuid and slot.brand_id=$2::uuid and slot.workspace_id=$3::uuid
            for update`,
          [input.slotId, input.brandId, input.workspaceId],
        );
        if (!existing.rowCount) throw new Error("publish_calendar_slot_not_found");
        const existingRow = existing.rows[0];
        if (["content_assigned", "ready", "scheduled", "publish_delayed", "published", "cancelled"]
          .includes(String(existingRow.status))) {
          throw new Error("publish_calendar_slot_not_assignable");
        }
        const lineage = {
          contentSuggestionId: [existingRow.content_suggestion_id, input.contentSuggestionId] as const,
          proposalId: [existingRow.proposal_id, input.proposalId] as const,
          generationId: [existingRow.generation_id, input.generationId] as const,
          generationOutputId: [existingRow.generation_output_id, input.generationOutputId] as const,
          topicPublishGroupId: [existingRow.topic_publish_group_id, input.topicPublishGroupId] as const,
        };
        for (const [stored, incoming] of Object.values(lineage)) {
          if (stored && incoming && String(stored) !== incoming) {
            throw new Error("publish_calendar_assignment_lineage_conflict");
          }
        }
        const effective = Object.fromEntries(Object.entries(lineage).map(([key, [stored, incoming]]) => [
          key,
          incoming ?? (stored ? String(stored) : null),
        ])) as Record<keyof typeof lineage, string | null>;
        if (new Date(existingRow.scheduled_for) <= new Date()) throw new Error("publish_calendar_time_past");
        if (effective.generationOutputId && !effective.generationId) {
          const outputParent = await client.query(
            `select output.generation_id
               from ai_content_generation_outputs output
              where output.id=$1::uuid and output.workspace_id=$2::uuid and output.brand_id=$3::uuid
              for key share`,
            [effective.generationOutputId, input.workspaceId, input.brandId],
          );
          if (!outputParent.rowCount) throw new Error("publish_calendar_assignment_scope_invalid");
          effective.generationId = String(outputParent.rows[0].generation_id);
        }
        const channels = validateChannels(existingRow.channels as Channel[]);
        await assertConnectedChannels(client, input, channels);

        const ownership = await client.query(
          `select (
             ($3::uuid is null or exists (
               select 1 from content_suggestions suggestion
               join content_suggestion_batches batch on batch.id=suggestion.batch_id
               join brand_profiles profile
                 on profile.brand_id=$2::uuid and profile.workspace_id=$1::uuid
                and batch.category_id=profile.primary_category_id
               join content_categories category on category.id=profile.primary_category_id and category.active
               where suggestion.id=$3::uuid
                 and suggestion.category_id=batch.category_id
                 and batch.id=(
                   select latest.id from content_suggestion_batches latest
                    where latest.category_id=profile.primary_category_id
                    order by latest.generation_date desc,latest.published_at desc,latest.id desc
                    limit 1
                 )
             )) and ($4::uuid is null or exists (
               select 1 from ai_content_proposals proposal
                where proposal.id=$4::uuid and proposal.brand_id=$2::uuid and proposal.workspace_id=$1::uuid
                  and proposal.proposal_json->>'outputFormat'=$9
                  and ($5::uuid is null or proposal.generation_id=$5::uuid)
             )) and ($5::uuid is null or exists (
               select 1 from ai_content_generations generation
                where generation.id=$5::uuid and generation.brand_id=$2::uuid and generation.workspace_id=$1::uuid
                  and generation.output_format=$9
             )) and ($6::uuid is null or exists (
               select 1 from ai_content_generation_outputs output
               join ai_content_generations generation
                 on generation.id=output.generation_id
                and generation.workspace_id=output.workspace_id and generation.brand_id=output.brand_id
                where output.id=$6::uuid and output.brand_id=$2::uuid and output.workspace_id=$1::uuid
                  and generation.output_format=$9
                  and ($5::uuid is null or generation.id=$5::uuid)
                  and ($4::uuid is null or exists (
                    select 1 from ai_content_proposals output_proposal
                     where output_proposal.id=$4::uuid
                       and output_proposal.workspace_id=output.workspace_id
                       and output_proposal.brand_id=output.brand_id
                       and output_proposal.generation_id=output.generation_id
                  ))
             )) and ($7::uuid is null or exists (
               select 1 from topic_publish_groups publish_group
                where publish_group.id=$7::uuid
                  and publish_group.brand_id=$2::uuid and publish_group.workspace_id=$1::uuid
             )) and ($7::uuid is null or (
               not exists (
                 select 1 from publish_queue queue
                  where queue.topic_publish_group_id=$7::uuid
                    and not (queue.channel=any($8::text[]))
               ) and not exists (
                 select requested.channel from unnest($8::text[]) requested(channel)
                 except select distinct queue.channel from publish_queue queue
                  where queue.topic_publish_group_id=$7::uuid
               ) and not exists (
                 select 1 from publish_queue queue
                 join channel_outputs output on output.id=queue.channel_output_id
                 where queue.topic_publish_group_id=$7::uuid
                   and not (
                     ($9='reel' and output.delivery_format in ('instagram_reel','tiktok_video','youtube_video','youtube_short'))
                     or ($9='card_news' and output.delivery_format in (
                       'instagram_feed_single','instagram_feed_carousel','instagram_story',
                       'threads_text','x_post','linkedin_post'
                     ))
                   )
               )
             ))
           ) assignment_scope_valid /* assignment_channels_and_format_valid */`,
          [input.workspaceId, input.brandId, effective.contentSuggestionId, effective.proposalId,
            effective.generationId, effective.generationOutputId, effective.topicPublishGroupId,
            channels, existingRow.content_format],
        );
        if (ownership.rows[0]?.assignment_scope_valid !== true) {
          throw new Error("publish_calendar_assignment_scope_invalid");
        }

        const { availability } = await subscriptionAndPublishUsage(
          client,
          input,
          new Date(existingRow.scheduled_for),
          input.slotId,
        );
        const assignableStatus = effective.topicPublishGroupId
          ? "content_assigned"
          : effective.generationId || effective.generationOutputId ? "generation_pending" : "proposal_assigned";
        const status = availability.additionalAvailable > 0 ? assignableStatus : "quota_blocked";
        const assignmentMode = existingRow.status === "open"
          ? input.assignmentMode
          : existingRow.assignment_mode as AssignmentMode;
        const result = await client.query(
          `update publish_calendar_slots set
             assignment_mode=$4,status=$5,content_suggestion_id=$6::uuid,
             proposal_id=$7::uuid,generation_id=$8::uuid,
             generation_output_id=$9::uuid,topic_publish_group_id=$10::uuid,
             title=$11,
             last_error=case when $5='quota_blocked' then 'publish_weekly_quota_exceeded' else null end,
             updated_at=now()
           where id=$1::uuid and brand_id=$2::uuid and workspace_id=$3::uuid
           returning *`,
          [input.slotId, input.brandId, input.workspaceId, assignmentMode, status,
            effective.contentSuggestionId, effective.proposalId, effective.generationId,
            effective.generationOutputId, effective.topicPublishGroupId,
            input.title ?? (existingRow.title ? String(existingRow.title) : null)],
        );
        return mapSlot(result.rows[0]);
      });
    },

    async rescheduleSlot(input) {
      if (!Number.isFinite(input.scheduledFor.getTime())) {
        throw new Error("publish_calendar_time_invalid");
      }
      return transaction(fencedPool, async (client) => {
        await lockBrand(client, input.brandId);
        const existing = await client.query(
          `select slot.* from publish_calendar_slots slot
            where slot.id=$1::uuid and slot.brand_id=$2::uuid and slot.workspace_id=$3::uuid
            for update`,
          [input.slotId, input.brandId, input.workspaceId],
        );
        if (!existing.rowCount) throw new Error("publish_calendar_slot_not_found");
        const existingRow = existing.rows[0];
        if (!["open", "proposal_assigned", "generation_pending", "content_assigned", "ready",
          "scheduled", "publish_delayed", "quota_blocked"].includes(String(existingRow.status))) {
          throw new Error("publish_calendar_slot_not_reschedulable");
        }
        const future = await client.query(
          "select clock_timestamp() < $1::timestamptz as future",
          [input.scheduledFor],
        );
        if (future.rows[0]?.future !== true) throw new Error("publish_calendar_time_past");

        const publishGroupId = existingRow.topic_publish_group_id
          ? String(existingRow.topic_publish_group_id)
          : null;
        let scheduledLineage = false;
        if (publishGroupId) {
          const publishGroup = await client.query(
            `select publish_group.status from topic_publish_groups publish_group
              where publish_group.id=$1::uuid and publish_group.brand_id=$2::uuid
                and publish_group.workspace_id=$3::uuid
              for update`,
            [publishGroupId, input.brandId, input.workspaceId],
          );
          if (!publishGroup.rowCount
            || !["waiting", "ready", "scheduled"].includes(String(publishGroup.rows[0].status))) {
            throw new Error("publish_calendar_slot_not_reschedulable");
          }
          const queue = await client.query(
            `select queue.status from publish_queue queue
              where queue.topic_publish_group_id=$1::uuid
                and queue.brand_id=$2::uuid and queue.workspace_id=$3::uuid
              order by queue.id
              for update`,
            [publishGroupId, input.brandId, input.workspaceId],
          );
          const queueStatuses = queue.rows.map((row) => String(row.status));
          if (queueStatuses.some((status) => !["queued", "scheduled"].includes(status))) {
            throw new Error("publish_calendar_slot_not_reschedulable");
          }
          scheduledLineage = String(publishGroup.rows[0].status) === "scheduled";
          if (scheduledLineage
            && (String(existingRow.status) !== "scheduled"
              || queueStatuses.length === 0
              || queueStatuses.some((status) => status !== "scheduled"))) {
            throw new Error("publish_calendar_slot_not_reschedulable");
          }
          if (!scheduledLineage && queueStatuses.some((status) => status === "scheduled")) {
            throw new Error("publish_calendar_slot_not_reschedulable");
          }
        } else if (String(existingRow.status) === "scheduled") {
          throw new Error("publish_calendar_slot_not_reschedulable");
        }

        const { availability } = await subscriptionAndPublishUsage(
          client,
          input,
          input.scheduledFor,
          input.slotId,
        );
        if (availability.additionalAvailable < 1) {
          throw new Error("publish_weekly_quota_exceeded");
        }

        if (scheduledLineage && publishGroupId) {
          const group = await client.query(
            `update topic_publish_groups set
                scheduled_for=$4::timestamptz,
                slot_date=($4::timestamptz at time zone 'Asia/Seoul')::date,
                slot_number=null,updated_at=now()
              where id=$1::uuid and brand_id=$2::uuid and workspace_id=$3::uuid
                and status='scheduled'`,
            [publishGroupId, input.brandId, input.workspaceId, input.scheduledFor],
          );
          const queue = await client.query(
            `update publish_queue set
                scheduled_for=$4::timestamptz,
                slot_date=($4::timestamptz at time zone 'Asia/Seoul')::date,
                slot_number=null,updated_at=now()
              where topic_publish_group_id=$1::uuid and brand_id=$2::uuid and workspace_id=$3::uuid
                and status='scheduled'`,
            [publishGroupId, input.brandId, input.workspaceId, input.scheduledFor],
          );
          if (!group.rowCount || !queue.rowCount) {
            throw new Error("publish_calendar_slot_not_reschedulable");
          }
        }

        const result = await client.query(
          `update publish_calendar_slots set
              scheduled_for=$4::timestamptz,assignment_mode='manual',recommendation_kind=null,updated_at=now()
            where id=$1::uuid and brand_id=$2::uuid and workspace_id=$3::uuid
            returning *`,
          [input.slotId, input.brandId, input.workspaceId, input.scheduledFor],
        );
        if (!result.rowCount) throw new Error("publish_calendar_slot_not_reschedulable");
        return mapSlot(result.rows[0]);
      });
    },

    async cancelSlot(input) {
      return transaction(fencedPool, async (client) => {
        await lockBrand(client, input.brandId);
        const existing = await client.query(
          `select slot.* from publish_calendar_slots slot
            where slot.id=$1::uuid and slot.brand_id=$2::uuid and slot.workspace_id=$3::uuid
            for update`,
          [input.slotId, input.brandId, input.workspaceId],
        );
        if (!existing.rowCount) throw new Error("publish_calendar_slot_not_found");
        if (existing.rows[0].status === "cancelled") return mapSlot(existing.rows[0]);
        if (existing.rows[0].status === "published") throw new Error("publish_calendar_slot_not_cancellable");
        const publishGroupId = existing.rows[0].topic_publish_group_id
          ? String(existing.rows[0].topic_publish_group_id)
          : null;
        if (publishGroupId) {
          await client.query(
            `update publish_queue set status='cancelled',slot_date=null,slot_number=null,
                scheduled_for=null,deferred_until=null,failed_at=null,last_error=null,updated_at=now()
              where topic_publish_group_id=$1::uuid
                and status in ('queued','scheduled','deferred','failed')`,
            [publishGroupId],
          );
          const irreversible = await client.query(
            `select 1 from publish_queue
              where topic_publish_group_id=$1::uuid and status in ('publishing','published')
              limit 1 for update`,
            [publishGroupId],
          );
          if (irreversible.rowCount) throw new Error("publish_calendar_slot_not_cancellable");
          await client.query(
            `update topic_publish_groups set status='cancelled',slot_date=null,slot_number=null,
                scheduled_for=null,updated_at=now()
              where id=$1::uuid and brand_id=$2::uuid and workspace_id=$3::uuid`,
            [publishGroupId, input.brandId, input.workspaceId],
          );
        }
        const result = await client.query(
          `update publish_calendar_slots set status='cancelled',last_error=null,updated_at=now()
            where id=$1::uuid and brand_id=$2::uuid and workspace_id=$3::uuid
              and status not in ('published','cancelled') returning *`,
          [input.slotId, input.brandId, input.workspaceId],
        );
        if (!result.rowCount) throw new Error("publish_calendar_slot_not_cancellable");
        return mapSlot(result.rows[0]);
      });
    },

    async getWeeklyUsage(input) {
      return loadWeeklyUsage(pool, input);
    },

    async applyDueSubscriptionRenewals(now = new Date()) {
      if (!Number.isFinite(now.getTime())) throw new Error("subscription_renewal_date_invalid");
      return transaction(fencedPool, async (client) => {
        const due = await loadDueSubscriptionRenewalRows(client, now, true);
        const renewals: AppliedSubscriptionRenewal[] = [];
        for (const row of due) {
          const previousPlanCode = String(row.plan_code);
          await client.query("savepoint publish_calendar_renewal_brand");
          try {
            const projection = projectSubscriptionRenewal(row, now);
            const status = projection.cancelled ? "cancelled" : "active";
            const updated = await client.query(
              `update brand_subscriptions set
                  plan_code=$2,pending_plan_code=null,current_period_start=$3::timestamptz,
                  current_period_end=$4::timestamptz,status=$5,cancel_at_period_end=false,updated_at=now()
                where brand_id=$1::uuid`,
              [row.brand_id, projection.planCode, projection.currentPeriodStart.toISOString(),
                projection.currentPeriodEnd.toISOString(), status],
            );
            if (!updated.rowCount) throw new Error("subscription_renewal_update_conflict");
            await client.query("release savepoint publish_calendar_renewal_brand");
            renewals.push(projection);
          } catch (error) {
            await client.query("rollback to savepoint publish_calendar_renewal_brand");
            await client.query("release savepoint publish_calendar_renewal_brand");
            renewals.push({
              status: "failed",
              brandId: String(row.brand_id),
              previousPlanCode,
              errorCode: error instanceof Error ? error.message : "subscription_renewal_failed",
            });
          }
        }
        return renewals;
      });
    },

    async previewDueSubscriptionRenewals(now = new Date()) {
      if (!Number.isFinite(now.getTime())) throw new Error("subscription_renewal_date_invalid");
      return previewSubscriptionRenewals(
        await loadDueSubscriptionRenewalRows(pool, now, false),
        now,
      );
    },
  };
}
