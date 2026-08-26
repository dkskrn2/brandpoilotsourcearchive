import type { Pool } from "pg";
import { automaticSlotKey } from "./publishCalendarIdempotency.js";
import type {
  AutomaticOccurrenceInput,
  PublishCalendarRepository,
} from "./publishCalendarRepository.js";
import type { Channel, PublishCalendarWeeklySettingsDto } from "./types.js";

const KST_OFFSET_MILLISECONDS = 9 * 60 * 60 * 1_000;
const DAY_MILLISECONDS = 24 * 60 * 60 * 1_000;
const SUPPORTED_AUTOMATIC_CHANNELS: Channel[] = ["instagram"];

export interface AutomaticCalendarBrand {
  workspaceId: string;
  brandId: string;
  settings: PublishCalendarWeeklySettingsDto;
}

export interface ScheduledRecommendation {
  id: string;
  title: string;
  intent: "informational" | "trend";
  createdAt: string;
}

export type PublishCalendarAllocatorDependencies = Pick<
  PublishCalendarRepository,
  "listSlots" | "provisionAutomaticOccurrences" | "assignSlot" | "applyDueSubscriptionRenewals"
> & {
  listEnabledBrands(at: Date): Promise<AutomaticCalendarBrand[]>;
  listUnassignedRecommendations(brand: AutomaticCalendarBrand): Promise<ScheduledRecommendation[]>;
};

export function classifySuggestion(
  suggestion: Pick<ScheduledRecommendation, "intent">,
): "informational" | "trend" {
  return suggestion.intent;
}

function kstDayStart(now: Date): Date {
  if (!Number.isFinite(now.getTime())) throw new Error("publish_calendar_allocation_date_invalid");
  const shifted = new Date(now.getTime() + KST_OFFSET_MILLISECONDS);
  return new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate())
    - KST_OFFSET_MILLISECONDS);
}

function scheduledInstant(dayStart: Date, dayOffset: number, value: string): Date {
  const match = value.match(/^(\d{2}):(\d{2})$/);
  if (!match) throw new Error("publish_calendar_time_invalid");
  return new Date(dayStart.getTime() + dayOffset * DAY_MILLISECONDS
    + Number(match[1]) * 60 * 60 * 1_000 + Number(match[2]) * 60 * 1_000);
}

