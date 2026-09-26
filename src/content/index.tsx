import { cropDataUrl, processDataUrl, canvasToDataUrl, loadImage } from "../lib/capture";
import { jpegPagesToPdfDataUrl, type PdfPageImage } from "../lib/pdf";
import type { CaptureType, Format, Quality } from "../types";

const HOST_ID = "custom-screenshot-host";
const DIM_ID = "cs-focus-dim";

let host: HTMLElement | null = null;
let shadow: ShadowRoot | null = null;
let focusKeyHandler: ((e: KeyboardEvent) => void) | null = null;

function ensureHost(): ShadowRoot {
  const existing = document.getElementById(HOST_ID);
  if (existing && existing.shadowRoot) {
    host = existing;
    shadow = existing.shadowRoot as ShadowRoot;
    return shadow;
  }
  host = document.createElement("div");
  host.id = HOST_ID;
  host.style.cssText =
    "all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none;";
  document.documentElement.appendChild(host);
  shadow = host.attachShadow({ mode: "open" });
  return shadow;
}

function isOurNode(node: unknown): boolean {
  if (!(node instanceof Element)) return false;
  if (node.id === HOST_ID) return true;
  try {
    return !!shadow?.contains(node);
  } catch {
    return false;
  }
}

// ---------- centered focus pill (summoned by toolbar click) ----------

function pillHTML(): string {
  return `
  <style>
    .cs-focus{pointer-events:auto;position:fixed;top:14px;left:50%;transform:translateX(-50%);font-family:Inter,ui-sans-serif,system-ui,sans-serif;z-index:2147483647;text-align:center;}
    .cs-pill{display:inline-flex;align-items:stretch;border-radius:14px;overflow:hidden;background:linear-gradient(135deg,rgba(37,99,235,.85),rgba(59,130,246,.75));backdrop-filter:blur(16px) saturate(1.5);-webkit-backdrop-filter:blur(16px) saturate(1.5);border:none;box-shadow:0 12px 32px rgba(15,23,42,.45),inset 0 1px 0 rgba(255,255,255,.25);}
    .cs-main{display:flex;align-items:center;gap:9px;background:transparent;border:none;border-right:1px solid rgba(255,255,255,.35);color:#fff;padding:10px 20px;font-size:14px;font-weight:700;cursor:pointer;white-space:nowrap;}
    .cs-main:hover{background:rgba(255,255,255,.14);}
    .cs-main:focus-visible,.cs-arrow:focus-visible{outline:2px solid #fff;outline-offset:-2px;}
    .cs-arrow{display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.10);border:none;color:#fff;padding:10px 14px;font-size:12px;cursor:pointer;}
    .cs-arrow:hover{background:rgba(255,255,255,.22);}
    .cs-hint{margin-top:8px;display:inline-block;background:rgba(15,23,42,.8);backdrop-filter:blur(8px);color:#fff;font-size:12px;padding:4px 12px;border-radius:999px;border:1px solid rgba(255,255,255,.2);}
  </style>
  <div class="cs-focus" id="cs-focus" role="toolbar" aria-label="Custom Screenshot quick capture">
    <div class="cs-pill">
      <button class="cs-main" id="cs-focus-capture" aria-label="Capture now with the active preset">Capture</button>
      <button class="cs-arrow" id="cs-focus-open" aria-label="Open Custom Screenshot settings panel">▾</button>
    </div>
    <div><span class="cs-hint">Click capture, or press Esc to cancel</span></div>
  </div>`;
}

function hideFocus() {
  document.getElementById(DIM_ID)?.remove();
  shadow?.getElementById("cs-focus")?.remove();
  if (focusKeyHandler) {
    document.removeEventListener("keydown", focusKeyHandler, true);
    focusKeyHandler = null;
  }
}

