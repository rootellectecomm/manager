"use client";

/**
 * Rootellect HQ — a live 2D office driven by real records (polls /api/office).
 * Agents with work walk the corridor ring to their desk; agents waiting for approval queue at the
 * founder's door; debates convene in the boardroom; agents with nothing in their records take a break
 * in the library / wellness / cafeteria / lounge. Click anyone for a standup report.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeSnapshot } from "@/core/office";
import type { FormState } from "@/app/actions";
import { ActionForm } from "./client";

type Person = OfficeSnapshot["people"][number];
type Pt = { x: number; y: number };
type Room = { x: number; y: number; w: number; h: number; label: string; side: "top" | "left" | "right" | "bottom" };

const W = 1600, H = 900;
const RING = { l: 405, r: 1195, t: 258, b: 788 };
const ROOMS: Record<string, Room> = {
  A: { x: 20, y: 20, w: 380, h: 230, label: "1 · Leadership & Operations", side: "top" },
  B: { x: 410, y: 20, w: 385, h: 230, label: "2 · Engineering & Infrastructure", side: "top" },
  C: { x: 805, y: 20, w: 385, h: 230, label: "3 · QA, Testing & Reliability", side: "top" },
  D: { x: 1200, y: 20, w: 380, h: 230, label: "4 · Marketing & Growth", side: "top" },
  E: { x: 1200, y: 270, w: 380, h: 165, label: "5 · Creative & Content", side: "right" },
  F: { x: 1200, y: 445, w: 380, h: 165, label: "6 · E-commerce & Marketplaces", side: "right" },
  G: { x: 1200, y: 620, w: 380, h: 158, label: "7 · Finance & Fulfillment", side: "right" },
  H: { x: 20, y: 445, w: 380, h: 165, label: "8 · CRM & Partnerships", side: "left" },
  I: { x: 20, y: 270, w: 380, h: 165, label: "9 · Product & Research", side: "left" },
  FOUNDER: { x: 20, y: 620, w: 380, h: 158, label: "Founder’s Office", side: "left" },
  LIB: { x: 20, y: 798, w: 380, h: 92, label: "Library & Knowledge Hub", side: "bottom" },
  WELL: { x: 410, y: 798, w: 385, h: 92, label: "Wellness Studio", side: "bottom" },
  CAFE: { x: 805, y: 798, w: 385, h: 92, label: "Cafeteria", side: "bottom" },
  LOUNGE: { x: 1200, y: 798, w: 380, h: 92, label: "Recreation Lounge", side: "bottom" },
};
const DEPT_COLOR: Record<string, string> = { A: "#1b4631", B: "#2f5d8a", C: "#7a4fa3", D: "#c49a3c", E: "#c2577a", F: "#2f8a7a", G: "#6b2f5a", H: "#d07a3a", I: "#4f8f6c" };
const SKIN = ["#f1c9a5", "#e0ac83", "#c98e63", "#a86f4b", "#8a5a3c"];
const HAIR = ["#2a1d17", "#3b2a20", "#151515", "#5a3b25", "#201814"];
const AMENITIES = ["CAFE", "LIB", "LOUNGE", "WELL"];
const BOARD = { cx: 800, cy: 505, rx: 175, ry: 78 };

const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function door(r: Room): { door: Pt; hub: Pt } {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  if (r.side === "top") return { door: { x: cx, y: r.y + r.h }, hub: { x: cx, y: RING.t } };
  if (r.side === "bottom") return { door: { x: cx, y: r.y }, hub: { x: cx, y: RING.b } };
  if (r.side === "left") return { door: { x: r.x + r.w, y: cy }, hub: { x: RING.l, y: cy } };
  return { door: { x: r.x, y: cy }, hub: { x: RING.r, y: cy } };
}

/** Desk seats inside a department room (2 rows of 4; manager takes the first). */
function deskSeat(dept: string, index: number): { seat: Pt; desk: Pt } {
  const r = ROOMS[dept];
  const cols = 4, row = Math.floor(index / cols), col = index % cols;
  const gx = (r.w - 40) / cols;
  const top = r.y + (r.h > 200 ? 70 : 52);
  const gy = r.h > 200 ? 82 : 58;
  const desk = { x: r.x + 20 + gx * col + gx / 2, y: top + row * gy };
  return { desk, seat: { x: desk.x, y: desk.y + 20 } };
}

function amenitySpot(code: string, i: number): Pt {
  const key = AMENITIES[hash(code) % AMENITIES.length];
  const r = ROOMS[key];
  const n = hash(code + "s") % 14;
  return { x: r.x + 30 + (n % 7) * ((r.w - 60) / 6), y: r.y + 40 + Math.floor(n / 7) * 28 + (i % 2) * 2 };
}

