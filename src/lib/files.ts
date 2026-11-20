import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { uid } from './board';
import type { Attachment } from './types';

export const MAX_FILE_BYTES = 25 * 1024 * 1024;
const BUCKET = 'attachments';
const TTL = 60 * 60; // signed links last 1 hour

export const isImage = (a: Pick<Attachment, 'mime' | 'name'>) =>
  (a.mime ?? '').startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(a.name ?? '');

export function formatBytes(n?: number) {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const extOf = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE');

/** Uploads one file to attachments/<board>/<card>/… and returns the attachment record. */
export async function uploadAttachment(boardId: string, cardId: string, file: File): Promise<Attachment> {
  if (!supabase) throw new Error('Storage is not configured');
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name} is larger than 25 MB.`);
  const safe = file.name.replace(/[^\w.\- ()]+/g, '_').slice(-120) || 'file';
  const path = `${boardId}/${cardId}/${uid()}-${safe}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  });
  if (error) throw new Error(`${file.name}: ${error.message}`);
  return { id: uid(), name: file.name || 'Pasted image', url: '', path, size: file.size, mime: file.type, addedAt: Date.now() };
}

export async function deleteFiles(paths: string[]) {
  if (!supabase || paths.length === 0) return;
  await supabase.storage.from(BUCKET).remove(paths);
}

// ---- signed URLs (private bucket), cached until shortly before they expire
const cache = new Map<string, { url: string; exp: number }>();
const listeners = new Set<() => void>();

async function sign(paths: string[]) {
  if (!supabase) return;
  const now = Date.now();
  const todo = [...new Set(paths)].filter((p) => (cache.get(p)?.exp ?? 0) < now);
  if (todo.length === 0) return;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(todo, TTL);
  for (const r of data ?? []) {
    if (r.signedUrl && r.path) cache.set(r.path, { url: r.signedUrl, exp: now + (TTL - 300) * 1000 });
  }
  listeners.forEach((l) => l());
}

/** Map of storage path → temporary URL for the given files. */
export function useSignedUrls(paths: string[]): Map<string, string> {
  const key = paths.join('|');
  const [, bump] = useState(0);
  useEffect(() => {
    const l = () => bump((n) => n + 1);
    listeners.add(l);
    void sign(paths);
    return () => {
      listeners.delete(l);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const out = new Map<string, string>();
  for (const p of paths) {
    const c = cache.get(p);
    if (c && c.exp > Date.now()) out.set(p, c.url);
  }
  return out;
}

/** A fresh link to open (or download) a file. */
export async function fileUrl(path: string, download?: string): Promise<string | null> {
  if (!supabase) return null;
  const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, TTL, download ? { download } : undefined);
  return data?.signedUrl ?? null;
}

/** All storage paths used by a set of attachments. */
export const pathsOf = (atts: Attachment[]) => atts.map((a) => a.path).filter((p): p is string => !!p);
