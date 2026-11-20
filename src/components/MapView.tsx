import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cardListId } from '../lib/board';
import type { Filters } from '../lib/filters';
import { matches } from '../lib/filters';
import { shortPlace } from '../lib/geocode';
import type { BoardData, Card } from '../lib/types';
import { LABEL_COLORS } from '../lib/types';

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Cards with a location, as pins on an OpenStreetMap map. Click a pin → open the card. */
export function MapView({
  data,
  filters,
  meId,
  onOpenCard,
}: {
  data: BoardData;
  filters: Filters;
  meId: string;
  onOpenCard: (id: string) => void;
}) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const fitted = useRef(false);
  const openRef = useRef(onOpenCard);
  openRef.current = onOpenCard;

  const placed: { c: Card; list: string }[] = [];
  let missing = 0;
  for (const c of Object.values(data.cards)) {
    const lid = cardListId(data, c.id);
    if (!lid || data.lists[lid].archived || !matches(c, filters, meId)) continue;
    if (c.location) placed.push({ c, list: data.lists[lid].title });
    else missing++;
  }
  const key = placed.map(({ c }) => `${c.id}:${c.location!.lat},${c.location!.lng}:${c.title}:${c.labelIds[0] ?? ''}`).join('|');

  useEffect(() => {
    if (!el.current || map.current) return;
    const m = L.map(el.current, { zoomControl: true, worldCopyJump: true }).setView([24.86, 67.0], 3);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    // Open card from a popup button.
    m.on('popupopen', (e) => {
      const btn = (e.popup.getElement() as HTMLElement | undefined)?.querySelector<HTMLButtonElement>('[data-card]');
      btn?.addEventListener('click', () => openRef.current(btn.dataset.card!));
    });
    // Re-measure whenever the box changes size (layout settling, window resize, sidebar toggle).
    const ro = new ResizeObserver(() => {
      m.invalidateSize();
    });
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      m.remove();
      map.current = null;
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;
    g.clearLayers();
    const pts: L.LatLngExpression[] = [];
    for (const { c, list } of placed) {
      const l = data.labels.find((x) => x.id === c.labelIds[0]);
      const color = l ? LABEL_COLORS[l.color] : '#0c66e4';
      const icon = L.divIcon({
        className: 'map-pin',
        html: `<span style="--pin:${color}"></span>`,
        iconSize: [28, 36],
        iconAnchor: [14, 34],
        popupAnchor: [0, -30],
      });
      const pos: L.LatLngExpression = [c.location!.lat, c.location!.lng];
      pts.push(pos);
      L.marker(pos, { icon, title: c.title })
        .bindPopup(
          `<div class="map-pop"><strong>${esc(c.title)}</strong><span>${esc(list)}</span><span class="map-pop-place">${esc(shortPlace(c.location!.name))}</span><button data-card="${c.id}">Open card</button></div>`,
        )
        .addTo(g);
    }
    // Fit to the pins once the box has its final size.
    requestAnimationFrame(() => {
      m.invalidateSize();
      if (pts.length && !fitted.current) {
        m.fitBounds(L.latLngBounds(pts), { padding: [60, 60], maxZoom: 13 });
        fitted.current = true;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return (
    <div className="mapview">
      <div ref={el} className="map-canvas" />
      <div className="map-info">
        <MapPin size={15} />
        {placed.length} card{placed.length === 1 ? '' : 's'} on the map
        {missing > 0 && <span className="muted"> · {missing} without a location (open a card → + Add → Location)</span>}
      </div>
    </div>
  );
}
