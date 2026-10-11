import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { t, tn } from '@agora/core';
import Icon from './Icon.jsx';

const fold = (s) =>
  String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

/**
 * The cities that match what someone typed, best first: exact name, name prefix, word prefix
 * ("worth"), initials ("nrh", "fw"), then anywhere in the name or county. Accents are ignored.
 */
export function matchCities(cities, query, limit = 8) {
  const q = fold(query);
  if (!q) return [];
  const scored = [];
  for (const city of cities) {
    const name = fold(city.name);
    const words = name.split(/[\s-]+/);
    const initials = words.map((w) => w[0]).join('');
    let score = -1;
    if (name === q || city.cityId === q) score = 0;
    else if (name.startsWith(q)) score = 1;
    else if (words.some((w) => w.startsWith(q))) score = 2;
    else if (words.length > 1 && initials.startsWith(q.replace(/\s+/g, ''))) score = 3;
    else if (name.includes(q)) score = 4;
    else if (fold(city.county).startsWith(q)) score = 5;
    if (score >= 0) scored.push({ city, score });
  }
  scored.sort((a, b) => a.score - b.score || a.city.name.localeCompare(b.city.name));
  return scored.slice(0, limit).map((s) => s.city);
}

/** Underline the typed part of a city name. */
function Highlight({ text, query }) {
  const q = fold(query);
  const folded = fold(text);
  const at = q ? folded.indexOf(q) : -1;
  if (at < 0) return text;
  return (
    <>
      {text.slice(0, at)}
      <mark>{text.slice(at, at + q.length)}</mark>
      {text.slice(at + q.length)}
    </>
  );
}

/**
 * A type-ahead city picker (ARIA APG combobox with a list popup).
 *
 *   <CityPicker cities={cities} label="Where do you live or go to school?" labelHidden
 *               placeholder="Type a city, like Plano" onSelect={(city) => setHomeCity(city)} />
 *
 * Typing filters the 39 cities; ArrowDown/ArrowUp move, Enter picks, Escape closes (then
 * clears). ArrowDown in an empty box lists every city. `onQueryChange(text, matches)` lets
 * a parent react to free text (for example a ZIP code search when the API exists).
 */
export default function CityPicker({ cities, value, onSelect, label, labelHidden = false, placeholder, id, describedBy, autoFocus = false, onQueryChange, className = '', inputRef: externalRef }) {
  const auto = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const inputId = id || `city-${auto}`;
  const listId = `${inputId}-list`;
  const current = useMemo(() => cities.find((c) => c.cityId === value) || null, [cities, value]);
  const [query, setQuery] = useState(current ? current.name : '');
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [active, setActive] = useState(-1);
  const ownRef = useRef(null);
  const inputRef = externalRef || ownRef;
  const listRef = useRef(null);
  const wrapRef = useRef(null);

  // Follow the selected city when it changes elsewhere (or the language changes its name).
  useEffect(() => {
    if (current) setQuery(current.name);
  }, [current]);

  const options = useMemo(() => {
    if (showAll && !fold(query)) return [...cities].sort((a, b) => a.name.localeCompare(b.name));
    return matchCities(cities, query);
  }, [cities, query, showAll]);

  const expanded = open && (options.length > 0 || Boolean(fold(query)));

  useEffect(() => {
    if (!expanded || active < 0 || !listRef.current) return;
    const el = listRef.current.querySelector(`#${CSS.escape(`${listId}-${active}`)}`);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }, [active, expanded, listId]);

  // Close when focus or a tap leaves the widget.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const pick = (city) => {
    setQuery(city.name);
    setOpen(false);
    setShowAll(false);
    setActive(-1);
    if (onSelect) onSelect(city);
  };

  const onChange = (e) => {
    const text = e.target.value;
    setQuery(text);
    setShowAll(false);
    setOpen(true);
    const matches = matchCities(cities, text);
    setActive(matches.length && fold(text) ? 0 : -1);
    if (onQueryChange) onQueryChange(text, matches);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open || !options.length) {
        setOpen(true);
        if (!fold(query)) setShowAll(true);
        setActive(0);
        return;
      }
      setActive((i) => (i + 1) % options.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) => (i <= 0 ? options.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (expanded && active >= 0 && options[active]) {
        e.preventDefault();
        pick(options[active]);
      }
    } else if (e.key === 'Escape') {
      if (expanded) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (query) {
        e.preventDefault();
        setQuery('');
        if (onQueryChange) onQueryChange('', []);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  return (
    <div className={`cbx ${className}`.trim()} ref={wrapRef}>
      {label && (
        <label className={labelHidden ? 'vh' : 'label'} htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="search">
        <Icon name="search" />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="go"
          placeholder={placeholder}
          value={query}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => fold(query) && !current && setOpen(true)}
          // eslint-disable-next-line jsx-a11y/no-autofocus
          autoFocus={autoFocus}
        />
      </div>
      <div className="cbx__list" id={listId} role="listbox" aria-label={label || t('ui.cityPicker.list')} ref={listRef} hidden={!expanded}>
        {options.map((city, i) => (
          <div
            key={city.cityId}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className="cbx__opt"
            onPointerDown={(e) => e.preventDefault()}
            onClick={() => pick(city)}
            onMouseMove={() => active !== i && setActive(i)}
          >
            <span>
              <Highlight text={city.name} query={showAll ? '' : query} />
            </span>
            <span className="cbx__county">{t('ui.cityPicker.county', { county: city.county })}</span>
          </div>
        ))}
        {expanded && !options.length && <div className="cbx__none">{t('ui.cityPicker.none', { n: cities.length })}</div>}
      </div>
      <span className="vh" role="status" aria-live="polite">
        {open && fold(query) ? (options.length ? tn('ui.cityPicker.count', options.length) : t('ui.cityPicker.none', { n: cities.length })) : ''}
      </span>
    </div>
  );
}
