import { supabase } from '../supabase';
import { emptyBoard, newCard, uid } from './board';
import type { BoardData, BoardMeta, Card, Label, Me, Person, Role, Workspace } from './types';
import { LABEL_COLORS } from './types';

function sb() {
  if (!supabase) throw new Error('Supabase is not configured');
  return supabase;
}

function fail(error: { message: string } | null) {
  if (error) throw new Error(error.message);
}

export async function loadMe(userId: string, email: string): Promise<Me> {
  const { data } = await sb().from('profiles').select('name, title, avatar_url').eq('id', userId).maybeSingle();
  return { id: userId, email, name: data?.name || email.split('@')[0], title: data?.title ?? '', avatar_url: data?.avatar_url ?? null };
}

export async function updateProfile(userId: string, patch: { name?: string; title?: string; avatar_url?: string | null }) {
  const { error } = await sb().from('profiles').update(patch).eq('id', userId);
  fail(error);
}

/** Uploads an already-resized photo to avatars/<user id>/…, removes older photos, returns the public URL. */
export async function uploadAvatar(userId: string, blob: Blob): Promise<string> {
  const ext = blob.type === 'image/webp' ? 'webp' : 'jpg';
  const path = `${userId}/avatar-${Date.now()}.${ext}`; // new name each time so browsers don't show a cached old photo
  const bucket = sb().storage.from('avatars');
  const { error } = await bucket.upload(path, blob, { contentType: blob.type, upsert: false, cacheControl: '31536000' });
  fail(error);
  await removeOldAvatars(userId, path);
  const url = bucket.getPublicUrl(path).data.publicUrl;
  await updateProfile(userId, { avatar_url: url });
  return url;
}

async function removeOldAvatars(userId: string, keep?: string) {
  const bucket = sb().storage.from('avatars');
  const { data } = await bucket.list(userId);
  const old = (data ?? []).map((f) => `${userId}/${f.name}`).filter((p) => p !== keep);
  if (old.length) await bucket.remove(old);
}

export async function removeAvatar(userId: string) {
  await removeOldAvatars(userId);
  await updateProfile(userId, { avatar_url: null });
}

export async function changePassword(password: string) {
  const { error } = await sb().auth.updateUser({ password });
  fail(error);
}

export async function acceptInvites(): Promise<number> {
  const { data, error } = await sb().rpc('accept_invites');
  fail(error);
  return (data as number) ?? 0;
}

export async function loadWorkspacesAndBoards(userId: string): Promise<{ workspaces: Workspace[]; boards: BoardMeta[] }> {
  const [wm, bs, bm] = await Promise.all([
    sb().from('workspace_members').select('role, workspaces(id, name)').eq('user_id', userId),
    sb().from('boards').select('id, workspace_id, title, color, updated_at').order('created_at'),
    sb().from('board_members').select('board_id, role').eq('user_id', userId),
  ]);
  fail(wm.error);
  fail(bs.error);
  fail(bm.error);
  const workspaces: Workspace[] = (wm.data ?? [])
    .map((r) => {
      const w = r.workspaces as unknown as { id: string; name: string } | null;
      return w ? { id: w.id, name: w.name, role: r.role as Role } : null;
    })
    .filter((w): w is Workspace => !!w)
    .sort((a, b) => a.name.localeCompare(b.name));
  const wsRole = new Map(workspaces.map((w) => [w.id, w.role]));
  const boardRole = new Map((bm.data ?? []).map((r) => [r.board_id as string, r.role as Role]));
  const rank = { owner: 4, admin: 3, member: 2, viewer: 1 } as const;
  const boards: BoardMeta[] = (bs.data ?? []).map((b) => {
    const a = wsRole.get(b.workspace_id);
    const c = boardRole.get(b.id);
    const role = (a && c ? (rank[a] >= rank[c] ? a : c) : a ?? c ?? 'viewer') as Role;
    return { ...(b as Omit<BoardMeta, 'role'>), role };
  });
  return { workspaces, boards };
}

export async function createWorkspace(name: string): Promise<string> {
  const { data, error } = await sb().rpc('create_workspace', { p_name: name });
  fail(error);
  return data as string;
}

