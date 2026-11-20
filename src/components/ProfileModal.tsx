import { Camera, KeyRound, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import * as api from '../lib/api';
import { resizeImage } from '../lib/image';
import type { Me } from '../lib/types';
import { Avatar, Modal } from './ui';

const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export function ProfileModal({ me, onClose, onSaved }: { me: Me; onClose: () => void; onSaved: (me: Me) => void }) {
  const [name, setName] = useState(me.name);
  const [title, setTitle] = useState(me.title);
  const [avatar, setAvatar] = useState(me.avatar_url);
  const [busy, setBusy] = useState<null | 'photo' | 'save' | 'password'>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [pw, setPw] = useState({ next: '', confirm: '' });
  const fileRef = useRef<HTMLInputElement>(null);

  const current = (): Me => ({ ...me, name: name.trim() || me.name, title: title.trim(), avatar_url: avatar });

  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    setBusy('photo');
    try {
      const small = await resizeImage(file, 256);
      const url = await api.uploadAvatar(me.id, small);
      setAvatar(url);
      onSaved({ ...current(), avatar_url: url });
      setMsg({ kind: 'ok', text: `Photo updated — reduced from ${kb(file.size)} to ${kb(small.size)}.` });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    }
    setBusy(null);
    if (fileRef.current) fileRef.current.value = '';
  };

  const removePhoto = async () => {
    setBusy('photo');
    setMsg(null);
    try {
      await api.removeAvatar(me.id);
      setAvatar(null);
      onSaved({ ...current(), avatar_url: null });
    } catch (e) {
      setMsg({ kind: 'err', text: (e as Error).message });
    }
    setBusy(null);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy('save');
    setMsg(null);
    try {
      await api.updateProfile(me.id, { name: name.trim(), title: title.trim() });
      onSaved(current());
      setMsg({ kind: 'ok', text: 'Profile saved.' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    }
    setBusy(null);
  };

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    if (pw.next.length < 6) return setMsg({ kind: 'err', text: 'Password must be at least 6 characters.' });
    if (pw.next !== pw.confirm) return setMsg({ kind: 'err', text: 'Passwords do not match.' });
    setBusy('password');
    try {
      await api.changePassword(pw.next);
      setPw({ next: '', confirm: '' });
      setMsg({ kind: 'ok', text: 'Password changed. Use the new password next time you sign in.' });
    } catch (err) {
      setMsg({ kind: 'err', text: (err as Error).message });
    }
    setBusy(null);
  };

  return (
    <Modal title="Your profile" onClose={onClose}>
      <div className="profile-top">
        <div className="profile-photo">
          <Avatar id={me.id} name={name || me.name} src={avatar} size={88} />
          {busy === 'photo' && <span className="photo-busy">…</span>}
        </div>
        <div className="profile-photo-actions">
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
          <button className="btn" disabled={busy === 'photo'} onClick={() => fileRef.current?.click()}>
            <Camera size={15} /> {avatar ? 'Change photo' : 'Upload photo'}
          </button>
          {avatar && (
            <button className="btn ghost" disabled={busy === 'photo'} onClick={removePhoto}>
              <Trash2 size={15} /> Remove
            </button>
          )}
          <span className="muted">Any size — it's automatically cropped to a square and compressed.</span>
        </div>
      </div>

      {msg && <div className={msg.kind === 'ok' ? 'auth-info' : 'auth-error'}>{msg.text}</div>}

      <form className="profile-form" onSubmit={save}>
        <label>
          <span className="muted">Display name (shown to your team)</span>
          <input className="text-input" value={name} required maxLength={60} onChange={(e) => setName(e.target.value)} />
        </label>
        <label>
          <span className="muted">Job title (optional)</span>
          <input
            className="text-input"
            value={title}
            maxLength={60}
            placeholder="e.g. Project Manager, Developer"
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          <span className="muted">Email</span>
          <input className="text-input" value={me.email} disabled />
        </label>
        <div>
          <button className="btn primary" disabled={busy === 'save'}>
            {busy === 'save' ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <form className="profile-form password" onSubmit={changePassword}>
        <h4>
          <KeyRound size={15} /> Change password
        </h4>
        <input
          className="text-input"
          type="password"
          autoComplete="new-password"
          placeholder="New password (min 6 characters)"
          value={pw.next}
          onChange={(e) => setPw({ ...pw, next: e.target.value })}
        />
        <input
          className="text-input"
          type="password"
          autoComplete="new-password"
          placeholder="Confirm new password"
          value={pw.confirm}
          onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
        />
        <div>
          <button className="btn" disabled={busy === 'password' || !pw.next}>
            {busy === 'password' ? 'Changing…' : 'Change password'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
