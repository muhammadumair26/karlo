import { Bot, Check, Copy, FolderGit2, KeyRound, Loader2, MessageSquare, Plus, Send, Settings2, Square, Trash2 } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import {
  addProject,
  cancelTask,
  claudeThreads,
  commentDraft,
  defaultPrompt,
  deleteProject,
  isImageAttachment,
  listProjects,
  newRunnerKey,
  ownWords,
  resultBody,
  runnerLastSeen,
  sendReply,
  sendTask,
  threadSession,
  useCardClaudeTasks,
  type ClaudeProject,
  type ClaudeStatus,
  type ClaudeTask,
  type ClaudeThread,
  type MacFolder,
  type MacState,
} from '../lib/claude';
import { useSignedUrls } from '../lib/files';
import type { Card } from '../lib/types';
import { Modal } from './ui';

const STATUS: Record<ClaudeStatus, { label: string; cls: string }> = {
  queued: { label: 'Waiting for your Mac', cls: 'queued' },
  working: { label: 'Claude is working', cls: 'working' },
  done: { label: 'Done', cls: 'done' },
  failed: { label: 'Stopped with a problem', cls: 'failed' },
  cancelled: { label: 'Cancelled', cls: 'cancelled' },
};

const LAST_PROJECT = 'karlo:claudeProject';

const ago = (iso: string | null) => {
  if (!iso) return '';
  const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn ghost cc-copy"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />} {done ? 'Copied' : label}
    </button>
  );
}