const ringPerim = 2 * (RING.r - RING.l) + 2 * (RING.b - RING.t);
function ringS(p: Pt): number {
  const w = RING.r - RING.l, h = RING.b - RING.t;
  if (Math.abs(p.y - RING.t) < 1) return p.x - RING.l;
  if (Math.abs(p.x - RING.r) < 1) return w + (p.y - RING.t);
  if (Math.abs(p.y - RING.b) < 1) return w + h + (RING.r - p.x);
  return 2 * w + h + (RING.b - p.y);
}
function ringPoint(s: number): Pt {
  const w = RING.r - RING.l, h = RING.b - RING.t;
  s = ((s % ringPerim) + ringPerim) % ringPerim;
  if (s <= w) return { x: RING.l + s, y: RING.t };
  if (s <= w + h) return { x: RING.r, y: RING.t + (s - w) };
  if (s <= 2 * w + h) return { x: RING.r - (s - w - h), y: RING.b };
  return { x: RING.l, y: RING.b - (s - 2 * w - h) };
}
/** Walk the corridor ring the short way, turning at corners. */
function ringPath(a: Pt, b: Pt): Pt[] {
  const sa = ringS(a), sb = ringS(b);
  const fwd = (sb - sa + ringPerim) % ringPerim;
  const dir = fwd <= ringPerim / 2 ? 1 : -1;
  const dist = dir === 1 ? fwd : ringPerim - fwd;
  const w = RING.r - RING.l, h = RING.b - RING.t;
  const corners = [0, w, w + h, 2 * w + h];
  const pts: Pt[] = [a];
  for (let t = 1; t < dist; t++) {
    const s = sa + dir * t;
    const m = ((s % ringPerim) + ringPerim) % ringPerim;
    if (corners.some((c) => Math.abs(m - c) < 0.5)) pts.push(ringPoint(m));
  }
  pts.push(b);
  return pts;
}

interface Place { pos: Pt; zone: string }

function placeFor(p: Person, deskIndex: Map<string, number>, queueIndex: Map<string, number>, debaters: string[]): Place {
  if (p.activity === "awaiting_approval") {
    const q = queueIndex.get(p.code) ?? 0;
    return { pos: { x: 425 + (q % 6) * 18, y: 640 + Math.floor(q / 6) * 22 }, zone: "QUEUE" };
  }
  if (p.activity === "in_debate") {
    const i = debaters.indexOf(p.code);
    const a = Math.PI * (0.65 + i * 0.35);
    return { pos: { x: BOARD.cx + Math.cos(a) * (BOARD.rx + 16), y: BOARD.cy + Math.sin(a) * (BOARD.ry + 14) }, zone: "BOARD" };
  }
  if (p.activity === "idle") return { pos: amenitySpot(p.code, 0), zone: AMENITIES[hash(p.code) % AMENITIES.length] };
  return { pos: deskSeat(p.dept, deskIndex.get(p.code) ?? 0).seat, zone: p.dept };
}

function zoneGate(zone: string): { door: Pt; hub: Pt } {
  if (zone === "QUEUE") return { door: { x: 425, y: 650 }, hub: { x: RING.l, y: 650 } };
  if (zone === "BOARD") return { door: { x: BOARD.cx, y: BOARD.cy + BOARD.ry + 20 }, hub: { x: BOARD.cx, y: RING.b } };
  return door(ROOMS[zone]);
}

function route(from: Place, to: Place): Pt[] {
  if (from.zone === to.zone) return [from.pos, to.pos];
  const a = zoneGate(from.zone), b = zoneGate(to.zone);
  return [from.pos, a.door, ...ringPath(a.hub, b.hub), b.door, to.pos];
}

const ACTIVITY_LABEL: Record<string, string> = {
  working: "Working", walking_to_desk: "Heading to desk", awaiting_approval: "Waiting for your approval", in_debate: "In the boardroom",
  review: "In manager review", blocked: "Blocked", paused: "Paused", idle: "On a break",
};

interface Standup { name: string; department: string; manager: string; status: string; spendTodayInr: number; report: string[]; openTasks: { id: string; title: string; status: string }[]; approvals: { id: string; shortCode: string; title: string }[]; note: string }

