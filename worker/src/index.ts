/**
 * Custom Screenshot — license Worker (Cloudflare).
 *
 * Razorpay test-mode licensing for the MV3 extension (remote JS is
 * forbidden, so checkout is a server-created Razorpay Payment Link opened
 * in a normal tab — no checkout.js anywhere).
 *
 * Secrets used here (Worker env only, NEVER in the repo or the extension):
 *   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
 */

// ---------------------------------------------------------------------------
// Amounts/currency — clearly-marked constants. OWNER-TBD: default USD 900 /
// 1900 in smallest unit ($9 Pixel Pro one-time, $19 Pro+ bulk tier).
// ⚠️ Razorpay India accounts may need international activation for USD
// capture; test mode is fine either way. If USD capture fails, change
// currency/amounts here and redeploy — no extension change needed.
// ---------------------------------------------------------------------------
const PLANS: Record<
  string,
  { amount: number; currency: string; name: string; description: string }
> = {
  pro: {
    amount: 35000, // ₹350 Pixel Pro one-time (owner-set 2026-09-28)
    currency: "INR", // OWNER-TBD — UPI needs INR; finalize pricing before live
    name: "Pixel Pro",
    description: "Custom Screenshot Pixel Pro — one-time",
  },
  proplus: {
    amount: 190000, // OWNER-TBD (INR paise = ₹1900 TEST VALUE)
    currency: "INR", // OWNER-TBD — UPI needs INR; finalize pricing before live
    name: "Pro+",
    description: "Custom Screenshot Pro+ bulk tier — one-time",
  },
};

interface Env {
  RAZORPAY_KEY_ID: string;
  RAZORPAY_KEY_SECRET: string;
  RAZORPAY_WEBHOOK_SECRET: string;
  ALLOWED_ORIGINS?: string;
  LICENSES: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string): Promise<void>;
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function allowedOrigins(env: Env): string[] {
  return (env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** CORS headers only when the caller Origin is on the configured allow-list. */
function corsHeaders(req: Request, env: Env): HeadersInit {
  const origin = req.headers.get("origin") ?? "";
  if (origin && allowedOrigins(env).includes(origin)) {
    return {
      "Access-Control-Allow-Origin": origin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };
  }
  return {};
}

function json(
  data: unknown,
  status: number,
  req: Request,
  env: Env,
  extra?: HeadersInit
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(req, env),
      ...(extra ?? {}),
    },
  });
}

/** Redact any Authorization material before logging (secrets never in logs). */
function safeLog(...args: unknown[]): void {
  const scrub = (v: unknown): unknown => {
    if (typeof v === "string") return v.replace(/(Basic|Bearer)\s+\S+/gi, "$1 [REDACTED]");
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, val] of Object.entries(v)) {
        out[k] =
          /authoriz|secret|key/i.test(k) && typeof val === "string" ? "[REDACTED]" : scrub(val);
      }
      return out;
    }
    return v;
  };
  console.log(...args.map(scrub));
}

