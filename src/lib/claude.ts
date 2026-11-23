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
  board_id?: string | null;
  prompt: string;
  images: { name: string; url: string }[];
  status: ClaudeStatus;
  session_id: string | null;
  result: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  thread_id?: string | null; // the first task of the conversation (replies only)
  resume_session?: string | null; // the Claude session a reply continues
  progress?: string | null; // what Claude is doing, one step per line (while working)
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

export interface MacFolder {
  name: string;
  path: string;
  git?: boolean;
}

export interface MacState {
  connected: boolean;
  lastSeen: string | null;
  folders: MacFolder[];
}

/** The Mac helper: when it last checked in, and the project folders it found. */
export async function runnerLastSeen(): Promise<MacState> {
  const { data } = await sb().from('claude_runner_keys').select('last_seen_at, folders').maybeSingle();
  return { connected: !!data, lastSeen: data?.last_seen_at ?? null, folders: (data?.folders as MacFolder[] | undefined) ?? [] };
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
  const links = card.attachments.filter((a) => !a.path && a.url);
  if (links.length) lines.push('', 'Attached links (open them, they may show the problem):', ...links.map((a) => `- ${a.name}: ${a.url}`));
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
      prompt: `${opts.prompt}\n\n${COMMENT_ASK}`,
      images,
    })
    .select('*')
    .single();
  if (error) throw new Error(error.message);
  return data as ClaudeTask;
}

/** Stop a task: one that's waiting, or one Claude is working on (the Mac stops it within a few seconds). */
export async function cancelTask(id: string) {
  const { error } = await sb().from('claude_tasks').update({ status: 'cancelled', finished_at: new Date().toISOString() }).eq('id', id).in('status', ['queued', 'working']);
  if (error) throw new Error(error.message);
}

/** A conversation with Claude: the first task and the replies after it, oldest first. */
export interface ClaudeThread {
  id: string;
  tasks: ClaudeTask[];
  last: ClaudeTask;
}

export function claudeThreads(tasks: ClaudeTask[]): ClaudeThread[] {
  const by = new Map<string, ClaudeTask[]>();
  for (const t of tasks) {
    const k = t.thread_id ?? t.id;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  return [...by.entries()]
    .map(([id, ts]) => {
      const sorted = ts.sort((a, b) => a.created_at.localeCompare(b.created_at));
      return { id, tasks: sorted, last: sorted[sorted.length - 1] };
    })
    .sort((a, b) => b.last.created_at.localeCompare(a.last.created_at));
}

/** The Claude session a reply in this conversation should continue (none until Claude has started). */
export const threadSession = (th: ClaudeThread) => [...th.tasks].reverse().map((t) => t.session_id ?? t.resume_session).find(Boolean) ?? null;

/** Reply in a conversation: Claude continues the same session on the Mac, with everything it already knows. */
export async function sendReply(th: ClaudeThread, text: string) {
  const session = threadSession(th);
  if (!session) throw new Error('Claude has not started yet — wait a moment and try again.');
  const first = th.tasks[0];
  const { error } = await sb().from('claude_tasks').insert({
    project_name: first.project_name,
    project_path: first.project_path,
    board_id: first.board_id ?? null,
    card_id: first.card_id,
    card_title: first.card_title ?? '',
    prompt: `${text.trim()}\n\n${COMMENT_ASK}`,
    images: [],
    thread_id: th.id,
    resume_session: session,
  });
  if (error) throw new Error(error.message);
}

/** What I wrote, without the instructions Karlo adds (shown as the "You" message). */
export const ownWords = (t: ClaudeTask) => {
  const p = (t.prompt ?? '').replace(COMMENT_ASK, '').trim();
  if (!t.resume_session) {
    const mine = p.match(/My instructions:\n([\s\S]+)$/);
    return mine ? mine[1].trim() : '';
  }
  return p;
};

/** Claude tasks for one card, newest first, kept live. */
export function useCardClaudeTasks(cardId: string, enabled: boolean): ClaudeTask[] {
  const [tasks, setTasks] = useState<ClaudeTask[]>([]);
  useEffect(() => {
    if (!enabled || !supabase) return;
    const s = supabase;
    let live = true;
    const load = async () => {
      const { data } = await s.from('claude_tasks').select('*').eq('card_id', cardId).order('created_at', { ascending: false }).limit(30);
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

/** Asked of Claude with every task, so a short note for the card comes back with the result. */
export const COMMENT_ASK =
  "When you are finished, end your reply with a line that says exactly \"CARD COMMENT:\" followed by a short, professional status update for my team and client, written as me in the first person. Use 2-3 complete sentences in clear, polished business English: state what was resolved or delivered, the outcome, and (if useful) what they should check next. Example: \"I have resolved the login issue on mobile. The sign-in button now responds correctly on the first tap across devices. Please verify on your end and let me know if anything needs adjusting.\" No markdown, code, file paths or technical jargon.";

const plain = (t: string) =>
  t
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+.*$/gm, " ")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

/** A clean 2-3 line comment (in my words) from what Claude reported. */
export function commentDraft(result: string | null): string {
  if (!result) return "";
  const m = result.match(/CARD COMMENT:\s*([\s\S]+)$/i);
  if (m) return plain(m[1]).slice(0, 500);
  const sentences = plain(result).match(/[^.!?]+[.!?]+/g) ?? [plain(result)];
  return sentences.slice(0, 3).join(" ").replace(/\s+/g, " ").trim().slice(0, 400);
}

/** The result without the "CARD COMMENT:" part (it is shown as its own box). */
export const resultBody = (result: string) => result.replace(/\n*\s*CARD COMMENT:[\s\S]*$/i, "").trim();
