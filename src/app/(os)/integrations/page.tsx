import { db } from "@/core/db/client";
import { CONNECTORS } from "@/core/connectors/defs";
import { formatIst } from "@/core/time";
import { Card, PageHeader, Pill, inputCls } from "@/components/ui";
import { ActionForm } from "@/components/client";
import { checkConnectorAction, disconnectConnectorAction, saveConnectorAction, startWorkflowAction } from "../../actions";

export const metadata = { title: "Integration Hub" };

export default async function Integrations() {
  const rows = Object.fromEntries((await db.connector.findMany()).map((r) => [r.key, r]));
  const cats = [...new Set(CONNECTORS.map((c) => c.category))];
  return (
    <>
      <PageHeader title="Integration Hub" subtitle="Credentials are encrypted (AES-256-GCM) before storage, never shown again, never sent to AI models, and never logged. A connector is marked Connected only after an authenticated call succeeds. Broken connectors open a repair task automatically."
        actions={<form action={startWorkflowAction}><input type="hidden" name="type" value="connector-health" /><button className="surface rounded-lg px-3.5 py-2 text-sm">Check all now</button></form>} />
      {cats.map((cat) => (
        <div key={cat} className="mb-8">
          <h2 className="muted mb-3 text-xs font-semibold uppercase tracking-[0.14em]">{cat}</h2>
          <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
            {CONNECTORS.filter((c) => c.category === cat).map((c) => {
              const r = rows[c.key];
              const configured = Boolean(r?.encryptedConfig);
              return (
                <Card key={c.key} title={<span className="flex items-center gap-2">{c.name}{c.mode === "browser-assisted" && <Pill tone="info">assisted</Pill>}</span>} action={<Pill>{r?.status ?? "DISCONNECTED"}</Pill>}>
                  <p className="muted text-xs">{c.description}</p>
                  {r?.configHint && <p className="mt-2 text-xs">{r.configHint}</p>}
                  {r?.lastError && <p className="mt-2 rounded bg-plum-50 px-2 py-1 text-xs text-plum-700 dark:bg-plum-900 dark:text-plum-100">{r.lastError}</p>}
                  <div className="muted mt-2 text-[11px]">Capabilities: {c.capabilities.join(", ")}{r?.lastCheckAt ? ` · checked ${formatIst(r.lastCheckAt)}` : ""}</div>
                  <details className="mt-3">
                    <summary className="accent cursor-pointer text-xs font-medium">{configured ? "Update credentials" : "Connect"}</summary>
                    <ActionForm action={saveConnectorAction} submit={configured ? "Save & test" : "Connect & test"} className="mt-3">
                      <input type="hidden" name="key" value={c.key} />
                      <div className="space-y-2.5">
                        {c.fields.map((f) => (
                          <label key={f.name} className="block text-xs">
                            <span className="mb-1 block font-medium">{f.label}{f.required ? "" : " (optional)"}</span>
                            {f.name === "serviceAccountJson"
                              ? <textarea name={`f_${f.name}`} rows={3} placeholder={configured ? "•••• saved — leave blank to keep" : "{ \"type\": \"service_account\", … }"} className={`${inputCls} font-mono text-xs`} />
                              : <input name={`f_${f.name}`} type={f.secret ? "password" : "text"} autoComplete="off" placeholder={f.secret && configured ? "•••• saved — leave blank to keep" : f.placeholder} className={inputCls} />}
                            {f.help && <span className="muted mt-0.5 block">{f.help}</span>}
                          </label>
                        ))}
                      </div>
                    </ActionForm>
                  </details>
                  {configured && (
                    <div className="mt-3 flex gap-3 text-xs">
                      <form action={checkConnectorAction}><input type="hidden" name="key" value={c.key} /><button className="accent hover:underline">Test now</button></form>
                      <form action={disconnectConnectorAction}><input type="hidden" name="key" value={c.key} /><button className="muted hover:underline">Disconnect</button></form>
                      {c.docs && c.docs.startsWith("http") && <a href={c.docs} target="_blank" rel="noreferrer" className="muted ml-auto hover:underline">API docs ↗</a>}
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}
