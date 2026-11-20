import type { CardLocation } from './types';

/**
 * Place search using OpenStreetMap's free Nominatim service.
 * Only called when the user presses Search (their policy allows ~1 request/second).
 */
export async function searchPlaces(q: string): Promise<CardLocation[]> {
  const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error('Place search is unavailable right now. Try again in a moment.');
  const rows = (await res.json()) as { display_name: string; lat: string; lon: string }[];
  return rows.map((r) => ({ name: r.display_name, lat: Number(r.lat), lng: Number(r.lon) }));
}

export const shortPlace = (name: string) => name.split(',').slice(0, 2).join(',').trim();
export const osmLink = (l: CardLocation) => `https://www.openstreetmap.org/?mlat=${l.lat}&mlon=${l.lng}#map=16/${l.lat}/${l.lng}`;
