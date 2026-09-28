import type { CaptureConfig } from "../types";
import { QUALITY_HEIGHT, QUALITY_WIDTH } from "../types";
import { getActivePreset, getSettings } from "../lib/storage";
import { trialRemaining, consumeTrial, TESTING_UNLIMITED_TRIALS } from "../lib/storage";
import { isPro, getTrialIdentity } from "../lib/pro";
import { formatTimestamp, sanitizeFilename } from "../lib/utils";
import { extFor } from "../lib/capture";
import { jpegPagesToPdfDataUrl, type PdfPageImage } from "../lib/pdf";

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tabs[0] ?? null;
}

async function ping(tabId: number): Promise<boolean> {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "CS_PING" });
    return true;
  } catch {
    return false;
  }
}

async function injectContent(tabId: number): Promise<{ ok: boolean; error: string }> {
  try {
    const manifest = chrome.runtime.getManifest();
    const files = manifest.content_scripts?.flatMap((cs) => cs.js ?? []) ?? [];
    if (files.length === 0) return { ok: false, error: "no content_scripts in manifest" };
    await chrome.scripting.executeScript({ target: { tabId }, files });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  // The injected loader fetches its module asynchronously — poll, don't ping once.
  for (let i = 0; i < 10; i++) {
    if (await ping(tabId)) return { ok: true, error: "" };
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ok: false, error: "injected but content script did not respond" };
}

function isRestrictedUrl(url: string): boolean {
  return (
    url === "" ||
    /^(chrome|chrome-extension|edge|about|brave|opera|vivaldi|view-source):/.test(url)
  );
}

async function ensureContent(tabId: number, tabUrl = ""): Promise<void> {
  if (await ping(tabId)) return;
  let url = tabUrl;
  if (!url) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    url = t?.url ?? "";
  }
  if (url && !isRestrictedUrl(url)) {
    // Regular page missing its script (tab predates install/reload): inject + retry.
    const res = await injectContent(tabId);
    if (res.ok) return;
    throw new Error(`Content script not ready (${res.error}). Refresh the page once, then try again.`);
  }
  // Restricted page (new-tab, chrome://, store) or hidden URL with failed injection.
  const res = url ? { ok: false, error: "page is not scriptable" } : await injectContent(tabId);
  if (res.ok) return;
  if (url.startsWith("chrome-extension://")) {
    throw new Error("Extension pages can't be captured by other extensions (Chrome rule). Try a regular website.");
  }
  throw new Error(
    `This page cannot be captured (${res.error}). Try a regular http(s) page, e.g. example.com.`
  );
}

async function captureVisible(windowId?: number, jpeg = false): Promise<string> {
  return chrome.tabs.captureVisibleTab(windowId ?? chrome.windows.WINDOW_ID_CURRENT, jpeg
    ? { format: "jpeg", quality: 90 }
    : { format: "png" });
}

/** captureVisibleTab is quota-limited; back off and retry instead of failing. */
async function captureVisibleRateLimited(windowId: number | undefined, jpeg: boolean, attempt = 0): Promise<string> {
  try {
    return await captureVisible(windowId, jpeg);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/quota|MAX_CAPTURE|throttl/i.test(msg) && attempt < 6) {
      await new Promise((r) => setTimeout(r, 700 * (attempt + 1)));
      return captureVisibleRateLimited(windowId, jpeg, attempt + 1);
    }
    throw e;
  }
}

function u8ToBlob(bytes: Uint8Array, mime: string): Blob {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return new Blob([copy.buffer as ArrayBuffer], { type: mime });
}

/** Page toast when possible, OS notification otherwise (restricted pages can't run content). */
async function feedback(tabId: number | null | undefined, title: string, body: string, error = false) {
  if (tabId != null) {
    try {
      await sendToTab(tabId, { type: "CS_TOAST", title, body, error });
      return;
    } catch {
      /* fall through to notification */
    }
  }
  try {
    await chrome.notifications.create({
      type: "basic",
      iconUrl: "icons/icon48.png",
      title: `Custom Screenshot: ${title}`,
      message: body,
    });
  } catch {
    /* noop */
  }
}

async function sendToTab<T>(tabId: number, msg: unknown): Promise<T> {
  return (await chrome.tabs.sendMessage(tabId, msg)) as T;
}

async function downloadDataUrl(
  dataUrl: string,
  format: string,
  suffix = "",
  tabId?: number
): Promise<void> {
  const ext = extFor(format as never);
  const filename = sanitizeFilename(`Screenshot_${formatTimestamp()}${suffix}.${ext}`);
  // chrome.downloads.download with data URL works for reasonable sizes; use it directly
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
}

