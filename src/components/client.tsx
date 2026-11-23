"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import type { CommandResult } from "@/core/command";
import type { FormState } from "@/app/actions";

export const NAV: { href: string; label: string; group: string }[] = [
  { href: "/", label: "Mission Control", group: "Run" },
  { href: "/office", label: "HQ · Live Office", group: "Run" },
  { href: "/approvals", label: "Approval Inbox", group: "Run" },
  { href: "/tasks", label: "Task Command Center", group: "Run" },
  { href: "/incidents", label: "Incident War Room", group: "Run" },
  { href: "/organization", label: "AI Organization", group: "Run" },
  { href: "/debates", label: "Agent Debate Room", group: "Run" },
  { href: "/business", label: "Business Intelligence", group: "Insight" },
  { href: "/marketing", label: "Marketing Intelligence", group: "Insight" },
  { href: "/qa", label: "Browser Operations", group: "Insight" },
  { href: "/reports", label: "Reports", group: "Insight" },
  { href: "/comms", label: "Calendar & Comms", group: "Company" },
  { href: "/knowledge", label: "Knowledge Center", group: "Company" },
  { href: "/integrations", label: "Integration Hub", group: "Control" },
  { href: "/costs", label: "AI Cost Center", group: "Control" },
  { href: "/audit", label: "Audit & Security", group: "Control" },
  { href: "/settings", label: "Settings", group: "Control" },
];

