import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from './Icon.jsx';

/**
 * A menu button with a popover menu (ARIA APG menu button pattern).
 *
 *   <Menu label="Languages: English" buttonClassName="tool" button={<><Icon name="globe" />English</>}
 *         items={[{ type: 'radio', label: 'English', lang: 'en', checked: true, onSelect }, { type: 'separator' },
 *                 { type: 'link', to: '/profile', label: 'Profiles and backup', icon: 'user' }]} />
 *
 * Item types: 'item' (onSelect), 'link' (to, a router path or location, with optional history
 * `state`, and `refocus` to give focus back to the button, for a link that opens a sheet over
 * the current page; or href for an external page),
 * 'radio' (checked + onSelect, shows a check), 'separator', 'group' (a small caption).
 * Keyboard: Enter, Space or ArrowDown opens on the first item (ArrowUp on the last); arrows
 * move with wraparound; Home/End; a letter jumps to the next item starting with it; Escape
 * closes and returns focus to the button; Tab closes and moves on. A click outside closes.
 */
export default function Menu({ label, button, buttonClassName = 'tool', items, header, align = 'end', menuLabel, className = '', onOpenChange }) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(-1);
  const [up, setUp] = useState(false);
  const anchorRef = useRef(null);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const itemRefs = useRef([]);
  const typeahead = useRef({ text: '', at: 0 });
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const menuId = `menu-${auto}`;
  const buttonId = `menubtn-${auto}`;

  const actionable = items.map((it, i) => (it.type === 'separator' || it.type === 'group' ? -1 : i)).filter((i) => i >= 0);

  const setOpenState = useCallback(
    (next) => {
      setOpen(next);
      if (onOpenChange) onOpenChange(next);
    },
    [onOpenChange],
  );

  const close = useCallback(
    (refocus = true) => {
      setOpenState(false);
      setFocusIndex(-1);
      if (refocus && buttonRef.current) buttonRef.current.focus();
    },
    [setOpenState],
  );

  const openAt = (which) => {
    const checked = items.findIndex((it) => it.type === 'radio' && it.checked);
    const index = which === 'last' ? actionable[actionable.length - 1] : which === 'checked' && checked >= 0 ? checked : actionable[0];
    setOpenState(true);
    setFocusIndex(index == null ? -1 : index);
  };

  // Open upward when the popover would run under the tab bar or off the bottom of the window
  // and there is more room above. Measured before paint, so it never jumps.
  useLayoutEffect(() => {
    if (!open) {
      setUp(false);
      return;
    }
    const menu = menuRef.current;
    const anchor = anchorRef.current;
    if (!menu || !anchor) return;
    const a = anchor.getBoundingClientRect();
    const bar = document.querySelector('.tabbar');
    const barTop = bar && bar.offsetParent !== null && getComputedStyle(bar).position === 'fixed' ? bar.getBoundingClientRect().top : window.innerHeight;
    const head = document.querySelector('.topbar');
    const headBottom = head && !head.contains(anchor) ? head.getBoundingClientRect().bottom : 0;
    const below = barTop - a.bottom - 8;
    const above = a.top - headBottom - 8;
    setUp(menu.offsetHeight > below && above > below);
  }, [open]);

  // Move DOM focus to the active item.
  useEffect(() => {
    if (open && focusIndex >= 0 && itemRefs.current[focusIndex]) itemRefs.current[focusIndex].focus();
  }, [open, focusIndex]);

  // A click or tap outside closes without stealing focus.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (anchorRef.current && !anchorRef.current.contains(e.target)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  const move = (delta) => {
    const pos = actionable.indexOf(focusIndex);
    const next = actionable[(pos + delta + actionable.length) % actionable.length];
    setFocusIndex(next);
  };

  const onButtonKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      openAt('checked');
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      openAt('last');
    }
  };

  const onMenuKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      setFocusIndex(actionable[0]);
    } else if (e.key === 'End') {
      e.preventDefault();
      setFocusIndex(actionable[actionable.length - 1]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    } else if (e.key.length === 1 && /\S/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      const ta = typeahead.current;
      ta.text = now - ta.at > 700 ? e.key.toLowerCase() : ta.text + e.key.toLowerCase();
      ta.at = now;
      const start = actionable.indexOf(focusIndex);
      const order = [...actionable.slice(start + 1), ...actionable.slice(0, start + 1)];
      const hit = order.find((i) => String(items[i].label || '').toLowerCase().startsWith(ta.text));
      if (hit != null) setFocusIndex(hit);
    }
  };

  const select = (it) => {
    if (it.onSelect) it.onSelect();
    // A link navigates; route focus management takes over from there. A link that opens a
    // sheet over this page hands focus back to the button, so the sheet returns it there.
    close(it.type !== 'link' || Boolean(it.refocus));
  };

  return (
    <div className={`menu-anchor ${className}`.trim()} ref={anchorRef}>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className={buttonClassName}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        onClick={() => (open ? close(false) : openAt('checked'))}
        onKeyDown={onButtonKeyDown}
      >
        {button}
      </button>
      {open && (
        <div ref={menuRef} className={`menu${align === 'start' ? ' menu--start' : ''}${up ? ' menu--up' : ''}`}>
          {header && <div className="menu__head">{header}</div>}
          <div role="menu" id={menuId} aria-label={menuLabel || label} onKeyDown={onMenuKeyDown}>
            {items.map((it, i) => {
              if (it.type === 'separator') return <div key={`sep-${i}`} role="separator" className="menu__sep" />;
              if (it.type === 'group') return <div key={`grp-${i}`} role="presentation" className="menu__group">{it.label}</div>;
              const common = {
                ref: (el) => (itemRefs.current[i] = el),
                className: 'menu__item',
                tabIndex: focusIndex === i ? 0 : -1,
                lang: it.lang,
                onMouseEnter: () => setFocusIndex(i),
              };
              const content = (
                <>
                  {it.icon && <Icon name={it.icon} />}
                  <span className="menu__label">
                    {it.label}
                    {it.sub && <span className="menu__sub">{it.sub}</span>}
                  </span>
                  {it.type === 'radio' && it.checked && <Icon name="check" className="check" />}
                </>
              );
              if (it.type === 'link' && it.to) {
                return (
                  <Link key={it.key || i} to={it.to} state={it.state} role="menuitem" {...common} onClick={() => select(it)}>
                    {content}
                  </Link>
                );
              }
              if (it.type === 'link' && it.href) {
                return (
                  <a key={it.key || i} href={it.href} role="menuitem" {...common} onClick={() => select(it)}>
                    {content}
                  </a>
                );
              }
              return (
                <button key={it.key || i} type="button" role={it.type === 'radio' ? 'menuitemradio' : 'menuitem'} aria-checked={it.type === 'radio' ? Boolean(it.checked) : undefined} {...common} onClick={() => select(it)}>
                  {content}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
