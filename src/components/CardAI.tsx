import { CheckSquare, FileText, ListChecks, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { uid, type BoardActionBody } from '../lib/board';
import type { Card, Me } from '../lib/types';
import { betterDescription, checklistSteps, summarise } from '../lib/cardHelp';
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

/** Runs on the device: free and instant, nothing is sent anywhere. */
function help(action: Action, card: Card, listTitle: string | undefined, names: (id: string) => string): Result {
  if (action === 'summary') return { action, result: summarise(card, { listTitle, names }) };
  if (action === 'checklist') return { action, result: { items: checklistSteps(card) } };
  return { action, result: { description: betterDescription(card) } };
}

/** "Smart help" button in the card window: summary, checklist, better description — each with an Apply step. */
export function CardAI({
  card,
  me,
  editable,
  dispatch,
  listTitle,
  names,
}: {
  card: Card;
  me: Me;
  editable: boolean;
  dispatch: (a: BoardActionBody) => void;
  listTitle?: string;
  names: (id: string) => string;
}) {
  const [open, setOpen] = useState(false);
  const [res, setRes] = useState<Result | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [picked, setPicked] = useState<boolean[]>([]);

  const run = (a: Action) => {
    setErr(null);
    const r = help(a, card, listTitle, names);
    if (r.action === 'checklist' && !r.result.items.length) return setErr('Every suggested step is already on the checklist.');
    if (r.action === 'describe' && r.result.description === card.description.trim()) return setErr('The description is already set out this way.');
    setRes(r);
    if (r.action === 'checklist') setPicked(r.result.items.map(() => true));
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
        comment: { id: uid(), authorId: me.id, authorName: me.name, text: `📝 Summary\n\n${res.result.summary}\n\nNext step: ${res.result.next_step}`, createdAt: Date.now() },
      });
    } else if (res.action === 'checklist') {
      const add = res.result.items.filter((_, i) => picked[i]).map((text) => ({ id: uid(), text, done: false }));
      if (add.length) dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { checklist: [...card.checklist, ...add] }, note: `added ${add.length} suggested checklist item${add.length > 1 ? 's' : ''} to {card}` });
    } else {
      dispatch({ type: 'UPDATE_CARD', cardId: card.id, patch: { description: res.result.description }, note: 'tidied the description of {card}' });
    }
    close();
  };

  return (
    <>
      <button className="cw-btn cw-ai" onClick={() => setOpen(true)} title="Summary, checklist and description help — free, works on your device">
        <Sparkles size={16} /> Smart help
      </button>
      {open && (
        <Modal title="Smart help" onClose={close}>
          <div className="ex-form ai">
            {!res && (
              <div className="ai-actions">
                {ACTIONS.map((a) => (
                  <button key={a.id} className="ai-action" onClick={() => run(a.id)}>
                    <a.Icon size={18} />
                    <span>
                      <strong>{a.label}</strong>
                      <span className="muted">{a.hint}</span>
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
            <p className="muted ai-note">Free — works on your device, nothing is sent anywhere. Check the suggestion before you apply it.</p>
          </div>
        </Modal>
      )}
    </>
  );
}
