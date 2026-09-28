# Design Quality Audit — Narratips (sessionmap)

**Mode:** Codebase (no browser)
**Scope:** Design Quality only — `0` Compositional Quality, `0a` Interaction States Coverage, `2.1` Visual Hierarchy, `2.2` Cognitive Load, `2.3` Consistency, `2.4` Mobile/Responsive, `2.5` AI Slop, plus Cognitive Load Assessment, Emotional Journey, Design Personas from `ux-frameworks.md`.
**Excluded:** WCAG contrast ratios, ARIA, keyboard operability verdicts — delegated to the sibling a11y reviewer. Where a finding is fundamentally a contrast/ARIA problem I flag it as a *design-system* issue and hand the ratio measurement off.
**Files read in full:** `src/index.css`, `index.html`, `src/App.tsx`, `src/components/ClientView.tsx`, `src/components/TherapistView.tsx`, `src/components/admin/AdminClientManager.tsx`, `src/components/mindmap/BalloonNode.tsx`, `src/components/mindmap/MindMapCanvas.tsx`, `src/components/mindmap/useMindMapLayout.ts`, `src/components/modals/ExportModal.tsx`, `src/components/modals/MapListDrawer.tsx`, `src/components/modals/SettingsModal.tsx`, `src/components/modals/ShareGuideModal.tsx`, `src/components/outline/OutlineEditor.tsx`.

---

## 1. 🎯 Executive Summary

The composition is genuinely thoughtful — a 38/62 capture-then-broadcast split, three-zone header chrome, a 3:1 accent hierarchy, a hand-picked editorial branch palette with named hue rationale, and a Plus Jakarta Sans + warm-paper theme that is deliberately *not* the default-AI look. Against that, the component layer is a pure duplication exercise: **five overlays, five hand-rolled shells, zero shared dialog abstraction, and zero components that clear 4 of 9 interaction states.** The therapist surface is a desktop-with-mouse instrument that will not survive a 375px viewport or a fingertip, and the delete path for clinical records runs through a native `window.confirm()` while the 10-second undo toast that already exists is wired to a component that can never be opened.

```
Accessibility: not scored — out of scope, sibling review
Design Quality: 2/4 — Acceptable
Overall: 2/4 on the design half (combined pending a11y pass)
```

**Design Quality score: 2/4 (Acceptable)** — works on a ≥1280px desktop with a mouse; clear issues everywhere else.

### Sub-scores

| Dimension | Score | One-line justification |
|---|---|---|
| 0 Compositional Quality | 3/4 | Layout is a consequence of the Operate work pattern; only real defect is three competing controls for one boolean |
| 0a Interaction States | 1/4 | **2.5/9 average**, 0 components reach the ≥6 target |
| 2.1 Visual Hierarchy | 2/4 | Legible 3-zone chrome, but 3 filled buttons can co-exist and the active outline row collides with the primary CTA |
| 2.2 Cognitive Load | 2/4 | Moderate (3 fails / 3 partial / 2 pass) |
| 2.3 Consistency | 1/4 | Zero tokens, 5 modal shells, 6 border radii, 3 sources of truth for `theme` |
| 2.4 Mobile/Responsive | 0/4 | Zero `@media` rules, every secondary control 20–36px, hover-only actions unreachable by touch |
| 2.5 AI Slop | 3/4 | 4 tells, all localized to `ExportModal` + a privacy microcopy cluster |

### Headline metrics

| Metric | Value | Reference baseline |
|---|---|---|
| **Average interaction state coverage** | **2.49 / 9 (28%)** | Human 7–9, AI 1–2, target ≥6 |
| Components reaching ≥6 states | **0 / 61** | target ≥6 |
| Components reaching ≥5 states | **0 / 61** | — |
| **AI slop tells** | **4 confirmed** (+4 borderline) | 0 = distinctive, 1–2 = clean, 3–4 = noticeable |
| **AI slop verdict** | **🤔 Some tells — noticeable AI aesthetic** | localized, not systemic |
| `@media` queries in codebase | **0** | — |
| Tailwind breakpoint usages | **6** (all inside modals) | — |
| Design tokens / CSS variables | **0** | — |
| Distinct surface color literals | **7** (5 dark, 2 light) | 1 |
| Distinct border radii | **6** | 2–3 |
| Touch targets ≥44×44px | **0 of ~34 secondary controls** | all |
| Modal duplication verdict | **Severe — no shared shell exists** | — |

---

## 2. 🚨 Critical Issues (Blocking)

### C1. Deleting a client's session or a whole client runs through native `window.confirm()` — and the undo path that already exists is unreachable `design` `(P0 Blocking)`

- **What:** Two destructive paths in `AdminClientManager.tsx`:
  - `handleDeleteClient` (L173–183) — `confirm('Tem certeza que deseja excluir este cliente e suas sessões?')` → `deleteClient(clientId)`. Cascades to every session that client owns. No count of what is lost. No statement that it is unrecoverable. No undo. `Enter` defaults to OK.
  - `handleDeleteSession` (L186–192) — `confirm(\`Excluir a sessão ${session.sessionDate || session.title}?\`)` → `deleteMap(session.id)`. No count, no "não pode ser desfeito", no undo.

  Meanwhile the *correct* pattern is already implemented and **disconnected**: `TherapistView.tsx` L341–362 (`handleDeleteMapWithUndo` / `handleRestoreDeletedMap`) plus the 10-second undo toast at L771–782. That machinery is only ever passed to `MapListDrawer` (L766). And `MapListDrawer` can never be opened — `setIsMapListOpen(true)` is **never called anywhere in the codebase**; `grep -rn "setIsMapListOpen" src/` returns exactly two hits, the `useState` declaration (L74) and `onClose` (L759). So the toast never renders, and the only live delete is a native dialog over irreversible clinical records.
- **Flagged by:** Emotional Journey → "Delete / destructive action: fear of irreversible loss → confirmation dialog, undo option, time-delay"; Nielsen #3 (User Control and Freedom: "No way to reverse anything" = 0); Interaction State 0a.8 (Error/recovery path absent).
- **Impact:** These are therapeutic session records. There is no server, no backup rotation, and the app is offline-by-design. One `Enter` keypress in a native dialog permanently destroys a client's session history. The undo window the developer already built — the exact intervention the framework calls for — is dead code.
- **Recommendation:** (1) Wire `onDeleteMapWithUndo` into `AdminClientManager`'s session and client delete handlers so the existing 10s undo toast actually fires; extend it to cover `deleteClient`. (2) Replace `window.confirm()` with an in-app confirm that states what will be lost ("Esta sessão contém 47 balões. Esta ação não pode ser desfeita.") — a native dialog also breaks the entire design language, which is its own P2. (3) Extend the undo window to ≥20s and add a visible countdown. (4) Add a redacted "backup everything before destructive actions" prompt. This is the single most important fix in the audit.

### C2. Therapist surface is a fixed-px desktop layout with zero responsive behaviour `design` `(P0 Blocking)`

- **What:** `grep -rn "@media" src/ index.html` returns **zero matches**. Only six Tailwind breakpoint classes exist in the entire app, and all six are inside modals: `TherapistView.tsx:440` (`lg:flex`), `:505` (`sm:inline`), `AdminClientManager.tsx:430` (`sm:inline`), `ExportModal.tsx:379,491` (`md:grid-cols-3`), `ShareGuideModal.tsx:54` (`md:grid-cols-3`).
  - `TherapistView.tsx` L390 root: `flex flex-col w-screen h-screen overflow-hidden`. Header L396: `h-14 px-5 flex items-center justify-between` — three zones in a row with no `flex-wrap` and no `overflow-x-auto`. Zone 1 (brand + PRIVADO pill + client switcher) ≈ 340px, Zone 3 (focus-zoom + "Janela do Cliente" + divider + 4× `w-9` icon buttons) ≈ 350px. Minimum header content ≈ 690px in a 375px viewport. It will crush, not wrap.
  - Split view L567: `flex-1 flex` with the outline pane at `style={{ width: '38%' }}` (L572) and canvas `flex-1`. At 375px the outline pane is **142px wide** and there is no breakpoint that stacks them — only the manual `isMaximizedMap` toggle (L593).
  - Footer L662: `flex items-center justify-between px-5` with 6 items including 3 shortcut hints. ≈600px minimum, no wrap.
  - `AdminClientManager.tsx` L197: `max-w-4xl` with a fixed `w-72` left column (L231) and `flex-1` right column. At 375px the modal is 343px wide, left column 288px, **right column ≈55px**.
  - `SettingsModal.tsx` rows L56–247: `flex items-center justify-between` with no `flex-col` fallback. The font-scale control (L231) is 4 buttons ≈176px wide; at 375px the labels beside it collapse to nothing.
  - `OutlineEditor.tsx` L450: `style={{ paddingLeft: \`${Math.max(10, item.level * 22 + 10)}px\` }}` with no cap. At outline depth 12 that is 274px of indent inside a 142px pane → horizontal overflow inside a `overflow-hidden` parent.
