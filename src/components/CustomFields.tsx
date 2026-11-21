import {
  AlignLeft,
  Banknote,
  Calendar,
  CheckSquare,
  ChevronDown,
  ExternalLink,
  Eye,
  EyeOff,
  Hash,
  Link2,
  ListChecks,
  Mail,
  Phone,
  SlidersHorizontal,
  Star,
  Tags,
  Trash2,
  Type,
  Users,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { BoardActionBody } from '../lib/board';
import { uid } from '../lib/board';
import { formatDate } from '../lib/filters';
import type { Card, CustomField, FieldType, FieldValue, Person } from '../lib/types';
import { FIELD_TYPES, LABEL_COLORS, hasOptions } from '../lib/types';
import { askConfirm } from './dialog';
import { Avatar } from './ui';

export const FIELD_ICONS: Record<FieldType, typeof Type> = {
  text: Type,
  longtext: AlignLeft,
  number: Hash,
  currency: Banknote,
  date: Calendar,
  dropdown: ListChecks,
  multiselect: Tags,
  checkbox: CheckSquare,
  person: Users,
  url: Link2,
  email: Mail,
  phone: Phone,
  rating: Star,
};

const FIELD_HINTS: Record<FieldType, string> = {
  text: 'A short line, e.g. Client',
  longtext: 'Several lines, e.g. Notes or Address',
  number: 'e.g. Quantity, Sq. ft',
  currency: 'An amount with currency, e.g. Budget',
  date: 'e.g. Delivery date',
  dropdown: 'Pick one choice, e.g. Stage',
  multiselect: 'Pick several, e.g. Services',
  checkbox: 'Yes or no, e.g. Paid',
  person: 'Board members, e.g. Site engineer',
  url: 'A web link',
  email: 'An email address',
  phone: 'A phone number',
  rating: '1 to 5 stars',
};

const CURRENCIES = ['AED', 'PKR', 'USD', 'EUR', 'GBP', 'SAR', 'INR'];

const money = (f: CustomField, n: number) => `${f.currency ?? 'AED'} ${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
const list = (v: FieldValue | undefined): string[] => (Array.isArray(v) ? v : typeof v === 'string' && v ? [v] : []);

/** How a field's value reads on a card face or in a list ('' = nothing to show). */
export function fieldText(f: CustomField, v: FieldValue | undefined, people?: Map<string, Person>): string {
  if (v === undefined || v === '' || v === false || (Array.isArray(v) && v.length === 0)) return '';
  switch (f.type) {
    case 'dropdown':
      return f.options?.find((o) => o.id === v)?.label ?? '';
    case 'multiselect':
      return list(v).map((id) => f.options?.find((o) => o.id === id)?.label).filter(Boolean).join(', ');
    case 'person':
      return list(v).map((id) => people?.get(id)?.name ?? '').filter(Boolean).join(', ');
    case 'checkbox':
      return f.name;
    case 'date':
      return formatDate(String(v));
    case 'number':
      return Number(v).toLocaleString();
    case 'currency':
      return money(f, Number(v));
    case 'rating':
      return '★'.repeat(Number(v));
    case 'url':
      try {
        return new URL(String(v)).hostname.replace(/^www\./, '');
      } catch {
        return String(v);
      }
    case 'longtext': {
      const first = String(v).split('\n')[0];
      return first.length > 40 ? first.slice(0, 40) + '…' : first;
    }
    default:
      return String(v);
  }
}

/** Board-wide list of custom fields: add, rename, change choices, show on card, delete. */
export function FieldsEditor({ fields, dispatch }: { fields: CustomField[]; dispatch: (a: BoardActionBody) => void }) {
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const save = (next: CustomField[], note?: string) => dispatch({ type: 'SET_FIELDS', fields: next, note });
  const set = (id: string, patch: Partial<CustomField>, note?: string) => save(fields.map((f) => (f.id === id ? { ...f, ...patch } : f)), note);
  const typeLabel = (t: FieldType) => FIELD_TYPES.find((x) => x.value === t)?.label;

  const add = () => {
    const n = name.trim();
    if (!n) return;
    const f: CustomField = {
      id: uid(),
      name: n,
      type,
      // Long notes would crowd the card front, so they stay inside the card by default.
      showOnCard: type !== 'longtext',
      ...(hasOptions(type)
        ? {
            options: [
              { id: uid(), label: 'Option 1', color: 'blue' },
              { id: uid(), label: 'Option 2', color: 'green' },
            ],
          }
        : {}),
      ...(type === 'currency' ? { currency: 'AED' } : {}),
    };
    save([...fields, f], `added the custom field “${n}”`);
    setName('');
    setType('text');
  };

  return (
    <div className="fields-editor">
      {fields.length === 0 && (
        <p className="muted fields-empty">
          Custom fields add your own details to every card on this board — like <strong>Budget</strong>, <strong>Client</strong>, <strong>Address</strong> or <strong>Approved</strong>.
        </p>
      )}
      {fields.map((f) => {
        const Icon = FIELD_ICONS[f.type] ?? Type;
        return (
          <div key={f.id} className="field-def">
            <div className="field-def-row">
              <span className="field-type-icon" title={typeLabel(f.type)}>
                <Icon size={16} />
              </span>
              <input
                className="field-name-input"
                defaultValue={f.name}
                aria-label="Field name"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v) e.target.value = f.name;
                  else if (v !== f.name) set(f.id, { name: v }, `renamed the custom field “${f.name}” to “${v}”`);
                }}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
              <span className="field-type-tag">{typeLabel(f.type)}</span>
              <button
                className={`icon-btn field-show ${f.showOnCard ? 'on' : ''}`}
                title={f.showOnCard ? 'Shown on the card in the list — click to hide' : 'Only inside the card — click to show on the card in the list'}
                aria-label={f.showOnCard ? 'Hide from card front' : 'Show on card front'}
                onClick={() => set(f.id, { showOnCard: !f.showOnCard })}
              >
                {f.showOnCard ? <Eye size={16} /> : <EyeOff size={16} />}
              </button>
              <button
                className="icon-btn"
                aria-label={`Delete ${f.name}`}
                title="Delete field"
                onClick={async () =>
                  (await askConfirm({ title: `Delete “${f.name}”?`, message: 'The field and its values are removed from every card on this board.', confirmLabel: 'Delete field', tone: 'danger' })) &&
                  save(fields.filter((x) => x.id !== f.id), `deleted the custom field “${f.name}”`)
                }
              >
                <Trash2 size={16} />
              </button>
            </div>
            {f.type === 'currency' && (
              <div className="field-options">
                <label className="field-currency">
                  Currency
                  <select value={f.currency ?? 'AED'} onChange={(e) => set(f.id, { currency: e.target.value })}>
                    {CURRENCIES.map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              </div>
            )}
            {hasOptions(f.type) && (
              <div className="field-options">
                {(f.options ?? []).map((o) => (
                  <div key={o.id} className="field-option-row">
                    <select
                      value={o.color}
                      onChange={(e) => set(f.id, { options: f.options!.map((x) => (x.id === o.id ? { ...x, color: e.target.value } : x)) })}
                      style={{ background: LABEL_COLORS[o.color] }}
                      className="color-select"
                      aria-label="Choice colour"
                    >
                      {Object.keys(LABEL_COLORS).map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    <input
                      defaultValue={o.label}
                      placeholder="Choice"
                      onBlur={(e) => e.target.value.trim() && e.target.value !== o.label && set(f.id, { options: f.options!.map((x) => (x.id === o.id ? { ...x, label: e.target.value.trim() } : x)) })}
                      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    />
                    <button
                      className="icon-btn"
                      aria-label={`Remove ${o.label}`}
                      onClick={() => set(f.id, { options: f.options!.filter((x) => x.id !== o.id) })}
                      disabled={(f.options ?? []).length <= 1}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
                <button
                  className="link-btn"
                  onClick={() => {
                    const used = new Set((f.options ?? []).map((o) => o.color));
                    const color = Object.keys(LABEL_COLORS).find((c) => !used.has(c)) ?? 'gray';
                    set(f.id, { options: [...(f.options ?? []), { id: uid(), label: `Option ${(f.options ?? []).length + 1}`, color }] });
                  }}
                >
                  + Add choice
                </button>
              </div>
            )}
          </div>
        );
      })}

      <form
        className="field-new"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <h5>New field</h5>
        <input autoFocus={fields.length === 0} placeholder="Field name, e.g. Budget" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="field-type-pick" role="radiogroup" aria-label="Field type">
          {FIELD_TYPES.map((t) => {
            const Icon = FIELD_ICONS[t.value];
            return (
              <button
                type="button"
                key={t.value}
                role="radio"
                aria-checked={type === t.value}
                title={FIELD_HINTS[t.value]}
                className={`field-type-btn ${type === t.value ? 'on' : ''}`}
                onClick={() => setType(t.value)}
              >
                <Icon size={15} /> {t.label}
              </button>
            );
          })}
        </div>
        <p className="muted field-type-hint">{FIELD_HINTS[type]}</p>
        <button className="btn primary full" disabled={!name.trim()}>
          Add field
        </button>
      </form>
    </div>
  );
}

/** A text-like box that saves when you leave it (or press Enter). */
function TextBox({
  value,
  ro,
  type = 'text',
  multiline,
  placeholder,
  prefix,
  link,
  parse,
  onSet,
}: {
  value: FieldValue | undefined;
  ro: boolean;
  type?: string;
  multiline?: boolean;
  placeholder: string;
  prefix?: string;
  /** Turns the saved value into a link shown beside the box. */
  link?: (v: string) => string;
  /** Number fields: turns the text into a number (null = invalid). */
  parse?: (t: string) => number | null;
  onSet: (v: FieldValue | null) => void;
}) {
  const shown = value === undefined ? '' : String(value);
  const [text, setText] = useState(shown);
  useEffect(() => setText(shown), [shown]);
  const commit = () => {
    const t = multiline ? text.replace(/\s+$/, '') : text.trim();
    if (t === shown) return;
    if (!t) return onSet(null);
    if (parse) {
      const n = parse(t);
      if (n === null) return setText(shown);
      if (n !== value) onSet(n);
      return;
    }
    onSet(t);
  };
  const common = {
    className: `field-input ${prefix ? 'has-prefix' : ''}`,
    readOnly: ro,
    placeholder: ro ? '' : placeholder,
    value: text,
    onBlur: commit,
  };
  return (
    <div className="field-box">
      {prefix && <span className="field-prefix">{prefix}</span>}
      {multiline ? (
        <textarea {...common} rows={Math.min(8, Math.max(3, text.split('\n').length))} onChange={(e) => setText(e.target.value)} />
      ) : (
        <input
          {...common}
          type={type}
          inputMode={parse ? 'decimal' : undefined}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
        />
      )}
      {link && shown && (
        <a className="field-open" href={link(shown)} target="_blank" rel="noreferrer noopener" title="Open" aria-label="Open">
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );
}

const toNumber = (t: string) => {
  const n = Number(t.replace(/[, ]/g, ''));
  return Number.isFinite(n) ? n : null;
};

/** One field's input inside the card window. */
function FieldInput({ f, value, ro, people, onSet }: { f: CustomField; value: FieldValue | undefined; ro: boolean; people: Person[]; onSet: (v: FieldValue | null) => void }) {
  switch (f.type) {
    case 'checkbox':
      return (
        <label className="field-check">
          <input type="checkbox" disabled={ro} checked={value === true} onChange={(e) => onSet(e.target.checked)} />
          <span>{value === true ? 'Yes' : 'No'}</span>
        </label>
      );
    case 'dropdown': {
      const opt = f.options?.find((o) => o.id === value);
      return (
        <label className="field-select" style={opt ? { background: LABEL_COLORS[opt.color], color: '#172b4d', borderColor: 'transparent' } : undefined}>
          <select disabled={ro} value={opt ? opt.id : ''} onChange={(e) => onSet(e.target.value || null)}>
            <option value="">Select…</option>
            {(f.options ?? []).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
          <ChevronDown size={14} />
        </label>
      );
    }
    case 'multiselect': {
      const on = list(value);
      return (
        <div className="field-multi">
          {(f.options ?? []).map((o) => {
            const sel = on.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                disabled={ro}
                aria-pressed={sel}
                className={`field-multi-opt ${sel ? 'on' : ''}`}
                style={sel ? { background: LABEL_COLORS[o.color], borderColor: LABEL_COLORS[o.color] } : undefined}
                onClick={() => onSet(sel ? on.filter((x) => x !== o.id) : [...on, o.id])}
              >
                {sel && '✓ '}
                {o.label}
              </button>
            );
          })}
        </div>
      );
    }
    case 'person': {
      const on = list(value);
      return (
        <div className="field-multi">
          {people.map((p) => {
            const sel = on.includes(p.user_id);
            if (ro && !sel) return null;
            return (
              <button
                key={p.user_id}
                type="button"
                disabled={ro}
                aria-pressed={sel}
                className={`field-person ${sel ? 'on' : ''}`}
                title={sel ? `Remove ${p.name}` : `Add ${p.name}`}
                onClick={() => onSet(sel ? on.filter((x) => x !== p.user_id) : [...on, p.user_id])}
              >
                <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={20} />
                {p.name.split(' ')[0]}
              </button>
            );
          })}
          {people.length === 0 && <span className="muted small-hint">No board members yet</span>}
        </div>
      );
    }
    case 'rating': {
      const n = typeof value === 'number' ? value : 0;
      return (
        <div className="field-rating" role="radiogroup" aria-label={f.name}>
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} type="button" disabled={ro} role="radio" aria-checked={n === i} aria-label={`${i} star${i > 1 ? 's' : ''}`} className={i <= n ? 'on' : ''} onClick={() => onSet(n === i ? null : i)}>
              <Star size={20} fill={i <= n ? 'currentColor' : 'none'} />
            </button>
          ))}
        </div>
      );
    }
    case 'date':
      return <input className="field-input" type="date" readOnly={ro} disabled={ro} value={typeof value === 'string' ? value : ''} onChange={(e) => onSet(e.target.value || null)} />;
    case 'number':
      return <TextBox value={value} ro={ro} placeholder="Add a number…" parse={toNumber} onSet={onSet} />;
    case 'currency':
      return <TextBox value={value} ro={ro} placeholder="0" prefix={f.currency ?? 'AED'} parse={toNumber} onSet={onSet} />;
    case 'longtext':
      return <TextBox value={value} ro={ro} multiline placeholder="Add notes…" onSet={onSet} />;
    case 'url':
      return <TextBox value={value} ro={ro} type="url" placeholder="https://…" link={(v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`)} onSet={onSet} />;
    case 'email':
      return <TextBox value={value} ro={ro} type="email" placeholder="name@example.com" link={(v) => `mailto:${v}`} onSet={onSet} />;
    case 'phone':
      return <TextBox value={value} ro={ro} type="tel" placeholder="+971 …" link={(v) => `tel:${v.replace(/[^\d+]/g, '')}`} onSet={onSet} />;
    default:
      return <TextBox value={value} ro={ro} placeholder="Add text…" onSet={onSet} />;
  }
}

