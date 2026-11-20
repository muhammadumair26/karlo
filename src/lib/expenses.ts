import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { uid } from './board';

/** One money movement on a project: a cost, income (sales etc.), or a partner-to-partner payback. */
export interface Expense {
  id: string;
  board_id: string;
  kind: 'expense' | 'income' | 'settlement';
  title: string;
  amount: number; // in the entry's own currency
  currency?: string | null; // null = the board's main currency
  fx_rate?: number; // main-currency units per 1 unit of `currency` (saved when entered)
  category: string;
  spent_on: string; // YYYY-MM-DD
  paid_by: string | null; // partner user id, or null = company account
  paid_to: string | null; // settlements only
  shared: boolean; // split between partners by their share
  card_id: string | null;
  note: string;
  receipt_path: string | null;
  receipt_name: string | null;
  recurring_id?: string | null;
  created_by: string;
  created_at: string;
}

export interface Partner {
  id: string;
  share: number; // percent
}

export interface ExpenseSettings {
  board_id: string;
  currency: string;
  budget: number | null;
  partners: Partner[];
  /** Monthly budget per category, e.g. { Marketing: 5000 }. */
  category_budgets?: Record<string, number>;
}

export type Frequency = 'weekly' | 'monthly' | 'yearly';

/** A cost (or income) that adds itself every week / month / year. */
export interface Recurring {
  id: string;
  board_id: string;
  kind: 'expense' | 'income';
  title: string;
  amount: number;
  currency?: string | null;
  fx_rate?: number;
  category: string;
  paid_by: string | null;
  shared: boolean;
  card_id: string | null;
  note: string;
  frequency: Frequency;
  start_on: string;
  next_on: string;
  end_on: string | null;
  active: boolean;
}

export const FREQ_LABEL: Record<Frequency, string> = { weekly: 'Every week', monthly: 'Every month', yearly: 'Every year' };

export const CATEGORIES = ['Development', 'Hosting & software', 'Marketing', 'Salaries', 'Legal & licenses', 'Office & rent', 'Travel', 'Inventory', 'Bank & fees', 'Other'];
export const INCOME_CATEGORIES = ['Sales', 'Services', 'Investment', 'Refund', 'Other income'];
export const CURRENCIES = ['AED', 'PKR', 'USD', 'SAR', 'EUR', 'GBP'];

export function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** An entry's amount in the board's main currency (its own amount × the saved rate). */
export const inBase = (e: Pick<Expense, 'amount' | 'fx_rate'>) => e.amount * (e.fx_rate && e.fx_rate > 0 ? e.fx_rate : 1);

// ---------------------------------------------------------------- pure maths (tested)

/** Partner shares normalised to fractions that add up to 1 (equal split when shares are missing). */
export function shareFractions(partners: Partner[]): Map<string, number> {
  const total = partners.reduce((n, p) => n + (p.share > 0 ? p.share : 0), 0);
  return new Map(partners.map((p) => [p.id, total > 0 ? Math.max(p.share, 0) / total : 1 / partners.length]));
}

export interface PartnerBalance {
  id: string;
  paid: number; // shared expenses they paid personally
  share: number; // their part of all shared expenses
  settled: number; // + paid back to others, − received from others
  balance: number; // > 0: the others owe them; < 0: they owe
}

/**
 * Who owes whom. A shared expense paid by a partner is split by share; the payer is owed the others' part.
 * Expenses paid from the company account, or not shared, don't move balances. Settlements even them out.
 */
export function balances(expenses: Expense[], partners: Partner[]): PartnerBalance[] {
  const frac = shareFractions(partners);
  const rows = new Map(partners.map((p) => [p.id, { id: p.id, paid: 0, share: 0, settled: 0, balance: 0 }]));
  for (const e of expenses) {
    if (e.kind === 'settlement') {
      if (e.paid_by && rows.has(e.paid_by)) rows.get(e.paid_by)!.settled += inBase(e);
      if (e.paid_to && rows.has(e.paid_to)) rows.get(e.paid_to)!.settled -= inBase(e);
      continue;
    }
    if (e.kind !== 'expense' || !e.shared || !e.paid_by || !rows.has(e.paid_by)) continue;
    rows.get(e.paid_by)!.paid += inBase(e);
    for (const [id, f] of frac) rows.get(id)!.share += inBase(e) * f;
  }
  return [...rows.values()].map((r) => ({
    ...r,
    paid: round2(r.paid),
    share: round2(r.share),
    settled: round2(r.settled),
    balance: round2(r.paid - r.share + r.settled),
  }));
}

