import { useEffect, useState } from 'react';
import { supabase } from '../supabase';

/** Personal preferences saved on your profile (same on every device), cached locally for instant start. */
export interface Prefs {
  /** Views menu order (view ids); views not listed keep their default place at the end. */
  viewOrder?: string[];
  /** Views hidden from the menu. */
  hiddenViews?: string[];
}

const KEY = 'karlo-prefs';
const listeners = new Set<(p: Prefs) => void>();
let current: Prefs = (() => {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '{}');
  } catch {
    return {};
  }
})();

function publish(p: Prefs) {
  current = p;
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l(p));
}

/** Loads the saved preferences for this person (call once after sign-in). */
export async function loadPrefs(userId: string) {
  if (!supabase) return;
  const { data } = await supabase.from('profiles').select('prefs').eq('id', userId).maybeSingle();
  if (data?.prefs && typeof data.prefs === 'object') publish(data.prefs as Prefs);
}

export async function savePrefs(userId: string, patch: Partial<Prefs>) {
  const next = { ...current, ...patch };
  publish(next);
  if (!supabase) return;
  const { error } = await supabase.from('profiles').update({ prefs: next }).eq('id', userId);
  if (error) throw new Error(error.message);
}

export function usePrefs(): Prefs {
  const [p, setP] = useState<Prefs>(current);
  useEffect(() => {
    listeners.add(setP);
    return () => {
      listeners.delete(setP);
    };
  }, []);
  return p;
}

/** Applies a saved order + hidden list to the default list of items (by id). */
export function arrange<T extends { id: string }>(items: T[], order?: string[], hidden?: string[]): T[] {
  const pos = new Map((order ?? []).map((id, i) => [id, i]));
  return [...items]
    .sort((a, b) => (pos.get(a.id) ?? 1000 + items.indexOf(a)) - (pos.get(b.id) ?? 1000 + items.indexOf(b)))
    .filter((v) => !(hidden ?? []).includes(v.id));
}
