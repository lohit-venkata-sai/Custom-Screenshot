import { useState } from "react";
import { MoreVertical, Star, ArrowUp, Pencil, Trash2, Check, Camera } from "lucide-react";
import { Button } from "./ui";
import { CaptureTypeIcon, presetSubtitle } from "./parts";
import type { Preset, CaptureType, Quality, Format } from "../../types";

export function PresetsTab({
  presets,
  activeId,
  onSetActive,
  onDelete,
  onEdit,
  onCapture,
  pro,
}: {
  presets: Preset[];
  activeId: string | null;
  onSetActive: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (p: Preset) => void;
  onCapture: (p: Preset) => void;
  pro: boolean;
}) {
  const [menu, setMenu] = useState<string | null>(null);

  if (presets.length === 0) {
    return (
      <div className="rounded-2xl border border-border bg-card p-6 text-center">
        <p className="font-semibold">No presets yet.</p>
        <p className="text-sm text-muted-foreground mt-1">
          Configure a capture and save it as a preset to use the Capture Button.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {presets.map((p) => {
        const active = p.id === activeId;
        return (
          <div
            key={p.id}
            className={
              active
                ? "rounded-2xl border border-[#2563EB]/30 bg-[#EFF6FF] dark:bg-[#172554] dark:border-[#3B82F6]/40 p-4"
                : "rounded-2xl border border-border bg-card p-4"
            }
          >
            <div className="flex items-start gap-3">
              <span className="mt-0.5 inline-flex h-11 w-11 items-center justify-center rounded-xl bg-muted">
                <CaptureTypeIcon type={p.captureType} size={22} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="font-bold text-[15px] truncate">{p.name}</div>
                <div className="text-[13px] text-muted-foreground">{presetSubtitle(p)}</div>
                {active ? (
                  <span className="mt-2 inline-flex items-center gap-1 rounded-full bg-[#2563EB] dark:bg-[#3B82F6] px-2.5 py-1 text-[12px] font-semibold text-white">
                    <Star size={12} fill="currentColor" /> Used by Capture Button
                  </span>
                ) : (
                  <Button size="sm" variant="outline" className="mt-2" onClick={() => onSetActive(p.id)}>
                    <ArrowUp size={14} /> Set for Capture Button
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => onCapture(p)}
                  aria-label={`Capture now with ${p.name}`}
                  title={`Capture now with ${p.name}`}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-r from-[#2563EB] to-[#3B82F6] dark:from-[#2563EB] dark:to-[#60A5FA] text-white shadow-sm hover:brightness-110"
                >
                  <Camera size={14} />
                </button>
                {active && (
                  <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#16A34A] dark:bg-[#22C55E] text-white" aria-label="Active preset">
                    <Check size={15} />
                  </span>
                )}
                <div className="relative">
                  <button
                    aria-label={`Actions for ${p.name}`}
                    className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
                    onClick={() => setMenu(menu === p.id ? null : p.id)}
                  >
                    <MoreVertical size={17} />
                  </button>
                  {menu === p.id && (
                    <>
                      <div className="fixed inset-0 z-10" onClick={() => setMenu(null)} />
                      <div className="absolute right-0 z-20 w-32 rounded-xl border border-border bg-card p-1 shadow-lg">
                        <button
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] hover:bg-muted"
                          onClick={() => {
                            setMenu(null);
                            onEdit(p);
                          }}
                        >
                          <Pencil size={13} /> Edit
                        </button>
                        <button
                          className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-[13px] text-[#DC2626] dark:text-[#EF4444] hover:bg-muted"
                          onClick={() => {
                            setMenu(null);
                            onDelete(p.id);
                          }}
                        >
                          <Trash2 size={13} /> Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
      <div className="rounded-xl border border-border bg-muted/40 p-3 text-[13px] text-muted-foreground flex gap-2">
        <span aria-hidden>ⓘ</span>
        <span>The preset with the green tick is used by the Capture Button on webpages.</span>
      </div>
    </div>
  );
}

export function EditPresetDialog({
  preset,
  pro,
  onClose,
  onSave,
}: {
  preset: Preset;
  pro: boolean;
  onClose: () => void;
  onSave: (patch: { name: string; captureType: CaptureType; quality: Quality; format: Format }) => void;
}) {
  const [name, setName] = useState(preset.name);
  const [captureType, setCaptureType] = useState<CaptureType>(preset.captureType);
  const [quality, setQuality] = useState<Quality>(preset.quality);
  const [format, setFormat] = useState<Format>(preset.format);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-label="Edit preset">
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-5 shadow-xl">
        <h3 className="font-bold text-[16px] mb-3">Edit preset</h3>
        <label className="text-[13px] font-medium">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
        />
        <label className="mt-3 block text-[13px] font-medium">Capture type</label>
        <div className="mt-1 grid grid-cols-2 gap-2">
          {(["visible", "fullPage", "region", "element"] as CaptureType[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setCaptureType(t);
                if (t !== "fullPage" && format === "pdf") setFormat("png");
              }}
              aria-pressed={captureType === t}
              className={
                captureType === t
                  ? "rounded-lg bg-[#2563EB] px-2 py-2 text-[13px] font-semibold text-white"
                  : "rounded-lg border border-border px-2 py-2 text-[13px] hover:bg-muted"
              }
            >
              {t === "visible" ? "Visible Area" : t === "fullPage" ? "Full Page" : t === "region" ? "Select Region" : "Select Element"}
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[13px] font-medium">Quality</label>
            <div className="mt-1 flex gap-1">
              {(["720p", "1080p", "2K", "4K", "8K"] as Quality[]).map((q) => {
                const locked = q === "8K" && !pro;
                return (
                  <button
                    key={q}
                    onClick={() => !locked && setQuality(q)}
                    aria-disabled={locked}
                    title={locked ? "8K is a Pro feature" : q}
                    className={
                      quality === q
                        ? "flex-1 rounded-lg bg-[#2563EB] py-1.5 text-[12px] font-semibold text-white"
                        : "flex-1 rounded-lg border border-border py-1.5 text-[12px] hover:bg-muted disabled:opacity-60"
                    }
                    disabled={locked && quality !== "8K"}
                  >
                    {locked ? "8K 🔒" : q}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className="text-[13px] font-medium">Format</label>
            <div className="mt-1 flex gap-1">
              {(["png", "jpg", "webp"] as Format[]).concat(captureType === "fullPage" ? ["pdf" as Format] : []).map((f) => (
                <button
                  key={f}
                  onClick={() => setFormat(f)}
                  className={
                    format === f
                      ? "flex-1 rounded-lg bg-[#2563EB] py-1.5 text-[12px] font-semibold text-white"
                      : "flex-1 rounded-lg border border-border py-1.5 text-[12px] hover:bg-muted"
                  }
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={!name.trim()} onClick={() => onSave({ name: name.trim(), captureType, quality, format })}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
