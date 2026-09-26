export type CaptureType = "visible" | "fullPage" | "region" | "element";
export type Quality = "720p" | "1080p" | "2K" | "4K";
export type Format = "png" | "jpg" | "webp" | "pdf"; // pdf: full-page only

export interface Preset {
  id: string;
  name: string;
  captureType: CaptureType;
  quality: Quality;
  format: Format;
  createdAt: number;
  updatedAt: number;
}

export interface CaptureConfig {
  captureType: CaptureType;
  quality: Quality;
  format: Format;
}

export interface AppSettings extends CaptureConfig {
  theme: "light" | "dark";
}

export interface RegionRect {
  x: number; // css px relative to viewport
  y: number;
  width: number;
  height: number;
  devicePixelRatio: number;
}

export const CAPTURE_TYPE_META: Record<CaptureType, { label: string }> = {
  visible: { label: "Visible Area" },
  fullPage: { label: "Full Page" },
  region: { label: "Select Region" },
  element: { label: "Select Element" },
};

export const QUALITY_HEIGHT: Record<Quality, number> = {
  "720p": 720,
  "1080p": 1080,
  "2K": 1440,
  "4K": 2160,
};

export const QUALITY_DIMS: Record<Quality, string> = {
  "720p": "1280 × 720",
  "1080p": "1920 × 1080",
  "2K": "2560 × 1440",
  "4K": "3840 × 2160",
};

/** Full-page target WIDTH per quality — tall pages keep full width, never squeezed. */
export const QUALITY_WIDTH: Record<Quality, number> = {
  "720p": 1280,
  "1080p": 1920,
  "2K": 2560,
  "4K": 3840,
};