function showFocus() {
  hideFocus();
  const root = ensureHost();
  const dim = document.createElement("div");
  dim.id = DIM_ID;
  dim.style.cssText =
    "position:fixed;inset:0;background:rgba(15,23,42,.55);z-index:2147483645;cursor:default;";
  dim.addEventListener("click", () => hideFocus());
  document.documentElement.appendChild(dim);

  const tpl = document.createElement("template");
  tpl.innerHTML = pillHTML();
  root.appendChild(tpl.content.cloneNode(true));
  root.getElementById("cs-focus-capture")?.addEventListener("click", () => void onFocusCapture());
  root.getElementById("cs-focus-open")?.addEventListener("click", () => {
    hideFocus();
    chrome.runtime.sendMessage({ type: "CS_OPEN_PANEL" }).catch(() => undefined);
  });
  (root.getElementById("cs-focus-capture") as HTMLElement | null)?.focus();
  focusKeyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      hideFocus();
    }
  };
  document.addEventListener("keydown", focusKeyHandler, true);
}

async function onFocusCapture() {
  hideFocus();
  try {
    const cfg = await readActiveConfig();
    const res = await chrome.runtime.sendMessage({
      type: "CS_CAPTURE",
      config: { captureType: cfg.captureType, quality: cfg.quality, format: cfg.format },
    });
    if (!res?.ok) {
      const rawErr = res?.error ?? "Unknown error";
      const trialQ = rawErr.startsWith("TRIAL_EXHAUSTED") ? rawErr.split(":")[1] || "4K" : null;
      const err = trialQ
        ? `Daily ${trialQ} trial used up (2/day) — open Custom Screenshot to go Pro`
        : rawErr;
      toast("Capture failed", err, true);
    }
    // ok + result null => interactive pick started; pick overlay takes over.
  } catch (err) {
    toast("Capture failed", err instanceof Error ? err.message : String(err), true);
  }
}

// legacy compat: background hides our UI before a clean shot.
// uiHidden also gates the busy pill so it never photobombs a capture.
let uiHidden = false;

function hideUI() {
  hideFocus();
  uiHidden = true;
  renderBusy();
  setFocusSuppressed(true);
  // A previous toast/pill must never leak into the next shot.
  shadow?.getElementById("cs-toast")?.remove();
  shadow?.getElementById("cs-focus")?.remove();
}
function showUI() {
  uiHidden = false;
  renderBusy();
  setFocusSuppressed(false);
}

// Browser focus rings (e.g. a focused button/link) and scrollbars are page
// pixels, so they would be captured. Adjusted purely through CSS: a temporary
// stylesheet neutralizes them while a capture runs, removed afterwards.
function setFocusSuppressed(on: boolean) {
  const id = "cs-focus-killer";
  if (on) {
    if (!document.getElementById(id)) {
      const st = document.createElement("style");
      st.id = id;
      st.textContent = `*:focus{outline:none !important;box-shadow:none !important;}*:focus-visible{outline:none !important;box-shadow:none !important;}html::-webkit-scrollbar,body::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;}html,body{scrollbar-width:none !important;-ms-overflow-style:none !important;}`;
      document.head.appendChild(st);
    }
  } else {
    document.getElementById(id)?.remove();
  }
}

function flashDim(ms = 180) {
  const d = document.createElement("div");
  d.style.cssText =
    "position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:2147483646;pointer-events:none;";
  document.documentElement.appendChild(d);
  setTimeout(() => d.remove(), ms);
}

// ---------- busy indicator (spinner cursor + "Capturing" pill) ----------

let prevCursor = "";
let busyOn = false;

