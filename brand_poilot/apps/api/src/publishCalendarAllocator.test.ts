import { describe, expect, it, vi } from "vitest";
import {
  classifySuggestion,
  createDatabasePublishCalendarAllocator,
  createPublishCalendarAllocator,
} from "./publishCalendarAllocator.js";
import { automaticSlotKey } from "./publishCalendarIdempotency.js";

const brand = {
  workspaceId: "10000000-0000-4000-8000-000000000001",
  brandId: "20000000-0000-4000-8000-000000000001",
  settings: {
    brandId: "20000000-0000-4000-8000-000000000001",
    enabled: true,
    channels: ["instagram" as const],
    informationalFormat: "card_news" as const,
    trendFormat: "reel" as const,
    slotTimes: ["11:30", "14:30", "17:30", "20:30"],
    updatedAt: "2026-08-13T00:00:00.000Z",
  },
};

function dependencies(options: {
  existing?: Array<Record<string, unknown>>;
  disabled?: boolean;
  additionalAvailable?: number;
  blockedOnAssign?: boolean;
} = {}) {
  const slots: Array<Record<string, unknown>> = [...(options.existing ?? [])];
  const listEnabledBrands = vi.fn(async () => options.disabled ? [] : [brand]);
  const listSlots = vi.fn(async () => slots as never[]);
  const createSlot = vi.fn(async (input: Record<string, unknown>) => {
    const created = {
      id: `slot-${slots.length + 1}`,
      ...input,
      scheduledFor: (input.scheduledFor as Date).toISOString(),
      status: "open",
      contentSuggestionId: null,
    };
    slots.push(created);
    return created as never;
  });
  const listUnassignedRecommendations = vi.fn(async () => [
    { id: "suggestion-info", title: "정보 추천", intent: "informational" as const, createdAt: "2026-08-13T00:00:00Z" },
    { id: "suggestion-trend", title: "트렌드 추천", intent: "trend" as const, createdAt: "2026-08-13T00:01:00Z" },
  ]);
  const assignSlot = vi.fn(async (input: Record<string, unknown>) => ({
    ...input,
    status: options.blockedOnAssign ? "quota_blocked" : "proposal_assigned",
  }) as never);
  const getWeeklyUsage = vi.fn(async () => ({
    startsAt: "2026-08-09T00:00:00+09:00",
    endsAt: "2026-08-16T00:00:00+09:00",
    generation: { limit: 10, succeeded: 0, reserved: 0, remaining: 10, additionalAvailable: 10 },
    publishing: {
      limit: 10,
      succeeded: 0,
      reserved: 0,
      remaining: 10,
      additionalAvailable: options.additionalAvailable ?? 2,
    },
  }));
  const applyDueSubscriptionRenewals = vi.fn(async () => []);
  return {
    listEnabledBrands,
    listSlots,
    createSlot,
    listUnassignedRecommendations,
    assignSlot,
    getWeeklyUsage,
    applyDueSubscriptionRenewals,
  };
}

