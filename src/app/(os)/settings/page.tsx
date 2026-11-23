import { db } from "@/core/db/client";
import { parseJson } from "@/core/db/json";
import { getSetting, SETTING_KEYS } from "@/core/settings";
import { POLICY_BY_KEY } from "@/core/tools/policies";
import { formatIst } from "@/core/time";
import { Card, Field, PageHeader, Pill, Table, Td, inputCls, Button } from "@/components/ui";
import { ActionForm, MfaSetup } from "@/components/client";
import { requireFounder } from "../../lib/session";
import { mfaAction, saveProviderAction, settingsAction, safetySwitchAction, toolPolicyAction, scheduleAction } from "../../actions";

export const metadata = { title: "Settings" };

const PROVIDER_NAME: Record<string, string> = { openai: "OpenAI", anthropic: "Anthropic Claude", gemini: "Google Gemini" };

export default async function Settings() {
  const { user } = await requireFounder();
  const [providers, policies, schedules, emergency, paused] = await Promise.all([
    db.modelProvider.findMany({ orderBy: { provider: "asc" } }),
    db.toolPolicy.findMany({ orderBy: [{ riskLevel: "asc" }, { toolKey: "asc" }] }),
    db.schedule.findMany({ orderBy: { name: "asc" } }),
    getSetting(SETTING_KEYS.emergencyStop, "false"),
    getSetting(SETTING_KEYS.productionWritesPaused, "false"),
  ]);
  const settings = Object.fromEntries(await Promise.all([SETTING_KEYS.founderEmail, SETTING_KEYS.founderWhatsapp, SETTING_KEYS.founderPhone, SETTING_KEYS.quietHours, SETTING_KEYS.storefrontUrl, SETTING_KEYS.stagingUrl, SETTING_KEYS.debateRiskThreshold, "product_paths", "post_release_verify_minutes"].map(async (k) => [k, await getSetting(k)])));
  return (
    <>
      <PageHeader title="Settings" subtitle="AI providers, founder contacts, safety switches, action policies and operating schedules. Every change is audited." />

      <Card title="Safety switches" className="mb-6">
        <div className="grid gap-4 md:grid-cols-2">
          <form action={safetySwitchAction} className="line flex items-center justify-between gap-4 rounded-lg border p-4">
            <div><div className="font-medium">Pause all production-changing actions</div><div className="muted text-xs">Blocks risk level 2+ (spend, deploys, publishing, pricing). Monitoring and drafts continue.</div></div>
            <input type="hidden" name="key" value={SETTING_KEYS.productionWritesPaused} /><input type="hidden" name="value" value={paused === "true" ? "false" : "true"} />
            <Button variant={paused === "true" ? "gold" : "ghost"}>{paused === "true" ? "Resume" : "Pause"}</Button>
          </form>
          <form action={safetySwitchAction} className="flex items-center justify-between gap-4 rounded-lg border border-plum-100 p-4 dark:border-plum-700">
            <div><div className="font-medium">Emergency stop</div><div className="muted text-xs">Halts every workflow and schedule; agents can only read. The watchdog keeps running.</div></div>
            <input type="hidden" name="key" value={SETTING_KEYS.emergencyStop} /><input type="hidden" name="value" value={emergency === "true" ? "false" : "true"} />
            <Button variant="danger">{emergency === "true" ? "Turn off" : "Stop everything"}</Button>
          </form>
        </div>
      </Card>

      <div id="providers" className="mb-6 grid gap-6 xl:grid-cols-3">
        {providers.map((p) => {
          const tiers = parseJson<Record<string, string>>(p.tierModels, {});
          const models = parseJson<string[]>(p.models, []);
          return (
            <Card key={p.provider} title={PROVIDER_NAME[p.provider]} action={<Pill>{p.status === "NOT_CONFIGURED" ? "DISCONNECTED" : p.status}</Pill>}>
              <ActionForm action={saveProviderAction} submit="Save & test connection">
                <input type="hidden" name="provider" value={p.provider} />
                <div className="space-y-3">
                  <Field label="API key" help={p.keyHint ? `Saved key ${p.keyHint} — leave blank to keep` : "Stored encrypted; never shown again or sent to the browser."}><input name="apiKey" type="password" autoComplete="off" className={inputCls} /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="enabled" defaultChecked={p.enabled || !p.encryptedKey} /> Enabled</label>
                  {(["fast", "balanced", "deep"] as const).map((t) => (
                    <Field key={t} label={`${t[0].toUpperCase()}${t.slice(1)} tier model`}>
                      <input name={t} list={`models-${p.provider}`} defaultValue={tiers[t] ?? ""} placeholder={models.length ? "choose a discovered model" : "save a key to discover models"} className={inputCls} />
                    </Field>
                  ))}
                  <datalist id={`models-${p.provider}`}>{models.map((m) => <option key={m} value={m} />)}</datalist>
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Requests / min"><input name="rateLimitPerMin" type="number" defaultValue={p.rateLimitPerMin} className={inputCls} /></Field>
                    <Field label="₹ per US$"><input name="inrPerUsd" type="number" step="0.01" defaultValue={p.inrPerUsd} className={inputCls} /></Field>
                  </div>
                  <Field label="Price table (USD per million tokens)" help='JSON, e.g. {"model-id": {"inPerMTok": 3, "outPerMTok": 15}}. Without it, costs are shown as estimates.'><textarea name="priceTable" rows={2} defaultValue={p.priceTable === "{}" ? "" : p.priceTable} className={`${inputCls} font-mono text-xs`} /></Field>
                </div>
              </ActionForm>
              {p.lastError && <p className="mt-2 text-xs text-plum-600">{p.lastError}</p>}
              {p.lastTestedAt && <p className="muted mt-1 text-xs">Tested {formatIst(p.lastTestedAt)} · {models.length} models discovered</p>}
            </Card>
          );
        })}
      </div>

      <Card title="Two-factor sign-in" className="mb-6">
        <MfaSetup action={mfaAction} enabled={Boolean(user.mfaSecret)} />
      </Card>

      <Card title="Founder & storefront" className="mb-6">
        <ActionForm action={settingsAction} submit="Save settings">
          <div className="grid gap-4 md:grid-cols-3">
            <Field label="Founder email"><input name={SETTING_KEYS.founderEmail} defaultValue={settings[SETTING_KEYS.founderEmail]} className={inputCls} /></Field>
            <Field label="Founder WhatsApp (E.164)" help="Only this number can command the OS over WhatsApp"><input name={SETTING_KEYS.founderWhatsapp} defaultValue={settings[SETTING_KEYS.founderWhatsapp]} placeholder="+9198…" className={inputCls} /></Field>
            <Field label="Phone for urgent voice calls" help="Explicit opt-in: leave blank to disable calls"><input name={SETTING_KEYS.founderPhone} defaultValue={settings[SETTING_KEYS.founderPhone]} className={inputCls} /></Field>
            <Field label="Quiet hours (IST)" help="e.g. 22:30-07:30 — SEV1 and approvals still come through"><input name={SETTING_KEYS.quietHours} defaultValue={settings[SETTING_KEYS.quietHours]} className={inputCls} /></Field>
            <Field label="Storefront URL"><input name={SETTING_KEYS.storefrontUrl} defaultValue={settings[SETTING_KEYS.storefrontUrl]} className={inputCls} /></Field>
            <Field label="Staging URL" help="Transaction tests run here, never on production"><input name={SETTING_KEYS.stagingUrl} defaultValue={settings[SETTING_KEYS.stagingUrl]} className={inputCls} /></Field>
            <Field label="Product page paths" help="Comma-separated, e.g. /products/mind-calm. Blank = read from sitemap"><input name="product_paths" defaultValue={settings.product_paths} className={inputCls} /></Field>
            <Field label="Debate risk threshold" help="Tasks at or above this risk level get a five-round debate"><input name={SETTING_KEYS.debateRiskThreshold} type="number" min="1" max="4" defaultValue={settings[SETTING_KEYS.debateRiskThreshold]} className={inputCls} /></Field>
            <Field label="Post-release verification delay (min)"><input name="post_release_verify_minutes" type="number" min="0" defaultValue={settings.post_release_verify_minutes || "4"} className={inputCls} /></Field>
          </div>
        </ActionForm>
      </Card>

      <Card title="Action policies (enforced by the tool gateway)" className="mb-6" pad={false}>
        <p className="muted px-5 pt-4 text-xs">Level 0 read-only · 1 drafts/sandbox · 2 pre-authorised with caps (standing approval) · 3 needs your approval · 4 needs a named qualified reviewer. Level-4 tools can’t be downgraded. Agents can’t change these.</p>
        <Table head={["Tool", "Level", "Standing approval (L2)", "Per-action cap ₹", "Daily cap ₹", "Enabled", ""]} dense>
          {policies.map((p) => (
            <tr key={p.toolKey}>
              <Td dense><span className="font-mono text-xs">{p.toolKey}</span><div className="muted text-[11px]">{POLICY_BY_KEY[p.toolKey]?.title}</div></Td>
              <Td dense colSpan={6}>
                <form action={toolPolicyAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="toolKey" value={p.toolKey} />
                  <select name="riskLevel" defaultValue={String(p.riskLevel)} className="rounded-lg px-2 py-1 text-xs">{[0, 1, 2, 3, 4].map((l) => <option key={l} value={l}>L{l}</option>)}</select>
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="standingApproval" defaultChecked={p.standingApproval} disabled={p.riskLevel !== 2} /> standing</label>
                  <input name="capInr" type="number" min="0" defaultValue={p.capInr ?? ""} placeholder="—" className="w-20 rounded-lg px-2 py-1 text-xs" />
                  <input name="dailyCapInr" type="number" min="0" defaultValue={p.dailyCapInr ?? ""} placeholder="—" className="w-20 rounded-lg px-2 py-1 text-xs" />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="enabled" defaultChecked={p.enabled} /> on</label>
                  <button className="accent text-xs hover:underline">Save</button>
                </form>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>

      <Card title="Operating schedules (IST)" pad={false}>
        <Table head={["Schedule", "Workflow", "Cron", "Next run", ""]} dense>
          {schedules.map((s) => (
            <tr key={s.id}>
              <Td dense className="font-medium">{s.name}<div className="muted text-[11px] font-normal">{s.description}</div></Td>
              <Td dense className="font-mono text-xs">{s.workflowType}</Td>
              <Td dense colSpan={3}>
                <form action={scheduleAction} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="name" value={s.name} />
                  <input name="cron" defaultValue={s.cron} className="w-32 rounded-lg px-2 py-1 font-mono text-xs" />
                  <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="enabled" defaultChecked={s.enabled} /> enabled</label>
                  <span className="muted text-xs">next {formatIst(s.nextRunAt)}</span>
                  <button className="accent text-xs hover:underline">Save</button>
                </form>
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
