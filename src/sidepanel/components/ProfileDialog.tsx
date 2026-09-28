import { X, User, LogOut, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { TRIAL_DAILY_4K } from "../../lib/storage";
import { DISCORD_URL, DiscordIcon } from "./parts";

export function ProfileDialog({
  email,
  pro,
  trial4k,
  trial8k,
  clipboard,
  onClipboardChange,
  onSignIn,
  onSignOut,
  onUpgrade,
  onClose,
}: {
  email: string | null;
  pro: boolean;
  trial4k: number;
  trial8k: number;
  clipboard: boolean;
  onClipboardChange: (on: boolean) => void;
  onSignIn: () => void;
  onSignOut: () => void;
  onUpgrade: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Profile and settings"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <h3 className="flex items-center gap-2 font-extrabold text-[17px]">
            <User size={18} className="text-[#2563EB] dark:text-[#60A5FA]" />
            Profile
          </h3>
          <button
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X size={16} />
          </button>
        </div>

        {email ? (
          <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-r from-[#2563EB] to-[#3B82F6] text-[15px] font-bold text-white">
              {email.charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">{email}</div>
              <div className="text-[12px] text-muted-foreground">
                {pro ? "✓ Pro active" : `Trial today: 4K ${trial4k}/${TRIAL_DAILY_4K} · 8K ${trial8k}/${TRIAL_DAILY_4K}`}
              </div>
            </div>
            <button
              onClick={() => {
                onSignOut();
                toast.success("Signed out");
              }}
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3 text-[13.5px]">
            <p className="text-muted-foreground">You're browsing as a guest. Sign in to unlock the 4K/8K daily trial.</p>
            <button
              onClick={onSignIn}
              className="mt-2 w-full rounded-lg bg-[#2563EB] py-2 text-[13.5px] font-semibold text-white hover:brightness-110"
            >
              Continue with Google
            </button>
            <button
              onClick={onUpgrade}
              aria-label="Go Pro — sign in first, then see Pro plans"
              className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-[#D4AF37]/50 bg-[#D4AF37]/10 py-2 text-[13.5px] font-bold text-[#8A6D1B] hover:bg-[#D4AF37]/20 dark:text-[#E5C76B]"
            >
              <Sparkles size={15} /> Go Pro
            </button>
          </div>
        )}

        {email && !pro && (
          <button
            onClick={onUpgrade}
            aria-label="Go Pro — unlimited 4K and 8K"
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-[#A8842C] to-[#D4AF37] py-2.5 text-[14px] font-bold text-[#1A1405] shadow-sm hover:brightness-105 dark:from-[#B8912A] dark:to-[#E5C76B]"
          >
            <Sparkles size={16} /> Go Pro — unlimited 4K &amp; 8K
          </button>
        )}

        <h4 className="mt-4 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Settings</h4>
        <label className="mt-2 flex cursor-pointer items-center justify-between rounded-xl border border-border p-3">
          <span className="text-[13.5px]">
            Copy to clipboard
            <span className="block text-[12px] text-muted-foreground">
              {clipboard ? "Screenshots also copy to clipboard" : "Also copy screenshots to clipboard"}
            </span>
            <span className="block text-[12px] text-muted-foreground">Copies to clipboard as PNG</span>
          </span>
          <button
            role="switch"
            aria-checked={clipboard}
            aria-label="Copy screenshots to clipboard"
            onClick={(e) => {
              e.preventDefault();
              onClipboardChange(!clipboard);
            }}
            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
              clipboard ? "bg-[#2563EB]" : "bg-muted"
            }`}
          >
            <span
              className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                clipboard ? "left-[22px]" : "left-0.5"
              }`}
            />
          </button>
        </label>

        <a
          href={DISCORD_URL}
          target="_blank"
          rel="noreferrer"
          className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-border p-2.5 text-[13.5px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <DiscordIcon size={17} /> Join our Discord
        </a>
      </div>
    </div>
  );
}