- **Flagged by:** 2.4 #2 (No horizontal scroll) and #3 (Layout adapts at reasonable breakpoints) — both fail. 2.2 #6 (Navigation predictable).
- **Recommendation:** Add a `useMediaQuery`/container-query breakpoint at `md`. Below it: header collapses to brand + status dot + an overflow `⋯` menu; split view stacks outline over canvas with a segmented toggle; `AdminClientManager` left column becomes a top `<select>`-shaped client picker; `SettingsModal` rows become `flex-col items-start gap-2`. This is not a "nice to have" — a therapist working from a tablet on a couch session is a core scenario and the app is currently unusable there.

### C3. Hover-only controls are physically unreachable on touch `design` `(P0 Blocking)`

- **What:** Six interactive controls render at `opacity-0` and reveal only on `group-hover:opacity-100`:
  - `MapListDrawer.tsx` L206 — rename / duplicate / delete trio on each map card.
  - `AdminClientManager.tsx` L352 — rename / delete duo on each client row.
  - `OutlineEditor.tsx` L532–536 — the `+ Filho` (add child) button, `opacity-0 group-hover:opacity-100`.
  On a touch device there is no hover, so these never become visible. `OutlineEditor` L475–477 and L525–527 additionally set `tabIndex={-1}`, removing the two outline affordances from keyboard tab order as well — so they are unreachable by *both* secondary input modes, while being reachable only by an exact mouse hover.
- **Flagged by:** 2.2 #7 (Affordances — interactive elements clearly marked) — fail. 2.4 #1 (Touch Targets).
- **Recommendation:** Move these behind an always-visible `⋯` overflow menu per row/card. A therapy tool cannot hide a destructive action behind a hover that a touchscreen never fires.

### C4. `focusZoomMode` — one boolean, three controls, two visual systems `design` `(P1 Major, escalates to P0 via #3)`

- **What:** The same setting is surfaced three times in three different visual languages:
  1. `TherapistView.tsx` L485–506 — header pill button, active state `bg-amber-400 text-slate-950 border-amber-500 shadow-2xs ring-1 ring-amber-500/20`.
  2. `MindMapCanvas.tsx` L372–388 — floating canvas control, active state `bg-amber-500 text-white shadow-xs`.
  3. `SettingsModal.tsx` L201–215 — a third toggle switch, `w-11 h-6 … bg-amber-500`.
  They can disagree visually (different radii, different amber values, one is a segmented-looking pill and one is a cluster button) and the canvas copy renders even in `readOnly` client mode.
- **Flagged by:** 2.3 #2 (Pattern Consistency — "Same UI patterns behave identically"); 2.2 #5 (Decision points clearly indicated).
- **Recommendation:** Pick one owner for the setting (Settings) and one inline control (header or canvas, not both), driven by a single shared toggle component.

---

## 3. 🤔 Important Issues (Refinement)

### I1. The five overlays are five independent re-implementations — no dialog shell exists `design` `(P1 Major)`

**Verdict: severe duplication. There is no shared component; the only commonality is a copy-pasted header row.**

| Property | `ExportModal` | `MapListDrawer` | `SettingsModal` | `ShareGuideModal` | `AdminClientManager` |
|---|---|---|---|---|---|
| Backdrop | L267 `bg-black/60` | L81 `bg-black/40` | L27 `bg-black/50` | L23 `bg-black/50` | L195 `bg-black/60` |
| Positioning | `items-center justify-center p-4` | `justify-start` (drawer) | `items-center justify-center p-4` | same | same |
| max-width | `max-w-3xl` (L269) | `max-w-md` (L83) | `max-w-lg` (L29) | `max-w-2xl` (L25) | `max-w-4xl` (L197) |
| max-height | `max-h-[92vh]` | `h-full` | **none** ⚠ | `max-h-[90vh]` | `h-[85vh]` |
| radius | `rounded-2xl` | **none** ⚠ | `rounded-2xl` | `rounded-2xl` | `rounded-2xl` |
| dark surface | `bg-[#0B0F19]` | `bg-slate-900` | `bg-slate-900` | `bg-slate-900` | `bg-[#0B0F19]` |
| light border | `border-slate-300` ⚠ | `border-slate-200` | `border-slate-200` | `border-slate-200/80` ⚠ | `border-slate-300` ⚠ |
| header border | `border-slate-200 dark:…` | same | same | `border-slate-200/80 dark:…` ⚠ | same |
| title class | `text-base font-extrabold tracking-tight` | `text-base font-extrabold` ⚠ | `text-base font-extrabold` ⚠ | `text-base font-semibold` ⚠⚠ | `text-base font-extrabold tracking-tight` |
| header icon | **none** ⚠ | **none** ⚠ | inline `Sliders`, no chip ⚠ | amber chip `bg-amber-50` | amber chip `bg-amber-500/10` ⚠ |
| close-button class | `p-1.5 rounded-lg text-slate-500 hover:text-slate-950 … transition-colors` | **byte-identical** | **byte-identical** | `text-slate-400 hover:text-slate-600`, no `transition-colors` ⚠ | same + `title="Fechar"` ⚠ |
| footer | none (per-tab actions) | backup bar, no dismiss ⚠ | `Concluir` (dark filled) | `Entendi` + `Abrir Janela` | none |
| **Escape-to-close** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Backdrop click-to-dismiss** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Focus trap** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Focus restore on close** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **`role="dialog"` / `aria-modal`** | ❌ | ❌ | ❌ | ❌ | ❌ |
| **Body scroll lock** | ❌ | ❌ | ❌ | ❌ | ❌ |

Three backdrop opacities, five max-widths, three max-heights, two dark surfaces, four close-button styles, four title weights, two header-icon treatments, and **0 of 5** handle escape, backdrop dismissal, focus trapping, focus restore, or a dialog role. `TherapistView.tsx:250–275` binds a global `keydown` listener for `Ctrl+.`, `Ctrl+E` and `Ctrl+Z` only — no `Escape` branch — so a modal cannot be dismissed with the keyboard, and `MapListDrawer` (a `h-full` left drawer) becomes a full-screen trap with only the X as an exit.

- **Flagged by:** 2.3 #1 (Design Tokens) and #2 (Pattern Consistency); the user's explicit request to fix component patterns.
- **Recommendation:** Extract `<Dialog>` (backdrop + escape + focus trap + focus restore + scroll lock + `role="dialog" aria-modal` + `onBackdropClick`) and `<DialogHeader>` / `<DialogClose>` / `<DialogFooter>`, then reduce all five to ~15 lines of props. Extract the *segmented control* too — it is hand-rolled five separate times: `ExportModal.tsx:294` (7 underline tabs), `SettingsModal.tsx:64,103,232` (pill groups), `ShareGuideModal.tsx:89` (pill group). Six radii are in play across 127 declarations (`rounded` 14, `rounded-md` 3, `rounded-lg` 53, `rounded-xl` 38, `rounded-2xl` 7, `rounded-full` 12).

### I2. Zero design tokens; 7 surface literals; 3 sources of truth for `theme` `design` `(P1 Major)`

- **What:** `src/index.css` is 29 lines with no `@theme` block, no CSS custom properties, no theme layer. Verified surface literals:
  - Dark: `#0B0F19` ×4 (`TherapistView.tsx:398,664`; `ExportModal.tsx:270`; `AdminClientManager.tsx:199`), `#0B0F17` (`MindMapCanvas.tsx:227`), `#0E131F` (`OutlineEditor.tsx:354`), `#131926` (`OutlineEditor.tsx:361`), plus `#0F172A` ×5 and `bg-slate-950/60` (`TherapistView.tsx:571`).
  - Light: `#F7F6F2` ×4 (`ClientView.tsx:139`, `TherapistView.tsx:391`, `MindMapCanvas.tsx:227`) vs `#FBFBF9` ×1 (`index.html:16`, `body` — permanently covered by `#root`, so dead).
  - `slate` and `stone` families are mixed **inside the same components**: `TherapistView.tsx` L391 outer is `bg-[#F7F6F2] text-stone-900` while its own header L399–424 uses `border-slate-200`, `bg-white`, `text-slate-900`, `bg-slate-100`, `text-slate-700`.
  - `theme` is represented three ways simultaneously: (a) a `dark` class pushed onto `document.documentElement` (`TherapistView.tsx:136–142`, `ClientView.tsx:43–49`) which drives every `dark:` variant; (b) an `isDark` prop threaded manually into 8 of 9 components; (c) hex literals. `SettingsModal.tsx` is the only consumer that does **not** take `theme` as a prop (it reads `settings.theme`, L20) — so its appearance depends on the document class while every sibling depends on the prop. They can silently diverge.
  - `BalloonNode.tsx` holds 24 hex literals in one file (L66–94, L122, L135, L152, L169, L186, L200–201, L208, L235, L245, L265).
- **Flagged by:** 2.3 #1 (Design Tokens) — total fail. 2.3 #4 (Border Radius).
- **Recommendation:** Add an `@theme` block to `index.css` defining `--color-surface-app`, `--color-surface-chrome`, `--color-surface-panel`, `--color-accent`, `--color-accent-ink`, and radius steps. Then replace all 7 surface literals and the `slate`/`stone` split with tokens. Stop pushing the `dark` class — pick one mechanism.

### I3. Every secondary control is 20–36px; zero meet 44×44px `design` `(P1 Major)`

Measured from actual padding/height classes:

