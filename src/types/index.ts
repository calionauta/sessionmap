export interface MindMapNode {
  id: string;
  text: string;
  collapsed?: boolean;
  color?: string | null;
  children: MindMapNode[];
}

export interface MindMapView {
  zoom: number;
  x: number;
  y: number;
}

export interface Client {
  id: string;
  name: string;
  createdAt: string;
  notes?: string;
  /**
   * Set when the client (and, implicitly, their sessions) is archived.
   * null/undefined means active. An archived record is hidden from the
   * working list but keeps every session, so it can be restored.
   */
  archivedAt?: string | null;
}

export interface MindMap {
  schema: 1;
  id: string;
  title: string; // e.g. "28/09/2026 14:08:17"
  clientId: string;
  clientName: string;
  sessionDate: string; // "DD/MM/YYYY HH:mm:ss"
  createdAt: string;
  updatedAt: string;
  root: MindMapNode;
  view?: MindMapView;
  /**
   * Set when this single session is archived. null/undefined means active.
   * Archiving a session never touches the client, and archiving a client
   * stamps every one of their sessions too, so the two stay consistent.
   */
  archivedAt?: string | null;
}

export interface Settings {
  theme: 'papel' | 'noite';
  liveTextMode: 'live' | 'confirm_only';
  thinBarAlwaysVisible: boolean;
  autoFitOnAdd: boolean;
  clientFontScale: number;
  focusZoomMode: boolean; // Zoom in on active node + parents + children when navigating
  /**
  /**
   * Scales the text of the outline rows — the therapist's own typing surface.
   *
   * Separate from clientFontScale, which sizes the balloons. Those are read by
   * the client from across a room, these are read and typed by the therapist at
   * close range, and the two want different sizes for different reasons.
   */
  outlineFontScale: number;
  /**
   * Hides the mind map pane so the outline takes the full width.
   *
   * The mirror of isMaximizedMap. Some sessions the therapist does not want the
   * map in front of them at all — they are reading back and the client has the
   * map on the second screen — and a 62% pane of empty canvas is a large piece
   * of screen doing nothing.
   */
  maximizeOutline: boolean;
  /**
   * The outline pane's width, as a share of the window.
   *
   * Persisted because the split is a working preference, not a view state: a
   * therapist who widens the outline to read a long topic should not have to
   * drag it again on the next session. Bounded by utils/layout on read, since a
   * value written by a build with a different range must not be able to render
   * the pane off screen.
   */
  outlineWidthPercent: number;
}

/**
 * Why a selection changed.
 *
 * 'caret' is the cursor moving to a different topic, and it travels like the
 * rest: the client window should show where the therapist IS, not where they
 * were three seconds ago. It is a separate reason because it is a different
 * KIND of change — a deliberate click, a clear — and the code that sends it
 * treats a null differently (see handleSelectNode).
 */
export type SelectReason = 'caret' | 'click' | 'clear' | 'navigate';

export type SyncMessage =
  | { type: 'snapshot'; map: MindMap }
  | {
      type: 'draft';
      draft: {
        mode: 'add' | 'edit';
        parentId: string | null;
        targetId?: string | null;
        parentText?: string;
        text: string;
        active: boolean;
      };
    }
  | {
      type: 'select';
      selection: {
        nodeId: string | null;
        /** 'caret' never reaches here: it is local-only by design. */
        reason: SelectReason;
      };
    }
  | { type: 'pause'; paused: boolean }
  | { type: 'view_sync'; view: MindMapView }
  | { type: 'client_font_scale'; scale: number }
  | { type: 'focus_zoom_mode'; enabled: boolean }
  | { type: 'ping' }
  | { type: 'pong' }
  | { type: 'bye' };

export interface FlatOutlineItem {
  id: string;
  text: string;
  level: number;
  parentId: string | null;
  collapsed: boolean;
  hasChildren: boolean;
  childCount: number;
  indexInParent: number;
  node: MindMapNode;
}