async function ensureClipboardDoc(): Promise<string | null> {
  if (typeof chrome.offscreen === "undefined") {
    return "API_MISSING";
  }
  const reason = (chrome.offscreen.Reason?.CLIPBOARD ?? "CLIPBOARD") as never;
  // Close-then-create: avoids stale-document races entirely.
  try {
    await chrome.offscreen.closeDocument();
  } catch {
    /* none open — proceed to create */
  }
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen/clipboard.html",
      reasons: [reason],
      justification: "Copy screenshots to clipboard when enabled in settings",
    });
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

async function copyToClipboard(dataUrl: string, tabId?: number | null): Promise<"off" | "ok" | string> {
  let on = false;
  try {
    const s = await getSettings();
    on = s.clipboard === true;
  } catch {
    return "settings unreadable";
  }
  if (!on) return "off";
  const docErr = await ensureClipboardDoc();
  if (!docErr) {
    // The document exists but its script may still be loading — retry the
    // handshake briefly instead of failing on the first "receiving end" miss.
    let lastErr = "no response from clipboard writer";
    for (let i = 0; i < 8; i++) {
      try {
        const res = await chrome.runtime.sendMessage({ type: "CS_CLIPBOARD_WRITE", dataUrl });
        if (res?.ok) return res?.flavor === "html" ? "ok-html" : "ok";
        lastErr = res?.error ?? "copy rejected";
        break;
      } catch (e) {
        lastErr = e instanceof Error ? e.message : String(e);
        if (!/receiving end|no response|message port closed/i.test(lastErr)) break;
        await new Promise((r) => setTimeout(r, 350));
      }
    }
    // Offscreen failed: fall back to a page-context write (no extra
    // permission needed — clipboard.write first, execCommand fallback),
    // which succeeds when the tab is focused.
    if (tabId != null) {
      try {
        const res = await sendToTab<{ ok?: boolean; error?: string }>(tabId, {
          type: "CS_CLIPBOARD_WRITE_PAGE",
          dataUrl,
        });
        if (res?.ok) return "ok";
        return `page write failed (${res?.error ?? "unknown"}) [offscreen: ${lastErr}]`;
      } catch {
        /* report combined failure below */
      }
    }
    return lastErr;
  }
  // No offscreen API (old browser): last resort is a page-context write,
  // which needs the tab focused and may still fail — reported honestly.
  if (docErr !== "API_MISSING" || tabId == null) return `offscreen: ${docErr}`;
  try {
    const res = await sendToTab<{ ok?: boolean; flavor?: string; error?: string }>(tabId, {
      type: "CS_CLIPBOARD_WRITE_PAGE",
      dataUrl,
    });
    if (res?.ok) return res?.flavor === "html" ? "ok-html" : "ok";
    return `page write failed (${res?.error ?? "unknown"}) — update browser for reliable copy`;
  } catch (e) {
    return `page write failed (${e instanceof Error ? e.message : String(e)}) — update browser for reliable copy`;
  }
}

/** Copies when enabled. Success appends "· copied" to the success toast;
 * failures get their OWN toast (stacked below, never overlapping). */
async function copyReport(
  tabId: number | null | undefined,
  dataUrl: string,
  format: string
): Promise<string> {
  if (format === "pdf") {
    let on = false;
    try {
      on = (await getSettings()).clipboard === true;
    } catch {
      /* noop */
    }
    return on ? " · clipboard skipped for PDF" : "";
  }
  const r = await copyToClipboard(dataUrl, tabId);
  const approxKb = Math.max(1, Math.round(((dataUrl.length * 3) / 4 / 1024) * 10) / 10);
  const size = approxKb >= 1024 ? `${(approxKb / 1024).toFixed(1)}MB` : `${approxKb}KB`;
  if (r === "ok") return ` · copied (${size})`;
  if (r === "ok-html") return ` · copied as image (${size}) — paste into chat/docs`;
  if (r !== "off") await feedback(tabId, "Clipboard copy failed", r, true);
  return "";
}

async function withOverlayHidden<T>(tabId: number, fn: () => Promise<T>): Promise<T> {
  try {
    await sendToTab(tabId, { type: "CS_HIDE_UI" });
    await new Promise((r) => setTimeout(r, 60));
    return await fn();
  } finally {
    await sendToTab(tabId, { type: "CS_SHOW_UI" }).catch(() => undefined);
  }
}

