import { Lock, Pencil, Plus, Send, Trash2, X, Zap } from 'lucide-react';
import { useState } from 'react';
import { ACTION_CHOICES, actionText, blankAction, blankTrigger, REPEATABLE, ruleIsValid, suggestedRules, testWebhook, TRIGGER_CHOICES, triggerText, validWebhookUrl, type AutoContext } from '../lib/automation';
import { uid, type BoardActionBody } from '../lib/board';
import { PRIORITIES, type AutoAction, type AutomationRule, type AutoTrigger, type BoardData, type Person, type Priority } from '../lib/types';
import { askConfirm } from './dialog';
import { Modal } from './ui';

type TriggerKind = AutoTrigger['type'];
type ActionKind = AutoAction['type'];
const GROUPS = [...new Set(ACTION_CHOICES.map((a) => a.group))];

/** "When … then …" rules for a board. Admins add and change them; everyone can see them. */
export function AutomationModal({
  data,
  admin,
  people,
  dispatch,
  onClose,
  ctx,
}: {
  data: BoardData;
  admin: boolean;
  people: Person[];
  dispatch: (a: BoardActionBody) => void;
  onClose: () => void;
  ctx: AutoContext;
}) {
  const rules = data.automations ?? [];
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
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
                <button className="icon-btn" onClick={() => (setAdding(false), setEditing(r.id))} aria-label="Edit automation" title="Edit">
                  <Pencil size={15} />
                </button>
              )}
              {admin && (
                <button className="icon-btn" onClick={() => void remove(r)} aria-label="Delete automation" title="Delete">
                  <Trash2 size={15} />
                </button>
              )}
            </li>
          ))}
        </ul>

        {admin && (adding || editing) && (
          <RuleEditor
            key={editing ?? 'new'}
            data={data}
            lists={lists.map((l) => ({ id: l.id, title: l.title }))}
            people={people}
            ctx={{ ...ctx, personName }}
            initial={rules.find((r) => r.id === editing)}
            onCancel={() => (setAdding(false), setEditing(null))}
            onSave={(r) => {
              if (editing) save(rules.map((x) => (x.id === editing ? { ...r, id: editing, on: x.on } : x)), 'changed an automation');
              else save([...rules, r], 'added an automation');
              setAdding(false);
              setEditing(null);
            }}
          />
        )}

        {admin && !adding && !editing && (
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
  ctx,
  initial,
  onCancel,
  onSave,
}: {
  data: BoardData;
  lists: { id: string; title: string }[];
  people: Person[];
  ctx: AutoContext;
  initial?: AutomationRule;
  onCancel: () => void;
  onSave: (r: AutomationRule) => void;
}) {
  const [trigger, setTrigger] = useState<AutoTrigger>(initial?.trigger ?? { type: 'moved_to', listId: lists[lists.length - 1]?.id ?? '' });
  const [actions, setActions] = useState<AutoAction[]>(initial?.actions ?? []);
  const [pick, setPick] = useState<ActionKind | ''>('');
  const [tested, setTested] = useState<number | null>(null);
  const tList = 'listId' in trigger ? trigger.listId : '';
  const setAt = (i: number, a: AutoAction) => setActions(actions.map((x, j) => (j === i ? a : x)));
  const valid = ruleIsValid(trigger, actions);

  const listSelect = (value: string, onChange: (v: string) => void, label: string) => (
    <select className="field-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
      {lists.map((l) => (
        <option key={l.id} value={l.id}>
          {l.title}
        </option>
      ))}
    </select>
  );
  const labelSelect = (value: string, onChange: (v: string) => void) =>
    data.labels.length ? (
      <select className="field-select" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Label">
        {data.labels.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name || l.color}
          </option>
        ))}
      </select>
    ) : (
      <span className="muted">This board has no labels yet.</span>
    );
  const prioritySelect = (value: Priority, onChange: (v: Priority) => void) => (
    <select className="field-select" value={value} onChange={(e) => onChange(e.target.value as Priority)} aria-label="Priority">
      {PRIORITIES.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </select>
  );

  return (
    <div className="au-editor">
      <label className="au-field">
        <span>When</span>
        <select className="field-select" value={trigger.type} onChange={(e) => setTrigger(blankTrigger(e.target.value as TriggerKind, data, tList || lists[lists.length - 1]?.id || ''))}>
          {TRIGGER_CHOICES.map((t) => (
            <option key={t.v} value={t.v}>
              {t.label}
            </option>
          ))}
        </select>
        {(trigger.type === 'moved_to' || trigger.type === 'added_to') && listSelect(trigger.listId, (v) => setTrigger({ ...trigger, listId: v }), 'List')}
        {trigger.type === 'label_added' && labelSelect(trigger.labelId, (v) => setTrigger({ ...trigger, labelId: v }))}
        {trigger.type === 'priority_set' && prioritySelect(trigger.priority, (v) => setTrigger({ ...trigger, priority: v }))}
      </label>

      <div className="au-field">
        <span>Then</span>
        {actions.map((a, i) => (
          <div key={i} className="au-action">
            <span className="au-action-name">{ACTION_CHOICES.find((x) => x.v === a.type)?.label}</span>
            {a.type === 'move_to' && listSelect(a.listId, (v) => setAt(i, { ...a, listId: v }), 'Move to list')}
            {(a.type === 'assign' || a.type === 'unassign') && (
              <select className="field-select" value={a.userId} onChange={(e) => setAt(i, { ...a, userId: e.target.value })} aria-label="Person">
                {a.type === 'assign' ? <option value="@owner">The card's owner</option> : <option value="@all">Everyone responsible</option>}
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
            {(a.type === 'add_label' || a.type === 'remove_label') && labelSelect(a.labelId, (v) => setAt(i, { ...a, labelId: v }))}
            {a.type === 'set_priority' && prioritySelect(a.priority, (v) => setAt(i, { ...a, priority: v }))}
            {a.type === 'add_checklist' && (
              <textarea className="text-input au-wide" rows={3} placeholder={'One item per line, e.g.\nCheck the invoice\nSend to client'} value={a.items.join('\n')} onChange={(e) => setAt(i, { ...a, items: e.target.value.split('\n') })} />
            )}
            {a.type === 'add_comment' && <input className="text-input au-wide" placeholder="Comment, e.g. Moved to review — please check" value={a.text} maxLength={500} onChange={(e) => setAt(i, { ...a, text: e.target.value })} />}
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
            {a.type === 'webhook' && (
              <div className="au-hook">
                <input className="text-input" type="url" inputMode="url" placeholder="https://hooks.zapier.com/…" value={a.url} onChange={(e) => (setAt(i, { ...a, url: e.target.value }), setTested(null))} aria-label="Webhook link" />
                <select className="field-select" value={a.format} onChange={(e) => setAt(i, { ...a, format: e.target.value as 'json' | 'chat' })} aria-label="Format">
                  <option value="json">All card details (Zapier, Make, n8n)</option>
                  <option value="chat">Chat message (Slack, Teams, Google Chat, Discord)</option>
                </select>
                <button
                  type="button"
                  className="btn ghost au-test"
                  disabled={!validWebhookUrl(a.url)}
                  onClick={() => void testWebhook(a.url, a.format, data, ctx).then(() => setTested(i))}
                >
                  <Send size={14} /> {tested === i ? 'Test sent' : 'Send test'}
                </button>
                <span className="muted au-note">Karlo posts the card to this link each time the rule runs. Anyone on this board can see the link.</span>
              </div>
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
            if (k) setActions([...actions, blankAction(k, data, lists, tList)]);
            setPick('');
          }}
        >
          <option value="">{actions.length ? '+ Add another step…' : '+ Choose what happens…'}</option>
          {GROUPS.map((g) => (
            <optgroup key={g} label={g}>
              {ACTION_CHOICES.filter((x) => x.group === g && (!actions.some((a) => a.type === x.v) || REPEATABLE.includes(x.v))).map((x) => (
                <option key={x.v} value={x.v}>
                  {x.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </div>

      <div className="ex-form-actions">
        <span className="header-spacer" />
        <button className="btn ghost" onClick={onCancel}>
          Cancel
        </button>
        <button className="btn primary" disabled={!valid} onClick={() => onSave({ id: initial?.id ?? uid(), on: true, trigger, actions: actions.map((a) => (a.type === 'add_checklist' ? { ...a, items: a.items.map((x) => x.trim()).filter(Boolean) } : a)) })}>
          Save automation
        </button>
      </div>
    </div>
  );
}
