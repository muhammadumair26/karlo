import { supabase } from '../supabase';

/** Passkeys (Face ID / Touch ID / fingerprint / Windows Hello / phone) and two-step sign-in helpers. */

export const passkeysSupported = () => typeof window !== 'undefined' && !!window.PublicKeyCredential && window.isSecureContext;

/** Plain-language message for passkey / WebAuthn errors. */
export function friendlyAuthError(e: unknown): string {
  const err = e as { message?: string; code?: string; name?: string } | null;
  const msg = err?.message ?? String(e ?? '');
  const code = `${err?.code ?? ''} ${err?.name ?? ''} ${msg}`.toLowerCase();
  if (code.includes('notallowed') || code.includes('cancel') || code.includes('aborted')) return 'Cancelled — nothing was changed.';
  if (code.includes('no passkey') || code.includes('not found') || code.includes('invalid credential') || code.includes('credential not found'))
    return 'No Karlo passkey found on this device. Sign in with your password, then add one under Security & sign-in.';
  if (code.includes('challenge_expired')) return 'That took too long. Please try again.';
  if (code.includes('invalidstate') || code.includes('already registered')) return 'This device already has a passkey for your account.';
  if (code.includes('disabled') || code.includes('not enabled')) return 'Passkeys are not switched on for Karlo yet.';
  return msg || 'Something went wrong. Please try again.';
}

export interface PasskeyItem {
  id: string;
  friendly_name?: string;
  created_at: string;
  last_used_at?: string;
}

export async function listPasskeys(): Promise<PasskeyItem[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.auth.passkey.list();
  if (error) throw error;
  return (data ?? []) as PasskeyItem[];
}

export async function addPasskey(): Promise<void> {
  if (!supabase) throw new Error('Not connected');
  const { error } = await supabase.auth.registerPasskey();
  if (error) throw error;
}

export async function renamePasskey(id: string, name: string) {
  if (!supabase) return;
  const { error } = await supabase.auth.passkey.update({ passkeyId: id, friendlyName: name.slice(0, 120) });
  if (error) throw error;
}

export async function removePasskey(id: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.passkey.delete({ passkeyId: id });
  if (error) throw error;
}

export async function signInWithPasskey(): Promise<void> {
  if (!supabase) throw new Error('Not connected');
  const { error } = await supabase.auth.signInWithPasskey();
  if (error) throw error;
}

// ---------------------------------------------------------------- two-step (authenticator app)

export interface TotpFactor {
  id: string;
  friendly_name?: string;
  status: 'verified' | 'unverified';
}

export async function totpFactors(): Promise<TotpFactor[]> {
  if (!supabase) return [];
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return (data?.all ?? []).filter((f) => f.factor_type === 'totp') as unknown as TotpFactor[];
}

/** Starts two-step setup: returns the QR code (SVG data URL) and the secret to type in by hand. */
export async function startTotp(): Promise<{ factorId: string; qr: string; secret: string }> {
  if (!supabase) throw new Error('Not connected');
  // Clear any half-finished setup first.
  for (const f of await totpFactors()) if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `Authenticator app ${new Date().toISOString().slice(0, 10)}` });
  if (error) throw error;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  if (!supabase) throw new Error('Not connected');
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.replace(/\s/g, '') });
  if (error) throw new Error(error.message.toLowerCase().includes('invalid') ? 'That code is not right. Check the app and try again.' : error.message);
}

export async function disableTotp(factorId: string): Promise<void> {
  if (!supabase) return;
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** True when this sign-in still needs the 6-digit code. */
export async function needsSecondStep(): Promise<boolean> {
  if (!supabase) return false;
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  return !!data && data.nextLevel === 'aal2' && data.currentLevel !== 'aal2';
}