export async function renameWorkspace(id: string, name: string) {
  const { error } = await sb().from('workspaces').update({ name }).eq('id', id);
  fail(error);
}

export async function deleteWorkspace(id: string) {
  const { error } = await sb().from('workspaces').delete().eq('id', id);
  fail(error);
}

export async function leaveWorkspace(id: string, userId: string) {
  const { error } = await sb().from('workspace_members').delete().eq('workspace_id', id).eq('user_id', userId);
  fail(error);
}

export async function createBoard(workspaceId: string, title: string, color: string, data: BoardData = emptyBoard()): Promise<string> {
  const { data: row, error } = await sb()
    .from('boards')
    .insert({ workspace_id: workspaceId, title, color, data })
    .select('id')
    .single();
  fail(error);
  return row!.id as string;
}

export async function updateBoardMeta(id: string, patch: { title?: string; color?: string; workspace_id?: string }) {
  const { error } = await sb().from('boards').update(patch).eq('id', id);
  fail(error);
}

export async function deleteBoard(id: string) {
  const { error } = await sb().from('boards').delete().eq('id', id);
  fail(error);
}

export async function leaveBoard(id: string, userId: string) {
  const { error } = await sb().from('board_members').delete().eq('board_id', id).eq('user_id', userId);
  fail(error);
}

export async function getBoardData(id: string): Promise<{ title: string; color: string; data: BoardData }> {
  const { data, error } = await sb().from('boards').select('title, color, data').eq('id', id).single();
  fail(error);
  return data as { title: string; color: string; data: BoardData };
}

// ------------------------------------------------------------ people & invites

