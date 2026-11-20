/** Recently opened cards (this browser only), for the "Recently viewed" list when attaching links. */
export interface RecentCard {
  boardId: string;
  cardId: string;
  title: string;
  boardTitle: string;
  at: number;
}
const KEY = 'karlo-recent-cards';

export function recentCards(): RecentCard[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? '[]');
  } catch {
    return [];
  }
}

export function rememberCard(r: Omit<RecentCard, 'at'>) {
  try {
    const list = [{ ...r, at: Date.now() }, ...recentCards().filter((x) => x.cardId !== r.cardId)].slice(0, 20);
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

import { publicOrigin, WEB_URL } from './platform';

/** A link that opens a card inside Karlo. */
export const cardLink = (boardId: string, cardId: string) => `${publicOrigin()}/?board=${boardId}&card=${cardId}`;

export function parseCardLink(href: string): { boardId: string; cardId: string } | null {
  try {
    const u = new URL(href, window.location.origin);
    if (u.origin !== window.location.origin && u.origin !== WEB_URL) return null;
    const boardId = u.searchParams.get('board');
    const cardId = u.searchParams.get('card');
    return boardId && cardId ? { boardId, cardId } : null;
  } catch {
    return null;
  }
}