export function Office({ assignAction }: { assignAction: (s: FormState, fd: FormData) => Promise<FormState> }) {
  const [snap, setSnap] = useState<OfficeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [dept, setDept] = useState<string | null>(null);
  const [standupState, setStandupState] = useState<{ code: string; data: Standup } | null>(null);
  const router = useRouter();
  const go = (href: string) => router.push(href);
  const [names, setNames] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const nodes = useRef(new Map<string, SVGGElement>());
  const walkers = useRef(new Map<string, { pos: Pt; path: Pt[]; place: Place }>());

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/office", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setSnap(await r.json());
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, []);
  useEffect(() => { const first = setTimeout(load, 0); const t = setInterval(load, 6000); return () => { clearTimeout(first); clearInterval(t); }; }, [load]);

  const layout = useMemo(() => {
    if (!snap) return null;
    const deskIndex = new Map<string, number>();
    for (const d of Object.keys(DEPT_COLOR)) {
      snap.people.filter((p) => p.dept === d).sort((a, b) => Number(b.isManager) - Number(a.isManager) || a.code.localeCompare(b.code)).forEach((p, i) => deskIndex.set(p.code, i));
    }
    const queueIndex = new Map(snap.people.filter((p) => p.activity === "awaiting_approval").map((p, i) => [p.code, i]));
    const debaters = snap.people.filter((p) => p.activity === "in_debate").map((p) => p.code);
    return { deskIndex, places: new Map(snap.people.map((p) => [p.code, placeFor(p, deskIndex, queueIndex, debaters)])) };
  }, [snap]);

  // Give each person a walking path whenever their place changes.
  useEffect(() => {
    if (!layout) return;
    for (const [code, place] of layout.places) {
      const w = walkers.current.get(code);
      if (!w) { walkers.current.set(code, { pos: place.pos, path: [], place }); continue; }
      if (w.place.zone !== place.zone || Math.hypot(w.place.pos.x - place.pos.x, w.place.pos.y - place.pos.y) > 1) {
        w.path = route({ pos: w.pos, zone: w.place.zone }, place).slice(1);
        w.place = place;
      }
    }
  }, [layout]);

  // Animation loop: move along paths at walking speed; write transforms directly (no React re-render).
  useEffect(() => {
    let raf = 0, last = performance.now();
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const step = (t: number) => {
      const dt = Math.min(0.05, (t - last) / 1000); last = t;
      for (const [code, w] of walkers.current) {
        let budget = reduce ? 1e9 : 95 * dt; // px per second
        while (budget > 0 && w.path.length) {
          const tgt = w.path[0];
          const d = Math.hypot(tgt.x - w.pos.x, tgt.y - w.pos.y);
          if (d <= budget) { w.pos = tgt; w.path.shift(); budget -= d; } else { w.pos = { x: w.pos.x + ((tgt.x - w.pos.x) / d) * budget, y: w.pos.y + ((tgt.y - w.pos.y) / d) * budget }; budget = 0; }
        }
        const el = nodes.current.get(code);
        if (el) { el.setAttribute("transform", `translate(${w.pos.x.toFixed(1)} ${w.pos.y.toFixed(1)})`); el.dataset.walking = w.path.length ? "1" : "0"; }
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    fetch(`/api/office/agent/${selected}`).then((r) => r.json()).then((data: Standup) => { if (alive) setStandupState({ code: selected, data }); }).catch(() => undefined);
    return () => { alive = false; };
  }, [selected, snap?.at]);
  const standup = standupState && standupState.code === selected ? standupState.data : null;

  if (!snap || !layout) return <div className="surface grid h-[60vh] place-items-center rounded-xl text-sm">{error ? `Couldn’t load the office: ${error}` : "Opening the office…"}</div>;

  const night = snap.istHour >= 20 || snap.istHour < 7;
  const count = (a: string[]) => snap.people.filter((p) => a.includes(p.activity)).length;
  const sel = snap.people.find((p) => p.code === selected) ?? null;
  const deptInfo = snap.departments.find((d) => d.code === dept) ?? null;
  const connColor = (s: string) => (s === "CONNECTED" ? "#3fbf7f" : s === "DISCONNECTED" ? "#9aa49e" : s === "DEGRADED" || s === "PERMISSION_REQUIRED" ? "#e2b23c" : "#e0566f");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className={`rounded-full px-2.5 py-1 font-medium ${snap.workerOnline ? "bg-forest-50 text-forest-700" : "bg-plum-50 text-plum-700"}`}>● {snap.workerOnline ? "Office open — worker online" : "Worker offline — nobody can move"}</span>
        <span className="surface rounded-full px-2.5 py-1">💻 {count(["working", "review"])} working</span>
        <span className="surface rounded-full px-2.5 py-1">🚶 {count(["walking_to_desk"])} heading to desk</span>
        <span className="surface rounded-full px-2.5 py-1">✉️ {snap.approvals.length} waiting for you</span>
        <span className="surface rounded-full px-2.5 py-1">☕ {count(["idle"])} on a break</span>
        {snap.debate && <span className="rounded-full bg-gold-100 px-2.5 py-1 font-medium text-gold-700">🗣 Boardroom: debate round {snap.debate.round}/5</span>}
        {snap.incidents.length > 0 && <span className="rounded-full bg-plum-600 px-2.5 py-1 font-medium text-white">🚨 {snap.incidents.length} incident(s)</span>}
        <label className="ml-auto flex items-center gap-1.5"><input type="checkbox" checked={names} onChange={(e) => setNames(e.target.checked)} /> Show names</label>
      </div>

      <div className="relative overflow-x-auto rounded-xl border border-[var(--line)] bg-[#efe9dc]">
        <svg viewBox={`0 0 ${W} ${H}`} className="block min-w-[1100px] select-none" role="img" aria-label="Rootellect HQ live office">
          <defs>
            <pattern id="tile" width="40" height="40" patternUnits="userSpaceOnUse"><rect width="40" height="40" fill="#f6f2e9" /><path d="M40 0H0V40" fill="none" stroke="#ece5d6" strokeWidth="1" /></pattern>
            <radialGradient id="glow"><stop offset="0%" stopColor="#bfe8ff" stopOpacity="0.9" /><stop offset="100%" stopColor="#bfe8ff" stopOpacity="0" /></radialGradient>
            <linearGradient id="glass" x1="0" x2="1"><stop offset="0" stopColor="#dff0ee" stopOpacity="0.55" /><stop offset="1" stopColor="#f7fbfa" stopOpacity="0.35" /></linearGradient>
            <style>{`
              .bob[data-walking="1"] .body { animation: bob .45s ease-in-out infinite alternate; }
              @keyframes bob { from { transform: translateY(0) } to { transform: translateY(-2.2px) } }
              .screen-on { animation: flick 1.6s ease-in-out infinite; }
              @keyframes flick { 0%,100% { opacity: 1 } 50% { opacity: .72 } }
              .typing circle { animation: dot 1.2s infinite; } .typing circle:nth-child(2){animation-delay:.2s} .typing circle:nth-child(3){animation-delay:.4s}
              @keyframes dot { 0%,60%,100% { opacity:.2 } 30% { opacity:1 } }
              .ripple { animation: rip 3s linear infinite; transform-origin: 800px 335px; }
              @keyframes rip { from { transform: scale(.6); opacity:.8 } to { transform: scale(1.5); opacity:0 } }
              .alarm { animation: alarm 1s steps(2) infinite; } @keyframes alarm { 50% { opacity: .15 } }
              .room:hover .roomfill { fill: #fffdf7 }
              @media (prefers-reduced-motion: reduce) { .bob .body, .screen-on, .typing circle, .ripple, .alarm { animation: none } }
            `}</style>
          </defs>

          {/* floor + corridor */}
          <rect width={W} height={H} fill="url(#tile)" />
          <rect x={RING.l - 8} y={RING.t - 8} width={RING.r - RING.l + 16} height={RING.b - RING.t + 16} fill="none" stroke="#e3dccb" strokeWidth="14" rx="10" />

          {/* atrium: garden, fountain, boardroom, reception */}
          <g>
            <ellipse cx="800" cy="335" rx="300" ry="62" fill="#cfe5cf" />
            {[[560, 320], [620, 300], [980, 300], [1040, 322], [700, 290], [900, 290]].map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="18" fill="#79b07a" /><circle cx={x - 6} cy={y - 6} r="10" fill={i % 2 ? "#e9a7c4" : "#93c48f"} /></g>)}
            <circle cx="800" cy="335" r="34" fill="#9fd3ec" stroke="#e8e2d2" strokeWidth="6" />
            <circle className="ripple" cx="800" cy="335" r="20" fill="none" stroke="#ffffff" strokeWidth="2" />
            <circle cx="800" cy="335" r="7" fill="#e6f6ff" />
            <g onClick={() => snap.debate && (go(`/debates/${snap.debate.id}`))} style={{ cursor: snap.debate ? "pointer" : "default" }}>
              <ellipse cx={BOARD.cx} cy={BOARD.cy} rx={BOARD.rx + 40} ry={BOARD.ry + 38} fill="url(#glass)" stroke="#a9cfc9" strokeWidth="2" />
              <ellipse cx={BOARD.cx} cy={BOARD.cy} rx={BOARD.rx} ry={BOARD.ry} fill="#fbfaf6" stroke="#d8d0bd" strokeWidth="3" />
              <rect x={BOARD.cx - 70} y={BOARD.cy - 112} width="140" height="26" rx="4" fill="#0f2a1e" />
              <text x={BOARD.cx} y={BOARD.cy - 95} textAnchor="middle" fontSize="11" fill={snap.debate ? "#e2c47f" : "#aed1bd"} fontWeight="600">{snap.debate ? `LIVE DEBATE · ROUND ${snap.debate.round}/5` : "EXECUTIVE BOARDROOM"}</text>
              {Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * Math.PI * 2; return <rect key={i} x={BOARD.cx + Math.cos(a) * (BOARD.rx + 8) - 6} y={BOARD.cy + Math.sin(a) * (BOARD.ry + 7) - 6} width="12" height="12" rx="3" fill="#8b5e3c" />; })}
              {snap.debate && ["OpenAI", "Claude", "Gemini"].map((n, i) => { const a = Math.PI * (1.25 + i * 0.25); const x = BOARD.cx + Math.cos(a) * (BOARD.rx + 14), y = BOARD.cy + Math.sin(a) * (BOARD.ry + 12); return <g key={n} transform={`translate(${x} ${y})`}><rect x="-9" y="-9" width="18" height="18" rx="5" fill={["#10a37f", "#d97757", "#4285f4"][i]} /><text y="4" textAnchor="middle" fontSize="9" fill="#fff" fontWeight="700">{n[0]}</text><text y="22" textAnchor="middle" fontSize="8" fill="#2b332e">{n}</text></g>; })}
              {snap.debate && <text x={BOARD.cx} y={BOARD.cy + 4} textAnchor="middle" fontSize="10" fill="#2b332e">{snap.debate.question.slice(0, 48)}{snap.debate.question.length > 48 ? "…" : ""}</text>}
            </g>
            <g onClick={() => go("/approvals")} style={{ cursor: "pointer" }}>
              <rect x="690" y="690" width="220" height="44" rx="8" fill="#f4efe6" stroke="#d8d0bd" />
              <text x="800" y="708" textAnchor="middle" fontSize="13" fontWeight="700" fill="#1b4631">Rootellect</text>
              <text x="800" y="725" textAnchor="middle" fontSize="9" fill="#5f6b64">RECEPTION · {snap.approvals.length} awaiting your signature</text>
            </g>
            {[[460, 420], [1140, 420], [460, 600], [1140, 600], [600, 720], [1000, 720]].map(([x, y], i) => <g key={i}><circle cx={x} cy={y} r="14" fill="#6fa56f" /><circle cx={x + 4} cy={y - 4} r="8" fill="#8fc28a" /></g>)}
          </g>

          {/* rooms */}
          {Object.entries(ROOMS).map(([key, r]) => {
            const isDept = key in DEPT_COLOR;
            const d = snap.departments.find((x) => x.code === key);
            const hot = d ? Math.min(1, d.busy / 4) : 0;
            const alarm = key === "C" && snap.incidents.length > 0;
            return (
              <g key={key} className="room" onClick={() => { if (isDept) { setDept(key); setSelected(null); } else if (key === "FOUNDER") go("/approvals"); else if (key === "LIB") go("/knowledge"); }} style={{ cursor: isDept || key === "FOUNDER" || key === "LIB" ? "pointer" : "default" }}>
                <rect className="roomfill" x={r.x} y={r.y} width={r.w} height={r.h} rx="8" fill="#fbf9f4" stroke={dept === key ? "#c49a3c" : "#d9d1bf"} strokeWidth={dept === key ? 3 : 2} />
                {isDept && <rect x={r.x} y={r.y} width={r.w} height="5" rx="2" fill={DEPT_COLOR[key]} opacity={0.35 + hot * 0.65} />}
                <rect x={r.x + 10} y={r.y + 12} width={Math.min(r.w - 20, r.label.length * 7.2 + 16)} height="20" rx="10" fill="#ffffff" stroke="#e6dfcf" />
                <text x={r.x + 18} y={r.y + 26} fontSize="11.5" fontWeight="700" fill="#1d2420">{r.label}</text>
                {d && <text x={r.x + r.w - 12} y={r.y + 26} textAnchor="end" fontSize="10" fill="#5f6b64">{d.busy} busy · {d.open} open · {d.doneToday} done today</text>}
                {alarm && <rect pointerEvents="none" className="alarm" x={r.x} y={r.y} width={r.w} height={r.h} rx="8" fill="none" stroke="#e0566f" strokeWidth="4" />}
                {/* plants */}
                <circle cx={r.x + r.w - 14} cy={r.y + r.h - 14} r="9" fill="#79b07a" />
              </g>
            );
          })}

          {/* desks */}
          {snap.people.filter((p) => p.dept in DEPT_COLOR).map((p) => {
            const { desk } = deskSeat(p.dept, layout.deskIndex.get(p.code) ?? 0);
            const atDesk = ["working", "review", "blocked", "paused"].includes(p.activity);
            const on = atDesk && p.activity !== "paused";
            return (
              <g key={`desk-${p.code}`} pointerEvents="none">
                <rect x={desk.x - 27} y={desk.y - 9} width="54" height="20" rx="3" fill={p.isManager ? "#e8d9bd" : "#efe6d4"} stroke="#d4c6a8" />
                <rect x={desk.x - 10} y={desk.y - 7} width="20" height="12" rx="1.5" fill={on ? "#1d3b5c" : "#3a4440"} />
                {on && <rect className="screen-on" x={desk.x - 8.5} y={desk.y - 5.5} width="17" height="9" fill={p.activity === "blocked" ? "#e0566f" : "#5ec8f2"} opacity="0.9" />}
                {on && <><rect x={desk.x - 7} y={desk.y - 4} width="10" height="1.3" fill="#e6f7ff" /><rect x={desk.x - 7} y={desk.y - 1.5} width="13" height="1.3" fill="#e6f7ff" /><rect x={desk.x - 7} y={desk.y + 1} width="7" height="1.3" fill="#e6f7ff" /></>}
                {on && <circle cx={desk.x} cy={desk.y} r="22" fill="url(#glow)" opacity="0.35" />}
                <rect x={desk.x - 6} y={desk.y + 6} width="12" height="3" rx="1" fill="#c9bfa9" />
                {p.isManager && <text x={desk.x + 24} y={desk.y - 11} textAnchor="end" fontSize="7" fill="#8a6a22" fontWeight="700">MGR</text>}
              </g>
            );
          })}

          {/* server room (Engineering) — one LED per integration */}
          <g onClick={(e) => { e.stopPropagation(); go("/integrations"); }} style={{ cursor: "pointer" }}>
            <rect x="700" y="140" width="72" height="62" rx="4" fill="#20272b" />
            <text x="736" y="214" textAnchor="middle" fontSize="8" fill="#5f6b64" fontWeight="700">SERVER ROOM</text>
            {snap.connectors.map((c, i) => <circle key={c.key} cx={709 + (i % 6) * 11} cy={152 + Math.floor(i / 6) * 13} r="3.4" fill={connColor(c.status)}><title>{`${c.name}: ${c.status}`}</title></circle>)}
          </g>
          {/* QA incident board */}
          <g onClick={(e) => { e.stopPropagation(); go("/incidents"); }} style={{ cursor: "pointer" }}>
            <rect x="1078" y="146" width="104" height="50" rx="4" fill="#0f2a1e" />
            <text x="1130" y="163" textAnchor="middle" fontSize="8.5" fill="#aed1bd" fontWeight="700">INCIDENT COMMAND</text>
            <text x="1130" y="183" textAnchor="middle" fontSize="10" fill={snap.incidents.length ? "#ff8aa0" : "#7fe0a8"} fontWeight="700">{snap.incidents.length ? `${snap.incidents.length} open` : "✓ System stable"}</text>
          </g>
          {/* founder's desk with approval envelopes */}
          <g>
            <rect x="120" y="690" width="110" height="34" rx="4" fill="#e8d9bd" stroke="#d4c6a8" />
            <text x="175" y="742" textAnchor="middle" fontSize="9" fill="#5f6b64">You · {snap.approvals.length} to sign</text>
            {snap.approvals.slice(0, 8).map((a, i) => <rect key={a.id} x={132 + i * 9} y={695 - i * 1.5} width="16" height="11" rx="1.5" fill="#fff" stroke="#c49a3c" />)}
            <g transform="translate(175 676)"><circle r="7" fill="#e0ac83" /><path d="M-7 -2 Q0 -12 7 -2" fill="#151515" /><rect x="-8" y="6" width="16" height="12" rx="5" fill="#0d2318" /></g>
          </g>
          {/* amenity furniture */}
          <g opacity="0.9">
            {[0, 1, 2, 3, 4].map((i) => <rect key={`shelf${i}`} x={40 + i * 70} y="832" width="56" height="10" rx="2" fill="#a07850" />)}
            {[0, 1, 2, 3, 4, 5].map((i) => <rect key={`mat${i}`} x={440 + i * 58} y="840" width="38" height="16" rx="3" fill="#c7a6d8" />)}
            {[0, 1, 2, 3, 4].map((i) => <circle key={`tbl${i}`} cx={850 + i * 72} cy="850" r="13" fill="#e7dcc6" stroke="#cdbfa3" />)}
            <rect x="1250" y="836" width="80" height="40" rx="6" fill="#2f7d4f" stroke="#7a5a3a" strokeWidth="4" />
            <rect x="1400" y="840" width="120" height="22" rx="8" fill="#d8c08a" />
          </g>
          {/* queue sign */}
          {snap.approvals.length > 0 && <text x="425" y="622" fontSize="9" fill="#8a6a22" fontWeight="700">QUEUE · WAITING FOR FOUNDER</text>}

          {/* people */}
          {snap.people.map((p) => {
            const color = DEPT_COLOR[p.dept] ?? "#555";
            const h = hash(p.code);
            const isSel = selected === p.code;
            const showLabel = names || isSel || hover === p.code;
            const bubble = isSel || hover === p.code ? (p.task?.title ?? p.bubble ?? ACTIVITY_LABEL[p.activity]) : null;
            const start = layout.places.get(p.code)!.pos;
            return (
              <g key={p.code} ref={(el) => { if (el) { nodes.current.set(p.code, el); if (!el.getAttribute("transform")) el.setAttribute("transform", `translate(${start.x} ${start.y})`); } }} className="bob" data-code={p.code}
                onClick={(e) => { e.stopPropagation(); setSelected(p.code); setDept(null); }} onMouseEnter={() => setHover(p.code)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }} opacity={p.status === "PAUSED" ? 0.45 : 1}>
                <circle r="15" cy="2" fill="transparent" />
                <ellipse cx="0" cy="11" rx="8" ry="2.6" fill="#000" opacity="0.13" />
                <g className="body">
                  <rect x="-6.5" y="-1" width="13" height="12" rx="5" fill={color} stroke={isSel ? "#c49a3c" : "none"} strokeWidth="2" />
                  <circle cx="0" cy="-6" r="5.2" fill={SKIN[h % SKIN.length]} />
                  <path d={h % 3 === 0 ? "M-5.4 -6.5 Q0 -14 5.4 -6.5 L5.4 -3 Q4 -8 0 -8 Q-4 -8 -5.4 -3Z" : "M-5.3 -6 Q0 -13 5.3 -6 Q2 -9 0 -9 Q-2 -9 -5.3 -6Z"} fill={HAIR[h % HAIR.length]} />
                  {p.isManager && <rect x="-3" y="2" width="6" height="2" rx="1" fill="#e2c47f" />}
                </g>
                {p.activity === "working" && <g className="typing" transform="translate(9 -14)"><rect x="-2" y="-5" width="18" height="9" rx="4.5" fill="#fff" stroke="#ddd" /><circle cx="2.5" cy="-0.5" r="1.3" fill="#1b4631" /><circle cx="7" cy="-0.5" r="1.3" fill="#1b4631" /><circle cx="11.5" cy="-0.5" r="1.3" fill="#1b4631" /></g>}
                {p.activity === "awaiting_approval" && <text x="8" y="-10" fontSize="11">✉️</text>}
                {p.activity === "blocked" && <text x="7" y="-9" fontSize="11" fill="#e0566f" fontWeight="800">!</text>}
                {p.activity === "paused" && <text x="7" y="-9" fontSize="9" fill="#5f6b64">z</text>}
                {p.status === "SHADOW" && <circle cx="-8" cy="-10" r="2.6" fill="#c49a3c"><title>Shadow mode</title></circle>}
                {showLabel && <text y="23" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#1d2420" stroke="#fbf9f4" strokeWidth="3" paintOrder="stroke">{p.code} {p.name.split(" ").slice(0, 3).join(" ")}</text>}
                {bubble && <g transform="translate(0 -26)"><rect x={-Math.min(150, bubble.length * 3.1 + 12)} y="-11" width={Math.min(300, bubble.length * 6.2 + 24)} height="18" rx="9" fill="#ffffff" stroke="#c49a3c" /><text y="2" textAnchor="middle" fontSize="9" fill="#1d2420">{bubble.slice(0, 46)}{bubble.length > 46 ? "…" : ""}</text></g>}
              </g>
            );
          })}

          {night && <rect width={W} height={H} fill="#0b1630" opacity="0.28" pointerEvents="none" />}
        </svg>

        {/* side panel */}
        {(sel || deptInfo) && (
          <div className="surface absolute right-3 top-3 max-h-[calc(100%-24px)] w-[min(380px,calc(100%-24px))] overflow-y-auto rounded-xl p-4 shadow-xl">
            <button className="muted absolute right-3 top-2 text-lg" onClick={() => { setSelected(null); setDept(null); }} aria-label="Close">×</button>
            {sel && (
              <>
                <div className="muted font-mono text-xs">{sel.code} · {ACTIVITY_LABEL[sel.activity]}</div>
                <div className="serif text-lg font-semibold">{sel.name}</div>
                {!standup ? <p className="muted mt-3 text-sm">Asking for a status report…</p> : (
                  <>
                    <div className="muted text-xs">{standup.department} · reports to {standup.manager} · ₹{standup.spendTodayInr.toFixed(2)} AI spend today</div>
                    <div className="surface-2 line mt-3 space-y-1.5 rounded-lg border p-3 text-sm leading-relaxed">{standup.report.map((l, i) => <p key={i}>{l}</p>)}</div>
                    <p className="muted mt-1 text-[11px]">{standup.note}</p>
                    {standup.openTasks.length > 0 && <div className="mt-3 space-y-1 text-sm">{standup.openTasks.map((t) => <Link key={t.id} href={`/tasks/${t.id}`} className="block hover:underline">→ {t.title} <span className="muted text-xs">({t.status.toLowerCase().replace(/_/g, " ")})</span></Link>)}</div>}
                    {standup.approvals.map((a) => <Link key={a.id} href={`/approvals/${a.id}`} className="mt-2 block rounded-lg bg-gold-100 px-3 py-2 text-sm text-gold-700">✉️ Review {a.shortCode}: {a.title}</Link>)}
                  </>
                )}
                <div className="line mt-4 border-t pt-3">
                  <div className="mb-2 text-sm font-medium">Give {sel.name.split(" ")[0]} a task</div>
                  <ActionForm action={assignAction} submit="Assign & start">
                    <input type="hidden" name="code" value={sel.code} />
                    <input name="title" required placeholder="e.g. Check why Mind Calm page is slow" className="mb-2 w-full rounded-lg px-3 py-2 text-sm" />
                    <textarea name="objective" rows={2} placeholder="Details (optional)" className="w-full rounded-lg px-3 py-2 text-sm" />
                  </ActionForm>
                </div>
                <Link href={`/organization/${sel.code}`} className="accent mt-3 inline-block text-xs font-medium">Open full profile →</Link>
              </>
            )}
            {deptInfo && !sel && (
              <>
                <div className="muted font-mono text-xs">Department {deptInfo.code}</div>
                <div className="serif text-lg font-semibold">{deptInfo.name}</div>
                <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="surface-2 rounded-lg p-2"><div className="serif text-xl font-semibold">{deptInfo.busy}</div>busy</div>
                  <div className="surface-2 rounded-lg p-2"><div className="serif text-xl font-semibold">{deptInfo.open}</div>open tasks</div>
                  <div className="surface-2 rounded-lg p-2"><div className="serif text-xl font-semibold">{deptInfo.doneToday}</div>done today</div>
                </div>
                <ul className="mt-3 space-y-1.5 text-sm">
                  {snap.people.filter((p) => p.dept === deptInfo.code).map((p) => <li key={p.code}><button className="w-full text-left hover:underline" onClick={() => setSelected(p.code)}><span className="muted font-mono text-xs">{p.code}</span> {p.name} <span className="muted text-xs">· {ACTIVITY_LABEL[p.activity].toLowerCase()}</span></button></li>)}
                </ul>
                <Link href={`/tasks?status=all&dept=${deptInfo.code}`} className="accent mt-3 inline-block text-xs font-medium">All department tasks →</Link>
              </>
            )}
          </div>
        )}
      </div>

      <div className="surface flex items-center gap-3 overflow-hidden rounded-xl px-4 py-2 text-xs">
        <span className="shrink-0 font-semibold">Live floor</span>
        <div className="flex gap-6 overflow-x-auto whitespace-nowrap">{snap.feed.length ? snap.feed.map((f) => <span key={f.seq}><span className="accent font-mono">{f.who}</span> {f.text} <span className="muted">· {f.at.split(", ").pop()}</span></span>) : <span className="muted">Quiet so far — assign work or start an audit.</span>}</div>
      </div>
      <p className="muted text-xs">Positions come from real records, refreshed every 6 s. Gold dot = shadow mode. Click a room for its department, the server rack for integrations, the incident board for the war room, the boardroom during a debate, reception or your office for approvals.</p>
    </div>
  );
}