function renderBusy() {
  const show = busyOn && !uiHidden;
  const root = show ? ensureHost() : shadow;
  const existing = root?.getElementById("cs-busy");
  if (show && !existing && root) {
    const tpl = document.createElement("template");
    tpl.innerHTML = `
      <style>
        .cs-busy{pointer-events:none;position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;display:flex;align-items:center;gap:9px;font-family:Inter,ui-sans-serif,system-ui,sans-serif;font-size:13px;font-weight:600;color:#fff;background:rgba(15,23,42,.85);backdrop-filter:blur(8px);border-radius:999px;padding:8px 16px;box-shadow:0 12px 32px rgba(0,0,0,.35);}
        .cs-spin{width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,.35);border-top-color:#fff;animation:cs-spin .7s linear infinite;}
        @keyframes cs-spin{to{transform:rotate(360deg);}}
      </style>
      <div class="cs-busy" id="cs-busy" role="status" aria-label="Capturing screenshot"><span class="cs-spin"></span>Capturing…</div>`;
    root.appendChild(tpl.content.cloneNode(true));
  } else if (!show) {
    existing?.remove();
  }
}

function setBusy(on: boolean) {
  busyOn = on;
  if (on) {
    ensureHost();
    if (!prevCursor) prevCursor = document.documentElement.style.cursor;
    document.documentElement.style.cursor = "progress";
    document.body.style.cursor = "progress";
  } else {
    document.documentElement.style.cursor = prevCursor;
    document.body.style.cursor = "";
    prevCursor = "";
  }
  renderBusy();
}

