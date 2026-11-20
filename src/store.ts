import { useEffect, useReducer } from 'react';
import type { Card, LabelColor, State } from './types';
import { BOARD_COLORS } from './types';

const STORAGE_KEY = 'taskboard-state-v1';

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

export type Action =
  | { type: 'ADD_BOARD'; title: string }
  | { type: 'RENAME_BOARD'; boardId: string; title: string }
  | { type: 'DELETE_BOARD'; boardId: string }
  | { type: 'SELECT_BOARD'; boardId: string }
  | { type: 'ADD_LIST'; boardId: string; title: string }
  | { type: 'RENAME_LIST'; listId: string; title: string }
  | { type: 'DELETE_LIST'; boardId: string; listId: string }
  | { type: 'MOVE_LIST'; boardId: string; listId: string; toIndex: number }
  | { type: 'ADD_CARD'; listId: string; title: string }
  | { type: 'UPDATE_CARD'; cardId: string; patch: Partial<Card> }
  | { type: 'DELETE_CARD'; cardId: string }
  | { type: 'MOVE_CARD'; cardId: string; toListId: string; toIndex: number };

function newCard(title: string, extra: Partial<Card> = {}): Card {
  return { id: uid(), title, description: '', labels: [], due: null, checklist: [], createdAt: Date.now(), ...extra };
}

function seed(): State {
  const state: State = { boards: {}, boardOrder: [], lists: {}, cards: {}, activeBoardId: null };
  const boardId = uid();
  const lists: [string, [string, Partial<Card>][]][] = [
    ['To Do', [
      ['Design the landing page', { labels: ['purple'] as LabelColor[] }],
      ['Set up the database', { labels: ['blue'] as LabelColor[], description: 'Pick between Postgres and SQLite.' }],
    ]],
    ['In Progress', [
      ['Build drag-and-drop', {
        labels: ['orange'] as LabelColor[],
        checklist: [
          { id: uid(), text: 'Cards between lists', done: true },
          { id: uid(), text: 'Reorder lists', done: false },
        ],
      }],
    ]],
    ['Done', [['Create the project', { labels: ['green'] as LabelColor[] }]]],
  ];
  const listIds: string[] = [];
  for (const [title, cards] of lists) {
    const listId = uid();
    listIds.push(listId);
    const cardIds = cards.map(([t, extra]) => {
      const c = newCard(t, extra);
      state.cards[c.id] = c;
      return c.id;
    });
    state.lists[listId] = { id: listId, title, cardIds };
  }
  state.boards[boardId] = { id: boardId, title: 'My First Board', color: BOARD_COLORS[0], listIds };
  state.boardOrder = [boardId];
  state.activeBoardId = boardId;
  return state;
}

function load(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as State;
  } catch {
    /* ignore corrupt storage */
  }
  return seed();
}

function findListOfCard(state: State, cardId: string): string | undefined {
  return Object.values(state.lists).find((l) => l.cardIds.includes(cardId))?.id;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'ADD_BOARD': {
      const id = uid();
      const color = BOARD_COLORS[state.boardOrder.length % BOARD_COLORS.length];
      return {
        ...state,
        boards: { ...state.boards, [id]: { id, title: action.title, color, listIds: [] } },
        boardOrder: [...state.boardOrder, id],
        activeBoardId: id,
      };
    }
    case 'RENAME_BOARD': {
      const b = state.boards[action.boardId];
      return { ...state, boards: { ...state.boards, [b.id]: { ...b, title: action.title } } };
    }
    case 'DELETE_BOARD': {
      const board = state.boards[action.boardId];
      const boards = { ...state.boards };
      delete boards[action.boardId];
      const lists = { ...state.lists };
      const cards = { ...state.cards };
      for (const lid of board.listIds) {
        for (const cid of lists[lid]?.cardIds ?? []) delete cards[cid];
        delete lists[lid];
      }
      const boardOrder = state.boardOrder.filter((id) => id !== action.boardId);
      const activeBoardId = state.activeBoardId === action.boardId ? boardOrder[0] ?? null : state.activeBoardId;
      return { boards, boardOrder, lists, cards, activeBoardId };
    }
    case 'SELECT_BOARD':
      return { ...state, activeBoardId: action.boardId };
    case 'ADD_LIST': {
      const id = uid();
      const b = state.boards[action.boardId];
      return {
        ...state,
        lists: { ...state.lists, [id]: { id, title: action.title, cardIds: [] } },
        boards: { ...state.boards, [b.id]: { ...b, listIds: [...b.listIds, id] } },
      };
    }
    case 'RENAME_LIST': {
      const l = state.lists[action.listId];
      return { ...state, lists: { ...state.lists, [l.id]: { ...l, title: action.title } } };
    }
    case 'DELETE_LIST': {
      const b = state.boards[action.boardId];
      const lists = { ...state.lists };
      const cards = { ...state.cards };
      for (const cid of lists[action.listId]?.cardIds ?? []) delete cards[cid];
      delete lists[action.listId];
      return {
        ...state,
        lists,
        cards,
        boards: { ...state.boards, [b.id]: { ...b, listIds: b.listIds.filter((id) => id !== action.listId) } },
      };
    }
    case 'MOVE_LIST': {
      const b = state.boards[action.boardId];
      const from = b.listIds.indexOf(action.listId);
      if (from === -1) return state;
      const ids = [...b.listIds];
      ids.splice(from, 1);
      let to = action.toIndex;
      if (from < to) to -= 1;
      ids.splice(to, 0, action.listId);
      return { ...state, boards: { ...state.boards, [b.id]: { ...b, listIds: ids } } };
    }
    case 'ADD_CARD': {
      const c = newCard(action.title);
      const l = state.lists[action.listId];
      return {
        ...state,
        cards: { ...state.cards, [c.id]: c },
        lists: { ...state.lists, [l.id]: { ...l, cardIds: [...l.cardIds, c.id] } },
      };
    }
    case 'UPDATE_CARD': {
      const c = state.cards[action.cardId];
      if (!c) return state;
      return { ...state, cards: { ...state.cards, [c.id]: { ...c, ...action.patch } } };
    }
    case 'DELETE_CARD': {
      const listId = findListOfCard(state, action.cardId);
      const cards = { ...state.cards };
      delete cards[action.cardId];
      if (!listId) return { ...state, cards };
      const l = state.lists[listId];
      return {
        ...state,
        cards,
        lists: { ...state.lists, [l.id]: { ...l, cardIds: l.cardIds.filter((id) => id !== action.cardId) } },
      };
    }
    case 'MOVE_CARD': {
      const fromListId = findListOfCard(state, action.cardId);
      if (!fromListId) return state;
      const lists = { ...state.lists };
      const fromIds = [...lists[fromListId].cardIds];
      const fromIndex = fromIds.indexOf(action.cardId);
      fromIds.splice(fromIndex, 1);
      let to = action.toIndex;
      if (fromListId === action.toListId) {
        if (fromIndex < to) to -= 1;
        fromIds.splice(to, 0, action.cardId);
        lists[fromListId] = { ...lists[fromListId], cardIds: fromIds };
      } else {
        lists[fromListId] = { ...lists[fromListId], cardIds: fromIds };
        const toIds = [...lists[action.toListId].cardIds];
        toIds.splice(to, 0, action.cardId);
        lists[action.toListId] = { ...lists[action.toListId], cardIds: toIds };
      }
      return { ...state, lists };
    }
  }
}

export function useStore() {
  const [state, dispatch] = useReducer(reducer, undefined, load);
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full or unavailable */
    }
  }, [state]);
  return [state, dispatch] as const;
}
