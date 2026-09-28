# Accessibility & Usability Audit — Narratips (`sessionmap`)

**Mode:** Codebase (no browser) · **Scope:** Accessibility (ui-audit-dimensions §1) + Nielsen's 10 heuristics (ux-frameworks §1)
**Date:** 2026-09-28 · **Method:** full read of 14 files + 134 computed WCAG contrast pairs (python3, sRGB relative luminance)

> **Correction to the audit brief.** The brief stated that `src/index.css` holds the design tokens, themes, and all colour values. It does not — `index.css` is 29 lines and contains only `box-sizing`, a `font-family` stack, `user-select: none`, and a 6px scrollbar. There are no CSS custom properties, no `@theme` block, and no theme definitions anywhere in the project. The entire colour system is ~200 hard-coded Tailwind utility classes and ~25 hard-coded hex literals scattered across the `.tsx` files. The two themes (`papel` / `noite`) are plain runtime ternaries (`isDark ? … : …`) plus a `dark` class added to `<html>`. This materially changes the audit: there is no single place where contrast can be fixed, and the "tokens" story that the rest of the UX review is scoring is not implemented.

---

## 1. 🎯 Executive Summary

The app is keyboard-first **in the outline editor only** and pointer-only everywhere else. The primary artefact — the mind map — is a bare `<svg>` with no `role`, no `tabindex`, and node `<g>` elements that carry no semantics; the sole way to interact with it is `onPointerDown`/`onWheel`/`onClick`. Worse, the one control that would let a keyboard user act on a node, the `+N` collapse badge, is wired to a no-op handler in `TherapistView.tsx:624-627` that shallow-copies the root and never calls `toggleNodeCollapse`, so collapse is broken for everyone. Across the whole codebase there are **zero `aria-label` attributes and zero `role` attributes**, four overlay components with **no `role="dialog"`, no `aria-modal`, no focus trap, no Escape handler, and no focus restore**, and **no `prefers-reduced-motion`, no `forced-colors`, and no `prefers-contrast` handling anywhere** — despite 11 infinite `animate-ping`/`animate-pulse` instances and 86 `transition-*` utilities. The single most damaging defect is structural: Tailwind v4 compiles the `dark:` variant to `@media (prefers-color-scheme: dark)`, **not** to the `.dark` class the app toggles, so the app's own theme setting and every `dark:` utility are on two independent switches. In the `noite` theme on a light-preference OS, footer text renders at **1.07:1** and modal subtitles at **2.36:1**. The bright spot is contrast in the default `papel` theme, which is genuinely strong (body text 7:1–20:1, balloon text 19.4:1), and the outline editor's focus indicator, which is a full row inversion at 20.17:1 rather than a faint ring.

**Accessibility: 1/4** — Major gaps. Three WCAG Level A failures (2.1.1 keyboard, 2.2.2 moving content, 1.4.3 contrast in a whole theme combination), zero ARIA, zero focus management in overlays, zero reduced-motion, zero forced-colors. Not a 0 because the outline editor is legitimately keyboard-operable and the default theme's contrast is well above AA.
**Design Quality:** *scored by the parallel reviewer — out of scope here.*
**Overall: 4/8** if design scores 3 (most likely) → **Acceptable (significant work needed)**. Range is 3–5 (Acceptable → Good) depending on the design score; it cannot reach Good if accessibility stays at 1.

**Nielsen total: 26/40 → Acceptable (20-27).**

| # | Heuristic | Score |
|---|-----------|-------|
| 1 | Visibility of System Status | 3 |
| 2 | Match System and Real World | 4 |
| 3 | User Control and Freedom | 2 |
| 4 | Consistency and Standards | 2 |
| 5 | Error Prevention | 2 |
| 6 | Recognition Rather Than Recall | 3 |
| 7 | Flexibility and Efficiency of Use | 3 |
| 8 | Aesthetic and Minimalist Design | 3 |
| 9 | Help Users Recognize, Diagnose, Recover | 1 |
| 10 | Help and Documentation | 3 |

---

## 2. 🚨 Critical Issues (Blocking)

### P0

