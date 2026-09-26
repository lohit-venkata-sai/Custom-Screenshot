// Offscreen clipboard writer (MV3-sanctioned: CLIPBOARD reason).
// Receives { type: "CS_CLIPBOARD_WRITE", dataUrl }, writes PNG/JPG/WebP, replies { ok }.
// NOTE: must live in an external file — MV3 content_security_policy
// (script-src 'self') blocks inline scripts in extension pages.
async function blobToClipboard(blob) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type || "image/png"]: blob }),
    ]);
    return;
  } catch (e) {
    // clipboard.write needs a focused document (offscreen never has one).
    // Fallback: select an <img> with an EMBEDDED data URL and execCommand
    // ('copy') — needs no focus, and the data URL stays valid (no revoke race).
    const reader = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(new Error("encode failed"));
      fr.readAsDataURL(blob);
    });
    const wrap = document.createElement("div");
    wrap.setAttribute("contenteditable", "true");
    wrap.style.cssText = "position:fixed;top:0;left:0;";
    const img = document.createElement("img");
    img.src = reader;
    wrap.appendChild(img);
    document.body.appendChild(wrap);
    try {
      const range = document.createRange();
      range.selectNode(wrap);
      const sel = window.getSelection();
      if (sel) {
        sel.removeAllRanges();
        sel.addRange(range);
      }
      const ok = document.execCommand("copy");
      if (sel) sel.removeAllRanges();
      if (!ok) throw new Error("execCommand copy returned false: " + (e && e.message));
    } finally {
      wrap.remove();
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "CS_CLIPBOARD_WRITE") return false;
  (async () => {
    const blob = await (await fetch(msg.dataUrl)).blob();
    await blobToClipboard(blob);
  })().then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});