async function styledTheme(): Promise<"light" | "dark"> {  try {
    const data = await chrome.storage.local.get(["settings"]);
    const t = (data.settings as { theme?: string } | undefined)?.theme;
    if (t === "dark" || t === "light") return t;
  } catch {
    /* noop */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

async function toast(title: string, body: string, error = false) {
  const theme = await styledTheme();
  const root = ensureHost();
  const old = root.getElementById("cs-toast");
  old?.remove();
  const el = document.createElement("div");
  el.id = "cs-toast";
  el.setAttribute("role", error ? "alert" : "status");
  const bg = error ? "#DC2626" : theme === "dark" ? "#1E293B" : "#0F172A";
  const border = error ? "#991B1B" : theme === "dark" ? "#334155" : "#1E293B";
  el.style.cssText = `position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:2147483647;pointer-events:none;font-family:Inter,ui-sans-serif,system-ui,sans-serif;background:${bg};color:#fff;border:1px solid ${border};border-radius:12px;padding:10px 16px;font-size:13px;font-weight:500;box-shadow:0 12px 32px rgba(0,0,0,.35);display:flex;gap:8px;align-items:center;max-width:min(480px,90vw);`;
  el.textContent = `${error ? "✕" : "✓"} ${title}${body ? " — " + body : ""}`;
  root.appendChild(el);
  setTimeout(() => el.remove(), error ? 5000 : 3200);
}

// ---------- region / element pick ----------

function notifyCancelled() {
  chrome.runtime.sendMessage({ type: "CS_PICK_CANCELLED" }).catch(() => undefined);
}

function cleanupOverlay() {
  document.getElementById("cs-pick-overlay")?.remove();
  document.getElementById("cs-pick-box")?.remove();
  document.getElementById("cs-pick-label")?.remove();
  document.body.style.cursor = "";
  document.removeEventListener("keydown", escHandler, true);
  setFocusSuppressed(false);
  cancelPick = null;
}

function escHandler(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.stopPropagation();
    e.preventDefault();
    cancelPick?.();
  }
}

// Single cancel path for an in-progress pick: removes EVERYTHING
// (overlay, drag box, highlight, cursor, listeners) and notifies background.
let cancelPick: (() => void) | null = null;

function startPick(mode: "region" | "element") {
  hideFocus();
  setBusy(false); // the selection overlay itself is the indicator from here
  // Kill any previous in-progress pick first (re-triggered shortcut/pill):
  // otherwise its document listeners leak and haunt the new pick.
  const prev = cancelPick;
  cancelPick = null;
  try {
    prev?.();
  } catch {
    /* noop */
  }
  cleanupOverlay();
  const overlay = document.createElement("div");
  overlay.id = "cs-pick-overlay";
  // pointer-events:none so elementFromPoint sees the real page (element mode);
  // region mode listens on the document instead of the overlay.
  overlay.style.cssText =
    "position:fixed;inset:0;background:rgba(15,23,42,.45);z-index:2147483646;pointer-events:none;cursor:crosshair;";
  document.documentElement.appendChild(overlay);
  document.body.style.cursor = "crosshair";
  setFocusSuppressed(true);
  document.addEventListener("keydown", escHandler, true);

  if (mode === "region") startRegion(overlay);
  else startElement(overlay);
}

function finishPickOverlay(overlay: HTMLElement) {
  overlay.remove();
  document.removeEventListener("keydown", escHandler, true);
  document.body.style.cursor = "";
}

function startRegion(overlay: HTMLElement) {
  let startX = 0;
  let startY = 0;
  let box: HTMLElement | null = null;
  let label: HTMLElement | null = null;
  let dragging = false;

  const onDown = (e: MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = true;
    startX = e.clientX;
    startY = e.clientY;
    box = document.createElement("div");
    box.style.cssText =
      "position:fixed;border:2px solid #2563EB;background:rgba(37,99,235,.15);z-index:2147483647;pointer-events:none;";
    label = document.createElement("div");
    label.style.cssText =
      "position:fixed;background:#0F172A;color:#fff;font:12px Inter,system-ui,sans-serif;padding:2px 8px;border-radius:6px;z-index:2147483647;pointer-events:none;";
    document.documentElement.appendChild(box);
    document.documentElement.appendChild(label);
    moveBox(e);
  };
  const moveBox = (e: MouseEvent) => {
    if (!dragging || !box || !label) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${w}px`;
    box.style.height = `${h}px`;
    label.style.left = `${x}px`;
    label.style.top = `${Math.max(0, y - 24)}px`;
    label.textContent = `${Math.round(w)} × ${Math.round(h)}`;
  };
  const teardownRegion = () => {
    dragging = false;
    document.removeEventListener("mousedown", onDown, true);
    window.removeEventListener("mousemove", moveBox, true);
    document.removeEventListener("mouseup", onUp, true);
    box?.remove();
    label?.remove();
    box = null;
    label = null;
  };
  // Esc (or tiny selection) removes EVERYTHING: listeners, box, overlay, cursor.
  cancelPick = () => {
    teardownRegion();
    cleanupOverlay();
    notifyCancelled();
  };
  const onUp = async (e: MouseEvent) => {
    if (!dragging) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    teardownRegion();
    cleanupOverlay();
    if (w < 4 || h < 4) {
      notifyCancelled();
      return;
    }
    try {
      // let the browser repaint without our overlay before capturing
      await new Promise((r) => setTimeout(r, 120));
      const cfg = await readActiveConfig();
      const raw = (await requestBoosted(cfg.quality)) ?? (await requestRaw());
      const cropped = await cropDataUrl(raw, { x, y, width: w, height: h }, cfg.quality, cfg.format);
      await chrome.runtime.sendMessage({
        type: "CS_FINISH_PICK",
        dataUrl: cropped.dataUrl,
        width: cropped.width,
        height: cropped.height,
        format: cfg.format,
      });
    } catch (err) {
      toast("Capture failed", err instanceof Error ? err.message : String(err), true);
    }
  };
  document.addEventListener("mousedown", onDown, true);
  window.addEventListener("mousemove", moveBox, true);
  document.addEventListener("mouseup", onUp, true);
}

function startElement(overlay: HTMLElement) {
  let current: Element | null = null;
  let done = false;
  const prevOutline = new Map<Element, string>();
  const prevOffset = new Map<Element, string>();
  let tag: HTMLElement | null = null;

  const showTag = (e: MouseEvent, el: Element) => {
    if (!tag) {
      tag = document.createElement("div");
      tag.id = "cs-pick-label";
      tag.style.cssText =
        "position:fixed;background:#0F172A;color:#fff;font:12px Inter,system-ui,sans-serif;padding:2px 8px;border-radius:6px;z-index:2147483647;pointer-events:none;white-space:nowrap;";
      document.documentElement.appendChild(tag);
    }
    const r = (el as HTMLElement).getBoundingClientRect();
    const name = el.tagName.toLowerCase();
    const cls = (el as HTMLElement).id
      ? `#${(el as HTMLElement).id}`
      : ((el as HTMLElement).className?.toString?.().split(" ")[0] ?? "");
    tag.textContent = `${name}${cls ? " " + cls : ""} · ${Math.round(r.width)} × ${Math.round(r.height)}${e.altKey ? " (parent)" : ""}`;
    tag.style.left = `${Math.min(window.innerWidth - 180, e.clientX + 14)}px`;
    tag.style.top = `${Math.max(0, e.clientY - 28)}px`;
  };
  const hideTag = () => {
    tag?.remove();
    tag = null;
  };

  const highlight = (el: Element) => {
    if (current === el) return;
    unhighlight();
    current = el;
    const h = el as HTMLElement;
    prevOutline.set(el, h.style.outline);
    prevOffset.set(el, h.style.outlineOffset);
    h.style.outline = "2px solid #2563EB";
    h.style.outlineOffset = "2px";
  };
  const unhighlight = () => {
    if (!current) return;
    (current as HTMLElement).style.outline = prevOutline.get(current) ?? "";
    (current as HTMLElement).style.outlineOffset = prevOffset.get(current) ?? "";
    current = null;
  };
  const teardown = () => {
    done = true;
    document.removeEventListener("mousemove", onMove, true);
    document.removeEventListener("click", onClick, true);
    unhighlight();
    hideTag();
    cleanupOverlay();
  };
  // Esc removes EVERYTHING: listeners, highlight, overlay, cursor.
  cancelPick = () => {
    teardown();
    notifyCancelled();
  };
  const pickTarget = (e: MouseEvent, el: Element): Element => {
    // Alt+hover/click climbs to the parent (cards, sections) when hover
    // lands on a tiny nested child.
    if (e.altKey && el.parentElement && el.parentElement !== document.body) {
      return el.parentElement;
    }
    return el;
  };
  const onMove = (e: MouseEvent) => {
    if (done) return;
    const raw = document.elementFromPoint(e.clientX, e.clientY);
    if (!raw || isOurNode(raw) || raw.id === "cs-pick-overlay") return;
    if (raw === document.documentElement || raw === document.body) return;
    const el = pickTarget(e, raw);
    highlight(el);
    showTag(e, el);
  };
  const onClick = async (e: MouseEvent) => {
    if (done) return;
    const raw = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
    if (!raw || isOurNode(raw) || raw.id === "cs-pick-overlay") return; // ignore clicks on our UI
    e.preventDefault();
    e.stopPropagation();
    const hovered = current && (current === raw || raw.contains(current)) ? current : raw;
    const target = pickTarget(e, hovered);
    const r = (target as HTMLElement).getBoundingClientRect();
    teardown();
    const w = Math.min(r.width, window.innerWidth - Math.max(0, r.x));
    const h = Math.min(r.height, window.innerHeight - Math.max(0, r.y));
    if (w < 4 || h < 4) {
      notifyCancelled();
      return;
    }
    try {
      await new Promise((res) => setTimeout(res, 120));
      const cfg = await readActiveConfig();
      const raw = (await requestBoosted(cfg.quality)) ?? (await requestRaw());
      const cropped = await cropDataUrl(
        raw,
        { x: Math.max(0, r.x), y: Math.max(0, r.y), width: w, height: h },
        cfg.quality,
        cfg.format
      );
      await chrome.runtime.sendMessage({
        type: "CS_FINISH_PICK",
        dataUrl: cropped.dataUrl,
        width: cropped.width,
        height: cropped.height,
        format: cfg.format,
      });
    } catch (err) {
      toast("Capture failed", err instanceof Error ? err.message : String(err), true);
    }
  };
  document.addEventListener("mousemove", onMove, true);
  document.addEventListener("click", onClick, true);
}

async function readActiveConfig(): Promise<{ captureType: CaptureType; quality: Quality; format: Format }> {
  const data = await chrome.storage.local.get(["presets", "activePresetId", "settings"]);
  const presets = (data.presets ?? []) as Array<{
    id: string;
    captureType: CaptureType;
    quality: Quality;
    format: Format;
  }>;
  const active = presets.find((p) => p.id === data.activePresetId);
  if (active) return { captureType: active.captureType, quality: active.quality, format: active.format };
  const s = (data.settings ?? {}) as Partial<{
    captureType: CaptureType;
    quality: Quality;
    format: Format;
  }>;
  return {
    captureType: s.captureType ?? "visible",
    quality: (s.quality as Quality) ?? "1080p",
    format: s.format ?? "png",
  };
}

function requestRaw(): Promise<string> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "CS_CAPTURE_RAW_VISIBLE" }, (res) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (res?.ok) resolve(res.raw);
      else reject(new Error(res?.error ?? "Capture failed"));
    });
  });
}

