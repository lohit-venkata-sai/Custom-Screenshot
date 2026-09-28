import { Monitor, FileText, Crop, MousePointerClick, Sun, Moon, Info, Lock, Crown } from "lucide-react";
import logoUrl from "../../assets/custom-screenshot-logo.png";
import { cn } from "../../lib/utils";
import type { CaptureType, Format, Preset, Quality } from "../../types";

export function BrandIcon({ size = 34 }: { size?: number }) {
  return (
    <img
      src={logoUrl}
      width={size}
      height={size}
      alt="Custom Screenshot"
      className="rounded-xl shadow-sm"
      style={{ width: size, height: size }}
    />
  );
}

export function CaptureTypeIcon({ type, size = 30 }: { type: CaptureType; size?: number }) {
  if (type === "visible") return <Monitor size={size} className="text-[#2563EB] dark:text-[#3B82F6]" />;
  if (type === "fullPage") return <FileText size={size} className="text-[#2563EB] dark:text-[#3B82F6]" />;
  if (type === "region") return <Crop size={size} className="text-[#2563EB] dark:text-[#3B82F6]" />;
  return <MousePointerClick size={size} className="text-[#2563EB] dark:text-[#3B82F6]" />;
}

export function ThemeIcon({ theme }: { theme: "light" | "dark" }) {
  return theme === "light" ? <Moon size={18} /> : <Sun size={18} />;
}

/** Discord invite. */
export const DISCORD_URL = "https://discord.gg/M4kAbUJbS";

export function DiscordIcon({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M20.32 4.37a19.8 19.8 0 0 0-4.93-1.51 13.78 13.78 0 0 0-.64 1.28 18.27 18.27 0 0 0-5.5 0 12.64 12.64 0 0 0-.64-1.28h-.05A19.74 19.74 0 0 0 3.64 4.37 20.15 20.15 0 0 0 .11 18.06a19.9 19.9 0 0 0 6.04 3.03c.46-.63.87-1.3 1.22-2a12.9 12.9 0 0 1-1.93-.92c.16-.12.32-.24.47-.37a14.2 14.2 0 0 0 12.18 0c.15.13.31.25.47.37-.61.36-1.26.68-1.93.92.35.7.76 1.37 1.22 2a19.83 19.83 0 0 0 6.04-3.03 20.02 20.02 0 0 0-3.57-13.69ZM8.02 15.33c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Zm7.96 0c-1.18 0-2.16-1.08-2.16-2.42s.95-2.42 2.16-2.42 2.18 1.09 2.16 2.42c0 1.34-.95 2.42-2.16 2.42Z" />
    </svg>
  );
}

export function InfoTip({ label, text, id }: { label: string; text: string; id: string }) {
  return (
    <span className="relative inline-flex group">
      <button
        type="button"
        aria-label={label}
        aria-describedby={id}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none"
      >
        <Info size={12} />
      </button>
      <span
        role="tooltip"
        id={id}
        className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-52 -translate-x-1/2 rounded-xl border border-border bg-card p-2.5 text-[12px] font-normal leading-snug text-muted-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {text}
      </span>
    </span>
  );
}

export function presetSubtitle(p: Pick<Preset, "captureType" | "quality" | "format">): string {
  const labels: Record<CaptureType, string> = {
    visible: "Visible Area",
    fullPage: "Full Page",
    region: "Select Region",
    element: "Select Element",
  };
  return `${labels[p.captureType]} • ${p.quality} • ${p.format.toUpperCase()}`;
}

export function QualityButton({
  active,
  quality,
  sub,
  locked,
  trialLeft,
  pro = false,
  onClick,
}: {
  active: boolean;
  quality: Quality;
  sub: string;
  locked?: boolean;
  /** Remaining free trial shots today (4K/8K only — omit for free qualities). */
  trialLeft?: number;
  /** Pro gold theme — active pill goes gold gradient with dark text. */
  pro?: boolean;
  onClick: () => void;
}) {
  const isPremium = quality === "4K" || quality === "8K";
  const showTrialBadge = isPremium && trialLeft !== undefined;
  const exhausted = showTrialBadge && (trialLeft as number) <= 0;
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-disabled={locked}
      className={cn(
        "relative flex-1 overflow-hidden rounded-xl border px-2 py-2.5 text-center transition-colors",
        active
          ? pro
            ? "bg-gradient-to-r from-[#A8842C] to-[#D4AF37] dark:from-[#B8912A] dark:to-[#E5C76B] border-[#D4AF37] text-[#1A1405]"
            : "bg-[#2563EB] text-white dark:bg-[#3B82F6]"
          : "bg-card border-border text-foreground hover:bg-muted",
        locked && !active && "opacity-60",
        isPremium && "border-[#D4AF37] shadow-[0_0_0_1px_#D4AF37]"
      )}
    >
      {locked && (
        <Lock size={11} className="absolute top-1.5 right-1.5 text-[#D4AF37]" aria-hidden />
      )}
      {showTrialBadge && (
        <span
          className="pointer-events-none absolute left-0 top-0 h-[30px] w-[30px] overflow-hidden"
          aria-hidden="true"
        >
          <span className="absolute left-[-12px] top-[5px] flex w-[42px] -rotate-45 items-center justify-center bg-[#D4AF37] text-[10px] font-bold leading-[14px] text-white">
            {exhausted ? <Crown size={10} strokeWidth={3} aria-hidden /> : trialLeft}
          </span>
        </span>
      )}
      {showTrialBadge && (
        <span className="sr-only">
          {exhausted ? "Trial exhausted — go Pro" : `${trialLeft} free trial shots left today`}
        </span>
      )}
      <div className="text-sm font-semibold">{quality}</div>
      <div className={cn("text-xs", active ? (pro ? "text-[#1A1405]/70" : "text-white/80") : "text-muted-foreground")}>{sub}</div>
    </button>
  );
}

export function FormatButton({
  active,
  format,
  infoTip,
  pro = false,
  onClick,
}: {
  active: boolean;
  format: Format;
  infoTip?: { id: string; label: string; text: string };
  /** Pro gold theme — active pill goes gold gradient with dark text. */
  pro?: boolean;
  onClick: () => void;
}) {
  return (
    <span className="relative inline-flex flex-1 group">
      <button
        onClick={onClick}
        aria-pressed={active}
        aria-describedby={infoTip?.id}
        className={cn(
          "flex-1 rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors inline-flex items-center justify-center gap-1.5",
          active
            ? pro
              ? "bg-gradient-to-r from-[#A8842C] to-[#D4AF37] dark:from-[#B8912A] dark:to-[#E5C76B] border-[#D4AF37] dark:border-[#D4AF37] text-[#1A1405]"
              : "bg-[#2563EB] border-[#2563EB] text-white dark:bg-[#3B82F6] dark:border-[#3B82F6]"
            : "bg-card border-border text-foreground hover:bg-muted"
        )}
      >
        {format.toUpperCase()}
        {infoTip && <Info size={12} className="opacity-70" aria-hidden />}
      </button>
      {infoTip && (
        <span
          role="tooltip"
          id={infoTip.id}
          className="pointer-events-none absolute left-1/2 top-full z-20 mt-2 w-52 -translate-x-1/2 rounded-xl border border-border bg-card p-2.5 text-[12px] font-normal leading-snug text-muted-foreground opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
        >
          {infoTip.text}
        </span>
      )}
    </span>
  );
}
