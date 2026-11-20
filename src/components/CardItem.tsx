import { AlignLeft, Bell, CheckSquare, Clock, Flag, MapPin, MessageSquare, Paperclip, Pencil, Timer } from 'lucide-react';
import { anyRunning, cardTimeMs, formatDuration } from '../lib/time';
import { dueStatus, formatDate } from '../lib/filters';
import type { Card, Label, Person } from '../lib/types';
import { LABEL_COLORS, PRIORITIES } from '../lib/types';
import { Avatar } from './ui';

export function CardItem({
  unread = 0,
  coverUrl,
  card,
  labels,
  people,
  dragging,
  draggable,
  onOpen,
  onToggleComplete,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  /** My unread notifications about this card. */
  unread?: number;
  coverUrl?: string;
  card: Card;
  labels: Map<string, Label>;
  people: Map<string, Person>;
  dragging: boolean;
  draggable: boolean;
  onOpen: () => void;
  onToggleComplete?: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const done = card.checklist.filter((i) => i.done).length;
  const total = card.checklist.length;
  const status = dueStatus(card);
  const prio = PRIORITIES.find((p) => p.value === card.priority);
  const cardLabels = card.labelIds.map((id) => labels.get(id)).filter((l): l is Label => !!l);
  // Owners first (with a star), then members who aren't owners.
  const owners = (card.owners ?? []).filter((id) => people.has(id));
  const avatars = [
    ...owners.map((id) => ({ key: 'o:' + id, id, name: people.get(id)!.name, guest: false, owner: true, src: people.get(id)!.avatar_url })),
    ...card.assignees
      .filter((id) => !owners.includes(id))
      .map((id) => ({ key: id, id, name: people.get(id)?.name ?? '?', guest: false, owner: false, src: people.get(id)?.avatar_url })),
    ...card.guests.map((g) => ({ key: 'g:' + g, id: 'guest:' + g, name: g, guest: true, owner: false, src: null })),
  ];
  const timeMs = cardTimeMs(card, Date.now());
  const timing = anyRunning(card);
  const hasBadges =
    timeMs > 0 ||
    timing ||
    unread > 0 || card.priority !== 'none' || card.due || card.description || card.comments.length || card.attachments.length || total || avatars.length || card.location;

  return (
    <div
      className={`card ${dragging ? 'dragging' : ''} ${card.completed ? 'completed' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      tabIndex={0}
      role="button"
    >
      {card.cover && (
        <div className="card-cover" style={coverUrl ? { backgroundImage: `url("${coverUrl}")` } : undefined} />
      )}
      {cardLabels.length > 0 && (
        <div className="card-labels">
          {cardLabels.map((l) => (
            <span key={l.id} className="label-chip-sm" style={{ background: LABEL_COLORS[l.color] ?? '#8590a2' }} title={l.name}>
              {l.name}
            </span>
          ))}
        </div>
      )}

      <div className="card-title-row">
        {onToggleComplete && (
          <button
            className={`complete-circle ${card.completed ? 'on' : ''}`}
            title={card.completed ? 'Mark incomplete' : 'Mark complete'}
            onClick={(e) => {
              e.stopPropagation();
              onToggleComplete();
            }}
          >
            {card.completed && (
              <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden>
                <path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        )}
        <div className="card-title">{card.title}</div>
      </div>

      <button
        className="card-edit"
        title="Open card"
        onClick={(e) => {
          e.stopPropagation();
          onOpen();
        }}
      >
        <Pencil size={14} />
      </button>

      {hasBadges ? (
        <div className="card-badges">
          {unread > 0 && (
            <span className="badge notif-badge" title={`${unread} unread notification${unread === 1 ? '' : 's'} for you`}>
              <Bell size={13} /> {unread}
            </span>
          )}
          {card.priority !== 'none' && prio && (
            <span className="badge prio" style={{ color: prio.color }} title={`Priority: ${prio.label}`}>
              <Flag size={13} /> {prio.label}
            </span>
          )}
          {card.due && (
            <span className={`badge due-${status}`} title={card.dueDone ? 'Complete' : 'Due date'}>
              <Clock size={13} /> {formatDate(card.due)}
            </span>
          )}
          {card.description && (
            <span className="badge" title="This card has a description">
              <AlignLeft size={14} />
            </span>
          )}
          {card.comments.length > 0 && (
            <span className="badge" title="Comments">
              <MessageSquare size={13} /> {card.comments.length}
            </span>
          )}
          {card.attachments.length > 0 && (
            <span className="badge" title="Attachments">
              <Paperclip size={13} /> {card.attachments.length}
            </span>
          )}
          {card.location && (
            <span className="badge" title={card.location.name}>
              <MapPin size={13} />
            </span>
          )}
          {(timeMs > 0 || timing) && (
            <span className={`badge time-badge ${timing ? 'live' : ''}`} title={timing ? 'A timer is running on this card' : 'Time tracked'}>
              <Timer size={13} /> {formatDuration(timeMs)}
            </span>
          )}
          {total > 0 && (
            <span className={`badge ${done === total ? 'complete' : ''}`} title="Checklist">
              <CheckSquare size={13} /> {done}/{total}
            </span>
          )}
          <span className="badge-spacer" />
          {avatars.length > 0 && (
            <span className="avatar-stack">
              {avatars.slice(0, 3).map((a) =>
                a.owner ? (
                  <span key={a.key} className="owner-avatar sm">
                    <Avatar id={a.id} name={a.name} src={a.src} size={24} title={`${a.name} (owner)`} />
                  </span>
                ) : (
                  <Avatar key={a.key} id={a.id} name={a.name} src={a.src} size={24} title={a.guest ? `${a.name} (imported, not linked)` : a.name} />
                ),
              )}
              {avatars.length > 3 && (
                <span className="avatar more" style={{ width: 24, height: 24, fontSize: 10 }}>
                  +{avatars.length - 3}
                </span>
              )}
            </span>
          )}
        </div>
      ) : null}
    </div>
  );
}
