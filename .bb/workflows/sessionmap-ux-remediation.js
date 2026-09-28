export const meta = {
  name: "sessionmap-ux-remediation",
  description: "Resolve the sessionmap UX audit end to end: shared primitives, WCAG AA contrast, canvas keyboard access, storage-key migration, responsive layout, and GitHub Pages.",
  phases: [
    { title: "Refactor", detail: "One agent per disjoint file group" },
    { title: "Verify", detail: "Full build barrier; repair cross-file breakage" },
    { title: "Responsive", detail: "Breakpoints, 44px touch targets, reflow at 375/768" },
    { title: "Pages", detail: "GitHub Pages build config and repo association" },
    { title: "Report", detail: "Final state and residual gaps" },
  ],
};

const cfg = args || {};
const ROOT = cfg.root || "/home/deploy/repos/sessionmap";
const AUDIT = ROOT + "/.stelow-ux-critique";
const DATE = cfg.date || "2026-09-28";

const PREAMBLE = `
Project: sessionmap — a Brazilian-Portuguese therapy app (therapist builds a
mind map of what a client says; balloons on an SVG canvas; a separate client
window shows a simplified large-type view). Local-only: IndexedDB, no server.
Repo root: ${ROOT}

READ FIRST: ${AUDIT}/a11y-audit-report.md and ${AUDIT}/design-audit-report.md
They are prior reviews of this exact code. Do not re-derive their findings.

ALREADY DONE — do not redo, do not revert:
- src/index.css now holds a semantic token layer with two themes (papel/noite)
  and an @custom-variant dark binding to the .dark class. Utilities available:
  bg-surface, bg-surface-raised, bg-surface-sunken, bg-surface-inset,
  text-content, text-content-muted, text-content-subtle, text-content-onaccent,
  border-line, border-line-muted, bg-accent, text-accent-text, bg-accent-soft,
  text-positive, text-caution, text-negative.
  Component classes: .ctl (base control), .ctl-primary, .ctl-danger, .no-select.
  Reduced-motion and forced-colors blocks already exist.
- src/components/ui/Modal.tsx exports Modal and ConfirmDialog.
- src/components/ui/Controls.tsx exports Segmented, Switch, SettingRow, Divider.
- src/components/ui/Tabs.tsx exports Tabs and TabPanel.
- prefers-reduced-motion, forced-colors, aria-labels on header icon buttons,
  and the node-collapse no-op bug are fixed.

HARD RULES:
- You OWN ONLY the files named in your task. Other agents are editing other
  files in the same tree right now. Never edit, revert, or "tidy" a file you
  do not own. In particular do NOT touch src/index.css or vite.config.ts.
- Do NOT run "bun run build" — dist/ is shared and concurrent builds corrupt it.
- Do NOT run git commit, git checkout, git reset, or git stash.
- Run "bun run lint" (tsc --noEmit) to typecheck. Other agents' half-finished
  edits may surface errors in files you do not own: ignore those, never fix
  them, never revert them. Only fix errors in your own files.
- Prefer deleting duplicated markup over adding more of it.
- Keep the UI in Brazilian Portuguese. Keep existing visible copy where it is
  accurate; do not invent product claims.
- Report honestly. If a finding cannot be fixed without a decision the user
  must make (privacy, data format, product scope), say so instead of guessing.
`;