/** Fewest payments that settle everyone up (largest debtor pays largest creditor first). */
export function settleUp(bal: PartnerBalance[]): { from: string; to: string; amount: number }[] {
  const debt = bal.filter((b) => b.balance < -0.004).map((b) => ({ id: b.id, left: -b.balance }));
  const cred = bal.filter((b) => b.balance > 0.004).map((b) => ({ id: b.id, left: b.balance }));
  debt.sort((a, b) => b.left - a.left);
  cred.sort((a, b) => b.left - a.left);
  const out: { from: string; to: string; amount: number }[] = [];
  let i = 0;
  let j = 0;
  while (i < debt.length && j < cred.length) {
    const amt = Math.min(debt[i].left, cred[j].left);
    if (amt > 0.004) out.push({ from: debt[i].id, to: cred[j].id, amount: round2(amt) });
    debt[i].left -= amt;
    cred[j].left -= amt;
    if (debt[i].left < 0.005) i++;
    if (cred[j].left < 0.005) j++;
  }
  return out;
}

/** Spending only (settlements are not costs). */
export const spending = (expenses: Expense[]) => expenses.filter((e) => e.kind === 'expense');
export const total = (expenses: Expense[]) => round2(spending(expenses).reduce((n, e) => n + inBase(e), 0));

/** Totals per key, largest first. */
export function totalsBy(expenses: Expense[], key: (e: Expense) => string): { key: string; value: number }[] {
  const m = new Map<string, number>();
  for (const e of spending(expenses)) m.set(key(e), (m.get(key(e)) ?? 0) + inBase(e));
  return [...m.entries()].map(([k, v]) => ({ key: k, value: round2(v) })).sort((a, b) => b.value - a.value);
}

/** Spend per month for the last `months` months, oldest first (zero months included). */
export function monthly(expenses: Expense[], months = 12, today = new Date()): { month: string; value: number }[] {
  const out: { month: string; value: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, value: 0 });
  }
  const idx = new Map(out.map((m, i) => [m.month, i]));
  for (const e of spending(expenses)) {
    const i = idx.get(e.spent_on.slice(0, 7));
    if (i !== undefined) out[i].value = round2(out[i].value + inBase(e));
  }
  return out;
}

export const incomeOf = (expenses: Expense[]) => expenses.filter((e) => e.kind === 'income');
export const incomeTotal = (expenses: Expense[]) => round2(incomeOf(expenses).reduce((n, e) => n + inBase(e), 0));
/** Income minus costs (paybacks between partners are neither). */
export const profit = (expenses: Expense[]) => round2(incomeTotal(expenses) - total(expenses));

