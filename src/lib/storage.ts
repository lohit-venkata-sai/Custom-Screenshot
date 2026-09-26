import type { AppSettings, Preset } from "../types";

const DEFAULT_SETTINGS: AppSettings = {
  captureType: "visible",
  quality: "1080p",
  format: "png",
  theme: "light",
};

interface StoreShape {
  presets: Preset[];
  activePresetId: string | null;
  settings: AppSettings;
}

const DEFAULT_STORE: StoreShape = {
  presets: [],
  activePresetId: null,
  settings: DEFAULT_SETTINGS,
};

function normalizeQuality(q: unknown): AppSettings["quality"] {
  if (q === "720p" || q === "1080p" || q === "2K" || q === "4K" || q === "8K") return q;
  return "1080p"; // anything unknown falls forward
}

function readStore(): Promise<StoreShape> {
  return new Promise((resolve) => {
    try {
      chrome.storage.local.get(["presets", "activePresetId", "settings"], (res) => {
        if (chrome.runtime.lastError) {
          resolve(DEFAULT_STORE);
          return;
        }
        const presets: Preset[] = Array.isArray(res.presets)
          ? res.presets.map((p: Preset) => ({ ...p, quality: normalizeQuality(p.quality) }))
          : [];
        resolve({
          presets,
          activePresetId: typeof res.activePresetId === "string" ? res.activePresetId : null,
          settings: {
            ...DEFAULT_SETTINGS,
            ...(res.settings ?? {}),
            quality: normalizeQuality((res.settings as Partial<AppSettings> | undefined)?.quality),
          },
        });
      });
    } catch {
      resolve(DEFAULT_STORE);
    }
  });
}

export async function getPresets(): Promise<Preset[]> {
  return (await readStore()).presets;
}

export async function savePreset(p: Preset): Promise<Preset[]> {
  const store = await readStore();
  const presets = [...store.presets, p];
  const activePresetId = store.activePresetId ?? p.id; // first preset auto-active
  await chrome.storage.local.set({ presets, activePresetId });
  return presets;
}

export async function updatePreset(id: string, patch: Partial<Preset>): Promise<Preset[]> {
  const store = await readStore();
  const presets = store.presets.map((p) =>
    p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p
  );
  await chrome.storage.local.set({ presets });
  return presets;
}

export async function deletePreset(id: string): Promise<{ presets: Preset[]; activePresetId: string | null }> {
  const store = await readStore();
  const presets = store.presets.filter((p) => p.id !== id);
  let activePresetId = store.activePresetId;
  if (activePresetId === id) {
    activePresetId = presets.length > 0 ? presets[0].id : null;
  }
  await chrome.storage.local.set({ presets, activePresetId });
  return { presets, activePresetId };
}

export async function getActivePreset(): Promise<Preset | null> {
  const store = await readStore();
  return store.presets.find((p) => p.id === store.activePresetId) ?? null;
}

export async function setActivePreset(id: string | null): Promise<void> {
  await chrome.storage.local.set({ activePresetId: id });
}

export async function getSettings(): Promise<AppSettings> {
  return (await readStore()).settings;
}

export async function saveSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
  const store = await readStore();
  const settings = { ...store.settings, ...patch };
  await chrome.storage.local.set({ settings });
  return settings;
}

export async function getStore(): Promise<StoreShape> {
  return readStore();
}

// ---------- 4K daily trial (2 free shots/day; Pro unlocks unlimited) ----------

export const TRIAL_DAILY_4K = 2;

interface TrialState {
  date: string; // local day key
  used4k: number;
}

function todayKey(): string {
  return new Date().toDateString();
}

async function readTrial(): Promise<TrialState> {
  try {
    const res = await chrome.storage.local.get(["trial"]);
    const t = (res.trial ?? {}) as Partial<TrialState>;
    if (t.date === todayKey()) return { date: t.date, used4k: t.used4k ?? 0 };
  } catch {
    /* noop */
  }
  return { date: todayKey(), used4k: 0 };
}

export async function trialRemaining4k(): Promise<number> {
  const t = await readTrial();
  return Math.max(0, TRIAL_DAILY_4K - t.used4k);
}

/** Returns false when today's trial is exhausted (does not consume). */
export async function consumeTrial4k(): Promise<boolean> {
  const t = await readTrial();
  if (t.used4k >= TRIAL_DAILY_4K) return false;
  await chrome.storage.local.set({ trial: { date: t.date, used4k: t.used4k + 1 } });
  return true;
}
