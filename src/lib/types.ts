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
  url: string; // for links; empty for uploaded files
  path?: string; // storage path for uploaded files
  size?: number;
  mime?: string;
  addedAt: number;
  addedBy?: string;
}

export interface CardLocation {
  name: string;
  lat: number;
  lng: number;
}

/** A stretch of time someone spent on a card. `end` is null while their timer is running. */
export interface TimeEntry {
  id: string;
  userId: string;
  name: string;
  start: number; // ms since epoch
  end: number | null;
  note?: string;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  labelIds: string[];
  assignees: string[]; // user ids
  owners: string[]; // user ids — the creator by default; owners can add co-owners
  guests: string[]; // names of imported people not (yet) linked to a Karlo account
  completed: boolean;
  priority: Priority;
  start: string | null; // yyyy-mm-dd
  due: string | null; // yyyy-mm-dd
  dueDone: boolean;
  checklist: ChecklistItem[];
  comments: Comment[];
  attachments: Attachment[];
  location: CardLocation | null;
  cover: string | null; // attachment id shown on the card face
  time: TimeEntry[];
  /** Values of the board's custom fields, by field id. */
  fields?: Record<string, FieldValue>;
  archived: boolean;
  createdAt: number;
  createdBy: string;
}

export interface List {
  id: string;
  title: string;
  cardIds: string[];
  archived: boolean;
  /** Can be renamed but never deleted or archived (e.g. "In progress"). */
  protected?: boolean;
  /** Cards need a due date to move into (or be added to) this list. */
  requireDue?: boolean;
}

export interface Activity {
  id: string;
  at: number;
  by: string; // display name
  text: string;
  cardId?: string;
  attachmentId?: string;
}

export type FieldType = 'text' | 'longtext' | 'number' | 'currency' | 'date' | 'dropdown' | 'multiselect' | 'checkbox' | 'person' | 'url' | 'email' | 'phone' | 'rating';
/** multiselect and person store a list of ids; the rest a single value. */
export type FieldValue = string | number | boolean | string[];

export const FIELD_TYPES: { value: FieldType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'longtext', label: 'Long text' },
  { value: 'number', label: 'Number' },
  { value: 'currency', label: 'Money' },
  { value: 'date', label: 'Date' },
  { value: 'dropdown', label: 'Dropdown' },
  { value: 'multiselect', label: 'Multi-select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'person', label: 'People' },
  { value: 'url', label: 'Link' },
  { value: 'email', label: 'Email' },
  { value: 'phone', label: 'Phone' },
  { value: 'rating', label: 'Rating' },
];

/** Field types whose choices are set up on the field. */
export const hasOptions = (t: FieldType) => t === 'dropdown' || t === 'multiselect';

export interface FieldOption {
  id: string;
  label: string;
  color: string; // key of LABEL_COLORS
}

/** A board-wide extra field every card can fill in (e.g. "Budget", "Client", "Approved"). */
export interface CustomField {
  id: string;
  name: string;
  type: FieldType;
  options?: FieldOption[]; // dropdown / multi-select choices
  currency?: string; // money fields, e.g. AED
  showOnCard: boolean; // show the value on the card in the list
}

/** Everything inside one board; stored as JSON in boards.data. */
export interface BoardData {
  lists: Record<string, List>;
  listOrder: string[];
  cards: Record<string, Card>;
  labels: Label[];
  activity: Activity[];
  background: string | null; // image URL
  dashboard: DashboardTile[] | null; // null = default tiles
  settings?: BoardSettings; // board rules (admins); missing = defaults
  automations?: AutomationRule[]; // "when … then …" rules (admins)
  customFields?: CustomField[]; // extra fields on every card
}

/** What starts an automation. */
export type AutoTrigger =
  | { type: 'moved_to'; listId: string }
  | { type: 'added_to'; listId: string }
  | { type: 'completed' }
  | { type: 'checklist_done' };

