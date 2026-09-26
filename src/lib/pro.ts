import ExtPay from "./extpay/ExtPay.module.js";

/**
 * Pro licensing via ExtensionPay (Google login + Stripe one-time purchase).
 *
 * SETUP (owner):
 * 1. Sign up at https://extensionpay.com and register this extension.
 * 2. Create the $9 one-time "Pixel Pro" plan, connect Stripe.
 * 3. Paste the extension ID below (ExtensionPay dashboard → extension settings).
 * 4. Keep the dashboard in TEST mode + Stripe test cards while testing;
 *    flip to live for release. Manage test users in the dashboard
 *    (delete a test user to re-run the pay flow).
 */

// TODO(owner): paste your ExtensionPay extension ID here.
export const EXTPAY_EXTENSION_ID: string = "custom-screenshot";
export const EXTPAY_CONFIGURED = EXTPAY_EXTENSION_ID !== "REPLACE-WITH-EXTENSIONPAY-ID";
// Flip to true once plans are live and tested. Until then the paywall shows
// "coming soon" instead of opening checkout.
export const PAYMENTS_LIVE = false;

export interface ProUser {
  paid: boolean;
  email: string | null;
}

function client() {
  // Fresh instance per call: service workers lose module state between runs.
  return ExtPay(EXTPAY_EXTENSION_ID);
}

/** Network check against ExtensionPay. Throws on network failure / unconfigured. */
export async function fetchProUser(): Promise<ProUser> {
  if (!EXTPAY_CONFIGURED) throw new Error("NOT_CONFIGURED");
  const user = await client().getUser();
  return { paid: !!user?.paid, email: user?.email ?? null };
}

/** Fast gate for captures: sticky paid cache, network fallback. Never throws. */
export async function isPro(): Promise<boolean> {
  try {
    const cached = await chrome.storage.local.get(["proPaid"]);
    if (cached.proPaid === true) return true;
  } catch {
    /* noop */
  }
  try {
    const user = await fetchProUser();
    if (user.paid) {
      try {
        await chrome.storage.local.set({ proPaid: true });
      } catch {
        /* noop */
      }
      return true;
    }
  } catch {
    /* offline / unconfigured → stay on free tier */
  }
  return false;
}

/** Force a network re-check (panel open, post-payment refresh). Never throws. */
export async function refreshProCache(): Promise<boolean> {
  try {
    const user = await fetchProUser();
    try {
      await chrome.storage.local.set({ proPaid: user.paid });
    } catch {
      /* noop */
    }
    return user.paid;
  } catch {
    return isPro();
  }
}

/** Tester/dev reset: clears the LOCAL paid flag. Server-side test users are
 * managed in the ExtensionPay dashboard (delete a test user to re-run pay). */
export async function clearLocalPro(): Promise<void> {
  try {
    await chrome.storage.local.remove(["proPaid"]);
  } catch {
    /* noop */
  }
}

// ---------- Google sign-in (chrome.identity, for trial binding) ----------
// Free, no backend. Owner setup (once, ~10 min):
// 1. https://console.cloud.google.com → new project → OAuth consent screen
//    (External, add openid/email/profile scopes).
// 2. Credentials → Create → OAuth client ID → Application type "Chrome",
//    paste THIS extension's ID from chrome://extensions.
// 3. Paste the client ID below AND into manifest.json's oauth2.client_id.
// 4. At Web Store publish the extension ID changes → repeat step 2 for it.

export const GOOGLE_CLIENT_ID = "578950807331-nadm1i72mdqupt88mntt9apket8n2q2n.apps.googleusercontent.com";

async function googleEmail(interactive: boolean): Promise<string | null> {
  if (GOOGLE_CLIENT_ID.startsWith("YOUR-")) return null;
  const token: string = await new Promise((resolve, reject) => {
    chrome.identity.getAuthToken({ interactive }, (t) => {
      if (chrome.runtime.lastError || !t) reject(new Error(chrome.runtime.lastError?.message ?? "no token"));
      else resolve(t as string);
    });
  });
  const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error("userinfo failed");
  const info = (await res.json()) as { email?: string };
  return info.email ?? null;
}

/** Interactive Google sign-in (account picker). Throws when unconfigured/cancelled. */
export async function signInWithGoogle(): Promise<string> {
  const email = await googleEmail(true);
  if (!email) throw new Error("NO_EMAIL");
  try {
    await chrome.storage.local.set({ trialEmail: email });
  } catch {
    /* noop */
  }
  return email;
}

/**
 * Trial identity: Google account first (silent if already granted), then the
 * cached address, then ExtensionPay login. Trials bind to this — clearing
 * browser data alone no longer resets them.
 * Returns null when never signed in (network failures included).
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
  try {
    const email = await googleEmail(false);
    if (email) {
      try {
        await chrome.storage.local.set({ trialEmail: email });
      } catch {
        /* noop */
      }
      return email;
    }
  } catch {
    /* not granted / offline */
  }
  try {
    const user = await fetchProUser();
    if (user.email) {
      try {
        await chrome.storage.local.set({ trialEmail: user.email });
      } catch {
        /* noop */
      }
      return user.email;
    }
  } catch {
    /* offline / unconfigured */
  }
  return null;
}

export function openPaymentPage(): void {
  if (!EXTPAY_CONFIGURED || !PAYMENTS_LIVE) throw new Error("NOT_LIVE");
  client().openPaymentPage();
}

/** Magic-link sign-in works regardless of payments going live. */
export function openLoginPage(): void {
  if (!EXTPAY_CONFIGURED) throw new Error("NOT_CONFIGURED");
  client().openLoginPage();
}

/** Must be called once at background startup per ExtPay docs. */
export function startProBackground(): void {
  if (!EXTPAY_CONFIGURED) return;
  try {
    client().startBackground();
  } catch {
    /* noop */
  }
}
