import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { t } from '@agora/core';
import Icon from './Icon.jsx';

/**
 * A modal dialog: a bottom sheet on phones and tablets, and on desktop (>= 1024px) a centered
 * dialog or, with variant="side", a tall panel on the right.
 *
 *   <Sheet open={open} onClose={() => setOpen(false)} title="Filters" footer={<button ...>Show 24</button>}>
 *     ...
 *   </Sheet>
 *
 * `barStart` fills the bar's left side when there is no `title` (a badge); `barEnd` adds
 * controls just before Close (MeetingShare).
 *
 * Accessibility: role="dialog" + aria-modal, labelled by `title` (or by the element whose id
 * is `labelledBy`, for content that brings its own heading, like MeetingDetail). While open,
 * the rest of the app is `inert`, page scroll is locked, Tab cycles inside the dialog, Escape
 * and the scrim close it, and focus returns to the control that opened it.
 */

const stack = [];
let scrollLocks = 0;
let savedScroll = null;

function lockScroll() {
  if (scrollLocks++ > 0) return;
  const html = document.documentElement;
  const gap = window.innerWidth - html.clientWidth;
  savedScroll = { overflow: html.style.overflow, paddingRight: document.body.style.paddingRight };
  html.style.overflow = 'hidden';
  if (gap > 0) document.body.style.paddingRight = `${gap}px`;
}

function unlockScroll() {
  if (--scrollLocks > 0 || !savedScroll) return;
  document.documentElement.style.overflow = savedScroll.overflow;
  document.body.style.paddingRight = savedScroll.paddingRight;
  savedScroll = null;
}

/** Make everything except the top-most layer inert. */
function syncInert() {
  const root = document.getElementById('root');
  if (root) root.inert = stack.length > 0;
  stack.forEach((layer, i) => {
    layer.inert = i < stack.length - 1;
  });
}

const FOCUSABLE = 'a[href], area[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, iframe, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

function focusables(container) {
  return [...container.querySelectorAll(FOCUSABLE)].filter((el) => !el.closest('[inert]') && (el.offsetWidth > 0 || el.offsetHeight > 0 || el === document.activeElement));
}

const prefersReducedMotion = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

export default function Sheet({ open, onClose, title, labelledBy, describedBy, barStart, barEnd, children, footer, variant = 'center', wide = false, initialFocusRef, className = '', closeLabel }) {
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const layerRef = useRef(null);
  const dialogRef = useRef(null);
  const returnTo = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const autoId = useId();
  const titleId = `sheet-${autoId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  // Mount, then animate in; animate out, then unmount.
  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)));
      return () => cancelAnimationFrame(raf);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), prefersReducedMotion() ? 0 : 300);
    return () => clearTimeout(timer);
  }, [open]);

  // While open: inert background, scroll lock, initial focus; on close, give focus back.
  useLayoutEffect(() => {
    if (!open || !mounted || !layerRef.current) return undefined;
    const layer = layerRef.current;
    returnTo.current = document.activeElement;
    stack.push(layer);
    syncInert();
    lockScroll();
    const target = (initialFocusRef && initialFocusRef.current) || dialogRef.current;
    if (target) target.focus({ preventScroll: true });
    // Focus can fall out of the dialog onto <body> (the focused button was disabled or
    // removed). Escape and Tab still belong to the top-most dialog then.
    const onStrayKey = (e) => {
      if (stack[stack.length - 1] !== layer || layer.contains(e.target)) return;
      if (e.key === 'Escape' && !e.defaultPrevented) {
        e.preventDefault();
        if (onCloseRef.current) onCloseRef.current();
      } else if (e.key === 'Tab' && dialogRef.current) {
        e.preventDefault();
        const items = focusables(dialogRef.current);
        (items[e.shiftKey ? items.length - 1 : 0] || dialogRef.current).focus();
      }
    };
    document.addEventListener('keydown', onStrayKey);
    return () => {
      document.removeEventListener('keydown', onStrayKey);
      const i = stack.indexOf(layer);
      if (i >= 0) stack.splice(i, 1);
      syncInert();
      unlockScroll();
      // After the commit: React restores the pre-commit focus at the end of its mutation
      // phase, which would undo a focus() made here synchronously.
      const back = returnTo.current;
      queueMicrotask(() => {
        if (back && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
      });
    };
    // initialFocusRef is read once on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, mounted]);

  const onKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      if (onCloseRef.current) onCloseRef.current();
      return;
    }
    if (e.key !== 'Tab' || !dialogRef.current) return;
    const items = focusables(dialogRef.current);
    if (!items.length) {
      e.preventDefault();
      dialogRef.current.focus();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === dialogRef.current)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  }, []);

  if (!mounted || typeof document === 'undefined') return null;

  const layerClass = ['sheet-layer', variant === 'side' ? 'sheet-layer--side' : '', wide ? 'sheet-layer--wide' : '', shown && open ? 'is-in' : ''].filter(Boolean).join(' ');

  return createPortal(
    <div ref={layerRef} className={layerClass} onKeyDown={onKeyDown}>
      <div className="sheet-layer__scrim" aria-hidden="true" onClick={() => onCloseRef.current && onCloseRef.current()} />
      <div
        ref={dialogRef}
        className={`sheet${footer ? ' sheet--has-foot' : ''} ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy || (title ? titleId : undefined)}
        aria-describedby={describedBy}
        tabIndex={-1}
      >
        <div className="sheet__grab" aria-hidden="true" />
        <div className="sheet__bar">
          {title ? (
            <h2 className="t-heading sheet__title" id={titleId}>
              {title}
            </h2>
          ) : (
            <span className="sheet__title">{barStart}</span>
          )}
          {barEnd ? (
            <span className="sheet__tools">
              {barEnd}
              <button type="button" className="iconbtn" onClick={() => onCloseRef.current && onCloseRef.current()} aria-label={closeLabel || t('common.close')}>
                <Icon name="x" />
              </button>
            </span>
          ) : (
            <button type="button" className="iconbtn" onClick={() => onCloseRef.current && onCloseRef.current()} aria-label={closeLabel || t('common.close')}>
              <Icon name="x" />
            </button>
          )}
        </div>
        <div className="sheet__body">{children}</div>
        {footer && <div className="sheet__foot">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
