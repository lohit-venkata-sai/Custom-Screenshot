import { X, User, LogOut } from "lucide-react";
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
          </div>
        )}

        <h4 className="mt-4 text-[13px] font-bold uppercase tracking-wide text-muted-foreground">Settings</h4>
        <label className="mt-2 flex cursor-pointer items-center justify-between rounded-xl border border-border p-3">
          <span className="text-[13.5px]">
            Copy to clipboard
            <span className="block text-[12px] text-muted-foreground">Also copy each shot (PNG/JPG/WebP) to clipboard</span>
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
        {clipboard && (
          <button
            onClick={() => {
              chrome.runtime
                .sendMessage({ type: "CS_CLIPBOARD_TEST" })
                .then((res: { ok?: boolean; detail?: string } | undefined) => {
                  if (res?.ok) toast.success("Clipboard test passed — try pasting now");
                  else toast.error(`Clipboard test failed: ${res?.detail ?? "no response"}`);
                })
                .catch((e: unknown) =>
                  toast.error(`Clipboard test failed: ${e instanceof Error ? e.message : String(e)}`)
                );
            }}
            className="mt-2 w-full rounded-lg border border-border py-2 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            Test clipboard copy
          </button>
        )}

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
