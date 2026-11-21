import { useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { uid } from './board';
import type { Attachment, Card } from './types';

/**
 * "Ask Claude to work on it": cards sent to Claude Code on the owner's Mac.
 * Only platform admins can see or use any of this (the database enforces it too).
 */

export interface ClaudeProject {
  id: string;
  name: string;
  path: string;
}

export type ClaudeStatus = 'queued' | 'working' | 'done' | 'failed' | 'cancelled';

export interface ClaudeTask {
  id: string;
  project_name: string;
  project_path: string;
  card_id: string;
  card_title: string;
  prompt: string;
  images: { name: string; url: string }[];
  status: ClaudeStatus;
  session_id: string | null;
  result: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

function sb() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

let adminCache: Promise<boolean> | null = null;
/** Is the signed-in person allowed to use Claude tasks? (Asked once per session.) */
export function useClaudeAllowed(): boolean {
  const [yes, setYes] = useState(false);
  useEffect(() => {
    let live = true;
    adminCache ??= Promise.resolve(
      sb()
        .rpc('is_platform_admin')
        .then(({ data, error }) => !error && data === true),
    ).catch(() => false);
    void adminCache.then((v) => live && setYes(v));
    return () => {
      live = false;
    };
  }, []);
  return yes;
}

export async function listProjects(): Promise<ClaudeProject[]> {
  const { data, error } = await sb().from('claude_projects').select('id, name, path').order('name');
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function addProject(name: string, path: string): Promise<ClaudeProject> {
  const { data, error } = await sb().from('claude_projects').insert({ name: name.trim(), path: path.trim() }).select('id, name, path').single();
  if (error) throw new Error(error.message);
  return data;
}

export async function deleteProject(id: string) {
  const { error } = await sb().from('claude_projects').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** When the Mac helper last checked in (null = never connected). */
export async function runnerLastSeen(): Promise<{ connected: boolean; lastSeen: string | null }> {
  const { data } = await sb().from('claude_runner_keys').select('last_seen_at').maybeSingle();
  return { connected: !!data, lastSeen: data?.last_seen_at ?? null };
}

export async function newRunnerKey(): Promise<string> {
  const { data, error } = await sb().rpc('claude_new_runner_key');
  if (error) throw new Error(error.message);
  return data as string;
}

export const isImageAttachment = (a: Attachment) => !!a.path && (a.mime?.startsWith('image/') || /\.(png|jpe?g|gif|webp|heic)$/i.test(a.name));

/** The instructions Claude gets, built from the card (editable before sending). */
export function defaultPrompt(card: Card, boardTitle: string, listTitle?: string): string {
  const lines = [`Please work on this task from my Karlo board "${boardTitle}"${listTitle ? ` (list: ${listTitle})` : ''}.`, '', `Title: ${card.title}`];
  if (card.description.trim()) lines.push('', 'Description:', card.description.trim());
  const open = card.checklist.filter((i) => !i.done);
  if (open.length) lines.push('', 'Checklist still to do:', ...open.map((i) => `- ${i.text}`));
  if (card.comments.length) {
    lines.push('', 'Latest comments:');
    for (const c of card.comments.slice(-5)) lines.push(`- ${c.authorName}: ${c.text}`);
  }
  return lines.join('\n');
}

const WEEK = 7 * 24 * 3600;

export async function sendTask(opts: {
  project: ClaudeProject;
  boardId: string;
  card: Card;
  prompt: string;
  images: Attachment[];
}): Promise<ClaudeTask> {
  const paths = opts.images.map((a) => a.path!).filter(Boolean);
  let images: { name: string; url: string }[] = [];
  if (paths.length) {
    // Links the Mac helper can download with (valid for a week, only shared with my own Mac).
    const { data, error } = await sb().storage.from('attachments').createSignedUrls(paths, WEEK);
    if (error) throw new Error(error.message);
    images = (data ?? []).flatMap((r, i) => (r.signedUrl ? [{ name: opts.images[i].name || `image-${uid()}`, url: r.signedUrl }] : []));
  }
  const { data, error } = await sb()
    .from('claude_tasks')
    .insert({
      project_id: opts.project.id,
      project_name: opts.project.name,
      project_path: opts.project.path,
      board_id: opts.boardId,
      card_id: opts.card.id,
      card_title: opts.card.title,
      prompt: opts.prompt,
      images,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ClaudeTask;
}

export async function cancelTask(id: string) {
  const { error } = await sb().from('claude_tasks').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id).eq('status', 'queued');
  if (error) throw new Error(error.message);
}

/** Claude tasks for one card, newest first, kept live. */
export function useCardClaudeTasks(cardId: string, enabled: boolean): ClaudeTask[] {
  const [tasks, setTasks] = useState<ClaudeTask[]>([]);
  useEffect(() => {
    if (!enabled || !supabase) return;
    const s = supabase;
    let live = true;
    const load = async () => {
      const { data } = await s.from('claude_tasks').select('*').eq('card_id', cardId).order('created_at', { ascending: false }).limit(10);
      if (live) setTasks((data ?? []) as ClaudeTask[]);
    };
    void load();
    const ch = s
      .channel(`claude:${cardId}:${uid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'claude_tasks', filter: `card_id=eq.${cardId}` }, () => void load())
      .subscribe();
    // Backup in case live updates drop while Claude is working.
    const t = window.setInterval(() => void load(), 15000);
    return () => {
      live = false;
      window.clearInterval(t);
      void s.removeChannel(ch);
    };
  }, [cardId, enabled]);
  return tasks;
}
