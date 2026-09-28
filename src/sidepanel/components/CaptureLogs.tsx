import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { TESTING_UNLIMITED_TRIALS } from "../../lib/storage";

// Test-mode capture diagnostics log. Rendered ONLY when
// TESTING_UNLIMITED_TRIALS is true (parent gates too; double-guarded here
// so no dead UI ships in store builds). Entries come from the background's
// in-memory ring buffer (last ~30, newest first; cleared on SW unload).
export function CaptureLogs() {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);

  const refresh = useCallback(() => {
    try {
      chrome.runtime.sendMessage({ type: "CS_GET_DIAG_LOGS" }, (res) => {
        if (chrome.runtime.lastError) return;
        if (res?.ok && Array.isArray(res.logs)) setLogs(res.logs as string[]);
      });
    } catch {
      /* never throw from diagnostics */
    }
  }, []);

  useEffect(() => {
    if (TESTING_UNLIMITED_TRIALS) refresh();
  }, [refresh]);

  if (!TESTING_UNLIMITED_TRIALS) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(logs.join("\n"));
      toast.success(logs.length ? `Copied ${logs.length} log line${logs.length === 1 ? "" : "s"}` : "No logs yet — capture something first");
    } catch {
      toast.error("Copy failed — select the text manually");
    }
  };

  return (
    <section aria-label="Capture logs" className="rounded-2xl border border-border bg-card">
      <button
        onClick={() => {
          setOpen((o) => {
            if (!o) refresh();
            return !o;
          });
        }}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-3.5 py-2.5 text-[13px] font-bold"
      >
        <span>
          Capture logs{" "}
          <span className="font-mono font-normal text-muted-foreground">
            {logs.length ? `(${logs.length})` : "(empty)"}
          </span>
        </span>
        <span className="text-muted-foreground" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open && (
        <div className="border-t border-border px-3.5 py-2.5">
          <div className="mb-2 flex gap-2">
            <button
              onClick={copy}
              className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-semibold hover:bg-muted"
            >
              Copy logs
            </button>
            <button
              onClick={refresh}
              className="rounded-lg border border-border px-2.5 py-1 text-[12px] font-semibold hover:bg-muted"
            >
              Refresh
            </button>
          </div>
          {logs.length === 0 ? (
            <p className="py-1 text-[12px] text-muted-foreground">
              No captures logged yet. Memory only — clears if the service worker unloads.
            </p>
          ) : (
            <ol className="max-h-48 space-y-1 overflow-y-auto font-mono text-[11px] leading-snug">
              {logs.map((line, i) => (
                <li key={i} className="whitespace-pre-wrap break-all">
                  {line}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}
    </section>
  );
}
