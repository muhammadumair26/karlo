import { CheckSquare, FileText, ListChecks, Loader2, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { uid, type BoardActionBody } from '../lib/board';
import type { Card, Me } from '../lib/types';
import { supabase } from '../supabase';
import { Modal } from './ui';

type Action = 'summary' | 'checklist' | 'describe';
type Result =
  | { action: 'summary'; result: { summary: string; next_step: string } }
  | { action: 'checklist'; result: { items: string[] } }
  | { action: 'describe'; result: { description: string } };

const ACTIONS: { id: Action; label: string; hint: string; Icon: typeof Sparkles }[] = [
  { id: 'summary', label: 'Summarise this card', hint: 'Where it stands and the next step', Icon: FileText },
  { id: 'checklist', label: 'Make a checklist', hint: 'Turn the description into steps', Icon: ListChecks },
  { id: 'describe', label: 'Improve the description', hint: 'Clear goal, details, acceptance criteria', Icon: Sparkles },
];

async function askAI(action: Action, boardId: string, cardId: string): Promise<Result> {
  if (!supabase) throw new Error('Not connected');
  const { data, error } = await supabase.functions.invoke('ai', { body: { action, boardId, cardId } });
  if (error) {
    // Read the function's friendly message when there is one.
    let msg = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.message) msg = body.message;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return data as Result;
}

/** "AI" button in the card window: summary, checklist, better description — each with an Apply step. */
export function CardAI({ boardId, card, me, editable, dispatch }: { boardId: string; card: Card; me: Me; editable: boolean; dispatch: (a: BoardActionBody) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Action | null>(null);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);

  const run = async (a: Action) => {
    setBusy(a);
    setErr(null);
    setRes(null);
    try {
      const r = await askAI(a, boardId, card.id);
      setRes(r);
      if (r.action === 'checklist') setPicked(r.result.items.map(() => true));
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(null);
  };

  const close = () => {
    setOpen(false);
    setRes(null);
    setErr(null);
  };

  const apply = () => {
    if (!res) return;
    if (res.action === 'summary') {
      dispatch({
        type: 'ADD_COMMENT',
        cardId: card.id,
        comment: { id: uid(), authorId: me.id, authorName: me.name, text: `✨ AI summary\n\n${res.result.summary}\n\nNext step: ${res.result.next_step}`, createdAt: Date.now() },
      });
    } else if (res.action === 'checklist') {
      const add = res.result.items.filter((_, i) => picked[i]).map((text) => ({ id: uid(), text, done: false }));
      if (add.length) dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { checklist: [...card.checklist, ...add] }, note: `added ${add.length} AI checklist item${add.length > 1 ? 's' : ''} to {card}` });
    } else {
      dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { description: res.result.description }, note: 'improved the description of {card} with AI' });
    }
    close();
  };

  return (
    <>
      <button className="cw-btn cw-ai" onClick={() => setOpen(true)} title="AI help for this card">
        <Sparkles size={16} /> AI
      </button>
      {open && (
        <Modal title="AI help" onClose={close}>
          <div className="ex-form ai">
            {!res && (
              <div className="ai-actions">
                {ACTIONS.map((a) => (
                  <button key={a.id} className="ai-action" disabled={!!busy} onClick={() => run(a.id)}>
                    {busy === a.id ? <Loader2 size={18} className="spin" /> : <a.Icon size={18} />}
                    <span>
                      <strong>{a.label}</strong>
                      <span className="muted">{busy === a.id ? 'Thinking…' : a.hint}</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
            {err && <div className="auth-error">{err}</div>}

            {res?.action === 'summary' && (
              <div className="ai-result">
                <p>{res.result.summary}</p>
                <p className="ai-next">
                  <strong>Next step:</strong> {res.result.next_step}
                </p>
              </div>
            )}
            {res?.action === 'checklist' && (
              <div className="ai-result">
                <p className="muted">Untick anything you don't want, then add the rest to the checklist.</p>
                <ul className="ai-items">
                  {res.result.items.map((t, i) => (
                    <li key={i}>
                      <label>
                        <input type="checkbox" checked={picked[i] ?? false} onChange={(e) => setPicked(picked.map((p, j) => (j === i ? e.target.checked : p)))} />
                        {t}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {res?.action === 'describe' && (
              <div className="ai-result">
                <pre className="ai-desc">{res.result.description}</pre>
              </div>
            )}

            {res && (
              <div className="ex-form-actions">
                <button className="btn ghost" onClick={() => setRes(null)}>
                  Back
                </button>
                <span className="header-spacer" />
                {editable && (
                  <button className="btn primary" onClick={apply} disabled={res.action === 'checklist' && !picked.some(Boolean)}>
                    {res.action === 'summary' ? (
                      'Post as a comment'
                    ) : res.action === 'checklist' ? (
                      <>
                        <CheckSquare size={14} /> Add to checklist
                      </>
                    ) : (
                      'Replace description'
                    )}
                  </button>
                )}
              </div>
            )}
            <p className="muted ai-note">AI can make mistakes — check before you apply. Only this card's details are sent.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
