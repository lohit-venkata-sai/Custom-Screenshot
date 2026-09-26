// Offscreen clipboard writer (MV3-sanctioned: CLIPBOARD reason).
// Receives { type: "CS_CLIPBOARD_WRITE", dataUrl }, writes PNG/JPG/WebP, replies { ok }.
// NOTE: must live in an external file — MV3 content_security_policy
// (script-src 'self') blocks inline scripts in extension pages.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "CS_CLIPBOARD_WRITE") return false;
  (async () => {
    const blob = await (await fetch(msg.dataUrl)).blob();
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type || "image/png"]: blob }),
    ]);
  })().then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});
