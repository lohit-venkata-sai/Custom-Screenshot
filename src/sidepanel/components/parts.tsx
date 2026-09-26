import { Monitor, FileText, Crop, MousePointerClick, Sun, Moon, Info, Lock } from "lucide-react";
import logoUrl from "../../assets/logo.png";
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
  onClick,
}: {
  active: boolean;
  quality: Quality;
  sub: string;
  locked?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-disabled={locked}
      className={cn(
        "relative flex-1 rounded-xl border px-2 py-2.5 text-center transition-colors",
        active
          ? "bg-[#2563EB] border-[#2563EB] text-white dark:bg-[#3B82F6] dark:border-[#3B82F6]"
          : "bg-card border-border text-foreground hover:bg-muted",
        locked && !active && "opacity-60"
      )}
    >
      {locked && (
        <Lock size={11} className="absolute top-1.5 right-1.5 text-muted-foreground" aria-hidden />
      )}
      <div className="text-sm font-semibold">{quality}</div>
      <div className={cn("text-xs", active ? "text-white/80" : "text-muted-foreground")}>{sub}</div>
    </button>
  );
}

export function FormatButton({
  active,
  format,
  infoTip,
  onClick,
}: {
  active: boolean;
  format: Format;
  infoTip?: { id: string; label: string; text: string };
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
            ? "bg-[#2563EB] border-[#2563EB] text-white dark:bg-[#3B82F6] dark:border-[#3B82F6]"
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
