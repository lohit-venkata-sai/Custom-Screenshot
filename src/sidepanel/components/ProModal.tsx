import { useEffect, useState } from "react";
import { X, Sparkles, RefreshCw, LogIn } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui";
import { TRIAL_DAILY_4K } from "../../lib/storage";
import {
  EXTPAY_CONFIGURED,
  fetchProUser,
  openLoginPage,
  openPaymentPage,
  refreshProCache,
  signInWithGoogle,
} from "../../lib/pro";

type Status = "checking" | "unpaid" | "paid";

export type ProModalMode = "login" | "upsell";

/**
 * Two modes:
 * - login: trial-gated quality tapped while signed out. Sign-in binds the
 *   free trial to the user (magic link, free) so cache clears can't mint trials.
 * - upsell: trial exhausted. Payment is wired but dormant until plans go live.
 */
export function ProModal({
  mode,
  trialLeft4k,
  trialLeft8k,
  onClose,
  onUnlocked,
  onSignedIn,
}: {
  mode: ProModalMode;
  trialLeft4k: number;
  trialLeft8k: number;
  onClose: () => void;
  onUnlocked: () => void;
  onSignedIn: (email: string) => void;
}) {
  const [status, setStatus] = useState<Status>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [isBrave, setIsBrave] = useState(false);

  useEffect(() => {
    const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
    nav.brave
      ?.isBrave?.()
      .then(setIsBrave)
      .catch(() => undefined);
  }, []);

  const check = async () => {
    setStatus("checking");
    try {
      const user = await fetchProUser();
      setEmail(user.email);
      setStatus(user.paid ? "paid" : "unpaid");
      if (user.email) onSignedIn(user.email);
      if (user.paid) onUnlocked();
    } catch {
      setStatus("unpaid");
    }
  };

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signIn = async () => {
    try {
      const email = await signInWithGoogle();
      onSignedIn(email);
      toast.success(`Signed in as ${email} — trial active`);
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      if (/NO_EMAIL|no token|canceled|denied|OAuth/i.test(m)) {
        toast.message("Sign-in was cancelled or isn't configured yet");
      } else {
        toast.error("Google sign-in failed — check your connection");
      }
    }
  };

  const refreshIdentity = async () => {
    try {
      const user = await fetchProUser();
      if (user.email) {
        setEmail(user.email);
        onSignedIn(user.email);
        if (user.paid) {
          onUnlocked();
          onClose();
          toast.success("Pro unlocked — enjoy unlimited 4K and 8K");
        } else {
          setStatus("unpaid");
          toast.success(`Signed in as ${user.email} — trial active`);
        }
      } else {
        toast.message("Not signed in yet — check your email link first");
      }
    } catch {
      toast.error("Sign-in check failed — check your connection");
    }
  };

  const pay = () => {
    if (!EXTPAY_CONFIGURED) {
      toast.message("Checkout is coming soon");
      return;
    }
    try {
      openPaymentPage();
      toast.message("Complete payment in the opened tab, then hit Refresh below");
    } catch {
      toast.error("Could not open checkout");
    }
  };

  const login = () => {
    try {
      openLoginPage();
    } catch {
      toast.error("Could not open login");
    }
  };

  const refresh = async () => {
    try {
      const paid = await refreshProCache();
      if (paid) {
        toast.success("Pro unlocked — enjoy unlimited 4K and 8K");
        onUnlocked();
        onClose();
      } else {
        await check();
        toast.message("No Pro license found yet");
      }
    } catch {
      toast.error("License check failed — check your connection");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={mode === "login" ? "Sign in" : "Get Pro"}
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="flex items-center gap-2 font-extrabold text-[17px]">
            {mode === "login" ? (
              <LogIn size={18} className="text-[#2563EB] dark:text-[#60A5FA]" />
            ) : (
              <Sparkles size={18} className="text-[#2563EB] dark:text-[#60A5FA]" />
            )}
            {mode === "login" ? "Sign in" : "Go Pro"}
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {status === "paid" ? (
          <div className="mt-3 rounded-xl border border-[#16A34A]/30 bg-[#16A34A]/10 px-3 py-2.5 text-[13.5px]">
            ✓ Pro is active{email ? ` (${email})` : ""} — unlimited 4K and 8K unlocked.
          </div>
        ) : mode === "login" ? (
          <>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">
              4K and 8K trials need an account — 2 free shots of each, every day.
              Signing in ties the trial to you.
            </p>
            {isBrave && (
              <p className="mt-2 rounded-xl border border-border bg-muted/50 px-3 py-2 text-[12.5px] text-muted-foreground">
                Brave doesn't support Google sign-in for extensions — use the email link below instead.
              </p>
            )}
            <Button
              className="mt-4 w-full h-11 font-bold"
              onClick={signIn}
              disabled={status === "checking"}
            >
              {status === "checking" ? "Checking…" : "Continue with Google"}
            </Button>
            <button
              onClick={refreshIdentity}
              className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
            >
              <RefreshCw size={13} /> Already signed in elsewhere — refresh
            </button>
            <button
              onClick={() => {
                try {
                  openLoginPage();
                  toast.message("Check your email for the sign-in link, then hit Refresh below");
                } catch {
                  toast.error("Could not open email sign-in");
                }
              }}
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-muted-foreground hover:text-foreground"
            >
              Prefer email link instead
            </button>
          </>
        ) : (
          <>
            <p className="mt-1.5 text-[13.5px] text-muted-foreground">
              Trial today: 4K {trialLeft4k}/{TRIAL_DAILY_4K} · 8K {trialLeft8k}/{TRIAL_DAILY_4K} free left.
            </p>
            <ul className="mt-3 space-y-1.5 text-[13.5px]">
              <li>✓ Unlimited 4K captures</li>
              <li>✓ 8K ultra resolution</li>
              <li>✓ One-time purchase, yours forever</li>
            </ul>
            <Button
              className="mt-4 w-full h-11 font-bold"
              onClick={pay}
              disabled={status === "checking"}
            >
              {status === "checking" ? "Checking…" : "Get Pro — Continue with Google"}
            </Button>
            <div className="mt-2 flex items-center justify-between">
              <button
                onClick={login}
                className="rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
              >
                Already paid? Log in
              </button>
              <button
                onClick={refresh}
                className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] text-muted-foreground hover:text-foreground"
              >
                <RefreshCw size={13} /> I've paid — refresh
              </button>
            </div>
          </>
        )}

        <button
          onClick={onClose}
          className="mt-2 w-full rounded-lg py-2 text-[13px] text-muted-foreground hover:text-foreground"
        >
          {status === "paid" ? "Close" : "Maybe later"}
        </button>
      </div>
    </div>
  );
}
