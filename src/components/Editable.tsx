import { useEffect, useRef, useState } from 'react';

/** Click-to-edit single-line text. Enter/blur saves, Escape cancels. */
export function EditableText({
  value,
  onSave,
  className,
  onEditingChange,
}: {
  value: string;
  onSave: (v: string) => void;
  className?: string;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    onEditingChange?.(editing);
    if (editing) ref.current?.select();
  }, [editing, onEditingChange]);

  const commit = () => {
    const v = draft.trim();
    if (v && v !== value) onSave(v);
    else setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <span
        className={className}
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        title="Click to rename"
      >
        {value}
      </span>
    );
  }
  return (
    <input
      ref={ref}
      className={`${className ?? ''} editing`}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
        if (e.key === 'Escape') {
          setDraft(value);
          setEditing(false);
        }
      }}
    />
  );
}

/** "+ Add ..." button that expands into an input form. */
export function AddForm({
  label,
  placeholder,
  submitLabel,
  onAdd,
  className,
  multiline,
}: {
  label: string;
  placeholder: string;
  submitLabel: string;
  onAdd: (v: string) => void;
  className?: string;
  multiline?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');

  if (!open) {
    return (
      <button className={`add-trigger ${className ?? ''}`} onClick={() => setOpen(true)}>
        + {label}
      </button>
    );
  }

  const submit = () => {
    const v = text.trim();
    if (v) onAdd(v);
    setText('');
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
    if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div className={`add-form ${className ?? ''}`}>
      {multiline ? (
        <textarea autoFocus placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
      ) : (
        <input autoFocus placeholder={placeholder} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={onKeyDown} />
      )}
      <div className="add-form-actions">
        <button className="btn primary" onClick={submit}>
          {submitLabel}
        </button>
        <button className="btn ghost" onClick={() => setOpen(false)} aria-label="Cancel">
          ✕
        </button>
      </div>
    </div>
  );
}