describe("publish calendar allocator", () => {
  it("uses the stored informational or trend intent without synthesizing content", () => {
    expect(classifySuggestion({ intent: "trend" })).toBe("trend");
    expect(classifySuggestion({ intent: "informational" })).toBe("informational");
  });

  it("creates a future seven-day horizon and assigns stable real suggestions within quota", async () => {
    const deps = dependencies();
    const result = await createPublishCalendarAllocator(deps)
      .allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(result).toEqual({ openSlotsCreated: 28, proposalsAssigned: 2, quotaBlocked: false });
    expect(deps.createSlot).toHaveBeenCalledTimes(28);
    expect(deps.assignSlot).toHaveBeenNthCalledWith(1, expect.objectContaining({
      contentSuggestionId: "suggestion-info",
      assignmentMode: "automatic",
    }));
    expect(deps.assignSlot).toHaveBeenNthCalledWith(2, expect.objectContaining({
      contentSuggestionId: "suggestion-trend",
    }));
  });

  it("does not reserve an empty slot and stops assigning when no additional quota is available", async () => {
    const deps = dependencies({ additionalAvailable: 0 });
    const result = await createPublishCalendarAllocator(deps)
      .allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(result).toEqual({ openSlotsCreated: 28, proposalsAssigned: 0, quotaBlocked: true });
    expect(deps.createSlot).toHaveBeenCalledTimes(28);
    expect(deps.assignSlot).not.toHaveBeenCalled();
  });

  it("retains a race-lost assignment as quota_blocked and stops the brand", async () => {
    const deps = dependencies({ blockedOnAssign: true });
    const result = await createPublishCalendarAllocator(deps)
      .allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(result).toMatchObject({ proposalsAssigned: 0, quotaBlocked: true });
    expect(deps.assignSlot).toHaveBeenCalledTimes(1);
  });

  it("is idempotent for the same run date", async () => {
    const deps = dependencies();
    const allocator = createPublishCalendarAllocator(deps);
    await allocator.allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));
    deps.listUnassignedRecommendations.mockResolvedValue([]);

    const second = await allocator.allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(second.openSlotsCreated).toBe(0);
  });

  it("extends the rollback horizon past the existing seven days without failing the brand", async () => {
    const deps = dependencies();
    const allocator = createPublishCalendarAllocator(deps);
    await allocator.allocateAll(new Date("2026-08-12T19:00:00.000Z"));
    deps.listUnassignedRecommendations.mockResolvedValue([]);
    deps.createSlot.mockClear();

    const result = await allocator.allocateAll(new Date("2026-08-13T19:00:00.000Z"));

    expect(result).toMatchObject({ openSlotsCreated: 4, brandsFailed: 0 });
    expect(deps.createSlot).toHaveBeenCalledTimes(4);
    expect(deps.createSlot).toHaveBeenCalledWith(expect.objectContaining({
      scheduledFor: new Date("2026-08-20T02:30:00.000Z"),
    }));
  });

  it("creates distinct deterministic occurrences for duplicate automatic times", async () => {
    const duplicateBrand = {
      ...brand,
      settings: { ...brand.settings, slotTimes: ["11:30", "11:30"] },
    };
    const deps = dependencies();

    const allocator = createPublishCalendarAllocator(deps);
    const result = await allocator.allocateBrand(duplicateBrand, new Date("2026-08-12T19:00:00.000Z"));

    const keys = deps.createSlot.mock.calls.map(([input]) => input.idempotencyKey);
    expect(result.openSlotsCreated).toBe(14);
    expect(keys).toHaveLength(14);
    expect(new Set(keys).size).toBe(14);
    expect(keys).toContain(automaticSlotKey({ kstDate: "2026-08-13", time: "11:30", occurrence: 0 }));
    expect(keys).toContain(automaticSlotKey({ kstDate: "2026-08-13", time: "11:30", occurrence: 1 }));
    expect(deps.assignSlot).toHaveBeenNthCalledWith(1, expect.objectContaining({ contentSuggestionId: "suggestion-info" }));
    expect(deps.assignSlot).toHaveBeenNthCalledWith(2, expect.objectContaining({ contentSuggestionId: "suggestion-trend" }));

    deps.listUnassignedRecommendations.mockResolvedValue([]);
    deps.createSlot.mockClear();
    deps.assignSlot.mockClear();
    const replay = await allocator.allocateBrand(duplicateBrand, new Date("2026-08-12T19:00:00.000Z"));
    expect(replay).toEqual({ openSlotsCreated: 0, proposalsAssigned: 0, quotaBlocked: false });
    expect(deps.createSlot).not.toHaveBeenCalled();
    expect(deps.assignSlot).not.toHaveBeenCalled();
  });

  it("preserves an existing keyed occurrence while creating the missing same-time occurrence", async () => {
    const occurrenceOneKey = automaticSlotKey({
      kstDate: "2026-08-13",
      time: "11:30",
      occurrence: 1,
    });
    const existingSlot = {
      id: "existing-occurrence-one",
      assignmentMode: "automatic",
      status: "open",
      recommendationKind: "trend",
      contentFormat: "card_news",
      channels: ["instagram"],
      scheduledFor: "2026-08-13T02:30:00.000Z",
      idempotencyKey: occurrenceOneKey,
    };
    const duplicateBrand = {
      ...brand,
      settings: {
        ...brand.settings,
        informationalFormat: "reel" as const,
        trendFormat: "reel" as const,
        slotTimes: ["11:30", "11:30"],
      },
    };
    const deps = dependencies({ existing: [existingSlot] });

    await createPublishCalendarAllocator(deps)
      .allocateBrand(duplicateBrand, new Date("2026-08-12T19:00:00.000Z"));

    expect(existingSlot).toMatchObject({ contentFormat: "card_news", recommendationKind: "trend" });
    expect(deps.createSlot).toHaveBeenCalledWith(expect.objectContaining({
      scheduledFor: new Date("2026-08-13T02:30:00.000Z"),
      idempotencyKey: automaticSlotKey({ kstDate: "2026-08-13", time: "11:30", occurrence: 0 }),
    }));
    expect(deps.createSlot).not.toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: occurrenceOneKey }));
  });

  it("uses one matching pre-084 timestamp as occurrence zero", async () => {
    const deps = dependencies({
      existing: [{
        id: "legacy-occurrence-zero",
        assignmentMode: "automatic",
        status: "open",
        recommendationKind: "informational",
        contentFormat: "card_news",
        channels: ["instagram"],
        scheduledFor: "2026-08-13T02:30:00.000Z",
        idempotencyKey: null,
      }],
    });
    const duplicateBrand = {
      ...brand,
      settings: { ...brand.settings, slotTimes: ["11:30", "11:30"] },
    };

    await createPublishCalendarAllocator(deps)
      .allocateBrand(duplicateBrand, new Date("2026-08-12T19:00:00.000Z"));

    expect(deps.createSlot).not.toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: automaticSlotKey({ kstDate: "2026-08-13", time: "11:30", occurrence: 0 }),
    }));
    expect(deps.createSlot).toHaveBeenCalledWith(expect.objectContaining({
      idempotencyKey: automaticSlotKey({ kstDate: "2026-08-13", time: "11:30", occurrence: 1 }),
    }));
  });

  it("does no work for settings that are off", async () => {
    const deps = dependencies({ disabled: true });
    const result = await createPublishCalendarAllocator(deps)
      .allocateAll(new Date("2026-08-12T19:00:00.000Z"));

    expect(result).toEqual({
      brandsSelected: 0,
      openSlotsCreated: 0,
      proposalsAssigned: 0,
      quotaBlocked: 0,
      brandsFailed: 0,
    });
    expect(deps.createSlot).not.toHaveBeenCalled();
  });

  it("renews due periods before selection and isolates each brand failure", async () => {
    const deps = dependencies();
    const healthy = { ...brand, brandId: "20000000-0000-4000-8000-000000000002" };
    deps.listEnabledBrands.mockResolvedValue([brand, healthy]);
    deps.listSlots.mockRejectedValueOnce(new Error("brand_allocation_failed")).mockResolvedValue([]);

    const result = await createPublishCalendarAllocator(deps)
      .allocateAll(new Date("2026-08-12T19:00:00.000Z"));

    expect(result.brandsFailed).toBe(1);
    expect(deps.createSlot).toHaveBeenCalled();
    expect(deps.applyDueSubscriptionRenewals.mock.invocationCallOrder[0])
      .toBeLessThan(deps.listEnabledBrands.mock.invocationCallOrder[0]);
  });

  it("surfaces renewal failures while continuing allocation for valid brands", async () => {
    const deps = dependencies();
    deps.applyDueSubscriptionRenewals.mockResolvedValue([{
      status: "failed",
      brandId: "20000000-0000-4000-8000-000000000099",
      previousPlanCode: "starter",
      errorCode: "subscription_renewal_plan_inactive",
    }] as never);

    const result = await createPublishCalendarAllocator(deps)
      .allocateAll(new Date("2026-08-12T19:00:00.000Z"));

    expect(result.brandsFailed).toBe(1);
    expect(result.brandsSelected).toBe(1);
    expect(deps.createSlot).toHaveBeenCalled();
  });

  it("never assigns an existing open slot in the past", async () => {
    const deps = dependencies({
      existing: [{
        id: "past-slot",
        assignmentMode: "automatic",
        status: "open",
        recommendationKind: "informational",
        scheduledFor: "2026-08-12T18:00:00.000Z",
      }],
    });
    await createPublishCalendarAllocator(deps)
      .allocateBrand(brand, new Date("2026-08-12T19:00:00.000Z"));

    expect(deps.assignSlot).not.toHaveBeenCalledWith(expect.objectContaining({ slotId: "past-slot" }));
  });

  it("selects only enabled brands with active plans, active subscriptions, and every channel connected", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from publish_calendar_settings settings")) return { rows: [] };
      if (sql.includes("from brand_profiles profile")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = {
      applyDueSubscriptionRenewals: vi.fn(async () => []),
      listSlots: vi.fn(async () => []),
      createSlot: vi.fn(),
      assignSlot: vi.fn(),
      getWeeklyUsage: vi.fn(),
    };
    const allocator = createDatabasePublishCalendarAllocator({ query } as never, repository as never);
    await allocator.allocateAll(new Date("2026-08-12T19:00:00.000Z"));

    const selectionSql = query.mock.calls[0][0];
    expect(selectionSql).toContain("join billing_plan_catalog plan on plan.code=subscription.plan_code and plan.active");
    expect(selectionSql).toContain("subscription.status in ('active','cancel_scheduled')");
    expect(selectionSql).toContain("select count(distinct channel.channel)");
    expect(selectionSql).toContain(")=cardinality(settings.channels)");
  });

  it("loads only the latest batch for the scoped active brand category in stable intent order", async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes("from brand_profiles profile")) return { rows: [] };
      throw new Error(`unexpected query: ${sql}`);
    });
    const repository = {
      applyDueSubscriptionRenewals: vi.fn(async () => []),
      listSlots: vi.fn(async () => []),
      createSlot: vi.fn(async () => ({})),
      assignSlot: vi.fn(),
      getWeeklyUsage: vi.fn(async () => ({
        publishing: { additionalAvailable: 2 },
      })),
    };
    const allocator = createDatabasePublishCalendarAllocator({ query } as never, repository as never);
    await allocator.allocateBrand(
      { ...brand, settings: { ...brand.settings, slotTimes: [] } },
      new Date("2026-08-12T19:00:00.000Z"),
    );

    const suggestionSql = query.mock.calls[0][0];
    expect(suggestionSql).toContain("join content_categories category on category.id=profile.primary_category_id and category.active");
    expect(suggestionSql).toContain("latest.generation_date desc,latest.published_at desc,latest.id desc");
    expect(suggestionSql).toContain("partition by suggestion.intent");
    expect(suggestionSql).toContain("slot.status<>'cancelled'");
    expect(suggestionSql).toContain("case suggestion.intent when 'informational' then 0 else 1 end");
  });
});