async function captureVisiblePreset(tab: chrome.tabs.Tab, cfg: CaptureConfig) {
  if (tab.id == null) throw new Error("No active tab");
  await ensureContent(tab.id, tab.url ?? "");
  // Augustat path: re-render the same viewport at higher density when the
  // screen alone can't reach the requested quality. Falls back silently.
  const geom = await pageGeom(tab.id);
  const targetH = QUALITY_HEIGHT[cfg.quality];
  const boost = geom ? boostFor(geom.viewportH, geom.dpr || 1, targetH) : 1;
  if (geom && boost > 1) {
    try {
      const res = await withOverlayHidden(tab.id, async () => {
        const shot = await emuCaptureViewport(
          tab.id!,
          geom.viewportW,
          geom.viewportH,
          (geom.dpr || 1) * boost
        );
        const bmp = await createImageBitmap(u8ToBlob(shot.bytes, shot.mime));
        try {
          return await finalizeBitmapSW(bmp, cfg);
        } finally {
          bmp.close();
        }
      });
      await downloadDataUrl(res.dataUrl, cfg.format, "", tab.id);
      return res;
    } catch {
      /* fall through to classic path */
    }
  }
  const res = await withOverlayHidden(tab.id, async () => {
    const raw = await captureVisibleRateLimited(tab.windowId, false);
    return sendToTab<{ dataUrl: string; width: number; height: number }>(tab.id!, {
      type: "CS_PROCESS_VISIBLE",
      raw,
      quality: cfg.quality,
      format: cfg.format,
    });
  });
  await downloadDataUrl(res.dataUrl, cfg.format, "", tab.id);
  return res;
}

// Full page, primary: emulate the full content size at high density and take
// ONE shot (Augustat technique via debugger). Falls back to scroll+stitch
// wherever Chrome blocks the debugger.
async function captureFullPageEmu(
  tab: chrome.tabs.Tab,
  cfg: CaptureConfig,
  geom: PageGeom | null
) {
  const tabId = tab.id!;
  await sendToTab(tabId, { type: "CS_HIDE_UI" }).catch(() => undefined);
  // Wake lazy-loaded content with a quick scroll-through (no captures, no quota).
  const scrollY = await sendToTab<number>(tabId, { type: "CS_GET_SCROLL" }).catch(() => 0);
  if (geom && geom.scrollHeight > geom.viewportH) {
    for (let y = 0; y < geom.scrollHeight; y += Math.max(1, geom.viewportH)) {
      await sendToTab(tabId, { type: "CS_SCROLL_TO", y }).catch(() => undefined);
      await new Promise((r) => setTimeout(r, 120));
    }
  }
  await sendToTab(tabId, { type: "CS_STICKY_REL" }).catch(() => undefined);
  await dbgAttach(tabId);
  try {
    const lm = (await dbgSend(tabId, "Page.getLayoutMetrics", {})) as {
      contentSize: { x: number; y: number; width: number; height: number };
    };
    const W = Math.max(1, Math.ceil(lm.contentSize.width));
    const H = Math.max(1, Math.ceil(lm.contentSize.height));
    if (W <= 0 || H <= 0) throw new Error("Could not measure the page.");
    const dpr = geom?.dpr || 1;
    const zoomQ = cfg.quality === "4K" || cfg.quality === "8K" ? 2 : cfg.quality === "2K" ? 1.5 : 1;
    const dsf = Math.max(0.25, Math.min(dpr * zoomQ, 16000 / H, 16000 / W));
    await dbgSend(tabId, "Emulation.setDeviceMetricsOverride", {
      width: W,
      height: H,
      deviceScaleFactor: dsf,
      mobile: false,
      screenOrientation:
        W >= H ? { angle: 0, type: "landscapePrimary" } : { angle: 0, type: "portraitPrimary" },
    });
    await new Promise((r) => setTimeout(r, 400));
    const shot = await dbgShot(tabId);
    await dbgSend(tabId, "Emulation.clearDeviceMetricsOverride", {}).catch(() => undefined);
    const bmp = await createImageBitmap(u8ToBlob(shot.bytes, shot.mime));
    try {
      const final = await finalizeBitmapSW(bmp, cfg, "width");
      await downloadDataUrl(final.dataUrl, cfg.format, "", tabId);
      return { ...final, parts: 1 };
    } finally {
      bmp.close();
    }
  } finally {
    await dbgSend(tabId, "Emulation.clearDeviceMetricsOverride", {}).catch(() => undefined);
    await dbgDetach(tabId);
    await sendToTab(tabId, { type: "CS_FULLPAGE_RESTORE", y: scrollY }).catch(() => undefined);
    await sendToTab(tabId, { type: "CS_SHOW_UI" }).catch(() => undefined);
  }
}

async function captureFullPageLoop(tab: chrome.tabs.Tab, cfg: CaptureConfig) {
  const tabId = tab.id!;
  await ensureContent(tabId, tab.url ?? "");
  const geom = await pageGeom(tabId);
  try {
    return await captureFullPageEmu(tab, cfg, geom);
  } catch (e) {
    if (e instanceof Error && /DBG_ATTACHED_ELSEWHERE/.test(e.message)) {
      throw new Error("Close DevTools (F12) and try again — only one debugger can run at a time.");
    }
    return captureFullPageScroll(tab, cfg);
  }
}

