import { AlarmClock, CalendarClock, Sun } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { browserTimezone, getReminderSettings, hourLabel, saveReminderSettings, type ReminderSettings } from '../lib/reminders';
import { showAlert } from './dialog';
import { Modal } from './ui';

const BEFORE = [
  { v: 0, label: 'Only on the due day' },
  { v: 1, label: '1 day before, and on the day' },
  { v: 2, label: '2 days before, and on the day' },
  { v: 3, label: '3 days before, and on the day' },
  { v: 7, label: '1 week before, and on the day' },
];

function Toggle({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`rs-toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)}>
      <span />
    </button>
  );
}

/** Reminders & daily digest: when Karlo nudges you about due dates, and your morning summary. */
export function ReminderSettingsModal({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<ReminderSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
    } catch {
      return ['Asia/Dubai', 'Asia/Karachi', 'Asia/Riyadh', 'Europe/London', 'America/New_York'];
    }
  }, []);

  useEffect(() => {
    getReminderSettings().then(setS);
  }, []);
  const set = (p: Partial<ReminderSettings>) => s && setS({ ...s, ...p });

  const save = async () => {
    if (!s) return;
    setBusy(true);
    try {
      await saveReminderSettings(s);
      try {
        // A zone picked by hand stays; otherwise it follows this device.
        if (s.timezone !== browserTimezone()) localStorage.setItem('karlo-tz-pinned', '1');
        else localStorage.removeItem('karlo-tz-pinned');
      } catch {
        /* ignore */
      }
      onClose();
    } catch (e) {
      setBusy(false);
      void showAlert({ title: "Couldn't save", message: (e as Error).message, tone: 'danger' });
    }
  };

  return (
    <Modal title="Reminders & daily digest" onClose={onClose}>
      <div className="ex-form rs">
        <p className="rs-lead">Karlo reminds you about cards you created or are a member of. Reminders arrive in the bell and, if turned on, as push notifications on this device.</p>
        {!s ? (
          <p className="muted">Loading…</p>
        ) : (
          <>
            <div className="rs-row">
              <AlarmClock size={18} />
              <div className="rs-text">
                <strong>Due-date reminders</strong>
                <select className="field-select" value={s.remind_before} disabled={!s.due_reminders} onChange={(e) => set({ remind_before: Number(e.target.value) })}>
                  {BEFORE.map((b) => (
                    <option key={b.v} value={b.v}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>
              <Toggle on={s.due_reminders} onChange={(v) => set({ due_reminders: v })} label="Due-date reminders" />
            </div>
            <div className="rs-row">
              <CalendarClock size={18} />
              <div className="rs-text">
                <strong>Overdue reminder</strong>
                <span className="muted">Once, the first morning a card is late</span>
              </div>
              <Toggle on={s.overdue} onChange={(v) => set({ overdue: v })} label="Overdue reminder" />
            </div>
            <div className="rs-row">
              <Sun size={18} />
              <div className="rs-text">
                <strong>Daily digest</strong>
                <span className="muted">Due today, overdue, due this week and unread — skipped when there's nothing</span>
              </div>
              <Toggle on={s.digest} onChange={(v) => set({ digest: v })} label="Daily digest" />
            </div>
            <div className="ex-form-row">
              <label className="pop-field">
                Send at
                <select className="field-select" value={s.digest_hour} onChange={(e) => set({ digest_hour: Number(e.target.value) })}>
                  {Array.from({ length: 24 }, (_, h) => (
                    <option key={h} value={h}>
                      {hourLabel(h)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="pop-field">
                Time zone
                <select className="field-select" value={s.timezone} onChange={(e) => set({ timezone: e.target.value })}>
                  {[...new Set([s.timezone, ...zones])].map((z) => (
                    <option key={z} value={z}>
                      {z.replace(/_/g, ' ')}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="muted rs-note">Reminders and the digest go out within the hour after {hourLabel(s.digest_hour)} ({s.timezone.replace(/_/g, ' ')}). Email delivery can be added later.</p>
            <div className="ex-form-actions">
              <button type="button" className="btn ghost" onClick={onClose}>
                Cancel
              </button>
              <button className="btn primary" disabled={busy} onClick={save}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
