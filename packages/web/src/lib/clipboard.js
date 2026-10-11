import { stripIsolates } from '@agora/core';

/**
 * Copy text to the clipboard. The Clipboard API needs a secure page (https or localhost) and
 * can be refused; plain http on a school network or an older browser falls back to a hidden
 * text area and the copy command. Resolves true when the text was copied. Copied text leaves
 * the app, so it never carries the bidi isolates right-to-left messages use on screen.
 */
export async function copyText(value) {
  const text = stripIsolates(value);
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* refused or unavailable: try the fallback */
  }
  if (typeof document === 'undefined') return false;
  const area = document.createElement('textarea');
  const active = document.activeElement;
  try {
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;';
    document.body.appendChild(area);
    area.select();
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    area.remove();
    // Selecting the text area moved focus; give it back to whatever had it.
    if (active && typeof active.focus === 'function' && document.contains(active)) active.focus({ preventScroll: true });
  }
}