/** Density-boosted viewport shot for crops; null when pointless or blocked. */
function requestBoosted(quality: Quality): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type: "CS_CAPTURE_BOOSTED_VISIBLE", quality }, (res) => {
        if (chrome.runtime.lastError || !res?.ok) resolve(null);
        else resolve(res.raw as string);
      });
    } catch {
      resolve(null);
    }
  });
}

// ---------- full page helpers ----------

let fpRestore: { display: Array<{ el: HTMLElement; v: string }>; styleEl: HTMLStyleElement | null } = {
  display: [],
  styleEl: null,
};

// Fixed elements pinned into flow (see fullpagePrep), restored here.
let fpFixed: Array<{ el: HTMLElement; css: string }> = [];

// GoFullPage-style: sticky elements laid into normal flow (relative + auto
// offsets) instead of hidden — no tiling/duplication, content stays visible.
let stickySaved: Array<{ el: HTMLElement; css: string }> = [];

function stickyToRelative() {
  stickySaved = [];
  const all = document.querySelectorAll("*");
  all.forEach((n) => {
    const el = n as HTMLElement;
    if (el.id === HOST_ID || el.id === "cs-pick-overlay" || el.id === DIM_ID) return;
    let pos = "";
    try {
      pos = getComputedStyle(el).position;
    } catch {
      return;
    }
    if (pos === "sticky") {
      stickySaved.push({ el, css: el.style.cssText });
      el.style.position = "relative";
      el.style.top = "auto";
      el.style.left = "auto";
      el.style.right = "auto";
      el.style.bottom = "auto";
    }
  });
}

