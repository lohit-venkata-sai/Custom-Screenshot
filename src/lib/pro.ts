/**
 * Pro licensing — Razorpay test-mode via Cloudflare Worker + Payment Links
 * (MV3 forbids remote JS, so no checkout.js: the Worker creates a
 * Razorpay-hosted Payment Link, opened in a normal tab).
 *
 * Google OAuth web-flow sign-in binds the 4K/8K daily trial to an identity
 * (`trialEmail`); `isPro()` reads the LOCAL `proPaid` cache first, then the
 * Worker license (network failure fails closed to cache, never throws).
 */

// Kill-switch: false = coming-soon toast, NO network (Worker calls skipped
// in isPro/startProPurchase). Flip to true only once Razorpay plans are
// live and tested end-to-end.
export const PAYMENTS_LIVE = true;

// TODO(owner): paste the deployed Worker URL here (see worker/README.md),
// e.g. "https://custom-screenshot-license.<account>.workers.dev".
export const WORKER_URL = "https://custom-screenshot-license.lohitvenkatasai2004.workers.dev";

/** Backend-supported plans from day one (Pro+ UI lands later). */
export type ProPlan = "pro" | "proplus";

export interface ProUser {
  paid: boolean;
  email: string | null;
}

/** Fast gate for captures: sticky local paid cache, then Worker license.
 * Never throws; network failure fails closed to the local cache. While the
 * PAYMENTS_LIVE kill-switch is off (or WORKER_URL unconfigured) this is
 * cache-only — no network leaves the capture flow. */
export async function isPro(): Promise<boolean> {
  let cached = false;
  try {
    const res = await chrome.storage.local.get(["proPaid"]);
    cached = res.proPaid === true;
  } catch {
    return false;
  }
  if (cached) return true;
  if (!PAYMENTS_LIVE || !isWorkerConfigured()) return cached;
  try {
    const identity = await getTrialIdentity();
    if (!identity) return cached;
    const lic = await fetchLicense(identity);
    if (lic.pro) {
      await setProPaid();
      return true;
    }
  } catch {
    /* fail closed to cache */
  }
  return cached;
}

/** Tester/dev reset: clears the LOCAL paid flag. */
export async function clearLocalPro(): Promise<void> {
  try {
    await chrome.storage.local.remove(["proPaid"]);
  } catch {
    /* noop */
  }
}

// ---------- Google sign-in (works in Chrome, Brave, Edge, …) ----------
// Technique mirrored from shipping extensions: OAuth *Web application*
// client + chrome.identity.launchWebAuthFlow (NOT getAuthToken, which only
// works in real Chrome). Owner setup (once, ~10 min):
// 1. https://console.cloud.google.com → same project → Credentials →
//    Create → OAuth client ID → Application type "Web application".
// 2. Under "Authorised redirect URIs" add:
//      https://fiebdpbddphcaamlpefjpllacdmacecb.chromiumapp.org/
//    (your extension ID from chrome://extensions; add the Web Store ID too
//    at publish — Web clients allow many redirect URIs.)
// 3. Paste the Web client ID below.

export const GOOGLE_CLIENT_ID = "578950807331-nadm1i72mdqupt88mntt9apket8n2q2n.apps.googleusercontent.com";
export const GOOGLE_WEB_CLIENT_ID = "578950807331-4cbqd6kcg5bttgcoe8s2302i14j2tnrk.apps.googleusercontent.com";

/** Interactive Google sign-in via auth popup. Throws when unconfigured/cancelled. */
export async function signInWithGoogle(): Promise<string> {
  if (GOOGLE_WEB_CLIENT_ID.startsWith("YOUR-")) throw new Error("NOT_CONFIGURED");
  const redirectUri = chrome.identity.getRedirectURL();
  const scopes = [
    "https://www.googleapis.com/auth/userinfo.email",
    "https://www.googleapis.com/auth/userinfo.profile",
  ];
  const url =
    "https://accounts.google.com/o/oauth2/v2/auth?client_id=" +
    encodeURIComponent(GOOGLE_WEB_CLIENT_ID) +
    "&response_type=token&redirect_uri=" +
    encodeURIComponent(redirectUri) +
    "&scope=" +
    encodeURIComponent(scopes.join(" "));
  const responseUrl: string = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url, interactive: true }, (u) => {
      if (chrome.runtime.lastError || !u) {
        reject(new Error(chrome.runtime.lastError?.message ?? "cancelled"));
      } else {
        resolve(u as string);
      }
    });
  });
  const token = new URLSearchParams(new URL(responseUrl).hash.substring(1)).get("access_token");
  if (!token) throw new Error("NO_TOKEN");
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("userinfo failed");
  const info = (await res.json()) as { email?: string };
  if (!info.email) throw new Error("NO_EMAIL");
  try {
    await chrome.storage.local.set({ trialEmail: info.email });
  } catch {
    /* noop */
  }
  return info.email;
}

