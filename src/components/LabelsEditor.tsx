import { uid } from '../lib/board';
import type { Label } from '../lib/types';
import { LABEL_COLORS } from '../lib/types';
import { askConfirm } from './dialog';

export function LabelsEditor({ labels, onChange }: { labels: Label[]; onChange: (labels: Label[]) => void }) {
  const set = (id: string, patch: Partial<Label>) => onChange(labels.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  return (
    <div className="labels-editor">
      {labels.map((l) => (
        <div key={l.id} className="label-edit-row">
          <select
            value={l.color}
            onChange={(e) => set(l.id, { color: e.target.value })}
            style={{ background: LABEL_COLORS[l.color] }}
            className="color-select"
            aria-label="Label color"
          >
            {Object.keys(LABEL_COLORS).map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            defaultValue={l.name}
            placeholder="Label name"
            onBlur={(e) => e.target.value !== l.name && set(l.id, { name: e.target.value })}
          />
          <button
            className="btn ghost small"
            onClick={async () => (await askConfirm({ title: `Delete label “${l.name || l.color}”?`, message: "It's removed from every card on this board.", confirmLabel: 'Delete label', tone: 'danger' })) && onChange(labels.filter((x) => x.id !== l.id))}
            aria-label="Delete label"
          >
            ✕
          </button>
        </div>
      ))}
      <button
        className="btn small"
        onClick={() => {
          const used = new Set(labels.map((l) => l.color));
          const color = Object.keys(LABEL_COLORS).find((c) => !used.has(c)) ?? 'gray';
          onChange([...labels, { id: uid(), name: '', color }]);
        }}
      >
        + New label
      </button>
    </div>
  );
}
