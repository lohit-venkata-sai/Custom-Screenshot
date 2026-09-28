/**
 * Pro licensing — payments stack removed (Stripe blocked in India,
 * ExtensionPay paused). Razorpay lands in a later milestone.
 *
 * Until then: Google OAuth web-flow sign-in binds the 4K/8K daily trial
 * to an identity (`trialEmail`); `isPro()` reads the LOCAL `proPaid`
 * cache only (always false until Razorpay lands — that is correct).
 */

// Flip to true once Razorpay plans are live and tested. Until then the
// paywall shows "coming soon" instead of opening checkout.
export const PAYMENTS_LIVE = false;

export interface ProUser {
  paid: boolean;
  email: string | null;
}

/** Fast gate for captures: sticky local paid cache. Never throws. */
export async function isPro(): Promise<boolean> {
  try {
    const cached = await chrome.storage.local.get(["proPaid"]);
    return cached.proPaid === true;
  } catch {
    return false;
  }
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
