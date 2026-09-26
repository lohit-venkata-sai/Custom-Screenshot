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
