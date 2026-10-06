# SessionMap — features

[Leia em português](FEATURES.md)

Complete inventory of what the app does. This file is the source of truth
for the [public page](public/landing-en.html) and the [README](README.md):
every added or removed capability updates all three together (see `AGENTS.md`).

## Live session (two windows)

- **Host window (private):** editable outline + map preview side by side.
- **Participant window (`?view=client`):** only the balloons, no menus or outline.
- **Real-time mirror:** every letter, selection and cursor position travels over
  `BroadcastChannel` (with a storage-event fallback); no server, no account.
- **Single typing bar:** the same sentence on both sides, fading away on its own after
  ~1s idle — no flicker.
- **Participant screen follows the cursor:** the participant's map centers the topic under
  your cursor, no need to pause to "catch up".
- **Present in the top bar:** `Present` opens the participant screen in a new window; while live, the `Live` indicator shows the state and `End presentation` closes it. No pause: ending and presenting again covers everything.
- **Neutral title and URL on window B:** the tab says only "Map"; the participant's name never
  appears on the shared screen.
- **Fullscreen, self-hiding cursor and thin bar** that collapses on its own in
  the participant window (built for projection).
- **Focus zoom:** while navigating, zooms into the current node + parents + children on both screens.
- **Connection status** host↔participant with heartbeat (no separate status pill in the top bar).

## Outline (how you write)

- **One textarea, Markdown language:** `- topic` with 2 spaces per level;
  `#` on the first line names the session.
- **A real CommonMark parser** (marked): accepts `*`, `+`, numbered lists,
  headings and paragraphs, and normalizes everything to the canonical form.
- **Enter** opens the next topic at the same level; **Enter on an empty bullet** ends it.
- **Tab / Shift+Tab** indent the block; **Esc** releases focus (Tab is captured).
- **Cut/copy/paste across levels** for free, courtesy of the browser itself.
- **No placeholder:** an empty session opens with one editable line, no "Starting Point".
- **No piling blank lines:** empty leaves are pruned when switching sessions.
- **Undo/redo** (up to 50 steps) outside text fields; `Ctrl+Z` in text belongs to the browser.
- **Debounced autosave + safety net:** `beforeunload` writes the pending
  root and the next load reconciles it (applies only when newer).
- **Progressive help** built in (`?` button) and balloon count in the header.

## Mind map

- Zoom with the mouse wheel, `+`/`-`, buttons; pan by drag and arrows; `Ctrl+0` fits.
- Branch collapsing, selected-path highlight, draft ghost balloon.
- **Keyboard navigation** (WAI-ARIA tree pattern): arrows, Home/End, Enter/Space.
- Accessibility names per level/position; decorative connectors hidden from AT.
- Topics-panel width **persisted** (drag, arrows, Home/Esc).
- **Maximize outline or map**; on phones, fullscreen topics↔map switching.

## Participants & sessions

- Registration, renaming, search, session counts. Starts empty: no sample data.
- **Private notes per participant:** survive session switches and are **never**
  transmitted to the participant window.
- **Archive/restore** participants (sessions come along) and single sessions.
- **Delete with undo** (participant comes back with their sessions; a session comes back alone; the notice fades in 10s).
- **Visible orphan sessions:** nothing disappears silently if the participant leaves the list.
- **Import `.md`** as a new session; `Session N` numbering per participant.
- Tabbed panel: **Participants** (daily flow) and **Types and scripts** (global catalog).

## Session types and scripts

- **One modality per session** (Mentoring, Consulting, Meeting + any you create).
- **Derived badges on the participant:** the union of their sessions — nobody is "of a single type".
- Filter by type in the history and in the drawer; later reclassification without recreating.
- **Editable global catalog** (create/rename/delete; deleting yields "no type", never deletes a session).
- **Per-type + general scripts**, in Markdown, with preview; picker when starting a session.

## Local export and backup

- Per session: **Markdown, OPML, FreeMind (.mm), JSON, PNG, SVG**, copy.
- **Per-participant ZIP** and **full ZIP**; complete JSON backup (versioned envelope
  with participants, sessions, types and scripts) **with restore** (accepts legacy files).
- Restore confirms counts before writing; types/scripts add up, never rename.

## Cloud backup (Puter, optional, off by default)

- Opt-in in Settings, in 3 steps: connect → password (≥12) → first upload.
- **In-browser encryption (AES-256-GCM + PBKDF2-600k)** before upload; the cloud only
  sees `{salt, iv, ct}`. **Password in memory only** — reloading pauses the automatic mode.
- Status in the top bar and footer (`cloud 2h ago`, `waiting for password`, `error`, `never`).
- **Conservative auto mode:** ~1 min after you stop, 5 min ceiling while typing
  non-stop, an attempt when the tab hides; only unlocked and online; never
  opens a login on its own; restore is never automatic.
- Transparency: account, file list (name/size/date) and quota (100 MiB free).
- **Deleting everything requires typing DELETE**; restart after a forgotten password without losing local data.
- Without Web Crypto (HTTP on the LAN), the feature refuses to run instead of uploading in the clear.

## Privacy and data

- **Offline-first:** IndexedDB + `localStorage` fallback; persistence requested
  from the browser; works without network once loaded.
- Nothing leaves the browser except the (encrypted) cloud backup, which is off by default.
- Per-session snapshots; safe migration of the legacy `narratips_db` database.
- Width, theme, fonts and active session remembered across reloads.

## Customization

- **Paper/night themes** applied before first paint (no light flash).
- **PT/EN language** in Settings (PT default); applies to the whole interface and
  syncs `document.lang`. Seeds and scripts stay in the language they were written in.
  The public page detects the browser language on first visit and remembers the manual switch.
- Separate font scale for topics and balloons; live / on-Enter-only modes;
  thin bar always visible or temporary.

## Shortcuts

| Where | Keys |
|---|---|
| Global | `Ctrl+E` export · `Ctrl+Z` / `Ctrl+Shift+Z` undo/redo (outside text) |
| Outline | `Enter` new topic · `Shift+Enter` soft break · `Tab`/`Shift+Tab` level · `Esc` release |
| Map | `+`/`-` zoom · arrows pan/navigate · `Ctrl+0` fit · `Enter`/`Space` select |
| Panel | `Home` minimum width · `Esc` close dialogs |
