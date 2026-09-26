import { X, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "./ui";
import { TRIAL_DAILY_4K } from "../../lib/storage";

/** Pro upsell: 4K trial exhausted or 8K tapped.
 * PRO: wire "Get Pro" to ExtensionPay here (login with Google + one-time
 * purchase), then persist the license and bypass the trial gate. */
export function ProModal({
  trialLeft,
  onClose,
}: {
  trialLeft: number;
  onClose: () => void;
}) {
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
        <p className="mt-1.5 text-[13.5px] text-muted-foreground">
          {trialLeft > 0
            ? `${trialLeft} of ${TRIAL_DAILY_4K} free 4K shots left today.`
            : `You've used today's ${TRIAL_DAILY_4K} free 4K shots.`}
        </p>
        <ul className="mt-3 space-y-1.5 text-[13.5px]">
          <li>✓ Unlimited 4K captures</li>
          <li>✓ 8K ultra resolution</li>
          <li>✓ One-time purchase, yours forever</li>
        </ul>
        <Button
          className="mt-4 w-full h-11 font-bold"
          onClick={() => {
            // PRO: replace with ExtPay login-with-Google + purchase flow.
            toast.message("Pro checkout is coming soon");
          }}
        >
          Get Pro
        </Button>
        <button
          onClick={onClose}
          className="mt-2 w-full rounded-lg py-2 text-[13px] text-muted-foreground hover:text-foreground"
        >
          Maybe later
        </button>
      </div>
    </div>
  );
}
