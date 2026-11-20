# Taskboard

A Trello-style Kanban project management tool built with React + TypeScript + Vite.

## Run

```bash
npm install
npm run dev
```

## Features

- Multiple boards (create, rename, delete, each with its own color)
- Lists: add, rename (click the title), delete, drag to reorder
- Cards: add, drag within/between lists, click to open the editor
- Card editor: title, description, colored labels, due date (overdue/soon badges), checklist with progress
- Filter cards by text
- Data saved in the browser's localStorage

## Structure

- `src/types.ts` – data model (Board → List → Card)
- `src/store.ts` – reducer with all actions + localStorage persistence
- `src/components/BoardView.tsx` – lists and drag-and-drop
- `src/components/CardModal.tsx` – card detail editor
- `src/components/CardItem.tsx` – card preview on the board