// Full page WITHOUT debugger: scroll + capture + stitch in the page.
// Sticky laid into flow and fixed pinned to absolute offsets (GoFullPage-style),
// so each segment contributes fresh content exactly once — one image file.
async function captureFullPageScroll(tab: chrome.tabs.Tab, cfg: CaptureConfig) {
  const tabId = tab.id!;
  await ensureContent(tabId, tab.url ?? "");
  await sendToTab(tabId, { type: "CS_HIDE_UI" }).catch(() => undefined);
  const prevZoom = await chrome.tabs.getZoom(tabId).catch(() => 1);
  const zooms = cfg.quality === "4K" || cfg.quality === "8K" ? [2, 1.5, 1] : cfg.quality === "2K" ? [1.5, 1] : [1];
  let zoomUsed = 1;
  let info = { scrollHeight: 0, viewportH: 1, viewportW: 1, dpr: 1 };
  try {
    for (const z of zooms) {
      zoomUsed = z;
      if (z !== 1) {
        await chrome.tabs.setZoom(tabId, z).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 450));
      }
      info = await sendToTab<typeof info>(tabId, { type: "CS_FULLPAGE_METRICS" });
      const estPx = info.scrollHeight * Math.max(1, info.dpr || 1) * z;
      if (estPx <= 16000 || z === zooms[zooms.length - 1]) break;
    }
    const viewportH = Math.max(1, info.viewportH);
    const total = info.scrollHeight;
    if (viewportH <= 0 || total <= 0) throw new Error("Could not measure the page.");
    if (total * Math.max(1, info.dpr || 1) * zoomUsed > 16384) {
      throw new Error("Page is too tall to stitch on this display. Try Select Region instead.");
    }
    const scrollY = await sendToTab<number>(tabId, { type: "CS_GET_SCROLL" });
    // Lay sticky into flow + pin fixed to absolute — each renders exactly once.
    await sendToTab(tabId, { type: "CS_STICKY_REL" }).catch(() => undefined);
    await sendToTab(tabId, { type: "CS_FULLPAGE_PREP" });
    try {
      const segments: string[] = [];
      const ys: number[] = [];
      let y = 0;
      while (true) {
        // Clamp the final scroll so the browser doesn't re-show the previous
        // viewport (which would duplicate content at the seam).
        const yy = Math.max(0, Math.min(y, total - viewportH));
        await sendToTab(tabId, { type: "CS_SCROLL_TO", y: yy });
        await new Promise((r) => setTimeout(r, 600));
        // JPEG segments: far smaller messages; stitched + re-encoded after.
        segments.push(await captureVisibleRateLimited(tab.windowId, true));
        ys.push(yy);
        if (yy + viewportH >= total) break;
        y += viewportH;
        if (segments.length > 40) {
          throw new Error("Page is too long for full-page capture. Try Select Region instead.");
        }
      }
      const stitched = await sendToTab<{ dataUrl: string; width: number; height: number }>(tabId, {
        type: "CS_FULLPAGE_STITCH",
        segments,
        ys,
        quality: cfg.quality,
        format: cfg.format,
        rangeStart: 0,
        rangeEnd: total,
        targetWidth: QUALITY_WIDTH[cfg.quality],
      });
      await downloadDataUrl(stitched.dataUrl, cfg.format, "", tabId);
      return { ...stitched, parts: 1 };
    } finally {
      if (zoomUsed !== 1) {
        await chrome.tabs.setZoom(tabId, prevZoom || 1).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 300));
      }
      await sendToTab(tabId, { type: "CS_FULLPAGE_RESTORE", y: scrollY }).catch(() => undefined);
      await sendToTab(tabId, { type: "CS_SHOW_UI" }).catch(() => undefined);
    }
  } catch (e) {
    if (zoomUsed !== 1) {
      await chrome.tabs.setZoom(tabId, prevZoom || 1).catch(() => undefined);
    }
    throw e;
  }
}

async function resolveConfig(): Promise<CaptureConfig> {
  const active = await getActivePreset();
  if (active) return { captureType: active.captureType, quality: active.quality, format: active.format };
  const s = await getSettings();
  return { captureType: s.captureType, quality: s.quality, format: s.format };
}

function mimeForSW(format: string): string {
  if (format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  return "image/png";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(fr.result as string);
    fr.onerror = () => reject(new Error("Failed to encode screenshot"));
    fr.readAsDataURL(blob);
  });
}

/**
 * Visible-area capture without any page script — works on restricted pages
 * (chrome://, Web Store) where content scripts are blocked by Chrome.
 * Resizes with OffscreenCanvas; never upscales.
 */
async function captureVisibleSW(tab: chrome.tabs.Tab, cfg: CaptureConfig) {
  const raw = await captureVisibleRateLimited(tab.windowId, false);
  const bmp = await createImageBitmap(await (await fetch(raw)).blob());
  try {
    const final = await finalizeBitmapSW(bmp, cfg);
    await downloadDataUrl(final.dataUrl, cfg.format, "", tab.id);
    return final;
  } finally {
    bmp.close();
  }
}

