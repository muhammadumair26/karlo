import { ArrowRightLeft, Download, Lock, Paperclip, Pencil, Plus, Receipt, Search, Settings2, Trash2, Wallet, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  balances,
  CATEGORIES,
  CURRENCIES,
  deleteExpense,
  money,
  monthLabel,
  monthly,
  receiptUrl,
  saveExpense,
  saveSettings,
  settleUp,
  sharingPartners,
  shareFractions,
  spending,
  total,
  totalsBy,
  toCsv,
  uploadReceipt,
  type Expense,
  type ExpenseInput,
  type ExpenseSettings,
  type Partner,
} from '../lib/expenses';
import type { BoardData, Me, Person } from '../lib/types';
import { Avatar, download, Modal } from './ui';
import { askConfirm, showAlert } from './dialog';

export type ExpensesState = {
  expenses: Expense[];
  settings: ExpenseSettings | null;
  loaded: boolean;
  allowed: boolean;
};

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const shortDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Opens a private receipt in a new tab (signed link, valid 1 hour). */
async function openReceipt(path: string) {
  const w = window.open('', '_blank');
  const url = await receiptUrl(path);
  if (w && url) w.location.href = url;
  else w?.close();
}

// ---------------------------------------------------------------- the view

export function ExpensesView({
  boardId,
  boardTitle,
  isOwner,
  state,
  data,
  people,
  me,
  onOpenCard,
}: {
  boardId: string;
  boardTitle: string;
  isOwner: boolean;
  state: ExpensesState;
  data: BoardData;
  people: Map<string, Person>;
  me: Me;
  onOpenCard: (id: string) => void;
}) {
  const { expenses, settings, loaded } = state;
  const [form, setForm] = useState<null | { edit?: Expense; preset?: Partial<ExpenseInput> }>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [month, setMonth] = useState('');
  const [category, setCategory] = useState('');
  const [payer, setPayer] = useState('');
  const [q, setQ] = useState('');

  if (!loaded) return <div className="dashboard"><div className="ex-empty">Loading expenses…</div></div>;
  if (!settings) return <ExpenseSetup boardId={boardId} isOwner={isOwner} people={people} me={me} />;

  const cur = settings.currency;
  const nameOf = (id: string | null) => (id ? people.get(id)?.name ?? 'Former partner' : 'Company account');
  const partnerIds = settings.partners.map((p) => p.id);
  const frac = shareFractions(settings.partners);
  const splitLabel = settings.partners.map((p) => Math.round((frac.get(p.id) ?? 0) * 100)).join('/');
  // Just one person tracking costs: no split, no who-owes-whom.
  const solo = sharingPartners(settings.partners).length <= 1;

  // Filters (summary tiles, charts and table all follow them; balances always use everything).
  const months = [...new Set(expenses.map((e) => e.spent_on.slice(0, 7)))].sort().reverse();
  const cats = [...new Set([...CATEGORIES, ...expenses.map((e) => e.category)])];
  const ql = q.trim().toLowerCase();
  const shown = expenses.filter(
    (e) =>
      (!month || e.spent_on.startsWith(month)) &&
      (!category || (e.kind === 'expense' && e.category === category)) &&
      (!payer || (payer === 'company' ? !e.paid_by : e.paid_by === payer)) &&
      (!ql || `${e.title} ${e.note} ${e.category}`.toLowerCase().includes(ql)),
  );
  const filtered = !!(month || category || payer || ql);

  const spent = total(shown);
  const allSpent = total(expenses);
  const thisMonth = total(expenses.filter((e) => e.spent_on.startsWith(today().slice(0, 7))));
  const budget = settings.budget;
  const used = budget ? allSpent / budget : 0;

  const bal = balances(expenses, solo ? settings.partners : sharingPartners(settings.partners));
  const settle = settleUp(bal);
  const byCat = totalsBy(shown, (e) => e.category);
  const byMonth = monthly(shown.length ? shown : expenses, 12);
  const maxCat = Math.max(...byCat.map((c) => c.value), 1);
  const maxMonth = Math.max(...byMonth.map((m) => m.value), 1);

  const cardTitle = (id: string | null) => (id ? data.cards[id]?.title ?? '' : '');
  const exportCsv = () =>
    download(`${boardTitle.replace(/[^\w-]+/g, '-')}-expenses${month ? '-' + month : ''}.csv`, toCsv(shown, nameOf, cardTitle, cur), 'text/csv');

  const remove = async (e: Expense) => {
    if (!(await askConfirm({ title: `Delete “${e.title || 'this payment'}”?`, message: <>{money(e.amount, cur)} on {shortDate(e.spent_on)} is removed{e.receipt_path ? ', with its receipt' : ''}. This cannot be undone.</>, confirmLabel: 'Delete', tone: 'danger' }))) return;
    try {
      await deleteExpense(e);
    } catch (err) {
      void showAlert({ title: "Couldn't delete", message: (err as Error).message, tone: 'danger' });
    }
  };

  return (
    <div className="dashboard expenses">
      <div className="ex-toolbar">
        <div className="ex-title">
          <Wallet size={18} /> Expenses
          <span className="ex-private" title={`Only ${settings.partners.map((p) => nameOf(p.id)).join(' and ')} can see this`}>
            <Lock size={12} /> {settings.partners.length <= 1 ? 'Private · only you' : `Private · ${settings.partners.length} people`}
          </span>
        </div>
        <span className="header-spacer" />
        <button className="btn translucent" onClick={exportCsv} disabled={!shown.length}>
          <Download size={15} /> Export CSV
        </button>
        <button className="btn translucent" onClick={() => setShowSettings(true)}>
          <Settings2 size={15} /> {solo ? 'Budget & settings' : 'Budget & partners'}
        </button>
        <button className="btn primary" onClick={() => setForm({})}>
          <Plus size={15} /> Add expense
        </button>
      </div>

      <div className="stat-row ex-stats">
        <div className="stat">
          <span className="stat-num">{money(spent, cur)}</span>
          <span className="stat-label">{filtered ? 'Spent (filtered)' : 'Total spent'}</span>
        </div>
        <div className="stat">
          <span className="stat-num">{money(thisMonth, cur)}</span>
          <span className="stat-label">This month</span>
        </div>
        {budget ? (
          <div className={`stat ex-budget ${used >= 1 ? 'bad' : used >= 0.8 ? 'warn' : ''}`}>
            <span className="stat-num">{money(Math.abs(budget - allSpent), cur)}</span>
            <span className="stat-label">
              {allSpent > budget ? 'Over budget' : 'Left of'} {money(budget, cur)} budget · {Math.round(used * 100)}% used
            </span>
            <span className="ex-meter" aria-hidden>
              <span style={{ width: `${Math.min(used, 1) * 100}%` }} />
            </span>
          </div>
        ) : (
          <button className="stat" onClick={() => setShowSettings(true)}>
            <span className="stat-num">—</span>
            <span className="stat-label">Set a budget</span>
          </button>
        )}
        <div className="stat">
          <span className="stat-num">{spending(shown).length}</span>
          <span className="stat-label">Expenses</span>
        </div>
      </div>

      <div className="dash-grid ex-grid">
        {!solo && (
        <section className="dash-card ex-partners">
          <div className="dash-card-head">
            <h4>Partners · who owes whom</h4>
          </div>
          {bal.map((b) => {
            const p = people.get(b.id);
            return (
              <div key={b.id} className="ex-partner">
                <Avatar id={b.id} name={nameOf(b.id)} src={p?.avatar_url} size={34} />
                <div className="ex-partner-text">
                  <strong>
                    {nameOf(b.id)}
                    {b.id === me.id ? ' (you)' : ''}
                  </strong>
                  <span className="muted">
                    {Math.round((frac.get(b.id) ?? 0) * 100)}% share · paid {money(b.paid, cur)}
                  </span>
                </div>
                <span className={`ex-balance ${b.balance > 0 ? 'pos' : b.balance < 0 ? 'neg' : ''}`}>
                  {b.balance > 0 ? `is owed ${money(b.balance, cur)}` : b.balance < 0 ? `owes ${money(-b.balance, cur)}` : 'all even'}
                </span>
              </div>
            );
          })}
          {settle.length > 0 ? (
            settle.map((s) => (
              <div key={s.from + s.to} className="ex-settle">
                <ArrowRightLeft size={15} />
                <span>
                  <strong>{nameOf(s.from)}</strong> should pay <strong>{nameOf(s.to)}</strong> {money(s.amount, cur)}
                </span>
                <button
                  className="btn small"
                  onClick={() => setForm({ preset: { kind: 'settlement', paid_by: s.from, paid_to: s.to, amount: s.amount, title: 'Settle up' } })}
                >
                  Record payment
                </button>
              </div>
            ))
          ) : (
            <p className="muted ex-hint">Shared expenses paid personally are split {splitLabel}. Everyone is even right now.</p>
          )}
        </section>
        )}

        <section className="dash-card">
          <div className="dash-card-head">
            <h4>Spend by category</h4>
          </div>
          {byCat.length ? (
            <div className="ex-hbars">
              {byCat.map((c) => (
                <button key={c.key} className={`ex-hbar ${category === c.key ? 'on' : ''}`} onClick={() => setCategory(category === c.key ? '' : c.key)} title={`${c.key}: ${money(c.value, cur)} — click to filter`}>
                  <span className="ex-hbar-label">{c.key}</span>
                  <span className="ex-hbar-track">
                    <span className="ex-hbar-fill" style={{ width: `${(c.value / maxCat) * 100}%` }} />
                  </span>
                  <span className="ex-hbar-value">{money(c.value, cur)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted ex-hint">No expenses yet.</p>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h4>Spend per month</h4>
          </div>
          <div className="ex-vbars" role="img" aria-label="Spend per month for the last 12 months">
            {byMonth.map((m) => (
              <button
                key={m.month}
                className={`ex-vbar ${month === m.month ? 'on' : ''}`}
                onClick={() => setMonth(month === m.month ? '' : m.month)}
                title={`${monthLabel(m.month, true)}: ${money(m.value, cur)} — click to filter`}
              >
                <span className="ex-vbar-col">
                  <span className="ex-vbar-fill" style={{ height: `${(m.value / maxMonth) * 100}%` }} />
                </span>
                <span className="ex-vbar-label">{monthLabel(m.month)}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="ex-table-card">
        <div className="ex-filters">
          <label className="ex-search">
            <Search size={15} />
            <input placeholder="Search expenses" value={q} onChange={(e) => setQ(e.target.value)} />
          </label>
          <select className="field-select" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            <option value="">All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, true)}
              </option>
            ))}
          </select>
          <select className="field-select" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="field-select" value={payer} onChange={(e) => setPayer(e.target.value)} aria-label="Paid by">
            <option value="">Anyone paid</option>
            {partnerIds.map((id) => (
              <option key={id} value={id}>
                Paid by {nameOf(id)}
              </option>
            ))}
            <option value="company">Company account</option>
          </select>
          {filtered && (
            <button className="btn ghost small" onClick={() => (setMonth(''), setCategory(''), setPayer(''), setQ(''))}>
              <X size={14} /> Clear
            </button>
          )}
        </div>
        <div className="tv-scroll">
          <table className="tv ex-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>What</th>
                <th>Category</th>
                <th>Paid by</th>
                <th className="num">Amount</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {shown.map((e) => (
                <tr key={e.id} className={e.kind === 'settlement' ? 'ex-row-settle' : ''}>
                  <td className="muted">{shortDate(e.spent_on)}</td>
                  <td>
                    <div className="ex-what">
                      <span className="ex-what-title">
                        {e.kind === 'settlement' ? `${nameOf(e.paid_by)} paid ${nameOf(e.paid_to)}` : e.title || 'Untitled'}
                        {e.receipt_path && (
                          <button className="ex-receipt" onClick={() => openReceipt(e.receipt_path!)} title={`Open receipt: ${e.receipt_name}`}>
                            <Paperclip size={13} />
                          </button>
                        )}
                      </span>
                      <span className="ex-what-sub">
                        {e.card_id && data.cards[e.card_id] && (
                          <button className="ex-card-link" onClick={() => onOpenCard(e.card_id!)}>
                            {data.cards[e.card_id].title}
                          </button>
                        )}
                        {!solo && e.kind === 'expense' && e.paid_by && !e.shared && <span className="ex-tag">Not split</span>}
                        {e.note && <span className="muted">{e.note}</span>}
                      </span>
                    </div>
                  </td>
                  <td>{e.kind === 'settlement' ? <span className="ex-tag">Partner payment</span> : e.category}</td>
                  <td>
                    <span className="tv-creator">
                      {e.paid_by ? <Avatar id={e.paid_by} name={nameOf(e.paid_by)} src={people.get(e.paid_by)?.avatar_url} size={22} /> : <Wallet size={16} className="muted" />}
                      <span>{nameOf(e.paid_by)}</span>
                    </span>
                  </td>
                  <td className="num">
                    <strong>{money(e.amount, cur)}</strong>
                  </td>
                  <td className="ex-actions">
                    <button className="icon-btn" onClick={() => setForm({ edit: e })} aria-label="Edit" title="Edit">
                      <Pencil size={15} />
                    </button>
                    <button className="icon-btn" onClick={() => remove(e)} aria-label="Delete" title="Delete">
                      <Trash2 size={15} />
                    </button>
                  </td>
                </tr>
              ))}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted empty-row">
                    {expenses.length ? 'No expenses match these filters.' : 'No expenses yet — press “Add expense” to record the first one.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {form && (
        <ExpenseForm
          boardId={boardId}
          settings={settings}
          data={data}
          people={people}
          me={me}
          edit={form.edit}
          preset={form.preset}
          categories={cats}
          onClose={() => setForm(null)}
        />
      )}
      {showSettings && <SettingsModal settings={settings} people={people} me={me} onClose={() => setShowSettings(false)} />}
    </div>
  );
}

// ---------------------------------------------------------------- first-time setup

function ExpenseSetup({ boardId, isOwner, people, me }: { boardId: string; isOwner: boolean; people: Map<string, Person>; me: Me }) {
  const [partners, setPartners] = useState<string[]>([me.id]);
  const [currency, setCurrency] = useState('AED');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!isOwner)
    return (
      <div className="dashboard">
        <div className="ex-empty">
          <Lock size={28} />
          <h3>Expenses are private</h3>
          <p className="muted">Only the project partners can see this board's expenses.</p>
        </div>
      </div>
    );
  const others = [...people.values()].filter((p) => p.user_id !== me.id);
  return (
    <div className="dashboard">
      <div className="ex-empty ex-setup">
        <Wallet size={28} />
        <h3>Track this project's expenses</h3>
        <p className="muted">Pick the partners who share the costs. Only they will see the expenses — not other board members, even admins.</p>
        <div className="ex-setup-list">
          <label className="member-option on">
            <input type="checkbox" checked disabled /> <Avatar id={me.id} name={me.name} src={me.avatar_url} size={26} /> {me.name} (you)
          </label>
          {others.map((p) => (
            <label key={p.user_id} className="member-option">
              <input
                type="checkbox"
                checked={partners.includes(p.user_id)}
                onChange={(e) => setPartners(e.target.checked ? [...partners, p.user_id] : partners.filter((x) => x !== p.user_id))}
              />
              <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={26} /> {p.name}
            </label>
          ))}
        </div>
        <label className="pop-field">
          Currency
          <select className="field-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        {err && <div className="auth-error">{err}</div>}
        <button
          className="btn primary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setErr(null);
            try {
              const share = Math.round((100 / partners.length) * 100) / 100;
              await saveSettings({ board_id: boardId, currency, budget: null, partners: partners.map((id) => ({ id, share })) });
            } catch (e) {
              setErr((e as Error).message);
              setBusy(false);
            }
          }}
        >
          Start tracking expenses
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- add / edit

export function ExpenseForm({
  boardId,
  settings,
  data,
  people,
  me,
  edit,
  preset,
  categories = CATEGORIES,
  onClose,
}: {
  boardId: string;
  settings: ExpenseSettings;
  data: BoardData;
  people: Map<string, Person>;
  me: Me;
  edit?: Expense;
  preset?: Partial<ExpenseInput>;
  categories?: string[];
  onClose: () => void;
}) {
  const partnerIds = settings.partners.map((p) => p.id);
  const base: ExpenseInput = edit ?? {
    kind: 'expense',
    title: '',
    amount: 0,
    category: 'Other',
    spent_on: today(),
    paid_by: partnerIds.includes(me.id) ? me.id : partnerIds[0] ?? null,
    paid_to: null,
    shared: true,
    card_id: null,
    note: '',
    receipt_path: null,
    receipt_name: null,
    ...preset,
  };
  const [f, setF] = useState<ExpenseInput>(base);
  const [amount, setAmount] = useState(base.amount ? String(base.amount) : '');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<ExpenseInput>) => setF({ ...f, ...p });
  const nameOf = (id: string) => people.get(id)?.name ?? (id === me.id ? me.name : 'Former partner');
  const settle = f.kind === 'settlement';
  const cards = useMemo(
    () =>
      data.listOrder
        .filter((l) => !data.lists[l].archived)
        .flatMap((l) => data.lists[l].cardIds.map((id) => data.cards[id]).filter((c) => c && !c.archived)),
    [data],
  );

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const n = Number(amount.replace(/,/g, ''));
    if (!(n > 0)) return setErr('Enter an amount greater than 0.');
    if (settle && (!f.paid_by || !f.paid_to || f.paid_by === f.paid_to)) return setErr('Pick two different partners.');
    setBusy(true);
    setErr(null);
    try {
      let receipt = { receipt_path: f.receipt_path, receipt_name: f.receipt_name };
      if (file) {
        const up = await uploadReceipt(boardId, file);
        receipt = { receipt_path: up.path, receipt_name: up.name };
      }
      await saveExpense(
        boardId,
        {
          ...f,
          ...receipt,
          amount: Math.round(n * 100) / 100,
          title: settle ? f.title || 'Settle up' : f.title.trim(),
          category: settle ? 'Partner payment' : f.category.trim() || 'Other',
          paid_to: settle ? f.paid_to : null,
          // Solo: never split, so adding a partner later doesn't turn old costs into debts.
          shared: settle || sharingPartners(settings.partners).length < 2 ? false : f.shared,
          card_id: settle ? null : f.card_id,
        },
        edit?.id,
      );
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={edit ? 'Edit' : settle ? 'Record a partner payment' : 'Add expense'} onClose={onClose}>
      <form className="ex-form" onSubmit={submit}>
        {!edit && sharingPartners(settings.partners).length > 1 && (
          <div className="auth-tabs" role="tablist">
            <button type="button" className={!settle ? 'on' : ''} onClick={() => set({ kind: 'expense' })}>
              <Receipt size={14} /> Expense
            </button>
            <button type="button" className={settle ? 'on' : ''} onClick={() => set({ kind: 'settlement', paid_by: f.paid_by ?? me.id, paid_to: partnerIds.find((id) => id !== (f.paid_by ?? me.id)) ?? null })}>
              <ArrowRightLeft size={14} /> Partner payment
            </button>
          </div>
        )}
        {!settle && (
          <label className="pop-field">
            What was it for?
            <input autoFocus required placeholder="e.g. Shopify plan, logo design, trade licence" value={f.title} onChange={(e) => set({ title: e.target.value })} />
          </label>
        )}
        <div className="ex-form-row">
          <label className="pop-field">
            Amount ({settings.currency})
            <input required inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} autoFocus={settle} />
          </label>
          <label className="pop-field">
            Date
            <input type="date" required value={f.spent_on} onChange={(e) => set({ spent_on: e.target.value })} />
          </label>
        </div>
        {settle ? (
          <div className="ex-form-row">
            <label className="pop-field">
              From
              <select className="field-select" value={f.paid_by ?? ''} onChange={(e) => set({ paid_by: e.target.value })}>
                {partnerIds.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            </label>
            <label className="pop-field">
              To
              <select className="field-select" value={f.paid_to ?? ''} onChange={(e) => set({ paid_to: e.target.value })}>
                {partnerIds.map((id) => (
                  <option key={id} value={id}>
                    {nameOf(id)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <>
            <div className="ex-form-row">
              <label className="pop-field">
                Category
                <input list="ex-cats" value={f.category} onChange={(e) => set({ category: e.target.value })} placeholder="Pick or type a new one" />
                <datalist id="ex-cats">
                  {categories.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="pop-field">
                Paid by
                <select className="field-select" value={f.paid_by ?? ''} onChange={(e) => set({ paid_by: e.target.value || null })}>
                  {partnerIds.map((id) => (
                    <option key={id} value={id}>
                      {nameOf(id)}
                      {id === me.id ? ' (you)' : ''}
                    </option>
                  ))}
                  <option value="">Company account</option>
                </select>
              </label>
            </div>
            {f.paid_by && sharingPartners(settings.partners).length > 1 && (
              <label className="ex-check">
                <input type="checkbox" checked={f.shared} onChange={(e) => set({ shared: e.target.checked })} />
                Business cost — split between partners ({settings.partners.map((p) => `${nameOf(p.id).split(/[\s.]/)[0]} ${Math.round((shareFractions(settings.partners).get(p.id) ?? 0) * 100)}%`).join(', ')})
              </label>
            )}
            <label className="pop-field">
              Related card (optional)
              <select className="field-select" value={f.card_id ?? ''} onChange={(e) => set({ card_id: e.target.value || null })}>
                <option value="">— None —</option>
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
            </label>
          </>
        )}
        <label className="pop-field">
          Note (optional)
          <input value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder={settle ? 'e.g. Bank transfer' : 'e.g. Invoice #1043'} />
        </label>
        {!settle && (
          <div className="pop-field">
            Receipt (optional)
            {f.receipt_path && !file ? (
              <span className="ex-file">
                <Paperclip size={14} />
                <button type="button" className="ex-card-link" onClick={() => openReceipt(f.receipt_path!)}>
                  {f.receipt_name}
                </button>
                <button type="button" className="icon-btn" onClick={() => set({ receipt_path: null, receipt_name: null })} aria-label="Remove receipt">
                  <X size={14} />
                </button>
              </span>
            ) : (
              <input type="file" accept="image/*,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
            )}
          </div>
        )}
        {err && <div className="auth-error">{err}</div>}
        <div className="ex-form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Saving…' : edit ? 'Save' : settle ? 'Record payment' : 'Add expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- budget & partners

function SettingsModal({ settings, people, me, onClose }: { settings: ExpenseSettings; people: Map<string, Person>; me: Me; onClose: () => void }) {
  const [currency, setCurrency] = useState(settings.currency);
  const [budget, setBudget] = useState(settings.budget ? String(settings.budget) : '');
  const [partners, setPartners] = useState<Partner[]>(settings.partners);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameOf = (id: string) => people.get(id)?.name ?? (id === me.id ? me.name : 'Former partner');
  const addable = [...people.values()].filter((p) => !partners.some((x) => x.id === p.user_id));
  const sum = partners.reduce((n, p) => n + (Number(p.share) || 0), 0);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const b = Number(budget.replace(/,/g, ''));
      await saveSettings({ ...settings, currency, budget: budget.trim() && b > 0 ? b : null, partners: partners.map((p) => ({ id: p.id, share: Number(p.share) || 0 })) });
      onClose();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Budget & partners" onClose={onClose}>
      <div className="ex-form">
        <div className="ex-form-row">
          <label className="pop-field">
            Total budget (optional)
            <input inputMode="decimal" placeholder="e.g. 50000" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ''))} />
          </label>
          <label className="pop-field">
            Currency
            <select className="field-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="pop-field">
          Partners and their share of costs
          {partners.map((p, i) => (
            <div key={p.id} className="ex-partner-edit">
              <Avatar id={p.id} name={nameOf(p.id)} src={people.get(p.id)?.avatar_url} size={26} />
              <span className="ex-partner-name">{nameOf(p.id)}</span>
              <input
                inputMode="decimal"
                value={String(p.share)}
                onChange={(e) => setPartners(partners.map((x, j) => (j === i ? { ...x, share: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } : x)))}
                aria-label={`${nameOf(p.id)} share`}
              />
              <span className="muted">%</span>
              <button
                className="icon-btn"
                disabled={p.id === me.id}
                title={p.id === me.id ? "You can't remove yourself" : `Remove ${nameOf(p.id)} — they will no longer see expenses`}
                onClick={() => setPartners(partners.filter((x) => x.id !== p.id))}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          <span className="muted ex-share-hint">0% = can see and add costs, but isn't part of the cost split.</span>
          {Math.round(sum) !== 100 && <span className="ex-warn">Shares add up to {sum}% — costs are split in proportion, so that's fine, but 100% is clearest.</span>}
          {addable.length > 0 && (
            <select className="field-select" value="" onChange={(e) => e.target.value && setPartners([...partners, { id: e.target.value, share: 0 }])}>
              <option value="">+ Add a partner (they will see all expenses)</option>
              {addable.map((p) => (
                <option key={p.user_id} value={p.user_id}>
                  {p.name}
                </option>
              ))}
            </select>
          )}
        </div>
        {err && <div className="auth-error">{err}</div>}
        <div className="ex-form-actions">
          <button type="button" className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------- inside a card

/** Partners only: what was spent on this card, and an "add expense" shortcut. */
export function CardExpenses({
  boardId,
  cardId,
  state,
  data,
  people,
  me,
  adding,
  onAddingChange,
}: {
  boardId: string;
  cardId: string;
  state: ExpensesState;
  data: BoardData;
  people: Map<string, Person>;
  me: Me;
  adding: boolean;
  onAddingChange: (v: boolean) => void;
}) {
  const [edit, setEdit] = useState<Expense | null>(null);
  if (!state.settings) return null;
  const cur = state.settings.currency;
  const mine = state.expenses.filter((e) => e.card_id === cardId && e.kind === 'expense');
  const nameOf = (id: string | null) => (id ? people.get(id)?.name ?? 'Former partner' : 'Company account');
  return (
    <>
      {mine.length > 0 && (
        <section className="cw-section">
          <div className="cw-section-head">
            <Wallet size={20} />
            <h4>
              Expenses · {money(total(mine), cur)}
            </h4>
            <span className="ex-private dark" title="Only the project partners see this">
              <Lock size={11} /> {state.settings.partners.length > 1 ? 'Private' : 'Only you'}
            </span>
            <button className="btn" onClick={() => onAddingChange(true)}>
              Add
            </button>
          </div>
          <div className="cx-list">
            {mine.map((e) => (
              <button key={e.id} className="cx-row" onClick={() => setEdit(e)} title="Edit expense">
                <span className="cx-title">
                  {e.title}
                  {e.receipt_path && <Paperclip size={12} />}
                </span>
                <span className="muted cx-meta">
                  {shortDate(e.spent_on)} · {e.category} · {nameOf(e.paid_by)}
                </span>
                <strong className="cx-amt">{money(e.amount, cur)}</strong>
              </button>
            ))}
          </div>
        </section>
      )}
      {(adding || edit) && (
        <ExpenseForm
          boardId={boardId}
          settings={state.settings}
          data={data}
          people={people}
          me={me}
          edit={edit ?? undefined}
          preset={{ card_id: cardId }}
          onClose={() => (setEdit(null), onAddingChange(false))}
        />
      )}
    </>
  );
}
