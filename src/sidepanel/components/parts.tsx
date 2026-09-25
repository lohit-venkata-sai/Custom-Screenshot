import { Monitor, FileText, Crop, MousePointerClick, Sun, Moon } from "lucide-react";
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
  onClick,
}: {
  active: boolean;
  quality: Quality;
  sub: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 rounded-xl border px-2 py-2.5 text-center transition-colors",
        active
          ? "bg-[#2563EB] border-[#2563EB] text-white dark:bg-[#3B82F6] dark:border-[#3B82F6]"
          : "bg-card border-border text-foreground hover:bg-muted"
      )}
    >
      <div className="text-sm font-semibold">{quality}</div>
      <div className={cn("text-xs", active ? "text-white/80" : "text-muted-foreground")}>{sub}</div>
    </button>
  );
}

export function FormatButton({
  active,
  format,
  onClick,
}: {
  active: boolean;
  format: Format;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex-1 rounded-xl border px-2 py-2.5 text-sm font-semibold transition-colors",
        active
          ? "bg-[#2563EB] border-[#2563EB] text-white dark:bg-[#3B82F6] dark:border-[#3B82F6]"
          : "bg-card border-border text-foreground hover:bg-muted"
      )}
    >
      {format.toUpperCase()}
    </button>
  );
}
