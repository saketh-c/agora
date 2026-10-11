import { useEffect, useMemo, useRef, useState } from 'react';
import { AttributionControl, MapContainer, Marker, TileLayer, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { DFW_CENTER, t, tn } from '@agora/core';
import Icon from './ui/Icon.jsx';

/**
 * The Meetings map (podium mock): a quiet gray OpenStreetMap base with one pin per city hall
 * that has meetings in the list. Ink dot with a Go centre = you can speak there; an open ring =
 * watch only; the selected city is a large Go pin with a mic and a label under it.
 *
 * Pins are drawn with Leaflet's own anchor only (no CSS transform), so the dot sits exactly on
 * the city hall and the focus ring and click target sit on the dot.
 *
 *   <MapView pins={[{ cityId, name, lat, lng, tone: 'go'|'watch', tag, aria }]}
 *            selectedId="plano" onSelect={(cityId) => ...} you={{ lat, lng }} insetRight={452} />
 *
 * `insetRight` is how many pixels a panel covers on the right, so fitting and panning keep
 * pins out from under it.
 */

const PIN = 18;
const SEL = 34;

const plainIcon = (tone) =>
  L.divIcon({ className: 'pin-icon', html: `<div class="pin pin--${tone === 'watch' ? 'watch' : 'go'}"></div>`, iconSize: [PIN, PIN], iconAnchor: [PIN / 2, PIN / 2] });

const ICONS = { go: plainIcon('go'), watch: plainIcon('watch') };

const YOU_ICON = L.divIcon({ className: 'pin-icon', html: '<div class="pin pin--you"></div>', iconSize: [PIN, PIN], iconAnchor: [PIN / 2, PIN / 2] });

/** The selected pin: Go with a mic, and its label ("Plano, Mon 7:00 PM") under it. Built as DOM, never as an HTML string of data. */
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
    label.textContent = tag;
    el.append(label);
  }
  return L.divIcon({ className: 'pin-icon pin-icon--sel', html: el, iconSize: [SEL, SEL], iconAnchor: [SEL / 2, SEL / 2] });
}

function Pin({ pin, selected, onSelect }) {
  const markerRef = useRef(null);
  const selectRef = useRef(onSelect);
  selectRef.current = onSelect;
  const icon = useMemo(() => (selected ? selectedIcon(pin.tag) : ICONS[pin.tone] || ICONS.go), [selected, pin.tag, pin.tone]);
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

  return <Marker ref={markerRef} position={position} icon={icon} title={pin.name} riseOnHover zIndexOffset={selected ? 1000 : 0} eventHandlers={handlers} />;
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

const padFor = (map, insetRight) => {
  const pad = map.getSize().x < 600 ? 20 : 40;
  return { paddingTopLeft: [pad, pad], paddingBottomRight: [insetRight + pad, pad] };
};

/** Frames the pins on first load, and again when a filter leaves every pin off screen. */
function Framing({ pins, insetRight }) {
  const map = useMap();
  const framed = useRef(false);
  const key = pins
    .map((p) => p.cityId)
    .sort()
    .join(',');
  useEffect(() => {
    if (!pins.length) return;
    const bounds = L.latLngBounds(pins.map((p) => [p.lat, p.lng]));
    if (!framed.current) {
      framed.current = true;
      map.fitBounds(bounds, { ...padFor(map, insetRight), maxZoom: 12, animate: false });
      return;
    }
    const view = map.getBounds();
    if (!pins.some((p) => view.contains([p.lat, p.lng]))) map.flyToBounds(bounds, { ...padFor(map, insetRight), maxZoom: 12, duration: 0.6 });
    // Only a new set of pins reframes; panel width is read when it happens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, map]);
  return null;
}

/**
 * Brings the selected city hall into view without jumping when it is already visible. The
 * padding covers the pin's label too ("Plano, Mon, 7:00 PM" hangs half its width to each
 * side and below the pin), so the whole label lands clear of a panel on the right.
 */
function FollowSelection({ pins, selectedId, insetRight }) {
  const map = useMap();
  useEffect(() => {
    if (!selectedId) return undefined;
    const pin = pins.find((p) => p.cityId === selectedId);
    if (!pin) return undefined;
    // Wait a frame so the selected icon (and its label) is in the DOM to measure.
    const raf = requestAnimationFrame(() => {
      const base = padFor(map, insetRight);
      const label = map.getContainer().querySelector('.pin-icon--sel .pin-label');
      const half = label ? Math.ceil(label.offsetWidth / 2) + 16 : 0;
      const below = label ? SEL / 2 + 6 + label.offsetHeight + 16 : 0;
      const side = Math.max(base.paddingTopLeft[0], half);
      map.panInside([pin.lat, pin.lng], {
        paddingTopLeft: [side, Math.max(base.paddingTopLeft[1], SEL)],
        paddingBottomRight: [insetRight + side, Math.max(base.paddingBottomRight[1], below)],
      });
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, insetRight, map]);
  return null;
}

export default function MapView({ pins, selectedId, onSelect, you, home, insetRight = 0, className = '' }) {
  const [map, setMap] = useState(null);
  const [tilesDown, setTilesDown] = useState(false);
  const tileHandlers = useMemo(() => ({ tileerror: () => setTilesDown(true), tileload: () => setTilesDown(false) }), []);
  const youPosition = useMemo(() => (you ? [you.lat, you.lng] : null), [you]);
  const centre = home || you;

  return (
    <div className={`map ${className}`.trim()} role="region" aria-label={tn('meetings.mapLabel', pins.length)}>
      <MapContainer ref={setMap} className="map__leaflet" center={[DFW_CENTER.lat, DFW_CENTER.lng]} zoom={10} minZoom={8} maxZoom={17} zoomSnap={0.5} zoomControl={false} attributionControl={false} scrollWheelZoom>
        {/* OSM standard tiles, grayed by .basemap (styles/map.css). crossOrigin keeps the requests anonymous. */}
        <TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://tile.openstreetmap.org/{z}/{x}/{y}.png" crossOrigin="anonymous" className="basemap" eventHandlers={tileHandlers} />
        <AttributionControl position="bottomleft" prefix={false} />
        <SizeWatch />
        <Framing pins={pins} insetRight={insetRight} />
        <FollowSelection pins={pins} selectedId={selectedId} insetRight={insetRight} />
        {pins.map((p) => (
          <Pin key={p.cityId} pin={p} selected={p.cityId === selectedId} onSelect={onSelect} />
        ))}
        {youPosition && <Marker position={youPosition} icon={YOU_ICON} title={t('meetings.youAreHere')} keyboard={false} interactive={false} />}
      </MapContainer>
      <div className="mapctl">
        <button type="button" className="iconbtn" aria-label={t('meetings.zoomIn')} onClick={() => map && map.zoomIn()}>
          <Icon name="plus" />
        </button>
        <button type="button" className="iconbtn" aria-label={t('meetings.zoomOut')} onClick={() => map && map.zoomOut()}>
          <Icon name="minus" />
        </button>
        {centre && (
          <button type="button" className="iconbtn" aria-label={t('meetings.centerCity')} onClick={() => map && map.flyTo([centre.lat, centre.lng], Math.max(map.getZoom(), 12), { duration: 0.6 })}>
            <Icon name="locate" />
          </button>
        )}
      </div>
      {tilesDown && (
        <p className="map__note" role="status">
          <Icon name="offline" size={18} />
          {t('meetings.tilesOffline')}
        </p>
      )}
    </div>
  );
}
