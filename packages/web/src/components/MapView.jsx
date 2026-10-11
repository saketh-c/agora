import { useEffect, useMemo, useRef, useState } from 'react';
import { AttributionControl, Circle, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DFW_CENTER, isRtl, localeDir, t, tn } from '@agora/core';
import Icon from './ui/Icon.jsx';

/**
 * The Meetings map (podium mock): a quiet gray OpenStreetMap base with one pin per city hall
 * that has meetings in the list. Ink dot with a Go centre = you can speak there; an open ring =
 * watch only; the selected city is a large Go pin with a mic and a label under it. A pin's
 * label ("Plano, Mon 7:00 PM") also shows on hover and keyboard focus, and for the `hotId`
 * pin (the row under the pointer, or the card in view on a phone).
 *
 * Where distance is measured from (`origin`: { lat, lng, label }) gets its own marker, and a
 * distance limit (`ringMiles`) a dashed ring around it. With no pins, `empty` (a short
 * message and a way out) sits over the map.
 *
 * Pins are drawn with Leaflet's own anchor only (no CSS transform), so the dot sits exactly on
 * the city hall and the focus ring and click target sit on the dot.
 *
 *   <MapView pins={[{ cityId, name, lat, lng, tone: 'go'|'watch', tag, aria }]}
 *            selectedId="plano" hotId="allen" onSelect={(cityId) => ...} origin={{ lat, lng, label }}
 *            ringMiles={15} insetRight={452} empty={<p>...</p>} />
 *
 * `insetRight` is how many pixels a panel covers at the end edge of the map (the right; the
 * left in Arabic, where the panel opens there), so fitting and panning keep pins out from
 * under it.
 *
 * The map itself is left to right in every language (geography does not mirror; Leaflet's
 * panes are positioned for it); the controls over it follow the page direction, and the
 * attribution moves to the corner the panel never covers.
 */

const PIN = 18;
const SEL = 34;
const METERS_PER_MILE = 1609.344;

/** A pin as DOM (never an HTML string of data), with its label hidden until hover, focus or hot. */
function plainIcon(tone, tag, hot) {
  const el = document.createElement('div');
  el.className = `pin pin--${tone === 'watch' ? 'watch' : 'go'}`;
  if (tag) {
    const label = document.createElement('span');
    label.className = 'pin-label';
    label.dir = localeDir();
    label.textContent = tag;
    el.append(label);
  }
  return L.divIcon({ className: `pin-icon${hot ? ' is-hot' : ''}`, html: el, iconSize: [PIN, PIN], iconAnchor: [PIN / 2, PIN / 2] });
}

function originIcon(label) {
  const el = document.createElement('div');
  el.className = 'pin pin--you';
  if (label) {
    const span = document.createElement('span');
    span.className = 'pin-label pin-label--you';
    span.dir = localeDir();
    span.textContent = label;
    el.append(span);
  }
  return L.divIcon({ className: 'pin-icon pin-icon--you', html: el, iconSize: [PIN, PIN], iconAnchor: [PIN / 2, PIN / 2] });
}

/** The selected pin: Go with a mic, and its label ("Plano, Mon 7:00 PM") under it. */
function selectedIcon(tag) {
  const el = document.createElement('div');
  el.className = 'pin pin--sel';
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const head = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  head.setAttribute('d', 'M12 1.8a4 4 0 0 1 4 4V11a4 4 0 0 1-8 0V5.8a4 4 0 0 1 4-4z');
  head.setAttribute('fill', 'currentColor');
  head.setAttribute('stroke', 'none');
  const stand = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  stand.setAttribute('d', 'M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5v3.7M8.5 21.2h7');
  svg.append(head, stand);
  el.append(svg);
  if (tag) {
    const label = document.createElement('span');
    label.className = 'pin-label';
    label.dir = localeDir();
    label.textContent = tag;
    el.append(label);
  }
  return L.divIcon({ className: 'pin-icon pin-icon--sel', html: el, iconSize: [SEL, SEL], iconAnchor: [SEL / 2, SEL / 2] });
}

function Pin({ pin, selected, hot, onSelect }) {
  const markerRef = useRef(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const icon = useMemo(() => (selected ? selectedIcon(pin.tag) : plainIcon(pin.tone, pin.tag, hot)), [selected, hot, pin.tag, pin.tone]);
  const position = useMemo(() => [pin.lat, pin.lng], [pin.lat, pin.lng]);
  const cityId = pin.cityId;
  const handlers = useMemo(
    () => ({
      click: () => selectRef.current && selectRef.current(cityId),
      add: (e) => {
        const el = e.target.getElement();
        if (!el || el.dataset.keys) return;
        el.dataset.keys = '1';
        // Enter and Space both activate a role="button". Cancelling keydown also stops
        // Leaflet's own keypress (Enter) handler, so a pin never fires twice.
        el.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          if (selectRef.current) selectRef.current(cityId);
        });
        // A pin reached with Tab may be outside the visible map: bring it into view.
        el.addEventListener('focus', () => {
          const map = e.target._map;
          if (map && el.matches(':focus-visible')) map.panInside(e.target.getLatLng(), { padding: [32, 32] });
        });
      },
    }),
    [cityId],
  );

  // Leaflet keeps the same element across icon changes, so label it after every render.
  useEffect(() => {
    const el = markerRef.current && markerRef.current.getElement();
    if (!el) return;
    el.setAttribute('aria-label', pin.aria);
    if (selected) el.setAttribute('aria-current', 'true');
    else el.removeAttribute('aria-current');
  });

  return <Marker ref={markerRef} position={position} icon={icon} riseOnHover zIndexOffset={selected ? 1000 : hot ? 900 : 0} eventHandlers={handlers} />;
}