**- Mind map is pointer-only; no keyboard access to the primary artefact**`[accessibility]`(P0 Blocking)
- **What:** `MindMapCanvas.tsx:216-229` renders a `<div>` whose only input handlers are `onWheel`, `onPointerDown/Move/Up`. The `<svg>` at line 230 has no `role`, no `tabIndex`, no `aria-label`. Every node is a `<g>` in `BalloonNode.tsx:99-110` with an `onClick` and no `role="button"`/`tabindex`/accessible name. Zoom is available through `+`/`-` buttons (`:393-418`) but panning is pointer-only, and node selection (`onNodeClick`) is pointer-only. In `ClientView` the canvas is `readOnly` (`ClientView.tsx:170`), so `onNodeClick`/`onToggleCollapse` are `undefined` and the client window exposes **zero** interactive map affordances. Fails SC 2.1.1 (Keyboard, A) and SC 4.1.2 (Name/Role/Value, A).
- **Flagged by:** #3 Keyboard Navigation; #2 ARIA Labels & Roles
- **Recommendation:** Put the map in a `role="application"` (or `role="tree"`) container with `tabindex=0` and an `aria-label`; render each node as a focusable element with `role="treeitem"`, `aria-level`, `aria-expanded`, and `aria-selected`; implement roving-tabindex arrow-key traversal and +/-/Enter to expand/collapse; add keyboard equivalents for pan (arrow keys) and zoom.

**- Node collapse is a no-op — the only node-level control does nothing**`[accessibility]`(P0 Blocking)
- **What:** `TherapistView.tsx:624-627`:
  ```tsx
  onToggleCollapse={(nodeId) => {
    const newRoot = { ...activeMap.root };
    handleUpdateRoot(newRoot, 'collapse');
  }}
  ```
  The `nodeId` is ignored, `toggleNodeCollapse` is never called, and an identical tree is written back. The `+N` badge in `BalloonNode.tsx:254-280` is therefore a dead control. It also pushes a duplicate entry onto the undo history and triggers a spurious autosave. This removes the last node-level action a keyboard or AT user could have reached, and it makes the accessible fix in the finding above incomplete on its own.
- **Flagged by:** #3 Keyboard Navigation; Nielsen #3 (no way to complete the action)
- **Recommendation:** `handleUpdateRoot(toggleNodeCollapse(activeMap.root, nodeId), 'collapse')`. Also remove the phantom history entry by deduplicating structurally-equal roots before pushing.

**- Zero `prefers-reduced-motion`; continuous infinite animation for the whole session**`[accessibility]`(P0 Blocking)
- **What:** A `grep -rn "prefers-reduced-motion\|prefers-color-scheme\|forced-colors\|prefers-contrast"` over the entire project returns **no matches in `src/`**. Yet there are 11 infinite animations: `ClientView.tsx:149` `animate-ping`, `:151` `animate-pulse`, `:199` `animate-ping`; `TherapistView.tsx:443` `animate-pulse`, `:449` `animate-pulse`, `:650` `animate-ping`; `MindMapCanvas.tsx:300` `animate-pulse`; `BalloonNode.tsx:125, :155` `animate-pulse`, `:235, :245` `animate-ping`. Plus 86 `transition-*` utilities including a `transform 0.12s` inline transition on the world-transform group (`MindMapCanvas.tsx:259`). The `motion` package is in `package.json` but is **never imported** — every animation is raw Tailwind, so there is no animation layer to gate. Fails SC 2.2.2 (Pause, Stop, Hide, A) for content that moves for longer than 5s, and SC 2.3.3 (AAA) for the scale/opacity motion.
- **Flagged by:** #9 Reduced Motion
- **Recommendation:** Add to `index.css`: `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: .01ms !important; animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; } }`, and gate the dwell-progress ring and the live-typing caret behind `matchMedia('(prefers-reduced-motion: reduce)')` so they render as static state instead of motion.

**- `dark:` is compiled to `prefers-color-scheme`, so the app theme and the dark utilities are on two independent switches**`[accessibility]`(P0 Blocking)
- **What:** The app sets its theme by adding a class to `<html>` (`TherapistView.tsx:136-142`, `ClientView.tsx:43-49`), which is the class-strategy contract. But there is no `@custom-variant dark` in `index.css`, and the built stylesheet confirms the media-query strategy:
  ```
  @media (prefers-color-scheme:dark){.dark\:bg-slate-800{…}.dark\:text-slate-300{…}}
  ```
  So with **app theme = `noite` and OS preference = light**, the `isDark` ternaries paint dark surfaces while every `dark:` variant is inert. Computed ratios in that state:

  | Element | Ratio |
  |---|---|
  | `TherapistView.tsx:671` "Salvo localmente" `text-slate-900` on footer `bg-[#0B0F19]` | **1.07:1** |
  | `TherapistView.tsx:699/701/703` `Ctrl+.` / `Ctrl+Enter` / `Esc` on `#0B0F19` | **1.07:1** |
  | `TherapistView.tsx:676` "100% offline & seguro" on `#0B0F19` | **2.53:1** |
  | `SettingsModal.tsx:39,59,97,134,170,195,227` every setting description on `bg-slate-900` | **2.36:1** |
  | `ExportModal.tsx:279, :391` on `bg-[#0B0F19]` / `bg-slate-900/90` | **2.53:1 / 2.36:1** |
  | `MapListDrawer.tsx:91` on `bg-slate-900` | **2.36:1** |
  | `AdminClientManager.tsx:213` on `bg-[#0B0F19]` | **2.53:1** |
  | `AdminClientManager.tsx:235` "Clientes (n)" on `bg-slate-50/60` over `slate-950` | **1.31:1** |
  | `ShareGuideModal.tsx:37` on `bg-slate-900` | **3.75:1** |
  | `ShareGuideModal.tsx:60` on `bg-slate-800/40` over `slate-900` | **2.23:1** |
  | `TherapistView.tsx:646` thin-bar label `text-amber-700` on `bg-slate-900/95` | **3.55:1** |

  Fails SC 1.4.3 (Contrast Minimum, A). The inverse combination (OS dark + theme `papel`) is mostly self-correcting because most `dark:` background and `dark:` text classes are paired on the same element, but the same class of bug exists.
