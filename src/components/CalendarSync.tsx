import { CalendarPlus, Check, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { feedUrl, getFeed, googleAddUrl, resetFeed, setFeedScope, webcalUrl, type CalendarFeed } from '../lib/calendarFeed';
import { askConfirm, showAlert } from './dialog';
import { Modal } from './ui';

/** "Sync with Google Calendar": a private subscription link of your card due dates. */
export function CalendarSyncModal({ onClose }: { onClose: () => void }) {
  const [feed, setFeed] = useState<CalendarFeed | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getFeed().then(setFeed, (e) => setErr((e as Error).message));
  }, []);

  const copy = async () => {
    if (!feed) return;
    try {
      await navigator.clipboard.writeText(feedUrl(feed.token));
    } catch {
      const i = document.querySelector<HTMLInputElement>('.cs-link input');
      i?.select();
      document.execCommand('copy');
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const changeScope = async (scope: CalendarFeed['scope']) => {
    if (!feed || feed.scope === scope) return;
    setFeed({ ...feed, scope });
    try {
      await setFeedScope(scope);
    } catch (e) {
      void showAlert({ title: "Couldn't change it", message: (e as Error).message, tone: 'danger' });
    }
  };

  const reset = async () => {
    if (
      !(await askConfirm({
        title: 'Make a new calendar link?',
        message: 'The current link stops working right away. Calendars that use it stop updating until you add the new link.',
        confirmLabel: 'Make new link',
        tone: 'danger',
      }))
    )
      return;
    setBusy(true);
    try {
      const token = await resetFeed();
      setFeed((f) => (f ? { ...f, token } : f));
    } catch (e) {
      void showAlert({ title: "Couldn't make a new link", message: (e as Error).message, tone: 'danger' });
    }
    setBusy(false);
  };

  return (
    <Modal title="Sync with Google Calendar" onClose={onClose}>
      <div className="ex-form cs">
        <p className="cs-lead">
          Your Karlo due dates appear in Google Calendar (and Apple Calendar or Outlook) and stay up to date by themselves. Each card is an all-day event that opens the card when clicked.
        </p>
        {err && <div className="auth-error">{err}</div>}
        {!feed && !err && <p className="muted">Preparing your private link…</p>}
        {feed && (
          <>
            <div className="pop-field">
              Which cards
              <div className="cs-scope">
                <label className={feed.scope === 'mine' ? 'on' : ''}>
                  <input type="radio" name="cs-scope" checked={feed.scope === 'mine'} onChange={() => changeScope('mine')} />
                  <span>
                    <strong>My cards</strong>
                    <span className="muted">Cards I created or am a member of</span>
                  </span>
                </label>
                <label className={feed.scope === 'all' ? 'on' : ''}>
                  <input type="radio" name="cs-scope" checked={feed.scope === 'all'} onChange={() => changeScope('all')} />
                  <span>
                    <strong>Everything</strong>
                    <span className="muted">All cards with a due date on my boards</span>
                  </span>
                </label>
              </div>
            </div>

            <a className="btn primary cs-google" href={googleAddUrl(feed.token)} target="_blank" rel="noopener noreferrer">
              <CalendarPlus size={16} /> Add to Google Calendar
            </a>

            <div className="pop-field">
              Or copy your private link
              <div className="cs-link">
                <input readOnly value={feedUrl(feed.token)} onFocus={(e) => e.target.select()} aria-label="Calendar link" />
                <button className="btn" onClick={copy}>
                  {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            <details className="cs-steps">
              <summary>Step by step: Google Calendar on a computer</summary>
              <ol>
                <li>Open calendar.google.com.</li>
                <li>On the left, next to <strong>Other calendars</strong>, click <strong>+</strong> → <strong>From URL</strong>.</li>
                <li>Paste the link above and click <strong>Add calendar</strong>.</li>
                <li>It appears as “{feed.scope === 'mine' ? 'Karlo – my cards' : 'Karlo – all my boards'}” — on your phone's Google Calendar app too.</li>
              </ol>
            </details>
            <details className="cs-steps">
              <summary>iPhone / Apple Calendar or Outlook</summary>
              <p>
                <a href={webcalUrl(feed.token)}>
                  Subscribe with Apple Calendar or Outlook <ExternalLink size={12} />
                </a>{' '}
                — or in Outlook choose <strong>Add calendar → Subscribe from web</strong> and paste the link.
              </p>
            </details>

            <p className="muted cs-note">
              Google refreshes subscribed calendars on its own schedule — usually within a few hours — so new or moved due dates can take a while to show. Keep this link private: anyone with it can see your card titles and dates.
            </p>
            <div className="ex-form-actions cs-actions">
              <button className="btn ghost" onClick={reset} disabled={busy}>
                <RefreshCw size={14} /> Make a new link
              </button>
              <span className="header-spacer" />
              <button className="btn primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