/** Resize + encode a captured bitmap in the service worker; never upscales. */
async function finalizeBitmapSW(
  bmp: ImageBitmap,
  cfg: CaptureConfig,
  fit: "height" | "width" = "height"
): Promise<{ dataUrl: string; width: number; height: number }> {
  let scale: number;
  if (fit === "width") {
    // Full pages keep full WIDTH (never squeezed); height follows aspect.
    scale = Math.min(1, QUALITY_WIDTH[cfg.quality] / bmp.width, 16384 / bmp.height);
  } else {
    const targetH = QUALITY_HEIGHT[cfg.quality];
    scale = targetH < bmp.height ? targetH / bmp.height : 1;
  }
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bmp, 0, 0, w, h);
  if (cfg.format === "pdf") {
    // Paginate like the page-side writer: single giant pages make
    // viewers tile/overlap content. Short shots stay one page.
    const pageH = Math.min(h, Math.max(1, Math.round((w * 297) / 210)));
    const pages: PdfPageImage[] = [];
    for (let y = 0; y < h; y += pageH) {
      const ph = Math.min(pageH, h - y);
      const pc = new OffscreenCanvas(w, ph);
      const pctx = pc.getContext("2d");
      if (!pctx) throw new Error("Canvas unavailable");
      pctx.drawImage(canvas, 0, y, w, ph, 0, 0, w, ph);
      const jpg = await pc.convertToBlob({ type: "image/jpeg", quality: 0.92 });
      pages.push({ jpegDataUrl: await blobToDataUrl(jpg), w, h: ph });
    }
    return { dataUrl: jpegPagesToPdfDataUrl(pages), width: w, height: h };
  }
  const out = await canvas.convertToBlob(
    cfg.format === "png"
      ? { type: "image/png" }
      : { type: mimeForSW(cfg.format), quality: 0.95 }
  );
  const dataUrl = await blobToDataUrl(out);
  return { dataUrl, width: w, height: h };
}

// ---------- debugger + Augustat-style density emulation ----------
// Renders the page at extra device pixels per CSS pixel (like DevTools'
// custom-device DPR trick), so captures carry genuine detail instead of
// upscaled pixels. Only where Chrome allows the debugger; callers fall back.

function dbgSend(tabId: number, method: string, params: Record<string, unknown>): Promise<any> {
  return new Promise((resolve, reject) => {
    chrome.debugger.sendCommand({ tabId }, method, params, (res) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(res);
    });
  });
}

async function dbgAttach(tabId: number): Promise<void> {
  try {
    await new Promise<void>((resolve, reject) => {
      chrome.debugger.attach({ tabId }, "1.3", () => {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve();
      });
    });
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    if (/another debugger/i.test(m)) {
      throw new Error("DBG_ATTACHED_ELSEWHERE");
    }
    throw new Error(`DBG_BLOCKED:${m}`);
  }
}

async function dbgDetach(tabId: number): Promise<void> {
  await new Promise<void>((resolve) => {
    chrome.debugger.detach({ tabId }, () => resolve());
  });
}

/** Viewport screenshot at emulated density; PNG first, JPEG fallback. */
async function dbgShot(tabId: number, extra: Record<string, unknown> = {}): Promise<{ bytes: Uint8Array; mime: string }> {
  const attempt = async (format: string, quality?: number) => {
    const res = (await dbgSend(tabId, "Page.captureScreenshot", {
      format,
      ...(quality != null ? { quality } : {}),
      fromSurface: true,
      ...extra,
    })) as { data: string };
    return Uint8Array.from(atob(res.data), (c) => c.charCodeAt(0));
  };
  try {
    return { bytes: await attempt("png"), mime: "image/png" };
  } catch (e) {
    if (!isSizeError(e)) throw e;
    return { bytes: await attempt("jpeg", 92), mime: "image/jpeg" };
  }
}

function isSizeError(e: unknown): boolean {
  const m = e instanceof Error ? e.message : String(e);
  return /unable to capture|too large|exceed|limit|memory|texture/i.test(m);
}

interface PageGeom {
  viewportW: number;
  viewportH: number;
  dpr: number;
  scrollHeight: number;
}

async function pageGeom(tabId: number): Promise<PageGeom | null> {
  try {
    const m = await sendToTab<PageGeom>(tabId, { type: "CS_FULLPAGE_METRICS" });
    if (m.viewportW > 0 && m.viewportH > 0) return m;
    return null;
  } catch {
    return null;
  }
}

/** Density multiplier so device pixels reach the quality target (max 4×). 1 = screen already suffices. */
function boostFor(cssH: number, dpr: number, targetH: number): number {
  const devH = Math.max(1, cssH) * Math.max(0.5, dpr);
  if (devH >= targetH) return 1;
  return Math.min(4, targetH / devH);
}