export function Sidebar({ counts }: { counts: Record<string, number> }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const groups = [...new Set(NAV.map((n) => n.group))];
  const nav = (
    <nav className="space-y-5">
      {groups.map((g) => (
        <div key={g}>
          <div className="muted mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em]">{g}</div>
          {NAV.filter((n) => n.group === g).map((n) => {
            const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm transition ${active ? "bg-accent font-medium" : "hover:bg-[var(--surface-2)]"}`}>
                <span>{n.label}</span>
                {counts[n.href] ? <span className={`num rounded-full px-1.5 text-[11px] font-semibold ${active ? "bg-white/20" : "bg-gold-100 text-gold-700 dark:bg-[#2a2310] dark:text-gold-300"}`}>{counts[n.href]}</span> : null}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)} className="surface fixed left-3 top-3 z-40 rounded-lg px-3 py-2 text-sm lg:hidden" aria-expanded={open} aria-label="Menu">☰</button>
      <aside className={`surface fixed inset-y-0 left-0 z-30 w-64 overflow-y-auto border-y-0 border-l-0 px-3 pb-6 pt-16 transition-transform lg:translate-x-0 lg:pt-5 ${open ? "translate-x-0" : "-translate-x-full"}`}>
        <Link href="/" className="mb-6 hidden items-center gap-2.5 px-3 lg:flex">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-forest-700 text-sm font-semibold text-gold-300">R</span>
          <span><span className="serif block text-base font-semibold leading-tight">Rootellect OS</span><span className="muted block text-[11px]">where root meets science</span></span>
        </Link>
        {nav}
      </aside>
      {open && <div className="fixed inset-0 z-20 bg-black/30 lg:hidden" onClick={() => setOpen(false)} />}
    </>
  );
}

export function ThemeToggle({ initial }: { initial: "light" | "dark" }) {
  const [t, setT] = useState(initial);
  return (
    <button type="button" className="surface rounded-lg px-2.5 py-1.5 text-xs" aria-label="Toggle theme" onClick={() => {
      const next = t === "dark" ? "light" : "dark";
      setT(next);
      document.documentElement.dataset.theme = next;
      document.cookie = `ros_theme=${next}; path=/; max-age=31536000; samesite=lax`;
    }}>{t === "dark" ? "☀" : "☾"}<span className="ml-1 hidden sm:inline">{t === "dark" ? "Light" : "Dark"}</span></button>
  );
}

export function CommandBar({ action }: { action: (s: CommandResult | null, fd: FormData) => Promise<CommandResult | null> }) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); ref.current?.focus(); } };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);
  return (
    <div className="relative w-full max-w-2xl">
      <form action={run}>
        <input ref={ref} name="q" autoComplete="off" placeholder="Ask Rootellect OS anything — “Start a website audit”, “Show pending approvals”…" className="w-full rounded-xl px-4 py-2.5 pr-20 text-sm shadow-sm" aria-label="Command bar" />
        <span className="muted pointer-events-none absolute right-3 top-2.5 hidden text-xs sm:block">{pending ? "working…" : "Ctrl K"}</span>
      </form>
      {state && (
        <div className="surface absolute left-0 right-0 top-12 z-30 rounded-xl p-4 text-sm shadow-lg" role="status">
          <div className="whitespace-pre-wrap">{state.message}</div>
          {state.link && <a className="accent mt-2 inline-block text-xs font-medium underline" href={state.link.replace(/^https?:\/\/[^/]+/, "")}>Open →</a>}
        </div>
      )}
    </div>
  );
}

function Submit({ children, variant = "primary" }: { children: ReactNode; variant?: "primary" | "danger" | "ghost" | "gold" }) {
  const { pending } = useFormStatus();
  const cls = { primary: "bg-accent", danger: "bg-plum-600 text-white", ghost: "surface", gold: "bg-gold-500 text-[#1d2420]" }[variant];
  return <button type="submit" disabled={pending} className={`rounded-lg px-3.5 py-2 text-sm font-medium transition hover:opacity-90 disabled:opacity-50 ${cls}`}>{pending ? "Working…" : children}</button>;
}

/** Form bound to a server action returning FormState; shows success/error inline. */
export function ActionForm({ action, children, submit, variant, className = "" }: { action: (s: FormState, fd: FormData) => Promise<FormState>; children: ReactNode; submit?: ReactNode; variant?: "primary" | "danger" | "ghost" | "gold"; className?: string }) {
  const [state, run] = useActionState(action, null);
  return (
    <form action={run} className={className}>
      {children}
      {submit && <div className="mt-3 flex items-center gap-3"><Submit variant={variant}>{submit}</Submit>{state?.message && <span className="accent text-sm">{state.message}</span>}{state?.error && <span className="text-sm text-plum-600 dark:text-plum-100">{state.error}</span>}</div>}
      {!submit && (state?.message || state?.error) && <div className={`mt-2 text-sm ${state?.error ? "text-plum-600 dark:text-plum-100" : "accent"}`}>{state?.error ?? state?.message}</div>}
    </form>
  );
}

export function ApprovalButtons({ action, id, riskLevel }: { action: (s: FormState, fd: FormData) => Promise<FormState>; id: string; riskLevel: number }) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-3">
      <input type="hidden" name="id" value={id} />
      <textarea name="note" rows={2} placeholder="Note (optional)" className="w-full rounded-lg px-3 py-2 text-sm" />
      {riskLevel >= 4 && <input name="reviewer" required placeholder="Qualified reviewer (name, role) — required for level 4" className="w-full rounded-lg px-3 py-2 text-sm" />}
      <div className="flex flex-wrap gap-2">
        {([["APPROVE", "Approve", "bg-accent"], ["REQUEST_CHANGES", "Request changes", "surface"], ["DEFER", "Defer", "surface"], ["DELEGATE", "Delegate", "surface"], ["REJECT", "Reject", "bg-plum-600 text-white"]] as const).map(([v, l, c]) => (
          <button key={v} name="decision" value={v} disabled={pending} className={`rounded-lg px-3.5 py-2 text-sm font-medium hover:opacity-90 disabled:opacity-50 ${c}`}>{l}</button>
        ))}
      </div>
      {state?.message && <div className="accent text-sm">{state.message}</div>}
      {state?.error && <div className="text-sm text-plum-600 dark:text-plum-100">{state.error}</div>}
    </form>
  );
}

export function MfaSetup({ action, enabled }: { action: (s: FormState, fd: FormData) => Promise<FormState>; enabled: boolean }) {
  const [state, run, pending] = useActionState(action, null);
  const secret = state?.message?.startsWith("secret:") ? state.message.slice(7).split("|") : null;
  if (enabled) {
    return (
      <form action={run} className="space-y-3 text-sm">
        <p>Two-factor sign-in is <strong className="accent">on</strong>. To turn it off, enter a current code.</p>
        <input type="hidden" name="op" value="disable" />
        <div className="flex gap-2"><input name="code" inputMode="numeric" placeholder="123456" className="w-32 rounded-lg px-3 py-2" /><button disabled={pending} className="surface rounded-lg px-3 py-2">Turn off</button></div>
        {state?.error && <p className="text-plum-600">{state.error}</p>}
        {state?.message && !secret && <p className="accent">{state.message}</p>}
      </form>
    );
  }
  return (
    <div className="space-y-3 text-sm">
      {!secret ? (
        <form action={run}><input type="hidden" name="op" value="begin" /><p className="muted mb-3">Require a 6-digit code from an authenticator app at every sign-in.</p><button disabled={pending} className="bg-accent rounded-lg px-3.5 py-2">Set up two-factor</button></form>
      ) : (
        <form action={run} className="space-y-3">
          <p>Add this key in Google Authenticator, 1Password or Authy (choose “enter a setup key”, time-based):</p>
          <code className="surface-2 line block break-all rounded-lg border p-3 text-base tracking-widest">{secret[0].match(/.{1,4}/g)?.join(" ")}</code>
          <a href={secret[1]} className="accent text-xs underline">Or open otpauth link on this device</a>
          <input type="hidden" name="op" value="confirm" />
          <div className="flex gap-2"><input name="code" inputMode="numeric" required placeholder="Code from the app" className="w-44 rounded-lg px-3 py-2" /><button disabled={pending} className="bg-accent rounded-lg px-3.5 py-2">Confirm & turn on</button></div>
        </form>
      )}
      {state?.error && <p className="text-plum-600">{state.error}</p>}
      {state?.message && !secret && <p className="accent">{state.message}</p>}
    </div>
  );
}
