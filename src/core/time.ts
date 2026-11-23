// India has no DST, so IST is a fixed +05:30 offset.
export const IST_OFFSET_MIN = 330;

export function toIstParts(d: Date) {
  const t = new Date(d.getTime() + IST_OFFSET_MIN * 60_000);
  return {
    year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(),
    hour: t.getUTCHours(), minute: t.getUTCMinutes(), weekday: t.getUTCDay(),
  };
}

/** Start of the IST calendar day containing `d`, as a UTC Date. */
export function istDayStart(d = new Date()): Date {
  const p = toIstParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, p.day) - IST_OFFSET_MIN * 60_000);
}

export function istMonthStart(d = new Date()): Date {
  const p = toIstParts(d);
  return new Date(Date.UTC(p.year, p.month - 1, 1) - IST_OFFSET_MIN * 60_000);
}

export function formatIst(d: Date | null | undefined, withTime = true): string {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
    ...(withTime ? { hour: "2-digit", minute: "2-digit", hour12: true } : {}),
  }).format(d);
}

export function formatInr(n: number, digits = 0): string {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}

/** Request-time helpers (kept out of component bodies so render stays pure). */
export const msFromNow = (ms: number) => new Date(Date.now() + ms);
export const secondsSince = (d: Date) => (Date.now() - d.getTime()) / 1000;