/** The "Custom fields" section inside a card. */
export function CardFields({
  card,
  fields,
  people,
  ro,
  dispatch,
  onManage,
}: {
  card: Card;
  fields: CustomField[];
  people: Person[];
  ro: boolean;
  dispatch: (a: BoardActionBody) => void;
  onManage?: () => void;
}) {
  if (fields.length === 0) return null;
  const wide = (t: FieldType) => t === 'longtext' || t === 'multiselect' || t === 'person';
  return (
    <section className="cw-section">
      <div className="cw-section-head">
        <SlidersHorizontal size={20} />
        <h4>Custom fields</h4>
        {onManage && (
          <button className="btn" onClick={onManage}>
            Edit fields
          </button>
        )}
      </div>
      <div className="cw-indent card-fields">
        {fields.map((f) => {
          const Icon = FIELD_ICONS[f.type] ?? Type;
          return (
            <div key={f.id} className={`card-field ${wide(f.type) ? 'wide' : ''}`}>
              <span className="card-field-name">
                <Icon size={13} /> {f.name}
              </span>
              <FieldInput f={f} value={card.fields?.[f.id]} ro={ro} people={people} onSet={(value) => dispatch({ type: 'SET_FIELD_VALUE', cardId: card.id, fieldId: f.id, value })} />
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** Small chips on the card face for fields marked "show on card". */
export function CardFieldChips({ card, fields, people }: { card: Card; fields: CustomField[] | undefined; people?: Map<string, Person> }) {
  const shown = (fields ?? []).filter((f) => f.showOnCard && fieldText(f, card.fields?.[f.id], people));
  if (shown.length === 0) return null;
  return (
    <div className="card-field-chips">
      {shown.map((f) => {
        const v = card.fields?.[f.id];
        const text = fieldText(f, v, people);
        if (f.type === 'multiselect')
          return list(v).map((id) => {
            const o = f.options?.find((x) => x.id === id);
            return o ? (
              <span key={f.id + id} className="card-field-chip" style={{ background: LABEL_COLORS[o.color] + '55' }} title={`${f.name}: ${o.label}`}>
                {o.label}
              </span>
            ) : null;
          });
        const opt = f.type === 'dropdown' ? f.options?.find((o) => o.id === v) : undefined;
        return (
          <span key={f.id} className={`card-field-chip ${f.type === 'rating' ? 'rating' : ''}`} style={opt ? { background: LABEL_COLORS[opt.color] + '55' } : undefined} title={`${f.name}: ${text}`}>
            {f.type === 'checkbox' ? (
              <>✓ {f.name}</>
            ) : (
              <>
                <span className="cfc-name">{f.name}:</span> {text}
              </>
            )}
          </span>
        );
      })}
    </div>
  );
}