// Each entry owns a disjoint set of files.
const GROUPS = [
  {
    key: "export-modal",
    files: "src/components/modals/ExportModal.tsx only",
    task: `Migrate ExportModal to the shared primitives. It is the last overlay not
yet using them and the largest file in the project.

1. Replace its hand-rolled overlay/header/close/backdrop with <Modal> from
   ../ui/Modal. It currently has: no role="dialog", no aria-modal, no
   aria-labelledby, no Escape handling, no focus trap, no focus restore, a
   1px focus:border-amber-500 focus indicator measured at 1.45:1 (SC 2.4.7),
   and four close-button variants across the codebase.
2. Replace its seven format tabs (md / opml / freemind / json / png / svg / zip
   or whatever it has) with <Tabs> + <TabPanel>. They are currently plain
   buttons with no role="tab", no aria-selected, no arrow-key navigation and no
   tabpanel association.
3. Replace hardcoded slate/amber classes with the tokens.
4. The export/import status messages are async and have no live region. Wrap
   the import status in role="alert", give the textarea aria-describedby and
   aria-invalid, and add aria-busy to the export panel while zipping.
5. The <pre> previews must be selectable: the old global user-select:none is
   gone, so confirm they inherit text selection and add select-text if needed.
6. The audit flags an "icon topper + center stack" AI-slop cluster in the
   lower half of this file (report section 2.5, tell #8 and #9, around the
   duplicated tab panels) and a feature-tile grid. Simplify those rather than
   preserving them.`,
  },
  {
    key: "admin-overlay",
    files: "src/components/admin/AdminClientManager.tsx only",
    task: `Migrate the admin panel's overlay chrome to the shared <Modal> primitive.
The destructive-delete work is already done (ConfirmDialog + undo window); do
not revert that.

1. Replace the custom fixed-inset overlay, header, close button and backdrop
   with <Modal title="..." icon={...} maxWidth="max-w-4xl">. It currently has
   no dialog role, no Escape, no focus trap and no focus restore.
2. Replace the remaining hardcoded colors with tokens. Note it hardcodes
   bg-[#0B0F19] and has a measured 1.31:1 contrast failure on a label
   (report P0 table, AdminClientManager:235) and 2.53:1 on another.
3. Heading order is inverted: an h3 appears before an h2. Fix to a single h2
   owned by the Modal plus correctly nested h3s below it.
4. The client search input and the new-client input rely on placeholder as
   their only label (SC 3.3.2). Add real <label> elements or aria-label.
5. The focus rings on its inputs use outline-none + focus:border-amber-500 at
   ~2.05:1. Remove outline-none and let the global focus-visible ring apply, or
   use a focus-visible ring that measures >= 3:1.
6. Fix the h3/h2 inversion and any nested-interactive-element HTML
   (button inside button) you find.`,
  },
  {
    key: "canvas-a11y",
    files:
      "src/components/mindmap/MindMapCanvas.tsx and src/components/mindmap/BalloonNode.tsx only",
    task: `This group owns the single most severe finding in the audit: the mind map
— the app's primary artefact — is completely pointer-only.

P0: no keyboard access at all. The wrapper div's only handlers are onWheel,
onPointerDown/Move/Up. The <svg> has no role, no tabIndex, no aria-label. Every
node is a bare <g> with an onClick and no role, no tabindex, no accessible
name. Zoom has +/- buttons; panning and node selection are pointer-only. In
ClientView the canvas is readOnly, so a client user has zero affordances.
Fixes SC 2.1.1 (A) and 4.1.2 (A).

Required:
1. Give the map container role="application" (or role="tree") with tabIndex={0}
   and an aria-label in Brazilian Portuguese.
2. Render each balloon node as a focusable element with role="treeitem",
   aria-level, aria-expanded (when it has children) and aria-selected.
3. Implement roving tabindex: ArrowUp/Down move between visible nodes,
   ArrowLeft/Right collapse/expand or move to parent/child, Enter/Space select.
4. Keyboard equivalents for pan (arrow keys on the container when no node has
   focus) and zoom (+/- keys), mirroring the existing onWheel behaviour.
5. Give every node's <text> an accessible name so a screen reader announces
   the balloon content rather than an undifferentiated run.
6. Add aria-label to the existing icon-only zoom/fit/reset buttons.

Also fix, in the same two files:
7. Contrast failures listed in the a11y report: the dark connector #475569 on
   #0B0F17 at 2.53:1 (non-text, needs 3:1); the selection halo #F59E0B on white
   at 2.15:1; the outer halo #FBBF24 at 0.4 alpha at 1.24:1. Grid dots and
   highlight glows are decorative and may stay below 3:1 — say so explicitly in
   your report rather than silently leaving them.
8. The +N collapse badge has fallback fill #3B82F6 with white 10px text at
   3.68:1. All 8 BRANCH_PALETTE colours pass, so only the fallback fails — but
   the fallback is what renders when a node has no colour. Fix the fallback.
9. Line 348 passes "node: null as any" for the ghost node. Give it a real type
   or remove the escape hatch.
10. In readOnly mode the whole control cluster gets opacity-40, taking the
    icons to 2.37:1 while leaving them interactive. Either raise the contrast or
    genuinely disable the controls.`,
  },
  {
    key: "client-view",
    files: "src/components/ClientView.tsx only",
    task: `ClientView is the surface a client actually looks at during a session,
often in distress, and it has the weakest contrast in the app. Fix every
measured failure in the a11y report for this file:

- line ~207 "Aguardando conexão..." text-slate-400 on #F7F6F2 at 14px = 2.37:1
- line ~155 "A visualização continuará em instantes..." text-stone-400 at 12px = 2.33:1
- the dark variant of the same string at 4.24:1
- line ~190 thin-bar label text-amber-600 on white, 12px bold = 3.19:1
  (12px bold is NOT large text, so the 3:1 exemption does not apply)
- line ~217 fullscreen toggle text-slate-400 at opacity-30 = 1.43:1. This is
  the ONLY control on the client window and it sits at 57% opacity at rest.
- line ~199 live caret text-amber-500 on white = 2.15:1
- line ~149 ping ring border-stone-300 on #F7F6F2 = 1.38:1

Use the tokens from src/index.css; verify your choices by computing the ratio
with python3 rather than by eye. Text needs >= 4.5:1, non-text UI needs >= 3:1.

Also:
- The window hides the cursor unconditionally after 2.5s of mouse idle, with
  no setting, no reduced-motion guard and no pointer-capability check. On a
  projector or video call this removes the pointer for anyone with a tremor or
  low vision. Gate it on matchMedia('(pointer: fine)') and respect the user's
  motion preference.
- It sets document.title to "Mapa" on purpose (privacy) — preserve that.
- Add an h1 or correct the heading level; it currently starts at h2.`,
  },
  {
    key: "outline-editor",
    files: "src/components/outline/OutlineEditor.tsx only",
    task: `The outline editor is the one genuinely keyboard-first surface in the app
and its focus indicator (a full-contrast row inversion at 20.17:1) is the
pattern the rest of the app should copy. Preserve that. Fix its problems:

1. Two controls are removed from the tab order with tabIndex={-1}: the collapse
   chevron (~line 477) and the "+ Filho" button (~line 526). "Criar filho" is
   recoverable via Ctrl+Enter, but COLLAPSE IS NOT — the chevron is the only
   affordance, so a collapsed subtree currently cannot be re-expanded by
   keyboard. Remove both tabIndex={-1}. The controls are hidden by
   opacity-0 group-hover:opacity-100, which is why they were excluded; replace
   that with group-focus-within:opacity-100 so they are reachable.
2. Contrast: the dwell ring #CBD5E1 on white = 1.48:1 and its arc #F59E0B =
   2.15:1 (non-text, needs 3:1). The editor also hardcodes bg-[#0E131F] and
   bg-[#131926] — two of the six duplicate "dark surface" literals. Move all
   to tokens.
3. It carries hardcoded slate/amber classes throughout. Convert to tokens while
   preserving the row-inversion focus treatment.
4. Flag this behaviour change in your report: the 3-second dwell auto-focus
   fires from activeNodeId, and onFocus calls focusInput, so a keyboard user
   arrowing through the outline triggers the client-facing auto-highlight on
   every row they pass, with no way to suppress it mid-session (setting
   focusDwellSeconds: 0 is the only off switch, and it is in Settings). Decide
   whether a keyboard traversal should arm the dwell timer at all, and if you
   change it, make sure it is still discoverable for mouse users.`,
  },
  {
    key: "storage-keys",
    files: "src/services/storage.ts and src/services/sync.ts only",
    task: `The project was renamed from "narratips" to "sessionmap" but every runtime
identifier is still narratips_*: the IndexedDB database name narratips_db, the
three object stores, the localStorage keys (narratips_settings,
narratips_active_map, narratips_active_map_id, narratips_active_client_id,
narratips_maps, narratips_clients) and the BroadcastChannel
narratips_sync_channel / narratips_sync_storage_event.

Migrate them to sessionmap_* — but SAFELY. The naive change (just rename
DB_NAME) makes IndexedDB open a fresh empty database, and any existing user
loses every map and client with no recovery. That is unacceptable in an app
holding clinical records.

Required:
1. Bump DB_VERSION and implement an onupgradeneeded migration that opens the
   legacy narratips_db, copies every object store into the new sessionmap_db,
   and only then deletes the old database. Handle the "no legacy database"
   case as a clean first run.
2. The localStorage keys need a one-time read-through: try the new key, fall
   back to the legacy key, write it forward under the new key, and remove the
   legacy one. Keep this in one clearly-named helper so it can be deleted
   later.
3. sync.ts's BroadcastChannel name is a live handshake between the therapist
   window and the client window. Renaming it is safe only if BOTH windows run
   the new code at the same time. Make the channel name a single exported
   constant shared by both sides rather than a duplicated literal, and say in
   your report that a therapist on the old build and a client on the new build
   will fail to pair until both reload.
4. Do NOT change the default seed data (DEFAULT_SAMPLE_CLIENT, its id
   "c_ana_m", or the sample map) — other parts of the app and the localStorage
   fallbacks reference those exact values.
5. MapListDrawer builds a backup filename with the narratips_ prefix. Leave
   that file alone — it is not yours — but report it as a follow-up so the
   user can decide whether backup filenames should change.`,
  },
];