function fullpageMetrics() {
  return {
    scrollHeight: Math.max(
      document.documentElement.scrollHeight,
      document.body?.scrollHeight ?? 0
    ),
    viewportH: window.innerHeight,
    viewportW: window.innerWidth,
    dpr: window.devicePixelRatio || 1,
  };
}

function fullpagePrep() {
  // Pin fixed elements into the document flow at their current visual offset
  // (GoFullPage-style): they render exactly once instead of on every segment.
  fpRestore.display = [];
  fpFixed = [];
  const sx = window.scrollX;
  const sy = window.scrollY;
  const all = document.querySelectorAll("*");
  all.forEach((n) => {
    const el = n as HTMLElement;
    if (el.id === HOST_ID || el.id === "cs-pick-overlay" || el.id === DIM_ID) return;
    let pos = "";
    try {
      pos = getComputedStyle(el).position;
    } catch {
      return;
    }
    if (pos !== "fixed") return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    fpFixed.push({ el, css: el.style.cssText });
    el.style.position = "absolute";
    el.style.top = `${r.top + sy}px`;
    el.style.left = `${r.left + sx}px`;
    if (r.width > 0) el.style.width = `${r.width}px`;
    if (r.height > 0) el.style.height = `${r.height}px`;
    el.style.marginTop = "0px";
  });
  const st = document.createElement("style");
  st.id = "cs-fp-style";
  st.textContent = `html{scroll-behavior:auto !important;}
html::-webkit-scrollbar,body::-webkit-scrollbar{width:0 !important;height:0 !important;display:none !important;}
html,body{scrollbar-width:none !important;-ms-overflow-style:none !important;}`;
  document.head.appendChild(st);
  fpRestore.styleEl = st;
}

