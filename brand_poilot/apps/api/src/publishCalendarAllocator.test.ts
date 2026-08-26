import { describe, expect, it, vi } from "vitest";
import {
  classifySuggestion,
  createDatabasePublishCalendarAllocator,
  createPublishCalendarAllocator,
  type AutomaticCalendarBrand,
  type ScheduledRecommendation,
} from "./publishCalendarAllocator.js";
import { automaticSlotKey } from "./publishCalendarIdempotency.js";

const entryIds = {
  thursdayMorning: "30000000-0000-4000-8000-000000000001",
  thursdayDuplicate: "30000000-0000-4000-8000-000000000002",
  thursdayAfternoon: "30000000-0000-4000-8000-000000000003",
  wednesdayEvening: "30000000-0000-4000-8000-000000000004",
};

const brand: AutomaticCalendarBrand = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000001",
  settings: {
    brandId: "20000000-0000-4000-8000-000000000001",
    enabled: true,
    channels: ["instagram"],
    informationalFormat: "card_news",
    trendFormat: "reel",
    weeklySchedule: [
      { id: entryIds.thursdayMorning, dayOfWeek: 4, time: "11:30", sortOrder: 0 },
      { id: entryIds.thursdayAfternoon, dayOfWeek: 4, time: "14:30", sortOrder: 1 },
      { id: entryIds.wednesdayEvening, dayOfWeek: 3, time: "20:30", sortOrder: 0 },
    ],
    updatedAt: "2026-08-13T00:00:00.000Z",
  },
};

const dailyRecommendations: ScheduledRecommendation[] = [
  { id: "suggestion-info", title: "정보 추천", intent: "informational", createdAt: "2026-08-12T19:10:00.000Z" },
  { id: "suggestion-trend", title: "트렌드 추천", intent: "trend", createdAt: "2026-08-12T19:11:00.000Z" },
];

function dependencies(options: {
  selectedBrands?: AutomaticCalendarBrand[];
  existing?: Array<Record<string, unknown>>;
  recommendations?: ScheduledRecommendation[];
  slotCreationLimit?: number;
  blockedOnAssign?: boolean;
} = {}) {
  const slots: Array<Record<string, unknown>> = [...(options.existing ?? [])];
  let recommendations = [...(options.recommendations ?? dailyRecommendations)];
  let assignments = 0;
  const listEnabledBrands = vi.fn(async () => options.selectedBrands ?? [brand]);
  const listSlots = vi.fn(async ({ startsAt, endsAt }: { startsAt: Date; endsAt: Date }) => (
    slots.filter(({ scheduledFor }) => {
      const instant = new Date(scheduledFor as string | Date);
      return instant >= startsAt && instant < endsAt;
    }) as never[]
  ));
  const createSlot = vi.fn(async (input: Record<string, unknown>) => {
    const automaticSlots = slots.filter(({ assignmentMode }) => assignmentMode === "automatic");
    if (automaticSlots.length >= (options.slotCreationLimit ?? Number.POSITIVE_INFINITY)) {
      return { status: "quota_exhausted", slot: null } as never;
    }
    const created = {
      id: `slot-${slots.length + 1}`,
      ...input,
      scheduledFor: (input.scheduledFor as Date).toISOString(),
      status: "open",
      contentSuggestionId: null,
      title: null,
    };
    slots.push(created);
    return { status: "created", slot: created } as never;
  });
  const provisionAutomaticOccurrences = vi.fn(async (input: {
    occurrences: Array<Record<string, unknown>>;
  }) => {
    const results = [];
    for (const occurrence of input.occurrences) {
      const existing = slots.find(({ idempotencyKey }) => idempotencyKey === occurrence.idempotencyKey);
      if (existing) {
        results.push({ status: "existing", slot: existing });
        continue;
      }
      const automaticSlots = slots.filter(({ assignmentMode }) => assignmentMode === "automatic");
      if (automaticSlots.length >= (options.slotCreationLimit ?? Number.POSITIVE_INFINITY)) {
        results.push({ status: "quota_exhausted", slot: null });
        continue;
      }
      const recommendationKind = occurrence.recommendationKind as "informational" | "trend";
      const created = {
        id: `slot-${slots.length + 1}`,
        ...occurrence,
        assignmentMode: "automatic",
        scheduledFor: (occurrence.scheduledFor as Date).toISOString(),
        contentFormat: recommendationKind === "trend" ? "reel" : "card_news",
        channels: ["instagram"],
        status: "open",
        contentSuggestionId: null,
        title: null,
      };
      slots.push(created);
      results.push({ status: "created", slot: created });
    }
    return results as never;
  });
  const listUnassignedRecommendations = vi.fn(async () => recommendations.filter((recommendation) => (
    !slots.some(({ status, contentSuggestionId }) => (
      status !== "cancelled" && contentSuggestionId === recommendation.id
    ))
  )));
  const assignSlot = vi.fn(async (input: Record<string, unknown>) => {
    const slot = slots.find(({ id }) => id === input.slotId)!;
    const status = options.blockedOnAssign ? "quota_blocked" : "proposal_assigned";
    Object.assign(slot, input, { status });
    if (!options.blockedOnAssign) assignments += 1;
    return slot as never;
  });
  const getWeeklyUsage = vi.fn();
  const applyDueSubscriptionRenewals = vi.fn(async () => []);
  const previewDueSubscriptionRenewals = vi.fn(async () => [{ brandId: "brand-renewal" }]);
  const previewAutomaticOccurrences = vi.fn(async (input: {
    occurrences: Array<Record<string, unknown>>;
  }) => input.occurrences.map((occurrence, index) => ({
    idempotencyKey: String(occurrence.idempotencyKey),
    status: index === 0 ? "create" as const : "quota_blocked" as const,
    slot: null,
  })) as never);
  return {
    slots,
    setRecommendations(value: ScheduledRecommendation[]) {
      recommendations = [...value];
    },
    listEnabledBrands,
    listSlots,
    createSlot,
    provisionAutomaticOccurrences,
    listUnassignedRecommendations,
    assignSlot,
    getWeeklyUsage,
    applyDueSubscriptionRenewals,
    previewDueSubscriptionRenewals,
    previewAutomaticOccurrences,
  };
}

