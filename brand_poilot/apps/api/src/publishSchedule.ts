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