function fullpageRestore(scrollY: number) {
  fpRestore.display.forEach(({ el, v }) => {
    el.style.display = v;
  });
  fpRestore.display = [];
  fpRestore.styleEl?.remove();
  fpRestore.styleEl = null;
  fpFixed.forEach(({ el, css }) => {
    try {
      el.style.cssText = css;
    } catch {
      /* noop */
    }
  });
  fpFixed = [];
  stickySaved.forEach(({ el, css }) => {
    try {
      el.style.cssText = css;
    } catch {
      /* noop */
    }
  });
  stickySaved = [];
  setFocusSuppressed(false);
  window.scrollTo(0, scrollY);
}

async function fullpageStitch(
  segments: string[],
  quality: Quality,
  format: Format,
  rangeStart = 0,
  rangeEnd?: number,
  targetWidth?: number,
  ys?: number[]
): Promise<{ dataUrl: string; width: number; height: number }> {
  const m = fullpageMetrics();
  const first = await loadImage(segments[0]);
  const scale = first.naturalWidth / m.viewportW;
  const totalCssH = Math.max(
    document.documentElement.scrollHeight,
    document.body?.scrollHeight ?? 0
  );
  const end = rangeEnd ?? totalCssH;
  const totalPxH = Math.max(1, Math.round((end - rangeStart) * scale));
  const canvas = document.createElement("canvas");
  canvas.width = first.naturalWidth;
  canvas.height = totalPxH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  for (let i = 0; i < segments.length; i++) {
    const img = i === 0 ? first : await loadImage(segments[i]);
    // Actual content top for this shot (clamped scrolls repeat viewport —
    // place by measured offset, never by blind index, to avoid duplication).
    const shotTop = ys && ys[i] != null ? ys[i] : rangeStart + i * m.viewportH;
    const visTop = Math.max(shotTop, rangeStart);
    const visBottom = Math.min(shotTop + m.viewportH, end);
    if (visBottom <= visTop) continue;
    const srcY = Math.min(
      img.naturalHeight - 1,
      Math.max(0, Math.round((visTop - shotTop) * scale))
    );
    const srcH = Math.max(
      1,
      Math.min(
        img.naturalHeight - srcY,
        Math.round((visBottom - visTop) * scale)
      )
    );
    const dyPx = Math.round((visTop - rangeStart) * scale);
    ctx.drawImage(img, 0, srcY, img.naturalWidth, srcH, 0, dyPx, img.naturalWidth, srcH);
  }
  // Full pages keep full WIDTH (like GoFullPage): fit target width + 16K
  // height cap, never upscale. Height follows aspect — no squeezed strips.
  const fit = Math.min(
    1,
    (targetWidth ?? canvas.width) / canvas.width,
    16384 / canvas.height
  );
  let out: HTMLCanvasElement = canvas;
  if (fit < 1) {
    out = document.createElement("canvas");
    out.width = Math.max(1, Math.round(canvas.width * fit));
    out.height = Math.max(1, Math.round(canvas.height * fit));
    const octx = out.getContext("2d");
    if (!octx) throw new Error("Canvas 2D unavailable");
    octx.imageSmoothingEnabled = true;
    octx.imageSmoothingQuality = "high";
    octx.drawImage(canvas, 0, 0, out.width, out.height);
  }
  if (format === "pdf") {
    // Paginate long shots (A4-ratio pages): single giant pages make
    // viewers tile/overlap content. Short shots stay one page.
    const pageH = Math.min(out.height, Math.max(1, Math.round((out.width * 297) / 210)));
    const pages: PdfPageImage[] = [];
    for (let y = 0; y < out.height; y += pageH) {
      const h = Math.min(pageH, out.height - y);
      const pc = document.createElement("canvas");
      pc.width = out.width;
      pc.height = h;
      const pctx = pc.getContext("2d");
      if (!pctx) throw new Error("Canvas 2D unavailable");
      pctx.drawImage(out, 0, y, out.width, h, 0, 0, out.width, h);
      pages.push({ jpegDataUrl: pc.toDataURL("image/jpeg", 0.92), w: out.width, h });
    }
    return {
      dataUrl: jpegPagesToPdfDataUrl(pages),
      width: out.width,
      height: out.height,
    };
  }
  return { dataUrl: await canvasToDataUrl(out, format), width: out.width, height: out.height };
}

