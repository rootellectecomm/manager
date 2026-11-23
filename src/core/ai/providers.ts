/**
 * Provider adapters. Each one speaks the provider's official REST API directly
 * (no SDK lock-in), returns plain text + token usage, and discovers models at
 * runtime — model ids are configured per tier in the dashboard, never hardcoded.
 *
 * API versions are kept in one place (API) so upgrades are a one-line change
 * reviewed by the API Integration Engineer.
 */
export type ProviderId = "openai" | "anthropic" | "gemini";

export const API = {
  openai: { base: "https://api.openai.com/v1" },
  anthropic: { base: "https://api.anthropic.com/v1", version: "2023-06-01" },
  gemini: { base: "https://generativelanguage.googleapis.com/v1beta" },
} as const;

export interface CompletionRequest {
  model: string;
  system: string;
  prompt: string;
  json: boolean;
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

export interface CompletionResult { text: string; tokensIn: number; tokensOut: number; model: string }

export class ProviderError extends Error {
  constructor(public provider: string, public status: number, message: string, public retryable: boolean) {
    super(`${provider} ${status}: ${message}`);
  }
}

async function http(provider: ProviderId, url: string, init: RequestInit): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch (e) {
    throw new ProviderError(provider, 0, `network error: ${(e as Error).message}`, true);
  }
  const text = await res.text();
  if (!res.ok) {
    const retryable = res.status === 429 || res.status >= 500;
    let msg = text.slice(0, 400);
    try { const b = JSON.parse(text); msg = b.error?.message ?? b.message ?? msg; } catch { /* keep raw */ }
    throw new ProviderError(provider, res.status, msg, retryable);
  }
  return JSON.parse(text);
}

// ───────── OpenAI (Responses API) ─────────
async function openaiComplete(key: string, r: CompletionRequest): Promise<CompletionResult> {
  const body: Record<string, unknown> = {
    model: r.model,
    instructions: r.system,
    input: r.prompt,
    max_output_tokens: r.maxOutputTokens ?? 4000,
  };
  if (r.json) body.text = { format: { type: "json_object" } };
  const data = (await http("openai", `${API.openai.base}/responses`, {
    method: "POST", signal: r.signal,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })) as { output?: { type: string; content?: { type: string; text?: string }[] }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
  const text = (data.output ?? [])
    .filter((o) => o.type === "message")
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text")
    .map((c) => c.text ?? "")
    .join("");
  return { text, tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0, model: data.model ?? r.model };
}

async function openaiModels(key: string): Promise<string[]> {
  const data = (await http("openai", `${API.openai.base}/models`, { headers: { Authorization: `Bearer ${key}` } })) as { data: { id: string }[] };
  return data.data.map((m) => m.id).sort();
}

// ───────── Anthropic (Messages API) ─────────
async function anthropicComplete(key: string, r: CompletionRequest): Promise<CompletionResult> {
  const data = (await http("anthropic", `${API.anthropic.base}/messages`, {
    method: "POST", signal: r.signal,
    headers: { "x-api-key": key, "anthropic-version": API.anthropic.version, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: r.model,
      max_tokens: r.maxOutputTokens ?? 4000,
      system: r.json ? `${r.system}\n\nRespond with a single JSON object only — no prose before or after it.` : r.system,
      messages: [{ role: "user", content: r.prompt }],
    }),
  })) as { content: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number }; model?: string };
  const text = data.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
  return { text, tokensIn: data.usage?.input_tokens ?? 0, tokensOut: data.usage?.output_tokens ?? 0, model: data.model ?? r.model };
}

async function anthropicModels(key: string): Promise<string[]> {
  const data = (await http("anthropic", `${API.anthropic.base}/models?limit=100`, {
    headers: { "x-api-key": key, "anthropic-version": API.anthropic.version },
  })) as { data: { id: string }[] };
  return data.data.map((m) => m.id).sort();
}

// ───────── Google Gemini (generateContent) ─────────
async function geminiComplete(key: string, r: CompletionRequest): Promise<CompletionResult> {
  const data = (await http("gemini", `${API.gemini.base}/models/${encodeURIComponent(r.model)}:generateContent`, {
    method: "POST", signal: r.signal,
    headers: { "x-goog-api-key": key, "Content-Type": "application/json" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: r.system }] },
      contents: [{ role: "user", parts: [{ text: r.prompt }] }],
      generationConfig: { maxOutputTokens: r.maxOutputTokens ?? 4000, ...(r.json ? { responseMimeType: "application/json" } : {}) },
    }),
  })) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }; modelVersion?: string };
  const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
  return { text, tokensIn: data.usageMetadata?.promptTokenCount ?? 0, tokensOut: data.usageMetadata?.candidatesTokenCount ?? 0, model: data.modelVersion ?? r.model };
}

async function geminiModels(key: string): Promise<string[]> {
  const data = (await http("gemini", `${API.gemini.base}/models?pageSize=200`, { headers: { "x-goog-api-key": key } })) as {
    models: { name: string; supportedGenerationMethods?: string[] }[];
  };
  return data.models
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .sort();
}

export const ADAPTERS: Record<ProviderId, { complete: typeof openaiComplete; models: typeof openaiModels }> = {
  openai: { complete: openaiComplete, models: openaiModels },
  anthropic: { complete: anthropicComplete, models: anthropicModels },
  gemini: { complete: geminiComplete, models: geminiModels },
};

/**
 * Suggests tier defaults from the discovered list. The founder confirms or overrides
 * in Settings → AI Providers. Heuristic only — nothing is assumed to exist.
 */
export function suggestTiers(provider: ProviderId, models: string[]): { fast?: string; balanced?: string; deep?: string } {
  const pick = (re: RegExp, exclude?: RegExp) => models.filter((m) => re.test(m) && !(exclude?.test(m))).sort().reverse()[0];
  const noise = /(audio|realtime|tts|transcribe|image|embedding|search|moderation|preview-\d{2}-\d{2}|vision|instruct|dall|whisper|davinci|babbage|codex|computer|live|thinking-exp|aqa|learnlm)/i;
  if (provider === "anthropic") return { fast: pick(/haiku/), balanced: pick(/sonnet/), deep: pick(/opus/) ?? pick(/sonnet/) };
  if (provider === "gemini") return { fast: pick(/flash-lite/, noise) ?? pick(/flash/, noise), balanced: pick(/flash(?!-lite)/, noise), deep: pick(/pro/, noise) };
  const notSmall = new RegExp(`mini|nano|${noise.source}`, "i");
  const balanced = pick(/^gpt-\d/, notSmall);
  return { fast: pick(/^gpt-\d.*(mini|nano)/, noise), balanced, deep: pick(/^gpt-\d.*pro/, noise) ?? balanced ?? pick(/^o\d/, noise) };
}

/** Pulls the first top-level JSON object out of model text (handles code fences and stray prose). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.indexOf("{");
  if (start < 0) throw new Error("No JSON object in model output");
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "{") depth++;
    else if (ch === "}") { depth--; if (depth === 0) return JSON.parse(candidate.slice(start, i + 1)); }
  }
  throw new Error("Unterminated JSON object in model output");
}