- **Flagged by:** #1 Color Contrast; #11 Color Scheme Adaptation
- **Recommendation:** Add `@custom-variant dark (&:where(.dark, .dark *));` to `index.css` so `dark:` binds to the app's own switch, and add a `@media (prefers-color-scheme: dark)` seed that sets the initial `settings.theme` on first run for users who never open Settings. Then remove the parallel `isDark ? … : …` ternaries so there is exactly one source of truth for the theme.

**- No dialog semantics, focus trap, Escape handling, or focus restore in any of the four overlays**`[accessibility]`(P0 Blocking)
- **What:** `ExportModal.tsx:74`, `SettingsModal.tsx:18`, `ShareGuideModal.tsx:20`, `MapListDrawer.tsx:48` and `AdminClientManager.tsx:62` all `return null` when closed and render a bare `<div className="fixed inset-0 z-50 …">`. There is **no `role="dialog"`, no `aria-modal`, no `aria-labelledby`** anywhere in the project (`grep -rn 'role=' --include=*.tsx src` → 0 matches). No modal registers a keydown listener, so **Escape closes nothing** — `TherapistView.tsx:251-271` binds `Ctrl+.`, `Ctrl+E`, `Ctrl+Z` globally and nothing else, and the only `Escape` handler in the app is `OutlineEditor.tsx:296`, which clears node focus. There is no focus trap, so Tab walks out of the overlay into the still-mounted page behind it, and no focus restore on close, so focus resets to `<body>`. Note this also means the `Ctrl+E` shortcut still fires while a modal is open, re-rendering it. Fails SC 2.1.2, SC 2.4.3, SC 4.1.2.
- **Flagged by:** #4 Focus Management; #2 ARIA Labels & Roles
- **Recommendation:** Extract a shared `<Modal>` primitive that renders `role="dialog" aria-modal="true" aria-labelledby={titleId}`, moves focus to the container (or first focusable) on mount, cycles Tab within a sentinel pair, restores focus to the trigger on unmount, and binds Escape. The four near-identical header/close/footer blocks are already duplicated 5×, so this is a net line-count reduction.

**- No `forced-colors` / `prefers-contrast` handling; state is carried by colours and 1px borders below 3:1**`[accessibility]`(P0 Blocking)
- **What:** No `forced-colors` or `prefers-contrast` query exists in the project. Every state cue is a `background-color` + `border` + `text-color` combination: connection status dots (`TherapistView.tsx:444, :449, :454`), card borders (`MapListDrawer.tsx:156-164`, `AdminClientManager.tsx:474-482` — all `border-slate-300` on white = **1.48:1**), the two `SettingsModal` toggles (`bg-amber-500` / `bg-slate-300` on `bg-slate-100`), the outline collapse chevron, and the mind map connectors (`MindMapCanvas.tsx:280` `#475569` on `#0B0F17` = **2.53:1**). In Windows High Contrast these are all replaced by the system palette, so the card and toggle boundaries disappear and the only remaining differentiator is a text change that is itself at 2.45:1. Fails SC 1.4.11 (Non-text Contrast, AA) and SC 1.4.1 (Use of Color).
- **Flagged by:** #10 Forced Colors; #1 Color Contrast
- **Recommendation:** Add a `@media (forced-colors: active)` block forcing `forced-color-adjust: none` on status dots, or (preferred) give every state a redundant non-colour cue: `aria-pressed`/`aria-checked` on the toggles, a border-width or ring change (2px vs 1px) on cards, and a text glyph on the status dots. Add `focusDwellSeconds`, `focusZoomMode`, and `liveTextMode` as real `role="switch"`/`aria-pressed` toggles so state is available to AT even when colour is stripped.

### P1 Major

