import { useCallback, useEffect, useState } from 'react';
import * as api from '../lib/api';
import type { Me, Person, Role } from '../lib/types';
import { ROLE_INFO } from '../lib/types';
import { publicOrigin } from '../lib/platform';
import { Avatar, RoleSelect } from './ui';

/** Member list + invite form for a workspace or a single board. */
export function MembersPanel({
  target,
  me,
  canManage,
  onChanged,
}: {
  target: { workspaceId?: string; boardId?: string };
  me: Me;
  canManage: boolean;
  onChanged?: () => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [invites, setInvites] = useState<api.Invite[]>([]);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const isBoard = !!target.boardId;

  const reload = useCallback(async () => {
    try {
      const [p, inv] = await Promise.all([
        isBoard ? api.boardPeople(target.boardId!) : api.workspacePeople(target.workspaceId!),
        canManage ? api.pendingInvites(target) : Promise.resolve([]),
      ]);
      setPeople(p);
      setInvites(inv);
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.boardId, target.workspaceId, canManage]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    const addr = email.trim();
    if (!addr) return;
    setBusy(true);
    setMsg(null);
    try {
      const res = await api.inviteMember(addr, role, target);
      setMsg({
        kind: 'ok',
        text:
          res === 'added'
            ? `${addr} now has access as ${ROLE_INFO[role].label}.`
            : `Invite saved. Ask ${addr} to sign up at ${publicOrigin()} with this email — they'll get access automatically.`,
      });
      setEmail('');
      await reload();
      onChanged?.();
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    }
    setBusy(false);
  };

  const change = async (p: Person, r: Role | 'remove') => {
    if (r === 'remove' && !confirm(`Remove ${p.name} from this ${isBoard ? 'board' : 'workspace'}?`)) return;
    try {
      await api.updateMember(p.user_id, r, target);
      await reload();
      onChanged?.();
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    }
  };

  return (
    <div className="members-panel">
      {canManage && (
        <form className="invite-form" onSubmit={invite}>
          <input type="email" required placeholder="Email address" value={email} onChange={(e) => setEmail(e.target.value)} />
          <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {(['admin', 'member', 'viewer'] as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_INFO[r].label}
              </option>
            ))}
          </select>
          <button className="btn primary" disabled={busy}>
            {busy ? 'Inviting…' : 'Invite'}
          </button>
        </form>
      )}
      {msg && <div className={msg.kind === 'ok' ? 'auth-info' : 'auth-error'}>{msg.text}</div>}

      <ul className="people">
        {people.map((p) => {
          const viaWorkspace = isBoard && p.via === 'workspace';
          return (
            <li key={p.user_id + (p.via ?? '')}>
              <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={32} />
              <div className="person-info">
                <div className="person-name">
                  {p.name} {p.user_id === me.id && <span className="muted">(you)</span>}
                </div>
                <div className="muted">
                  {p.title ? `${p.title} · ` : ''}
                  {p.email}
                  {viaWorkspace && ' · via workspace'}
                </div>
              </div>
              <RoleSelect
                value={p.role}
                disabled={!canManage || viaWorkspace || p.user_id === me.id}
                allowRemove
                onChange={(r) => change(p, r)}
              />
            </li>
          );
        })}
      </ul>

      {invites.length > 0 && (
        <>
          <h4>Pending invites</h4>
          <ul className="people">
            {invites.map((i) => (
              <li key={i.id}>
                <span className="avatar pending">✉</span>
                <div className="person-info">
                  <div className="person-name">{i.email}</div>
                  <div className="muted">Waiting for them to sign up · {ROLE_INFO[i.role].label}</div>
                </div>
                <button
                  className="btn ghost small"
                  onClick={async () => {
                    await api.cancelInvite(i.id);
                    await reload();
                  }}
                >
                  Cancel
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <details className="roles-help">
        <summary>What can each role do?</summary>
        <ul>
          {(Object.keys(ROLE_INFO) as Role[]).map((r) => (
            <li key={r}>
              <strong>{ROLE_INFO[r].label}:</strong> {ROLE_INFO[r].desc}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