phase("Refactor");
log(
  "Refactor phase: " +
    GROUPS.length +
    " agents, one per disjoint file group. Concurrent builds are disabled " +
    "by design; a single Verify barrier runs the full build afterwards."
);

const refactorResults = await parallel(
  GROUPS.map((g) => () =>
    agent(PREAMBLE + "\nYOUR FILES (you own these, nothing else):\n" + g.files + "\n\nTASK:\n" + g.task, {
      label: "refactor:" + g.key,
      phase: "Refactor",
      schema: {
        type: "object",
        required: ["summary", "filesTouched", "fixed", "needsDecision"],
        properties: {
          summary: { type: "string" },
          filesTouched: { type: "array", items: { type: "string" } },
          fixed: { type: "array", items: { type: "string" } },
          needsDecision: { type: "array", items: { type: "string" } },
          buildClean: { type: "boolean" },
        },
      },
    })
  )
);

const done = refactorResults.filter(Boolean);
log(
  "Refactor complete: " +
    done.length +
    "/" +
    GROUPS.length +
    " groups returned. " +
    GROUPS.filter((_, i) => !refactorResults[i]).map((g) => g.key).join(", ") +
    (done.length === GROUPS.length ? "" : " FAILED — see results.")
);

phase("Verify");
const verified = await agent(
  PREAMBLE +
    `
YOU ARE THE BARRIER. The five refactor agents above have all finished. You now
own the whole tree.

Run, in order, and fix whatever breaks:
  cd ${ROOT} && bun run lint
  cd ${ROOT} && bun run build
  cd ${ROOT} && rm -rf dist && bun run build

Each agent only typechecked in isolation, so cross-file breakage is expected:
a prop was renamed in one file and its caller was not updated, a token utility
does not exist, a type changed. Resolve every error. Where two agents made
conflicting choices, pick the one that keeps the shared primitives
(src/components/ui/*) as the single source of truth and re-point the other
caller.

Then verify the contrast claims rather than trusting them. Write a python3
WCAG script, parse the final token values out of src/index.css for BOTH the
papel and the noite themes, and check every foreground/background pair the
components actually produce. Report the real numbers. If a pair fails, fix the
component.

Do not commit. Do not touch vite.config.ts.`,
  {
    label: "verify:build",
    phase: "Verify",
    schema: {
      type: "object",
      required: ["buildClean", "lintClean", "contrastChecked", "repairs", "remaining"],
      properties: {
        buildClean: { type: "boolean" },
        lintClean: { type: "boolean" },
        contrastChecked: { type: "boolean" },
        repairs: { type: "array", items: { type: "string" } },
        remaining: { type: "array", items: { type: "string" } },
        contrastTable: { type: "string" },
      },
    },
  }
);