// Element/region fit-to-density: size DSF so the SELECTED RECT (CSS px)
// fills an 8K frame (7680×4320 genuine pixels) instead of scaling to the
// viewport. CSS viewport size stays unchanged (no reflow) — only density
// rises, then the caller crops rect×dsf out of the dense bitmap.
// Hard limits: absolute DSF_CAP, Chrome's 16000px/side bitmap cap, and a
// total pixel budget (viewport W×H×dsf²). An over-budget fit-DSF clamps
// best-effort; the success toast reports actual dims.
const FIT_W = 7680;
const FIT_H = 4320;
const DSF_CAP = 6; // 6× linear = 36× pixels. Beyond this Chrome's
// captureScreenshot/emulation OOMs or flakes on typical viewports, and a
// 2560px-wide viewport already nears the 16k side cap at 6× (15360px).
const MAX_BOOSTED_PX = 36_000_000; // ~one 8K frame (7680×4320 = 33.2MP)
// + headroom: worst case ~144MB RGBA, inside Chrome's capture path. Small
// rects can still reach full 8K density; large viewports clamp best-effort.
function fitDsfForRect(rectW: number, rectH: number, cssW: number, cssH: number): number {
  const rw = Math.max(1, rectW);
  const rh = Math.max(1, rectH);
  const fit = Math.min(FIT_W / rw, FIT_H / rh);
  const vw = Math.max(1, Math.round(cssW));
  const vh = Math.max(1, Math.round(cssH));
  const budget = Math.sqrt(MAX_BOOSTED_PX / (vw * vh));
  return Math.min(fit, DSF_CAP, 16000 / vw, 16000 / vh, budget);
}

async function emuCaptureViewport(
  tabId: number,
  cssW: number,
  cssH: number,
  dsf: number
): Promise<{ bytes: Uint8Array; mime: string }> {
  await dbgAttach(tabId);
  try {
    await dbgSend(tabId, "Emulation.setDeviceMetricsOverride", {
      width: Math.max(1, Math.round(cssW)),
      height: Math.max(1, Math.round(cssH)),
      deviceScaleFactor: dsf,
      mobile: false,
      screenOrientation:
        cssW >= cssH
          ? { angle: 0, type: "landscapePrimary" }
          : { angle: 0, type: "portraitPrimary" },
    });
    await new Promise((r) => setTimeout(r, 350));
    return await dbgShot(tabId);
  } finally {
    await dbgSend(tabId, "Emulation.clearDeviceMetricsOverride", {}).catch(() => undefined);
    await dbgDetach(tabId);
  }
}

async function doCapture(cfg?: CaptureConfig) {
  const tab = await activeTab();
  if (!tab || tab.id == null) throw new Error("No active tab");
  const config = cfg ?? (await resolveConfig());
  // PDF is a full-page-only format.
  if (config.format === "pdf" && config.captureType !== "fullPage") config.format = "png";
  // Trial gate (PRO bypasses): 4K/8K need a signed-in identity first (so a
  // cache clear alone can't mint fresh trials), then 2 free shots/day each.
  // TESTING BYPASS: when TESTING_UNLIMITED_TRIALS is true, 4K/8K skip the
  // identity requirement, the exhaustion check, and all consumption below.
  const pro = await isPro();
  const trialQ = config.quality === "4K" || config.quality === "8K" ? config.quality : null;
  let trialEmail = "";
  if (trialQ && !pro && !TESTING_UNLIMITED_TRIALS) {
    const identity = await getTrialIdentity();
    if (!identity) throw new Error("LOGIN_REQUIRED");
    trialEmail = identity;
    if ((await trialRemaining(trialQ, trialEmail)) <= 0) {
      throw new Error(`TRIAL_EXHAUSTED:${trialQ}`);
    }
  }
  if (config.captureType === "visible") {
    let res;
    if (await ping(tab.id)) {
      // brief dim flash handled in content (awaited there before capture)
      await sendToTab(tab.id, { type: "CS_FLASH" }).catch(() => undefined);
      res = await captureVisiblePreset(tab, config);
    } else {
      // restricted page: capture + resize fully in the service worker
      res = await captureVisibleSW(tab, config);
    }
    if (!pro && !TESTING_UNLIMITED_TRIALS && (config.quality === "4K" || config.quality === "8K")) {
      await consumeTrial(config.quality, trialEmail);
    }
    const clip = await copyReport(tab.id, res.dataUrl, config.format);
    await feedback(tab.id, "Screenshot captured", `${res.width} × ${res.height} • ${config.format.toUpperCase()}${clip}`);
    return res;
  }
  if (config.captureType === "fullPage") {
    const res = await captureFullPageLoop(tab, config);
    if (!pro && !TESTING_UNLIMITED_TRIALS && (config.quality === "4K" || config.quality === "8K")) {
      await consumeTrial(config.quality, trialEmail);
    }
    const summary = (res.parts ?? 1) > 1
      ? `${res.parts} parts • ${res.width} × ${res.height} • ${config.format.toUpperCase()}`
      : `${res.width} × ${res.height} • ${config.format.toUpperCase()}`;
    const clip = await copyReport(tab.id, res.dataUrl, config.format);
    await sendToTab(tab.id, {
      type: "CS_TOAST",
      title: "Screenshot captured",
      body: summary + clip,
    }).catch(() => undefined);
    return res;
  }
  // region / element need user interaction
  await ensureContent(tab.id, tab.url ?? "");
  if (!pro && !TESTING_UNLIMITED_TRIALS && (config.quality === "4K" || config.quality === "8K") && tab.id != null) {
    pendingTrial.set(tab.id, { q: config.quality, email: trialEmail });
  }
  await sendToTab(tab.id, { type: "CS_START_PICK", mode: config.captureType });
  // open nothing; content script will message back with rect/element then we capture
  return null;
}

