/** Minimal multi-page PDF writer (no dependencies).
 * Each page embeds one JPEG (DCTDecode) at 1px = 1pt. Pure JS — pages and workers. */

export interface PdfPageImage {
  jpegDataUrl: string;
  w: number;
  h: number;
}

function u8ToBase64(bytes: Uint8Array): string {
  let s = "";
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

function jpegBytes(dataUrl: string): Uint8Array {
  const base64 = (dataUrl.split(",")[1] ?? "").replace(/\s/g, "");
  const bin = atob(base64);
  // Exact length: base64 4 chars -> 3 bytes, minus padding.
  const pad = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const len = (base64.length * 3) / 4 - pad;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function jpegPagesToPdfDataUrl(pages: PdfPageImage[]): string {
  const n = Math.max(1, pages.length);
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [0];
  let pos = 0;
  const push = (data: Uint8Array | string) => {
    const b = typeof data === "string" ? enc.encode(data) : data;
    chunks.push(b);
    pos += b.length;
  };
  const objNo = (page: number, kind: 0 | 1 | 2) => 3 + page * 3 + kind; // 0=page 1=image 2=contents
  const totalObjs = 2 + n * 3;

  push("%PDF-1.4\n%CustomScreenshot\n");
  offsets[1] = pos;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = pos;
  const kids = pages.map((_, i) => `${objNo(i, 0)} 0 R`).join(" ");
  push(`2 0 obj\n<< /Type /Pages /Kids [${kids}] /Count ${n} >>\nendobj\n`);

  const images = pages.map((p) => jpegBytes(p.jpegDataUrl));
  pages.forEach((p, i) => {
    offsets[objNo(i, 0)] = pos;
    push(
      `${objNo(i, 0)} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.w} ${p.h}] ` +
        `/Resources << /XObject << /Im${i} ${objNo(i, 1)} 0 R >> >> /Contents ${objNo(i, 2)} 0 R >>\nendobj\n`
    );
    offsets[objNo(i, 1)] = pos;
    push(
      `${objNo(i, 1)} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${p.w} /Height ${p.h} ` +
        `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${images[i].length} >>\nstream\n`
    );
    push(images[i]);
    push("\nendstream\nendobj\n");
    const content = enc.encode(`q\n${p.w} 0 0 ${p.h} 0 0 cm\n/Im${i} Do\nQ\n`);
    offsets[objNo(i, 2)] = pos;
    push(`${objNo(i, 2)} 0 obj\n<< /Length ${content.length} >>\nstream\n`);
    push(content);
    push("\nendstream\nendobj\n");
  });

  const xrefPos = pos;
  let xref = `xref\n0 ${totalObjs + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= totalObjs; i++) xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  push(xref + `trailer\n<< /Size ${totalObjs + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`);

  const total = new Uint8Array(pos);
  let at = 0;
  for (const c of chunks) {
    total.set(c, at);
    at += c.length;
  }
  return `data:application/pdf;base64,${u8ToBase64(total)}`;
}
