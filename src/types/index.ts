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
  focusDwellSeconds: number;
  autoFitOnAdd: boolean;
  clientFontScale: number;
  focusZoomMode: boolean; // Zoom in on active node + parents + children when navigating
  /**
   * Whether a topic can be re-parented to another branch (Alt+M to lift,
   * arrows to aim, Enter to drop).
   *
   * OFF by default, and not because the operation is unfinished — it is
   * covered by tree.test.ts. It is off because a structural move is the only
   * edit in the outline whose result the therapist cannot undo by typing: the
   * only way back is Ctrl+Z, which is a button the size of a fingerprint hit
   * away, and a client is watching the screen when it happens. Shipping it
   * behind a switch lets it be used in a live session by someone who has chosen
   * to accept that, and left off by everyone else.
   */
  enableNodeMove: boolean;
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
   * Which outline editor is in use.
   *
   * 'rows' is one focusable field per topic; 'markdown' is a single text
   * buffer whose indentation carries the hierarchy.
   *
   * This is a real trade, not a preference, and that is why it is a setting
   * rather than a decision made for the user:
   *
   *   rows     — every topic is its own field. Tab walks them natively, a
   *              screen reader announces one target per topic, and a keystroke
   *              can never change the shape of the tree by accident. Costs an
   *              input per node, and the focus bookkeeping that goes with it.
   *   markdown — cut, copy, paste and select across levels are the browser's
   *              own, so moving a whole branch needs no code at all. Costs the
   *              per-topic focus targets, and Tab has to be captured to indent,
   *              which takes it out of the browser's focus order.
   *
   * Both are complete. The mode in use is chosen per therapist, and both
   * projects the same tree to the same mind map.
   */
  outlineEditor: 'rows' | 'markdown';
}

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
        reason: 'focus3s' | 'click' | 'clear' | 'navigate';
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
