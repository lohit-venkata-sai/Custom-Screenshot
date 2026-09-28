import { useCallback, useEffect, useState } from "react";
import { Camera, Bookmark, User } from "lucide-react";
import { Toaster, toast } from "sonner";
import { CaptureTab } from "./components/CaptureTab";
import { CaptureLogs } from "./components/CaptureLogs";
import { PresetsTab, EditPresetDialog } from "./components/PresetsTab";
import { ProModal, type ProModalMode } from "./components/ProModal";
import { ProfileDialog } from "./components/ProfileDialog";
import { Button } from "./components/ui";
import { BrandIcon, FormatButton, QualityButton, ThemeIcon, InfoTip, DiscordIcon, DISCORD_URL } from "./components/parts";
import { applyTheme } from "../lib/theme";
import {
  deletePreset,
  getStore,
  savePreset,
  saveSettings,
  setActivePreset,
  trialRemaining,
  TRIAL_DAILY_4K,
  TRIAL_DAILY_8K,
  TESTING_UNLIMITED_TRIALS,
  updatePreset,
} from "../lib/storage";
import { isPro, getTrialIdentity } from "../lib/pro";
import { uid } from "../lib/utils";
import { APP_VERSION } from "../lib/version";
import type { CaptureType, Format, Preset, Quality } from "../types";
import { QUALITY_DIMS } from "../types";
import { cn } from "../lib/utils";

const QUALITIES: Quality[] = ["720p", "1080p", "2K", "4K", "8K"];