function licenseKey(email: string): string {
  return `license:${email.trim().toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// Server-side trial metering (same LICENSES KV namespace, no secrets).
// Privacy: KV stores the buyer's email + per-day 4K/8K shot counts under
// `trial:<lowercased-email>:<YYYY-MM-DD>` (UTC day) → {used4k, used8k}.
// Request budget (free-tier aware): each premium (4K/8K) capture costs at
// most 2 Worker requests — 1× GET /api/trial (pre-capture gate) + 1× POST
// /api/consume (after a SUCCESSFUL capture only). No polling for trials;
// the existing bounded license-poll runs only for purchases.
// ---------------------------------------------------------------------------
const TRIAL_DAILY = 2;
type TrialQuality = "4K" | "8K";

function trialKey(email: string, day: string): string {
  return `trial:${email.trim().toLowerCase()}:${day}`;
}

function trialDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10); // UTC YYYY-MM-DD
}

async function readTrialUses(env: Env, email: string, day: string): Promise<{ used4k: number; used8k: number }> {
  const raw = await env.LICENSES.get(trialKey(email, day));
  if (!raw) return { used4k: 0, used8k: 0 };
  try {
    const v = JSON.parse(raw) as { used4k?: unknown; used8k?: unknown };
    const used4k = Number.isFinite(v.used4k) ? Math.max(0, Math.min(TRIAL_DAILY, Math.floor(v.used4k as number))) : 0;
    const used8k = Number.isFinite(v.used8k) ? Math.max(0, Math.min(TRIAL_DAILY, Math.floor(v.used8k as number))) : 0;
    return { used4k, used8k };
  } catch {
    return { used4k: 0, used8k: 0 };
  }
}

async function handleTrial(req: Request, env: Env): Promise<Response> {
  const email = (new URL(req.url).searchParams.get("email") ?? "").trim();
  if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400, req, env);
  const uses = await readTrialUses(env, email, trialDay());
  return json(
    {
      remaining4k: Math.max(0, TRIAL_DAILY - uses.used4k),
      remaining8k: Math.max(0, TRIAL_DAILY - uses.used8k),
      daily: TRIAL_DAILY,
    },
    200,
    req,
    env
  );
}

async function handleConsume(req: Request, env: Env): Promise<Response> {
  let body: { email?: unknown; quality?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400, req, env);
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const quality = typeof body.quality === "string" ? body.quality : "";
  if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400, req, env);
  if (quality !== "4K" && quality !== "8K") {
    return json({ error: "invalid_quality" }, 400, req, env);
  }
  const q = quality as TrialQuality;
  const day = trialDay();
  const uses = await readTrialUses(env, email, day);
  const used = q === "4K" ? uses.used4k : uses.used8k;
  // Clamp: never exceed the daily cap. Already-exhausted consumes are
  // idempotent (no increment) and report remaining 0 with ok:false.
  if (used >= TRIAL_DAILY) {
    return json({ ok: false, remaining: 0 }, 200, req, env);
  }
  const next = {
    used4k: q === "4K" ? uses.used4k + 1 : uses.used4k,
    used8k: q === "8K" ? uses.used8k + 1 : uses.used8k,
  };
  await env.LICENSES.put(trialKey(email, day), JSON.stringify(next));
  const remaining = TRIAL_DAILY - (q === "4K" ? next.used4k : next.used8k);
  return json({ ok: true, remaining }, 200, req, env);
}

async function verifyWebhookSignature(
  rawBody: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      enc.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign", "verify"]
    );
    const sigBytes = Uint8Array.from(
      signature.match(/../g) ?? [],
      (b) => parseInt(b, 16)
    );
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(rawBody));
    if (valid) return true;
    // Fallback: constant-time hex-string compare (same result, no subtle quirks).
    const mac = await crypto.subtle.sign("HMAC", key, enc.encode(rawBody));
    const hex = [...new Uint8Array(mac)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (hex.length !== signature.length) return false;
    let diff = 0;
    for (let i = 0; i < hex.length; i++) diff |= hex.charCodeAt(i) ^ signature.charCodeAt(i);
    return diff === 0;
  } catch {
    return false;
  }
}

async function handleOrder(req: Request, env: Env): Promise<Response> {
  let body: { email?: unknown; plan?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: "bad_json" }, 400, req, env);
  }
  const email = typeof body.email === "string" ? body.email.trim() : "";
  const plan = typeof body.plan === "string" ? body.plan : "";
  if (!EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400, req, env);
  const cfg = PLANS[plan];
  if (!cfg) return json({ error: "invalid_plan" }, 400, req, env);
  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    safeLog("order failed: razorpay credentials not configured");
    return json({ error: "payments_not_configured" }, 503, req, env);
  }

  // Basic auth: Key ID + Secret stay server-side; redacted in any logging.
  const basic = btoa(`${env.RAZORPAY_KEY_ID}:${env.RAZORPAY_KEY_SECRET}`);
  const expireBy = Math.floor(Date.now() / 1000) + 24 * 3600; // link lives 24h
  let rzp: Response;
  try {
    rzp = await fetch("https://api.razorpay.com/v1/payment_links", {
      method: "POST",
      headers: {
        // NOTE: Authorization header value is never logged (see safeLog).
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: cfg.amount,
        currency: cfg.currency,
        description: cfg.description,
        customer: { email },
        notify: { sms: false, email: true },
        notes: { plan, product: "custom-screenshot" },
        expire_by: expireBy,
      }),
    });
  } catch (e) {
    safeLog("order failed: razorpay request error", { plan, error: String(e) });
    return json({ error: "provider_unreachable" }, 502, req, env);
  }
  if (!rzp.ok) {
    safeLog("order failed: razorpay status", { plan, status: rzp.status });
    return json({ error: "provider_error" }, 502, req, env);
  }
  const created = (await rzp.json()) as { short_url?: string; id?: string };
  if (!created.short_url || !created.id) {
    safeLog("order failed: malformed provider response", { plan });
    return json({ error: "provider_error" }, 502, req, env);
  }
  return json({ link_url: created.short_url, link_id: created.id }, 200, req, env);
}

async function handleWebhook(req: Request, env: Env): Promise<Response> {
  const rawBody = await req.text();
  const signature = req.headers.get("x-razorpay-signature") ?? "";
  const ok = await verifyWebhookSignature(rawBody, signature, env.RAZORPAY_WEBHOOK_SECRET ?? "");
  if (!ok) return new Response("bad signature", { status: 401 }); // no license write

  let event: {
    event?: string;
    payload?: {
      payment_link?: {
        entity?: {
          id?: string;
          notes?: { plan?: string };
          amount?: number;
          customer?: { email?: string };
        };
      };
    };
  };
  try {
    event = JSON.parse(rawBody) as typeof event;
  } catch {
    return new Response("bad json", { status: 400 });
  }
  if (event.event !== "payment_link.paid") return new Response("ignored", { status: 200 });

  const entity = event.payload?.payment_link?.entity;
  const email = entity?.customer?.email?.trim() ?? "";
  const linkId = entity?.id ?? "";
  if (!EMAIL_RE.test(email) || !linkId) return new Response("ignored", { status: 200 });

  // Plan comes from the notes we set at link creation; fall back to
  // amount-matching so older links without notes still resolve.
  let plan = entity?.notes?.plan ?? "";
  if (!PLANS[plan]) {
    plan = Object.keys(PLANS).find((p) => PLANS[p].amount === entity?.amount) ?? "";
  }
  await env.LICENSES.put(
    licenseKey(email),
    JSON.stringify({ email, plan: plan || null, link_id: linkId, paid_at: Date.now() })
  );
  return new Response("ok", { status: 200 });
}

async function handleLicense(req: Request, env: Env): Promise<Response> {
  const email = (new URL(req.url).searchParams.get("email") ?? "").trim();
  if (!EMAIL_RE.test(email)) return json({ pro: false, plan: null }, 400, req, env);
  const raw = await env.LICENSES.get(licenseKey(email));
  if (!raw) return json({ pro: false, plan: null }, 200, req, env);
  try {
    const lic = JSON.parse(raw) as { plan?: string | null };
    return json({ pro: true, plan: lic.plan ?? null }, 200, req, env);
  } catch {
    return json({ pro: true, plan: null }, 200, req, env);
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(req, env) });
    }
    if (url.pathname === "/api/order" && req.method === "POST") {
      return handleOrder(req, env);
    }
    if (url.pathname === "/api/webhook" && req.method === "POST") {
      return handleWebhook(req, env); // no CORS — server-to-server
    }
    if (url.pathname === "/api/license" && req.method === "GET") {
      return handleLicense(req, env);
    }
    if (url.pathname === "/api/trial" && req.method === "GET") {
      return handleTrial(req, env);
    }
    if (url.pathname === "/api/consume" && req.method === "POST") {
      return handleConsume(req, env);
    }
    return new Response("not found", { status: 404 });
  },
};
