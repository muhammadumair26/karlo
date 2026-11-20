import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase';
import { uid } from './board';

/** One money movement on a project. Settlements are partner-to-partner paybacks (not spending). */
export interface Expense {
  id: string;
  board_id: string;
  kind: 'expense' | 'settlement';
  title: string;
  amount: number;
  category: string;
  spent_on: string; // YYYY-MM-DD
  paid_by: string | null; // partner user id, or null = company account
  paid_to: string | null; // settlements only
  shared: boolean; // split between partners by their share
  card_id: string | null;
  note: string;
  receipt_path: string | null;
  receipt_name: string | null;
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
}

export const CATEGORIES = ['Development', 'Hosting & software', 'Marketing', 'Salaries', 'Legal & licenses', 'Office & rent', 'Travel', 'Inventory', 'Bank & fees', 'Other'];
export const CURRENCIES = ['AED', 'PKR', 'USD', 'SAR', 'EUR', 'GBP'];

export function money(n: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

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
      if (e.paid_by && rows.has(e.paid_by)) rows.get(e.paid_by)!.settled += e.amount;
      if (e.paid_to && rows.has(e.paid_to)) rows.get(e.paid_to)!.settled -= e.amount;
      continue;
    }
    if (!e.shared || !e.paid_by || !rows.has(e.paid_by)) continue;
    rows.get(e.paid_by)!.paid += e.amount;
    for (const [id, f] of frac) rows.get(id)!.share += e.amount * f;
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
export const total = (expenses: Expense[]) => round2(spending(expenses).reduce((n, e) => n + e.amount, 0));

/** Totals per key, largest first. */
export function totalsBy(expenses: Expense[], key: (e: Expense) => string): { key: string; value: number }[] {
  const m = new Map<string, number>();
  for (const e of spending(expenses)) m.set(key(e), (m.get(key(e)) ?? 0) + e.amount);
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
    if (i !== undefined) out[i].value = round2(out[i].value + e.amount);
  }
  return out;
}

export const monthLabel = (ym: string, long = false) =>
  new Date(ym + '-01T00:00:00').toLocaleDateString(undefined, long ? { month: 'long', year: 'numeric' } : { month: 'short' });

export function toCsv(expenses: Expense[], name: (id: string | null) => string, cardTitle: (id: string | null) => string, currency: string) {
  const esc = (v: string | number) => {
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = ['Date', 'Type', 'Title', 'Category', `Amount (${currency})`, 'Paid by', 'Paid to', 'Split between partners', 'Card', 'Note', 'Receipt'];
  const rows = [...expenses]
    .sort((a, b) => a.spent_on.localeCompare(b.spent_on))
    .map((e) => [
      e.spent_on,
      e.kind === 'settlement' ? 'Partner payment' : 'Expense',
      e.title,
      e.kind === 'settlement' ? '' : e.category,
      e.amount.toFixed(2),
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

const fromRow = (r: Record<string, unknown>): Expense => ({ ...(r as unknown as Expense), amount: Number(r.amount) });

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
    .upsert({ board_id: s.board_id, currency: s.currency, budget: s.budget, partners: s.partners, updated_at: new Date().toISOString() });
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
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    if (!supabase) return;
    const [s, e] = await Promise.all([
      supabase.from('expense_settings').select('*').eq('board_id', boardId).maybeSingle(),
      supabase.from('expenses').select('*').eq('board_id', boardId).order('spent_on', { ascending: false }).order('created_at', { ascending: false }),
    ]);
    setSettings(s.data ? { ...(s.data as ExpenseSettings), budget: s.data.budget == null ? null : Number(s.data.budget) } : null);
    setExpenses((e.data ?? []).map(fromRow));
    setLoaded(true);
  }, [boardId]);

  useEffect(() => {
    setLoaded(false);
    load();
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
      .subscribe();
    return () => {
      clearTimeout(t);
      sb.removeChannel(ch);
    };
  }, [boardId, load]);

  return { expenses, settings, loaded, reload: load, allowed: !!settings };
}