export default function App() {
  const [tab, setTab] = useState<"capture" | "presets">("capture");
  const [captureType, setCaptureType] = useState<CaptureType>("visible");
  const [quality, setQuality] = useState<Quality>("2K");
  const [format, setFormat] = useState<Format>("png");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [presets, setPresets] = useState<Preset[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [editing, setEditing] = useState<Preset | null>(null);
  const [busy, setBusy] = useState(false);
  const [proOpen, setProOpen] = useState<ProModalMode | null>(null);
  const [trialLeft, setTrialLeft] = useState<number>(2);
  const [trialLeft8k, setTrialLeft8k] = useState<number>(2);
  const [pro, setPro] = useState(false);
  const [identity, setIdentity] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [clipboard, setClipboard] = useState(false);

  useEffect(() => {
    getStore().then((s) => {
      setPresets(s.presets);
      setActiveId(s.activePresetId);
      setCaptureType(s.settings.captureType);
      setQuality(s.settings.quality);
      setFormat(s.settings.format);
      setTheme(s.settings.theme);
      applyTheme(s.settings.theme);
      // Clipboard defaults OFF (storage.ts) so existing users are unaffected;
      // respect whatever the user last chose.
      setClipboard(s.settings.clipboard === true);
    });
    const loadTrials = (email: string | null) => {
      const em = email ?? "";
      trialRemaining("4K", em).then(setTrialLeft).catch(() => undefined);
      trialRemaining("8K", em).then(setTrialLeft8k).catch(() => undefined);
    };
    loadTrials(null);
    isPro().then(setPro).catch(() => undefined);
    // Pro can flip while the panel is open (unlock/refresh elsewhere):
    // follow the same `proPaid` cache — no reload needed.
    const onProChanged = (
      changes: { [key: string]: chrome.storage.StorageChange },
      areaName: string
    ) => {
      if (areaName === "local" && "proPaid" in changes) {
        isPro().then(setPro).catch(() => undefined);
      }
    };
    chrome.storage.onChanged.addListener(onProChanged);
    getTrialIdentity()
      .then((email) => {
        setIdentity(email);
        if (email) loadTrials(email);
      })
      .catch(() => undefined);
    // Reopened after a gated 4K/8K attempt: go straight to sign-in or upsell.
    chrome.storage.session
      ?.get("proModal")
      .then((r) => {
        if (r.proModal === "login" || r.proModal === "upsell") {
          chrome.storage.session.remove("proModal").catch(() => undefined);
          setProOpen(r.proModal);
        }
      })
      .catch(() => undefined);
    return () => chrome.storage.onChanged.removeListener(onProChanged);
  }, []);

  // Pro-gated panel chrome (e.g. gold scrollbars in globals.css) mirrors the
  // `.dark` theme approach: a `pro` class on <html>, styled in the panel stylesheet.
  useEffect(() => {
    document.documentElement.classList.toggle("pro", pro);
  }, [pro]);

  const persistConfig = useCallback(
    (c: CaptureType, q: Quality, f: Format) => {
      saveSettings({ captureType: c, quality: q, format: f }).catch(() => undefined);
    },
    []
  );

  const toggleTheme = () => {
    const next = theme === "light" ? "dark" : "light";
    setTheme(next);
    applyTheme(next);
    saveSettings({ theme: next }).catch(() => undefined);
  };

  const handleSavePreset = async () => {
    const name = presetName.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      const p: Preset = {
        id: uid(),
        name,
        captureType,
        quality,
        format,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      const next = await savePreset(p);
      setPresets(next);
      // first preset auto-active handled in storage; refresh active id
      const store = await getStore();
      setActiveId(store.activePresetId);
      setPresetName("");
      toast.success(`Preset "${name}" saved`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save preset");
    } finally {
      setBusy(false);
    }
  };

  const handleCapture = () => {
    fireCapture({ captureType, quality, format });
  };

  const fireCapture = async (config: { captureType: CaptureType; quality: Quality; format: Format }) => {
    if (busy) return;
    if (!TESTING_UNLIMITED_TRIALS && !pro && (config.quality === "4K" || config.quality === "8K")) {
      if (!identity) {
        setProOpen("login");
        return;
      }
      if ((await trialRemaining(config.quality, identity).catch(() => 1)) <= 0) {
        setProOpen("upsell");
        return;
      }
    }
    // Fire immediately (no waiting: interactive picks must start at once),
    // then close the panel for a clean shot. Background reopens it when done
    // (only this panel-initiated capture reopens — shortcut/pill captures don't).
    chrome.runtime
      .sendMessage({ type: "CS_CAPTURE", config, fromPanel: true })
      .catch(() => undefined);
    setTimeout(() => window.close(), 250);
  };

  const activePreset = presets.find((p) => p.id === activeId) ?? null;
  // Trial qualities lock with a gold badge once today's free shots run out.
  // TEST MODE bypass: never lock while TESTING_UNLIMITED_TRIALS is on.
  const lockedQualities: Quality[] = pro || TESTING_UNLIMITED_TRIALS
    ? []
    : [
        ...(trialLeft <= 0 ? ["4K" as Quality] : []),
        ...(trialLeft8k <= 0 ? ["8K" as Quality] : []),
      ];

  return (
    <div className="min-h-screen bg-background text-foreground overflow-x-clip">
      <Toaster position="top-center" theme={theme} closeButton toastOptions={{ duration: 3500 }} />
      <header className={cn("sticky top-0 z-10 border-b border-border bg-card/95 backdrop-blur", pro && "border-b-[#D4AF37]/40 [box-shadow:0_1px_16px_-6px_rgba(212,175,55,0.55)]")}>
        <div className="flex items-center gap-2.5 px-4 py-3">
          <BrandIcon />
          <div className="flex-1 leading-tight">
            <div className="font-extrabold text-[17px] tracking-tight">Custom Screenshot</div>
            <div className="text-[12.5px] text-muted-foreground">Capture screenshots your way.</div>
          </div>
          <a
            href={DISCORD_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="Join our Discord"
            title="Join our Discord"
            className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <DiscordIcon size={18} />
          </a>
          <button
            onClick={() => setProfileOpen(true)}
            aria-label={identity ? `Profile (${identity})` : "Open profile"}
            title={identity ?? "Profile"}
            className={cn(
              "flex h-9 w-9 items-center justify-center rounded-xl border border-border text-[14px] font-bold text-white bg-gradient-to-r from-[#2563EB] to-[#3B82F6] hover:brightness-110",
              pro && "border-2 border-[#D4AF37] shadow-[0_0_12px_-2px_rgba(212,175,55,0.6)]"
            )}
          >
            {identity ? identity.charAt(0).toUpperCase() : <User size={17} />}
          </button>
          <button
            onClick={toggleTheme}
            aria-label={theme === "light" ? "Switch to dark mode" : "Switch to light mode"}
            className="rounded-xl border border-border p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <ThemeIcon theme={theme} />
          </button>
        </div>
        <nav className="flex px-4 gap-2 pb-0" aria-label="Sections">
          {(["capture", "presets"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              aria-current={tab === t ? "page" : undefined}
              className={cn(
                "flex-1 rounded-t-xl px-3 py-2.5 text-[14px] font-semibold border-b-2 transition-colors",
                tab === t
                  ? pro
                    ? "text-[#8A6D1B] dark:text-[#E5C76B] border-[#D4AF37] bg-[#D4AF37]/10 dark:bg-[#D4AF37]/10 shadow-[0_0_12px_-2px_rgba(212,175,55,0.6)]"
                    : "text-[#2563EB] dark:text-[#60A5FA] border-[#2563EB] dark:border-[#60A5FA] bg-[#EFF6FF]/60 dark:bg-[#172554]/60"
                  : "text-muted-foreground border-transparent hover:text-foreground"
              )}
            >
              {t === "capture" ? "Capture" : "Presets"}
            </button>
          ))}
        </nav>
        <button
          onClick={() => (identity ? setProfileOpen(true) : setProOpen("login"))}
          className={cn(
            "flex w-full items-center justify-center gap-1.5 border-t border-border bg-muted/40 px-4 py-1.5 text-[12px] text-muted-foreground hover:text-foreground",
            pro && "border-t-[#D4AF37]/40 bg-[#D4AF37]/10 text-[#8A6D1B] dark:text-[#E5C76B] hover:text-[#8A6D1B] dark:hover:text-[#E5C76B]"
          )}
          aria-label="Trial status — open profile"
        >
          {pro ? (
            <span className="font-semibold">✓ Pro active — unlimited 4K and 8K</span>
          ) : TESTING_UNLIMITED_TRIALS ? (
            <span>
              <span className="mr-1.5 rounded border border-amber-500/60 bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-extrabold tracking-wide text-amber-600 dark:text-amber-400">
                TEST MODE
              </span>
              Trial today: 4K {trialLeft}/{TRIAL_DAILY_4K} · 8K {trialLeft8k}/{TRIAL_DAILY_8K} free left
            </span>
          ) : identity ? (
            <span>Trial today: 4K {trialLeft}/{TRIAL_DAILY_4K} · 8K {trialLeft8k}/{TRIAL_DAILY_8K} free left</span>
          ) : (
            <span>Guest — sign in for the 4K/8K daily trial</span>
          )}
        </button>
      </header>

      <main className="px-4 py-4 space-y-5 max-w-[480px] mx-auto">
        {tab === "capture" ? (
          <>
            <CaptureTab
              captureType={captureType}
              pro={pro}
              onChange={(t) => {
                setCaptureType(t);
                // PDF exists only for full page.
                const f = format === "pdf" && t !== "fullPage" ? "png" as Format : format;
                if (f !== format) setFormat(f);
                persistConfig(t, quality, f);
              }}
            />

            <section>
              <h2 className="text-[17px] font-bold mb-2 flex items-center gap-1.5">
                Quality (Resolution)
                <InfoTip
                  id="quality-tip"
                  label="About quality options"
                  text="Shots match your screen, or render denser for higher qualities. Full page saves at full width."
                />
              </h2>
              <div className="grid grid-cols-4 gap-2">
                {QUALITIES.map((q) => (
                  <QualityButton
                    key={q}
                    active={quality === q}
                    quality={q}
                    sub={QUALITY_DIMS[q]}
                    pro={pro}
                    locked={lockedQualities.includes(q)}
                    trialLeft={
                      q === "4K"
                        ? pro
                          ? undefined
                          : identity
                            ? trialLeft
                            : TRIAL_DAILY_4K
                        : q === "8K"
                          ? pro
                            ? undefined
                            : identity
                              ? trialLeft8k
                              : TRIAL_DAILY_8K
                          : undefined
                    }
                    onClick={() => {
                      if (lockedQualities.includes(q)) {
                        setProOpen(identity ? "upsell" : "login");
                        return;
                      }
                      if (!pro && !TESTING_UNLIMITED_TRIALS && (q === "4K" || q === "8K")) {
                        if (!identity) {
                          setProOpen("login");
                          return;
                        }
                        trialRemaining(q, identity).then((left) => {
                          if (q === "4K") setTrialLeft(left);
                          else setTrialLeft8k(left);
                          if (left <= 0) {
                            setProOpen("upsell");
                            return;
                          }
                          setQuality(q);
                          persistConfig(captureType, q, format);
                        });
                        return;
                      }
                      setQuality(q);
                      persistConfig(captureType, q, format);
                    }}
                  />
                ))}
              </div>
              {!pro && (trialLeft < TRIAL_DAILY_4K || trialLeft8k < TRIAL_DAILY_8K) && (
                <p className="mt-1.5 text-[12px] text-muted-foreground">
                  Trial today: 4K {trialLeft}/{TRIAL_DAILY_4K} · 8K {trialLeft8k}/{TRIAL_DAILY_8K} free left.
                </p>
              )}
              {pro && (
                <p className="mt-1.5 text-[12px] font-semibold text-[#8A6D1B] dark:text-[#E5C76B]">
                  ✓ Pro active — unlimited 4K and 8K.
                </p>
              )}
            </section>

            <section>
              <h2 className="text-[17px] font-bold mb-2">Format</h2>
              <div className="flex gap-2 items-stretch">
                {(["png", "jpg", "webp"] as Format[]).map((f) => (
                  <FormatButton key={f} active={format === f} format={f} pro={pro} onClick={() => { setFormat(f); persistConfig(captureType, quality, f); }} />
                ))}
                {captureType === "fullPage" && (
                  <FormatButton
                    active={format === "pdf"}
                    format={"pdf" as Format}
                    pro={pro}
                    onClick={() => { setFormat("pdf"); persistConfig(captureType, quality, "pdf"); }}
                  />
                )}
              </div>
            </section>

            <section className="rounded-2xl border border-border bg-card p-3.5">
              <div className="flex items-center gap-2 mb-1">
                <Bookmark size={17} className="text-foreground" />
                <h2 className="font-bold text-[15px]">Save as Preset</h2>
              </div>
              <p className="text-[13px] text-muted-foreground mb-2.5">Save the current configuration</p>
              <div className="flex gap-2">
                <input
                  value={presetName}
                  onChange={(e) => setPresetName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleSavePreset();
                  }}
                  placeholder="Enter preset name…"
                  aria-label="Preset name"
                  className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
                />
                <Button onClick={handleSavePreset} disabled={!presetName.trim() || busy} className={cn(pro && "bg-gradient-to-r from-[#A8842C] to-[#D4AF37] dark:from-[#B8912A] dark:to-[#E5C76B] text-[#1A1405] border border-[#8A6D1B]/40 shadow-sm hover:brightness-105")}>
                  Save
                </Button>
              </div>
              {activePreset && (
                <p className="mt-2 text-[12.5px] text-muted-foreground">
                  Active: <span className="font-semibold text-foreground">{activePreset.name}</span>
                </p>
              )}
            </section>

            <Button onClick={handleCapture} disabled={busy} className={cn("w-full h-12 text-[15px] font-bold rounded-xl border shadow-lg", pro ? "bg-gradient-to-r from-[#A8842C] via-[#D4AF37] to-[#B8912A] dark:from-[#B8912A] dark:via-[#E5C76B] dark:to-[#B8912A] text-[#1A1405] border-[#8A6D1B]/40" : "bg-gradient-to-r from-[#2563EB] to-[#3B82F6] dark:from-[#2563EB] dark:to-[#60A5FA] text-white border-white/20")}>
              <Camera size={19} /> Capture Screenshot
              <kbd className={cn("ml-2 rounded-md border px-2 py-0.5 text-[11px] font-medium", pro ? "border-[#1A1405]/30" : "border-white/30")} title="Remap to Ctrl + Alt + S in chrome://extensions/shortcuts">Alt + Shift + S</kbd>
            </Button>
          </>
        ) : (
          <>
            <div>
              <h2 className="text-[19px] font-extrabold">Presets</h2>
              <p className="text-[13.5px] text-muted-foreground">Choose a preset to quickly capture with the same settings.</p>
            </div>
            <PresetsTab
              presets={presets}
              activeId={activeId}
              onSetActive={async (id) => {
                await setActivePreset(id);
                setActiveId(id);
                toast.success("Active preset updated");
              }}
              onDelete={async (id) => {
                const res = await deletePreset(id);
                setPresets(res.presets);
                setActiveId(res.activePresetId);
                toast.success("Preset deleted");
              }}
              onEdit={(p) => setEditing(p)}
              onCapture={(p) =>
                fireCapture({ captureType: p.captureType, quality: p.quality, format: p.format })
              }
            />
          </>
        )}
      </main>

      {/* Test-mode only: collapsible diagnostics log pinned at the bottom.
          Hidden entirely (not just collapsed) in store builds. */}
      {TESTING_UNLIMITED_TRIALS && (
        <div className="px-4 pb-2 max-w-[480px] mx-auto">
          <CaptureLogs />
        </div>
      )}

      <footer className="pb-3 text-center text-[11px] text-muted-foreground">
        Custom Screenshot v{APP_VERSION}
      </footer>

      {editing && (
        <EditPresetDialog
          preset={editing}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            const next = await updatePreset(editing.id, patch);
            setPresets(next);
            setEditing(null);
            toast.success("Preset updated");
          }}
        />
      )}

      {profileOpen && (
        <ProfileDialog
          email={identity}
          pro={pro}
          trial4k={trialLeft}
          trial8k={trialLeft8k}
          clipboard={clipboard}
          onClipboardChange={(on) => {
            setClipboard(on);
            saveSettings({ clipboard: on }).catch(() => undefined);
            toast.success(on ? "Screenshots will also copy to clipboard" : "Clipboard copy off");
          }}          onSignIn={() => {
            setProfileOpen(false);
            setProOpen("login");
          }}
          onUpgrade={() => {
            // Non-Pro shortcut to the upsell. Signed-out users have no trial
            // identity yet, so route them through sign-in first (login mode).
            setProfileOpen(false);
            setProOpen(identity ? "upsell" : "login");
          }}
          onSignOut={() => {
            setIdentity(null);
            setPro(false);
            // Signed out = no tracked usage: badges fall back to the full daily count.
            setTrialLeft(TRIAL_DAILY_4K);
            setTrialLeft8k(TRIAL_DAILY_8K);
            setProfileOpen(false);
            chrome.storage.local.remove(["trialEmail", "proPaid"]).catch(() => undefined);
          }}
          onClose={() => setProfileOpen(false)}
        />
      )}

      {proOpen && (
        <ProModal
          mode={proOpen}
          trialLeft4k={trialLeft}
          trialLeft8k={trialLeft8k}
          onClose={() => {
            setProOpen(null);
            const em = identity ?? "";
            trialRemaining("4K", em).then(setTrialLeft).catch(() => undefined);
            trialRemaining("8K", em).then(setTrialLeft8k).catch(() => undefined);
          }}
          onUnlocked={() => {
            setPro(true);
            const em = identity ?? "";
            trialRemaining("4K", em).then(setTrialLeft).catch(() => undefined);
            trialRemaining("8K", em).then(setTrialLeft8k).catch(() => undefined);
          }}
          onSignedIn={(email) => {
            setIdentity(email);
            trialRemaining("4K", email).then(setTrialLeft).catch(() => undefined);
            trialRemaining("8K", email).then(setTrialLeft8k).catch(() => undefined);
          }}
        />
      )}
    </div>
  );
}