/**
 * Trial identity: the cached Google address from sign-in. Trials bind to
 * this — clearing browser data alone no longer resets them.
 * Returns null when never signed in.
 */
export async function getTrialIdentity(): Promise<string | null> {
  try {
    const cached = await chrome.storage.local.get(["trialEmail"]);
    if (typeof cached.trialEmail === "string" && cached.trialEmail) {
      return cached.trialEmail;
    }
  } catch {
    /* noop */
  }
  return null;
}

// ---------- Razorpay licensing via Worker (Payment Links, no remote JS) ----------

export interface LicenseStatus {
  pro: boolean;
  plan: string | null;
}

function isWorkerConfigured(): boolean {
  return !WORKER_URL.includes("REPLACE-WITH-WORKER");
}

async function setProPaid(): Promise<void> {
  try {
    await chrome.storage.local.set({ proPaid: true });
  } catch {
    /* noop */
  }
}

function fetchWithTimeout(url: string, init: RequestInit, ms: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  return fetch(url, { ...init, signal: ctrl.signal }).finally(() => clearTimeout(t));
}

/** Real license re-check against the Worker. Never throws (false on any failure). */
export async function fetchLicense(email: string): Promise<LicenseStatus> {
  const none: LicenseStatus = { pro: false, plan: null };
  if (!email || !isWorkerConfigured()) return none;
  try {
    const res = await fetchWithTimeout(
      `${WORKER_URL}/api/license?email=${encodeURIComponent(email)}`,
      {},
      8000
    );
    if (!res.ok) return none;
    const data = (await res.json()) as Partial<LicenseStatus>;
    return { pro: data.pro === true, plan: typeof data.plan === "string" ? data.plan : null };
  } catch {
    return none;
  }
}

export type PurchaseResult =
  | { ok: true }
  | { ok: false; reason: "NOT_LIVE" | "NOT_CONFIGURED" | "NEED_SIGNIN" | "ORDER_FAILED" | "OPEN_FAILED" | "TAB_CLOSED" | "TIMEOUT"; link_url?: string };

const POLL_EVERY_MS = 5000;
const POLL_MAX = 60; // 60 × 5s = 5min bounded polling

/**
 * Full purchase: POST /api/order → open hosted Payment Link tab → poll
 * license until unlock, timeout, or tab close. Never throws; toasts live in
 * the caller (ProModal) — this lib stays UI-free so the background service
 * worker can import it. Resolves true only after proPaid is set.
 */
export async function startProPurchase(plan: ProPlan): Promise<PurchaseResult> {
  if (!PAYMENTS_LIVE) return { ok: false, reason: "NOT_LIVE" };
  if (!isWorkerConfigured()) return { ok: false, reason: "NOT_CONFIGURED" };
  const email = await getTrialIdentity().catch(() => null);
  if (!email) return { ok: false, reason: "NEED_SIGNIN" };

  let linkUrl = "";
  try {
    const res = await fetchWithTimeout(
      `${WORKER_URL}/api/order`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, plan }),
      },
      15000
    );
    if (!res.ok) return { ok: false, reason: "ORDER_FAILED" };
    const data = (await res.json()) as { link_url?: string };
    if (!data.link_url) return { ok: false, reason: "ORDER_FAILED" };
    linkUrl = data.link_url;
  } catch {
    return { ok: false, reason: "ORDER_FAILED" };
  }

  let tabId: number | undefined;
  let tabClosed = false;
  const onRemoved = (id: number) => {
    if (id === tabId) tabClosed = true;
  };
  try {
    const tab = await chrome.tabs.create({ url: linkUrl });
    tabId = tab.id;
    chrome.tabs.onRemoved.addListener(onRemoved);
  } catch {
    return { ok: false, reason: "OPEN_FAILED", link_url: linkUrl };
  }

  try {
    for (let i = 0; i < POLL_MAX; i++) {
      await new Promise((r) => setTimeout(r, POLL_EVERY_MS));
      if (tabClosed) return { ok: false, reason: "TAB_CLOSED" };
      if (tabId !== undefined) {
        try {
          await chrome.tabs.get(tabId);
        } catch {
          return { ok: false, reason: "TAB_CLOSED" };
        }
      }
      const lic = await fetchLicense(email);
      if (lic.pro) {
        await setProPaid();
        return { ok: true };
      }
    }
    return { ok: false, reason: "TIMEOUT" };
  } finally {
    try {
      chrome.tabs.onRemoved.removeListener(onRemoved);
    } catch {
      /* noop */
    }
  }
}
