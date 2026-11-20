import type { Card, TimeEntry } from './types';

/** "2h 05m", "25m", "40s" — short and readable. */
export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, '0')}m`;
}

/** A running stopwatch: "0:12:05". */
export function formatClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export const entryMs = (t: TimeEntry, now: number) => (t.end ?? Math.max(t.start, now)) - t.start;

/** Total time on a card, counting running timers up to `now`. */
export const cardTimeMs = (c: Card, now: number) => (c.time ?? []).reduce((sum, t) => sum + entryMs(t, now), 0);

export const runningEntry = (c: Card, userId: string) => (c.time ?? []).find((t) => t.userId === userId && t.end === null);

export const anyRunning = (c: Card) => (c.time ?? []).some((t) => t.end === null);

/**
 * Reads what people type for a duration: "1h 30m", "1.5h", "90m", "45", "1:30".
 * A bare number means minutes. Returns milliseconds, or null if it can't be read.
 */
export function parseDuration(text: string): number | null {
  const t = text.trim().toLowerCase().replace(',', '.');
  if (!t) return null;
  const colon = t.match(/^(\d+):([0-5]?\d)$/);
  if (colon) return (Number(colon[1]) * 60 + Number(colon[2])) * 60_000;
  if (/^\d+(\.\d+)?$/.test(t)) return Math.round(Number(t) * 60_000);
  let total = 0;
  let matched = false;
  for (const m of t.matchAll(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g)) {
    matched = true;
    total += Number(m[1]) * (m[2].startsWith('h') ? 3_600_000 : 60_000);
  }
  if (!matched || t.replace(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b/g, '').trim()) return null;
  return total > 0 ? Math.round(total) : null;
}
