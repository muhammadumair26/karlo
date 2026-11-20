export const LABEL_COLORS = ['green', 'yellow', 'orange', 'red', 'purple', 'blue'] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];

export interface ChecklistItem {
  id: string;
  text: string;
  done: boolean;
}

export interface Card {
  id: string;
  title: string;
  description: string;
  labels: LabelColor[];
  due: string | null; // yyyy-mm-dd
  checklist: ChecklistItem[];
  createdAt: number;
}

export interface List {
  id: string;
  title: string;
  cardIds: string[];
}

export interface Board {
  id: string;
  title: string;
  color: string;
  listIds: string[];
}

export interface State {
  boards: Record<string, Board>;
  boardOrder: string[];
  lists: Record<string, List>;
  cards: Record<string, Card>;
  activeBoardId: string | null;
}

export const BOARD_COLORS = ['#0079bf', '#d29034', '#519839', '#b04632', '#89609e', '#cd5a91', '#00aecc', '#4bbf6b'];
