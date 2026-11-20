import { Camera, Check, KeyRound, Loader2, Trash2, UserRound } from 'lucide-react';
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
      <div className="pf">
        <div className="pf-head">
          <div className="pf-photo">
            <Avatar id={me.id} name={name || me.name} src={avatar} size={84} />
            {busy === 'photo' && (
              <span className="pf-photo-busy">
                <Loader2 size={22} className="spin" />
              </span>
            )}
            <button type="button" className="pf-cam" disabled={busy === 'photo'} onClick={() => fileRef.current?.click()} aria-label={avatar ? 'Change photo' : 'Upload photo'} title={avatar ? 'Change photo' : 'Upload photo'}>
              <Camera size={16} />
            </button>
          </div>
          <div className="pf-who">
            <b>{name || me.name}</b>
            <span>{me.email}</span>
            <div className="pf-photo-links">
              <button type="button" className="pf-link" disabled={busy === 'photo'} onClick={() => fileRef.current?.click()}>
                {avatar ? 'Change photo' : 'Upload photo'}
              </button>
              {avatar && (
                <button type="button" className="pf-link danger" disabled={busy === 'photo'} onClick={removePhoto}>
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </div>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => onPhoto(e.target.files?.[0])} />
        </div>

        {msg && <div className={msg.kind === 'ok' ? 'auth-info' : 'auth-error'}>{msg.text}</div>}

        <form className="pf-card" onSubmit={save}>
          <h4 className="pf-title">
            <span className="pf-badge">
              <UserRound size={15} />
            </span>
            Profile
          </h4>
          <label className="pf-field">
            <span>Display name</span>
            <input className="text-input" value={name} required maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="pf-field">
            <span>Job title (optional)</span>
            <input className="text-input" value={title} maxLength={60} placeholder="e.g. Project Manager, Developer" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="pf-field">
            <span>Email</span>
            <input className="text-input" value={me.email} disabled />
          </label>
          <button className="pf-btn primary" disabled={busy === 'save'}>
            {busy === 'save' ? <Loader2 size={17} className="spin" /> : <Check size={17} />}
            <span>{busy === 'save' ? 'Saving…' : 'Save profile'}</span>
          </button>
        </form>

        <form className="pf-card" onSubmit={changePassword}>
          <h4 className="pf-title">
            <span className="pf-badge">
              <KeyRound size={15} />
            </span>
            Change password
          </h4>
          <label className="pf-field">
            <span>New password</span>
            <input className="text-input" type="password" autoComplete="new-password" placeholder="At least 6 characters" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} />
          </label>
          <label className="pf-field">
            <span>Confirm new password</span>
            <input className="text-input" type="password" autoComplete="new-password" placeholder="Type it again" value={pw.confirm} onChange={(e) => setPw({ ...pw, confirm: e.target.value })} />
          </label>
          <button className="pf-btn" disabled={busy === 'password' || !pw.next}>
            {busy === 'password' ? <Loader2 size={17} className="spin" /> : <KeyRound size={16} />}
            <span>{busy === 'password' ? 'Changing…' : 'Change password'}</span>
          </button>
        </form>
      </div>
    </Modal>
  );
}
