export type Role = 'owner' | 'admin' | 'member' | 'viewer';

export const ROLE_RANK: Record<Role, number> = { owner: 4, admin: 3, member: 2, viewer: 1 };

export const ROLE_INFO: Record<Role, { label: string; desc: string }> = {
  owner: { label: 'Owner', desc: 'Full control, including deleting the workspace' },
  admin: { label: 'Admin', desc: 'Edit everything and manage members' },
  member: { label: 'Member', desc: 'Create and edit boards, lists and cards' },
  viewer: { label: 'Viewer', desc: 'Read-only access' },
};

export const canEdit = (r: Role | null | undefined) => !!r && ROLE_RANK[r] >= 2;
export const canAdmin = (r: Role | null | undefined) => !!r && ROLE_RANK[r] >= 3;

export type Priority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export const PRIORITIES: { value: Priority; label: string; color: string }[] = [
  { value: 'urgent', label: 'Urgent', color: '#dc2626' },
  { value: 'high', label: 'High', color: '#ea580c' },
  { value: 'medium', label: 'Medium', color: '#ca8a04' },
  { value: 'low', label: 'Low', color: '#2563eb' },
  { value: 'none', label: 'No priority', color: '#94a3b8' },
];

export const LABEL_COLORS: Record<string, string> = {
  green: '#4bce97',
  yellow: '#e2b203',
  orange: '#faa53d',
  red: '#f87462',
  purple: '#9f8fef',
  blue: '#579dff',
  sky: '#6cc3e0',
  lime: '#94c748',
  pink: '#e774bb',
  gray: '#8590a2',
};

export interface Label {
  id: string;
  name: string;
  color: string; // key of LABEL_COLORS
}

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Comment {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: number;
}

export interface Attachment {
  id: string;
  name: string;
  url: string;
  addedAt: number;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  labelIds: string[];
  assignees: string[]; // user ids
  priority: Priority;
  start: string | null; // yyyy-mm-dd
  due: string | null; // yyyy-mm-dd
  dueDone: boolean;
  checklist: ChecklistItem[];
  comments: Comment[];
  attachments: Attachment[];
  archived: boolean;
  createdAt: number;
  createdBy: string;
}

export interface List {
  id: string;
  title: string;
  cardIds: string[];
  archived: boolean;
}

export interface Activity {
  id: string;
  at: number;
  by: string; // display name
  text: string;
  cardId?: string;
}

/** Everything inside one board; stored as JSON in boards.data. */
export interface BoardData {
  lists: Record<string, List>;
  listOrder: string[];
  cards: Record<string, Card>;
  labels: Label[];
  activity: Activity[];
}

export interface Workspace {
  id: string;
  name: string;
  role: Role;
}

export interface BoardMeta {
  id: string;
  workspace_id: string;
  title: string;
  color: string;
  role: Role; // my effective role
  updated_at: string;
}

export interface Person {
  user_id: string;
  name: string;
  email: string;
  role: Role;
  via?: 'workspace' | 'board';
}

export interface Me {
  id: string;
  email: string;
  name: string;
}

export const BOARD_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#475569'];
