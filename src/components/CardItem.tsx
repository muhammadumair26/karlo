import { dueStatus, formatDate } from '../lib/filters';
import type { Card, Label, Person } from '../lib/types';
import { LABEL_COLORS, PRIORITIES } from '../lib/types';
import { AvatarStack } from './ui';

export function CardItem({
  card,
  labels,
  people,
  dragging,
  draggable,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  card: Card;
  labels: Map<string, Label>;
  people: Map<string, Person>;
  dragging: boolean;
  draggable: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const done = card.checklist.filter((i) => i.done).length;
  const total = card.checklist.length;
  const status = dueStatus(card);
  const prio = PRIORITIES.find((p) => p.value === card.priority);
  const cardLabels = card.labelIds.map((id) => labels.get(id)).filter((l): l is Label => !!l);

  return (
    <div
      className={`card ${dragging ? 'dragging' : ''}`}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onOpen}
      onKeyDown={(e) => e.key === 'Enter' && onOpen()}
      tabIndex={0}
      role="button"
    >
      {cardLabels.length > 0 && (
        <div className="card-labels">
          {cardLabels.map((l) => (
            <span key={l.id} className="label-chip-sm" style={{ background: LABEL_COLORS[l.color] ?? '#8590a2' }} title={l.name}>
              {l.name}
            </span>
          ))}
        </div>
      )}
      <div className="card-title">{card.title}</div>
      <div className="card-badges">
        {card.priority !== 'none' && prio && (
          <span className="badge prio" style={{ color: prio.color }} title={`Priority: ${prio.label}`}>
            ⚑ {prio.label}
          </span>
        )}
        {card.due && (
          <span className={`badge due-${status}`} title={card.dueDone ? 'Complete' : 'Due date'}>
            {card.dueDone ? '✓' : '🕒'} {formatDate(card.due)}
          </span>
        )}
        {card.description && <span className="badge" title="Has description">≡</span>}
        {card.comments.length > 0 && <span className="badge" title="Comments">💬 {card.comments.length}</span>}
        {card.attachments.length > 0 && <span className="badge" title="Attachments">📎 {card.attachments.length}</span>}
        {total > 0 && (
          <span className={`badge ${done === total ? 'complete' : ''}`} title="Checklist">
            ☑ {done}/{total}
          </span>
        )}
        <span className="badge-spacer" />
        <AvatarStack ids={card.assignees} people={people} size={22} />
      </div>
    </div>
  );
}
