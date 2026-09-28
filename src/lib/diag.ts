// Capture diagnostics ring buffer — TEST MODE ONLY.
// Memory only: entries clear on service-worker unload (acceptable for
// testing). Background-owned: the side panel reads entries via the
// CS_GET_DIAG_LOGS message and must NOT import the buffer (it would get
// its own empty copy in a different context).
// No persistence, no new permissions, no capture/gating behavior changes.

export const DIAG_MAX = 30;

const buf: string[] = [];

/** UTC clock with millis, e.g. 14:22:05.123Z. */
export function diagTs(): string {
  return `${new Date().toISOString().slice(11, 23)}Z`;
}

/** BOOSTED path with computed (fit) vs clamped (dsf) values. */
export function fmtBoost(dsf: number, fit: number): string {
  return `BOOSTED dsf=${dsf.toFixed(2)} (fit=${fit.toFixed(2)}→${dsf.toFixed(2)})`;
}

/** Classify a background-side boost failure into a short RAW(...) reason. */
export function diagRawReason(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/screen suffices/i.test(m)) return "screen-suffices";
  if (/no geometry/i.test(m)) return "no-geometry";
  if (/another debugger|already attached|DBG_ATTACHED_ELSEWHERE/i.test(m)) return "devtools-blocked";
  return (m || "unknown").slice(0, 120);
}

/** Classify a region/element fallback: failReason is null when the boost was
 * pointless, so fall back to rawReason (preserves screen-suffices/no-geometry). */
export function diagPickReason(failReason: string | null, rawReason: string | null): string {
  const m = failReason ?? rawReason ?? "unknown";
  if (/another debugger|already attached|DBG_ATTACHED_ELSEWHERE/i.test(m)) return "devtools-blocked";
  if (/screen suffices/i.test(m)) return "screen-suffices";
  if (/no geometry/i.test(m)) return "no-geometry";
  return (m || "unknown").slice(0, 120);
}

export function fmtRect(r: { x: unknown; y: unknown; width: unknown; height: unknown } | null | undefined): string {
  if (!r) return "";
  const n = (v: unknown) => Math.round(Number(v) || 0);
  return ` rect=${n(r.x)},${n(r.y)},${n(r.width)}×${n(r.height)}`;
}

export function pushDiag(line: string): void {
  buf.unshift(line); // newest first
  if (buf.length > DIAG_MAX) buf.length = DIAG_MAX;
}

export function getDiagLogs(): string[] {
  return [...buf];
}
