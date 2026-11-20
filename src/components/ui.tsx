import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { Person, Role } from '../lib/types';
import { ROLE_INFO } from '../lib/types';
import { useOnline } from '../lib/presence';

const AVATAR_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#4f46e5'];

export function initials(name: string) {
  const parts = name.trim().split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? '?') + (parts[1]?.[0] ?? '')).toUpperCase();
}

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function Avatar({
  id,
  name,
  size = 28,
  title,
  src,
}: {
  id: string;
  name: string;
  size?: number;
  title?: string;
  src?: string | null;
}) {
  const isOnline = useOnline(id);
  const label = (title ?? name) + (isOnline ? ' · Active now' : '');
  const face = src ? (
    <img className="avatar photo" src={src} alt={name} title={label} width={size} height={size} loading="lazy" style={{ width: size, height: size }} />
  ) : (
    <span className="avatar" title={label} style={{ width: size, height: size, fontSize: size * 0.4, background: colorFor(id || name) }}>
      {initials(name)}
    </span>
  );
  if (!isOnline) return face;
  // Green "active now" dot, like Trello / Slack.
  const dot = Math.max(8, Math.round(size * 0.3));
  return (
    <span className="avatar-wrap">
      {face}
      <span className="online-dot" style={{ width: dot, height: dot }} aria-label="Active now" />
    </span>
  );
}

export function AvatarStack({ ids, people, max = 3, size = 24 }: { ids: string[]; people: Map<string, Person>; max?: number; size?: number }) {
  if (ids.length === 0) return null;
  const shown = ids.slice(0, max);
  return (
    <span className="avatar-stack">
      {shown.map((id) => (
        <Avatar key={id} id={id} name={people.get(id)?.name ?? '?'} src={people.get(id)?.avatar_url} size={size} />
      ))}
      {ids.length > max && (
        <span className="avatar more" style={{ width: size, height: size, fontSize: size * 0.4 }}>
          +{ids.length - max}
        </span>
      )}
    </span>
  );
}

export function Modal({
  title,
  onClose,
  children,
  wide,
  bare,
  className,
}: {
  title?: ReactNode;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** No padding and no built-in close button (the content draws its own). */
  bare?: boolean;
  className?: string;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  // Rendered at the page root so it always sits above the top bar, sidebar and board.
  return createPortal(
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className={`modal ${wide ? 'wide' : ''} ${bare ? 'bare' : ''} ${className ?? ''}`}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
      >
        {!bare && (
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
        {title && <h3 className="modal-heading">{title}</h3>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function RoleSelect({
  value,
  onChange,
  disabled,
  allowRemove,
}: {
  value: Role;
  onChange: (r: Role | 'remove') => void;
  disabled?: boolean;
  allowRemove?: boolean;
}) {
  if (value === 'owner' || disabled) return <span className={`role-pill role-${value}`}>{ROLE_INFO[value].label}</span>;
  return (
    <select className="role-select" value={value} onChange={(e) => onChange(e.target.value as Role | 'remove')}>
      {(['admin', 'member', 'viewer'] as Role[]).map((r) => (
        <option key={r} value={r}>
          {ROLE_INFO[r].label}
        </option>
      ))}
      {allowRemove && <option value="remove">Remove…</option>}
    </select>
  );
}

export function Menu({ open, onClose, children, align = 'right' }: { open: boolean; onClose: () => void; children: ReactNode; align?: 'left' | 'right' | 'up' }) {
  useEffect(() => {
    if (!open) return;
    const close = () => onClose();
    const t = window.setTimeout(() => window.addEventListener('click', close), 0);
    return () => {
      window.clearTimeout(t);
      window.removeEventListener('click', close);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className={`menu ${align}`} onClick={(e) => e.stopPropagation()}>
      {children}
    </div>
  );
}

export function download(filename: string, content: string, type = 'application/json') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function timeAgo(ts: number) {
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(ts).toLocaleDateString();
}