| Control | File:line | Computed size |
|---|---|---|
| Maximize-preview toggle `p-1` + `w-3.5` icon | `TherapistView.tsx:597` | **22×22** |
| Undo / Redo footer links (no padding, 11–12px) | `TherapistView.tsx:680–697` | **~20 tall** |
| Header tool icon buttons `w-9 h-9` ×4 | `TherapistView.tsx:522–561` | **36×36** |
| Pause button `h-9` | `TherapistView.tsx:467` | **36 tall** |
| ClientView fullscreen `p-2` + `w-4` | `ClientView.tsx:217` | **32×32** |
| Canvas zoom/fit/reset `p-1.5` + `w-4` ×4 | `MindMapCanvas.tsx:393–441` | **28×28** |
| Balloon collapse badge `circle r="11"` | `BalloonNode.tsx:263` | **22×22** |
| Outline collapse chevron `p-0.5` + `w-4` | `OutlineEditor.tsx:482` | **20×20** |
| Outline `+ Filho` `px-1.5 py-0.5` | `OutlineEditor.tsx:532` | **~16 tall** |
| Modal close X `p-1.5` + `w-5` ×5 | all modals | **28×28** |
| SettingsModal toggle switches `w-11 h-6` ×2 | `SettingsModal.tsx:143,204` | **44×24** |
| MapListDrawer card actions `p-1` + `w-3.5` ×3 | `MapListDrawer.tsx:211,222,234` | **22×22** |
| AdminClientManager client actions `p-1` + `w-3` ×2 | `AdminClientManager.tsx:361,370` | **20×20** |
| AdminClientManager session delete `p-1.5` + `w-4` | `AdminClientManager.tsx:544` | **28×28** |

Not one qualifies. The 44×24 switches are the widest-but-shortest — height is the binding constraint on every single control.
- **Flagged by:** 2.4 #1 (Touch Targets ≥44×44) — total fail.
- **Recommendation:** Raise icon-button floor to `h-10 w-10` minimum and give the outline row's `+ Filho` and chevron a 44px hit area via padding + negative margin so visual density is preserved.

### I4. Balloon text is silently truncated at ~2 lines with no expand path — on the client's screen too `design` `(P1 Major)`

- **What:** `BalloonNode.tsx` L46–59: text is split into `line1`/`line2`; if `line2.length > charsPerLine + 6` it is cut and suffixed `'…'`. There is no tooltip, no click-to-expand, no overflow indicator beyond the ellipsis, and no indication the content is truncated. `useMindMapLayout.ts` L61 caps balloon content at `240 * fontScale` px. Since the balloon text is *the therapeutic content the client is looking at*, a long phrase the therapist typed is silently abbreviated on the shared screen.
- **Flagged by:** Interaction State 0a.9 (Overflow) — 1 of 61 components handles overflow gracefully; here overflow silently *destroys* content. 2.2 #2 (Information Density).
- **Recommendation:** Add a hover/tap affordance that reveals full text, or auto-size the balloon to a third line. The character counter at `OutlineEditor.tsx:543–562` already warns at 90 chars, but nothing tells you the balloon will eat the text.

### I5. Canvas collapse affordance does nothing — the control lies `design` `(P1 Major)`

- **What:** `TherapistView.tsx:624–627`:
  ```tsx
  onToggleCollapse={(nodeId) => {
    const newRoot = { ...activeMap.root };
    handleUpdateRoot(newRoot, 'collapse');
  }}
  ```
  The `nodeId` argument is discarded and `toggleNodeCollapse` is never called. The result is a shallow copy of the root — identical content — pushed into the undo history and re-rendered. The `+N` badge on every collapsed node in `BalloonNode.tsx:254–279` and every chevron in the canvas is a control that presents itself as interactive and does nothing. (Almost certainly a logic bug, but the *design* defect is the standing affordance: nothing in the UI communicates that this control is inert.)
- **Flagged by:** 2.2 #7 (Affordances); Nielsen #4 (Consistency — "Identical actions behave identically", here the outline chevron *does* collapse and the canvas badge does not).
- **Recommendation:** Fix the handler; and as a design rule, never ship a visible control whose effect is unknown. The outline chevron calls `toggleNodeCollapse` correctly at `OutlineEditor.tsx:480`, so the two collapse controls already contradict each other.

### I6. `focusDwellSeconds` slider and 2× browser zoom both break `design` `(P1 Major)`

- **What:** `SettingsModal.tsx:173–181` renders a bare `<input type="range">` with only `accent-amber-500 cursor-pointer` — no custom track/thumb, no focus ring, no `aria-valuetext` (a screen reader announces "5" with no unit). It is the only continuous control in the app and it is the least styled. Separately, `body { user-select: none }` (`index.css:10`) blocks text selection app-wide, and the whole layout is `w-screen h-screen overflow-hidden` with fixed `h-14` header / `py-1.5` footer — at 200% browser zoom on a 1440px screen the viewport is 720 CSS px and the header (≈690px minimum content) crushes with no reflow. Text does not reflow at 200% anywhere in the app.
- **Flagged by:** 2.4 #4 (Text Scaling at 200%) — fail. 2.1 #3 (Spacing & Alignment).
- **Recommendation:** Build a labelled `<Slider>` with an explicit value pill (e.g. "3 segundos", already computed at L167) and min/max/now-marker ticks — the tick labels at L182–186 are good, they just need to be attached to the control. Allow `user-select: text` inside `OutlineEditor` (already `select-text`, L353) and remove the global `user-select: none` from `body`.

### I7. `openClientWindow` fails silently when the popup blocker fires `design` `(P1 Major)`

- **What:** `TherapistView.tsx:186–202` — `window.open()` returns `null` when blocked, and the `if (newWin)` guard simply does nothing. This is the **primary action of the entire product** (the button at L509–516 is the only filled dark CTA in the header, styled `bg-slate-950 text-white hover:bg-slate-800`) and the core enabler of the sharing guide (`ShareGuideModal.tsx:170–179` calls the same function). A blocked popup is the single most likely failure for a user who has not yet interacted enough with the origin — i.e. exactly a first-timer. The user clicks and literally nothing happens; there is no loading, disabled, or error state, and the `[Abrir]` link at L456–462 that is supposed to be the recovery affordance calls the same silent function.
- **Flagged by:** Interaction State 0a.8 (Error) — absent on 58 of 61 components. Nielsen #1 (Visibility of System Status), #9 (Help Users Recover).
- **Recommendation:** On `newWin === null`, show a toast: "O navegador bloqueou a janela. Clique no ícone de cadeado na barra de endereço e permita pop-ups para este site." — with the URL pre-filled in a selectable field. The app is 100% local, so this is the one failure mode that deserves explicit recovery copy.

### I8. `ClientView.toggleFullscreen` sets a false state on rejection `design` `(P2 Minor, but user-visible)`

- **What:** `ClientView.tsx:104–112`:
  ```tsx
  document.documentElement.requestFullscreen?.().catch(() => {});
  setIsFullscreen(true);   // unconditional
  ```
  If the request is rejected (iOS Safari, permission policy), the icon swaps to `Minimize` while fullscreen did not engage. The `.catch(() => {})` also swallows every error. A subsequent click then calls `document.exitFullscreen?.()` (a no-op) and sets `isFullscreen(false)`. Two clicks to recover from one failed click.
- **Flagged by:** Interaction State 0a.8; 2.2 #5 (Decision points clearly indicated — the icon is now lying).
- **Recommendation:** `await` the promise, set state from the resolved value, and surface a rejection message.

---

## 4. 🔎 Minor Clarifications

