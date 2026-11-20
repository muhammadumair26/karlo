import { AlertTriangle, Info, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Karlo's own confirm / alert dialogs (instead of the browser's plain pop-ups).
 * Usage: `if (!(await askConfirm({ title, message, confirmLabel, tone: 'danger' }))) return;`
 */
export interface ConfirmOptions {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** danger = red button (deleting/removing); access = granting something; info = plain notice. */
  tone?: 'danger' | 'primary' | 'access' | 'info';
}

function Dialog({ o, alertOnly, done }: { o: ConfirmOptions; alertOnly: boolean; done: (ok: boolean) => void }) {
  const okRef = useRef<HTMLButtonElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const tone = o.tone ?? 'primary';
  useEffect(() => {
    // Safer default focus for destructive actions.
    (tone === 'danger' && !alertOnly ? cancelRef : okRef).current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [done, tone, alertOnly]);

  const Icon = tone === 'danger' ? AlertTriangle : tone === 'access' ? ShieldCheck : Info;
  return (
    <div className="kd-backdrop" onMouseDown={() => done(false)}>
      <div className={`kd kd-${tone}`} role="alertdialog" aria-modal="true" aria-labelledby="kd-title" onMouseDown={(e) => e.stopPropagation()}>
        <div className="kd-head">
          <span className="kd-icon" aria-hidden>
            <Icon size={20} />
          </span>
          <h3 id="kd-title">{o.title}</h3>
        </div>
        {o.message && <div className="kd-msg">{o.message}</div>}
        <div className="kd-actions">
          {!alertOnly && (
            <button ref={cancelRef} className="btn kd-cancel" onClick={() => done(false)}>
              {o.cancelLabel ?? 'Cancel'}
            </button>
          )}
          <button ref={okRef} className={`btn kd-ok ${tone === 'danger' ? 'danger' : tone === 'access' ? 'access' : 'primary'}`} onClick={() => done(true)}>
            {o.confirmLabel ?? (alertOnly ? 'OK' : 'Confirm')}
          </button>
        </div>
      </div>
    </div>
  );
}

function open(o: ConfirmOptions, alertOnly: boolean): Promise<boolean> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const prevFocus = document.activeElement as HTMLElement | null;
    let closed = false;
    const done = (ok: boolean) => {
      if (closed) return;
      closed = true;
      root.unmount();
      host.remove();
      prevFocus?.focus?.();
      resolve(ok);
    };
    root.render(<Dialog o={o} alertOnly={alertOnly} done={done} />);
  });
}

export const askConfirm = (o: ConfirmOptions) => open(o, false);
export const showAlert = (o: Omit<ConfirmOptions, 'cancelLabel'>) => open({ tone: 'info', ...o }, true).then(() => undefined);
