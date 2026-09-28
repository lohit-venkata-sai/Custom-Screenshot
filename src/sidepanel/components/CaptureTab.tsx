import { useState } from "react";
import { Monitor, FileText, Crop, MousePointerClick, Check } from "lucide-react";
import { cn } from "../../lib/utils";
import type { CaptureType } from "../../types";

const ITEMS: Array<{ id: CaptureType; title: string; desc: string; icon: typeof Monitor }> = [
  { id: "visible", title: "Visible Area", desc: "Capture what's on screen", icon: Monitor },
  { id: "fullPage", title: "Full Page", desc: "Capture the entire webpage", icon: FileText },
  { id: "region", title: "Select Region", desc: "Drag to select any area", icon: Crop },
  { id: "element", title: "Select Element", desc: "Click any element to capture", icon: MousePointerClick },
];

export function CaptureTab({
  captureType,
  pro = false,
  onChange,
}: {
  captureType: CaptureType;
  /** Pro gold theme — selected card ring, check circle and icon go gold. */
  pro?: boolean;
  onChange: (t: CaptureType) => void;
}) {
  const [focusIdx, setFocusIdx] = useState(0);
  return (
    <div>
      <h2 className="text-[17px] font-bold mb-3">Capture Type</h2>
      <div className="grid grid-cols-2 gap-3" role="radiogroup" aria-label="Capture type">
        {ITEMS.map((it, idx) => {
          const Icon = it.icon;
          const selected = captureType === it.id;
          return (
            <button
              key={it.id}
              role="radio"
              aria-checked={selected}
              tabIndex={focusIdx === idx ? 0 : -1}
              onFocus={() => setFocusIdx(idx)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onChange(it.id);
                }
                if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                  e.preventDefault();
                  const n = (idx + 1) % ITEMS.length;
                  setFocusIdx(n);
                  document.querySelectorAll('[role="radio"]')[n]?.dispatchEvent(new Event("focus"));
                  (document.querySelectorAll('[role="radio"]')[n] as HTMLElement)?.focus();
                }
                if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                  e.preventDefault();
                  const n = (idx - 1 + ITEMS.length) % ITEMS.length;
                  setFocusIdx(n);
                  (document.querySelectorAll('[role="radio"]')[n] as HTMLElement)?.focus();
                }
              }}
              onClick={() => onChange(it.id)}
              className={cn(
                "relative rounded-2xl border p-4 text-center transition-all bg-card",
                selected
                  ? pro
                    ? "border-[#D4AF37] bg-[#D4AF37]/10 dark:bg-[#D4AF37]/10 shadow-[0_0_16px_-4px_rgba(212,175,55,0.55)]"
                    : "border-[#2563EB] dark:border-[#3B82F6] bg-[#EFF6FF] dark:bg-[#172554] shadow-sm"
                  : "border-border hover:border-[#2563EB]/50"
              )}
            >
              <span
                className={cn(
                  "absolute top-3 right-3 h-5 w-5 rounded-full border-2 flex items-center justify-center",
                  selected
                    ? pro
                      ? "border-[#D4AF37] bg-[#D4AF37] text-[#1A1405]"
                      : "border-[#2563EB] bg-[#2563EB] text-white"
                    : "border-border text-transparent"
                )}
                aria-hidden
              >
                <Check size={12} />
              </span>
              <Icon size={34} className={cn("mx-auto mb-2", selected ? (pro ? "text-[#8A6D1B] dark:text-[#E5C76B]" : "text-[#2563EB] dark:text-[#60A5FA]") : "text-foreground")} />
              <div className="font-bold text-[15px]">{it.title}</div>
              <div className="text-[13px] text-muted-foreground mt-1 leading-snug">{it.desc}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