describe("publish calendar allocator", () => {
  it("previews exact occurrence, recommendation, quota, and renewal candidates without mutations", async () => {
    const deps = dependencies();
    const allocator = createPublishCalendarAllocator(deps as never);

    await expect(allocator.previewAll(new Date("2026-08-12T19:00:00.000Z"))).resolves.toEqual({
      observedAt: "2026-08-12T19:00:00.000Z",
      renewalDueBrandIds: ["brand-renewal"],
      brandsSelected: 1,
      counts: { renewalsDue: 1, occurrences: 3, recommendations: 1, quotaBlockedBrands: 1 },
      occurrences: [
        expect.objectContaining({ brandId: brand.brandId, status: "create" }),
        expect.objectContaining({ brandId: brand.brandId, status: "quota_blocked" }),
        expect.objectContaining({ brandId: brand.brandId, status: "quota_blocked" }),
      ],
      recommendationAssignments: [expect.objectContaining({
        brandId: brand.brandId,
        recommendationId: "suggestion-info",
      })],
      quotaBlockedBrandIds: [brand.brandId],
    });
    expect(deps.previewDueSubscriptionRenewals).toHaveBeenCalledTimes(1);
    expect(deps.previewAutomaticOccurrences).toHaveBeenCalledTimes(1);
    expect(deps.applyDueSubscriptionRenewals).not.toHaveBeenCalled();
    expect(deps.provisionAutomaticOccurrences).not.toHaveBeenCalled();
    expect(deps.assignSlot).not.toHaveBeenCalled();
  });

  it("uses the stored informational or trend intent without synthesizing content", () => {
    expect(classifySuggestion({ intent: "trend" })).toBe("trend");
    expect(classifySuggestion({ intent: "informational" })).toBe("informational");
  });

  it("matches ISO weekdays in KST across an exact seven-day half-open horizon", async () => {
    const deps = dependencies({ recommendations: [] });
    const result = await createPublishCalendarAllocator(deps)
      .allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(result.openSlotsCreated).toBe(3);
    expect(deps.listSlots).toHaveBeenCalledWith(expect.objectContaining({
      startsAt: new Date("2026-08-12T15:00:00.000Z"),
      endsAt: new Date("2026-08-19T15:00:00.000Z"),
    }));
    expect(deps.provisionAutomaticOccurrences.mock.calls[0]?.[0].occurrences
      .map((input: Record<string, unknown>) => input.scheduledFor)).toEqual([
      new Date("2026-08-13T02:30:00.000Z"),
      new Date("2026-08-13T05:30:00.000Z"),
      new Date("2026-08-19T11:30:00.000Z"),
    ]);
  });

  it("materializes duplicate same-time rows as distinct stable entry occurrences", async () => {
    const duplicateBrand: AutomaticCalendarBrand = {
      ...brand,
      settings: { ...brand.settings, weeklySchedule: [
        { id: entryIds.thursdayMorning, dayOfWeek: 4, time: "11:30", sortOrder: 0 },
        { id: entryIds.thursdayDuplicate, dayOfWeek: 4, time: "11:30", sortOrder: 1 },
      ] },
    };
    const deps = dependencies({ recommendations: [] });

    await createPublishCalendarAllocator(deps)
      .allocateBrand(duplicateBrand, new Date("2026-08-12T19:00:00.000Z"));

    expect(deps.provisionAutomaticOccurrences).toHaveBeenCalledTimes(1);
    expect(deps.provisionAutomaticOccurrences.mock.calls[0]?.[0].occurrences
      .map((input: Record<string, unknown>) => input.scheduledFor))
      .toEqual([new Date("2026-08-13T02:30:00.000Z"), new Date("2026-08-13T02:30:00.000Z")]);
    expect(deps.provisionAutomaticOccurrences.mock.calls[0]?.[0].occurrences
      .map((input: Record<string, unknown>) => input.idempotencyKey)).toEqual([
      automaticSlotKey({ scheduleEntryId: entryIds.thursdayMorning, kstDate: "2026-08-13" }),
      automaticSlotKey({ scheduleEntryId: entryIds.thursdayDuplicate, kstDate: "2026-08-13" }),
    ]);
  });

  it("replays the same weekly occurrences without creating duplicate slots", async () => {
    const deps = dependencies({ recommendations: [] });
    const allocator = createPublishCalendarAllocator(deps);
    await allocator.allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));
    deps.provisionAutomaticOccurrences.mockClear();

    const replay = await allocator.allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(replay).toEqual({ openSlotsCreated: 0, proposalsAssigned: 0, quotaBlocked: false });
    expect(deps.provisionAutomaticOccurrences).toHaveBeenCalledTimes(1);
  });

  it("does not alter existing future slots after master OFF or all selected targets disconnect", async () => {
    const existing = {
      id: "existing-future-slot",
      assignmentMode: "automatic",
      status: "open",
      recommendationKind: "informational",
      contentFormat: "card_news",
      channels: ["instagram"],
      scheduledFor: "2026-08-13T02:30:00.000Z",
      idempotencyKey: automaticSlotKey({ scheduleEntryId: entryIds.thursdayMorning, kstDate: "2026-08-13" }),
    };
    const deps = dependencies({ existing: [existing] });
    const allocator = createPublishCalendarAllocator(deps);

    await allocator.allocateBrand(
      { ...brand, settings: { ...brand.settings, enabled: false } },
      new Date("2026-08-12T19:00:00.000Z"),
    );
    await allocator.allocateBrand(
      { ...brand, settings: { ...brand.settings, channels: [] } },
      new Date("2026-08-12T19:00:00.000Z"),
    );

    expect(existing).toMatchObject({ status: "open", channels: ["instagram"] });
    expect(deps.listSlots).not.toHaveBeenCalled();
    expect(deps.provisionAutomaticOccurrences).not.toHaveBeenCalled();
    expect(deps.assignSlot).not.toHaveBeenCalled();
  });

  it("stops future occurrences for a deleted weekly row without cancelling its existing slot", async () => {
    const oneRowBrand: AutomaticCalendarBrand = {
      ...brand,
      settings: { ...brand.settings, weeklySchedule: [brand.settings.weeklySchedule[0]!] },
    };
    const deps = dependencies({ recommendations: [] });
    const allocator = createPublishCalendarAllocator(deps);
    await allocator.allocateBrand(oneRowBrand, new Date("2026-08-12T19:00:00.000Z"));
    const existing = deps.slots[0]!;
    deps.provisionAutomaticOccurrences.mockClear();

    await allocator.allocateBrand(
      { ...oneRowBrand, settings: { ...oneRowBrand.settings, weeklySchedule: [] } },
      new Date("2026-08-13T19:00:00.000Z"),
    );

    expect(existing).toMatchObject({ status: "open", scheduledFor: "2026-08-13T02:30:00.000Z" });
    expect(deps.provisionAutomaticOccurrences).toHaveBeenCalledTimes(1);
  });

  it("assigns the two daily recommendations to matching KST-date slots and leaves extras open", async () => {
    const threeSlotBrand: AutomaticCalendarBrand = {
      ...brand,
      settings: { ...brand.settings, weeklySchedule: [
        { id: entryIds.thursdayMorning, dayOfWeek: 4, time: "11:30", sortOrder: 0 },
        { id: entryIds.thursdayDuplicate, dayOfWeek: 4, time: "11:31", sortOrder: 1 },
        { id: entryIds.thursdayAfternoon, dayOfWeek: 4, time: "14:30", sortOrder: 2 },
      ] },
    };
    const deps = dependencies();

    const result = await createPublishCalendarAllocator(deps)
      .allocateBrand(threeSlotBrand, new Date("2026-08-12T19:00:00.000Z"));

    expect(result).toEqual({ openSlotsCreated: 3, proposalsAssigned: 2, quotaBlocked: false });
    expect(deps.assignSlot).toHaveBeenNthCalledWith(1, expect.objectContaining({
      slotId: "slot-1", contentSuggestionId: "suggestion-info",
    }));
    expect(deps.assignSlot).toHaveBeenNthCalledWith(2, expect.objectContaining({
      slotId: "slot-2", contentSuggestionId: "suggestion-trend",
    }));
    expect(deps.slots).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "slot-1", contentFormat: "card_news", status: "proposal_assigned" }),
      expect.objectContaining({ id: "slot-2", contentFormat: "reel", status: "proposal_assigned" }),
      expect.objectContaining({ id: "slot-3", status: "open", contentSuggestionId: null }),
    ]));
  });

  it("does not assign a recommendation to an automatic slot on another KST date", async () => {
    const deps = dependencies({ recommendations: [{
      ...dailyRecommendations[0]!, createdAt: "2026-08-13T15:01:00.000Z",
    }] });

    await createPublishCalendarAllocator(deps)
      .allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(deps.assignSlot).not.toHaveBeenCalled();
  });

  it("stops duplicate occurrence materialization at quota while a multi-channel slot counts once", async () => {
    const duplicateBrand: AutomaticCalendarBrand = {
      ...brand,
      settings: { ...brand.settings, channels: ["instagram", "threads"], weeklySchedule: [
        { id: entryIds.thursdayMorning, dayOfWeek: 4, time: "11:30", sortOrder: 0 },
        { id: entryIds.thursdayDuplicate, dayOfWeek: 4, time: "11:30", sortOrder: 1 },
      ] },
    };
    const deps = dependencies({ slotCreationLimit: 1 });

    const result = await createPublishCalendarAllocator(deps)
      .allocateBrand(duplicateBrand, new Date("2026-08-12T19:00:00.000Z"));

    expect(result).toEqual({ openSlotsCreated: 1, proposalsAssigned: 1, quotaBlocked: true });
    expect(deps.assignSlot).toHaveBeenCalledTimes(1);
    expect(deps.slots).toHaveLength(1);
    expect(deps.provisionAutomaticOccurrences).toHaveBeenCalledTimes(1);
    expect(deps.getWeeklyUsage).not.toHaveBeenCalled();
  });

  it("provisions all missing occurrences in one repository batch instead of createSlot per occurrence", async () => {
    const deps = dependencies({ recommendations: [] });

    await createPublishCalendarAllocator(deps as never)
      .allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(deps.provisionAutomaticOccurrences).toHaveBeenCalledTimes(1);
    expect(deps.createSlot).not.toHaveBeenCalled();
  });

  it("attaches a late daily recommendation on an idempotent later run", async () => {
    const deps = dependencies({ recommendations: [] });
    const allocator = createPublishCalendarAllocator(deps);
    await allocator.allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));
    deps.provisionAutomaticOccurrences.mockClear();
    deps.setRecommendations([{ ...dailyRecommendations[0]!, createdAt: "2026-08-12T20:30:00.000Z" }]);

    const catchUp = await allocator.allocateBrand(brand, new Date("2026-08-12T20:00:00.000Z"));

    expect(catchUp).toEqual({ openSlotsCreated: 0, proposalsAssigned: 1, quotaBlocked: false });
    expect(deps.provisionAutomaticOccurrences).toHaveBeenCalledTimes(1);
    expect(deps.assignSlot).toHaveBeenCalledTimes(1);
    expect(deps.assignSlot).toHaveBeenCalledWith(expect.objectContaining({ contentSuggestionId: "suggestion-info" }));
  });

  it("snapshots only the selected, connected, enabled supported channel intersection", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from publish_calendar_settings settings")) return { rows: [{
        workspace_id: brand.workspaceId,
        brand_id: brand.brandId,
        enabled: true,
        active_channels: ["instagram"],
        informational_format: "card_news",
        trend_format: "reel",
        updated_at: "2026-08-13T00:00:00.000Z",
        schedule_entry_id: entryIds.thursdayMorning,
        day_of_week: 4,
        slot_time: "11:30:00",
        sort_order: 0,
      }] };
      if (sql.includes("from brand_profiles profile")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = dependencies({ selectedBrands: [], recommendations: [] });
    const allocator = createDatabasePublishCalendarAllocator({ query } as never, repository as never);

    await allocator.allocateAll(new Date("2026-08-12T19:00:00.000Z"));

    const selectionSql = query.mock.calls[0]![0];
    expect(selectionSql).toContain("join publish_calendar_weekly_schedule_entries schedule");
    expect(selectionSql).toContain("channel.channel=any(settings.channels)");
    expect(selectionSql).toContain("channel.status='connected'");
    expect(selectionSql).toContain("channel.enabled");
    expect(selectionSql).toContain("channel.deleted_at is null");
    expect(selectionSql).not.toContain("slot_times");
    expect(repository.provisionAutomaticOccurrences).toHaveBeenCalledWith(expect.objectContaining({
      occurrences: [expect.objectContaining({ scheduleEntryId: entryIds.thursdayMorning })],
    }));
  });

  it("does no work when the database selection returns no enabled brands", async () => {
    const deps = dependencies({ selectedBrands: [] });
    const result = await createPublishCalendarAllocator(deps)
      .allocateAll(new Date("2026-08-12T19:00:00.000Z"));

    expect(result).toEqual({
      brandsSelected: 0, openSlotsCreated: 0, proposalsAssigned: 0,
      quotaBlocked: 0, brandsFailed: 0,
    });
    expect(deps.provisionAutomaticOccurrences).not.toHaveBeenCalled();
  });

  it("renews due periods before selection and isolates each brand failure", async () => {
    const deps = dependencies();
    const healthy = { ...brand, brandId: "20000000-0000-4000-8000-000000000002" };
    deps.listEnabledBrands.mockResolvedValue([brand, healthy]);
    deps.listSlots.mockRejectedValueOnce(new Error("brand_allocation_failed")).mockResolvedValue([]);

    const result = await createPublishCalendarAllocator(deps)
      .allocateAll(new Date("2026-08-12T19:00:00.000Z"));

    expect(result.brandsFailed).toBe(1);
    expect(deps.provisionAutomaticOccurrences).toHaveBeenCalled();
    expect(deps.applyDueSubscriptionRenewals.mock.invocationCallOrder[0])
      .toBeLessThan(deps.listEnabledBrands.mock.invocationCallOrder[0]);
  });

  it("surfaces renewal failures while continuing allocation for valid brands", async () => {
    const deps = dependencies();
    deps.applyDueSubscriptionRenewals.mockResolvedValue([{
      status: "failed", brandId: "20000000-0000-4000-8000-000000000099",
      previousPlanCode: "starter", errorCode: "subscription_renewal_plan_inactive",
    }] as never);

    const result = await createPublishCalendarAllocator(deps)
      .allocateAll(new Date("2026-08-12T19:00:00.000Z"));

    expect(result.brandsFailed).toBe(1);
    expect(result.brandsSelected).toBe(1);
    expect(deps.provisionAutomaticOccurrences).toHaveBeenCalled();
  });

  it("retains a race-lost assignment as quota_blocked and stops the brand", async () => {
    const deps = dependencies({ blockedOnAssign: true });
    const result = await createPublishCalendarAllocator(deps)
      .allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(result).toMatchObject({ proposalsAssigned: 0, quotaBlocked: true });
    expect(deps.assignSlot).toHaveBeenCalledTimes(1);
  });
});