- **M1 — Accent rail on the active outline row** `OutlineEditor.tsx:454–459` `[design] (P3 Polish)`. `absolute left-0 top-1.5 bottom-1.5 w-1.5 rounded-r bg-amber-400` is a colored stripe on a row edge used purely as an organizational marker — AI-slop tell #5. It is also fully redundant: the active row already carries `bg-slate-950 border-2 border-amber-500 shadow-md ring-2 ring-slate-950/15` plus a 1.5px amber left border. Delete it.
- **M2 — The active outline row and the primary CTA share a color** `OutlineEditor.tsx:405` vs `TherapistView.tsx:512` `[design] (P2 Minor)`. "The row I'm typing in" is `bg-slate-950`; "Janela do Cliente" is `bg-slate-950`; the client-screen root balloon is `#0F172A` (`BalloonNode.tsx:72`). The most important ambient state and the most important action are the same near-black. Reserve near-black for action, use the amber ring for the active editing state.
- **M3 — Three filled buttons can co-exist in the header** `TherapistView.tsx:443,467,498,509` `[design] (P2 Minor)`. When paused *and* focus-zoom on *and* not connected, the header shows `bg-rose-600` (pause), `bg-amber-400` (zoom) and `bg-slate-950` (client window) — three filled surfaces competing. Only the client-window CTA should be filled; the other two should use tinted-outline treatment.
- **M4 — Export option cards have inverted hierarchy** `ExportModal.tsx:379–456` `[design] (P2 Minor)`. Three equal-weight cards whose *buttons* are styled `bg-slate-950` (single session, L398), `bg-amber-500` (client zip, L424) and `border-2 border-slate-950` (all clients, L450). The single-session export is the common case and gets the quietest treatment; the rare full-practice backup gets the loudest. Normalize to one primary + two secondary.
- **M5 — Shortcuts are documented in two places, with different wording** `OutlineEditor.tsx:373–379` vs `TherapistView.tsx:699–703` `[design] (P2 Minor)`. The outline header says "Enter: Irmão · Ctrl+Enter: Filho · Tab: Indentar"; the footer says "Ctrl+. Pausa · Ctrl+Enter Cria Filho · Esc Limpa foco". `Ctrl+Enter` is labelled two different ways. Meanwhile the single most destructive keyboard action — **Backspace on an empty line deletes a node** (`OutlineEditor.tsx:278–293`) — is documented nowhere. It is at least recoverable via `Ctrl+Z` (reason `'delete'` pushes to history, L208–214), but the UI never says so.
- **M6 — Two more disabled-state omissions on power-user controls** `TherapistView.tsx:680–697` `[design] (P2 Minor)`. Undo and Redo have no `disabled` styling; `handleUndo` L234 is a no-op at `historyIndexRef.current === 0` and `handleRedo` L242 at the tail, so the buttons look live and click inertly. The canvas zoom buttons are the same at the `k` clamps (L398, L411) — no visual stop at 2.5× / 0.3×. The app *does* know how to do this correctly elsewhere: `disabled={isExportingZip}` at `ExportModal.tsx:423,449` and `AdminClientManager.tsx:386,425`.
- **M7 — `copied` is one shared boolean across four copy buttons** `ExportModal.tsx:58,466,678,717,756` `[design] (P2 Minor)`. `handleCopy` (L76–82) only sets `copied` on success and does nothing on failure, so a clipboard rejection is completely silent. The success flag is also not scoped per-format, so state can leak between the Markdown, OPML, FreeMind and JSON buttons.
- **M8 — `+ Nova Sessão` and the new-client form are unguarded async** `AdminClientManager.tsx:445–452,249–274` `[design] (P2 Minor)`. Neither disables during its `await saveMap(...)`, so a double-click can create two sessions. Compare with the zip buttons, which correctly use `disabled={isExporting}`.
- **M9 — No "no clients" empty state in the client list** `AdminClientManager.tsx:289–379` `[design] (P1 Major, listed here as a first-run blocker)`. `filteredClients.map(...)` has no empty branch, so with zero clients the left panel renders **completely blank**. The right column does have a good empty state (L557–559) but no CTA. A first-time therapist sees an empty white box, the word "Novo" in a ~24px-tall link (L238–245), and nothing else. The session-list empty state two lines down (L462–465) is genuinely good — "Clique em '+ Nova Sessão' ou '+ Importar (.md)' acima para começar." — which proves the pattern was known and simply not applied to the list above it.
- **M10 — Filled icon in an outline icon set** `TherapistView.tsx:477` `[design] (P3 Polish)`. `<Play className="w-3.5 h-3.5 fill-current />` among 40+ outline `lucide-react` icons. 2.3 #3 (Icon Style).
- **M11 — Bracket pseudo-link** `TherapistView.tsx:461` `[design] (P3 Polish)`. The disconnect recovery is rendered as `[Abrir]` — a bracketed text link in a status badge. It reads as a citation, not a control.
- **M12 — Label terminology drifts across surfaces** `[design] (P3 Polish)`. "Janela do Cliente" (L515), "Janela do cliente" (`SettingsModal.tsx:96`), "tela do cliente" (`SettingsModal.tsx:134`), "cliente em pausa" (L445). "Pausar (Ctrl+.)" puts the shortcut in the visible label while every other control keeps it in `title` only.

---

## 5. ✅ Strengths

