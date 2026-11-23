/** Minimal 5-field cron (minute hour day-of-month month day-of-week), evaluated in IST. */
import { IST_OFFSET_MIN } from "../time";

function parseField(f: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of f.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Number(stepStr) : 1;
    let lo = min, hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-").map(Number);
      lo = a; hi = b ?? (stepStr ? max : a);
    }
    if ([lo, hi, step].some((n) => Number.isNaN(n)) || lo < min || hi > max || step < 1) throw new Error(`Bad cron field "${f}"`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("Cron needs 5 fields");
  const [m, h, dom, mon, dow] = parts;
  return {
    minute: parseField(m, 0, 59), hour: parseField(h, 0, 23), dom: parseField(dom, 1, 31), month: parseField(mon, 1, 12),
    dow: new Set([...parseField(dow, 0, 7)].map((d) => (d === 7 ? 0 : d))), domStar: dom === "*", dowStar: dow === "*",
  };
}

/** Next fire time strictly after `after`, as a UTC Date. */
export function nextCron(expr: string, after = new Date()): Date {
  const c = parseCron(expr);
  // Work in "IST wall clock as UTC" space.
  let t = new Date(Math.floor((after.getTime() + IST_OFFSET_MIN * 60_000) / 60_000) * 60_000 + 60_000);
  for (let i = 0; i < 366 * 24 * 60; i++) {
    const mon = t.getUTCMonth() + 1, d = t.getUTCDate(), wd = t.getUTCDay(), h = t.getUTCHours(), mi = t.getUTCMinutes();
    if (!c.month.has(mon)) { t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 1)); continue; }
    const dayOk = c.domStar && c.dowStar ? true : c.domStar ? c.dow.has(wd) : c.dowStar ? c.dom.has(d) : c.dom.has(d) || c.dow.has(wd);
    if (!dayOk) { t = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), d + 1)); continue; }
    if (!c.hour.has(h)) { t = new Date(t.getTime() + (60 - mi) * 60_000); continue; }
    if (!c.minute.has(mi)) { t = new Date(t.getTime() + 60_000); continue; }
    return new Date(t.getTime() - IST_OFFSET_MIN * 60_000);
  }
  throw new Error(`Cron "${expr}" never fires`);
}