phase("Responsive");
log(
  "Responsive phase: the design audit scored responsive 0/4. There are zero " +
    "@media rules in the project and zero of ~34 secondary controls meet 44x44px."
);

const responsive = await parallel(
  GROUPS.filter((g) => g.key !== "storage-keys").map((g) => () =>
    agent(
      PREAMBLE +
        `
YOUR FILES (you own these, nothing else): ${g.files}

TASK — responsive pass, same group as the refactor you may have just done:
The design audit scored responsive 0/4. Findings: zero @media rules in the
whole project, the layout is a fixed-px desktop two-pane split, and none of the
~34 secondary controls meet the 44x44px touch target floor (they measure
16-36px).

1. Audit your files for @media queries and Tailwind breakpoint usage. There
   are currently none.
2. Make the layout adapt at 375px and 768px without horizontal scroll. The
   therapist view is a resizable horizontal split (an outline pane plus a
   canvas) driven by an inline width percentage — decide how it collapses
   (stacked, or drawer) and implement it.
3. Bring every interactive control up to a minimum 44x44px hit area. Where a
   visual size must stay small, use padding or a pseudo-element so the
   touchable region grows without changing the visual.
4. Text must reflow at 200% zoom without truncation or overlap.
5. Do NOT hand-write @media blocks for this — Tailwind breakpoints are already
   available. If you genuinely need a container query, explain why in your
   report.
6. Do not add media queries to src/index.css; you do not own that file.`,
      {
        label: "responsive:" + g.key,
        phase: "Responsive",
        schema: {
          type: "object",
          required: ["summary", "breakpoints", "touchTargetsFixed"],
          properties: {
            summary: { type: "string" },
            breakpoints: { type: "array", items: { type: "string" } },
            touchTargetsFixed: { type: "integer" },
            notes: { type: "array", items: { type: "string" } },
          },
        },
      }
    )
  )
);

