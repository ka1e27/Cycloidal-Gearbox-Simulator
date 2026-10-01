// Browser download via Blob + object URL. Works on any static host (no server). DOM only; kept out of dxf.ts / parts.ts.

/** Save text as a file. The object URL is revoked shortly after the click so the browser has time to start the save. */
export function downloadTextFile(filename: string, text: string, mime = 'application/dxf'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
