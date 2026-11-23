import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="serif text-2xl font-semibold md:text-3xl">{title}</h1>
        {subtitle && <p className="muted mt-1 max-w-3xl text-sm">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, action, className = "", pad = true }: { title?: ReactNode; children: ReactNode; action?: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={`surface rounded-xl ${className}`}>
      {title && (
        <div className="line flex items-center justify-between gap-3 border-b px-5 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          {action}
        </div>
      )}
      <div className={pad ? "p-5" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, hint, tone = "default", href }: { label: string; value: ReactNode; hint?: string; tone?: "default" | "warn" | "bad" | "good"; href?: string }) {
  const toneCls = { default: "", warn: "text-gold-700 dark:text-gold-300", bad: "text-plum-600 dark:text-plum-100", good: "accent" }[tone];
  const body = (
    <div className="surface h-full rounded-xl px-5 py-4 transition hover:border-[var(--color-gold-500)]">
      <div className="muted text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className={`num serif mt-1 text-3xl font-semibold ${toneCls}`}>{value}</div>
      {hint && <div className="muted mt-1 text-xs">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

const PILL: Record<string, string> = {
  good: "bg-forest-50 text-forest-700 ring-forest-200 dark:bg-forest-900 dark:text-forest-100 dark:ring-forest-700",
  warn: "bg-gold-100 text-gold-700 ring-gold-300 dark:bg-[#2a2310] dark:text-gold-300 dark:ring-gold-700",
  bad: "bg-plum-50 text-plum-700 ring-plum-100 dark:bg-plum-900 dark:text-plum-100 dark:ring-plum-700",
  info: "bg-ivory-200 text-[#3b463f] ring-[#ddd3bd] dark:bg-[#1c2a22] dark:text-[#cfdad3] dark:ring-[#2c3f34]",
};

const TONE_BY_STATUS: Record<string, keyof typeof PILL> = {
  CONNECTED: "good", COMPLETED: "good", VERIFIED: "good", APPROVED: "good", EXECUTED: "good", PASS: "good", ACTIVE: "good", SENT: "good", DONE: "good", RESOLVED: "good", CONSENSUS_SUPPORTED: "good", ok: "good",
  PENDING: "warn", WAITING: "warn", AWAITING_APPROVAL: "warn", DEGRADED: "warn", WARN: "warn", SHADOW: "warn", DEFERRED: "warn", MAJORITY: "warn", CONSENSUS_UNVERIFIED: "warn", REDUCED_PANEL: "warn", QUEUED: "warn", MANAGER_REVIEW: "warn", TESTING: "warn", SEV3: "warn", ACKED: "warn", MITIGATED: "warn", NEEDS_REWORK: "warn",
  FAILED: "bad", FAIL: "bad", REJECTED: "bad", BLOCKED: "bad", TOKEN_EXPIRED: "bad", PERMISSION_REQUIRED: "bad", SPLIT: "bad", SEV1: "bad", SEV2: "bad", OPEN: "bad", EXPIRED: "bad", EXECUTION_FAILED: "bad", PAUSED: "bad", denied: "bad",
};

export function Pill({ children, tone }: { children: ReactNode; tone?: keyof typeof PILL }) {
  const t = tone ?? TONE_BY_STATUS[String(children)] ?? "info";
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset ${PILL[t]}`}>{String(children).replace(/_/g, " ").toLowerCase()}</span>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="line rounded-xl border border-dashed px-6 py-10 text-center">
      <div className="font-medium">{title}</div>
      {children && <div className="muted mx-auto mt-1 max-w-md text-sm">{children}</div>}
    </div>
  );
}

export function Table({ head, children, dense }: { head: string[]; children: ReactNode; dense?: boolean }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="line border-b text-left">
            {head.map((h) => <th key={h} className={`muted ${dense ? "px-3 py-2" : "px-5 py-2.5"} text-xs font-medium uppercase tracking-wide`}>{h}</th>)}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-[var(--line)] [&>tr:last-child]:border-0 [&_td]:align-top">{children}</tbody>
      </table>
    </div>
  );
}

export function Td({ children, className = "", dense, colSpan }: { children: ReactNode; className?: string; dense?: boolean; colSpan?: number }) {
  return <td colSpan={colSpan} className={`${dense ? "px-3 py-2" : "px-5 py-3"} ${className}`}>{children}</td>;
}

export function Button({ children, variant = "primary", name, value, type = "submit", disabled, formAction }: { children: ReactNode; variant?: "primary" | "ghost" | "danger" | "gold"; name?: string; value?: string; type?: "submit" | "button"; disabled?: boolean; formAction?: (fd: FormData) => void | Promise<void> }) {
  const cls = {
    primary: "bg-accent hover:opacity-90",
    ghost: "surface hover:border-[var(--color-gold-500)]",
    danger: "bg-plum-600 text-white hover:bg-plum-700",
    gold: "bg-gold-500 text-[#1d2420] hover:bg-gold-300",
  }[variant];
  return <button type={type} name={name} value={value} disabled={disabled} formAction={formAction} className={`inline-flex items-center justify-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${cls}`}>{children}</button>;
}

export function Field({ label, children, help }: { label: string; children: ReactNode; help?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium">{label}</span>
      {children}
      {help && <span className="muted mt-1 block text-xs">{help}</span>}
    </label>
  );
}

export const inputCls = "w-full rounded-lg px-3 py-2 text-sm";

export function Kv({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex gap-3 py-1.5 text-sm">
      <div className="muted w-40 shrink-0">{k}</div>
      <div className="min-w-0 flex-1 break-words">{v}</div>
    </div>
  );
}

export function Simulated() {
  return <span className="rounded bg-gold-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-gold-700 dark:bg-[#2a2310] dark:text-gold-300">Simulated</span>;
}