phase("Verify");
const verified2 = await agent(
  PREAMBLE +
    `
YOU ARE THE SECOND BARRIER. The responsive phase just landed.

  cd ${ROOT} && bun run lint && bun run build

Responsive work is the most likely source of type errors (dynamic class names,
string interpolation that Tailwind cannot statically detect, inline styles).
Fix everything. If a class is built by string interpolation Tailwind cannot
see, rewrite it as a static full class name — otherwise it will be silently
dropped from the production CSS and the style will not exist at runtime.

Then grep the built CSS for the responsive utilities you expect and confirm
they were actually emitted. A responsive class that never made it into the
bundle is a silent failure.

Do not commit.`,
  {
    label: "verify:responsive",
    phase: "Verify",
    schema: {
      type: "object",
      required: ["buildClean", "repairs", "remaining"],
      properties: {
        buildClean: { type: "boolean" },
        repairs: { type: "array", items: { type: "string" } },
        remaining: { type: "array", items: { type: "string" } },
      },
    },
  }
);

phase("Pages");
const pages = await agent(
  `
Project: ${ROOT} (sessionmap, on GitHub at github.com/calionauta/sessionmap,
private, default branch main). Vite 8 + React 19 + TypeScript + Tailwind v4,
bun as package manager, build script "vite build" (outputs to dist/), dev
server is vite --port=3000 --host=0.0.0.0.

Task: put this app on GitHub Pages and associate the deployment with the repo.

1. Set the Vite base to the Pages subpath (/sessionmap/) so asset URLs resolve
   under the project page rather than the domain root. vite.config.ts currently
   uses __dirname for the @ alias and has no base — migrate that to
   import.meta.dirname while you are in the file, since the __dirname usage
   triggers a deprecation warning under Vite 8's native config loader.
2. Add a GitHub Actions workflow that builds with bun and deploys to Pages on
   push to main. Use the official Pages deploy action, not a hand-rolled one.
   The repo is private, so Pages visibility may need to be switched to
   "public with build" or the workflow will fail with a permissions error —
   detect and report that rather than guessing.
3. Enable Pages and set the source to GitHub Actions via the gh CLI, and
   report the resulting URL.
4. IMPORTANT ARCHITECTURAL WARNING you must verify and report, not fix
   silently: this app stores all client therapy data in the browser's
   IndexedDB, and the therapist/client sync is a BroadcastChannel plus the
   localStorage storage event. That means (a) data is per-browser and
   per-device, so a therapist on a laptop and a client on a phone see
   different data, and (b) publishing under github.io/repo/ versus
   username.github.io/repo/ is a DIFFERENT ORIGIN and therefore a different
   IndexedDB partition. If a Pages URL changes, every existing user silently
   gets an empty database. Decide and state clearly which URL should be
   treated as canonical, and whether the BroadcastChannel pair still works
   when both windows are on the Pages origin. Do not change the storage code —
   that is out of scope; report it.
5. The unused "motion" dependency is declared in package.json but never
   imported. Remove it with "bun remove motion" and confirm the build still
   passes.
6. Do NOT change the IndexedDB name or the localStorage key prefixes.

Run "bun run build" and report the real result of every command you ran.`,
  {
    label: "pages:deploy",
    phase: "Pages",
    schema: {
      type: "object",
      required: ["baseSet", "workflowAdded", "pagesEnabled", "url", "warnings"],
      properties: {
        baseSet: { type: "boolean" },
        workflowAdded: { type: "boolean" },
        pagesEnabled: { type: "boolean" },
        url: { type: "string" },
        motionRemoved: { type: "boolean" },
        buildClean: { type: "boolean" },
        commandsRun: { type: "array", items: { type: "string" } },
        warnings: { type: "array", items: { type: "string" } },
      },
    },
  }
);

