import { db } from "@/core/db/client";
import { formatIst, msFromNow } from "@/core/time";
import { getSetting, SETTING_KEYS } from "@/core/settings";
import { Card, Field, PageHeader, Pill, Table, Td, inputCls, Button } from "@/components/ui";
import { calendarAction } from "../../actions";

export const metadata = { title: "Calendar & Communications" };

export default async function Comms() {
  const [notifications, events, email, wa, phone, quiet, ws] = await Promise.all([
    db.notification.findMany({ orderBy: { createdAt: "desc" }, take: 60 }),
    db.calendarEvent.findMany({ where: { startsAt: { gte: msFromNow(-86400_000) } }, orderBy: { startsAt: "asc" }, take: 40 }),
    getSetting(SETTING_KEYS.founderEmail), getSetting(SETTING_KEYS.founderWhatsapp), getSetting(SETTING_KEYS.founderPhone), getSetting(SETTING_KEYS.quietHours),
    db.connector.findMany({ where: { key: { in: ["smtp", "whatsapp", "exotel", "google_workspace"] } } }),
  ]);
  return (
    <>
      <PageHeader title="Calendar & Communications" subtitle="Executive agenda, deadlines and every message the OS sent you — WhatsApp, email and (for SEV1 only) voice calls, with delivery status and acknowledgement." />
      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Escalation policy">
          <ul className="space-y-2 text-sm">
            <li><Pill>SEV1</Pill> WhatsApp + email immediately; voice call if not acknowledged in 10 min</li>
            <li><Pill>SEV2</Pill> WhatsApp + email (held in quiet hours unless unacknowledged for 60 min)</li>
            <li><Pill tone="warn">approval</Pill> WhatsApp + email with a signed, time-limited link; level 3+ approve only in the dashboard</li>
            <li><Pill tone="info">reports</Pill> email + dashboard</li>
          </ul>
          <div className="line mt-4 space-y-1 border-t pt-3 text-xs">
            <div>Email: <strong>{email || "not set"}</strong></div><div>WhatsApp: <strong>{wa || "not set"}</strong></div><div>Voice: <strong>{phone || "not set"}</strong></div><div>Quiet hours (IST): <strong>{quiet || "none"}</strong></div>
            <div className="flex flex-wrap gap-2 pt-2">{ws.map((c) => <span key={c.key} className="flex items-center gap-1">{c.name} <Pill>{c.status}</Pill></span>)}</div>
          </div>
        </Card>
        <Card title="Agenda & deadlines" className="xl:col-span-2">
          <ul className="mb-4 space-y-1.5 text-sm">{events.length ? events.map((e) => <li key={e.id} className="flex gap-3"><span className="muted w-44 shrink-0 text-xs">{formatIst(e.startsAt)}</span><Pill tone="info">{e.kind}</Pill><span>{e.title}</span></li>) : <li className="muted">Nothing scheduled. Connect Google Calendar or add deadlines below.</li>}</ul>
          <form action={calendarAction} className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto]">
            <Field label="Title"><input name="title" required className={inputCls} /></Field>
            <Field label="When"><input name="startsAt" type="datetime-local" required className={inputCls} /></Field>
            <Field label="Kind"><select name="kind" className={inputCls}>{["deadline", "meeting", "launch", "review", "reminder"].map((k) => <option key={k}>{k}</option>)}</select></Field>
            <div className="self-end"><Button variant="ghost">Add</Button></div>
          </form>
        </Card>
        <Card title="Notification log" className="xl:col-span-3" pad={false}>
          <Table head={["Channel", "Subject", "Severity", "Status", "Sent", "Acknowledged"]} dense>
            {notifications.map((n) => <tr key={n.id}><Td dense><Pill tone="info">{n.channel}</Pill></Td><Td dense className="max-w-md"><div className="truncate">{n.subject}</div>{n.error && <div className="truncate text-[11px] text-plum-600">{n.error}</div>}</Td><Td dense><Pill>{n.severity}</Pill></Td><Td dense><Pill>{n.status}</Pill>{n.attempts > 1 && <span className="muted ml-1 text-[11px]">×{n.attempts}</span>}</Td><Td dense className="muted text-xs">{formatIst(n.sentAt)}</Td><Td dense className="muted text-xs">{formatIst(n.ackedAt)}</Td></tr>)}
          </Table>
        </Card>
      </div>
    </>
  );
}
