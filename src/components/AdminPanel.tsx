import { ArrowLeft, Building2, Check, Copy, Plus, RefreshCw, Search } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ClientRow } from '../lib/api';
import * as api from '../lib/api';
import { access, formatBytes, PLAN_IDS, PLANS, type PlanId } from '../lib/plans';
import { Avatar, Modal } from './ui';

type Filter = 'all' | 'trial' | 'paying' | 'ending' | 'readonly' | 'suspended';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'trial', label: 'On trial' },
  { id: 'paying', label: 'Paying' },
  { id: 'ending', label: 'Ending soon' },
  { id: 'readonly', label: 'Read-only' },
  { id: 'suspended', label: 'Suspended' },
];

const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
const ago = (iso: string | null) => {
  if (!iso) return 'never';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d} days ago` : day(iso);
};
/** yyyy-mm-dd for <input type=date>, and back (end of that day, local time). */
const toInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const fromInput = (v: string) => (v ? new Date(`${v}T23:59:00`).toISOString() : null);
const addDays = (iso: string | null, n: number) => {
  const base = iso && new Date(iso).getTime() > Date.now() ? new Date(iso) : new Date();
  base.setDate(base.getDate() + n);
  return base.toISOString();
};
const monthly = (c: ClientRow) => (c.plan === 'trial' || c.status === 'suspended' ? 0 : PLANS[c.plan].price * (c.seats ?? c.people));
const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

function PlanPill({ plan }: { plan: PlanId }) {
  return (
    <span className="adm-plan" style={{ color: PLANS[plan].color, background: `${PLANS[plan].color}18` }}>
      {PLANS[plan].label}
    </span>
  );
}

function StatePill({ c }: { c: ClientRow }) {
  const a = access(c);
  return <span className={`adm-state ${a.state}`}>{a.label}</span>;
}

/** The owner's panel for renting Karlo out: every client workspace, its plan, usage and dates. */
export function AdminPanel({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<ClientRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [editing, setEditing] = useState<ClientRow | null>(null);
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setErr(null);
    try {
      setRows(await api.listClients());
    } catch (e) {
      setErr((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const all = useMemo(() => rows ?? [], [rows]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all.filter((c) => {
      const a = access(c).state;
      if (filter === 'trial' && c.plan !== 'trial') return false;
      if (filter === 'paying' && (c.plan === 'trial' || a === 'readonly' || a === 'suspended')) return false;
      if (filter === 'ending' && a !== 'ending') return false;
      if (filter === 'readonly' && a !== 'readonly') return false;
      if (filter === 'suspended' && a !== 'suspended') return false;
      return !s || [c.name, c.owner_name, c.owner_email, c.pending_owner].some((x) => x?.toLowerCase().includes(s));
    });
  }, [all, q, filter]);

  const stats = useMemo(() => {
    const st = all.map((c) => access(c).state);
    return {
      clients: all.length,
      paying: all.filter((c, i) => c.plan !== 'trial' && (st[i] === 'ok' || st[i] === 'ending')).length,
      trial: all.filter((c, i) => c.plan === 'trial' && st[i] !== 'readonly' && st[i] !== 'suspended').length,
      attention: st.filter((s) => s === 'ending' || s === 'readonly').length,
      people: all.reduce((n, c) => n + c.people, 0),
      mrr: all.filter((_, i) => st[i] === 'ok' || st[i] === 'ending').reduce((n, c) => n + monthly(c), 0),
    };
  }, [all]);

  return (
    <div className="adm">
      <div className="adm-head">
        <button className="icon-btn adm-back" onClick={onClose} title="Back to boards" aria-label="Back to boards">
          <ArrowLeft size={18} />
        </button>
        <div>
          <h2>Clients</h2>
          <p className="muted">Every client gets their own workspace. You see their numbers, never their boards.</p>
        </div>
        <span className="header-spacer" />
        <button className="icon-btn" onClick={() => void load()} title="Refresh" aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
        <button className="btn primary" onClick={() => setCreating(true)}>
          <Plus size={15} /> New client
        </button>
      </div>

      <div className="adm-stats">
        <div className="adm-stat">
          <span>Clients</span>
          <b>{stats.clients}</b>
        </div>
        <div className="adm-stat">
          <span>Paying</span>
          <b>{stats.paying}</b>
        </div>
        <div className="adm-stat">
          <span>On trial</span>
          <b>{stats.trial}</b>
        </div>
        <div className={`adm-stat ${stats.attention ? 'warn' : ''}`}>
          <span>Need attention</span>
          <b>{stats.attention}</b>
        </div>
        <div className="adm-stat">
          <span>People</span>
          <b>{stats.people}</b>
        </div>
        <div className="adm-stat money">
          <span>Monthly revenue</span>
          <b>{money(stats.mrr)}</b>
        </div>
      </div>

      <div className="adm-tools">
        <label className="adm-search">
          <Search size={15} />
          <input placeholder="Search clients, owners, emails…" value={q} onChange={(e) => setQ(e.target.value)} />
        </label>
        <div className="adm-filters" role="tablist">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {err && <div className="auth-error">{err}</div>}
      {!rows && !err && <p className="muted adm-empty">Loading clients…</p>}
      {rows && shown.length === 0 && (
        <div className="adm-empty">
          <Building2 size={34} />
          <p className="muted">{all.length ? 'No clients match.' : 'No clients yet. Add your first one.'}</p>
        </div>
      )}

      {shown.length > 0 && (
        <div className="adm-list">
          <div className="adm-row adm-row-head">
            <span>Client</span>
            <span>Plan</span>
            <span>Status</span>
            <span className="num">People</span>
            <span className="num">Boards</span>
            <span className="num">Storage</span>
            <span>Last active</span>
            <span className="num">Monthly</span>
          </div>
          {shown.map((c) => (
            <button key={c.id} className="adm-row" onClick={() => setEditing(c)}>
              <span className="adm-client">
                <Avatar id={c.id} name={c.name} size={34} />
                <span>
                  <b>{c.name}</b>
                  <small className="muted">{c.owner_email ? `${c.owner_name ?? ''} · ${c.owner_email}` : c.pending_owner ? `Waiting for ${c.pending_owner} to sign up` : 'No owner'}</small>
                </span>
              </span>
              <span data-label="Plan">
                <PlanPill plan={c.plan} />
              </span>
              <span data-label="Status">
                <StatePill c={c} />
              </span>
              <span className="num" data-label="People">
                {c.people}
                {c.seats ? <small className="muted"> / {c.seats}</small> : null}
              </span>
              <span className="num" data-label="Boards">
                {c.boards}
              </span>
              <span className="num" data-label="Storage">
                {formatBytes(c.storage_bytes)}
              </span>
              <span data-label="Last active">{ago(c.last_active)}</span>
              <span className="num adm-mrr" data-label="Monthly">
                {monthly(c) ? money(monthly(c)) : '—'}
              </span>
            </button>
          ))}
        </div>
      )}

      {editing && (
        <EditClient
          client={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            await load();
          }}
        />
      )}
      {creating && <NewClient onClose={() => setCreating(false)} onCreated={load} />}
    </div>
  );
}

function EditClient({ client, onClose, onSaved }: { client: ClientRow; onClose: () => void; onSaved: () => void }) {
  const [c, setC] = useState(client);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const trial = c.plan === 'trial';
  const endKey = trial ? 'trial_ends_at' : 'paid_until';
  const end = c[endKey];
  const a = access(c);

  const save = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.updateClient(c);
      onSaved();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title={client.name} onClose={onClose}>
      <div className="ex-form adm-edit">
        <div className="adm-edit-now">
          <PlanPill plan={client.plan} />
          <StatePill c={client} />
          <span className="muted">
            {client.people} people · {client.boards} boards · {formatBytes(client.storage_bytes)} of {PLANS[client.plan].storageGb} GB · since {day(client.created_at)}
          </span>
        </div>

        <label className="field">
          <span>Client name</span>
          <input className="text-input" value={c.name} onChange={(e) => setC({ ...c, name: e.target.value })} />
        </label>

        <div className="field">
          <span>Plan</span>
          <div className="adm-plan-pick">
            {PLAN_IDS.map((p) => (
              <button
                key={p}
                type="button"
                className={c.plan === p ? 'on' : ''}
                onClick={() =>
                  setC({
                    ...c,
                    plan: p,
                    trial_ends_at: p === 'trial' ? c.trial_ends_at ?? addDays(null, 14) : c.trial_ends_at,
                    paid_until: p !== 'trial' ? c.paid_until ?? addDays(null, 30) : c.paid_until,
                  })
                }
              >
                <b>{PLANS[p].label}</b>
                <small>{p === 'trial' ? 'Free, all Pro features' : `$${PLANS[p].price} / person / month`}</small>
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <span>{trial ? 'Trial ends' : 'Paid until'}</span>
          <div className="adm-date-row">
            <input className="text-input" type="date" value={toInput(end)} onChange={(e) => setC({ ...c, [endKey]: fromInput(e.target.value) })} />
            {trial ? (
              <button type="button" className="btn small" onClick={() => setC({ ...c, trial_ends_at: addDays(end, 7) })}>
                +7 days
              </button>
            ) : (
              <>
                <button type="button" className="btn small" onClick={() => setC({ ...c, paid_until: addDays(end, 30) })}>
                  +1 month
                </button>
                <button type="button" className="btn small" onClick={() => setC({ ...c, paid_until: addDays(end, 365) })}>
                  +1 year
                </button>
              </>
            )}
            <label className="adm-check">
              <input type="checkbox" checked={!end} onChange={(e) => setC({ ...c, [endKey]: e.target.checked ? null : addDays(null, trial ? 14 : 30) })} />
              No end date
            </label>
          </div>
          <small className="muted">
            {a.state === 'readonly' ? 'Read-only now: they can look but not change anything until you extend it.' : 'When this date passes the workspace becomes read-only (paid plans get 3 days’ grace). Nothing is deleted.'}
          </small>
        </div>

        {!trial && (
          <label className="field">
            <span>Paid seats (people they pay for)</span>
            <input
              className="text-input adm-seats"
              type="number"
              min={1}
              placeholder={`${c.people} (everyone in it)`}
              value={c.seats ?? ''}
              onChange={(e) => setC({ ...c, seats: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
            />
            <small className="muted">
              {money(PLANS[c.plan].price * (c.seats ?? c.people))} / month at ${PLANS[c.plan].price} × {c.seats ?? c.people}
            </small>
          </label>
        )}

        <label className="field">
          <span>Private notes (only you see these)</span>
          <textarea className="text-input" rows={3} value={c.admin_notes} placeholder="Contact person, how they pay, discounts…" onChange={(e) => setC({ ...c, admin_notes: e.target.value })} />
        </label>

        <div className={`adm-suspend ${c.status === 'suspended' ? 'on' : ''}`}>
          <div>
            <b>{c.status === 'suspended' ? 'Suspended' : 'Suspend this client'}</b>
            <small className="muted">{c.status === 'suspended' ? 'Nobody in it can open their boards. Nothing is deleted.' : 'Locks the workspace at once — e.g. for an unpaid bill. Nothing is deleted.'}</small>
          </div>
          <button type="button" className={`btn small ${c.status === 'suspended' ? '' : 'danger'}`} onClick={() => setC({ ...c, status: c.status === 'suspended' ? 'active' : 'suspended' })}>
            {c.status === 'suspended' ? 'Reactivate' : 'Suspend'}
          </button>
        </div>

        {err && <div className="auth-error">{err}</div>}
        <div className="ex-form-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <span className="header-spacer" />
          <button className="btn primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function NewClient({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [plan, setPlan] = useState<PlanId>('trial');
  const [trialDays, setTrialDays] = useState(14);
  const [paidUntil, setPaidUntil] = useState(toInput(addDays(null, 30)));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [copied, setCopied] = useState(false);
  const link = 'https://karlo.orionsoftsol.com';
  const message = `Your Karlo workspace "${name.trim()}" is ready. Sign up or sign in at ${link} with ${email.trim()} and you'll find it there.`;

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.createClient({ name: name.trim(), email: email.trim(), plan, trialDays, paidUntil: plan === 'trial' ? null : fromInput(paidUntil) });
      setDone(true);
      onCreated();
    } catch (e) {
      setErr((e as Error).message);
    }
    setBusy(false);
  };

  return (
    <Modal title={done ? 'Client added' : 'New client'} onClose={onClose}>
      {done ? (
        <div className="ex-form adm-edit">
          <p>
            <b>{name.trim()}</b> has its own workspace now. <b>{email.trim()}</b> is the owner — send them this:
          </p>
          <div className="adm-message">{message}</div>
          <div className="ex-form-actions">
            <button
              className="btn"
              onClick={() => {
                void navigator.clipboard?.writeText(message);
                setCopied(true);
              }}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? 'Copied' : 'Copy message'}
            </button>
            <span className="header-spacer" />
            <button className="btn primary" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <form
          className="ex-form adm-edit"
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
        >
          <label className="field">
            <span>Company / client name</span>
            <input className="text-input" autoFocus required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Acme Trading LLC" />
          </label>
          <label className="field">
            <span>Owner’s email</span>
            <input className="text-input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="owner@acme.com" />
            <small className="muted">They become the workspace owner and can invite their own team.</small>
          </label>
          <div className="field">
            <span>Plan</span>
            <div className="adm-plan-pick">
              {PLAN_IDS.map((p) => (
                <button key={p} type="button" className={plan === p ? 'on' : ''} onClick={() => setPlan(p)}>
                  <b>{PLANS[p].label}</b>
                  <small>{p === 'trial' ? 'Free, all Pro features' : `$${PLANS[p].price} / person / month`}</small>
                </button>
              ))}
            </div>
          </div>
          {plan === 'trial' ? (
            <label className="field">
              <span>Trial length (days)</span>
              <input className="text-input adm-seats" type="number" min={1} max={90} value={trialDays} onChange={(e) => setTrialDays(Math.max(1, Number(e.target.value) || 14))} />
            </label>
          ) : (
            <label className="field">
              <span>Paid until</span>
              <input className="text-input adm-seats" type="date" value={paidUntil} onChange={(e) => setPaidUntil(e.target.value)} />
            </label>
          )}
          {err && <div className="auth-error">{err}</div>}
          <div className="ex-form-actions">
            <button type="button" className="btn ghost" onClick={onClose}>
              Cancel
            </button>
            <span className="header-spacer" />
            <button className="btn primary" type="submit" disabled={busy || !name.trim() || !email.trim()}>
              {busy ? 'Adding…' : 'Add client'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