/** Money in and out per month for the last `months` months, oldest first. */
export function monthlyFlow(expenses: Expense[], months = 12, today = new Date()): { month: string; spend: number; income: number }[] {
  const out: { month: string; spend: number; income: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    out.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`, spend: 0, income: 0 });
  }
  const idx = new Map(out.map((m, i) => [m.month, i]));
  for (const e of expenses) {
    const i = idx.get(e.spent_on.slice(0, 7));
    if (i === undefined || e.kind === 'settlement') continue;
    if (e.kind === 'income') out[i].income = round2(out[i].income + inBase(e));
    else out[i].spend = round2(out[i].spend + inBase(e));
  }
  return out;
}

export interface BudgetLine {
  category: string;
  budget: number;
  spent: number;
  pct: number; // 0..∞
  status: 'ok' | 'near' | 'over';
}

/** This month's spend against each category's monthly budget (worst first). Near = 80%+. */
export function budgetStatus(expenses: Expense[], budgets: Record<string, number> | undefined, month: string): BudgetLine[] {
  if (!budgets) return [];
  const spentBy = new Map<string, number>();
  for (const e of spending(expenses)) if (e.spent_on.startsWith(month)) spentBy.set(e.category, (spentBy.get(e.category) ?? 0) + inBase(e));
  return Object.entries(budgets)
    .filter(([, b]) => b > 0)
    .map(([category, budget]) => {
      const spent = round2(spentBy.get(category) ?? 0);
      const pct = spent / budget;
      return { category, budget, spent, pct, status: (pct >= 1 ? 'over' : pct >= 0.8 ? 'near' : 'ok') as BudgetLine['status'] };
    })
    .sort((a, b) => b.pct - a.pct);
}

/** Next occurrence counted from the start date (31 Jan → 28 Feb → 31 Mar, no drift). Mirrors the database. */
export function recurringDate(start: string, f: Frequency, k: number): string {
  const [y, m, d] = start.split('-').map(Number);
  let dt: Date;
  if (f === 'weekly') dt = new Date(Date.UTC(y, m - 1, d + 7 * k));
  else {
    const months = f === 'monthly' ? k : 12 * k;
    const ty = y + Math.floor((m - 1 + months) / 12);
    const tm = (m - 1 + months) % 12;
    const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
    dt = new Date(Date.UTC(ty, tm, Math.min(d, last)));
  }
  return dt.toISOString().slice(0, 10);
}

/** Roughly what a repeating item costs per month (for the "fixed monthly costs" total). */
export const perMonth = (r: Pick<Recurring, 'amount' | 'frequency' | 'fx_rate'>) => {
  const a = inBase(r);
  return round2(r.frequency === 'monthly' ? a : r.frequency === 'weekly' ? (a * 52) / 12 : a / 12);
};

export const monthLabel = (ym: string, long = false) =>
  new Date(ym + '-01T00:00:00').toLocaleDateString(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short' });

export function toCsv(expenses: Expense[], name: (id: string | null) => string, cardTitle: (id: string | null) => string, currency: string) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Date', 'Type', 'Title', 'Category', 'Amount', 'Currency', 'Rate', `Amount (${currency})`, 'Paid by', 'Paid to', 'Split between partners', 'Card', 'Note', 'Receipt'];
  const rows = [...expenses]
    .sort((a, b) => a.spent_on.localeCompare(b.spent_on))
    .map((e) => [
      e.spent_on,
      e.kind === 'settlement' ? 'Partner payment' : e.kind === 'income' ? 'Income' : 'Expense',
      e.title,
      e.kind === 'settlement' ? '' : e.category,
      e.amount.toFixed(2),
      e.currency || currency,
      String(e.fx_rate ?? 1),
      inBase(e).toFixed(2),
      name(e.paid_by),
      e.kind === 'settlement' ? name(e.paid_to) : '',
      e.kind === 'settlement' ? '' : e.shared ? 'Yes' : 'No',
      cardTitle(e.card_id),
      e.note,
      e.receipt_name ?? '',
    ]);
  return [head, ...rows].map((r) => r.map(esc).join(',')).join('\n');
}

// ---------------------------------------------------------------- database

const fromRow = (r: Record<string, unknown>): Expense => ({ ...(r as unknown as Expense), amount: Number(r.amount), fx_rate: Number(r.fx_rate ?? 1) });
const settingsFromRow = (s: Record<string, unknown>): ExpenseSettings => ({
  ...(s as unknown as ExpenseSettings),
  budget: s.budget == null ? null : Number(s.budget),
  category_budgets: Object.fromEntries(Object.entries((s.category_budgets as Record<string, unknown>) ?? {}).map(([k, v]) => [k, Number(v)])),
});
const recurringFromRow = (r: Record<string, unknown>): Recurring => ({ ...(r as unknown as Recurring), amount: Number(r.amount), fx_rate: Number(r.fx_rate ?? 1) });

export type RecurringInput = Pick<Recurring, 'kind' | 'title' | 'amount' | 'currency' | 'fx_rate' | 'category' | 'paid_by' | 'shared' | 'card_id' | 'note' | 'frequency' | 'start_on' | 'end_on'>;

/** Creates a repeating item and adds any occurrences already due (including today's). */
export async function createRecurring(boardId: string, r: RecurringInput) {
  if (!supabase) throw new Error('Not connected');
  const { error } = await supabase.from('expense_recurring').insert({ ...r, board_id: boardId, next_on: r.start_on });
  if (error) throw new Error(error.message);
  await runRecurring(boardId);
}

export async function updateRecurring(id: string, patch: Partial<Pick<Recurring, 'active' | 'amount' | 'title' | 'end_on'>>) {
  if (!supabase) return;
  const { error } = await supabase.from('expense_recurring').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}

/** Stops a repeating item. Entries it already added stay. */
export async function deleteRecurring(id: string) {
  if (!supabase) return;
  const { error } = await supabase.from('expense_recurring').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Adds any due repeating entries for this board (also runs daily on the server). */
export async function runRecurring(boardId: string): Promise<number> {
  if (!supabase) return 0;
  const { data } = await supabase.rpc('run_recurring_expenses', { b: boardId });
  return Number(data ?? 0);
}

export type ExpenseInput = Omit<Expense, 'id' | 'board_id' | 'created_by' | 'created_at'>;

export async function saveExpense(boardId: string, input: ExpenseInput, id?: string): Promise<Expense> {
  if (!supabase) throw new Error('Not connected');
  const q = id
    ? supabase.from('expenses').update({ ...input, updated_at: new Date().toISOString() }).eq('id', id)
    : supabase.from('expenses').insert({ ...input, board_id: boardId });
  const { data, error } = await q.select().single();
  if (error) throw new Error(error.message);
  return fromRow(data);
}

export async function deleteExpense(e: Expense) {
  if (!supabase) return;
  const { error } = await supabase.from('expenses').delete().eq('id', e.id);
  if (error) throw new Error(error.message);
  if (e.receipt_path) await supabase.storage.from('receipts').remove([e.receipt_path]);
}

export async function saveSettings(s: ExpenseSettings) {
  if (!supabase) return;
  const { error } = await supabase
    .from('expense_settings')
    .upsert({
      board_id: s.board_id,
      currency: s.currency,
      budget: s.budget,
      partners: s.partners,
      category_budgets: s.category_budgets ?? {},
      updated_at: new Date().toISOString(),
    });
  if (error) throw new Error(error.message);
}

export async function uploadReceipt(boardId: string, file: File): Promise<{ path: string; name: string }> {
  if (!supabase) throw new Error('Not connected');
  if (file.size > 25 * 1024 * 1024) throw new Error('Receipt is larger than 25 MB.');
  const safe = file.name.replace(/[^\w.\- ()]+/g, '_').slice(-120) || 'receipt';
  const path = `${boardId}/${uid()}-${safe}`;
  const { error } = await supabase.storage.from('receipts').upload(path, file, { contentType: file.type || 'application/octet-stream' });
  if (error) throw new Error(error.message);
  return { path, name: file.name || 'Receipt' };
}

export async function receiptUrl(path: string) {
  if (!supabase) return null;
  const { data } = await supabase.storage.from('receipts').createSignedUrl(path, 3600);
  return data?.signedUrl ?? null;
}

/**
 * Expenses + settings for a board, kept live. `allowed` is false for anyone who isn't a partner
 * (the database returns nothing to them), `canSetUp` when the board owner hasn't set expenses up yet.
 */
export function useExpenses(boardId: string) {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [settings, setSettings] = useState<ExpenseSettings | null>(null);
  const [recurring, setRecurring] = useState<Recurring[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [s, e, r] = await Promise.all([
      supabase.from('expense_settings').select('*').eq('board_id', boardId).maybeSingle(),
      supabase.from('expenses').select('*').eq('board_id', boardId).order('spent_on', { ascending: false }).order('created_at', { ascending: false }),
      supabase.from('expense_recurring').select('*').eq('board_id', boardId).order('next_on'),
    ]);
    setSettings(s.data ? settingsFromRow(s.data) : null);
    setExpenses((e.data ?? []).map(fromRow));
    setRecurring((r.data ?? []).map(recurringFromRow));
    setLoaded(true);
  }, [boardId]);

  useEffect(() => {
    setLoaded(false);
    // Add any repeating costs that fell due since the last visit, then load.
    void runRecurring(boardId).finally(load);
    if (!supabase) return;
    const sb = supabase;
    let t: ReturnType<typeof setTimeout> | undefined;
    const soon = () => {
      clearTimeout(t);
      t = setTimeout(load, 150);
    };
    const ch = sb
      .channel(`expenses:${boardId}:${uid()}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `board_id=eq.${boardId}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_settings', filter: `board_id=eq.${boardId}` }, soon)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expense_recurring', filter: `board_id=eq.${boardId}` }, soon)
      .subscribe();
    return () => {
      clearTimeout(t);
      sb.removeChannel(ch);
    };
  }, [boardId, load]);

  return { expenses, settings, recurring, loaded, reload: load, allowed: !!settings };
}

// ---------------------------------------------------------------- who can see expenses (member settings)

/** Expense settings the current user can see for these boards (only boards where they have access). */
export async function loadExpenseSettings(boardIds: string[]): Promise<ExpenseSettings[]> {
  if (!supabase || boardIds.length === 0) return [];
  const { data, error } = await supabase.from('expense_settings').select('*').in('board_id', boardIds);
  if (error) throw new Error(error.message);
  return (data ?? []).map(settingsFromRow);
}

/** Board ids in a workspace. */
export async function workspaceBoardIds(workspaceId: string): Promise<string[]> {
  if (!supabase) return [];
  const { data } = await supabase.from('boards').select('id').eq('workspace_id', workspaceId);
  return (data ?? []).map((b) => b.id as string);
}

/**
 * Give or take away expenses access. New people get a 0% share: they can see and add costs
 * but aren't part of the cost split (change shares in Budget & settings).
 */
export function withAccess(s: ExpenseSettings, userId: string, on: boolean): ExpenseSettings {
  const has = s.partners.some((p) => p.id === userId);
  if (on && !has) return { ...s, partners: [...s.partners, { id: userId, share: 0 }] };
  if (!on && has) return { ...s, partners: s.partners.filter((p) => p.id !== userId) };
  return s;
}

/** People who actually share costs (share > 0). One or none means solo cost tracking. */
export const sharingPartners = (partners: Partner[]) => partners.filter((p) => p.share > 0);

// ---------------------------------------------------------------- exchange rates

const FX_KEY = 'karlo-fx';

/**
 * Today's rate: how many `to` per 1 `from` (e.g. USD→AED ≈ 3.67). Uses the free open.er-api.com
 * feed (only currency codes are sent), cached for the day. Returns null when offline.
 */
export async function fetchRate(from: string, to: string): Promise<number | null> {
  if (!from || !to || from === to) return 1;
  const day = new Date().toISOString().slice(0, 10);
  try {
    const cache = JSON.parse(localStorage.getItem(FX_KEY) ?? '{}');
    if (cache.day === day && cache.base === to && cache.rates?.[from]) return 1 / cache.rates[from];
  } catch {
    /* ignore */
  }
  try {
    const res = await fetch(`https://open.er-api.com/v6/latest/${encodeURIComponent(to)}`);
    const json = await res.json();
    if (json.result !== 'success' || !json.rates?.[from]) return null;
    try {
      localStorage.setItem(FX_KEY, JSON.stringify({ day, base: to, rates: json.rates }));
    } catch {
      /* ignore */
    }
    return 1 / json.rates[from];
  } catch {
    return null;
  }
}

/** "USD 39" (and, when it differs from the main currency, the converted amount separately). */
export const entryCurrency = (e: Pick<Expense, 'currency'>, main: string) => e.currency || main;
