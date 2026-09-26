import { useEffect, useState } from "react";
import { X, Sparkles, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui";
import { TRIAL_DAILY_4K } from "../../lib/storage";
import {
  EXTPAY_CONFIGURED,
  fetchProUser,
  openLoginPage,
  openPaymentPage,
  refreshProCache,
} from "../../lib/pro";

type Status = "checking" | "unpaid" | "paid";

/** Pro upsell: unlimited 4K + 8K via ExtensionPay (Google login + Stripe). */
export function ProModal({
  trialLeft4k,
  trialLeft8k,
  onClose,
  onUnlocked,
}: {
  trialLeft4k: number;
  trialLeft8k: number;
  onClose: () => void;
  onUnlocked: () => void;
}) {
  const [status, setStatus] = useState<Status>("checking");
  const [email, setEmail] = useState<string | null>(null);

  const check = async () => {
    setStatus("checking");
    try {
      const user = await fetchProUser();
      setEmail(user.email);
      setStatus(user.paid ? "paid" : "unpaid");
      if (user.paid) onUnlocked();
    } catch {
      setStatus(EXTPAY_CONFIGURED ? "unpaid" : "unpaid");
    }
  };

  useEffect(() => {
    void check();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
    if (!EXTPAY_CONFIGURED) {
      toast.message("Login is coming soon");
      return;
    }
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
      aria-label="Get Pro"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="flex items-center gap-2 font-extrabold text-[17px]">
            <Sparkles size={18} className="text-[#2563EB] dark:text-[#60A5FA]" />
            Go Pro
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