- **The ClientView is designed with real care for a vulnerable user, and it shows.** The empty state (L206–209) is *"Aguardando conexão com a sessão do ter subjected…"* — a patient sentence, not a spinner, not an error code. The pause screen (L142–158) is an explicit, one-keystroke emergency exit (`Ctrl+.`) with a calm *"Um momento / A visualização continuará em instantes…"* and no clinical content behind it. `document.title` is forced to the neutral string `'Mapa'` (L38–40) so the client never sees their own name in the tab strip during a video call. Cursor auto-hides after 2.5s (L96–102) and the bottom bar auto-hides after 4s (L70–72) so the shared screen stays a picture, not an interface. This is the emotional peak of the product and it is well-served.
- **Zero AI-slop fundamentals in the core identity.** No gradients, no gradient text, no glassmorphism, no indigo-because-software, no stat monuments, no nested cards (verified: the three `ExportModal` option cards are siblings, not nested; `AdminClientManager`'s tinted `w-72` panel is a pane, not a card). Crucially, **Plus Jakarta Sans is not Inter or Roboto** (`index.html:14`, `index.css:9`) — a geometric humanist with real character, chosen for warmth at the large sizes the client screen needs. And the 8-colour `BRANCH_PALETTE` (`useMindMapLayout.ts:44–53`) is annotated with human hue rationale — *"Warm Tobacco Amber"*, *"Rich Crimson Rose"*, *"Deep Terracotta"* — which is the exact opposite of the "no intentional hue selection" tell.
- **Several genuinely correct interaction states, in the right places.** The zip buttons carry a real loading state *and* a label swap: `disabled={isExportingZip}` + `isExportingZip ? 'Compactando…' : ...` (`ExportModal.tsx:423–427, 449–453`; `AdminClientManager.tsx:386–391, 425–430`). The copy buttons swap icon and label on success (L469–470). The import flow has an explicit `success`/`error` banner with recovery guidance (L596–606) and a correctly-guarded primary: `disabled={!importText.trim()}` (L619). `OutlineEditor` character count appears progressively at 70 chars and warns past 90 (L543–562) — good progressive disclosure. And the 3-second focus dwell has a real, legible circular progress ring built from an SVG `strokeDashoffset` (L565–594) — feedback that most products would have left as a silent timer.
- **Zero-latency dual-window sync is an unusually strong design decision.** `OutlineEditor.focusInput` (L63–96) calls `onSelectNode` and `onDraftChange` **synchronously before** the `el.focus()` call, so the balloon on the client's screen moves in the same frame the therapist's caret does. Combined with the `!important` inline color overrides on the active row (L401–406) and the `document.title` privacy discipline on both windows, the two-surface choreography is the best-executed part of this codebase.
- **Undo exists as a first-class pattern for tree edits.** `handleUpdateRoot` (L205–230) pushes every non-`typing` mutation to a 50-deep history with `Ctrl+Z` / `Ctrl+Shift+Z` bound globally (L262–270), including node deletion via `Backspace` (L278–293) and the canvas collapse path. The infrastructure is sound — which makes the dead delete-undo toast in C1 a wiring failure rather than a missing capability, and therefore a much cheaper fix.

---

## 6. Component State Coverage Table (0a)

**Method:** every interactive component inventoried across the 12 audited files. Scored against the 9 states — Idle, Hover, Active/Pressed, Focus, Disabled, Loading, Empty, Error, Overflow — with N/A only where genuinely inapplicable. Instances are per rendered copy (e.g. `×7` = 7 tab buttons with one class pattern).

| # | Component | File:line | States present | Missing | Count |
|---|---|---|---|---|:---:|
| 1 | Header tool icon buttons (Share/Export/Settings/Theme) `w-9 h-9` | `TherapistView.tsx:522–561` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 × 4 |
| 2 | "Janela do Cliente" primary CTA | `TherapistView.tsx:509–516` | Idle, Hover | Active, Focus, Disabled, **Error** (popup blocked), Loading | 2 |
| 3 | Client/session switcher | `TherapistView.tsx:421–436` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 4 | Status badge `[Abrir]` recovery link | `TherapistView.tsx:456–462` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 5 | Pause / Retomar | `TherapistView.tsx:467–479` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 |
| 6 | Zoom-no-Foco header toggle | `TherapistView.tsx:485–506` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 |
| 7 | Zoom-no-Foco canvas toggle | `MindMapCanvas.tsx:372–388` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 |
| 8 | Maximize/restaurar prévia `p-1` | `TherapistView.tsx:593–600` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 9 | Footer **Desfazer** | `TherapistView.tsx:680–688` | Idle, Hover | **Disabled (missing!)**, Active, Focus, Loading, Empty, Error, Overflow | 2 |
| 10 | Footer **Refazer** | `TherapistView.tsx:689–697` | Idle, Hover | **Disabled (missing!)**, Active, Focus, Loading, Empty, Error, Overflow | 2 |
| 11 | Undo-toast "Desfazer" (unreachable) | `TherapistView.tsx:774–780` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 12 | ClientView fullscreen toggle | `ClientView.tsx:213–220` | Idle, Hover | Active, Focus, **Error (false state)**, Disabled, Loading, Empty, Overflow | 2 |
| 13 | Canvas zoom in / out / fit / reset `p-1.5` | `MindMapCanvas.tsx:393–441` | Idle, Hover | **Disabled (at k clamps)**, Active, Focus, Loading, Empty, Error, Overflow | 2 × 4 |
| 14 | Canvas pan surface | `MindMapCanvas.tsx:216–229` | Idle, Active (`cursor-grabbing`) | Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 15 | Balloon node click | `BalloonNode.tsx:99–110` | Idle (`cursor-pointer` only) | **Hover (no visual change at all)**, Active, Focus (SVG `<g>` not focusable), Disabled, Loading, Empty, Error, **Overflow (silently truncates text, L56–58)** | **1** |
| 16 | Balloon collapse badge `r=11` | `BalloonNode.tsx:254–279` | Idle, Hover (`hover:opacity-90`) | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 17 | Outline row container | `OutlineEditor.tsx:443–451` | Idle, Hover, Active, Focus (via input) | Disabled, Loading, Empty, Error, Overflow | **4** |
| 18 | Outline line input | `OutlineEditor.tsx:503–519` | Idle, Active, Focus | Hover, Disabled, Loading, **Error (>280 chars silently dropped, L304)**, Overflow | 3 |
| 19 | Outline collapse chevron | `OutlineEditor.tsx:475–495` | Idle, Hover | **Focus (`tabIndex={-1}`, L477)**, Active, Disabled, Loading, Empty, Error, Overflow | 2 |
| 20 | Outline `+ Filho` | `OutlineEditor.tsx:524–540` | Idle, Hover (`group-hover`) | **Focus (`tabIndex={-1}`, L526)**, Active, Disabled, Loading, Empty, Error, Overflow | 2 |
| 21 | "Adicionar Novo Tópico" | `OutlineEditor.tsx:603–614` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 22 | Modal close X | 5 files: `Export:283`, `Drawer:95`, `Settings:44`, `Share:42`, `Admin:218` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 × 5 |
| 23 | ExportModal tab buttons | `ExportModal.tsx:294–371` | Idle, Hover, Active, **Overflow (`overflow-x-auto` L293 — graceful)** | Focus, Disabled, Loading, Empty, Error | **4** × 7 |
| 24 | ExportModal option-card buttons | `ExportModal.tsx:395,420,446` | Idle, Hover, Disabled, Loading ("Compactando…") | Active, Focus, Empty, Error | **4** × 3 |
| 25 | Copy buttons (md/opml/freemind/json) | `ExportModal.tsx:464,678,717,756` | Idle, Hover, Active-as-success | Focus, Disabled, Loading, **Error (clipboard failure silent, L76–82)**, Empty, Overflow | 3 × 4 |
| 26 | Import textarea | `ExportModal.tsx:583–593` | Idle, Focus, Error (banner L596–606) | Hover, Active, Disabled, Loading, Empty, Overflow | 3 |
| 27 | Import-target radio cards | `ExportModal.tsx:492,514,536` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 × 3 |
| 28 | "Confirmar Importação" | `ExportModal.tsx:616–624` | Idle, Hover, Disabled (`!importText.trim()`) | Active, Focus, **Loading (not disabled in-flight → double-import)**, Empty, Error, Overflow | 3 |
| 29 | "Cancelar" | `ExportModal.tsx:609–615` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 30 | PNG / SVG download buttons | `ExportModal.tsx:640–647,662–669` | Idle, Hover | **Loading (2× PNG rasterization, no indicator)**, Active, Focus, Disabled, Empty, Error, Overflow | 2 × 2 |
| 31 | "Selecionar Arquivo .md" | `ExportModal.tsx:566–573` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 32 | "Novo Mapa" (unreachable) | `MapListDrawer.tsx:106–116` | Idle, Hover, Empty (L136–139, **no CTA**) | Active, Focus, Disabled, Loading, Error, Overflow | 3 |
| 33 | Drawer search input | `MapListDrawer.tsx:120–130` | Idle, Focus | Hover, Active, Disabled, Loading, Empty, Error, Overflow | 2 |
| 34 | Drawer map card | `MapListDrawer.tsx:150–254` | Idle, Hover, Active | **Focus (`div`+onClick)**, Disabled, Loading, Empty, Error, Overflow | 3 |
| 35 | Drawer card actions (rename/dup/delete) | `MapListDrawer.tsx:206–239` | Idle, Hover (`group-hover`) | **Focus (invisible to keyboard & touch)**, Active, Disabled, Loading, Empty, Error, Overflow | 2 × 3 |
| 36 | Drawer rename input + Check | `MapListDrawer.tsx:173–186` | Idle, Focus (`autoFocus`), Hover | Active, Disabled, Loading, Empty, Error, Overflow | 3 |
| 37 | Drawer footer backup | `MapListDrawer.tsx:262–269` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 38 | Settings theme segmented | `SettingsModal.tsx:64–87` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 × 2 |
| 39 | Settings live-text segmented | `SettingsModal.tsx:103–124` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 × 2 |
| 40 | Settings toggle — thin bar | `SettingsModal.tsx:140–154` | Idle, Active (knob) | **Hover, Focus, Disabled, Loading, Empty, Error, Overflow** | 2 |
| 41 | Settings dwell-time slider | `SettingsModal.tsx:173–181` | Idle, Active, Empty ("Desligado" L167) | **Focus (unaccented native, no ring, no valuetext)**, Hover, Disabled, Loading, Error, Overflow | 3 |
| 42 | Settings toggle — focus zoom | `SettingsModal.tsx:201–215` | Idle, Active | **Hover, Focus, Disabled, Loading, Empty, Error, Overflow** | 2 |
| 43 | Settings font-scale 4-up | `SettingsModal.tsx:232–245` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 × 4 |
| 44 | Settings "Concluir" | `SettingsModal.tsx:252–258` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 45 | ShareGuide platform tabs | `ShareGuideModal.tsx:89–121` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 × 3 |
| 46 | "Entendi" | `ShareGuideModal.tsx:163–169` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 47 | "Abrir Janela do Cliente" | `ShareGuideModal.tsx:170–179` | Idle, Hover | Active, Focus, **Error (popup blocked)**, Disabled, Loading, Empty, Overflow | 2 |
| 48 | Admin "Novo" client link | `AdminClientManager.tsx:238–245` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 49 | Admin new-client form (input + Check + X) | `AdminClientManager.tsx:249–274` | Idle, Focus (`autoFocus`), Hover | Active, **Disabled/Loading (async submit unguarded)**, Empty, Error, Overflow | 3 |
| 50 | Admin client search | `AdminClientManager.tsx:278–284` | Idle, Focus | Hover, Active, Disabled, Loading, **Empty (blank list, no branch)**, Error, Overflow | 2 |
| 51 | Admin client card | `AdminClientManager.tsx:295–376` | Idle, Hover, Active | **Focus (`div`+onClick)**, Disabled, Loading, Empty, Error, Overflow | 3 |
| 52 | Admin client actions (rename/delete) | `AdminClientManager.tsx:352–374` | Idle, Hover (`group-hover`) | **Focus (invisible to keyboard & touch)**, Active, Disabled, Loading, Empty, Error, Overflow | 2 × 2 |
| 53 | Admin session card | `AdminClientManager.tsx:472–550` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 |
| 54 | "Zipar Todos os Clientes" | `AdminClientManager.tsx:383–392` | Idle, Hover, Disabled, Loading ("Compactando…") | Active, Focus, Empty, Error, Overflow | **4** |
| 55 | "Exportar (.zip)" | `AdminClientManager.tsx:422–431` | Idle, Hover, Disabled | Active, Focus, **Loading (shared flag, no label swap here)**, Empty, Error, Overflow | 3 |
| 56 | "+ Importar (.md)" | `AdminClientManager.tsx:434–442` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 57 | "+ Nova Sessão" | `AdminClientManager.tsx:445–452` | Idle, Hover | Active, Focus, **Disabled/Loading (async unguarded)**, Empty, Error, Overflow | 2 |
| 58 | Admin session download `.md` | `AdminClientManager.tsx:510–517` | Idle, Hover | Active, Focus, Disabled, Loading, Empty, Error, Overflow | 2 |
| 59 | "Abrir Sessão" / "Continuar" | `AdminClientManager.tsx:519–537` | Idle, Hover, Active | Focus, Disabled, Loading, Empty, Error, Overflow | 3 |
| 60 | Admin session delete | `AdminClientManager.tsx:540–548` | Idle, Hover, **native `confirm()` gate (L188)** | Focus, Active, Disabled, Loading, Empty, **Undo**, Overflow | 3 |
| 61 | Admin client delete | `AdminClientManager.tsx:366–373` | Idle, Hover, **native `confirm()` gate (L175)** | Focus, Active, Disabled, Loading, Empty, **Undo**, Overflow | 3 |

### Coverage score

Per the skill formula, `coverage = (✅ + ⬆️) / (✅ + ❌ + ⬆️)`, N/A excluded:

| Band | Threshold | Count | Share |
|---|---|:---:|---:|
| ✅ | ≥ 6 states | **0** | **0%** |
| ⚠️ | 4–5 states | 4 | 6.6% |
| ❌ | < 4 states | 57 | 93.4% |
| **Total scored** | | **61** | 100% |

**`coverage = 0 / 61 = 0%`** ⚠️

**Average states per component = 152 / 61 = 2.49 of 9 (28%)**

State-by-state prevalence across all 61 components:

| State | Present on | Prevalence |
|---|:---:|:---:|
| Idle | 61 | 100% |
| Hover | 60 | 98% |
| Active/Pressed | 18 | 30% |
| Focus | 7 | **11%** |
| Disabled | 4 | **7%** |
| Loading | 2 | **3%** |
| Error | 3 | **5%** |
| Empty | 2 | **3%** |
| Overflow | 2 | **3%** |

**Read against the baselines:** the human baseline is 7–9 and the AI baseline is 1–2. At **2.49** this sits just above the AI floor — the app is not a pure 1-state build; it has near-universal hover plus a handful of genuine loading/disabled/empty/success states in the export and settings surfaces. But it is roughly **4.5 states short of the human baseline and 3.5 short of the ≥6 target**, and the three always-applicable states — **Focus (11%), Active/Pressed (30%), Disabled (7%)** — are the ones missing nearly everywhere. Those are the states that matter for a therapist working fast in a dim room, and none of them are decorative.

*Honest caveat:* a rigorous N/A pass would exempt some Loading states (a local IndexedDB read is instantaneous) and some Error states (a theme toggle cannot fail). Doing so would move a handful of rows from ❌ to ⚠️ and shift the average by perhaps ±0.3. It would not change the headline: **no component in the codebase would reach 6 states**, and Focus/Active/Disabled would remain the systemic gap.

---

## 7. AI Slop Detection (2.5) — 14 tells applied verbatim

| # | Tell | Verdict | Evidence |
|---|---|:---:|---|
| 1 | Tech gradient | ❌ absent | No gradient anywhere in `src/` or `index.html`. Verified. |
| 2 | Generic tech hue | ❌ absent | No indigo/violet in the UI. Amber-500/600/700 is a deliberate warm-paper accent; the 8 branch colours carry written hue rationale (`useMindMapLayout.ts:44–53`: *"Warm Tobacco Amber"*, *"Rich Crimson Rose"*, *"Deep Teal"*, *"Deep Terracotta"*). This is intentional hue selection for a clinical-but-warm context — the opposite of the tell. |
| 3 | Gradient text | ❌ absent | No `bg-clip-text`, no gradient fills on headings. |
| 4 | **Feature tile grid** | ✅ **PRESENT** | `ExportModal.tsx:379–456` — 3 equal-weight cards, each `rounded-xl border bg-slate-50`, each `icon + bold label + one sentence + button`. The canonical pattern. Second instance at `ShareGuideModal.tsx:54–84` (3 equal-weight `icon + label + sentence` guarantee cards) — weaker here, since the three guarantees genuinely are equal in importance. |
| 5 | Accent rail | ✅ **PRESENT** (weak) | `OutlineEditor.tsx:454–459` — `absolute left-0 top-1.5 bottom-1.5 w-1.5 rounded-r bg-amber-400`, a colored stripe on a row edge used as an organizer — and fully redundant with the row's own `bg-slate-950 border-2 border-amber-500 ring-2`. One instance. |
| 6 | Unearned blur / glassmorphism | ⚠️ borderline | All blur is functional except `TherapistView.tsx:590` — `bg-white/95 … backdrop-blur-xs` on the preview tag. At 95% opacity the blur contributes essentially nothing; it is decorative. All other `backdrop-blur-md` uses (thin bar `ClientView.tsx:184`, `TherapistView.tsx:640`; canvas cluster `MindMapCanvas.tsx:363`) sit over content and are **earned**. `backdrop-blur-xs` on the black/60 modal backdrops is invisible but harmless. **Not counted** — the depth system is real. |
| 7 | Stat monument | ❌ absent | Counts are inline `text-[11px] font-mono` ("12 balões", "Clientes (3)", "Histórico de Sessões (4)"). Nothing oversized. |
| 8 | **Icon topper** | ✅ **PRESENT** | `ExportModal.tsx:631` — `w-16 h-16 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center` with a `w-8 h-8` icon, sitting above a centered `<h4>`. Cloned verbatim at L653 — and the clone even changes to `bg-blue-50` / `text-blue-400` for no stated reason. Textbook rounded-square-icon-above-heading, one template applied twice. |
| 9 | **Center stack** | ✅ **PRESENT** | Same two tabs: `ExportModal.tsx:630,652` — `space-y-4 text-center py-6`, `mx-auto` on the icon tile, `max-w-sm mx-auto` on the paragraph, `inline-flex` on the button. Everything centered because no composition decision was made. |
| 10 | Bounce easing | ⚠️ borderline (honest stretch) | No bouncy easing — the curve at `MindMapCanvas.tsx:259` is `cubic-bezier(0.16, 1, 0.3, 1)` (expo-out, purposeful). But `animate-ping` appears in **6 decorative places**: the ghost cursor `▌` (`ClientView.tsx:199`, `BalloonNode.tsx:235,245`), the ghost connector link (`MindMapCanvas.tsx:300`), the selected-node halo and target-parent dashed ring (`BalloonNode.tsx:125,155`), the "Cliente Conectado" dot (`TherapistView.tsx:449`), and the pause-screen ring (`ClientView.tsx:149`). Infinite pulse as filler, and on the connection status dot it reads as *something is broken*. **Not counted** — `animate-ping` is a scale-fade, not bounce easing, and on the typing caret it is genuinely meaningful. |
| 11 | Default type | ❌ absent | **Plus Jakarta Sans** (`index.html:14`, `index.css:9`), loaded with 4 weights. Not Inter, not Roboto. A geometric humanist with distinctive terminals, and the single strongest anti-slop signal in the app. |
| 12 | Gray on color | ⚠️ borderline → **handed to a11y reviewer** | Strictly this tell is *gray* on *colored* backgrounds, which barely occurs. What does occur is a related design-system problem: **`text-amber-600` / `text-amber-700` used as body text on light neutral surfaces in ~15 sites**, most importantly `ClientView.tsx:190` (`text-amber-600` for the live-typing label on the client bar) and `ShareGuideModal.tsx:56,66,76` (`text-emerald-600` labels on `bg-slate-50`). That is a hue-contrast question, not a gray-on-color question. **Flagged as a design-system finding (P1) and the ratio measurement delegated to the sibling contrast review.** |
| 13 | Nested cards | ❌ absent | Verified — the three `ExportModal` option cards (L381, L406, L432) are siblings in one grid, not nested. `AdminClientManager`'s `bg-slate-50` `w-72` pane (L231) is a layout region, not a card. `ShareGuideModal`'s step panel (L125) is a sibling of the 3 guarantee cards, not a parent. **Zero card-in-card-in-card anywhere.** A real strength. |
| 14 | **Redundant microcopy** | ✅ **PRESENT** | The privacy claim is stated **five times in one modal**: title "Compartilhamento Seguro" (L36), subtitle "sem expor suas anotações privadas" (L38), 3 guarantee cards "Janela Isolada / Título e URL Neutros" (L58, L68), card 3 "Pausa Rápida" (L81), and step 4 "permanecem 100% invisíveis ao cliente" (L150). Plus globally: header `PRIVADO` pill (L413–416), footer "100% offline & seguro" (L676), `document.title` prefix "PRIVADO · " (L130), `index.html` meta description "offline e privado" (L7). Also: "Gera um arquivo .zip completo com pastas separadas por cliente contendo todo o consultório" (L443), "perfeito para ilustrações, relatórios e apresentações" (L659). |

### Verdict

**4 confirmed tells — #4 (Feature tile grid), #8 (Icon topper), #9 (Center stack), #14 (Redundant microcopy) → 🤔 "Some tells — noticeable AI aesthetic" (band 3–4).**

Plus 4 borderline tells I am explicitly **not** counting: #6 (one decorative blur), #10 (6 `animate-ping`, but no bouncy easing), #12 (amber-as-text — a contrast question, delegated), and #5 is counted.

**Read honestly, the clustering is diagnostic.** Three of the four confirmed tells (#4, #8, #9) sit in **one file** — `ExportModal.tsx` — and specifically in two adjacent tabs (PNG L629–649, SVG L651–671) that are byte-level clones of each other. `ExportModal.tsx:53–372` is also where a 7-tab strip, 3 feature cards, a 2-line preview, 3 radio cards, a textarea, a status banner and a 2-button footer are stacked into a single `max-h-[92vh]` surface. That is an information-architecture problem being disguised as a design problem. Remove the two icon-topper tabs (fold PNG/SVG into the Markdown tab's action row) and the tell count drops to 2 → 🔎 "Mostly clean".

The remaining tell (#14) is a copy problem, and it is a *good* copy problem: the microcopy is warm and reassuring and simply says the same true thing five times. The rest of the app — `TherapistView`, `ClientView`, `OutlineEditor`, `MindMapCanvas`, `BalloonNode` — scores **0 tells**. There is no tech gradient, no default typeface, no generic hue, no nested cards, no glassmorphism, no bounce. It is not an AI slop gallery; it is a calm, deliberately-warm clinical tool that picked the wrong component library for one modal and then said the right sentence five times.

**The 5-line fix that drops the count from 4 to 2:** delete `ExportModal.tsx:629–671` (the PNG and SVG icon-topper tabs) and add their two download actions as buttons in the existing Markdown tab toolbar at L464–471. Tells #8 and #9 both disappear, and #4 loses its worst instance.

---

## 8. Cognitive Load Assessment (8-item checklist)

| # | Item | Verdict | Evidence |
|---|---|:---:|---|
| 1 | Primary action | ✅ | `TherapistView.tsx:509–516` — "Janela do Cliente" is the only filled dark CTA in the header (`bg-slate-950 text-white`), correctly the highest-value action. Fails only when the pause and focus-zoom toggles also go filled (M3). |
| 2 | Progressive disclosure | ⚠️ | `SettingsModal` groups 6 settings with 1px dividers (good) but expands all 6 inline — a long scroll at 375px. `ExportModal` is the opposite failure: 7 tabs all visible at once, 4 of which are "download a text file", plus 3 feature cards plus a preview plus a radio group plus a textarea. |
| 3 | Decision points | ✅ | The import target is excellent: 3 explicit radio cards, numbered steps "1. Escolha o destino" / "2. Carregue um arquivo", each option with a plain-language consequence ("Substitui os tópicos da sessão atual (15/09/2026)", "Mantém os tópicos atuais e adiciona os novos abaixo") — `ExportModal.tsx:488–557`. This is the best decision-point design in the app. |
| 4 | Information density | ⚠️ | The therapist header packs brand + privacy badge + client switcher + 3-state status badge + 2 toggles + CTA + 4 tool icons into 56px, then a footer adds 6 more items. Dense is correct for the Operate pattern, but the density is duplicated (M5) and the `[Abrir]` recovery (M11) is buried inside a status badge. |
| 5 | Grouping | ⚠️ | Settings rows are correctly separated. But the 3 export cards invert hierarchy (M4), and `focusZoomMode` appears in 3 ungrouped places (C4). |
| 6 | Navigation | ❌ | `MapListDrawer` is **unreachable** — `setIsMapListOpen(true)` is never called. The real session browser, `AdminClientManager`, is discoverable only via `title="Gerenciar Clientes e Sessões"` (L425) on the client-name button. First-run shows a blank client list (M9). |
| 7 | Affordances | ❌ | Six `opacity-0 group-hover:opacity-100` controls unreachable by touch and keyboard (C3); balloon nodes have `cursor-pointer` with zero hover feedback (row 15 of the table) and are not focusable; the canvas collapse badge is a visible control whose handler discards its argument and does nothing (I5). |
| 8 | Labeling | ⚠️ | Portuguese is correct and generally plain-spoken, but "Janela do Cliente" / "Janela do cliente" / "tela do cliente" drift across surfaces (M12), `Ctrl+Enter` is "Filho" in one place and "Cria Filho" in another (M5), and the most destructive keybinding (Backspace-to-delete) is undocumented. |

**Score: 2 pass, 3 partial, 3 fail → 3 failures + 3 partials = ⚠️ Moderate (framework: 2–3 = Moderate, 4+ = Critical).**

**Memory burden rule (Recognition > Recall):** mostly compliant. Options are visible, not recalled; import consequences are spelled out per option; the client connection state is always on screen. **Two violations:** the Backspace-delete binding must be remembered (never surfaced) and the shortcut set must be recalled from two inconsistent locations. **Recognition > Recall score: ⚠️ 2/3 for therapist, 3/3 for client** (the client surface has no interaction to remember at all — a deliberate and correct choice).

---

## 9. Emotional Journey — Peak-End Rule

### Peak: the client sees their own words, large and calm — **strong**

The designed peak is the moment a client's phrasing appears on the shared screen. The design serves it: generous `fontScale` up to 130% (`SettingsModal.tsx:232–245`, described as *"Ajuste para legibilidade ideal no vídeo compartilhado"* — legibility *for the video call* is the right frame), a near-white paper ground `#F7F6F2` rather than a dark IDE surface, high-contrast branch colours, a live typing mirror so the client watches the balloon being written, and a bottom bar that announces *"Adicionando em {parent} ›"* so the client always knows where on the map they are. Cursor auto-hide and 4s bar auto-hide keep the shared screen a picture. This is a well-designed peak.

**Valleys handled well:** (a) *pause* — `Ctrl+.` instantly swaps to a calm screen with no clinical content, the single most important intervention in a session that turns; (b) *disconnect* — a discrete "Cliente Desconectado" badge with an inline recovery, plus the client view's patient *"Aguardando conexão…"*; (c) *privacy* — neutral `document.title` `'Mapa'`, an explicit share guide with per-platform instructions and a bolded *"Nunca escolha 'A tela inteira'"* (`ShareGuideModal.tsx:130`).

**One design flaw in the peak:** the pause screen's reassurance sub-copy is the lowest-contrast text in the entire app — `text-xs text-stone-400 dark:text-slate-500` (`ClientView.tsx:155`) on `#F7F6F2`. stone-400 on near-white is low, and at 12px. The screen whose entire job is to reassure an anxious client uses its weakest text for the reassurance. [needs browser] for the exact ratio. Also: the pause screen's `animate-ping` ring (L149) is a pulse — a small, involuntary "something is happening" signal, the wrong motion for "everything is fine, wait."

### End: session close — **weak, and the one place the peak-end rule is being wasted**

A therapy session ends with `Ctrl+Enter` and the map autosaves silently (`saveStatus: 'salvando' → 'salvo'`, footer L672). The end is *quiet*, which is the right register, but it is **unmarked**. There is no "session complete" state, no summary, no reflection prompt, and — critically — **no prompt to export or back up the record**. The export surface lives behind `Ctrl+E`, which opens a 7-tab modal. The single most emotionally loaded moment after the session (the therapist has just finished a difficult hour and now decides whether this record is safe) is not surfaced at all. That is a **P2 design gap and a cheap fix**: on session switch or on a long idle, surface *"Sessão de 15/09 salva localmente neste navegador. Fazer backup?"*

### Destructive actions — **the single worst finding in this audit**

Per `ux-frameworks.md` §2, "Delete / destructive action → risk: fear of irreversible loss → intervention: confirmation dialog, undo option, time-delay." Narratips implements **one third** of that, in the wrong place.

| | Confirmation | Loss count | Undo | Time-delay | Design language |
|---|:---:|:---:|:---:|:---:|---|
| Delete **session** (`AdminClientManager.tsx:186–192`) | native `confirm()` | ❌ | ❌ | ❌ | native dialog |
| Delete **client + all their sessions** (`:173–183`) | native `confirm()` | ❌ | ❌ | ❌ | native dialog |
| Delete **map** via `MapListDrawer` (unreachable) | ❌ | ❌ | ✅ 10s toast | ✅ | native dialog |
| The 10s undo toast (`TherapistView.tsx:771–782`) | — | — | ✅ | ✅ | ❌ **never renders** |

The framework's three interventions — dialog, undo, time-delay — are implemented, and the *only* implementation with undo and time-delay is **dead code**, because `setIsMapListOpen(true)` is never called. So the live product has confirmation-by-`confirm()` and nothing else, for **irreversible deletion of clinical records**, on a device that may be a borrowed laptop, with no server and no backup rotation. A native `confirm()` is also a jarring visual break from a carefully built design system — the emotional peak of a delete action is an OS dialog, which reads as *the app does not care*.

**Fix, in order:**
1. Wire `onDeleteMapWithUndo` into `AdminClientManager`'s session delete; add an equivalent client-restore path. *The infrastructure already exists — this is a wiring fix, not a build.*
2. Replace both `confirm()` calls with an in-app confirm that names the loss: *"Excluir a sessão de 15/09/2026? 47 balões serão perdidos. Você poderá desfazer por 20 segundos."*
3. Extend the undo window from 10s to ≥20s with a visible countdown, and add a second-chance inline "Excluir" that only commits on a second deliberate press.
4. Before any destructive commit, offer *"Exportar esta sessão antes de excluir?"*.

### The distressed client in `ClientView` — **mostly well-handled, three gaps**

**Handled well:** the surface has exactly **one** interactive element (the fullscreen toggle), which is the correct decision for a passive Monitor surface. Empty state, pause screen, and neutral title are all calm and honest. No error codes, no spinners, no "connection lost" alarm.

**Gaps:**
1. **The one control on a client's screen can hurt them.** `ClientView.tsx:213–220` — the fullscreen toggle sits at `opacity-30` and jumps to `opacity-100` on hover. A distressed client who moves the mouse or touches the screen sees a control appear; pressing it collapses the display they are meant to be reading. The parent also auto-hides the cursor after 2.5s (L96–102), so the control flickers in and out. On a shared/video screen, **the client should have zero chrome during a session** — arm the toggle behind a 3-second-long-press or a keyboard shortcut, or hide it entirely once the session snapshot arrives.
2. **No exit.** If the call ends and the therapist closes their window, the client is left staring at a stale map or a permanent "Um momento" screen with no way out. A client-side escape hatch (`Esc` → return to therapist's window, or a delayed auto-exit hint) is missing.
3. **The thinnest reassurance uses the thinnest text.** See Peak, above.

---

## 10. Design Personas

### **Morgan (Accessibility)** — legibility was designed in; everything around it was not

- **Strength:** the font-scale control (85/100/115/130%) exists specifically for shared-video legibility (`SettingsModal.tsx:221–247`), and the balloon text is SVG `<text>` at a computed `fontSize` (root 16px / others 13.5px, ×`fontScale`) so it scales with the control. Plus Jakarta Sans at large sizes on a paper ground is a genuinely legible pairing. This is intentional, not accidental.
- **Failure 1 — content loss on overflow.** `BalloonNode.tsx:46–59` truncates to two lines and cuts with `'…'`, capped at 240px content width (`useMindMapLayout.ts:61`). No expand, no tooltip, no overflow badge. The therapist's own words disappear on the client's screen. **P1.**
- **Failure 2 — no reflow at 200% zoom.** The whole app is `w-screen h-screen overflow-hidden` with a fixed `h-14` header whose minimum content is ≈690px and a footer whose minimum is ≈600px. A 1440px screen at 200% zoom gives 720 CSS px. The header crushes rather than reflowing, and `overflow-hidden` guarantees nothing is reachable. **P1.**
- **Failure 3 — text selection is globally disabled.** `index.css:10` — `user-select: none` on `body`. A low-vision user who wants to enlarge, read aloud, or copy a balloon cannot select it. `OutlineEditor` re-enables `select-text` (L353) but the balloons and all chrome stay unselectable. **P2.**
- **Failure 4 — the dwell slider announces nothing.** `SettingsModal.tsx:173–181` — bare `<input type="range">` with no `aria-valuetext`, so a screen reader says "5" with no unit, and the tick labels at L182–186 are visually adjacent but not programmatically associated. **P2.** (Full ARIA verdicts are the sibling reviewer's; the *design* defect is the unstyled control.)

### **Taylor (Mobile) — hard functional failure, not a sizing nit**

- **Failure 1 — the layout does not exist at 375px.** Header crushes, split view gives the outline 142px, `AdminClientManager` gives the session column 55px, and there is not one `@media` rule in the codebase. **P0.**
- **Failure 2 — touch targets 20–36px across the board.** Zero of ~34 secondary controls reach 44×44px (table in I3). The worst are the 20×20 client rename/delete buttons (`AdminClientManager.tsx:361,370`), the 16px-tall `+ Filho` button, and the 20px-tall footer Undo/Redo links. **P1.**
- **Failure 3 — the actions a finger can't reach.** Every `opacity-0 group-hover:opacity-100` group is invisible without a hover: session delete (`MapListDrawer.tsx:206`), client rename/delete (`AdminClientManager.tsx:352`), and `+ Filho` in the outline (`OutlineEditor.tsx:532`). On a tablet a therapist **cannot delete a session, rename a client, or add a child node by tapping.** The two outline controls are additionally `tabIndex={-1}`, so a keyboard/switch user can't reach them either. **P0.**
- **Failure 4 — hover-only hover targets in the canvas.** `MindMapCanvas.tsx:393–441` is a 5-button cluster of 28×28 controls floating over the map. Pinch-zoom works (Pointer Events + `setPointerCapture`, L191) but there is no `touch-action` declaration, so two-finger gestures may fight page scroll [needs browser]. **P3.**
- **Partial credit:** the canvas itself *does* adapt — it is `w-full h-full` SVG driven by `fitToScreen()` (L76–97), so it scales to any viewport. And `ClientView` on a phone/tablet is genuinely fine: it is a full-bleed SVG with a font-scale control. **The client surface is the one responsive thing in the app.**

### **Jordan (First-Timer)** — the app assumes you already know how to use it

- **Failure 1 — first run is a blank white box.** Zero clients → `AdminClientManager.tsx:289–379` `filteredClients.map` has no empty branch → the entire left panel renders empty. The right column says *"Selecione ou crie um cliente para visualizar as sessões."* (L557–559) with no button in that pane. The only path forward is the word **"Novo"** in a `text-xs` link roughly 24px tall (L238–245). No tour, no sample session, no "crie seu primeiro cliente" CTA. **P1.**
- **Failure 2 — the primary navigation is a tooltip.** Sessions are managed via `AdminClientManager`, reachable only through the client-name button whose sole label is `title="Gerenciar Clientes e Sessões"` (L425). And the surface that *looks* like the session browser — `MapListDrawer`, with "Novo Mapa", search, per-map rename/duplicate/delete and "Fazer Backup Completo" — **can never be opened** (C1). A first-timer who finds no entry point has no way to know the map list exists. **P1.**
- **Failure 3 — the most destructive binding is undocumented.** `Backspace` on an empty outline line deletes the node (`OutlineEditor.tsx:278–293`). The outline header teaches Enter / Ctrl+Enter / Tab; the footer teaches Ctrl+. / Ctrl+Enter / Esc. Backspace is never mentioned, so it is discovered by accident. `Ctrl+Z` does recover it, but the user has to find that out too. **P1.**
- **Failure 4 — seven export tabs, no default guidance.** `ExportModal` opens on `md`, but the tab strip (L294–371) offers Markdown / Importar / PNG / SVG / OPML / FreeMind / JSON with no indication of which a therapist actually wants. OPML and FreeMind are interchange formats for tools most clinicians will never install. **P2.**
- **Partial credit:** the client-facing surfaces are exemplary first-run experiences — the honest waiting sentence and the calm pause screen would pass a usability test with a real client. The empty *session* list (L462–465) also names both CTAs. The pattern is known; it is just not applied to the two lists above it.

---

## 11. ⛳ [needs browser] Flag Summary (Codebase mode)

The following cannot be confirmed from source alone and require live verification with `agent_browser` before they can be considered resolved or dismissed:

| # | Item | Source | Why browser-only |
|---|---|---|---|
| N1 | Pause-screen sub-copy contrast — `text-stone-400` on `#F7F6F2` at `text-xs` | `ClientView.tsx:155` | Rendered colour + font smoothing; ratio is the a11y reviewer's measurement |
| N2 | `ClientView` fullscreen toggle perceived at 30% opacity over live content | `ClientView.tsx:217` | Composited opacity over an animating canvas; whether it reads as "not interactive" or as an artifact |
| N3 | `animate-ping` × 6 — whether the 6 concurrent infinite pulses read as noise, calm, or alarm (esp. the "Cliente Conectado" dot and the pause ring) | `TherapistView.tsx:449`, `ClientView.tsx:149` | Motion perception; also a `prefers-reduced-motion` question (zero `@media` rules exist, so nothing is disabled) |
| N4 | Canvas touch-gesture conflict — `touch-action` is undeclared on the pan surface | `MindMapCanvas.tsx:216–229` | Only observable on a real touch device |
| N5 | Therapist header at 375px — whether it crushes, overflows, or truncates (vs. clipping content) | `TherapistView.tsx:396–563` | Requires a 375px render |
| N6 | 200% browser zoom reflow across all four overlays | all modals | Requires a real zoom |
| N7 | Balloon legibility at the `k = 0.4` floor of `fitToScreen` (13.5px × 0.4 ≈ 5.4px effective) on a small client display | `MindMapCanvas.tsx:90`, `BalloonNode.tsx:62` | Rendered SVG text at extreme scale |
| N8 | Whether `ExportModal`'s two icon-topper tabs read as templated filler or as reasonable affordance in situ | `ExportModal.tsx:629–671` | Gestalt judgement on the live surface |
| N9 | Actual focus-ring visibility — the audit found `focus:`/`focus-visible:` styling on only 3 elements (`ExportModal:591`, `MapListDrawer:128`, `AdminClientManager:283`); the browser default ring on the other 54+ controls is unverified | all | Needs a live tab-through |

---

## 12. Recommended Priority

| Order | Fix | Severity | Effort |
|:---:|---|---|:---:|
| 1 | **Wire the existing 10s delete-undo toast into `AdminClientManager`'s session + client delete; replace both `confirm()` calls with an in-app confirm that states the loss count** (C1) | P0 | **S — the code already exists** |
| 2 | **Replace `opacity-0 group-hover:opacity-100` with always-visible `⋯` menus** (C3) | P0 | S |
| 3 | **Add a `md` breakpoint: header overflow menu, stacked split view, `AdminClientManager` client picker, `SettingsModal` `flex-col` rows** (C2) | P0 | M |
| 4 | **Extract `<Dialog>` + `<DialogHeader>` + `<DialogClose>` + a shared `<SegmentedControl>` and reduce all 5 overlays to props** (I1) | P1 | M |
| 5 | **Add an `@theme` token block; replace the 7 surface literals and the `slate`/`stone` split; unify `theme` to one mechanism** (I2) | P1 | M |
| 6 | **Raise every icon-button hit area to ≥44px** (I3) | P1 | S |
| 7 | **Delete the PNG + SVG icon-topper tabs; fold into the Markdown toolbar** (slop #8, #9 → count 4→2) | P2 | XS |
| 8 | **Fix the canvas `onToggleCollapse` handler** (I5) | P1 | XS |
| 9 | **Add balloon text overflow affordance** (I4) | P1 | M |
| 10 | **Add popup-blocked recovery copy to `openClientWindow`** (I7) | P1 | S |
| 11 | **Add a first-run empty state to the client list + a `⋯` map-list entry point** (M9) | P1 | S |
| 12 | **Consolidate shortcut documentation into one discoverable surface; document Backspace-to-delete** (M5) | P2 | S |
| 13 | **Hide the ClientView fullscreen toggle behind a deliberate gesture; add a client-side exit** (Emotional Journey gap 1–2) | P2 | S |
| 14 | Style the dwell slider with a value pill and tick association; allow `user-select: text` in balloons (I6) | P1 | S |