const pendingReopen = new Set<number>();
const pendingTrial = new Map<number, { q: "4K" | "8K"; email: string }>();

async function maybeReopenPanel(tabId: number | null | undefined) {
  if (tabId == null || !pendingReopen.has(tabId)) return;
  pendingReopen.delete(tabId);
  await openPanelForTab(tabId).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    if (!msg || typeof msg.type !== "string") return;
    if (msg.type === "CS_CAPTURE") {
      // fromPanel: the side panel closed itself for a clean shot; reopen when done.
      // Interactive modes (region/element) finish later via CS_FINISH_PICK / CS_PICK_CANCELLED.
      const tab = await activeTab();
      const fromPanel = !!msg.fromPanel && tab?.id != null;
      if (fromPanel) pendingReopen.add(tab!.id!);
      if (tab?.id != null) {
        await sendToTab(tab.id, { type: "CS_BUSY", on: true }).catch(() => undefined);
      }
      try {
        const res = await doCapture(msg.config);
        if (res !== null) {
          // visible / fullPage finished now
          if (fromPanel) await maybeReopenPanel(tab!.id);
        }
        sendResponse({ ok: true, result: res });
      } catch (e) {
        const rawMessage = e instanceof Error ? e.message : String(e);
        const trialQ = rawMessage.startsWith("TRIAL_EXHAUSTED")
          ? rawMessage.split(":")[1] || "4K"
          : null;
        const loginRequired = rawMessage === "LOGIN_REQUIRED";
        const message = trialQ
          ? `Daily ${trialQ} trial used up (2/day) — open Custom Screenshot to go Pro`
          : loginRequired
            ? "Sign in to use the 4K/8K free trial — open Custom Screenshot"
            : rawMessage;
        if (trialQ || loginRequired) {
          pendingTrial.delete(tab!.id!);
          // Ask the reopened panel to show the Pro upsell / sign-in.
          try {
            await chrome.storage.session.set({ proModal: trialQ ? "upsell" : "login" });
          } catch {
            /* noop */
          }
        }
        await feedback(tab?.id, "Capture failed", message, true);
        if (fromPanel) {
          pendingReopen.delete(tab!.id!);
          await openPanelForTab(tab!.id).catch(() => undefined);
        }
        try {
          sendResponse({ ok: false, error: message });
        } catch {
          /* noop */
        }
        return;
      } finally {
        if (tab?.id != null) {
          await sendToTab(tab.id, { type: "CS_BUSY", on: false }).catch(() => undefined);
        }
      }
    } else if (msg.type === "CS_CAPTURE_RAW_VISIBLE") {
      const tab = sender.tab ?? (await activeTab());
      if (!tab?.windowId && tab?.windowId !== 0) throw new Error("No tab");
      const raw = await captureVisibleRateLimited(tab!.windowId, false);
      sendResponse({ ok: true, raw });
    } else if (msg.type === "CS_CAPTURE_BOOSTED_VISIBLE") {
      // Re-render the viewport at higher density for region/element crops.
      // With msg.rect (CSS px) the DSF fits THAT RECT into an 8K frame
      // (DSF-only, viewport CSS size unchanged); without it, falls back to
      // viewport-based boostFor. Throws when pointless (screen suffices)
      // or blocked — caller falls back to raw.
      const tab = sender.tab ?? (await activeTab());
      if (!tab || tab.id == null) throw new Error("No tab");
      const geom = await pageGeom(tab.id);
      if (!geom) throw new Error("no geometry");
      const dpr = geom.dpr || 1;
      let dsf: number;
      const r = msg.rect as
        | { x?: number; y?: number; width?: number; height?: number }
        | undefined;
      if (
        r &&
        Number.isFinite(r.width) &&
        Number.isFinite(r.height) &&
        (r.width as number) > 0 &&
        (r.height as number) > 0
      ) {
        dsf = fitDsfForRect(r.width as number, r.height as number, geom.viewportW, geom.viewportH);
        if (!(dsf > dpr)) throw new Error("screen suffices");
      } else {
        const targetH = QUALITY_HEIGHT[(msg.quality as CaptureConfig["quality"]) ?? "1080p"];
        const boost = boostFor(geom.viewportH, dpr, targetH);
        if (boost <= 1) throw new Error("screen suffices");
        dsf = dpr * boost;
      }
      const res = await withOverlayHidden(tab.id, async () => {
        const shot = await emuCaptureViewport(
          tab.id!,
          geom.viewportW,
          geom.viewportH,
          dsf
        );
        return blobToDataUrl(u8ToBlob(shot.bytes, shot.mime));
      });
      sendResponse({ ok: true, raw: res });
    } else if (msg.type === "CS_DOWNLOAD") {
      await downloadDataUrl(msg.dataUrl, msg.format, "", sender.tab?.id);
      sendResponse({ ok: true });
    } else if (msg.type === "CS_FINISH_PICK") {
      // content script selected rect/element screenshot already processed; just download + toast
      const pending = sender.tab?.id != null ? pendingTrial.get(sender.tab.id) : undefined;
      if (sender.tab?.id != null) pendingTrial.delete(sender.tab.id);
      if (pending && !TESTING_UNLIMITED_TRIALS) await consumeTrial(pending.q, pending.email);
      await downloadDataUrl(msg.dataUrl, msg.format, "", sender.tab?.id);
      const clip = await copyReport(sender.tab?.id, msg.dataUrl, msg.format);
      if (sender.tab?.id != null) {
        const dims =
          Number.isFinite(msg.width) && Number.isFinite(msg.height)
            ? `${msg.width} × ${msg.height} • `
            : "";
        await sendToTab(sender.tab.id, {
          type: "CS_TOAST",
          title: "Screenshot captured",
          body: `${dims}${String(msg.format).toUpperCase()}${clip}`,
        }).catch(() => undefined);
        await maybeReopenPanel(sender.tab.id);
      }
      sendResponse({ ok: true });
    } else if (msg.type === "CS_PICK_CANCELLED") {      if (sender.tab?.id != null) {
        pendingTrial.delete(sender.tab.id);
        await maybeReopenPanel(sender.tab.id);
      }
      sendResponse({ ok: true });
    } else if (msg.type === "CS_OPEN_PANEL") {
      const tab = sender.tab ?? (await activeTab());
      await openPanelForTab(tab?.id);
      sendResponse({ ok: true });
    }
  })()
    .catch((e) => {
      try {
        sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
      } catch {
        /* noop */
      }
    });
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "instant-capture") {
    const tab = await activeTab();
    if (tab?.id != null) {
      await sendToTab(tab.id, { type: "CS_BUSY", on: true }).catch(() => undefined);
    }
    try {
      await doCapture();
    } catch (e) {
      const rawMessage = e instanceof Error ? e.message : String(e);
      const trialQ = rawMessage.startsWith("TRIAL_EXHAUSTED")
        ? rawMessage.split(":")[1] || "4K"
        : null;
      const message = trialQ
        ? `Daily ${trialQ} trial used up (2/day) — open Custom Screenshot to go Pro`
        : rawMessage === "LOGIN_REQUIRED"
          ? "Sign in to use the 4K/8K free trial — open Custom Screenshot"
          : rawMessage;
      await feedback(tab?.id, "Capture failed", message, true);
    } finally {
      if (tab?.id != null) {
        await sendToTab(tab.id, { type: "CS_BUSY", on: false }).catch(() => undefined);
      }
    }
  }
});

