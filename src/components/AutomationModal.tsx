import { Lock, Plus, Trash2, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { actionText, suggestedRules, triggerText } from '../lib/automation';
import { uid, type BoardActionBody } from '../lib/board';
import type { AutoAction, AutomationRule, AutoTrigger, BoardData, Person } from '../lib/types';
import { askConfirm } from './dialog';
import { Modal } from './ui';

type TriggerKind = AutoTrigger['type'];
type ActionKind = AutoAction['type'];

const TRIGGERS: { v: TriggerKind; label: string }[] = [
  { v: 'moved_to', label: 'A card is moved to…' },
  { v: 'added_to', label: 'A card is added to…' },
  { v: 'completed', label: 'A card is marked complete' },
  { v: 'checklist_done', label: "A card's checklist is all ticked" },
];

const ACTIONS: { v: ActionKind; label: string }[] = [
  { v: 'complete', label: 'Mark it complete' },
  { v: 'uncomplete', label: 'Mark it not complete' },
  { v: 'move_to', label: 'Move it to a list' },
  { v: 'assign', label: 'Add a responsible person' },
  { v: 'due_in', label: 'Set the due date' },
  { v: 'clear_due', label: 'Remove the due date' },
  { v: 'add_label', label: 'Add a label' },
  { v: 'check_all', label: 'Tick every checklist item' },
  { v: 'notify', label: 'Send a notification' },
];

/** "When … then …" rules for a board. Admins add and change them; everyone can see them. */
export function AutomationModal({
  data,
  admin,
  people,
  dispatch,
  onClose,
}: {
  data: BoardData;
  admin: boolean;
  people: Person[];
  dispatch: (a: BoardActionBody) => void;
  onClose: () => void;
}) {
  const rules = data.automations ?? [];
  const [adding, setAdding] = useState(false);
  const lists = data.listOrder.map((id) => data.lists[id]).filter((l) => l && !l.archived);
  const personName = (id: string) => people.find((p) => p.user_id === id)?.name ?? 'someone';

  const save = (next: AutomationRule[], note: string) => dispatch({ type: 'SET_AUTOMATIONS', rules: next, note });
  const toggle = (r: AutomationRule) => save(rules.map((x) => (x.id === r.id ? { ...x, on: !x.on } : x)), `${r.on ? 'paused' : 'turned on'} an automation`);
  const remove = async (r: AutomationRule) => {
    if (!(await askConfirm({ title: 'Delete this automation?', message: `When ${triggerText(r.trigger, data)} → ${r.actions.map((a) => actionText(a, data, personName)).join(', ')}.`, confirmLabel: 'Delete', tone: 'danger' }))) return;
    save(
      rules.filter((x) => x.id !== r.id),
      'deleted an automation',
    );
  };
  const suggestions = suggestedRules(data, uid).filter((s) => !rules.some((r) => JSON.stringify([r.trigger, r.actions]) === JSON.stringify([s.rule.trigger, s.rule.actions])));

  return (
    <Modal title="Automation" onClose={onClose}>
      <div className="ex-form au">
        <p className="muted au-lead">
          Let Karlo do the routine steps. When something happens to a card, these rules run straight away — for everyone on this board.
        </p>
        {!admin && (
          <p className="bs-readonly">
            <Lock size={13} /> Only board admins can change automations.
          </p>
        )}

        {rules.length === 0 && !adding && <div className="au-empty">No automations yet.</div>}
        <ul className="au-list">
          {rules.map((r) => (
            <li key={r.id} className={`au-rule ${r.on ? '' : 'off'}`}>
              <Zap size={17} className="au-icon" />
              <div className="au-text">
                <span>
                  <b>When</b> {triggerText(r.trigger, data)}
                </span>
                <span>
                  <b>Then</b> {r.actions.map((a) => actionText(a, data, personName)).join(', ')}
                </span>
              </div>
              <button type="button" role="switch" aria-checked={r.on} aria-label={r.on ? 'Pause' : 'Turn on'} title={r.on ? 'On — tap to pause' : 'Paused — tap to turn on'} disabled={!admin} className={`rs-toggle ${r.on ? 'on' : ''}`} onClick={() => toggle(r)}>
                <span />
              </button>
              {admin && (
                <button className="icon-btn" onClick={() => void remove(r)} aria-label="Delete automation" title="Delete">
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>

        {admin && adding && (
          <RuleEditor
            data={data}
            lists={lists.map((l) => ({ id: l.id, title: l.title }))}
            people={people}
            onCancel={() => setAdding(false)}
            onSave={(r) => {
              save([...rules, r], 'added an automation');
              setAdding(false);
            }}
          />
        )}

        {admin && !adding && (
          <>
            <button className="btn primary au-add" onClick={() => setAdding(true)}>
              <Plus size={15} /> New automation
            </button>
            {suggestions.length > 0 && (
              <div className="au-suggest">
                <h5 className="bs-h">Quick start</h5>
                {suggestions.map((s) => (
                  <button key={s.title} className="au-chip" onClick={() => save([...rules, s.rule], 'added an automation')}>
                    <Plus size={13} /> {s.title}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

function RuleEditor({
  data,
  lists,
  people,
  onCancel,
  onSave,
}: {
  data: BoardData;
  lists: { id: string; title: string }[];
  people: Person[];
  onCancel: () => void;
  onSave: (r: AutomationRule) => void;
}) {
  const [tk, setTk] = useState<TriggerKind>('moved_to');
  const [tList, setTList] = useState(lists[lists.length - 1]?.id ?? '');
  const [actions, setActions] = useState<AutoAction[]>([]);
  const [pick, setPick] = useState<ActionKind | ''>('');

  const trigger: AutoTrigger = tk === 'moved_to' || tk === 'added_to' ? { type: tk, listId: tList } : { type: tk };
  const blank = (k: ActionKind): AutoAction => {
    switch (k) {
      case 'move_to':
        return { type: k, listId: lists.find((l) => l.id !== tList)?.id ?? lists[0]?.id ?? '' };
      case 'assign':
        return { type: k, userId: '@owner' };
      case 'due_in':
        return { type: k, days: 3 };
      case 'add_label':
        return { type: k, labelId: data.labels[0]?.id ?? '' };
      case 'notify':
        return { type: k, to: 'members', message: '' };
      default:
        return { type: k } as AutoAction;
    }
  };
  const setAt = (i: number, a: AutoAction) => setActions(actions.map((x, j) => (j === i ? a : x)));
  const valid = actions.length > 0 && (trigger.type === 'completed' || trigger.type === 'checklist_done' || !!tList) && actions.every((a) => (a.type === 'add_label' ? !!a.labelId : a.type === 'move_to' ? !!a.listId : true));

  return (
    <div className="au-editor">
      <label className="au-field">
        <span>When</span>
        <select className="field-select" value={tk} onChange={(e) => setTk(e.target.value as TriggerKind)}>
          {TRIGGERS.map((t) => (
            <option key={t.v} value={t.v}>
              {t.label}
            </option>
          ))}
        </select>
        {(tk === 'moved_to' || tk === 'added_to') && (
          <select className="field-select" value={tList} onChange={(e) => setTList(e.target.value)} aria-label="List">
            {lists.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        )}
      </label>

      <div className="au-field">
        <span>Then</span>
        {actions.map((a, i) => (
          <div key={i} className="au-action">
            <span className="au-action-name">{ACTIONS.find((x) => x.v === a.type)?.label}</span>
            {a.type === 'move_to' && (
              <select className="field-select" value={a.listId} onChange={(e) => setAt(i, { ...a, listId: e.target.value })} aria-label="Move to list">
                {lists.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.title}
                  </option>
                ))}
              </select>
            )}
            {a.type === 'assign' && (
              <select className="field-select" value={a.userId} onChange={(e) => setAt(i, { ...a, userId: e.target.value })} aria-label="Person">
                <option value="@owner">The card's owner</option>
                {people.map((p) => (
                  <option key={p.user_id} value={p.user_id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
            {a.type === 'due_in' && (
              <select className="field-select" value={a.days} onChange={(e) => setAt(i, { ...a, days: Number(e.target.value) })} aria-label="Due">
                {[0, 1, 2, 3, 5, 7, 14, 30].map((d) => (
                  <option key={d} value={d}>
                    {d === 0 ? 'Today' : d === 1 ? 'Tomorrow' : `In ${d} days`}
                  </option>
                ))}
              </select>
            )}
            {a.type === 'add_label' &&
              (data.labels.length ? (
                <select className="field-select" value={a.labelId} onChange={(e) => setAt(i, { ...a, labelId: e.target.value })} aria-label="Label">
                  {data.labels.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name || l.color}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="muted">This board has no labels yet.</span>
              ))}
            {a.type === 'notify' && (
              <>
                <select className="field-select" value={a.to} onChange={(e) => setAt(i, { ...a, to: e.target.value })} aria-label="Who">
                  <option value="members">Its members</option>
                  <option value="owners">Its owner</option>
                  {people.map((p) => (
                    <option key={p.user_id} value={p.user_id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <input className="text-input" placeholder="Message, e.g. Ready for review" value={a.message} maxLength={140} onChange={(e) => setAt(i, { ...a, message: e.target.value })} />
              </>
            )}
            <button className="icon-btn au-x" onClick={() => setActions(actions.filter((_, j) => j !== i))} aria-label="Remove step" title="Remove">
              <X size={14} />
            </button>
          </div>
        ))}
        <select
          className="field-select au-pick"
          value={pick}
          onChange={(e) => {
            const k = e.target.value as ActionKind;
            if (k) setActions([...actions, blank(k)]);
            setPick('');
          }}
        >
          <option value="">{actions.length ? '+ Add another step…' : '+ Choose what happens…'}</option>
          {ACTIONS.filter((x) => !actions.some((a) => a.type === x.v) || x.v === 'notify').map((x) => (
            <option key={x.v} value={x.v}>
              {x.label}
            </option>
          ))}
        </select>
      </div>

      <div className="ex-form-actions">
        <span className="header-spacer" />
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave({ id: uid(), on: true, trigger, actions })}>
          Save automation
        </button>
      </div>
    </div>
  );
}
