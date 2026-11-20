import {
  AlertTriangle,
  ArrowRightLeft,
  Coins,
  Download,
  FileText,
  Lock,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Receipt,
  Repeat,
  Search,
  Settings2,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  balances,
  budgetStatus,
  CATEGORIES,
  createRecurring,
  CURRENCIES,
  deleteExpense,
  deleteRecurring,
  fetchRate,
  FREQ_LABEL,
  inBase,
  INCOME_CATEGORIES,
  incomeOf,
  incomeTotal,
  money,
  monthLabel,
  monthlyFlow,
  perMonth,
  profit,
  receiptUrl,
  saveExpense,
  saveSettings,
  settleUp,
  sharingPartners,
  shareFractions,
  total,
  totalsBy,
  toCsv,
  updateRecurring,
  uploadReceipt,
  type Expense,
  type ExpenseInput,
  type ExpenseSettings,
  type Frequency,
  type Partner,
  type Recurring,
} from '../lib/expenses';
import type { BoardData, Me, Person } from '../lib/types';
import { askConfirm, showAlert } from './dialog';
import { Avatar, download, Modal } from './ui';

export type ExpensesState = {
  expenses: Expense[];
  settings: ExpenseSettings | null;
  recurring?: Recurring[];
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

/** "USD 39" plus "≈ AED 143" when the entry isn't in the main currency. */
function Amount({ e, main, sign }: { e: Pick<Expense, 'amount' | 'currency' | 'fx_rate'>; main: string; sign?: '+' | '' }) {
  const c = e.currency || main;
  return (
    <span className="ex-amount">
      <strong>
        {sign}
        {money(e.amount, c)}
      </strong>
      {c !== main && <span className="ex-conv">≈ {money(inBase(e), main)}</span>}
    </span>
  );
}

const PAGE_KEY = 'karlo-money-page-size';

/** Page buttons like 1 … 4 5 6 … 12 (0 = gap). */
export function pageNumbers(cur: number, total: number): number[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, cur - 1, cur, cur + 1].filter((n) => n >= 1 && n <= total));
  const list = [...set].sort((a, b) => a - b);
  const out: number[] = [];
  list.forEach((n, i) => {
    if (i && n - list[i - 1] > 1) out.push(0);
    out.push(n);
  });
  return out;
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
  const recurring = state.recurring ?? [];
  const [form, setForm] = useState<null | { edit?: Expense; preset?: Partial<ExpenseInput> }>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showReport, setShowReport] = useState(false);
  const [month, setMonth] = useState('');
  const [category, setCategory] = useState('');
  const [payer, setPayer] = useState('');
  const [type, setType] = useState<'' | 'expense' | 'income'>('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSizeState] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(PAGE_KEY)) || 10;
    } catch {
      return 10;
    }
  });
  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setPage(1);
    try {
      localStorage.setItem(PAGE_KEY, String(n));
    } catch {
      /* ignore */
    }
  };

  if (!loaded) return <div className="dashboard"><div className="ex-empty">Loading money…</div></div>;
  if (!settings) return <ExpenseSetup boardId={boardId} isOwner={isOwner} people={people} me={me} />;

  const cur = settings.currency;
  const nameOf = (id: string | null) => (id ? people.get(id)?.name ?? 'Former partner' : 'Company account');
  const partnerIds = settings.partners.map((p) => p.id);
  const frac = shareFractions(settings.partners);
  const splitLabel = settings.partners.map((p) => Math.round((frac.get(p.id) ?? 0) * 100)).join('/');
  // Just one person tracking costs: no split, no who-owes-whom.
  const solo = sharingPartners(settings.partners).length <= 1;
  const thisMonthKey = today().slice(0, 7);

  // Filters (tiles, charts and table follow them; balances, budgets and recurring always use everything).
  const months = [...new Set(expenses.map((e) => e.spent_on.slice(0, 7)))].sort().reverse();
  const cats = [...new Set([...CATEGORIES, ...INCOME_CATEGORIES, ...expenses.map((e) => e.category)])];
  const ql = q.trim().toLowerCase();
  const shown = expenses.filter(
    (e) =>
      (!month || e.spent_on.startsWith(month)) &&
      (!category || (e.kind !== 'settlement' && e.category === category)) &&
      (!type || e.kind === type) &&
      (!payer || (payer === 'company' ? !e.paid_by : e.paid_by === payer)) &&
      (!ql || `${e.title} ${e.note} ${e.category} ${e.currency ?? ''}`.toLowerCase().includes(ql)),
  );
  const filtered = !!(month || category || payer || type || ql);
  // Pagination (any filter change goes back to page 1 — see the filter setters below).
  const pages = Math.max(1, Math.ceil(shown.length / pageSize));
  const curPage = Math.min(page, pages);
  const firstRow = (curPage - 1) * pageSize;
  const pageRows = shown.slice(firstRow, firstRow + pageSize);

  const spent = total(shown);
  const earned = incomeTotal(shown);
  const net = profit(shown);
  const allSpent = total(expenses);
  const budget = settings.budget;
  const used = budget ? allSpent / budget : 0;
  const budgets = budgetStatus(expenses, settings.category_budgets, thisMonthKey);
  const fixedMonthly = recurring.filter((r) => r.active && r.kind === 'expense').reduce((n, r) => n + perMonth(r), 0);

  const bal = balances(expenses, solo ? settings.partners : sharingPartners(settings.partners));
  const settle = settleUp(bal);
  const byCat = totalsBy(shown, (e) => e.category);
  const flow = monthlyFlow(shown.length ? shown : expenses, 12);
  const maxCat = Math.max(...byCat.map((c) => c.value), 1);
  const maxFlow = Math.max(...flow.map((m) => Math.max(m.spend, m.income)), 1);
  const hasIncome = expenses.some((e) => e.kind === 'income');
  const otherCurrencies = [...new Set(expenses.map((e) => e.currency).filter((c): c is string => !!c && c !== cur))];

  const cardTitle = (id: string | null) => (id ? data.cards[id]?.title ?? '' : '');
  const exportCsv = () =>
    download(`${boardTitle.replace(/[^\w-]+/g, '-')}-money${month ? '-' + month : ''}.csv`, toCsv(shown, nameOf, cardTitle, cur), 'text/csv');

  const remove = async (e: Expense) => {
    const what = e.kind === 'income' ? 'income' : e.kind === 'settlement' ? 'payment' : 'expense';
    if (
      !(await askConfirm({
        title: `Delete “${e.title || 'this ' + what}”?`,
        message: (
          <>
            {money(e.amount, e.currency || cur)} on {shortDate(e.spent_on)} is removed{e.receipt_path ? ', with its receipt' : ''}. This cannot be undone.
          </>
        ),
        confirmLabel: 'Delete',
        tone: 'danger',
      }))
    )
      return;
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
          <Wallet size={18} /> Money
          <span className="ex-private" title={`Only ${settings.partners.map((p) => nameOf(p.id)).join(' and ')} can see this`}>
            <Lock size={12} /> {settings.partners.length <= 1 ? 'Private · only you' : `Private · ${settings.partners.length} people`}
          </span>
        </div>
        <span className="header-spacer" />
        <button className="btn translucent" onClick={() => setShowReport(true)} disabled={!expenses.length}>
          <FileText size={15} /> Monthly report
        </button>
        <button className="btn translucent" onClick={exportCsv} disabled={!shown.length}>
          <Download size={15} /> Excel (CSV)
        </button>
        <button className="btn translucent" onClick={() => setShowSettings(true)}>
          <Settings2 size={15} /> Budgets & settings
        </button>
        <button className="btn translucent ex-income-btn" onClick={() => setForm({ preset: { kind: 'income', category: 'Sales' } })}>
          <TrendingUp size={15} /> Add income
        </button>
        <button className="btn primary" onClick={() => setForm({})}>
          <Plus size={15} /> Add expense
        </button>
      </div>

      <div className="stat-row ex-stats">
        <div className="stat ex-stat-in">
          <span className="stat-num">{money(earned, cur)}</span>
          <span className="stat-label">{filtered ? 'Income (filtered)' : 'Total income'}</span>
        </div>
        <div className="stat">
          <span className="stat-num">{money(spent, cur)}</span>
          <span className="stat-label">{filtered ? 'Costs (filtered)' : 'Total costs'}</span>
        </div>
        {hasIncome ? (
          <div className={`stat ex-profit ${net > 0 ? 'pos' : net < 0 ? 'neg' : ''}`}>
            <span className="stat-num">{money(net, cur)}</span>
            <span className="stat-label">
              {net >= 0 ? 'Profit' : 'Loss'} {filtered ? '(filtered)' : ''}
            </span>
          </div>
        ) : (
          // Before the first sale, costs are what you've put into the business — not a "loss".
          <div className="stat ex-invested" title="Shows profit or loss once you record your first income">
            <span className="stat-num">{money(spent, cur)}</span>
            <span className="stat-label">Invested so far {filtered ? '(filtered)' : ''}</span>
          </div>
        )}
        {budget ? (
          <div className={`stat ex-budget ${used >= 1 ? 'bad' : used >= 0.8 ? 'warn' : ''}`}>
            <span className="stat-num">{money(Math.abs(budget - allSpent), cur)}</span>
            <span className="stat-label">
              {allSpent > budget ? 'Over budget' : 'Left of'} {money(budget, cur)} · {Math.round(used * 100)}% used
            </span>
            <span className="ex-meter" aria-hidden>
              <span style={{ width: `${Math.min(used, 1) * 100}%` }} />
            </span>
          </div>
        ) : (
          <button className="stat" onClick={() => setShowSettings(true)}>
            <span className="stat-num">—</span>
            <span className="stat-label">Set a total budget</span>
          </button>
        )}
      </div>
      {otherCurrencies.length > 0 && (
        <p className="ex-fx-note">
          <Coins size={13} /> All totals in {cur}. Entries in {otherCurrencies.join(', ')} are converted at the rate saved with each entry.
        </p>
      )}

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
                  <button className="btn small" onClick={() => setForm({ preset: { kind: 'settlement', paid_by: s.from, paid_to: s.to, amount: s.amount, title: 'Settle up' } })}>
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
            <h4>Budgets · {monthLabel(thisMonthKey, true)}</h4>
            <button className="btn ghost small" onClick={() => setShowSettings(true)}>
              {budgets.length ? 'Edit' : 'Set budgets'}
            </button>
          </div>
          {budgets.length ? (
            <div className="ex-budgets">
              {budgets.map((b) => (
                <div key={b.category} className={`ex-bline ${b.status}`}>
                  <div className="ex-bline-top">
                    <span className="ex-bline-cat">
                      {b.status === 'over' ? <AlertTriangle size={13} /> : b.status === 'near' ? <AlertTriangle size={13} /> : null}
                      {b.category}
                    </span>
                    <span className="ex-bline-num">
                      {money(b.spent, cur)} <span className="muted">of {money(b.budget, cur)}</span>
                    </span>
                  </div>
                  <span className="ex-meter" aria-hidden>
                    <span style={{ width: `${Math.min(b.pct, 1) * 100}%` }} />
                  </span>
                  <span className="ex-bline-note">
                    {b.status === 'over' ? `Over by ${money(b.spent - b.budget, cur)}` : `${money(b.budget - b.spent, cur)} left · ${Math.round(b.pct * 100)}%`}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted ex-hint">Give categories a monthly limit (e.g. Marketing {money(5000, cur)}) and Karlo warns you at 80% and when you go over.</p>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h4>Spend by category</h4>
          </div>
          {byCat.length ? (
            <div className="ex-hbars">
              {byCat.map((c) => (
                <button key={c.key} className={`ex-hbar ${category === c.key ? 'on' : ''}`} onClick={() => (setCategory(category === c.key ? '' : c.key), setPage(1))} title={`${c.key}: ${money(c.value, cur)} — click to filter`}>
                  <span className="ex-hbar-label">{c.key}</span>
                  <span className="ex-hbar-track">
                    <span className="ex-hbar-fill" style={{ width: `${(c.value / maxCat) * 100}%` }} />
                  </span>
                  <span className="ex-hbar-value">{money(c.value, cur)}</span>
                </button>
              ))}
            </div>
          ) : (
            <p className="muted ex-hint">No costs yet.</p>
          )}
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h4>{hasIncome ? 'Money in & out per month' : 'Spend per month'}</h4>
            {hasIncome && (
              <span className="ex-legend">
                <span><i className="sw in" /> Income</span>
                <span><i className="sw out" /> Costs</span>
              </span>
            )}
          </div>
          <div className="ex-vbars" role="img" aria-label="Money per month for the last 12 months">
            {flow.map((m) => (
              <button
                key={m.month}
                className={`ex-vbar ${month === m.month ? 'on' : ''}`}
                onClick={() => (setMonth(month === m.month ? '' : m.month), setPage(1))}
                title={`${monthLabel(m.month, true)} — costs ${money(m.spend, cur)}${hasIncome ? `, income ${money(m.income, cur)}, ${m.income - m.spend >= 0 ? 'profit' : 'loss'} ${money(Math.abs(m.income - m.spend), cur)}` : ''} · click to filter`}
              >
                <span className="ex-vbar-col">
                  {hasIncome && <span className="ex-vbar-fill in" style={{ height: `${(m.income / maxFlow) * 100}%` }} />}
                  <span className="ex-vbar-fill" style={{ height: `${(m.spend / maxFlow) * 100}%` }} />
                </span>
                <span className="ex-vbar-label">{monthLabel(m.month)}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="dash-card">
          <div className="dash-card-head">
            <h4>Recurring</h4>
            {fixedMonthly > 0 && <span className="muted ex-fixed">≈ {money(fixedMonthly, cur)} / month fixed costs</span>}
          </div>
          {recurring.length ? (
            <div className="ex-rec-list">
              {recurring.map((r) => (
                <div key={r.id} className={`ex-rec ${r.active ? '' : 'paused'}`}>
                  <Repeat size={15} className={r.kind === 'income' ? 'ex-in-ico' : ''} />
                  <div className="ex-rec-text">
                    <strong>{r.title}</strong>
                    <span className="muted">
                      {FREQ_LABEL[r.frequency]} · {r.active ? `next ${shortDate(r.next_on)}` : 'paused'}
                      {r.end_on ? ` · until ${shortDate(r.end_on)}` : ''}
                    </span>
                  </div>
                  <Amount e={r} main={cur} sign={r.kind === 'income' ? '+' : ''} />
                  <button
                    className="icon-btn"
                    title={r.active ? 'Pause' : 'Resume'}
                    aria-label={r.active ? 'Pause' : 'Resume'}
                    onClick={() => updateRecurring(r.id, { active: !r.active }).catch((err) => showAlert({ title: "Couldn't update", message: err.message, tone: 'danger' }))}
                  >
                    {r.active ? <Pause size={14} /> : <Play size={14} />}
                  </button>
                  <button
                    className="icon-btn"
                    title="Stop repeating"
                    aria-label="Stop repeating"
                    onClick={async () => {
                      if (!(await askConfirm({ title: `Stop “${r.title}” repeating?`, message: 'No new entries will be added. Entries already added stay in the list.', confirmLabel: 'Stop repeating', tone: 'danger' }))) return;
                      deleteRecurring(r.id).catch((err) => showAlert({ title: "Couldn't stop it", message: err.message, tone: 'danger' }));
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="muted ex-hint">Choose “Repeats every month” when adding a cost — like Shopify, hosting or salaries — and it adds itself automatically.</p>
          )}
        </section>
      </div>

      <div className="ex-table-card">
        <div className="ex-filters">
          <label className="ex-search">
            <Search size={15} />
            <input placeholder="Search" value={q} onChange={(e) => (setQ(e.target.value), setPage(1))} />
          </label>
          <select className="field-select" value={type} onChange={(e) => (setType(e.target.value as typeof type), setPage(1))} aria-label="Type">
            <option value="">Income & costs</option>
            <option value="expense">Costs only</option>
            <option value="income">Income only</option>
          </select>
          <select className="field-select" value={month} onChange={(e) => (setMonth(e.target.value), setPage(1))} aria-label="Month">
            <option value="">All months</option>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, true)}
              </option>
            ))}
          </select>
          <select className="field-select" value={category} onChange={(e) => (setCategory(e.target.value), setPage(1))} aria-label="Category">
            <option value="">All categories</option>
            {cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select className="field-select" value={payer} onChange={(e) => (setPayer(e.target.value), setPage(1))} aria-label="Paid by">
            <option value="">Anyone</option>
            {partnerIds.map((id) => (
              <option key={id} value={id}>
                {nameOf(id)}
              </option>
            ))}
            <option value="company">Company account</option>
          </select>
          {filtered && (
            <button className="btn ghost small" onClick={() => (setMonth(''), setCategory(''), setPayer(''), setType(''), setQ(''), setPage(1))}>
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
                <th>Paid / received by</th>
                <th className="num">Amount</th>
                <th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {pageRows.map((e) => (
                <tr key={e.id} className={e.kind === 'settlement' ? 'ex-row-settle' : e.kind === 'income' ? 'ex-row-income' : ''}>
                  <td className="muted">{shortDate(e.spent_on)}</td>
                  <td>
                    <div className="ex-what">
                      <span className="ex-what-title">
                        {e.kind === 'settlement' ? `${nameOf(e.paid_by)} paid ${nameOf(e.paid_to)}` : e.title || 'Untitled'}
                        {e.recurring_id && <Repeat size={12} className="muted" aria-label="Repeats" />}
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
                  <td>
                    {e.kind === 'settlement' ? (
                      <span className="ex-tag">Partner payment</span>
                    ) : e.kind === 'income' ? (
                      <span className="ex-tag in">{e.category}</span>
                    ) : (
                      e.category
                    )}
                  </td>
                  <td>
                    <span className="tv-creator">
                      {e.paid_by ? <Avatar id={e.paid_by} name={nameOf(e.paid_by)} src={people.get(e.paid_by)?.avatar_url} size={22} /> : <Wallet size={16} className="muted" />}
                      <span>{nameOf(e.paid_by)}</span>
                    </span>
                  </td>
                  <td className={`num ${e.kind === 'income' ? 'ex-in' : ''}`}>
                    <Amount e={e} main={cur} sign={e.kind === 'income' ? '+' : ''} />
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
                    {expenses.length ? 'Nothing matches these filters.' : 'Nothing yet — press “Add expense” or “Add income” to record the first entry.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {shown.length > 0 && (
          <div className="ex-pager">
            <span className="muted">
              Showing {firstRow + 1}–{Math.min(firstRow + pageSize, shown.length)} of {shown.length}
            </span>
            <label className="ex-pager-size">
              Rows per page
              <select className="field-select" value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))}>
                {[10, 25, 50, 100].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <span className="header-spacer" />
            <nav className="ex-pages" aria-label="Pages">
              <button className="btn ghost small" disabled={curPage <= 1} onClick={() => setPage(1)} aria-label="First page" title="First page">
                «
              </button>
              <button className="btn ghost small" disabled={curPage <= 1} onClick={() => setPage(curPage - 1)}>
                ‹ Prev
              </button>
              {pageNumbers(curPage, pages).map((n, i) =>
                n === 0 ? (
                  <span key={'gap' + i} className="ex-gap">
                    …
                  </span>
                ) : (
                  <button key={n} className={`btn small ex-pnum ${n === curPage ? 'on' : 'ghost'}`} onClick={() => setPage(n)} aria-current={n === curPage ? 'page' : undefined}>
                    {n}
                  </button>
                ),
              )}
              <button className="btn ghost small" disabled={curPage >= pages} onClick={() => setPage(curPage + 1)}>
                Next ›
              </button>
              <button className="btn ghost small" disabled={curPage >= pages} onClick={() => setPage(pages)} aria-label="Last page" title="Last page">
                »
              </button>
            </nav>
          </div>
        )}
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
      {showSettings && <SettingsModal settings={settings} people={people} me={me} categories={cats} onClose={() => setShowSettings(false)} />}
      {showReport && (
        <ReportModal
          boardTitle={boardTitle}
          settings={settings}
          expenses={expenses}
          recurring={recurring}
          months={months}
          nameOf={nameOf}
          cardTitle={cardTitle}
          onClose={() => setShowReport(false)}
        />
      )}
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
  const main = settings.currency;
  const partnerIds = settings.partners.map((p) => p.id);
  const sharing = sharingPartners(settings.partners).length > 1;
  const base: ExpenseInput = edit ?? {
    kind: 'expense',
    title: '',
    amount: 0,
    currency: null,
    fx_rate: 1,
    category: 'Other',
    spent_on: today(),
    paid_by: partnerIds.includes(me.id) ? me.id : partnerIds[0] ?? null,
    paid_to: null,
    shared: sharing,
    card_id: null,
    note: '',
    receipt_path: null,
    receipt_name: null,
    ...preset,
  };
  const [f, setF] = useState<ExpenseInput>(base);
  const [amount, setAmount] = useState(base.amount ? String(base.amount) : '');
  const [currency, setCurrency] = useState(base.currency || main);
  const [rate, setRate] = useState(base.fx_rate && base.fx_rate !== 1 ? String(base.fx_rate) : '');
  const [rateState, setRateState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const [repeat, setRepeat] = useState<'' | Frequency>('');
  const [endOn, setEndOn] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (p: Partial<ExpenseInput>) => setF({ ...f, ...p });
  const nameOf = (id: string) => people.get(id)?.name ?? (id === me.id ? me.name : 'Former partner');
  const settle = f.kind === 'settlement';
  const income = f.kind === 'income';
  const foreign = currency !== main;
  const cards = useMemo(
    () =>
      data.listOrder
        .filter((l) => !data.lists[l].archived)
        .flatMap((l) => data.lists[l].cardIds.map((id) => data.cards[id]).filter((c) => c && !c.archived)),
    [data],
  );
  const cats = income ? [...new Set([...INCOME_CATEGORIES, ...categories.filter((c) => !CATEGORIES.includes(c))])] : categories.filter((c) => !INCOME_CATEGORIES.includes(c));

  // Fill in today's rate when picking another currency (editable: use your bank's rate if it differs).
  const pickCurrency = async (c: string) => {
    setCurrency(c);
    if (c === main) {
      setRate('');
      return;
    }
    setRateState('loading');
    const r = await fetchRate(c, main);
    if (r) {
      setRate(String(Math.round(r * 1e6) / 1e6));
      setRateState('idle');
    } else setRateState('failed');
  };

  const n = Number(amount.replace(/,/g, ''));
  const rateN = foreign ? Number(rate) : 1;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!(n > 0)) return setErr('Enter an amount greater than 0.');
    if (foreign && !(rateN > 0)) return setErr(`Enter the exchange rate: how many ${main} for 1 ${currency}.`);
    if (settle && (!f.paid_by || !f.paid_to || f.paid_by === f.paid_to)) return setErr('Pick two different partners.');
    setBusy(true);
    setErr(null);
    try {
      let receipt = { receipt_path: f.receipt_path, receipt_name: f.receipt_name };
      if (file) {
        const up = await uploadReceipt(boardId, file);
        receipt = { receipt_path: up.path, receipt_name: up.name };
      }
      const entry: ExpenseInput = {
        ...f,
        ...receipt,
        amount: Math.round(n * 100) / 100,
        currency: foreign ? currency : null,
        fx_rate: foreign ? rateN : 1,
        title: settle ? f.title || 'Settle up' : f.title.trim(),
        category: settle ? 'Partner payment' : f.category.trim() || (income ? 'Other income' : 'Other'),
        paid_to: settle ? f.paid_to : null,
        // Only real costs are split; solo tracking never splits (adding a partner later won't create debts).
        shared: f.kind === 'expense' && sharing ? f.shared : false,
        card_id: settle ? null : f.card_id,
      };
      if (repeat && !edit && !settle) {
        await createRecurring(boardId, {
          kind: income ? 'income' : 'expense',
          title: entry.title,
          amount: entry.amount,
          currency: entry.currency,
          fx_rate: entry.fx_rate ?? 1,
          category: entry.category,
          paid_by: entry.paid_by,
          shared: entry.shared,
          card_id: entry.card_id,
          note: entry.note,
          frequency: repeat,
          start_on: entry.spent_on,
          end_on: endOn || null,
        });
      } else {
        await saveExpense(boardId, entry, edit?.id);
      }
      onClose();
    } catch (e2) {
      setErr((e2 as Error).message);
      setBusy(false);
    }
  };

  const switchKind = (kind: ExpenseInput['kind']) => {
    if (kind === 'settlement') set({ kind, paid_by: f.paid_by ?? me.id, paid_to: partnerIds.find((id) => id !== (f.paid_by ?? me.id)) ?? null });
    else set({ kind, category: kind === 'income' ? (INCOME_CATEGORIES.includes(f.category) ? f.category : 'Sales') : CATEGORIES.includes(f.category) ? f.category : 'Other' });
  };

  const title = edit ? (income ? 'Edit income' : settle ? 'Edit payment' : 'Edit expense') : settle ? 'Record a partner payment' : income ? 'Add income' : 'Add expense';
  return (
    <Modal title={title} onClose={onClose}>
      <form className="ex-form" onSubmit={submit}>
        {!edit && (
          <div className="auth-tabs" role="tablist">
            <button type="button" className={f.kind === 'expense' ? 'on' : ''} onClick={() => switchKind('expense')}>
              <Receipt size={14} /> Expense
            </button>
            <button type="button" className={income ? 'on' : ''} onClick={() => switchKind('income')}>
              <TrendingUp size={14} /> Income
            </button>
            {sharing && (
              <button type="button" className={settle ? 'on' : ''} onClick={() => switchKind('settlement')}>
                <ArrowRightLeft size={14} /> Partner payment
              </button>
            )}
          </div>
        )}
        {!settle && (
          <label className="pop-field">
            {income ? 'Where did it come from?' : 'What was it for?'}
            <input
              autoFocus
              required
              placeholder={income ? 'e.g. Order #1043, Client name, Investor top-up' : 'e.g. Shopify plan, logo design, trade licence'}
              value={f.title}
              onChange={(e) => set({ title: e.target.value })}
            />
          </label>
        )}
        <div className="ex-form-row ex-amount-row">
          <label className="pop-field">
            Amount
            <span className="ex-money-input">
              <input required inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.,]/g, ''))} autoFocus={settle} />
              <select value={currency} onChange={(e) => void pickCurrency(e.target.value)} aria-label="Currency">
                {[...new Set([main, ...CURRENCIES])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </span>
          </label>
          <label className="pop-field">
            Date
            <input type="date" required value={f.spent_on} onChange={(e) => set({ spent_on: e.target.value })} />
          </label>
        </div>
        {foreign && (
          <div className="ex-fx-row">
            <label className="pop-field">
              Exchange rate: 1 {currency} =
              <span className="ex-money-input">
                <input inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^\d.]/g, ''))} placeholder={rateState === 'loading' ? 'Getting today’s rate…' : 'e.g. 3.6725'} />
                <span className="ex-fx-main">{main}</span>
              </span>
            </label>
            <span className="ex-fx-result">
              {rateState === 'failed' ? (
                <span className="ex-warn">Couldn't get today's rate — type it in.</span>
              ) : n > 0 && rateN > 0 ? (
                <>
                  = <strong>{money(n * rateN, main)}</strong>
                  <span className="muted"> · today's rate, edit to match your bank</span>
                </>
              ) : null}
            </span>
          </div>
        )}
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
                  {cats.map((c) => (
                    <option key={c} value={c} />
                  ))}
                </datalist>
              </label>
              <label className="pop-field">
                {income ? 'Received by' : 'Paid by'}
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
            {!income && f.paid_by && sharing && (
              <label className="ex-check">
                <input type="checkbox" checked={f.shared} onChange={(e) => set({ shared: e.target.checked })} />
                Business cost — split between partners (
                {sharingPartners(settings.partners)
                  .map((p) => `${nameOf(p.id).split(/[\s.]/)[0]} ${Math.round((shareFractions(sharingPartners(settings.partners)).get(p.id) ?? 0) * 100)}%`)
                  .join(', ')}
                )
              </label>
            )}
            {!edit && (
              <div className="ex-form-row">
                <label className="pop-field">
                  Repeats
                  <select className="field-select" value={repeat} onChange={(e) => setRepeat(e.target.value as typeof repeat)}>
                    <option value="">Doesn't repeat</option>
                    <option value="weekly">Every week</option>
                    <option value="monthly">Every month</option>
                    <option value="yearly">Every year</option>
                  </select>
                </label>
                {repeat && (
                  <label className="pop-field">
                    Until (optional)
                    <input type="date" value={endOn} min={f.spent_on} onChange={(e) => setEndOn(e.target.value)} />
                  </label>
                )}
              </div>
            )}
            {repeat && <p className="muted ex-share-hint">Added automatically on the {repeat === 'weekly' ? 'same weekday' : 'same date'} {FREQ_LABEL[repeat].toLowerCase()}, starting {shortDate(f.spent_on)}{foreign ? ` at this rate (${rate || '?'})` : ''}. Pause or stop it any time under Recurring.</p>}
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
          <input value={f.note} onChange={(e) => set({ note: e.target.value })} placeholder={settle ? 'e.g. Bank transfer' : income ? 'e.g. Paid via Stripe' : 'e.g. Invoice #1043'} />
        </label>
        {!settle && !repeat && (
          <div className="pop-field">
            {income ? 'Invoice or proof (optional)' : 'Receipt (optional)'}
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
          <button className={`btn ${income ? 'access' : 'primary'}`} disabled={busy}>
            {busy ? 'Saving…' : edit ? 'Save' : settle ? 'Record payment' : repeat ? 'Save & repeat' : income ? 'Add income' : 'Add expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- budgets & settings

function SettingsModal({
  settings,
  people,
  me,
  categories,
  onClose,
}: {
  settings: ExpenseSettings;
  people: Map<string, Person>;
  me: Me;
  categories: string[];
  onClose: () => void;
}) {
  const [currency, setCurrency] = useState(settings.currency);
  const [budget, setBudget] = useState(settings.budget ? String(settings.budget) : '');
  const [catBudgets, setCatBudgets] = useState<{ category: string; amount: string }[]>(
    Object.entries(settings.category_budgets ?? {}).map(([category, amount]) => ({ category, amount: String(amount) })),
  );
  const [partners, setPartners] = useState<Partner[]>(settings.partners);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameOf = (id: string) => people.get(id)?.name ?? (id === me.id ? me.name : 'Former partner');
  const addable = [...people.values()].filter((p) => !partners.some((x) => x.id === p.user_id));
  const sum = partners.reduce((n, p) => n + (Number(p.share) || 0), 0);
  const costCats = categories.filter((c) => !INCOME_CATEGORIES.includes(c) && !catBudgets.some((b) => b.category === c));
  const multi = partners.length > 1;

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      const b = Number(budget.replace(/,/g, ''));
      const category_budgets = Object.fromEntries(
        catBudgets.map((x) => [x.category.trim(), Number(x.amount.replace(/,/g, ''))]).filter(([c, a]) => c && (a as number) > 0),
      );
      const saved = await saveSettings({
        ...settings,
        currency,
        budget: budget.trim() && b > 0 ? b : null,
        category_budgets,
        partners: partners.map((p) => ({ id: p.id, share: Number(p.share) || 0 })),
      });
      onClose();
      const n = Object.keys(saved.category_budgets ?? {}).length;
      void showAlert({
        title: 'Settings saved',
        message: [
          saved.budget ? `Total budget: ${money(saved.budget, saved.currency)}.` : 'No total budget.',
          n ? `${n} category budget${n > 1 ? 's' : ''} set.` : 'No category budgets.',
        ].join(' '),
        tone: 'access',
      });
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Budgets & settings" onClose={onClose}>
      <div className="ex-form">
        <div className="ex-form-row">
          <label className="pop-field">
            Main currency
            <select className="field-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="pop-field">
            Total project budget (optional)
            <span className="ex-money-input">
              <input inputMode="decimal" placeholder="e.g. 50000" value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d.,]/g, ''))} />
              <span className="ex-fx-main">{currency}</span>
            </span>
          </label>
        </div>
        {currency !== settings.currency && (
          <span className="ex-warn">
            Totals will show in {currency}. Entries already saved keep their own currency and rate; entries that were in {settings.currency} are treated as {currency} — only change this before you start.
          </span>
        )}

        <div className="pop-field">
          Monthly budget per category ({currency})
          {catBudgets.map((b, i) => (
            <div key={i} className="ex-cb-row">
              <input list="ex-cb-cats" value={b.category} placeholder="Category" onChange={(e) => setCatBudgets(catBudgets.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} />
              <input inputMode="decimal" value={b.amount} placeholder="Amount" onChange={(e) => setCatBudgets(catBudgets.map((x, j) => (j === i ? { ...x, amount: e.target.value.replace(/[^\d.,]/g, '') } : x)))} />
              <button className="icon-btn" aria-label="Remove budget" onClick={() => setCatBudgets(catBudgets.filter((_, j) => j !== i))}>
                <X size={15} />
              </button>
            </div>
          ))}
          <datalist id="ex-cb-cats">
            {costCats.map((c) => (
              <option key={c} value={c} />
            ))}
          </datalist>
          <button type="button" className="btn ghost small ex-add-line" onClick={() => setCatBudgets([...catBudgets, { category: costCats[0] ?? '', amount: '' }])}>
            <Plus size={14} /> Add a category budget
          </button>
          <span className="muted ex-share-hint">Karlo warns you on the Money page at 80% and when a category goes over its limit for the month.</span>
        </div>

        <div className="pop-field">
          {multi ? 'People and their share of costs' : 'Who can see this'}
          {partners.map((p, i) => (
            <div key={p.id} className="ex-partner-edit">
              <Avatar id={p.id} name={nameOf(p.id)} src={people.get(p.id)?.avatar_url} size={26} />
              <span className="ex-partner-name">{nameOf(p.id)}</span>
              {multi && (
                <>
                  <input
                    inputMode="decimal"
                    value={String(p.share)}
                    onChange={(e) => setPartners(partners.map((x, j) => (j === i ? { ...x, share: Number(e.target.value.replace(/[^\d.]/g, '')) || 0 } : x)))}
                    aria-label={`${nameOf(p.id)} share`}
                  />
                  <span className="muted">%</span>
                </>
              )}
              <button
                className="icon-btn"
                disabled={p.id === me.id}
                title={p.id === me.id ? "You can't remove yourself" : `Remove ${nameOf(p.id)} — they will no longer see the money`}
                onClick={() => setPartners(partners.filter((x) => x.id !== p.id))}
              >
                <X size={15} />
              </button>
            </div>
          ))}
          {multi && <span className="muted ex-share-hint">0% = can see and add entries, but isn't part of the cost split.</span>}
          {multi && Math.round(sum) !== 100 && <span className="ex-warn">Shares add up to {sum}% — costs are split in proportion, so that's fine, but 100% is clearest.</span>}
          {addable.length > 0 && (
            <select className="field-select" value="" onChange={(e) => e.target.value && setPartners([...partners, { id: e.target.value, share: 0 }])}>
              <option value="">+ Give someone access (they will see everything here)</option>
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

// ---------------------------------------------------------------- monthly report

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** A clean, printable page for one month (or the whole project): save as PDF from the print dialog. */
export function reportHtml(o: {
  boardTitle: string;
  period: string; // 'YYYY-MM' or '' = all time
  settings: ExpenseSettings;
  expenses: Expense[];
  recurring: Recurring[];
  nameOf: (id: string | null) => string;
}) {
  const cur = o.settings.currency;
  const rows = o.expenses.filter((e) => !o.period || e.spent_on.startsWith(o.period)).sort((a, b) => a.spent_on.localeCompare(b.spent_on));
  const inc = incomeTotal(rows);
  const cost = total(rows);
  const net = inc - cost;
  const byCat = totalsBy(rows, (e) => e.category);
  const byIncome = (() => {
    const m = new Map<string, number>();
    for (const e of incomeOf(rows)) m.set(e.category, (m.get(e.category) ?? 0) + inBase(e));
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  })();
  const budgets = o.period ? budgetStatus(o.expenses, o.settings.category_budgets, o.period) : [];
  const fx = [...new Set(rows.map((e) => e.currency).filter((c): c is string => !!c && c !== cur))];
  const periodLabel = o.period ? monthLabel(o.period, true) : 'All time';
  const m = (n: number) => esc(money(n, cur));
  const line = (e: Expense) => {
    const c = e.currency || cur;
    const amt = `${e.kind === 'income' ? '+' : e.kind === 'settlement' ? '' : '−'}${esc(money(e.amount, c))}`;
    return `<tr class="${e.kind}"><td>${esc(shortDate(e.spent_on))}</td><td>${esc(
      e.kind === 'settlement' ? `${o.nameOf(e.paid_by)} paid ${o.nameOf(e.paid_to)}` : e.title,
    )}${e.note ? `<div class="sub">${esc(e.note)}</div>` : ''}</td><td>${esc(e.kind === 'settlement' ? 'Partner payment' : e.category)}</td><td>${esc(
      o.nameOf(e.paid_by),
    )}</td><td class="r">${amt}${c !== cur ? `<div class="sub">${m(inBase(e))} @ ${e.fx_rate}</div>` : ''}</td></tr>`;
  };
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(o.boardTitle)} — ${esc(periodLabel)} report</title>
<style>
  *{box-sizing:border-box} body{font:13px/1.45 -apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#172b4d;margin:32px auto;max-width:860px;padding:0 24px}
  h1{font-size:22px;margin:0} .meta{color:#626f86;margin:4px 0 20px}
  .tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:22px}
  .tile{border:1px solid #dfe1e6;border-radius:8px;padding:10px 12px} .tile b{display:block;font-size:19px} .tile span{color:#626f86;font-size:12px}
  .pos b{color:#216e4e} .neg b{color:#ae2e24}
  h2{font-size:14px;margin:22px 0 8px;text-transform:uppercase;letter-spacing:.04em;color:#44546f}
  table{width:100%;border-collapse:collapse} th{text-align:left;font-size:11px;color:#626f86;text-transform:uppercase;border-bottom:1px solid #c1c7d0;padding:6px 8px}
  td{padding:7px 8px;border-bottom:1px solid #ebecf0;vertical-align:top} .r{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}
  tr.income td.r{color:#216e4e} tr.settlement td{color:#626f86} .sub{color:#626f86;font-size:11px}
  .two{display:grid;grid-template-columns:1fr 1fr;gap:24px} .over{color:#ae2e24;font-weight:600} .near{color:#a54800;font-weight:600}
  .foot{margin-top:28px;color:#8590a2;font-size:11px} @media print{body{margin:0}.noprint{display:none}}
  .noprint{margin-bottom:18px} .noprint button{font:inherit;padding:8px 14px;border-radius:6px;border:none;background:#0c66e4;color:#fff;cursor:pointer}
</style></head><body>
<div class="noprint"><button onclick="print()">Print / Save as PDF</button></div>
<h1>${esc(o.boardTitle)} — money report</h1>
<div class="meta">${esc(periodLabel)} · amounts in ${esc(cur)} · generated ${esc(new Date().toLocaleString())}</div>
<div class="tiles"><div class="tile"><b>${m(inc)}</b><span>Income</span></div><div class="tile"><b>${m(cost)}</b><span>Costs</span></div>
${
  incomeOf(o.expenses).length
    ? `<div class="tile ${net >= 0 ? 'pos' : 'neg'}"><b>${m(net)}</b><span>${net >= 0 ? 'Profit' : 'Loss'}</span></div>`
    : `<div class="tile"><b>${m(cost)}</b><span>Invested so far (no income yet)</span></div>`
}</div>
<div class="two"><div><h2>Costs by category</h2><table>${
    byCat.map((c) => `<tr><td>${esc(c.key)}</td><td class="r">${m(c.value)}</td></tr>`).join('') || '<tr><td>No costs</td></tr>'
  }</table></div><div><h2>Income by source</h2><table>${
    byIncome.map(([k, v]) => `<tr><td>${esc(k)}</td><td class="r">${m(v)}</td></tr>`).join('') || '<tr><td>No income</td></tr>'
  }</table></div></div>
${
  budgets.length
    ? `<h2>Budgets</h2><table><tr><th>Category</th><th class="r">Spent</th><th class="r">Budget</th><th class="r">Status</th></tr>${budgets
        .map(
          (b) =>
            `<tr><td>${esc(b.category)}</td><td class="r">${m(b.spent)}</td><td class="r">${m(b.budget)}</td><td class="r ${b.status}">${
              b.status === 'over' ? 'Over by ' + m(b.spent - b.budget) : Math.round(b.pct * 100) + '%'
            }</td></tr>`,
        )
        .join('')}</table>`
    : ''
}
${
  o.recurring.filter((r) => r.active).length
    ? `<h2>Recurring</h2><table>${o.recurring
        .filter((r) => r.active)
        .map((r) => `<tr><td>${esc(r.title)}</td><td>${esc(FREQ_LABEL[r.frequency])}</td><td class="r">${esc(money(r.amount, r.currency || cur))}</td></tr>`)
        .join('')}</table>`
    : ''
}
<h2>All entries (${rows.length})</h2>
<table><tr><th>Date</th><th>What</th><th>Category</th><th>By</th><th class="r">Amount</th></tr>${rows.map(line).join('') || '<tr><td colspan="5">Nothing recorded.</td></tr>'}</table>
${fx.length ? `<p class="foot">Entries in ${esc(fx.join(', '))} are converted to ${esc(cur)} at the rate saved with each entry.</p>` : ''}
<p class="foot">Karlo · private to the project partners</p>
</body></html>`;
}

function ReportModal({
  boardTitle,
  settings,
  expenses,
  recurring,
  months,
  nameOf,
  cardTitle,
  onClose,
}: {
  boardTitle: string;
  settings: ExpenseSettings;
  expenses: Expense[];
  recurring: Recurring[];
  months: string[];
  nameOf: (id: string | null) => string;
  cardTitle: (id: string | null) => string;
  onClose: () => void;
}) {
  const [period, setPeriod] = useState(months.includes(today().slice(0, 7)) ? today().slice(0, 7) : months[0] ?? '');
  const rows = expenses.filter((e) => !period || e.spent_on.startsWith(period));
  const open = () => {
    const html = reportHtml({ boardTitle, period, settings, expenses, recurring, nameOf });
    const w = window.open('', '_blank');
    if (w) {
      w.document.open();
      w.document.write(html);
      w.document.close();
      return;
    }
    // Pop-ups blocked (or in the phone app): go straight to the print / Save as PDF dialog.
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
    frame.srcdoc = html;
    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 60_000);
    };
    document.body.appendChild(frame);
  };
  return (
    <Modal title="Monthly report" onClose={onClose}>
      <div className="ex-form">
        <label className="pop-field">
          Period
          <select className="field-select" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, true)}
              </option>
            ))}
            <option value="">All time</option>
          </select>
        </label>
        <div className="ex-report-sum">
          <span>
            Income <strong>{money(incomeTotal(rows), settings.currency)}</strong>
          </span>
          <span>
            Costs <strong>{money(total(rows), settings.currency)}</strong>
          </span>
          {incomeOf(expenses).length ? (
            <span className={profit(rows) >= 0 ? 'pos' : 'neg'}>
              {profit(rows) >= 0 ? 'Profit' : 'Loss'} <strong>{money(profit(rows), settings.currency)}</strong>
            </span>
          ) : (
            <span>
              Invested so far <strong>{money(total(rows), settings.currency)}</strong>
            </span>
          )}
        </div>
        <p className="muted ex-share-hint">The report opens in a new tab: totals, costs by category, income by source, budgets, recurring items and every entry. Use “Print / Save as PDF” there.</p>
        <div className="ex-form-actions">
          <button
            className="btn ghost"
            onClick={() =>
              download(`${boardTitle.replace(/[^\w-]+/g, '-')}-money-${period || 'all'}.csv`, toCsv(rows, nameOf, cardTitle, settings.currency), 'text/csv')
            }
          >
            <Download size={14} /> Excel (CSV)
          </button>
          <button className="btn primary" onClick={open}>
            <FileText size={14} /> Open report (PDF)
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
                <span className="cx-amt">
                  <Amount e={e} main={cur} />
                </span>
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
