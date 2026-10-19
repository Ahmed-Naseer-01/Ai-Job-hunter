/** Timezone maths via Intl (no dependencies). All functions are pure and take `now` explicitly. */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export function zonedParts(d: Date, tz: string): ZonedParts {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(d)) if (p.type !== "literal") o[p.type] = Number(p.value);
  return { year: o.year, month: o.month, day: o.day, hour: o.hour === 24 ? 0 : o.hour, minute: o.minute, second: o.second };
}

/** Offset of `tz` from UTC at instant `d`, in ms (positive = ahead of UTC). */
export function tzOffsetMs(d: Date, tz: string): number {
  const p = zonedParts(d, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000;
}

export const localDate = (d: Date, tz: string): string => {
  const p = zonedParts(d, tz);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
};

/** UTC instant at which the wall clock in `tz` reads y-m-d h:mi. Handles DST transitions by re-evaluating the offset. */
export function zonedTimeToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): Date {
  const guess = Date.UTC(y, m - 1, d, h, mi, 0);
  const first = guess - tzOffsetMs(new Date(guess), tz);
  const second = guess - tzOffsetMs(new Date(first), tz);
  return new Date(second);
}

export function startOfLocalDay(d: Date, tz: string): Date {
  const p = zonedParts(d, tz);
  return zonedTimeToUtc(p.year, p.month, p.day, 0, 0, tz);
}

export function parseHHmm(t: string): { h: number; m: number } {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(t);
  if (!m) throw new Error(`Invalid time "${t}", expected HH:mm`);
  return { h: Number(m[1]), m: Number(m[2]) };
}

/** Today's scheduled instant (in `tz`) for the given HH:mm. */
export function scheduledInstantToday(now: Date, time: string, tz: string): Date {
  const p = zonedParts(now, tz);
  const { h, m } = parseHHmm(time);
  return zonedTimeToUtc(p.year, p.month, p.day, h, m, tz);
}

/** Next scheduled instant strictly after `now`. */
export function nextRunAt(now: Date, time: string, tz: string): Date {
  const today = scheduledInstantToday(now, time, tz);
  if (today.getTime() > now.getTime()) return today;
  const p = zonedParts(new Date(today.getTime() + 36 * 3600_000), tz); // safely into tomorrow
  const { h, m } = parseHHmm(time);
  return zonedTimeToUtc(p.year, p.month, p.day, h, m, tz);
}

export interface DueDecision {
  due: boolean;
  reason: string;
  scheduledFor: Date;
}

/**
 * Catch-up semantics: a scheduled run is due once per local calendar day, as soon as the scheduled time has
 * passed and no scheduled run has started since then. Survives restarts and sleeping laptops.
 */
export function shouldRunNow(now: Date, schedule: { enabled: boolean; time: string; timezone: string }, lastScheduledStart: Date | null): DueDecision {
  const scheduledFor = scheduledInstantToday(now, schedule.time, schedule.timezone);
  if (!schedule.enabled) return { due: false, reason: "Schedule disabled", scheduledFor };
  if (now.getTime() < scheduledFor.getTime()) return { due: false, reason: "Before today's scheduled time", scheduledFor };
  if (lastScheduledStart && lastScheduledStart.getTime() >= scheduledFor.getTime()) return { due: false, reason: "Already ran for today's slot", scheduledFor };
  return { due: true, reason: "Scheduled time reached and no run yet today", scheduledFor };
}
