import { Bot, Check, Copy, FolderGit2, KeyRound, Loader2, Plus, Settings2, Trash2, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import {
  addProject,
  cancelTask,
  defaultPrompt,
  deleteProject,
  isImageAttachment,
  listProjects,
  newRunnerKey,
  runnerLastSeen,
  sendTask,
  useCardClaudeTasks,
  type ClaudeProject,
  type ClaudeStatus,
  type ClaudeTask,
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

function TaskRow({ t }: { t: ClaudeTask }) {
  const s = STATUS[t.status];
  const resume = t.session_id ? `cd "${t.project_path}" && claude --resume ${t.session_id}` : '';
  return (
    <div className={`cc-task ${s.cls}`}>
      <div className="cc-task-head">
        <span className={`cc-status ${s.cls}`}>
          {t.status === 'working' && <Loader2 size={13} className="spin" />}
          {s.label}
        </span>
        <span className="muted">
          {t.project_name} · {ago(t.finished_at ?? t.started_at ?? t.created_at)}
        </span>
        <span className="header-spacer" />
        {t.status === 'queued' && (
          <button type="button" className="btn ghost cc-copy" onClick={() => void cancelTask(t.id)}>
            <X size={14} /> Cancel
          </button>
        )}
      </div>
      {t.result && <pre className="cc-result">{t.result}</pre>}
      {resume && (t.status === 'done' || t.status === 'failed' || t.status === 'working') && (
        <div className="cc-resume">
          <span className="muted">Continue this session in Terminal:</span>
          <code>{resume}</code>
          <CopyText text={resume} label="Copy" />
        </div>
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
export function CardClaude({ card, boardId, boardTitle, listTitle }: { card: Card; boardId: string; boardTitle: string; listTitle?: string }) {
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
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const tasks = useCardClaudeTasks(card.id, true);
  const active = tasks.find((t) => t.status === 'queued' || t.status === 'working');

  const images = useMemo(() => card.attachments.filter(isImageAttachment), [card.attachments]);
  const urls = useSignedUrls(open ? images.map((a) => a.path!) : []);

  const start = () => {
    setOpen(true);
    setErr(null);
    setPrompt(defaultPrompt(card, boardTitle, listTitle));
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
    if (!prompt.trim()) return setErr('Tell Claude what to do.');
    setBusy(true);
    setErr(null);
    try {
      await sendTask({ project, boardId, card, prompt: prompt.trim(), images: images.filter((a) => picked.has(a.id)) });
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

                  <span className="cc-label">What Claude should do</span>
                  <textarea className="cc-prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={9} />

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

              {tasks.length > 0 && (
                <>
                  <h5 className="bs-h">On this card</h5>
                  <div className="cc-tasks">
                    {tasks.map((t) => (
                      <TaskRow key={t.id} t={t} />
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
