import { useState } from 'react';
import * as api from '../lib/api';
import type { ImportedBoard, ImportSource } from '../lib/importers';
import { importFiles } from '../lib/importers';
import type { Workspace } from '../lib/types';
import { canEdit } from '../lib/types';
import { Modal } from './ui';

const SOURCES: { id: ImportSource; name: string; accept: string; help: React.ReactNode }[] = [
  {
    id: 'trello',
    name: 'Trello',
    accept: '.json,application/json',
    help: (
      <>
        In Trello open the board → <b>⋯ Menu</b> → <b>Print, export and share</b> → <b>Export as JSON</b>, save the file and
        choose it here. You can pick several boards at once. Lists, cards, labels, checklists, due dates, comments, attachments
        links and archived items come across.
      </>
    ),
  },
  {
    id: 'clickup',
    name: 'ClickUp',
    accept: '.csv,text/csv',
    help: (
      <>
        In ClickUp go to <b>Settings</b> → <b>Import/Export</b> → <b>Export</b> (or open a List view → <b>⋯</b> → <b>Export</b>)
        and download as <b>CSV</b>. Each ClickUp list becomes a board and each status becomes a column. Tags, priority, dates,
        descriptions and checklists are kept.
      </>
    ),
  },
  {
    id: 'csv',
    name: 'CSV / Excel',
    accept: '.csv,text/csv',
    help: (
      <>
        Any spreadsheet saved as CSV. Needs a <b>Title</b> (or Name/Task) column; optional columns: <b>List</b> (or Status),
        Description, Labels, Assignees, Priority, Start Date, Due Date, Completed, Checklist.
      </>
    ),
  },
  {
    id: 'karlo',
    name: 'Karlo backup',
    accept: '.json,application/json',
    help: <>A file made with Karlo's “Export” (one board or all boards).</>,
  },
];

export function ImportModal({
  workspaces,
  onClose,
  onImported,
}: {
  workspaces: Workspace[];
  onClose: () => void;
  onImported: (firstBoardId: string | null) => void;
}) {
  const writable = workspaces.filter((w) => canEdit(w.role));
  const [source, setSource] = useState<ImportSource>('trello');
  const [ws, setWs] = useState(writable[0]?.id ?? '');
  const [preview, setPreview] = useState<ImportedBoard[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const src = SOURCES.find((s) => s.id === source)!;

  const onFiles = async (files: FileList | null) => {
    setErr(null);
    setPreview(null);
    if (!files?.length) return;
    try {
      setPreview(await importFiles([...files], source));
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const run = async () => {
    if (!preview || !ws) return;
    setBusy(true);
    setErr(null);
    try {
      let first: string | null = null;
      for (const b of preview) {
        const id = await api.createBoard(ws, b.title, b.color, b.data);
        first ??= id;
      }
      onImported(first);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Import boards" onClose={onClose}>
      <div className="seg">
        {SOURCES.map((s) => (
          <button
            key={s.id}
            className={source === s.id ? 'on' : ''}
            onClick={() => {
              setSource(s.id);
              setPreview(null);
              setErr(null);
            }}
          >
            {s.name}
          </button>
        ))}
      </div>
      <p className="help-text">{src.help}</p>

      <label className="file-drop">
        <input type="file" accept={src.accept} multiple onChange={(e) => onFiles(e.target.files)} />
        <span>📂 Choose {source === 'trello' || source === 'karlo' ? 'JSON' : 'CSV'} file(s)…</span>
      </label>

      {err && <div className="auth-error">{err}</div>}

      {preview && (
        <div className="import-preview">
          <h4>Ready to import</h4>
          <ul>
            {preview.map((b, i) => {
              const cards = Object.keys(b.data.cards).length;
              return (
                <li key={i}>
                  <span className="swatch" style={{ background: b.color }} /> <strong>{b.title}</strong>
                  <span className="muted">
                    {' '}
                    — {b.data.listOrder.length} lists, {cards} cards, {b.data.labels.length} labels
                  </span>
                </li>
              );
            })}
          </ul>
          <div className="field-row">
            <label className="muted">Into workspace</label>
            <select value={ws} onChange={(e) => setWs(e.target.value)} className="field-select">
              {writable.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </div>
          {writable.length === 0 && <div className="auth-error">You need Member access to a workspace to import.</div>}
          <div className="modal-footer">
            <span />
            <button className="btn primary" onClick={run} disabled={busy || !ws}>
              {busy ? 'Importing…' : `Import ${preview.length} board${preview.length > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
