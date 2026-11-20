import type { Card } from '../types';

export function dueStatus(due: string | null): 'overdue' | 'soon' | 'later' | null {
  if (!due) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const d = new Date(due + 'T00:00:00');
  const days = (d.getTime() - today.getTime()) / 86400000;
  if (days < 0) return 'overdue';
  if (days <= 1) return 'soon';
  return 'later';
}

export function formatDue(due: string) {
  return new Date(due + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function CardItem({
  card,
  dragging,
  onOpen,
  onDragStart,
  onDragEnd,
  onDragOver,
}: {
  card: Card;
  dragging: boolean;
  onOpen: () => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDragOver: (e: React.DragEvent) => void;
}) {
  const done = card.checklist.filter((i) => i.done).length;
  const total = card.checklist.length;
  const status = dueStatus(card.due);

  return (
    <div
      className={`card ${dragging ? 'dragging' : ''}`}
      draggable
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onClick={onOpen}
    >
      {card.labels.length > 0 && (
        <div className="card-labels">
          {card.labels.map((l) => (
            <span key={l} className={`label-bar label-${l}`} />
          ))}
        </div>
      )}
      <div className="card-title">{card.title}</div>
      {(card.due || total > 0 || card.description) && (
        <div className="card-badges">
          {card.due && <span className={`badge due-${status}`}>🕒 {formatDue(card.due)}</span>}
          {card.description && <span className="badge" title="Has description">≡</span>}
          {total > 0 && (
            <span className={`badge ${done === total ? 'complete' : ''}`}>
              ☑ {done}/{total}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
