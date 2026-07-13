const policySlots = [
  { hour: 11, minute: 30 },
  { hour: 14, minute: 30 },
  { hour: 17, minute: 30 },
  { hour: 20, minute: 30 }
] as const;

type KstParts = { year: number; month: number; day: number; hour: number; minute: number };

function kstParts(now: Date): KstParts {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23"
    }).formatToParts(now).map((part) => [part.type, part.value])
  );
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute)
  };
}

function atKst(parts: Pick<KstParts, "year" | "month" | "day">, hour: number, minute: number) {
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, hour - 9, minute, 0, 0));
}

function addKstDays(parts: Pick<KstParts, "year" | "month" | "day">, days: number) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 0, 0, 0, 0));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

export function kstDateKey(now: Date) {
  const parts = kstParts(now);
  return `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`;
}

export function isDailyGenerationMinute(now: Date) {
  const parts = kstParts(now);
  return parts.hour === 10 && parts.minute === 0;
}

export function nextPolicySlots(now: Date, count: number) {
  const slots: Date[] = [];
  const currentDate = kstParts(now);
  for (let dayOffset = 0; slots.length < count && dayOffset < 32; dayOffset += 1) {
    const date = addKstDays(currentDate, dayOffset);
    for (const slot of policySlots) {
      const candidate = atKst(date, slot.hour, slot.minute);
      if (candidate.getTime() > now.getTime()) slots.push(candidate);
      if (slots.length === count) break;
    }
  }
  return slots;
}

export function policySlotMetadata(slot: Date) {
  const parts = kstParts(slot);
  const slotNumber = policySlots.findIndex((candidate) => candidate.hour === parts.hour && candidate.minute === parts.minute) + 1;
  if (slotNumber < 1) throw new Error("invalid_policy_slot");
  return {
    slotDate: `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}`,
    slotNumber
  };
}

export function jitterPolicySlot(slot: Date, queueId: string) {
  const seed = Array.from(queueId).reduce((total, character) => total + character.codePointAt(0)!, 0);
  const offsetMinutes = (seed % 21) - 10;
  return new Date(slot.getTime() + offsetMinutes * 60_000);
}

export function nextAvailablePolicySlot(now: Date, queueId: string, occupiedSlotKeys: ReadonlySet<string>) {
  for (const baseSlot of nextPolicySlots(now, 128)) {
    const metadata = policySlotMetadata(baseSlot);
    const key = `${metadata.slotDate}:${metadata.slotNumber}`;
    const scheduledFor = jitterPolicySlot(baseSlot, queueId);
    if (scheduledFor.getTime() > now.getTime() && !occupiedSlotKeys.has(key)) {
      return { ...metadata, scheduledFor, key };
    }
  }
  throw new Error("policy_slot_unavailable");
}