// Clicking the toolbar icon summons the centered capture pill on the page.
// The side panel opens ONLY from the pill's arrow button — never automatically.
function setManualOpen() {
  try {
    (chrome.sidePanel as unknown as {
      setPanelBehavior: (o: { openPanelOnActionClick: boolean }) => Promise<void>;
    }).setPanelBehavior({ openPanelOnActionClick: false });
  } catch {
    /* noop */
  }
}
setManualOpen();
chrome.runtime.onInstalled.addListener(() => setManualOpen());

async function openPanelForTab(tabId?: number) {
  const open = (
    chrome.sidePanel as unknown as {
      open: (o: { tabId?: number; windowId?: number }) => Promise<void>;
    }
  ).open;
  if (tabId != null) {
    try {
      await open({ tabId });
      return;
    } catch {
      /* fall through to window fallback */
    }
  }
  const win = await chrome.windows.getLastFocused().catch(() => null);
  if (win?.id != null) await open({ windowId: win.id });
}

chrome.action.onClicked.addListener(async (tab) => {
  // Summon the centered capture pill (dim + button). Never opens the panel.
  try {
    if (tab.id == null) return;
    await ensureContent(tab.id, tab.url ?? "");
    await sendToTab(tab.id, { type: "CS_FOCUS_MODE" }).catch(() => undefined);
  } catch (e) {
    await feedback(
      tab.id,
      "Cannot run here",
      "Browser pages (chrome://, Web Store) block page tools. Visible capture still works via shortcut; region/element need a regular website.",
      true
    );
    void e;
  }
});

// No persistent floating button: the capture pill only appears on demand
// (toolbar click), centered over a dimmed page.