// ---------- message handling ----------
// Guard against double registration when the background auto-injects
// this script into a tab that already has it.
const alreadyLoaded = (window as unknown as { __CS_LOADED?: boolean }).__CS_LOADED === true;
(window as unknown as { __CS_LOADED?: boolean }).__CS_LOADED = true;

if (!alreadyLoaded) {
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "CS_PING":
        sendResponse({ ok: true });
        break;
      case "CS_HIDE_UI":
        hideUI();
        sendResponse({ ok: true });
        break;
      case "CS_SHOW_UI":
        showUI();
        sendResponse({ ok: true });
        break;
      case "CS_FLASH":
        flashDim(180);
        await new Promise((r) => setTimeout(r, 220));
        sendResponse({ ok: true });
        break;
      case "CS_FOCUS_MODE":
        showFocus();
        sendResponse({ ok: true });
        break;
      case "CS_TOAST":
        setBusy(false);
        await toast(msg.title ?? "Done", msg.body ?? "", !!msg.error);
        sendResponse({ ok: true });
        break;
      case "CS_BUSY":
        setBusy(!!msg.on);
        sendResponse({ ok: true });
        break;
      case "CS_PROCESS_VISIBLE": {
        hideUI();
        await new Promise((r) => setTimeout(r, 50));
        const out = await processDataUrl(msg.raw, msg.quality as Quality, msg.format as Format);
        sendResponse(out);
        break;
      }
      case "CS_FULLPAGE_METRICS":
        sendResponse(fullpageMetrics());
        break;
      case "CS_GET_SCROLL":
        sendResponse(window.scrollY);
        break;
      case "CS_SCROLL_TO":
        window.scrollTo(0, msg.y);
        sendResponse({ ok: true });
        break;
      case "CS_FULLPAGE_PREP":
        fullpagePrep();
        sendResponse({ ok: true });
        break;
      case "CS_STICKY_REL":
        stickyToRelative();
        sendResponse({ ok: true });
        break;
      case "CS_FULLPAGE_RESTORE":
        fullpageRestore(msg.y ?? 0);
        sendResponse({ ok: true });
        break;
      case "CS_FULLPAGE_STITCH": {
        const out = await fullpageStitch(
          msg.segments,
          msg.quality as Quality,
          msg.format as Format,
          msg.rangeStart ?? 0,
          msg.rangeEnd,
          msg.targetWidth,
          msg.ys
        );
        sendResponse(out);
        break;
      }
      case "CS_START_PICK":
        startPick(msg.mode);
        sendResponse({ ok: true });
        break;
      default:
        break;
    }
  })().catch((e) => {
    try {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } catch {
      /* noop */
    }
  });
  return true;
});
} // end !alreadyLoaded guard

export {};
void canvasToDataUrl;