/** Claude's side of one message: live steps while working, then its answer (and a card comment from it). */
function ClaudeAnswer({ t, onComment }: { t: ClaudeTask; onComment?: (text: string) => void }) {
  const [allSteps, setAllSteps] = useState(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [posted, setPosted] = useState(false);
  const body = t.result ? resultBody(t.result) : '';
  const steps = (t.progress ?? '').split('\n').filter(Boolean);
  const shown = allSteps ? steps : steps.slice(-4);

  if (t.status === 'queued') return <div className="cc-bubble claude muted">Waiting for your Mac…</div>;
  if (t.status === 'cancelled') return <div className="cc-bubble claude muted">Stopped.</div>;
  return (
    <div className={`cc-bubble claude ${t.status === 'failed' ? 'failed' : ''}`}>
      {t.status === 'working' && (
        <>
          <div className="cc-working">
            <Loader2 size={14} className="spin" /> Claude is working…
          </div>
          {steps.length > 4 && (
            <button type="button" className="link-btn cc-steps-toggle" onClick={() => setAllSteps(!allSteps)}>
              {allSteps ? 'Show fewer steps' : `Show all ${steps.length} steps`}
            </button>
          )}
          <ul className="cc-steps">
            {shown.map((st, i) => (
              <li key={i} className={i === shown.length - 1 ? 'now' : ''}>
                {st}
              </li>
            ))}
            {steps.length === 0 && <li>Starting…</li>}
          </ul>
        </>
      )}
      {body && <pre className="cc-result">{body}</pre>}
      {/* A short, clean comment on the card in my name */}
      {onComment && t.status === 'done' && t.result && draft === null &&
        (posted ? (
          <div className="cc-posted">
            <Check size={14} /> Comment added
          </div>
        ) : (
          <button type="button" className="btn cc-comment-btn" onClick={() => setDraft(commentDraft(t.result))}>
            <MessageSquare size={14} /> Add comment
          </button>
        ))}
      {onComment && draft !== null && (
        <div className="cc-draft">
          <label className="cc-label">Your comment (edit if you like)</label>
          <textarea className="cc-prompt cc-draft-input" value={draft} onChange={(e) => setDraft(e.target.value)} rows={3} autoFocus />
          <div className="cc-draft-actions">
            <button type="button" className="btn ghost" onClick={() => setDraft(null)}>
              Cancel
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!draft.trim()}
              onClick={() => {
                onComment(draft.trim());
                setDraft(null);
                setPosted(true);
              }}
            >
              Add comment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One conversation with Claude: what you asked, what it's doing, its answers, and a reply box. */
function Thread({ th, onComment }: { th: ClaudeThread; onComment?: (text: string) => void }) {
  const last = th.last;
  const s = STATUS[last.status];
  const busy = last.status === 'queued' || last.status === 'working';
  const session = threadSession(th);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [mac, setMac] = useState(false);
  const resume = session ? `cd "${last.project_path}" && claude --resume ${session}` : '';

  const send = async () => {
    const text = reply.trim();
    if (!text) return;
    setSending(true);
    setErr(null);
    try {
      await sendReply(th, text);
      setReply('');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className={`cc-task ${s.cls}`}>
      <div className="cc-task-head">
        <span className={`cc-status ${s.cls}`}>{s.label}</span>
        <span className="muted">
          {last.project_name} · {ago(last.finished_at ?? last.started_at ?? last.created_at)}
        </span>
        <span className="header-spacer" />
        {busy && (
          <button type="button" className="btn ghost cc-stop" onClick={() => void cancelTask(last.id)}>
            <Square size={11} /> Stop
          </button>
        )}
      </div>
      {th.tasks.map((t, i) => (
        <Fragment key={t.id}>
          <div className="cc-bubble you">{ownWords(t) || (i === 0 ? 'Sent the card to Claude' : '')}</div>
          <ClaudeAnswer t={t} onComment={onComment} />
        </Fragment>
      ))}
      {session && (
        <>
          <form
            className="cc-reply"
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <textarea
              value={reply}
              onChange={(e) => setReply(e.target.value)}
              rows={1}
              disabled={sending}
              placeholder={busy ? 'Reply — Claude reads it when it finishes' : 'Reply to Claude…'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <button type="submit" className="cc-reply-send" disabled={!reply.trim() || sending} aria-label="Send reply" title="Send (Enter)">
              {sending ? <Loader2 size={16} className="spin" /> : <Send size={16} />}
            </button>
          </form>
          {err && <div className="auth-error">{err}</div>}
          <button type="button" className="link-btn cc-mac-toggle" onClick={() => setMac(!mac)}>
            {mac ? 'Hide' : 'Open this chat on your Mac instead'}
          </button>
          {mac && (
            <div className="cc-resume">
              <code>{resume}</code>
              <CopyText text={resume} label="Copy" />
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Projects and the Mac helper: connect the Mac, then pick project folders from the list it sends. */
function Setup({ projects, setProjects, onDone }: { projects: ClaudeProject[]; setProjects: (p: ClaudeProject[]) => void; onDone: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [mac, setMac] = useState<MacState | null>(null);
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<MacFolder | null>(null);
  const [name, setName] = useState('');
  const [manual, setManual] = useState(false);
  const [path, setPath] = useState('');

  // Keep checking while this is open, so the list appears as soon as the Mac connects.
  useEffect(() => {
    let live = true;
    const load = () => void runnerLastSeen().then((m) => live && setMac(m));
    load();
    const t = window.setInterval(load, 4000);
    return () => {
      live = false;
      window.clearInterval(t);
    };
  }, []);

  const add = async (projName: string, projPath: string) => {
    setErr(null);
    if (!projName.trim()) return setErr('Give the project a name.');
    if (!projPath.trim().startsWith('/')) return setErr('The folder should be a full path, like /Users/you/Projects/orion-souq');
    if (projects.some((p) => p.path === projPath.trim())) return setErr('That folder is already a project.');
    try {
      const p = await addProject(projName, projPath);
      setProjects([...projects, p].sort((a, b) => a.name.localeCompare(b.name)));
      setPicked(null);
      setName('');
      setPath('');
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const online = !!mac?.lastSeen && Date.now() - new Date(mac.lastSeen).getTime() < 2 * 60000;
  const cmd = key ? `node ~/.karlo/claude-runner.mjs --setup ${key}` : '';
  const used = new Set(projects.map((p) => p.path));
  const folders = (mac?.folders ?? []).filter((f) => !used.has(f.path) && (!q || (f.name + ' ' + f.path).toLowerCase().includes(q.toLowerCase())));
  const short = (p: string) => p.replace(/^\/Users\/[^/]+/, '~');

  return (
    <div className="ex-form cc">
      <h5 className="bs-h">1 · Your Mac</h5>
      <p className="muted">
        {mac === null
          ? 'Checking…'
          : !mac.connected
            ? 'Not connected yet. Tap Connect my Mac, then run the command it shows once in Terminal.'
            : online
              ? '✓ Connected — your Mac is ready for tasks.'
              : `Set up, but not checked in ${mac.lastSeen ? `since ${ago(mac.lastSeen)}` : 'yet'}. Is the Mac on?`}
      </p>
      {key ? (
        <div className="cc-key">
          <p className="muted">Run this once in Terminal on your Mac (the key is shown only now):</p>
          <code>{cmd}</code>
          <CopyText text={cmd} label="Copy command" />
        </div>
      ) : (
        !online && (
          <button type="button" className="btn" onClick={() => void newRunnerKey().then(setKey, (e: Error) => setErr(e.message))}>
            <KeyRound size={14} /> {mac?.connected ? 'Make a new key' : 'Connect my Mac'}
          </button>
        )
      )}

      <h5 className="bs-h">2 · Projects</h5>
      {projects.length === 0 && <p className="muted">No projects yet. Pick the folders Claude should work in.</p>}
      <div className="cc-projects">
        {projects.map((p) => (
          <div key={p.id} className="cc-project">
            <FolderGit2 size={16} />
            <span className="cc-project-text">
              <strong>{p.name}</strong>
              <span className="muted">{short(p.path)}</span>
            </span>
            <button
              type="button"
              className="icon-btn"
              title="Remove project"
              onClick={() => void deleteProject(p.id).then(() => setProjects(projects.filter((x) => x.id !== p.id)))}
            >
              <Trash2 size={15} />
            </button>
          </div>
        ))}
      </div>

      {picked ? (
        <div className="cc-picked">
          <FolderGit2 size={16} />
          <span className="cc-project-text">
            <span className="muted">{short(picked.path)}</span>
            <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Project name" onKeyDown={(e) => e.key === 'Enter' && void add(name, picked.path)} />
          </span>
          <button type="button" className="btn ghost" onClick={() => setPicked(null)}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={() => void add(name, picked.path)}>
            <Plus size={14} /> Add
          </button>
        </div>
      ) : mac?.folders.length ? (
        <>
          <div className="cc-label-row">
            <span className="cc-label">Folders on your Mac</span>
          </div>
          <input className="cc-search" placeholder="Search folders…" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="cc-folders">
            {folders.map((f) => (
              <button
                key={f.path}
                type="button"
                className="cc-folder"
                onClick={() => {
                  setPicked(f);
                  setName(f.name);
                }}
              >
                <FolderGit2 size={15} />
                <span className="cc-project-text">
                  <strong>{f.name}</strong>
                  <span className="muted">{short(f.path)}</span>
                </span>
                <Plus size={15} />
              </button>
            ))}
            {folders.length === 0 && <p className="muted">{q ? 'No folder matches.' : 'Every folder found is already a project.'}</p>}
          </div>
        </>
      ) : (
        <p className="muted">{mac?.connected ? 'Waiting for your Mac to send its folder list…' : 'Once your Mac is connected, its project folders show up here to pick from.'}</p>
      )}

      {!picked &&
        (manual ? (
          <div className="cc-add">
            <input placeholder="Name, e.g. Orion Souq" value={name} onChange={(e) => setName(e.target.value)} />
            <input placeholder="/Users/you/Projects/orion-souq" value={path} onChange={(e) => setPath(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add(name, path)} />
            <button type="button" className="btn" onClick={() => void add(name, path)}>
              <Plus size={14} /> Add
            </button>
          </div>
        ) : (
          <button type="button" className="btn ghost cc-copy cc-manual" onClick={() => setManual(true)}>
            Type a folder path instead
          </button>
        ))}
      {err && <div className="auth-error">{err}</div>}

      <div className="ex-form-actions">
        <span className="header-spacer" />
        <button type="button" className="btn primary" onClick={onDone} disabled={projects.length === 0}>
          Done
        </button>
      </div>
    </div>
  );
}

/** "Ask Claude" in the card window — only shown to platform admins. */
export function CardClaude({ card, boardId, boardTitle, listTitle, onComment }: { card: Card; boardId: string; boardTitle: string; listTitle?: string; onComment?: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<'send' | 'setup'>('send');
  const [projects, setProjects] = useState<ClaudeProject[] | null>(null);
  const [projectId, setProjectId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_PROJECT);
    } catch {
      return null;
    }
  });
  const [prompt, setPrompt] = useState('');
  const [note, setNote] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const tasks = useCardClaudeTasks(card.id, true);
  const active = tasks.find((t) => t.status === 'queued' || t.status === 'working');
  const threads = useMemo(() => claudeThreads(tasks), [tasks]);

  const images = useMemo(() => card.attachments.filter(isImageAttachment), [card.attachments]);
  const urls = useSignedUrls(open ? images.map((a) => a.path!) : []);

  const start = () => {
    setOpen(true);
    setErr(null);
    setSent(null);
    setPrompt(defaultPrompt(card, boardTitle, listTitle));
    setNote('');
    setPicked(new Set(images.map((a) => a.id)));
    void listProjects().then(
      (p) => {
        setProjects(p);
        if (p.length === 0) setView('setup');
        else if (!p.some((x) => x.id === projectId)) setProjectId(p[0].id);
      },
      (e: Error) => setErr(e.message),
    );
  };

  const project = projects?.find((p) => p.id === projectId) ?? null;

  const send = async () => {
    if (!project) return setErr('Pick a project first.');
    const full = [prompt.trim(), note.trim() && `My instructions:\n${note.trim()}`].filter(Boolean).join('\n\n');
    if (!full) return setErr('Tell Claude what to do.');
    setBusy(true);
    setErr(null);
    try {
      await sendTask({ project, boardId, card, prompt: full, images: images.filter((a) => picked.has(a.id)) });
      setSent(project.name);
      setNote('');
      window.setTimeout(() => setSent(null), 10000);
      try {
        localStorage.setItem(LAST_PROJECT, project.id);
      } catch {
        /* private mode */
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className={`cw-btn cw-claude ${active ? 'busy' : ''}`} onClick={start} title="Send this card to Claude Code on your Mac (only you see this)">
        {active?.status === 'working' ? <Loader2 size={16} className="spin" /> : <Bot size={16} />}
        {active ? STATUS[active.status].label : 'Ask Claude'}
      </button>
      {open && (
        <Modal
          title={
            <span className="cc-title">
              <Bot size={18} /> {view === 'setup' ? 'Claude projects' : 'Ask Claude to work on it'}
            </span>
          }
          onClose={() => setOpen(false)}
          wide
        >
          {view === 'setup' && projects ? (
            <Setup
              projects={projects}
              setProjects={setProjects}
              onDone={() => {
                if (!projects.some((x) => x.id === projectId)) setProjectId(projects[0]?.id ?? null);
                setView('send');
              }}
            />
          ) : (
            <div className="ex-form cc">
              {projects === null && !err && <p className="muted">Loading your projects…</p>}

              {projects && projects.length > 0 && (
                <>
                  <div className="cc-label-row">
                    <span className="cc-label">Project</span>
                    <span className="header-spacer" />
                    <button type="button" className="btn ghost cc-copy" onClick={() => setView('setup')}>
                      <Settings2 size={14} /> Projects & Mac
                    </button>
                  </div>
                  <div className="cc-chips">
                    {projects.map((p) => (
                      <button key={p.id} type="button" className={`cc-chip ${p.id === projectId ? 'on' : ''}`} onClick={() => setProjectId(p.id)} title={p.path}>
                        <FolderGit2 size={14} /> {p.name}
                      </button>
                    ))}
                  </div>

                  <span className="cc-label">Your instructions</span>
                  <textarea
                    className="cc-prompt cc-note-input"
                    autoFocus
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={3}
                    placeholder="Add anything you want Claude to know or do — e.g. “Only change the mobile layout” or “Check the login page first”"
                  />

                  <span className="cc-label">From the card (you can edit this too)</span>
                  <textarea className="cc-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={7} />

                  {images.length > 0 && (
                    <>
                      <span className="cc-label">Images to include</span>
                      <div className="cc-images">
                        {images.map((a) => {
                          const on = picked.has(a.id);
                          const src = urls.get(a.path!);
                          return (
                            <button
                              key={a.id}
                              type="button"
                              className={`cc-img ${on ? 'on' : ''}`}
                              title={a.name}
                              onClick={() => {
                                const n = new Set(picked);
                                if (on) n.delete(a.id);
                                else n.add(a.id);
                                setPicked(n);
                              }}
                            >
                              {src ? <img src={src} alt={a.name} /> : <span className="muted">{a.name}</span>}
                              {on && (
                                <span className="cc-img-tick">
                                  <Check size={12} />
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </>
                  )}

                  <div className="ex-form-actions">
                    <span className="muted cc-note">Only you can see this. Claude works on your Mac and won't push or deploy unless you ask.</span>
                    <span className="header-spacer" />
                    <button type="button" className="btn primary" disabled={busy || !project} onClick={() => void send()}>
                      {busy ? <Loader2 size={14} className="spin" /> : <Bot size={14} />} Send to Claude
                    </button>
                  </div>
                </>
              )}
              {err && <div className="auth-error">{err}</div>}
              {sent && (
                <div className="cc-sent">
                  <Check size={18} />
                  <span>
                    <strong>Sent to Claude · {sent}</strong>
                    <span>It starts on your Mac in a few seconds. You'll get a notification when it's done.</span>
                  </span>
                </div>
              )}

              {tasks.length > 0 && (
                <>
                  <h5 className="bs-h">On this card</h5>
                  <div className="cc-tasks">
                    {threads.map((th) => (
                      <Thread key={th.id} th={th} onComment={onComment} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </Modal>
      )}
    </>
  );
}