/** What an automation does to the card. */
export type AutoAction =
  | { type: 'complete' }
  | { type: 'uncomplete' }
  | { type: 'move_to'; listId: string }
  | { type: 'assign'; userId: string } // '@owner' = the card's owner
  | { type: 'due_in'; days: number }
  | { type: 'clear_due' }
  | { type: 'add_label'; labelId: string }
  | { type: 'check_all' }
  | { type: 'notify'; to: 'members' | 'owners' | string; message: string };

export interface AutomationRule {
  id: string;
  on: boolean;
  trigger: AutoTrigger;
  actions: AutoAction[];
}

/** How a board works. Admins change these in Board settings. */
export interface BoardSettings {
  requireDue: boolean; // new cards need a due date
  defaultDueDays: number | null; // pre-filled due date: days from today, or none
  requireMember: boolean; // new cards need a responsible person
  addCards: 'editors' | 'admins'; // who can add cards
  deleteCards: 'owner_admin' | 'editors'; // who can delete cards
  mentionAssigns: boolean; // @mentioning someone adds them as a member
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  requireDue: true,
  defaultDueDays: null,
  requireMember: false,
  addCards: 'editors',
  deleteCards: 'owner_admin',
  mentionAssigns: true,
};

export const boardSettings = (d: Pick<BoardData, 'settings'> | null | undefined): BoardSettings => ({ ...DEFAULT_BOARD_SETTINGS, ...(d?.settings ?? {}) });

export type DashboardMetric = 'list' | 'label' | 'member' | 'owner' | 'due' | 'priority' | 'status';
export type DashboardChart = 'bar' | 'pie' | 'line';
export interface DashboardTile {
  id: string;
  metric: DashboardMetric;
  chart: DashboardChart;
  days?: 7 | 14 | 30; // line charts: timeframe
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
  avatar_url?: string | null;
  title?: string;
}

export interface Me {
  id: string;
  email: string;
  name: string;
  title: string;
  avatar_url: string | null;
}

export const BOARD_COLORS = ['#2563eb', '#7c3aed', '#0891b2', '#059669', '#d97706', '#dc2626', '#db2777', '#475569'];

/** Dubai photos (Unsplash), each checked by eye. */
export const DUBAI_PHOTOS = [
  'https://images.unsplash.com/photo-1512453979798-5ea266f8880c', // skyline at sunset
  'https://images.unsplash.com/photo-1518684079-3c830dcef090', // Burj Al Arab from the air
  'https://images.unsplash.com/photo-1489516408517-0c0a15662682', // Atlantis, The Palm
  'https://images.unsplash.com/photo-1526495124232-a04e1849168c', // Downtown at dusk
  'https://images.unsplash.com/photo-1528702748617-c64d49f918af', // Dubai Marina with camels
  'https://images.unsplash.com/photo-1546412414-e1885259563a', // Burj Al Arab, beach view
  'https://images.unsplash.com/photo-1580674684081-7617fbf3d745', // Burj Khalifa & Dubai Mall
  'https://images.unsplash.com/photo-1582672060674-bc2bd808a8b5', // Burj Khalifa with palms
];

export const BACKGROUND_PHOTOS = [
  'https://images.unsplash.com/photo-1477959858617-67f85cf4f1df',
  'https://images.unsplash.com/photo-1506744038136-46273834b3fb',
  'https://images.unsplash.com/photo-1501785888041-af3ef285b470',
  'https://images.unsplash.com/photo-1519681393784-d120267933ba',
  'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05',
  'https://images.unsplash.com/photo-1493246507139-91e8fad9978e',
  'https://images.unsplash.com/photo-1507525428034-b723cf961d3e',
  'https://images.unsplash.com/photo-1444703686981-a3abbc4d4fe3',
];
export const photoUrl = (u: string, w = 1920) => (u.includes('images.unsplash.com') ? `${u}?auto=format&fit=crop&w=${w}&q=75` : u);
