# Karlo

Karlo is a team project-management tool (Kanban boards, like Trello) built with React + TypeScript + Vite and Supabase.

Live: https://karlo.orionsoftsol.com

## Features

- **Workspaces (teams)** with roles: Owner, Admin, Member, Viewer
- **Board sharing**: invite people to a single board; invites to people without an account are accepted automatically when they sign up
- **Boards, lists, cards** with drag-and-drop, archive/restore, activity log
- **Cards**: assignees, priority, start/due dates (+ complete), named labels, checklists, link attachments, comments
- **Views**: Board, Table (sortable), Calendar; filters by text, assignee, label, priority, due date
- **Real-time collaboration**: changes appear instantly for everyone; concurrent edits are merged (optimistic locking + replay)
- **Import**: Trello (JSON export), ClickUp (CSV export), any CSV, Karlo backups
- **Export**: board as JSON or CSV, or all boards as one backup file

## Run locally

```bash
cp .env.example .env.local   # fill in your Supabase URL + publishable key
npm install
npm run dev
```

## Database

Run in Supabase → SQL Editor:
1. `supabase/schema.sql` (v1, kept for migrating old data)
2. `supabase/schema-v2-teams.sql` (workspaces, boards, roles, invites)

`supabase/test-permissions.sql` checks every role and rolls itself back.

## Structure

- `src/lib/board.ts` – board data model and pure reducer (replayable actions)
- `src/lib/useBoardSync.ts` – load/save/realtime with conflict-safe merging
- `src/lib/api.ts` – workspaces, boards, members, invites
- `src/lib/importers.ts` – Trello / ClickUp / CSV import and CSV/JSON export
- `src/components/` – UI (BoardPage, KanbanView, TableView, CalendarView, CardModal, MembersPanel, …)