**- Zero `aria-label` in the entire app; four close buttons have no accessible name at all**`[accessibility]`(P1 Major)
- **What:** `grep -rn "aria-" src/` returns exactly 6 hits, all `aria-hidden="true"` on the decorative `·` separators. There are 15 icon-only buttons. `ExportModal.tsx:283`, `SettingsModal.tsx:44`, `MapListDrawer.tsx:95` and `ShareGuideModal.tsx:42` render a bare `<X className="w-5 h-5"/>` with **no `aria-label` and no `title`** — a screen reader announces "button". (`AdminClientManager.tsx:218` is the only close button that has even a `title`.) The other icon buttons (`TherapistView.tsx:522, 531, 540, 549, 593`; `MindMapCanvas.tsx:372, 393, 406, 420, 428`; `MapListDrawer.tsx:207, 215, 227`; `AdminClientManager.tsx:238, 353, 366, 510, 540`) rely on `title`, which is an accname fallback only — it is silent on touch, invisible to voice-control users, and never appears on hover for keyboard users. Fails SC 4.1.2.
- **Recommendation:** Add `aria-label` to all 15. Pair with `aria-hidden="true"` on the lucide `<svg>` so the icon is not announced twice.

**- Focus indicator is a 1px border-colour change at 1.45:1–2.15:1**`[accessibility]`(P1 Major)
- **What:** `ExportModal.tsx:588-592` and `MapListDrawer.tsx:125-129` and `AdminClientManager.tsx:256, :283, :320` all apply `outline-none` and then use `focus:border-amber-500` (or `focus:border-amber-400`) as the *only* focus signal. Measured: amber-500 focus border vs the `bg-slate-50`/`white` field = **2.05:1 / 2.15:1**; versus its own unfocused `border-slate-300` state = **1.45:1**. Fails SC 2.4.7 (AA) and SC 1.4.11 (AA). (The dark-theme variants pass at 8.76:1 and 12.08:1 — only the light theme is broken.)
- **Recommendation:** Use `focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:ring-offset-2` (Tailwind's ring uses `box-shadow` and is unaffected by `outline-none`), or `focus-visible:outline-2 focus-visible:outline-amber-600`.

**- Client-window text below 4.5:1 in both themes**`[accessibility]`(P1 Major)
- **What:** This is the surface the client actually looks at during the session, and it has the weakest contrast in the app.
  - `ClientView.tsx:207` "Aguardando conexão com a sessão do terapeuta…" `text-slate-400` on `bg-[#F7F6F2]`, 14px = **2.37:1** (SC 1.4.3 fail)
  - `ClientView.tsx:155` "A visualização continuará em instantes…" `text-stone-400` on `#F7F6F2`, 12px = **2.33:1** (SC 1.4.3 fail)
  - `ClientView.tsx:155` dark variant `dark:text-slate-500` on `bg-slate-950`, 12px = **4.24:1** (SC 1.4.3 fail)
  - `ClientView.tsx:190` thin-bar label `text-amber-600` on `bg-white`, 12px bold = **3.19:1** (SC 1.4.3 fail; 12px bold is *not* large text, so the 3:1 threshold does not apply)
  - `ClientView.tsx:217` fullscreen toggle: `text-slate-400` at `opacity-30` on `#F7F6F2` = **1.43:1**; even at `opacity-100` = **2.37:1**. This is the only control on the client window, and at rest it is 57% opacity. (SC 1.4.11 fail)
  - `ClientView.tsx:199` live caret `text-amber-500` on white = **2.15:1**; `ClientView.tsx:149` ping ring `border-stone-300` on `#F7F6F2` = **1.38:1** (SC 1.4.11 fail)
- **Recommendation:** `text-slate-500` → ≥`text-slate-600` (7.01:1) on the two empty/pause states; `text-amber-700` for the thin-bar label (5.02:1); drop the `opacity-30` on the fullscreen control to `opacity-70` and use `text-slate-600`.

**- Non-text UI components fail SC 1.4.11 across the app**`[accessibility]`(P1 Major)
- **What:** All below the 3:1 threshold:
  - Card and tool-button borders `border-slate-300` on white = **1.48:1** (`TherapistView.tsx:526,535,544,558`; `MapListDrawer.tsx:150-164`; `AdminClientManager.tsx:474-482`)
  - `TherapistView.tsx:431` separator `·` `text-slate-400` on `bg-slate-50` = **2.45:1**; `:435` `ChevronDown` = **2.45:1**
  - `TherapistView.tsx:454` "Desconectado" dot `bg-amber-500` on `bg-amber-50` = **2.07:1**; `:670` `CheckCircle2` "save status" `text-emerald-600` on white = **3.77:1** vs 4.34 required
  - `SettingsModal.tsx:145` toggle ON: white knob on `bg-amber-500` = **2.15:1**; `:146` toggle OFF track `bg-slate-300` on `bg-slate-100` = **1.36:1**
  - `MindMapCanvas.tsx:382` "Zoom no Foco" active state: white on `bg-amber-500`, 12px bold = **2.15:1** (text)
  - `MindMapCanvas.tsx:213, :244` grid dot `#D1D5DB` @0.6 on `#F7F6F2` = **1.22:1**; `#334155` @0.6 on `#0B0F17` = **1.38:1**
  - `MindMapCanvas.tsx:271` highlight glow `#F59E0B` @0.5 on `#F7F6F2` = **1.23:1**
  - `BalloonNode.tsx:122` selection halo `#F59E0B` on white = **2.15:1**; `:135` outer halo `#FBBF24` @0.4 = **1.24:1**
  - `index.css:23` scrollbar thumb `rgba(100,116,139,0.25)` on `#F7F6F2` = **1.22:1** (hover 0.45 → 1.77:1)
  - `OutlineEditor.tsx:578` dwell ring `#CBD5E1` on white = **1.48:1**; `:585` arc `#F59E0B` = **2.15:1**
  - `BalloonNode.tsx:265` `+N` badge fallback `fill={color || '#3B82F6'}` with white 10px text = **3.68:1**. All 8 `BRANCH_PALETTE` colours pass (5.02:1–10.35:1), so only the fallback fails — but the fallback is what renders whenever a node has no `color`.
  - `ShareGuideModal.tsx:45` close `X` `text-slate-400` on white = **2.56:1**; `:55` card border `border-slate-200/70` on white = **1.15:1**
- **Recommendation:** Establish a floor: borders and icons at `slate-400`+ (3:1), state dots at `slate-600`+ or with a ring, and bump `amber-500` foreground pairs to `amber-700`/`slate-950` on the affected elements. The grid dot pattern and the halo glows are decorative and may be excluded from 1.4.11 (they carry no information) — but the connectors, dots, and toggle tracks are not decorative.

**- No live region: async state is never announced**`[accessibility]`(P1 Major)
- **What:** `saveStatus` (`TherapistView.tsx:82, :671`), `importStatus` (`ExportModal.tsx:64, :596-606`), `isExportingZip` (`:59, :427`), and the dwell progress ring (`OutlineEditor.tsx:565-594`) all change asynchronously and none of their containers has `role="status"`, `role="alert"`, or `aria-live`. A screen-reader user who triggers an export gets no confirmation that it started or finished. Additionally the import error message (`ExportModal.tsx:258-263`, the app's only error text) is not associated with the textarea via `aria-describedby` and has no `aria-invalid` on the field. Fails SC 4.1.3 (Status Messages, AA) and SC 3.3.1.
- **Recommendation:** Wrap the import status in `role="alert"`, the save/footer status in `role="status" aria-live="polite"`, give the textarea `aria-describedby={statusId}` and `aria-invalid`, and add `aria-busy` to the export panel while `isExportingZip`.

**- Settings state conveyed by colour alone, with no programmatic state**`[accessibility]`(P1 Major)
- **What:** The five segmented controls in `SettingsModal.tsx:64-88 (theme), :103-124 (liveTextMode), :140-154 (thinBar), :201-215 (focusZoom), :232-245 (fontScale)` are `<button>` pairs whose selected state is expressed purely through `bg-slate-950 text-white` vs `text-slate-700`. There is no `aria-pressed`, no `role="radiogroup"`/`role="radio"`, and no `role="switch"` + `aria-checked` on the two toggles. A screen reader announces five identical buttons with identical names and no state. Fails SC 4.1.2 and SC 1.4.1 (Use of Color).
- **Recommendation:** Wrap each group in `role="radiogroup"` with `aria-label`, and give each button `role="radio" aria-checked={selected}` (segmented controls are radiogroups, not toggles — only the two pill switches should be `role="switch" aria-checked`).

**- No landmarks**`[accessibility]`(P1 Major)
- **What:** `grep -rn "<main\|<nav\|<aside\|<section\|<article" src` → 0 matches. The only landmarks are `<header>` (`TherapistView.tsx:395`) and `<footer>` (`:661`). The split view, the outline editor, and the canvas are undifferentiated `<div>`s, so an AT user navigating by landmark hears only "banner" and "contentinfo" for an app with four major regions.
- **Recommendation:** `<main>` around the split view, `<nav aria-label="Sessões e clientes">` around the outline editor, `<aside>` or `<section aria-label="Prévia do mapa">` around the canvas. Add an `aria-live` "skip link" or at minimum make the outline editor a `<section aria-labelledby>`.

---

## 3. 🤔 Important Issues (Refinement)

**- Two outline controls removed from the tab order; collapse has no keyboard equivalent**`[accessibility]`(P2 Minor → P1 in effect)
- `OutlineEditor.tsx:477` (collapse chevron) and `:526` ("+ Filho") both carry `tabIndex={-1}`. "Criar filho" is recoverable via `Ctrl+Enter` (`:179-183`), but **collapse is not** — the chevron is the only affordance and it is unreachable. Combined with the P0 no-op handler, a collapsed subtree can neither be collapsed nor re-expanded. Recommend removing `tabIndex={-1}` from both (the "invisible until hover" `opacity-0 group-hover:opacity-100` pattern at `:535` is why they were excluded — fix that with `group-focus-within:opacity-100` instead).

**- Broken heading hierarchy, no `h1` anywhere**`[accessibility]`(P2 Minor)
- The document has **no `<h1>`**. Every modal opens at `<h3>` (`ExportModal:276`, `SettingsModal:38`, `ShareGuideModal:36`, `MapListDrawer:90`, `AdminClientManager:210`), and `AdminClientManager` inverts the order — `h3` at `:210` followed by `h2` at `:406`. `ClientView` starts at `h2` (`:154`). `MapListDrawer:190` uses `h4` inside an `h3`, which is fine. Fails SC 1.3.1. Recommend an `h1` for the app/section name and re-level the modals.

**- `<label>` elements with no associated control in SettingsModal**`[accessibility]`(P1 Major)
- `SettingsModal.tsx:58, 96, 133, 162, 194, 223` each render a `<label>` whose text describes a *setting group*, not a form control, and none has `htmlFor` or wraps an input. They therefore contribute nothing to any control's accessible name — the two `range`/toggle groups are named only by the surrounding `<p>`. The `input type="range"` at `:173-181` has no `<label for>`, no `aria-label`, and no `aria-valuetext` (so it announces "3" rather than "3 segundos"). `MapListDrawer.tsx:120` and `AdminClientManager.tsx:250, :278` rely on `placeholder` as the only label. Fails SC 3.3.2 and 4.1.2. Recommend `aria-labelledby` pointing at the group label id, and `aria-valuetext="3 segundos"` on the range.

**- `user-select: none` on `<body>` blocks selecting the export previews**`[accessibility]`(P2 Minor)
- `index.css:10` sets `user-select: none` globally, and `index.html:16` repeats it on `<body>`. `ExportModal.tsx:473, 702, 741, 780` render `<pre>` blocks containing the entire Markdown/OPML/FreeMind/JSON output. `OutlineEditor.tsx:353` has to opt back in with `select-text`, which confirms the intent. A user who wants to copy a fragment by hand (rather than hit the "Copiar" button) cannot select it. Recommend `user-select: text` on the `<pre>` elements.

**- Client window hides the pointer unconditionally**`[accessibility]`(P2 Minor)
- `ClientView.tsx:96-102` sets `cursorHidden` after 2.5s of mouse idle and `:137-139` applies `cursor-none` to the whole window, with no setting and no reduced-motion / pointer-coarse guard. On a projector or shared video call this removes the pointer for anyone with a tremor, low vision, or an unusual pointing device. The client window is read-only so task impact is limited, but it should be gated on `matchMedia('(pointer: fine)')` and a user setting.

**- Export tabs are not a tab widget**`[accessibility]`(P2 Minor)
- `ExportModal.tsx:293-372` implements seven tabs as plain buttons: no `role="tablist"`, `role="tab"`, `aria-selected`, `aria-controls`, no arrow-key navigation, and no `tabpanel`. Fails SC 1.3.1/4.1.2. `ShareGuideModal.tsx:88-122` has the identical defect for its three platform tabs.

**- `MapListDrawer` is unreachable dead code**`[accessibility]`(P2 Minor)
- `TherapistView.tsx:74` declares `isMapListOpen` and `:758` passes it to the drawer, but `setIsMapListOpen(true)` is **never called anywhere in the codebase**. 274 lines of UI, including the map search box, the rename/duplicate/delete flow, and the JSON backup button, are dead. Its a11y defects (no dialog role, no Escape, no focus restore, placeholder-only search) are consequently not user-facing yet, but they are also not fixed. The related `Settings.autoFitOnAdd` field is likewise persisted to `localStorage` (`services/storage.ts:18`) and never read.

**- Three different "dark surface" tokens**`[accessibility]`(P2 Minor)
- `bg-slate-900` (`SettingsModal:30`, `ShareGuideModal:26`, `MapListDrawer:84`), `bg-[#0B0F19]` (`TherapistView:398,664`, `ExportModal:270`, `AdminClientManager:199`), `bg-[#0E131F]` (`OutlineEditor:354`), `bg-[#131926]` (`OutlineEditor:361`), `bg-[#0B0F17]` (`MindMapCanvas:227`), plus `index.html:16` hard-coding `bg-[#FBFBF9] text-slate-800` outside the theme system. Six literals for what should be one `--surface` token. This is the mechanical reason the P0 theme mismatch has so many casualties.

---

## 4. 🔎 Minor Clarifications

- `motion@^12.23.24` is a declared dependency that is never imported anywhere in `src/`. It should be removed or actually used behind a reduced-motion gate.
- `BalloonNode.tsx:348` passes `node: null as any` for the ghost node — a type escape hatch that would hide real layout bugs.
- The dwell-timer auto-focus (`OutlineEditor.tsx:113-150`) fires from `activeNodeId`, and `onFocus` calls `focusInput` (`:511-513`). A keyboard user arrowing through the outline therefore triggers the 3-second client-facing auto-highlight on every row they pass, with no way to suppress it mid-session. `focusDwellSeconds: 0` is the only off switch and it is buried in Settings.
- `TherapistView.tsx:699-703` advertises `Ctrl+Enter` in the footer, but the handler that implements it lives on the outline input only (`OutlineEditor.tsx:179`) and is not in the global handler at `:251-271`. The footer is advertising a shortcut that only works with DOM focus inside the outline.
- `MindMapCanvas.tsx:367` applies `opacity-40` to the whole floating control cluster in `readOnly` mode, taking the `Plus`/`Minus`/`fit`/`reset` icons to **2.37:1** against white. The controls are still interactive at that opacity.
- `index.css:16` sets the scrollbar to 6px. Below the practical minimum for a draggable target, and at 1.22:1 it is not perceivable.
- `TherapistView.tsx:130` sets the tab title to `PRIVADO · {clientName} (date)`. `ClientView.tsx:38-40` deliberately neutralises its own title to `"Mapa"` (tagged RF-40/RF-42), and `ShareGuideModal.tsx:68-72` sells the client on "O título é apenas 'Mapa'. Nenhum nome do cliente na aba" — true in the client window, but the therapist's own tab (and any screen-share of the browser chrome) still shows the name.

---

## 5. ✅ Strengths

- **The default `papel` theme's contrast is genuinely excellent, and it was measured, not assumed.** 94 of 134 computed pairs pass. Body and metadata text lands at 7.01:1–20.17:1; the primary button (`TherapistView.tsx:512`) is 20.17:1; the header/footer chrome on `#0B0F19` runs 6.6:1–14.5:1. Most tellingly, the comment at `OutlineEditor.tsx:391` claims "WCAG AAA compliant" for the row styling — and it holds up: the active row is 20.17:1 and the selected row 14.56:1, both comfortably past the 7:1 AAA bar. That is a rare case of an author verifying rather than asserting.
- **The outline editor is the one genuinely keyboard-first surface in the app, and it is well designed.** `OutlineEditor.tsx:171-300` implements ↑/↓ navigation, `Enter` = sibling, `Ctrl+Enter` = child, `Tab`/`Shift+Tab` = indent/unindent, `Alt+↑/↓` = reorder, `Backspace` on empty = delete-or-unindent, and `Esc` = clear focus — with `preventDefault` on each, an `inputRefs` map for programmatic focus (`:57, :84-93`), and a `dwellTimerRef` correctly cleared on every path (`:99-110, :141-144`). Critically, its focus indicator is a **full-contrast row inversion** (20.17:1), not a 1px ring — this is the pattern the other 15 focusable controls should copy.
- **Node balloons use a purpose-built dark ramp rather than reusing the light fills.** `BalloonNode.tsx:66-88` steps `#1E293B` → `#151D2C` → `#020617` and pairs each with white text at 14.63:1, 16.88:1 and 20.17:1. The 8-colour `BRANCH_PALETTE` (`useMindMapLayout.ts:44-53`) is all deep, saturated, and passes 3:1 as 2.2px connector strokes on `#F7F6F2` at 4.64:1–9.58:1 — meaning the light-theme map is fully legible, and it is the *dark* connector (`:280`, hardcoded `#475569`) that is the outlier.
- **Small semantic details done right:** `index.html:2` sets `lang="pt-BR"` correctly; the six decorative `·` separators carry `aria-hidden="true"` rather than being left to be read aloud; `index.html:6` provides a real `<title>`; the hidden file inputs (`ExportModal:574`, `AdminClientManager:413`) keep their `accept` filters so they are operable by keyboard through the visible proxy button.
- **Real accommodations exist, not just claims:** `clientFontScale` at 85/100/115/130% (`SettingsModal:232-245`) is a genuine low-vision control, `focusDwellSeconds: 0` genuinely disables the auto-focus, and the privacy posture is unusually well thought through — `ClientView.tsx:38-40` neutralises the document title and `?view=client` (`App.tsx:6-18`) produces a window with no outline, no menus, and no settings at all.

---

## 6. [needs browser] Flag Summary

The following could not be settled from source alone and require an `agent_browser` run before they can be closed:

1. **Forced-colors behaviour.** The *absence* of any `forced-colors` query is confirmed from source, but the visual result under Windows High Contrast (which elements vanish, which survive via the system palette) needs a real run.
2. **Composited contrast where opacity + `backdrop-blur` stack.** My ratios for `bg-white/95` + `backdrop-blur-md` (`TherapistView:590, :640`), `bg-slate-50/50` footers (`SettingsModal:251`, `ShareGuideModal:158`), and the `bg-*/70` overlay cards assume a nominal composite against the nominal backdrop. Real compositing over a blurred, non-uniform backdrop can shift these. Re-verify with a contrast probe in situ.
3. **UA default focus ring on the ~40 buttons with no explicit focus style.** Tailwind v4's preflight does not remove the browser's `:focus-visible` ring (it only sets `:-moz-focusring` for Firefox), so these probably pass — but this must be confirmed in Chrome and Safari, and the finding above stands regardless because the *styled* focus states still fail.
4. **Visual confirmation of the `dark:`-on-`prefers-color-scheme` mismatch.** The mechanism is proven from the built stylesheet; the *rendered* result needs a run with app theme = `noite` and the OS at light preference.
5. **Screen-reader announcement order and verbosity of the SVG map.** `MindMapCanvas`'s `<text>` nodes are inside a transformed `<g>`; how VoiceOver/NVDA sequence them, and whether the balloon texts are announced as one undifferentiated run, is not determinable from source.
6. **Whether the 3-second dwell auto-highlight is disorienting in practice** (`OutlineEditor.tsx:113-150`) — a timing/attention judgement, not a static one.

---

## Appendix — computed contrast ledger (selected)

| Ratio | Thr | Element |
|---:|---:|---|
| **1.07** | 4.5 | `TherapistView:671,699,701,703` `text-slate-900` on `bg-[#0B0F19]` (theme=noite, OS=light) |
| **1.31** | 4.5 | `AdminClientManager:235` `text-slate-800` on `bg-slate-50/60` over `slate-950` |
| **1.43** | 3.0 | `ClientView:217` fullscreen icon at `opacity-30` on `#F7F6F2` |
| **1.48** | 3.0 | every `border-slate-300` card/tool border on white |
| **1.77** | 3.0 | `index.css:26` scrollbar thumb hover |
| **2.15** | 3.0 | `SettingsModal:145` white knob on `bg-amber-500`; `MindMapCanvas:382` white on amber-500 (text) |
| **2.23** | 4.5 | `ShareGuideModal:60` `text-slate-600` on `bg-slate-800/40` over `slate-900` |
| **2.33** | 4.5 | `ClientView:155` `text-stone-400` on `#F7F6F2` |
| **2.36** | 4.5 | all 7 `SettingsModal` setting descriptions on `bg-slate-900` (theme=noite, OS=light) |
| **2.37** | 4.5 / 3.0 | `ClientView:207` `text-slate-400` on `#F7F6F2`; `:217` at full opacity |
| **2.45** | 4.5 | `TherapistView:431` separator `·` on `bg-slate-50` |
| **2.53** | 3.0 / 4.5 | `MindMapCanvas:280` dark connector `#475569` on `#0B0F17`; `TherapistView:676` |
| **2.56** | 3.0 | `ShareGuideModal:45` close `X` `text-slate-400` on white |
| **2.95** | 3.0 | `MindMapCanvas:271` highlight stroke `#D97706` on `#F7F6F2` |
| **3.19** | 4.5 | `ClientView:190` `text-amber-600` on white, 12px bold |
| **3.55** | 4.5 | `TherapistView:646` thin-bar label on `bg-slate-900/95` |
| **3.68** | 4.5 | `BalloonNode:265` `+N` fallback badge white on `#3B82F6` |
| **3.77** | 3.0 | `TherapistView:670` `CheckCircle2` `text-emerald-600` on white |
| **4.24** | 4.5 | `ClientView:155` `dark:text-slate-500` on `bg-slate-950` |
| 5.02 | 4.5 | `TherapistView:646` `text-amber-700` on white/95 (light theme) — PASS |
| 7.01 | 4.5 | `TherapistView:631` `text-slate-600` on `#F7F6F2` — PASS |
| 8.31 | 4.5 | `ExportModal:424` `text-slate-950` on `bg-amber-500` — PASS |
| 14.56 | 4.5 | `OutlineEditor:418` black on `bg-amber-300` selected row — PASS |
| 19.43 | 4.5 | `BalloonNode:68` node text `#090D16` on `#FFFFFF` — PASS |
| 20.17 | 4.5 | `TherapistView:512` white on `bg-slate-950`; `OutlineEditor:405` active row — PASS |

134 pairs computed · **94 pass · 40 fail** (28 non-text < 3:1, 12 text < 4.5:1).