/** Keeps the map's size right when its box changes (phone list/map switch, panel, resize). */
function SizeWatch() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    if (typeof ResizeObserver !== 'function') return undefined;
    const ro = new ResizeObserver(() => map.invalidateSize({ pan: false }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

/** Map padding that keeps pins clear of a panel at the end edge (the left, right to left). */
const padFor = (map, insetRight) => {
  const pad = map.getSize().x < 600 ? 20 : 40;
  const left = isRtl() ? insetRight : 0;
  const right = isRtl() ? 0 : insetRight;
  return { paddingTopLeft: [left + pad, pad], paddingBottomRight: [right + pad, pad] };
};

/** The area a ring covers, as bounds (no map needed). */
const ringBounds = (origin, miles) => L.latLng(origin.lat, origin.lng).toBounds(miles * METERS_PER_MILE * 2);

/**
 * Frames the pins on first load, and again when the results change enough that the reader
 * would otherwise miss them:
 *  - a new distance ring (another limit or another origin) is framed as a whole;
 *  - removing the ring ("Any distance") frames every pin, since the results now reach past it;
 *  - when new pins appear and several of them (or every one, when only one or two are new)
 *    fall outside the view, every pin is framed, unless the reader has dragged or zoomed the
 *    map since it was last framed;
 *  - a filter that leaves every pin off screen always frames them.
 */
function Framing({ pins, insetRight, origin, ringMiles }) {
  const map = useMap();
  const framed = useRef(false);
  const lastRing = useRef('');
  const lastPins = useRef(new Set());
  // `auto` is true while a move this component started runs; `moved` once the reader moves the map.
  const auto = useRef(false);
  const moved = useRef(false);
  useEffect(() => {
    const onStart = () => {
      if (!auto.current) moved.current = true;
    };
    const onEnd = () => {
      auto.current = false;
    };
    map.on('dragstart zoomstart', onStart);
    map.on('moveend', onEnd);
    return () => {
      map.off('dragstart zoomstart', onStart);
      map.off('moveend', onEnd);
    };
  }, [map]);
  const key = pins
    .map((p) => p.cityId)
    .sort()
    .join(',');
  const ringKey = origin && ringMiles ? `${origin.lat},${origin.lng},${ringMiles}` : '';
  useEffect(() => {
    const ringChanged = ringKey !== lastRing.current;
    const ringRemoved = ringChanged && !ringKey && Boolean(lastRing.current);
    const before = lastPins.current;
    lastRing.current = ringKey;
    lastPins.current = new Set(pins.map((p) => p.cityId));
    const frame = (bounds, animate = true) => {
      auto.current = true;
      moved.current = false;
      const options = { ...padFor(map, insetRight), maxZoom: 12 };
      if (animate) map.flyToBounds(bounds, { ...options, duration: 0.6 });
      else map.fitBounds(bounds, { ...options, animate: false });
    };
    const allPins = () => {
      const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
      return origin ? bounds.extend([origin.lat, origin.lng]) : bounds;
    };
    if (!framed.current) {
      framed.current = true;
      let bounds = pins.length ? L.latLngBounds(pins.map((p) => [p.lat, p.lng])) : null;
      if (ringKey) bounds = bounds ? bounds.extend(ringBounds(origin, ringMiles)) : ringBounds(origin, ringMiles);
      if (bounds) frame(bounds, false);
      return;
    }
    if (ringChanged && ringKey) {
      frame(ringBounds(origin, ringMiles));
      return;
    }
    if (!pins.length) return;
    if (ringRemoved) {
      frame(allPins());
      return;
    }
    const view = map.getBounds();
    const outside = (p) => !view.contains([p.lat, p.lng]);
    if (pins.every(outside)) {
      frame(allPins());
      return;
    }
    const added = pins.filter((p) => !before.has(p.cityId));
    if (!moved.current && added.length && added.filter(outside).length >= Math.min(3, added.length)) frame(allPins());
    // Only a new set of pins or a new ring reframes; panel width is read when it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, ringKey, map]);
  return null;
}

/**
 * Brings the selected city hall into view without jumping when it is already visible. The
 * padding covers the pin's label too ("Plano, Mon, 7:00 PM" hangs half its width to each
 * side and below the pin), so the whole label lands clear of a panel on the right.
 */
function FollowSelection({ pins, selectedId, insetRight, labelSelector = '.pin-icon--sel .pin-label', size = SEL }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return undefined;
    const pin = pins.find((p) => p.cityId === selectedId);
    if (!pin) return undefined;
    // Wait a frame so the selected icon (and its label) is in the DOM to measure.
    const raf = requestAnimationFrame(() => {
      const base = padFor(map, insetRight);
      const label = map.getContainer().querySelector(labelSelector);
      const half = label ? Math.ceil(label.offsetWidth / 2) + 16 : 0;
      const below = label ? size / 2 + 6 + label.offsetHeight + 16 : 0;
      const rtl = isRtl();
      const side = Math.max(Math.min(base.paddingTopLeft[0], base.paddingBottomRight[0]), half);
      map.panInside([pin.lat, pin.lng], {
        paddingTopLeft: [(rtl ? insetRight : 0) + side, Math.max(base.paddingTopLeft[1], size)],
        paddingBottomRight: [(rtl ? 0 : insetRight) + side, Math.max(base.paddingBottomRight[1], below)],
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, insetRight, map]);
  return null;
}

export default function MapView({ pins, selectedId, hotId, followHot = false, onSelect, origin, ringMiles, insetRight = 0, empty, className = '' }) {
  const [map, setMap] = useState(null);
  const [tilesDown, setTilesDown] = useState(false);
  const tileHandlers = useMemo(() => ({ tileerror: () => setTilesDown(true), tileload: () => setTilesDown(false) }), []);
  const originPosition = useMemo(() => (origin ? [origin.lat, origin.lng] : null), [origin]);
  // The origin marker is left out where it would sit on a city hall pin (a city chosen as Home).
  const originOnPin = Boolean(origin) && pins.some((p) => Math.abs(p.lat - origin.lat) < 0.004 && Math.abs(p.lng - origin.lng) < 0.004);
  const youIcon = useMemo(() => (origin ? originIcon(origin.mapLabel || origin.label) : null), [origin]);
  const ringCenter = useMemo(() => (origin ? [origin.lat, origin.lng] : null), [origin]);
  const ring = origin && ringMiles ? ringMiles * METERS_PER_MILE : 0;

  return (
    <div className={`map ${className}`.trim()} role="region" aria-label={tn('meetings.mapLabel', pins.length)}>
      <MapContainer ref={setMap} className="map__leaflet" center={[DFW_CENTER.lat, DFW_CENTER.lng]} zoom={10} minZoom={8} maxZoom={17} zoomSnap={0.5} zoomControl={false} attributionControl={false} scrollWheelZoom>
        {/* OSM standard tiles, grayed by .basemap (styles/map.css). crossOrigin keeps the requests anonymous. */}
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" crossOrigin="anonymous" className="basemap" eventHandlers={tileHandlers} />
        {/* Bottom left, clear of the meeting panel; right to left the panel opens on the left. */}
        <AttributionControl key={isRtl() ? 'rtl' : 'ltr'} position={isRtl() ? 'bottomright' : 'bottomleft'} prefix={false} />
        <SizeWatch />
        <Framing pins={pins} insetRight={insetRight} origin={origin} ringMiles={ringMiles} />
        <FollowSelection pins={pins} selectedId={selectedId} insetRight={insetRight} />
        {/* On a phone the card in view lights its pin: keep that pin and its label on screen. */}
        {followHot && !selectedId && <FollowSelection pins={pins} selectedId={hotId} insetRight={0} labelSelector=".pin-icon.is-hot .pin-label" size={PIN} />}
        {ring > 0 && <Circle center={ringCenter} radius={ring} interactive={false} pathOptions={{ className: 'ring', weight: 2, dashArray: '6 6', fillOpacity: 0.05 }} />}
        {originPosition && !originOnPin && <Marker position={originPosition} icon={youIcon} keyboard={false} interactive={false} zIndexOffset={-100} />}
        {pins.map((p) => (
          <Pin key={p.cityId} pin={p} selected={p.cityId === selectedId} hot={p.cityId === hotId && p.cityId !== selectedId} onSelect={onSelect} />
        ))}
      </MapContainer>
      <div className="mapctl">
        <button type="button" className="iconbtn" aria-label={t('meetings.zoomIn')} onClick={() => map && map.zoomIn()}>
          <Icon name="plus" />
        </button>
        <button type="button" className="iconbtn" aria-label={t('meetings.zoomOut')} onClick={() => map && map.zoomOut()}>
          <Icon name="minus" />
        </button>
        {origin && (
          <button type="button" className="iconbtn" aria-label={t('meetings.centerOn', { place: origin.mapLabel || origin.label })} onClick={() => map && map.flyTo([origin.lat, origin.lng], Math.max(map.getZoom(), 12), { duration: 0.6 })}>
            <Icon name="locate" />
          </button>
        )}
      </div>
      {!pins.length && empty ? <div className="map__empty">{empty}</div> : null}
      {tilesDown && (
        <p className="map__note" role="status">
          <Icon name="offline" size={18} />
          {t('meetings.tilesOffline')}
        </p>
      )}
    </div>
  );
}
