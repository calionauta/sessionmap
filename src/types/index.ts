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