export async function boardPeople(boardId: string): Promise<Person[]> {
  const { data, error } = await sb().rpc('board_people', { p_board: boardId });
  fail(error);
  // A person can appear twice (workspace + board guest); keep the higher role.
  const rank = { owner: 4, admin: 3, member: 2, viewer: 1 } as Record<string, number>;
  const byId = new Map<string, Person>();
  for (const p of (data ?? []) as Person[]) {
    const prev = byId.get(p.user_id);
    if (!prev || rank[p.role] > rank[prev.role]) byId.set(p.user_id, p);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export async function workspacePeople(workspaceId: string): Promise<Person[]> {
  const { data, error } = await sb().rpc('workspace_people', { p_workspace: workspaceId });
  fail(error);
  return ((data ?? []) as Person[]).sort((a, b) => a.name.localeCompare(b.name));
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  created_at: string;
}

export async function pendingInvites(target: { workspaceId?: string; boardId?: string }): Promise<Invite[]> {
  let q = sb().from('invites').select('id, email, role, created_at');
  q = target.workspaceId ? q.eq('workspace_id', target.workspaceId) : q.eq('board_id', target.boardId!);
  const { data, error } = await q.order('created_at');
  fail(error);
  return (data ?? []) as Invite[];
}

export async function cancelInvite(id: string) {
  const { error } = await sb().from('invites').delete().eq('id', id);
  fail(error);
}

export async function inviteMember(email: string, role: Role, target: { workspaceId?: string; boardId?: string }) {
  const { data, error } = await sb().rpc('invite_member', {
    p_email: email,
    p_role: role,
    p_workspace: target.workspaceId ?? null,
    p_board: target.boardId ?? null,
  });
  fail(error);
  return data as 'added' | 'invited';
}

export async function updateMember(userId: string, role: Role | 'remove', target: { workspaceId?: string; boardId?: string }) {
  const { error } = await sb().rpc('update_member', {
    p_user: userId,
    p_role: role,
    p_workspace: target.workspaceId ?? null,
    p_board: target.boardId ?? null,
  });
  fail(error);
}

// ------------------------------------------------------------ first sign-in

/** Make sure the user has a workspace, and bring over boards from the v1 single-user version. */
export async function bootstrap(me: Me): Promise<void> {
  await acceptInvites().catch(() => 0);
  const { workspaces } = await loadWorkspacesAndBoards(me.id);
  if (workspaces.some((w) => w.role === 'owner')) return;

  const wsId = await createWorkspace(`${me.name}'s Workspace`);
  const legacy = await loadLegacyState(me.id);
  if (legacy.length === 0) {
    const { starterBoard } = await import('./board');
    await createBoard(wsId, 'My First Board', '#2563eb', starterBoard());
    return;
  }
  for (const b of legacy) await createBoard(wsId, b.title, b.color, b.data);
}

interface LegacyState {
  boards: Record<string, { id: string; title: string; color: string; listIds: string[] }>;
  boardOrder: string[];
  lists: Record<string, { id: string; title: string; cardIds: string[] }>;
  cards: Record<string, { id: string; title: string; description: string; labels: string[]; due: string | null; checklist: Card['checklist']; createdAt: number }>;
}

async function loadLegacyState(userId: string): Promise<{ title: string; color: string; data: BoardData }[]> {
  let state: LegacyState | null = null;
  try {
    const { data } = await sb().from('user_state').select('data').eq('user_id', userId).maybeSingle();
    state = (data?.data as LegacyState) ?? null;
  } catch {
    /* table may not exist */
  }
  if (!state) {
    try {
      const raw = localStorage.getItem(`taskboard-state-v1:${userId}`) ?? localStorage.getItem('taskboard-state-v1');
      state = raw ? (JSON.parse(raw) as LegacyState) : null;
    } catch {
      state = null;
    }
  }
  if (!state?.boardOrder) return [];
  return state.boardOrder
    .map((id) => state!.boards[id])
    .filter(Boolean)
    .map((b) => {
      const data = emptyBoard();
      data.labels = Object.keys(LABEL_COLORS)
        .slice(0, 6)
        .map((color): Label => ({ id: uid(), name: '', color }));
      const labelByColor = new Map(data.labels.map((l) => [l.color, l.id]));
      for (const lid of b.listIds) {
        const l = state!.lists[lid];
        if (!l) continue;
        data.lists[lid] = { id: lid, title: l.title, cardIds: [], archived: false };
        data.listOrder.push(lid);
        for (const cid of l.cardIds) {
          const c = state!.cards[cid];
          if (!c) continue;
          data.cards[cid] = newCard(cid, c.title, userId, c.createdAt ?? Date.now(), {
            description: c.description ?? '',
            due: c.due ?? null,
            checklist: c.checklist ?? [],
            labelIds: (c.labels ?? []).map((x) => labelByColor.get(x === 'blue' ? 'blue' : x)).filter((x): x is string => !!x),
          });
          data.lists[lid].cardIds.push(cid);
        }
      }
      return { title: b.title, color: b.color, data };
    });
}

// ---------------------------------------------------------------- clients (platform admin)
export interface ClientRow {
  id: string;
  name: string;
  plan: import('./plans').PlanId;
  status: 'active' | 'suspended';
  trial_ends_at: string | null;
  paid_until: string | null;
  seats: number | null;
  admin_notes: string;
  created_at: string;
  owner_name: string | null;
  owner_email: string | null;
  pending_owner: string | null;
  people: number;
  boards: number;
  storage_bytes: number;
  last_active: string | null;
}

export async function isPlatformAdmin(): Promise<boolean> {
  const { data, error } = await sb().rpc('is_platform_admin');
  if (error) return false; // older database without the clients feature
  return data === true;
}

export async function listClients(): Promise<ClientRow[]> {
  const { data, error } = await sb().rpc('admin_clients');
  fail(error);
  return (data ?? []) as ClientRow[];
}

export async function createClient(p: { name: string; email: string; plan: string; trialDays: number; paidUntil: string | null }): Promise<string> {
  const { data, error } = await sb().rpc('admin_create_client', {
    p_name: p.name,
    p_owner_email: p.email,
    p_plan: p.plan,
    p_trial_days: p.trialDays,
    p_paid_until: p.paidUntil,
  });
  fail(error);
  return data as string;
}

export async function updateClient(c: Pick<ClientRow, 'id' | 'name' | 'plan' | 'status' | 'trial_ends_at' | 'paid_until' | 'seats' | 'admin_notes'>) {
  const { error } = await sb().rpc('admin_update_client', {
    p_id: c.id,
    p_name: c.name,
    p_plan: c.plan,
    p_status: c.status,
    p_trial_ends_at: c.trial_ends_at,
    p_paid_until: c.paid_until,
    p_seats: c.seats,
    p_notes: c.admin_notes,
  });
  fail(error);
}
