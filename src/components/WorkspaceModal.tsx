import { useState } from 'react';
import * as api from '../lib/api';
import type { Me, Workspace } from '../lib/types';
import { canAdmin, ROLE_INFO } from '../lib/types';
import { MembersPanel } from './MembersPanel';
import { Modal } from './ui';

export function WorkspaceModal({
  workspace,
  me,
  onClose,
  onChanged,
}: {
  workspace: Workspace;
  me: Me;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [name, setName] = useState(workspace.name);
  const [err, setErr] = useState<string | null>(null);
  const admin = canAdmin(workspace.role);

  const run = async (fn: () => Promise<void>) => {
    setErr(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <Modal title="Workspace settings" onClose={onClose}>
      <div className="field-row">
        <input
          className="text-input"
          value={name}
          disabled={!admin}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== workspace.name && run(() => api.renameWorkspace(workspace.id, name.trim()))}
        />
        <span className={`role-pill role-${workspace.role}`}>You: {ROLE_INFO[workspace.role].label}</span>
      </div>
      <p className="muted">Everyone in this workspace can see all of its boards, with the role you give them.</p>
      {err && <div className="auth-error">{err}</div>}

      <h4>Team members</h4>
      <MembersPanel target={{ workspaceId: workspace.id }} me={me} canManage={admin} onChanged={onChanged} />

      <div className="modal-footer">
        {workspace.role === 'owner' ? (
          <button
            className="btn danger"
            onClick={() =>
              confirm(`Delete workspace "${workspace.name}" and ALL its boards for everyone? This cannot be undone.`) &&
              run(async () => {
                await api.deleteWorkspace(workspace.id);
                onClose();
              })
            }
          >
            Delete workspace
          </button>
        ) : (
          <button
            className="btn ghost"
            onClick={() =>
              confirm(`Leave "${workspace.name}"?`) &&
              run(async () => {
                await api.leaveWorkspace(workspace.id, me.id);
                onClose();
              })
            }
          >
            Leave workspace
          </button>
        )}
      </div>
    </Modal>
  );
}
