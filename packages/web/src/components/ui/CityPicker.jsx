import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { searchFold, t, tn, compareText } from '@agora/core';
import Icon from './Icon.jsx';

/** Case, accents and width never stop a match; Devanagari, Telugu and Arabic marks are kept (core's searchFold). */
const fold = (s) => searchFold(s);

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
  scored.sort((a, b) => a.score - b.score || compareText(a.city.name, b.city.name));
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

/** True when the typed text is exactly one of the cities (so there is nothing to look up). */
function isExactCity(cities, text) {
  const q = fold(text);
  return Boolean(q) && cities.some((c) => fold(c.name) === q || c.cityId === q);
}

/**
 * A type-ahead city picker (ARIA APG combobox with a list popup).
 *
 *   <CityPicker cities={cities} label="Where do you live or go to school?" labelHidden
 *               placeholder="Type a city, like Plano" onSelect={(city) => setHomeCity(city)} />
 *
 * Typing filters the 39 cities; ArrowDown/ArrowUp move, Enter picks, Escape closes (then
 * clears). ArrowDown in an empty box lists every city. `onQueryChange(text, matches)` lets
 * a parent react to free text.
 *
 * `lookup` adds a last option that searches for whatever was typed (an address, ZIP code or
 * school) when some cities match but none exactly: { label(text) => string, hint?: string,
 * noMatch?: string (announced when no city matches), onLookup(text), minLength?: 3 }. It runs
 * only when chosen (Enter or a click), never while typing. With no city match the list stays
 * closed and Enter submits the form, which looks the text up. Enter with nothing highlighted
 * closes the list, so the form's own button is never covered by a stale popup.
 */
export default function CityPicker({
  cities,
  value,
  onSelect,
  label,
  labelHidden = false,
  placeholder,
  id,
  describedBy,
  autoFocus = false,
  onQueryChange,
  className = '',
  inputRef: externalRef,
  lookup,
  icon = 'search',
  invalid = false,
}) {
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
  const minLookup = lookup ? lookup.minLength || 3 : Infinity;

  // Follow the selected city when it changes elsewhere (or the language changes its name).
  useEffect(() => {
    if (current) setQuery(current.name);
  }, [current]);

  const options = useMemo(() => {
    if (showAll && !fold(query)) return [...cities].sort((a, b) => compareText(a.name, b.name));
    return matchCities(cities, query);
  }, [cities, query, showAll]);

  // The "Look up ..." row, after the cities, when the text could also be an address, ZIP or
  // school. With no city match there is no list at all: Enter (or the form's button) looks it
  // up, and nothing covers that button.
  const canLookup = Boolean(lookup) && options.length > 0 && fold(query).length >= minLookup && !isExactCity(cities, query);
  const count = options.length + (canLookup ? 1 : 0);
  const lookupIndex = canLookup ? options.length : -1;
  const expanded = open && (count > 0 || (!lookup && Boolean(fold(query))));

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

  const close = () => {
    setOpen(false);
    setShowAll(false);
    setActive(-1);
  };

  const pick = (city) => {
    setQuery(city.name);
    close();
    if (onSelect) onSelect(city);
  };

  const runLookup = () => {
    const text = query.trim();
    close();
    if (lookup && lookup.onLookup) lookup.onLookup(text);
  };

  const choose = (i) => {
    if (i === lookupIndex) runLookup();
    else if (options[i]) pick(options[i]);
  };

  const onChange = (e) => {
    const text = e.target.value;
    setQuery(text);
    setShowAll(false);
    setOpen(true);
    const matches = matchCities(cities, text);
    setActive(fold(text) && matches.length ? 0 : -1);
    if (onQueryChange) onQueryChange(text, matches);
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!open || !count) {
        setOpen(true);
        if (!fold(query)) setShowAll(true);
        setActive(0);
        return;
      }
      setActive((i) => (i + 1) % count);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      setActive((i) => (i <= 0 ? count - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (expanded && active >= 0 && active < count) {
        e.preventDefault();
        choose(active);
      } else {
        // Nothing to pick: let the form submit, with the list out of the way.
        close();
      }
    } else if (e.key === 'Escape') {
      if (expanded) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      } else if (query) {
        // Escape clears the text first; only a second one reaches the dialog around it.
        e.preventDefault();
        e.stopPropagation();
        setQuery('');
        if (onQueryChange) onQueryChange('', []);
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  };

  let status = '';
  if (open && fold(query)) {
    if (options.length) status = tn('ui.cityPicker.count', options.length);
    else if (!lookup) status = t('ui.cityPicker.none', { n: cities.length });
    else if (fold(query).length >= minLookup) status = lookup.noMatch || '';
  }

  return (
    <div className={`cbx ${className}`.trim()} ref={wrapRef}>
      {label && (
        <label className={labelHidden ? 'vh' : 'label'} htmlFor={inputId}>
          {label}
        </label>
      )}
      <div className="search">
        <Icon name={icon} />
        <input
          ref={inputRef}
          id={inputId}
          type="text"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && active >= 0 && active < count ? `${listId}-${active}` : undefined}
          aria-describedby={describedBy}
          aria-invalid={invalid || undefined}
          autoComplete="off"
          autoCapitalize="words"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={lookup ? 120 : undefined}
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
        {canLookup && (
          <div
            id={`${listId}-${lookupIndex}`}
            role="option"
            aria-selected={active === lookupIndex}
            className="cbx__opt cbx__opt--lookup"
            onPointerDown={(e) => e.preventDefault()}
            onClick={runLookup}
            onMouseMove={() => active !== lookupIndex && setActive(lookupIndex)}
          >
            <Icon name="pin" />
            <span className="cbx__lookup">
              <span className="cbx__lookup-t">{lookup.label(query.trim())}</span>
              {lookup.hint && <span className="cbx__lookup-s">{lookup.hint}</span>}
            </span>
          </div>
        )}
        {expanded && !count && <div className="cbx__none">{t('ui.cityPicker.none', { n: cities.length })}</div>}
      </div>
      <span className="vh" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
