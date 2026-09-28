import { isPro } from "./pro";

/** Toolbar Pro treatment: gold rounded border composited over the stock icons. */
export const PRO_ICON_SIZES = [16, 32, 48, 128] as const;
export const PRO_GOLD = "#D4AF37";

const ICON_PATHS: Record<number, string> = {
  16: "icons/icon16.png",
  32: "icons/icon32.png",
  48: "icons/icon48.png",
  128: "icons/icon128.png",
};

/** 2px on small sizes, 3px on 48/128 — matches the panel logo treatment. */
function borderFor(size: number): number {
  return size <= 32 ? 2 : 3;
}

async function goldFramed(size: number): Promise<ImageData> {
  const url = chrome.runtime.getURL(`icons/icon${size}.png`);
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob);
  try {
    const canvas = new OffscreenCanvas(size, size);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas unavailable");
    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(bmp, 0, 0, size, size);
    const bw = borderFor(size);
    const inset = bw / 2;
    const radius = Math.max(2, Math.round(size * 0.18));
    ctx.strokeStyle = PRO_GOLD;
    ctx.lineWidth = bw;
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(inset, inset, size - bw, size - bw, radius);
    } else {
      ctx.rect(inset, inset, size - bw, size - bw);
    }
    ctx.stroke();
    return ctx.getImageData(0, 0, size, size);
  } finally {
    bmp.close();
  }
}

/**
 * Apply the Pro toolbar icon when `proPaid` is set, restore stock icons
 * otherwise. All local + MV3-safe (OffscreenCanvas, no remote code).
 * No new permissions — chrome.action.setIcon needs none beyond existing.
 */
export async function refreshProActionIcon(): Promise<void> {
  try {
    if (!(await isPro())) {
      await chrome.action.setIcon({ path: ICON_PATHS });
      return;
    }
    const imageData: Record<number, ImageData> = {};
    for (const size of PRO_ICON_SIZES) {
      imageData[size] = await goldFramed(size);
    }
    await chrome.action.setIcon({ imageData });
  } catch {
    /* best-effort: toolbar keeps whatever icon it already has */
  }
}