phase("Report");
const final = await agent(
  `
You are the completeness critic for a remediation of the sessionmap therapy
app at ${ROOT}.

Phase results (JSON):

REFACTOR (per file group):
${JSON.stringify(refactorResults, null, 2)}

VERIFY (barrier 1):
${JSON.stringify(verified, null, 2)}

RESPONSIVE (per file group):
${JSON.stringify(responsive, null, 2)}

VERIFY (barrier 2):
${JSON.stringify(verified2, null, 2)}

PAGES:
${JSON.stringify(pages, null, 2)}

Original audit scores, for comparison:
  accessibility 1/4, design quality 2/4, responsive 0/4,
  interaction state coverage 2.49/9 (0 of 61 components reached the >=6 target),
  6 P0 + 10 P1 + P2/P3 in a11y; component layer was unbuilt, no design tokens,
  five overlays with zero Escape/focus-trap/focus-restore, zero aria-labels,
  zero prefers-reduced-motion, zero forced-colors, and the dark: variant
  compiling to prefers-color-scheme instead of the app's own .dark switch.

Your job:
1. Determine what is ACTUALLY fixed versus what a phase merely claimed. Go
   verify the high-stakes claims yourself with grep and by reading the files —
   count the real aria-labels, roles, landmarks, focus-visible rules and token
   usages now. Do not take any phase's self-report at face value; a phase that
   reported success but left the problem in place is the failure mode you
   exist to catch.
2. Re-measure the two audit metrics that were worst: interaction state
   coverage and accessibility. Give the new numbers with the method you used.
3. State what remains unfixed, separated into: (a) still-open findings from the
   original audit, (b) new problems introduced by this remediation, and
   (c) items that need a human product decision and are therefore not
   code-fixable.
4. Call out anything a phase did that was wrong or overreached.
5. Give a blunt verdict: is this app ready to be shown to a real therapist, and
   what is the single highest-priority thing still standing in the way?

Be specific and cite files. Prefer honest bad news over a flattering summary.`,
  {
    label: "report:critic",
    phase: "Report",
    schema: {
      type: "object",
      required: ["verdict", "verifiedFixes", "openFindings", "newProblems", "decisionsNeeded"],
      properties: {
        verdict: { type: "string" },
        verifiedFixes: { type: "array", items: { type: "string" } },
        openFindings: { type: "array", items: { type: "string" } },
        newProblems: { type: "array", items: { type: "string" } },
        decisionsNeeded: { type: "array", items: { type: "string" } },
        a11yScore: { type: "string" },
        designScore: { type: "string" },
        stateCoverage: { type: "string" },
        method: { type: "string" },
        worstRemaining: { type: "string" },
      },
    },
  }
);

return {
  refactor: refactorResults,
  verifyBuild: verified,
  responsive,
  verifyResponsive: verified2,
  pages,
  report: final,
  date: DATE,
};