function kstDateKey(value: Date): string {
  const shifted = new Date(value.getTime() + KST_OFFSET_MILLISECONDS);
  return [
    shifted.getUTCFullYear(),
    String(shifted.getUTCMonth() + 1).padStart(2, "0"),
    String(shifted.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function kstIsoWeekday(value: Date): 1 | 2 | 3 | 4 | 5 | 6 | 7 {
  const shifted = new Date(value.getTime() + KST_OFFSET_MILLISECONDS);
  return (shifted.getUTCDay() || 7) as 1 | 2 | 3 | 4 | 5 | 6 | 7;
}

export function createPublishCalendarAllocator(dependencies: PublishCalendarAllocatorDependencies) {
  async function allocateBrand(brand: AutomaticCalendarBrand, now = new Date()) {
    if (!brand.settings.enabled || brand.settings.channels.length === 0) {
      return { openSlotsCreated: 0, proposalsAssigned: 0, quotaBlocked: false };
    }
    const startsAt = kstDayStart(now);
    const endsAt = new Date(startsAt.getTime() + 7 * DAY_MILLISECONDS);
    const slots = await dependencies.listSlots({
      workspaceId: brand.workspaceId,
      brandId: brand.brandId,
      startsAt,
      endsAt,
    });
    const occurrences: AutomaticOccurrenceInput[] = [];
    for (let day = 0; day < 7; day += 1) {
      const dayStart = new Date(startsAt.getTime() + day * DAY_MILLISECONDS);
      const entries = brand.settings.weeklySchedule
        .filter(({ dayOfWeek }) => dayOfWeek === kstIsoWeekday(dayStart))
        .sort((left, right) => left.time.localeCompare(right.time)
          || left.sortOrder - right.sortOrder || left.id.localeCompare(right.id));
      for (const [index, entry] of entries.entries()) {
        const scheduledFor = scheduledInstant(startsAt, day, entry.time);
        const idempotencyKey = automaticSlotKey({
          scheduleEntryId: entry.id,
          kstDate: kstDateKey(scheduledFor),
        });
        const recommendationKind = index % 2 === 0 ? "informational" : "trend";
        if (scheduledFor <= now) continue;
        occurrences.push({
          scheduleEntryId: entry.id,
          scheduledFor,
          recommendationKind,
          idempotencyKey,
        });
      }
    }
    const provisioned = await dependencies.provisionAutomaticOccurrences({
      workspaceId: brand.workspaceId,
      brandId: brand.brandId,
      occurrences,
    });
    let openSlotsCreated = 0;
    let quotaBlocked = false;
    const knownSlotIds = new Set(slots.map(({ id }) => id));
    for (const result of provisioned) {
      if (result.status === "quota_exhausted") {
        quotaBlocked = true;
        continue;
      }
      if (result.status === "subscription_ineligible") continue;
      if (!result.slot) continue;
      if (!knownSlotIds.has(result.slot.id)) {
        slots.push(result.slot);
        knownSlotIds.add(result.slot.id);
      }
      if (result.status === "created") openSlotsCreated += 1;
    }

    const openSlots = slots
      .filter((candidate) => candidate.assignmentMode === "automatic" && candidate.status === "open"
        && new Date(candidate.scheduledFor) > now)
      .sort((left, right) => left.scheduledFor.localeCompare(right.scheduledFor));
    const recommendations = await dependencies.listUnassignedRecommendations(brand);
    let proposalsAssigned = 0;
    for (const recommendation of recommendations) {
      const kind = classifySuggestion(recommendation);
      const recommendationDate = kstDateKey(new Date(recommendation.createdAt));
      const index = openSlots.findIndex(({ recommendationKind, scheduledFor }) => (
        recommendationKind === kind && kstDateKey(new Date(scheduledFor)) === recommendationDate
      ));
      if (index < 0) continue;
      const candidate = openSlots[index];
      const assigned = await dependencies.assignSlot({
        workspaceId: brand.workspaceId,
        brandId: brand.brandId,
        slotId: candidate.id,
        assignmentMode: "automatic",
        contentSuggestionId: recommendation.id,
        title: recommendation.title,
      });
      if (assigned.status === "quota_blocked") {
        quotaBlocked = true;
        break;
      }
      openSlots.splice(index, 1);
      proposalsAssigned += 1;
    }
    return { openSlotsCreated, proposalsAssigned, quotaBlocked };
  }

  return {
    allocateBrand,
    async allocateAll(now = new Date()) {
      const renewals = await dependencies.applyDueSubscriptionRenewals(now);
      const brands = await dependencies.listEnabledBrands(now);
      const result = {
        brandsSelected: brands.length,
        openSlotsCreated: 0,
        proposalsAssigned: 0,
        quotaBlocked: 0,
        brandsFailed: renewals.filter((renewal) => renewal.status === "failed").length,
      };
      for (const brand of brands) {
        try {
          const allocated = await allocateBrand(brand, now);
          result.openSlotsCreated += allocated.openSlotsCreated;
          result.proposalsAssigned += allocated.proposalsAssigned;
          result.quotaBlocked += allocated.quotaBlocked ? 1 : 0;
        } catch {
          result.brandsFailed += 1;
        }
      }
      return result;
    },
  };
}

function mapWeeklySettings(rows: Array<Record<string, unknown>>): PublishCalendarWeeklySettingsDto {
  const row = rows[0]!;
  return {
    brandId: String(row.brand_id),
    enabled: row.enabled === true,
    channels: row.active_channels as PublishCalendarWeeklySettingsDto["channels"],
    informationalFormat: row.informational_format as PublishCalendarWeeklySettingsDto["informationalFormat"],
    trendFormat: row.trend_format as PublishCalendarWeeklySettingsDto["trendFormat"],
    weeklySchedule: rows.map((schedule) => ({
      id: String(schedule.schedule_entry_id),
      dayOfWeek: Number(schedule.day_of_week) as 1 | 2 | 3 | 4 | 5 | 6 | 7,
      time: String(schedule.slot_time).slice(0, 5),
      sortOrder: Number(schedule.sort_order),
    })),
    updatedAt: row.updated_at ? new Date(row.updated_at as string | Date).toISOString() : null,
  };
}

export async function listEnabledAutomaticCalendarBrands(pool: Pool, at: Date) {
  const result = await pool.query(
    `select settings.workspace_id,settings.brand_id,settings.enabled,
            settings.informational_format,settings.trend_format,settings.updated_at,
            active_channels.channels as active_channels,
            schedule.id as schedule_entry_id,schedule.day_of_week,
            schedule.slot_time,schedule.sort_order
       from publish_calendar_settings settings
       join brand_subscriptions subscription on subscription.brand_id=settings.brand_id
       join billing_plan_catalog plan on plan.code=subscription.plan_code and plan.active
       join publish_calendar_weekly_schedule_entries schedule
         on schedule.workspace_id=settings.workspace_id and schedule.brand_id=settings.brand_id
       cross join lateral (
         select coalesce(array_agg(distinct channel.channel order by channel.channel),array[]::text[]) channels
           from brand_channels channel
          where channel.workspace_id=settings.workspace_id
            and channel.brand_id=settings.brand_id
            and channel.channel=any(settings.channels)
            and channel.channel=any($2::text[])
            and channel.status='connected' and channel.enabled and channel.deleted_at is null
       ) active_channels
      where settings.enabled and cardinality(active_channels.channels)>0
        and subscription.status in ('active','cancel_scheduled')
        and subscription.current_period_start<=$1::timestamptz
        and subscription.current_period_end>$1::timestamptz
      order by settings.brand_id,schedule.day_of_week,schedule.sort_order,schedule.id`,
    [at, SUPPORTED_AUTOMATIC_CHANNELS],
  );
  const rowsByBrand = new Map<string, Array<Record<string, unknown>>>();
  for (const row of result.rows) {
    const brandId = String(row.brand_id);
    rowsByBrand.set(brandId, [...(rowsByBrand.get(brandId) ?? []), row]);
  }
  return [...rowsByBrand.values()].map((rows) => ({
    workspaceId: String(rows[0]!.workspace_id),
    brandId: String(rows[0]!.brand_id),
    settings: mapWeeklySettings(rows),
  }));
}

export function createDatabasePublishCalendarAllocator(
  pool: Pool,
  calendar: PublishCalendarRepository,
) {
  return createPublishCalendarAllocator({
    ...calendar,
    async listEnabledBrands(at) {
      return listEnabledAutomaticCalendarBrands(pool, at);
    },
    async listUnassignedRecommendations(brand) {
      const result = await pool.query(
        `with ranked as (
           select suggestion.id,suggestion.title,suggestion.intent,suggestion.created_at,
                  row_number() over (
                    partition by suggestion.intent
                    order by exists (
                      select 1 from brand_profile_subcategories selected
                       where selected.brand_profile_id=profile.id
                         and selected.subcategory_id=suggestion.subcategory_id
                    ) desc,subcategory.sort_order,suggestion.position,suggestion.id
                  ) selection_rank
             from brand_profiles profile
             join brands brand
               on brand.id=profile.brand_id and brand.workspace_id=$1::uuid
             join content_categories category on category.id=profile.primary_category_id and category.active
             join content_suggestion_batches batch on batch.category_id=profile.primary_category_id
             join content_suggestions suggestion
               on suggestion.batch_id=batch.id and suggestion.category_id=batch.category_id
             join content_subcategories subcategory
               on subcategory.id=suggestion.subcategory_id and subcategory.active
            where profile.brand_id=$2::uuid and profile.workspace_id=$1::uuid
              and batch.id=(
                select latest.id from content_suggestion_batches latest
                 where latest.category_id=profile.primary_category_id
                 order by latest.generation_date desc,latest.published_at desc,latest.id desc
                 limit 1
              )
         ) select suggestion.id,suggestion.title,suggestion.intent,suggestion.created_at
             from ranked suggestion
            where suggestion.selection_rank=1
              and not exists (
                select 1 from publish_calendar_slots slot
                 where slot.brand_id=$2::uuid and slot.content_suggestion_id=suggestion.id
                   and slot.status<>'cancelled'
              )
            order by case suggestion.intent when 'informational' then 0 else 1 end,
                     suggestion.created_at,suggestion.id`,
        [brand.workspaceId, brand.brandId],
      );
      return result.rows.map((row) => ({
        id: String(row.id),
        title: String(row.title),
        intent: String(row.intent) as ScheduledRecommendation["intent"],
        createdAt: new Date(row.created_at).toISOString(),
      }));
    },
  });
}
