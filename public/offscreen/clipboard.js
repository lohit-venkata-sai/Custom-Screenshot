// Offscreen clipboard writer (MV3-sanctioned: CLIPBOARD reason).
// Receives { type: "CS_CLIPBOARD_WRITE", dataUrl }, writes PNG/JPG/WebP, replies { ok }.
// NOTE: must live in an external file — MV3 content_security_policy
// (script-src 'self') blocks inline scripts in extension pages.
async function blobToPng(blob) {
  // Decode (prefer createImageBitmap, fall back to <img> + object URL),
  // draw to canvas at natural size, re-encode as PNG.
  let bitmap = null;
  let url = null;
  try {
    if (typeof createImageBitmap === "function") {
      try {
        bitmap = await createImageBitmap(blob);
      } catch {
        bitmap = null;
      }
    }
    let w = 0;
    let h = 0;
    let img = null;
    if (bitmap) {
      w = bitmap.width;
      h = bitmap.height;
    } else {
      url = URL.createObjectURL(blob);
      img = await new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("decode failed"));
        im.src = url;
      });
      w = img.naturalWidth || img.width;
      h = img.naturalHeight || img.height;
    }
    if (!w || !h) throw new Error("decode failed");
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("decode failed");
    if (bitmap) ctx.drawImage(bitmap, 0, 0);
    else ctx.drawImage(img, 0, 0, w, h);
    const png = await new Promise((resolve, reject) => {
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("encode failed"))),
        "image/png"
      );
    });
    return png;
  } finally {
    if (url) URL.revokeObjectURL(url);
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
  }
}

async function blobToClipboard(blob) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ [blob.type || "image/png"]: blob }),
    ]);
    return "bitmap";
  } catch (e) {
    // Middle step: some paste targets only accept image/png, so a JPG/WebP
    // ClipboardItem write can fail where PNG would succeed. Retry as PNG.
    if (blob.type && blob.type !== "image/png") {
      try {
        const png = await blobToPng(blob);
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": png }),
        ]);
        return "png";
      } catch {
        // Fall through to the execCommand fallback below.
      }
    }
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
      return "html";
    } finally {
      wrap.remove();
    }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "CS_CLIPBOARD_WRITE") return false;
  (async () => {
    const blob = await (await fetch(msg.dataUrl)).blob();
    const flavor = await blobToClipboard(blob);
    return flavor;
  })().then(
    (flavor) => sendResponse({ ok: true, flavor }),
    (e) => sendResponse({ ok: false, error: String((e && e.message) || e) })
  );
  return true;
});
