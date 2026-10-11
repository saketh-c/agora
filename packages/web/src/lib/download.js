/**
 * Hand a Blob to the browser as a file download. The object URL is revoked well after the
 * click: Safari (notably on iOS) can fail a download whose URL is revoked before it starts.
 */
export function downloadBlob(filename, blob) {
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 40000);
}
