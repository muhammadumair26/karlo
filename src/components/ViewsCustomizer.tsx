import { ArrowDown, ArrowUp, Eye, EyeOff, GripVertical } from 'lucide-react';
import { useState, type ComponentType } from 'react';
import { savePrefs } from '../lib/prefs';
import { showAlert } from './dialog';
import { Modal } from './ui';

type ViewDef = { id: string; label: string; Icon: ComponentType<{ size?: number }> };

/** Reorder and hide items of the Views menu. Saved to your profile; only affects you. */
export function ViewsCustomizer({
  userId,
  all,
  order,
  hidden,
  onClose,
}: {
  userId: string;
  all: ViewDef[];
  order?: string[];
  hidden?: string[];
  onClose: () => void;
}) {
  const pos = new Map((order ?? []).map((id, i) => [id, i]));
  const [list, setList] = useState<ViewDef[]>([...all].sort((a, b) => (pos.get(a.id) ?? 1000 + all.indexOf(a)) - (pos.get(b.id) ?? 1000 + all.indexOf(b))));
  const [off, setOff] = useState<string[]>(hidden ?? []);
  const [drag, setDrag] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const move = (from: number, to: number) => {
    if (to < 0 || to >= list.length || from === to) return;
    const next = [...list];
    const [x] = next.splice(from, 1);
    next.splice(to, 0, x);
    setList(next);
  };
  const toggle = (id: string) => {
    if (!off.includes(id) && list.length - off.length <= 1) return; // keep at least one view
    setOff(off.includes(id) ? off.filter((x) => x !== id) : [...off, id]);
  };

  const save = async () => {
    setBusy(true);
    try {
      await savePrefs(userId, { viewOrder: list.map((v) => v.id), hiddenViews: off });
      onClose();
    } catch (e) {
      setBusy(false);
      void showAlert({ title: "Couldn't save", message: (e as Error).message, tone: 'danger' });
    }
  };

  return (
    <Modal title="Customize views" onClose={onClose}>
      <div className="ex-form vc">
        <p className="muted vc-lead">Drag or use the arrows to set the order of the Views menu, and hide the ones you don't use. This only changes it for you, on all your devices.</p>
        <ul className="vc-list">
          {list.map((v, i) => {
            const hiddenNow = off.includes(v.id);
            return (
              <li
                key={v.id}
                className={`vc-row ${hiddenNow ? 'off' : ''} ${drag === i ? 'dragging' : ''}`}
                draggable
                onDragStart={() => setDrag(i)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (drag !== null && drag !== i) {
                    move(drag, i);
                    setDrag(i);
                  }
                }}
                onDragEnd={() => setDrag(null)}
              >
                <GripVertical size={16} className="vc-grip" />
                <v.Icon size={17} />
                <span className="vc-name">{v.label}</span>
                <button className="icon-btn" disabled={i === 0} onClick={() => move(i, i - 1)} aria-label={`Move ${v.label} up`} title="Move up">
                  <ArrowUp size={15} />
                </button>
                <button className="icon-btn" disabled={i === list.length - 1} onClick={() => move(i, i + 1)} aria-label={`Move ${v.label} down`} title="Move down">
                  <ArrowDown size={15} />
                </button>
                <button className="icon-btn" onClick={() => toggle(v.id)} aria-label={hiddenNow ? `Show ${v.label}` : `Hide ${v.label}`} title={hiddenNow ? 'Show' : 'Hide'}>
                  {hiddenNow ? <EyeOff size={15} /> : <Eye size={15} />}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="ex-form-actions">
          <button
            className="btn ghost"
            onClick={() => {
              setList(all);
              setOff([]);
            }}
          >
            Reset
          </button>
          <span className="header-spacer" />
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" disabled={busy} onClick={save}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </Modal>
  );
}
