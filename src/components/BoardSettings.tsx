import { AtSign, CalendarDays, Lock, Plus, Trash2, UserCheck, UserPlus } from 'lucide-react';
import { useState } from 'react';
import type { BoardActionBody } from '../lib/board';
import { boardSettings, DEFAULT_BOARD_SETTINGS, type BoardData, type BoardSettings } from '../lib/types';
import { Modal } from './ui';

const DUE_DEFAULTS: { v: number | null; label: string }[] = [
  { v: null, label: 'No default — pick each time' },
  { v: 0, label: 'Today' },
  { v: 1, label: 'Tomorrow' },
  { v: 3, label: 'In 3 days' },
  { v: 7, label: 'In a week' },
  { v: 14, label: 'In 2 weeks' },
];

function Toggle({ on, onChange, label, disabled }: { on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled} className={`rs-toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** Board rules: due dates, responsibility, who may add or delete cards, @mentions. Admins edit; others can read. */
export function BoardSettingsModal({
  data,
  admin,
  dispatch,
  onClose,
}: {
  data: BoardData;
  admin: boolean;
  dispatch: (a: BoardActionBody) => void;
  onClose: () => void;
}) {
  const [s, setS] = useState<BoardSettings>(boardSettings(data));
  const set = (p: Partial<BoardSettings>) => setS({ ...s, ...p });
  const changed = JSON.stringify(s) !== JSON.stringify(boardSettings(data));

  const save = () => {
    if (changed) dispatch({ type: 'SET_SETTINGS', settings: s });
    onClose();
  };

  return (
    <Modal title="Board settings" onClose={onClose}>
      <div className="ex-form rs bs">
        {!admin && (
          <p className="bs-readonly">
            <Lock size={13} /> Only board admins can change these settings.
          </p>
        )}

        <h5 className="bs-h">New cards</h5>
        <div className="rs-row">
          <CalendarDays size={18} />
          <div className="rs-text">
            <strong>Due date required</strong>
            <span className="muted">A card can't be added without a due date</span>
          </div>
          <Toggle on={s.requireDue} onChange={(v) => set({ requireDue: v })} label="Due date required" disabled={!admin} />
        </div>
        <div className="rs-row">
          <CalendarDays size={18} className="bs-faint" />
          <div className="rs-text">
            <strong>Default due date</strong>
            <select className="field-select" value={s.defaultDueDays ?? ''} disabled={!admin} onChange={(e) => set({ defaultDueDays: e.target.value === '' ? null : Number(e.target.value) })}>
              {DUE_DEFAULTS.map((d) => (
                <option key={String(d.v)} value={d.v ?? ''}>
                  {d.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="rs-row">
          <UserCheck size={18} />
          <div className="rs-text">
            <strong>Responsible person required</strong>
            <span className="muted">Pick a member when adding a card (they get its reminders)</span>
          </div>
          <Toggle on={s.requireMember} onChange={(v) => set({ requireMember: v })} label="Responsible person required" disabled={!admin} />
        </div>

        <h5 className="bs-h">Permissions</h5>
        <div className="rs-row">
          <Plus size={18} />
          <div className="rs-text">
            <strong>Who can add cards</strong>
            <select className="field-select" value={s.addCards} disabled={!admin} onChange={(e) => set({ addCards: e.target.value as BoardSettings['addCards'] })}>
              <option value="editors">Everyone who can edit the board</option>
              <option value="admins">Admins only</option>
            </select>
          </div>
        </div>
        <div className="rs-row">
          <Trash2 size={18} />
          <div className="rs-text">
            <strong>Who can delete cards</strong>
            <select className="field-select" value={s.deleteCards} disabled={!admin} onChange={(e) => set({ deleteCards: e.target.value as BoardSettings['deleteCards'] })}>
              <option value="owner_admin">The card's owner and admins</option>
              <option value="editors">Everyone who can edit the board</option>
            </select>
          </div>
        </div>

        <h5 className="bs-h">Mentions</h5>
        <div className="rs-row">
          <AtSign size={18} />
          <div className="rs-text">
            <strong>@mention adds the person to the card</strong>
            <span className="muted">Mentioned people become members (responsible)</span>
          </div>
          <Toggle on={s.mentionAssigns} onChange={(v) => set({ mentionAssigns: v })} label="Mention adds member" disabled={!admin} />
        </div>
        <div className="rs-row">
          <UserPlus size={18} />
          <div className="rs-text">
            <strong>Editing a card adds you as a member</strong>
            <span className="muted">Change a card you don't own and you join it, so it's clear who worked on it</span>
          </div>
          <Toggle on={s.editJoins} onChange={(v) => set({ editJoins: v })} label="Editing adds member" disabled={!admin} />
        </div>

        <div className="ex-form-actions">
          {admin && JSON.stringify(s) !== JSON.stringify(DEFAULT_BOARD_SETTINGS) && (
            <button type="button" className="btn ghost bs-reset" onClick={() => setS(DEFAULT_BOARD_SETTINGS)}>
              Reset to defaults
            </button>
          )}
          <span className="header-spacer" />
          <button type="button" className="btn ghost" onClick={onClose}>
            {admin ? 'Cancel' : 'Close'}
          </button>
          {admin && (
            <button className="btn primary" onClick={save} disabled={!changed}>
              Save
            </button>
          )}
        </div>
      </div>
    </Modal>
  );
}
