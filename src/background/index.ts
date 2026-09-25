import type { CaptureConfig } from "../types";
import { QUALITY_HEIGHT, QUALITY_WIDTH } from "../types";
import { getActivePreset, getSettings } from "../lib/storage";
import { formatTimestamp, sanitizeFilename } from "../lib/utils";
import { extFor } from "../lib/capture";

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

async function downloadDataUrl(dataUrl: string, format: string, suffix = ""): Promise<void> {
  const ext = extFor(format as never);
  const filename = sanitizeFilename(`Screenshot_${formatTimestamp()}${suffix}.${ext}`);
  // chrome.downloads.download with data URL works for reasonable sizes; use it directly
  await chrome.downloads.download({ url: dataUrl, filename, saveAs: false });
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
  const res = await withOverlayHidden(tab.id, async () => {
    const raw = await captureVisibleRateLimited(tab.windowId, false);
    return sendToTab<{ dataUrl: string; width: number; height: number }>(tab.id!, {
      type: "CS_PROCESS_VISIBLE",
      raw,
      quality: cfg.quality,
      format: cfg.format,
    });
  });
  await downloadDataUrl(res.dataUrl, cfg.format);
  return res;
}

// Full page WITHOUT debugger: scroll + capture + stitch in the page.
// Sticky laid into flow and fixed pinned to absolute offsets (GoFullPage-style),
// so each segment contributes fresh content exactly once — one image file.
async function captureFullPageLoop(tab: chrome.tabs.Tab, cfg: CaptureConfig) {
  const tabId = tab.id!;
  await ensureContent(tabId, tab.url ?? "");
  await sendToTab(tabId, { type: "CS_HIDE_UI" }).catch(() => undefined);
  const prevZoom = await chrome.tabs.getZoom(tabId).catch(() => 1);
  const zooms = cfg.quality === "4K" ? [2, 1.5, 1] : cfg.quality === "2K" ? [1.5, 1] : [1];
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
      await downloadDataUrl(stitched.dataUrl, cfg.format);
      return { ...stitched, parts: 1 };
    } finally {
      if (zoomUsed !== 1) {
        await chrome.tabs.setZoom(tabId, prevZoom || 1).catch(() => undefined);
        await new Promise((r) => setTimeout(r, 300));
      }
      await sendToTab(tabId, { type: "CS_FULLPAGE_RESTORE", y: scrollY }).catch(() => undefined);
      await sendToTab(tabId, { type: "CS_HIDE_UI" }).catch(() => undefined);
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
    await downloadDataUrl(final.dataUrl, cfg.format);
    return final;
  } finally {
    bmp.close();
  }
}

/** Resize + encode a captured bitmap in the service worker; never upscales. */
async function finalizeBitmapSW(
  bmp: ImageBitmap,
  cfg: CaptureConfig
): Promise<{ dataUrl: string; width: number; height: number }> {
  const targetH = QUALITY_HEIGHT[cfg.quality];
  const scale = targetH < bmp.height ? targetH / bmp.height : 1;
  const w = Math.max(1, Math.round(bmp.width * scale));
  const h = Math.max(1, Math.round(bmp.height * scale));
  const canvas = new OffscreenCanvas(w, h);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(bmp, 0, 0, w, h);
  const out = await canvas.convertToBlob(
    cfg.format === "png"
      ? { type: "image/png" }
      : { type: mimeForSW(cfg.format), quality: 0.95 }
  );
  const dataUrl = await blobToDataUrl(out);
  return { dataUrl, width: w, height: h };
}

// ---------- debugger protocol helpers (unused: full page is debugger-free) ----------

async function doCapture(cfg?: CaptureConfig) {
  const tab = await activeTab();
  if (!tab || tab.id == null) throw new Error("No active tab");
  const config = cfg ?? (await resolveConfig());
  // PDF is a full-page-only format.
  if (config.format === "pdf" && config.captureType !== "fullPage") config.format = "png";
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
    await feedback(tab.id, "Screenshot captured", `${res.width} × ${res.height} • ${config.format.toUpperCase()}`);
    return res;
  }
  if (config.captureType === "fullPage") {
    const res = await captureFullPageLoop(tab, config);
    const summary = (res.parts ?? 1) > 1
      ? `${res.parts} parts • ${config.format.toUpperCase()}`
      : `${res.width} × ${res.height} • ${config.format.toUpperCase()}`;
    await sendToTab(tab.id, {
      type: "CS_TOAST",
      title: "Screenshot captured",
      body: summary,
    }).catch(() => undefined);
    return res;
  }
  // region / element need user interaction
  await ensureContent(tab.id, tab.url ?? "");
  await sendToTab(tab.id, { type: "CS_START_PICK", mode: config.captureType });
  // open nothing; content script will message back with rect/element then we capture
  return null;
}

const pendingReopen = new Set<number>();

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
        const message = e instanceof Error ? e.message : String(e);
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
    } else if (msg.type === "CS_DOWNLOAD") {
      await downloadDataUrl(msg.dataUrl, msg.format);
      sendResponse({ ok: true });
    } else if (msg.type === "CS_FINISH_PICK") {
      // content script selected rect/element screenshot already processed; just download + toast
      await downloadDataUrl(msg.dataUrl, msg.format);
      if (sender.tab?.id != null) {
        await sendToTab(sender.tab.id, {
          type: "CS_TOAST",
          title: "Screenshot captured",
          body: `${msg.width} × ${msg.height} • ${String(msg.format).toUpperCase()}`,
        }).catch(() => undefined);
        await maybeReopenPanel(sender.tab.id);
      }
      sendResponse({ ok: true });
    } else if (msg.type === "CS_PICK_CANCELLED") {
      if (sender.tab?.id != null) await maybeReopenPanel(sender.tab.id);
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
      await feedback(tab?.id, "Capture failed", e instanceof Error ? e.message : String(e), true);
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
