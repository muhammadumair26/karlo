import { X } from 'lucide-react';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { handleOf } from '../lib/notify';
import type { Person } from '../lib/types';
import { ROLE_INFO } from '../lib/types';
import { Avatar } from './ui';

export interface MemberCardTarget {
  person: Person;
  rect: DOMRect; // the avatar that was clicked
}

/** Trello-style member pop-up, anchored under the avatar that was clicked. */
export function MemberCard({
  target,
  isMe,
  canAddToWorkspace,
  onClose,
  onViewProfile,
  onViewActivity,
  onAddToWorkspace,
  onEditProfile,
}: {
  target: MemberCardTarget;
  isMe: boolean;
  canAddToWorkspace: boolean;
  onClose: () => void;
  onViewProfile: () => void;
  onViewActivity: () => void;
  onAddToWorkspace: () => Promise<void>;
  onEditProfile: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ top: target.rect.bottom + 8, left: target.rect.left });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const p = target.person;

  // Keep the card on screen.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    let left = Math.min(target.rect.left, window.innerWidth - w - 8);
    left = Math.max(8, left);
    let top = target.rect.bottom + 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, target.rect.top - h - 8);
    setPos({ top, left });
  }, [target]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal(
    <>
      <div className="member-scrim" onMouseDown={onClose} />
      <div ref={ref} className="member-card" style={{ top: pos.top, left: pos.left }} role="dialog" aria-label={p.name}>
        <div className="member-card-head">
          <div className="member-card-photo">
            <Avatar id={p.user_id} name={p.name} src={p.avatar_url} size={104} />
          </div>
          <div className="member-card-names">
            <strong>{p.name}</strong>
            <span>@{handleOf(p)}</span>
            {p.title && <span className="member-card-title">{p.title}</span>}
          </div>
          <button className="member-card-close" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="member-card-body">
          <button onClick={onViewProfile}>View profile</button>
          {isMe && <button onClick={onEditProfile}>Edit profile</button>}
          <hr />
          <button onClick={onViewActivity}>View member’s board activity</button>
          {canAddToWorkspace && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setMsg(null);
                try {
                  await onAddToWorkspace();
                  setMsg(`${p.name} is now a member of this workspace.`);
                } catch (e) {
                  setMsg((e as Error).message);
                }
                setBusy(false);
              }}
            >
              {busy ? 'Adding…' : 'Add to workspace'}
            </button>
          )}
          {msg && <p className="member-card-msg">{msg}</p>}
          <p className="member-card-role">
            {ROLE_INFO[p.role].label}
            {p.via === 'board' ? ' · this board only' : ' · workspace member'}
          </p>
        </div>
      </div>
    </>,
    document.body,
  );
}
