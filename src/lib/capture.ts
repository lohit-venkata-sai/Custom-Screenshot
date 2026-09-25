import type { Format, Quality } from "../types";
import { QUALITY_HEIGHT } from "../types";

/** Resize image blob/canvas to requested quality height, preserving aspect ratio. Never upscale. */
export async function resizeToQuality(
  img: HTMLImageElement | HTMLCanvasElement,
  quality: Quality
): Promise<{ canvas: HTMLCanvasElement; width: number; height: number }> {
  const srcW = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const srcH = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const targetH = QUALITY_HEIGHT[quality];
  let outW = srcW;
  let outH = srcH;
  if (srcH > targetH) {
    const scale = targetH / srcH;
    outW = Math.max(1, Math.round(srcW * scale));
    outH = targetH;
  }
  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  if (img instanceof HTMLImageElement) ctx.drawImage(img, 0, 0, outW, outH);
  else ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, outW, outH);
  return { canvas, width: outW, height: outH };
}

export function mimeFor(format: Format): string {
  if (format === "jpg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  if (format === "pdf") return "application/pdf";
  return "image/png";
}

export function extFor(format: Format): string {
  if (format === "jpg") return "jpg";
  if (format === "webp") return "webp";
  if (format === "pdf") return "pdf";
  return "png";
}

export function encodeQuality(format: Format): number | undefined {
  if (format === "png") return undefined;
  return 0.95;
}

export async function canvasToDataUrl(
  canvas: HTMLCanvasElement,
  format: Format
): Promise<string> {
  return canvas.toDataURL(mimeFor(format), encodeQuality(format));
}

export function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode screenshot"));
    img.src = dataUrl;
  });
}

/** Crop a screenshot dataUrl given a rect in CSS px relative to viewport. */
export async function cropDataUrl(
  dataUrl: string,
  rectCss: { x: number; y: number; width: number; height: number },
  quality: Quality,
  format: Format
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(dataUrl);
  // captureVisibleTab returns image at devicePixelRatio scale of viewport
  const scaleX = img.naturalWidth / window.innerWidth;
  const scaleY = img.naturalHeight / window.innerHeight;
  const sx = Math.max(0, Math.round(rectCss.x * scaleX));
  const sy = Math.max(0, Math.round(rectCss.y * scaleY));
  const sw = Math.min(img.naturalWidth - sx, Math.round(rectCss.width * scaleX));
  const sh = Math.min(img.naturalHeight - sy, Math.round(rectCss.height * scaleY));
  if (sw <= 0 || sh <= 0) throw new Error("Invalid selection");
  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  const ctx = tmp.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D unavailable");
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  const { canvas, width, height } = await resizeToQuality(tmp, quality);
  return { dataUrl: await canvasToDataUrl(canvas, format), width, height };
}

export async function processDataUrl(
  dataUrl: string,
  quality: Quality,
  format: Format
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(dataUrl);
  const { canvas, width, height } = await resizeToQuality(img, quality);
  return { dataUrl: await canvasToDataUrl(canvas, format), width, height };
}
