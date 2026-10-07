import React, { useState, useRef, useEffect } from 'react';
import {
  X,
  Plus,
  Search,
  Users,
  Layers,
  Trash2,
  Edit2,
  Check,
  ArrowRight,
  Download,
  Upload,
  Archive,
  ArchiveRestore,
  FolderArchive,
  AlertTriangle,
} from 'lucide-react';
import { Client, MindMap, Modality, SessionTemplate } from '../../types';
import {
  createNewSession,
  saveMap,
  saveClient,
  deleteMap,
  archiveClient,
  unarchiveClient,
  archiveMap,
  unarchiveMap,
  deleteClientAndSessions,
  deleteModalityAndClear,
  isArchived,
  loadModalities,
  persistModalities,
  loadTemplates,
  persistTemplates,
  clientModalityIds,
} from '../../services/storage';
import { countTotalNodes, parseMarkdownToTree } from '../../utils/tree';
import { formatSessionTimestamp } from '../../utils/text';
import { exportSessionMarkdown, exportClientSessionsZip, exportAllClientsZip } from '../../utils/export';
import { t } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';
import { Modal, ConfirmDialog } from '../ui/Modal';
import { ModalityBadge } from '../ui/ModalityBadge';
import { UndoToast } from '../ui/UndoToast';
import { EmptyState } from '../ui/EmptyState';
import { NewSessionDialog } from '../modals/NewSessionDialog';
import { CatalogPanel } from './CatalogPanel';

/**
 * A session whose clientId matches no client row.
 *
 * Extracted because the same markup was needed in two places, and the second
 * copy is exactly the one that never rendered: it sat inside the
 * `currentClient ? ... : ...` branch, so with no client selected the sessions
 * it listed were invisible — the state right after deleting the last client.
 */
function OrphanSessionCard({
  session,
  canDelete,
  onOpen,
  onDelete,
}: {
  session: MindMap;
  canDelete: boolean;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const lang = useLang();
  const nodeCount = countTotalNodes(session.root);
  const sessionLabel = session.sessionDate || session.title;
  return (
    <div className="p-3 rounded-panel border border-caution/40 bg-surface flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-bold text-content break-words">{sessionLabel}</div>
        <div className="text-[11px] text-content-muted font-medium mt-0.5 break-words">
          <span className="font-mono">
            {t(lang, nodeCount === 1 ? 'admin.orphan.nodes.one' : 'admin.orphan.nodes.many').replace('{n}', String(nodeCount))}
          </span>
          {' · '}{t(lang, 'admin.orphan.recordedAs')} <strong>{session.clientName || t(lang, 'admin.orphan.noName')}</strong> (id{' '}
          {session.clientId})
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={onOpen} className="ctl text-xs font-bold">
          <span>{t(lang, 'admin.orphan.open')}</span>
          <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={t(lang, 'admin.orphan.deleteSession').replace('{label}', sessionLabel)}
            className="ctl ctl-danger w-11 px-0"
          >
            <Trash2 className="w-4 h-4" aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}

interface AdminClientManagerProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  maps: MindMap[];
  activeMapId: string;
  activeClientId: string | null;
  onSelectSession: (map: MindMap) => void;
  /** Async: callers must await it before selecting, or the list is stale. */
  onRefreshData: () => void | Promise<void>;
  /**
   * Retained for API compatibility with the host view. Every colour in
   * this panel now resolves through the semantic token layer, so the
   * theme is no longer read here — swapping a hex for a token is what
   * makes the dark theme stop being a parallel set of literals.
   */
  theme: 'papel' | 'noite';
  /** Which room to open in. The new-session picker jumps here on demand. */
  defaultTab?: 'participantes' | 'catalogo';
}

export const AdminClientManager: React.FC<AdminClientManagerProps> = ({
  isOpen,
  onClose,
  clients,
  maps,
  activeMapId,
  activeClientId,
  onSelectSession,
  onRefreshData,
  defaultTab = 'participantes',
}) => {
  const [selectedClientId, setSelectedClientId] = useState<string>(() => {
    return activeClientId || (clients[0]?.id ?? '');
  });

  const [clientSearch, setClientSearch] = useState('');
  const [newClientName, setNewClientName] = useState('');
  const [isCreatingClient, setIsCreatingClient] = useState(false);

  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editingClientName, setEditingClientName] = useState('');
  const [isExporting, setIsExporting] = useState(false);
  const importFileInputRef = useRef<HTMLInputElement | null>(null);

  // Destructive actions: confirm, then keep a restorable window open.
  const [pendingClientDelete, setPendingClientDelete] = useState<Client | null>(null);
  const [pendingSessionDelete, setPendingSessionDelete] = useState<MindMap | null>(null);
  const [undoClientDeleteState, setUndoClientDeleteState] = useState<{
    client: Client;
    sessionCount: number;
    sessions: MindMap[];
  } | null>(null);
  const [pendingClientArchive, setPendingClientArchive] = useState<Client | null>(null);
  const [pendingSessionArchive, setPendingSessionArchive] = useState<MindMap | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [undoSessionDeleteState, setUndoSessionDeleteState] = useState<MindMap | null>(
    null
  );

  // Dismissing is the toast's own job now (it carries its timer, pause and
  // close button): the panel only holds the restorable records.

  // Kind + template picker for the next session. Resolved on CONFIRM, not on
  // open: the client row could change under the open dialog.
  const [pendingSessionFor, setPendingSessionFor] = useState<Client | null>(null);

  // The panel has two rooms: the client workflow, and the global catalog.
  // Kinds and templates belong to no client — filing them under one client's
  // history is what made them undiscoverable — so they get a tab at the same
  // level as the client list rather than a section inside one of its rows.
  const [panelTab, setPanelTab] = useState<'participantes' | 'catalogo'>(defaultTab);
  // The new-session picker can send the user to the catalog mid-flow; the
  // tab follows the request on open so the room matches the intent.
  React.useEffect(() => {
    if (isOpen) setPanelTab(defaultTab);
  }, [isOpen, defaultTab]);
  const lang = useLang();

  // The catalog lives here (state) and in storage (persisted): the dialog and
  // the badges read this state, so an edit applies everywhere at once.
  const [modalities, setModalities] = useState<Modality[]>(() => loadModalities());
  const [templates, setTemplates] = useState<SessionTemplate[]>(() => loadTemplates());
  const [pendingModalityDelete, setPendingModalityDelete] = useState<Modality | null>(null);
  const [modalityFilter, setModalityFilter] = useState<string>('all');

  // The catalog has no live cross-tab sync by design (localStorage has no
  // subscription for the writer's own tab, and polling a config screen is
  // churn): reloading on open is the sync point, same as the session
  // dialog and the drawer already do.
  React.useEffect(() => {
    if (!isOpen) return;
    setModalities(loadModalities());
    setTemplates(loadTemplates());
  }, [isOpen]);

  // Re-syncs the selection when the list changes underneath it (a client was
  // just created, deleted or restored elsewhere). Only fires when the
  // selected id is ABSENT, so it never yanks the user off the client they
  // are browsing. Must sit before the early return: hooks cannot be
  // conditional.
  React.useEffect(() => {
    if (!isOpen) return;
    if (selectedClientId && clients.some((c) => c.id === selectedClientId)) return;
    if (activeClientId && clients.some((c) => c.id === activeClientId)) {
      setSelectedClientId(activeClientId);
    } else if (clients.length > 0) {
      setSelectedClientId(clients[0].id);
    }
  }, [isOpen, clients, activeClientId, selectedClientId]);

  if (!isOpen) return null;

  // Archived clients and their sessions are excluded from the working lists.
  // An archived client's sessions are archived too, so filtering sessions by
  // the current client's own flag is equivalent to filtering by the map flag
  // and cannot drift from it.
  const activeClients = clients.filter((c) => !isArchived(c));
  const archivedClients = clients.filter((c) => isArchived(c));
  const scopedClients = showArchived ? archivedClients : activeClients;
  const searchTerm = clientSearch.toLowerCase();
  const filteredClients = scopedClients.filter((c) =>
    c.name.toLowerCase().includes(searchTerm)
  );

  // Prefer the selected client, but only within the view actually being shown.
  // Falling back across scopes used to jump the selection to a different person
  // when the selected one was filtered out, which reads as the history having
  // emptied itself.
  const currentClient =
    scopedClients.find((c) => c.id === selectedClientId) || scopedClients[0] || null;

  const clientSessions = maps
    .filter((m) => m.clientId === currentClient?.id)
    .filter((m) => (showArchived ? isArchived(m) : !isArchived(m)))
    .filter((m) =>
      modalityFilter === 'all'
        ? true
        : modalityFilter === 'none'
          ? !m.modalityId
          : m.modalityId === modalityFilter
    )
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  /**
   * Sessions whose clientId matches no client row.
   *
   * These used to be invisible everywhere: the per-client history filters on
   * clientId, so a session recorded against a client that was renamed,
   * removed or — as was the actual bug — never matched (every new session was
   * filed under clients[0]) appeared in no list at all while still counting
   * towards the "N participantes" export totals.
   *
   * Surfacing them is better than hiding them: a session nobody can see is
   * indistinguishable from a lost one, and in this app that is clinical data.
   */
  const orphanedMaps = maps.filter(
    (m) => !clients.some((c) => c.id === m.clientId)
  );

  // Import Markdown file directly as a new session for current client
  const handleImportSessionFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !currentClient) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const text = evt.target?.result as string;
      if (text) {
        const rootNode = parseMarkdownToTree(text, file.name.replace(/\.[^/.]+$/, ''));
        const timestamp = formatSessionTimestamp();
        const newSession: MindMap = {
          schema: 1,
          id: `m_${Date.now().toString(36)}`,
          clientId: currentClient.id,
          clientName: currentClient.name,
          sessionDate: timestamp,
          title: rootNode.text || timestamp,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          root: rootNode,
          view: { zoom: 1, x: 0, y: 0 },
        };
        await saveMap(newSession);
        await onRefreshData();
        onSelectSession(newSession);
        onClose();
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Export current client sessions zipped
  const handleExportCurrentClientZip = async () => {
    if (!currentClient) return;
    try {
      setIsExporting(true);
      await exportClientSessionsZip(currentClient.name, clientSessions);
    } finally {
      setIsExporting(false);
    }
  };

  // Export all clients zipped
  const handleExportAllClientsZip = async () => {
    try {
      setIsExporting(true);
      await exportAllClientsZip(clients, maps);
    } finally {
      setIsExporting(false);
    }
  };

  // Create new client
  const handleSaveNewClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;

    const newClient: Client = {
      id: `c_${Date.now().toString(36)}`,
      name: newClientName.trim(),
      createdAt: new Date().toISOString(),
    };

    await saveClient(newClient);
    setNewClientName('');
    setIsCreatingClient(false);
    setSelectedClientId(newClient.id);
    // Awaited: selecting or creating a session right after must see the new
    // row, otherwise it falls back to another client and the session is
    // filed under the wrong person.
    await onRefreshData();
  };

  // Create new session for current client — via the kind + template picker.
  // The record is built on CONFIRM so the picked kind and skeleton land on
  // it directly, instead of creating a blank session and patching it after.
  const handleConfirmNewSession = async (
    modalityId: string | null,
    template: SessionTemplate | null
  ) => {
    const target = pendingSessionFor;
    setPendingSessionFor(null);
    if (!target) return;
    const newSession = createNewSession(target.id, target.name, {
      modalityId,
      templateMarkdown: template?.markdown ?? null,
    });
    await saveMap(newSession);
    await onRefreshData();
    onSelectSession(newSession);
    onClose();
  };

  // Reclassifies one session. The client row's union updates on its own —
  // it is derived, never stored — so there is nothing else to write.
  const handleSessionModality = async (session: MindMap, modalityId: string | null) => {
    if ((session.modalityId ?? null) === modalityId) return;
    await saveMap({ ...session, modalityId });
    await onRefreshData();
  };

  const confirmModalityDelete = async () => {
    const target = pendingModalityDelete;
    setPendingModalityDelete(null);
    if (!target) return;
    // Sessions keep existing as "sem tipo": the record stays, the label goes.
    await deleteModalityAndClear(target.id);
    setModalities(loadModalities());
    if (modalityFilter === target.id) setModalityFilter('all');
    await onRefreshData();
  };

  // Rename client
  const handleRenameClient = async (clientId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClientName.trim()) return;

    const c = clients.find((x) => x.id === clientId);
    if (c) {
      await saveClient({ ...c, name: editingClientName.trim() });
      setEditingClientId(null);
      await onRefreshData();
    }
  };

  // Delete client — routed through a real dialog with a restorable
  // window. A native window.confirm() cannot be styled, is announced
  // inconsistently, and offers no way back from deleting a client's
  // entire session history.
  // Deleting a client must take their sessions with it, otherwise the
  // sessions are orphaned: no client row owns them, but they still render in
  // the session list and consume storage.
  const confirmClientDelete = async () => {
    const target = pendingClientDelete;
    setPendingClientDelete(null);
    if (!target) return;
    // Snapshot every session up front: the undo path needs them back, and
    // deleteClientAndSessions does not return them.
    const ownSessions = maps.filter((m) => m.clientId === target.id);
    await deleteClientAndSessions(target.id);
    const remaining = clients.filter((c) => c.id !== target.id);
    if (remaining.length > 0) {
      setSelectedClientId(remaining[0].id);
    }
    await onRefreshData();
    setUndoClientDeleteState({
      client: target,
      sessionCount: ownSessions.length,
      sessions: ownSessions,
    });
  };

  const handleDeleteClient = (client: Client) => {
    setPendingClientDelete(client);
  };

  // Archive a client: hides them and their sessions, deletes nothing. The
  // storage layer stamps both so the two can never disagree.
  const confirmClientArchive = async () => {
    const target = pendingClientArchive;
    setPendingClientArchive(null);
    if (!target) return;
    await archiveClient(target.id);
    await onRefreshData();
    const remaining = clients.filter((c) => c.id !== target.id);
    if (remaining.length > 0 && selectedClientId === target.id) {
      setSelectedClientId(remaining[0].id);
    }
  };

  const handleArchiveClient = (client: Client) => {
    setPendingClientArchive(client);
  };

  const handleUnarchiveClient = async (client: Client) => {
    await unarchiveClient(client.id);
    await onRefreshData();
  };

  // Archive a single session, leaving its client active. Restoring is one
  // field write, and neither path touches the client record.
  const confirmSessionArchive = async () => {
    const target = pendingSessionArchive;
    setPendingSessionArchive(null);
    if (!target) return;
    await archiveMap(target.id);
    await onRefreshData();
  };

  const handleUnarchiveSession = async (session: MindMap) => {
    await unarchiveMap(session.id);
    await onRefreshData();
  };

  // Delete session
  const confirmSessionDelete = async () => {
    const target = pendingSessionDelete;
    setPendingSessionDelete(null);
    if (!target) return;
    await deleteMap(target.id);
    await onRefreshData();
    setUndoSessionDeleteState(target);
  };

  const handleDeleteSession = (session: MindMap) => {
    setPendingSessionDelete(session);
  };

  // Undo paths — restoration is possible because both records are held
  // in memory for the life of the open dialog.
  const handleUndoClientDelete = async () => {
    const target = undoClientDeleteState;
    setUndoClientDeleteState(null);
    if (!target) return;
    // The sessions went down with the client (deleteClientAndSessions), so
    // bringing back the row alone orphaned-then-hid them: the undo toast
    // promised a restore and delivered half of one. Both come back.
    await saveClient(target.client);
    for (const s of target.sessions) {
      await saveMap(s);
    }
    setSelectedClientId(target.client.id);
    await onRefreshData();
  };

  const handleUndoSessionDelete = async () => {
    const target = undoSessionDeleteState;
    setUndoSessionDeleteState(null);
    if (!target) return;
    await saveMap(target);
    await onRefreshData();
  };

  return (
    <>
      {/* The overlay chrome (backdrop, header, close button, dialog
          role, Escape, focus trap and focus restore) belongs to Modal.
          What is left here is only this panel's own layout. */}
      <Modal
        isOpen={isOpen}
        onClose={onClose}
        title={t(lang, 'admin.title')}
        description={t(lang, 'admin.subtitle')}
        icon={<Users className="w-5 h-5" />}
        maxWidth="max-w-4xl"
      >
        {/* -m-6 cancels the Modal body padding so the two columns can
            reach the panel edge and own their own scroll areas.

            RESPONSIVE: the split is a row only from `md` (768px) up.
            Below that the two panes stack — clients on top, sessions
            underneath — and each is bounded by a max-height instead of
            the fixed 70vh row, so a long action bar can never be
            clipped by an `overflow-hidden` parent. A 288px fixed left
            column inside a 375px viewport left ~39px for the session
            list, which is not a layout, it is a rendering error.
            Stacking (rather than a drawer or a <select>) keeps search,
            rename and per-client delete reachable, which a collapsed
            picker would have to re-implement. */}
        {/* Two rooms, one panel: the participant workflow, and the global catalog.
            The catalog configures every participant at once, so it sits beside
            the participant list rather than inside one participant's history.
            Full-bleed sides only (-mx-6): a negative TOP margin inside this
            scrollable body clips under the header, which is exactly the cut
            this tab bar used to show. */}
        <div
          className="-mx-6 px-6 pt-1 pb-3 border-b border-line bg-surface"
          role="tablist"
          aria-label={t(lang, 'admin.tabs.label')}
        >
          <div className="flex p-1 bg-surface-inset rounded-xl border border-line">
            {(
              [
                { key: 'participantes' as const, label: t(lang, 'admin.tabs.participants').replace('{n}', String(scopedClients.length)) },
                { key: 'catalogo' as const, label: t(lang, 'admin.tabs.catalog') },
              ]
            ).map((tab) => (
              <button
                key={tab.key}
                type="button"
                role="tab"
                aria-selected={panelTab === tab.key}
                tabIndex={panelTab === tab.key ? 0 : -1}
                onClick={() => setPanelTab(tab.key)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setPanelTab(tab.key === 'participantes' ? 'catalogo' : 'participantes');
                  }
                }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  panelTab === tab.key
                    ? 'bg-surface-raised text-content shadow-xs'
                    : 'text-content-muted hover:text-content'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
        {panelTab === 'participantes' && (
        <div className="-mx-6 -mb-6 flex flex-col md:flex-row md:h-[70vh] overflow-hidden">
          {/* Left Column: Client List */}
          <div className="w-full md:w-72 md:shrink-0 min-h-0 max-h-[40vh] md:max-h-none border-b md:border-b-0 md:border-r border-line flex flex-col bg-surface-sunken">
            {/* Search and + Client button */}
            <div className="p-3 border-b border-line space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-content uppercase tracking-wider">
                  {t(lang, 'admin.list.title').replace('{n}', String(scopedClients.length))}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCreatingClient(true)}
                  className="ctl ctl-primary px-2.5 text-xs font-bold"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t(lang, 'admin.list.new')}</span>
                </button>
              </div>

              {/* Active / Archived switch, mirroring the session drawer so
                  both surfaces expose the archive the same way. */}
              <div
                role="tablist"
                aria-label={t(lang, 'admin.list.scope')}
                className="flex p-1 bg-surface-inset rounded-xl border border-line"
              >
                {(
                  [
                    { key: false, label: t(lang, 'admin.list.active'), count: activeClients.length },
                    { key: true, label: t(lang, 'admin.list.archived'), count: archivedClients.length },
                  ] as const
                ).map((tab) => (
                  <button
                    key={String(tab.key)}
                    type="button"
                    role="tab"
                    aria-selected={showArchived === tab.key}
                    tabIndex={showArchived === tab.key ? 0 : -1}
                    onClick={() => setShowArchived(tab.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        setShowArchived(!tab.key);
                      }
                    }}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      showArchived === tab.key
                        ? 'bg-surface-raised text-content shadow-xs'
                        : 'text-content-muted hover:text-content'
                    }`}
                  >
                    {tab.label}
                    <span className="ml-1.5 font-mono text-[10px] opacity-70">
                      {tab.count}
                    </span>
                  </button>
                ))}
              </div>

              {isCreatingClient && (
                <form onSubmit={handleSaveNewClient} className="flex items-center gap-2 pt-1">
                  <label htmlFor="admin-new-client-name" className="sr-only">
                    {t(lang, 'admin.list.newNameLabel')}
                  </label>
                  <input
                    id="admin-new-client-name"
                    autoFocus
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder={t(lang, 'admin.list.newNamePlaceholder')}
                    className="flex-1 min-w-0 h-11 px-3 text-sm rounded-control border border-line bg-surface-raised text-content font-medium placeholder:text-content-subtle"
                  />
                  <button
                    type="submit"
                    className="ctl ctl-primary w-11 px-0"
                    title={t(lang, 'admin.list.confirm')}
                    aria-label={t(lang, 'admin.list.confirmNew')}
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingClient(false)}
                    className="ctl w-11 px-0"
                    aria-label={t(lang, 'admin.list.cancelNew')}
                    title={t(lang, 'admin.list.cancel')}
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </form>
              )}

              <div className="relative flex items-center">
                <label htmlFor="admin-client-search" className="sr-only">
                  {t(lang, 'admin.list.searchLabel')}
                </label>
                <Search
                  className="w-4 h-4 absolute left-3 text-content-muted pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  id="admin-client-search"
                  type="text"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder={t(lang, 'admin.list.searchPlaceholder')}
                  className="w-full h-11 pl-10 pr-3 text-sm rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle"
                />
              </div>
            </div>

            {/* Clients Scrollable List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
              {filteredClients.length === 0 ? (
                <EmptyState
                  actionLabel={t(lang, 'admin.list.emptyAction')}
                  onAction={() => setIsCreatingClient(true)}
                >
                  {t(lang, 'admin.list.empty')}
                </EmptyState>
              ) : (
                filteredClients.map((client) => {
                  const isSelected = client.id === currentClient?.id;
                  const archived = isArchived(client);
                  const count = maps.filter(
                    (m) =>
                      m.clientId === client.id && (archived ? isArchived(m) : !isArchived(m))
                  ).length;

                  return (
                    <div
                      key={client.id}
                      className={`flex items-center gap-1 p-1.5 rounded-panel border transition-colors ${
                        isSelected
                          ? 'bg-accent-soft border-2 border-content'
                          : 'border border-transparent hover:border-line hover:bg-surface-inset'
                      }`}
                    >
                      {/* Selection is a real button, sibling to the row
                          actions, so it is keyboard reachable and no
                          control is ever nested inside another. */}
                      {editingClientId === client.id ? (
                        <form
                          onSubmit={(e) => handleRenameClient(client.id, e)}
                          className="flex-1 min-w-0 flex items-center gap-1"
                        >
                          <label
                            htmlFor={`admin-rename-${client.id}`}
                            className="sr-only"
                          >
                            {t(lang, 'admin.list.renameOf').replace('{name}', client.name)}
                          </label>
                          <input
                            id={`admin-rename-${client.id}`}
                            autoFocus
                            type="text"
                            value={editingClientName}
                            onChange={(e) => setEditingClientName(e.target.value)}
                            className="flex-1 min-w-0 h-11 px-2.5 text-sm rounded-control border border-line bg-surface-raised text-content"
                          />
                          <button
                            type="submit"
                            className="ctl ctl-primary w-11 px-0"
                            aria-label={t(lang, 'admin.list.confirmRenameOf').replace('{name}', client.name)}
                          >
                            <Check className="w-4 h-4" aria-hidden="true" />
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSelectedClientId(client.id)}
                          aria-current={isSelected ? 'true' : undefined}
                          className="flex-1 min-w-0 text-left px-1 py-1.5 min-h-11 rounded-control"
                        >
                          <div
                            className={`text-xs break-words leading-snug text-content ${
                              isSelected ? 'font-extrabold' : 'font-semibold'
                            }`}
                          >
                            {client.name}
                          </div>
                          <div
                            className={`text-[11px] font-mono mt-0.5 ${
                              isSelected
                                ? 'text-accent-text font-bold'
                                : 'text-content-muted font-medium'
                            }`}
                          >
                            {t(lang, count === 1 ? 'admin.list.sessions.one' : 'admin.list.sessions.many').replace('{n}', String(count))}
                          </div>
                          {/* The union of this client's sessions' kinds.
                              Derived, never stored: a client who takes up a
                              second kind grows a second badge on its own, and
                              no client is ever filed in one drawer. */}
                          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-1">
                            {clientModalityIds(maps, client.id).map((id) => {
                              const mod = modalities.find((m) => m.id === id);
                              if (!mod) return null;
                              return <ModalityBadge key={id} modality={mod} />;
                            })}
                          </div>
                        </button>
                      )}

                      {/* Always visible: with hover-only opacity these
                          were unreachable by keyboard and by touch. */}
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingClientId(client.id);
                            setEditingClientName(client.name);
                          }}
                          aria-label={t(lang, 'admin.list.renameOf').replace('{name}', client.name)}
                          className="ctl w-11 px-0"
                        >
                          <Edit2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                        {archived ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleUnarchiveClient(client)}
                              aria-label={t(lang, 'admin.list.restore').replace('{name}', client.name)}
                              title={t(lang, 'admin.list.restoreTitle')}
                              className="ctl w-11 px-0"
                            >
                              <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClient(client)}
                              aria-label={t(lang, 'admin.list.deleteAll').replace('{name}', client.name)}
                              title={t(lang, 'admin.list.deleteAllTitle')}
                              className="ctl ctl-danger w-11 px-0"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => handleArchiveClient(client)}
                              aria-label={t(lang, 'admin.list.archiveAll').replace('{name}', client.name)}
                              title={t(lang, 'admin.list.archiveAllTitle')}
                              className="ctl w-11 px-0"
                            >
                              <Archive className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClient(client)}
                              aria-label={t(lang, 'admin.list.delete').replace('{name}', client.name)}
                              title={t(lang, 'admin.list.deleteAllTitle')}
                              className="ctl ctl-danger w-11 px-0"
                            >
                              <Trash2 className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Left Column Footer: Export All Clients ZIP */}
            <div className="p-3 border-t border-line bg-surface">
              <button
                type="button"
                onClick={handleExportAllClientsZip}
                disabled={isExporting}
                title={t(lang, 'admin.list.exportAllTitle')}
                className="ctl w-full text-xs font-bold shadow-2xs"
              >
                <FolderArchive className="w-3.5 h-3.5 text-positive shrink-0" aria-hidden="true" />
                <span className="text-left leading-snug">
                  {isExporting ? t(lang, 'admin.list.exporting') : t(lang, 'admin.list.exportAll')}
                </span>
              </button>
            </div>
          </div>

          {/* Right Column: Sessions for Selected Client.
              Stacked below `md` the column scrolls as a whole and the
              list inside it does not, so a phone gets one predictable
              scroll region per pane instead of a nested one. From `md`
              up it is a fixed-height pane whose list scrolls on its
              own, as before. */}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col bg-surface-raised max-h-[46vh] md:max-h-none overflow-y-auto md:overflow-hidden">
            {currentClient ? (
              <>
                {/* Client Session Actions Bar */}
                <div className="p-4 sm:p-5 border-b border-line flex items-center justify-between gap-3 flex-wrap shrink-0">
                  <div className="min-w-0">
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-accent-text">
                      {t(lang, 'admin.detail.selected')}
                    </span>
                    <h3 className="text-xl font-black tracking-tight text-content break-words">
                      {currentClient.name}
                    </h3>
                  </div>

                  {/* Stacked full-width below `sm`; the three labels total
                      ~380px and would have overflowed a 375px viewport. */}
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
                    {/* Hidden file input for importing Markdown directly */}
                    <input
                      ref={importFileInputRef}
                      type="file"
                      accept=".md,.markdown,.txt"
                      onChange={handleImportSessionFile}
                      className="hidden"
                    />

                    {/* Export Current Client Sessions ZIP */}
                    <button
                      type="button"
                      onClick={handleExportCurrentClientZip}
                      disabled={isExporting}
                      aria-label={t(lang, 'admin.detail.exportZipOf')
                        .replace('{n}', String(clientSessions.length))
                        .replace('{name}', currentClient.name)}
                      title={t(lang, 'admin.detail.exportZipTitle')
                        .replace('{n}', String(clientSessions.length))
                        .replace('{name}', currentClient.name)}
                      className="ctl w-full sm:w-auto text-xs font-bold shadow-2xs"
                    >
                      <Archive className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden="true" />
                      <span>{t(lang, 'admin.detail.exportZip')}</span>
                    </button>

                    {/* Import Markdown file */}
                    <button
                      type="button"
                      onClick={() => importFileInputRef.current?.click()}
                      aria-label={t(lang, 'admin.detail.importLabel')}
                      title={t(lang, 'admin.detail.importLabel')}
                      className="ctl w-full sm:w-auto text-xs font-bold shadow-2xs text-accent-text"
                    >
                      <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{t(lang, 'admin.detail.import')}</span>
                    </button>

                    {/* Create New Session */}
                    <button
                      type="button"
                      onClick={() => currentClient && setPendingSessionFor(currentClient)}
                      className="ctl ctl-primary w-full sm:w-auto text-xs font-bold shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{t(lang, 'admin.detail.newSession')}</span>
                    </button>
                  </div>
                </div>

                {/* Sessions List. Scrolls on its own only once the pane
                    is a fixed-height column; stacked, the pane owns
                    the scroll. */}
                <div className="flex-1 min-h-0 p-4 sm:p-5 space-y-3 overflow-visible md:overflow-y-auto">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider">
                      {t(lang, 'admin.detail.history').replace('{n}', String(clientSessions.length))}
                    </h3>
                    {modalities.length > 0 && (
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-content-muted">
                        <span className="sr-only">{t(lang, 'admin.detail.filterType')}</span>
                        <select
                          value={modalityFilter}
                          onChange={(e) => setModalityFilter(e.target.value)}
                          aria-label={t(lang, 'admin.detail.filterSessions')}
                          className="h-9 px-2 text-[11px] rounded-control border border-line bg-surface text-content font-bold"
                        >
                          <option value="all">{t(lang, 'maplist.filter.all')}</option>
                          {modalities.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                          <option value="none">{t(lang, 'common.noType')}</option>
                        </select>
                      </label>
                    )}
                  </div>

                  {clientSessions.length === 0 ? (
                    <EmptyState
                      actionLabel={t(lang, 'admin.detail.emptyAction')}
                      onAction={() => currentClient && setPendingSessionFor(currentClient)}
                    >
                      {t(lang, 'admin.detail.empty')}
                    </EmptyState>
                  ) : (
                    clientSessions.map((session) => {
                      const isActive = session.id === activeMapId;
                      const nodeCount = countTotalNodes(session.root);
                      const sessionLabel = session.sessionDate || session.title;

                      return (
                        <div
                          key={session.id}
                          className={`p-4 rounded-panel border transition-colors flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4 ${
                            isActive
                              ? 'bg-accent-soft border-2 border-content shadow-sm'
                              : 'bg-surface-raised border border-line hover:border-line-muted hover:bg-surface-sunken shadow-2xs'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono font-bold text-sm text-content break-words">
                                {sessionLabel}
                              </span>
                              {isActive && (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded bg-accent text-content-onaccent uppercase tracking-wide shrink-0">
                                  {t(lang, 'admin.detail.activeBadge')}
                                </span>
                              )}
                            </div>

                            {/* Wraps instead of truncating: at 200% zoom a
                                clipped session root is unreadable, and the
                                root line is the only description the card
                                has. */}
                            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1.5 text-xs text-content-muted font-medium">
                              <span className="flex items-center gap-1 font-mono shrink-0">
                                <Layers className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
                                <span>{t(lang, nodeCount === 1 ? 'admin.orphan.nodes.one' : 'admin.orphan.nodes.many').replace('{n}', String(nodeCount))}</span>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="min-w-0 break-words">{t(lang, 'admin.detail.root').replace('{t}', session.root.text)}</span>
                            </div>

                            {/* One kind per session, changeable after the
                                fact: a session that started as mentoring
                                and turned into therapy is reclassified,
                                not recreated. */}
                            <div className="flex items-center gap-2 flex-wrap mt-2">
                              <ModalityBadge
                                modality={modalities.find((m) => m.id === session.modalityId) ?? null}
                              />
                              <label className="flex items-center gap-1.5">
                                <span className="sr-only">
                                  {t(lang, 'admin.detail.sessionTypeOf').replace('{label}', sessionLabel)}
                                </span>
                                <select
                                  value={session.modalityId ?? ''}
                                  onChange={(e) =>
                                    void handleSessionModality(session, e.target.value || null)
                                  }
                                  className="h-9 px-2 text-[11px] rounded-control border border-line bg-surface text-content font-bold"
                                >
                                  <option value="">{t(lang, 'common.noType')}</option>
                                  {modalities.map((m) => (
                                    <option key={m.id} value={m.id}>
                                      {m.name}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 flex-wrap shrink-0">
                            {/* Download Single Session Markdown Button */}
                            <button
                              type="button"
                              onClick={() => exportSessionMarkdown(session)}
                              aria-label={t(lang, 'admin.detail.downloadMd').replace('{label}', sessionLabel)}
                              title={t(lang, 'admin.detail.downloadMdTitle')}
                              className="ctl w-11 px-0"
                            >
                              <Download className="w-3.5 h-3.5" aria-hidden="true" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                onSelectSession(session);
                                onClose();
                              }}
                              className={`ctl text-xs font-bold ${
                                isActive ? 'ctl-primary' : ''
                              }`}
                            >
                              <span>{isActive ? t(lang, 'admin.detail.continue') : t(lang, 'admin.detail.openSession')}</span>
                              <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            </button>

                            {isArchived(session) ? (
                              <button
                                type="button"
                                onClick={() => handleUnarchiveSession(session)}
                                aria-label={t(lang, 'admin.detail.restoreSession').replace('{label}', sessionLabel)}
                                title={t(lang, 'admin.detail.restoreSessionTitle')}
                                className="ctl w-11 px-0"
                              >
                                <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPendingSessionArchive(session)}
                                aria-label={t(lang, 'admin.detail.archiveSession').replace('{label}', sessionLabel)}
                                title={t(lang, 'admin.detail.archiveSessionTitle')}
                                className="ctl w-11 px-0"
                              >
                                <Archive className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}

                            {clientSessions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSession(session)}
                                aria-label={t(lang, 'admin.detail.deleteSession').replace('{label}', sessionLabel)}
                                className="ctl ctl-danger w-11 px-0"
                              >
                                <Trash2 className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}

                  {/* Sessions that belong to no client row. Shown rather than
                      hidden: a session nobody can see is indistinguishable
                      from a lost one. Each is a real card with the same
                      actions, so it can be opened, archived or deleted. */}
                  {orphanedMaps.length > 0 && (
                    <div className="pt-2 mt-2 border-t border-line">
                      <h3 className="text-xs font-bold text-caution uppercase tracking-wider flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                        {t(lang, 'admin.detail.orphanTitle').replace('{n}', String(orphanedMaps.length))}
                      </h3>
                      <p className="text-[11px] text-content-muted font-medium mt-1 mb-3">
                        {t(lang, 'admin.detail.orphanBody')}
                      </p>
                      <div className="space-y-2">
                        {orphanedMaps.map((session) => (
                          <OrphanSessionCard
                            key={session.id}
                            session={session}
                            canDelete={orphanedMaps.length > 1}
                            onOpen={() => {
                              onSelectSession(session);
                              onClose();
                            }}
                            onDelete={() => handleDeleteSession(session)}
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              /* No client selected. Orphaned sessions are shown here too —
                 they used to live only inside the currentClient branch, so
                 with no client at all (exactly the state right after
                 deleting the last one) this pane said "select a client" while
                 the sessions it was hiding stayed on disk. */
              <div className="flex-1 min-h-0 p-4 sm:p-5 space-y-3 overflow-visible md:overflow-y-auto">
                <EmptyState
                  actionLabel={clients.length === 0 ? t(lang, 'admin.detail.noClientsAction') : undefined}
                  onAction={clients.length === 0 ? () => setIsCreatingClient(true) : undefined}
                >
                  {clients.length === 0
                    ? t(lang, 'admin.detail.noClients')
                    : t(lang, 'admin.detail.selectClient')}
                </EmptyState>

                {orphanedMaps.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-line">
                    <h3 className="text-xs font-bold text-caution uppercase tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      {t(lang, 'admin.detail.orphanTitle').replace('{n}', String(orphanedMaps.length))}
                    </h3>
                    <p className="text-[11px] text-content-muted font-medium mt-1 mb-3">
                      {t(lang, 'admin.detail.orphanBody')}
                    </p>
                    <div className="space-y-2">
                      {orphanedMaps.map((session) => (
                        <OrphanSessionCard
                          key={session.id}
                          session={session}
                          canDelete={orphanedMaps.length > 1}
                          onOpen={() => {
                            onSelectSession(session);
                            onClose();
                          }}
                          onDelete={() => handleDeleteSession(session)}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
        )}
        {panelTab === 'catalogo' && (
          /* Normal flow, no inner scroll prison: the modal body already
             scrolls, and a fixed-height box with its own scroller is what
             rendered the tab as "blank until scrolled". */
          <div className="-mx-6 -mb-6 px-4 sm:px-5 py-4">
            <CatalogPanel
              modalities={modalities}
              templates={templates}
              maps={maps}
              onModalitiesChange={(next) => {
                setModalities(next);
                persistModalities(next);
              }}
              onTemplatesChange={(next) => {
                setTemplates(next);
                persistTemplates(next);
              }}
              onDeleteModalityRequest={setPendingModalityDelete}
            />
          </div>
        )}
      </Modal>

      {/* Destructive confirmations replace window.confirm(): styled,
          announced, and paired with a restorable window below. They are
          siblings of the panel, not children — a confirmation nested
          inside a focus trap is unreachable. */}
      <NewSessionDialog
        isOpen={pendingSessionFor !== null}
        onClose={() => setPendingSessionFor(null)}
        clientName={pendingSessionFor?.name ?? t(lang, 'admin.detail.fallbackName')}
        defaultModalityId={
          (pendingSessionFor &&
            maps.find(
              (m) => m.clientId === pendingSessionFor.id && m.modalityId
            )?.modalityId) ??
          null
        }
        onConfirm={(modalityId, template) => void handleConfirmNewSession(modalityId, template)}
        // The picker names the catalog's room instead of leaving the user
        // to guess where types live: closing the picker and landing on the
        // catalog tab keeps one modal on screen and the intent intact.
        onOpenCatalog={() => {
          setPendingSessionFor(null);
          setPanelTab('catalogo');
        }}
      />
      <ConfirmDialog
        isOpen={pendingModalityDelete !== null}
        title={t(lang, 'admin.confirm.deleteType.title')}
        isDestructive
        confirmLabel={t(lang, 'admin.confirm.deleteType.confirm')}
        cancelLabel={t(lang, 'admin.confirm.deleteType.keep')}
        onCancel={() => setPendingModalityDelete(null)}
        onConfirm={() => void confirmModalityDelete()}
        description={
          pendingModalityDelete ? (
            <>
              <p>
                {t(lang, 'admin.confirm.deleteType.bodyA')} <strong>{pendingModalityDelete.name}</strong>{' '}
                {t(lang, 'admin.confirm.deleteType.bodyB')}{' '}
                <strong>
                  {t(
                    lang,
                    maps.filter((m) => m.modalityId === pendingModalityDelete.id).length === 1
                      ? 'admin.confirm.count.one'
                      : 'admin.confirm.count.many'
                  ).replace(
                    '{n}',
                    String(maps.filter((m) => m.modalityId === pendingModalityDelete.id).length)
                  )}
                </strong>{' '}
                {t(lang, 'admin.confirm.deleteType.bodyC')}
              </p>
              <p className="mt-2 text-content-subtle">
                {t(lang, 'admin.confirm.deleteType.bodyD')}
              </p>
            </>
          ) : null
        }
      />
      <ConfirmDialog
        isOpen={pendingClientDelete !== null}
        title={t(lang, 'admin.confirm.deleteClient.title')}
        isDestructive
        confirmLabel={t(lang, 'admin.confirm.deleteClient.confirm')}
        cancelLabel={t(lang, 'admin.confirm.deleteClient.cancel')}
        onCancel={() => setPendingClientDelete(null)}
        onConfirm={confirmClientDelete}
        description={
          pendingClientDelete ? (
            <>
              <p>
                <strong>{pendingClientDelete.name}</strong> {t(lang, 'admin.confirm.deleteClient.and')}{' '}
                <strong>
                  {t(
                    lang,
                    maps.filter((m) => m.clientId === pendingClientDelete.id).length === 1
                      ? 'admin.confirm.count.one'
                      : 'admin.confirm.count.many'
                  ).replace(
                    '{n}',
                    String(maps.filter((m) => m.clientId === pendingClientDelete.id).length)
                  )}
                </strong>{' '}
                {maps.filter((m) => m.clientId === pendingClientDelete.id).length === 1
                  ? t(lang, 'admin.confirm.deleteClient.willRemove.one')
                  : t(lang, 'admin.confirm.deleteClient.willRemove.many')}{' '}
                {t(lang, 'admin.confirm.deleteClient.tail')}
              </p>
              <p className="mt-2 text-content-subtle">
                {t(lang, 'admin.confirm.deleteClient.undo')}
              </p>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        isOpen={pendingClientArchive !== null}
        title={t(lang, 'admin.confirm.archiveClient.title')}
        confirmLabel={t(lang, 'admin.confirm.archiveClient.confirm')}
        cancelLabel={t(lang, 'admin.confirm.archiveClient.keep')}
        onCancel={() => setPendingClientArchive(null)}
        onConfirm={confirmClientArchive}
        description={
          pendingClientArchive ? (
            <>
              <p>
                <strong>{pendingClientArchive.name}</strong> {t(lang, 'admin.confirm.deleteClient.and')}{' '}
                <strong>
                  {t(
                    lang,
                    maps.filter((m) => m.clientId === pendingClientArchive.id).length === 1
                      ? 'admin.confirm.count.one'
                      : 'admin.confirm.count.many'
                  ).replace(
                    '{n}',
                    String(maps.filter((m) => m.clientId === pendingClientArchive.id).length)
                  )}
                </strong>{' '}
                {t(lang, 'admin.confirm.archiveClient.tail')}
              </p>
              <p className="mt-2 text-content-subtle">
                {t(lang, 'admin.confirm.archiveClient.note')}
              </p>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        isOpen={pendingSessionArchive !== null}
        title={t(lang, 'admin.confirm.archiveSession.title')}
        confirmLabel={t(lang, 'admin.confirm.archiveSession.confirm')}
        cancelLabel={t(lang, 'admin.confirm.archiveSession.keep')}
        onCancel={() => setPendingSessionArchive(null)}
        onConfirm={confirmSessionArchive}
        description={
          pendingSessionArchive ? (
            <>
              <p>
                {t(lang, 'maplist.sessionOf')} <strong>{pendingSessionArchive.clientName}</strong>{' '}
                {t(lang, 'maplist.sessionOn')}{' '}
                <strong>
                  {pendingSessionArchive.sessionDate || pendingSessionArchive.title}
                </strong>{' '}
                {t(lang, 'admin.confirm.archiveSession.tail')}
              </p>
              <p className="mt-2 text-content-subtle">
                {t(lang, 'admin.confirm.archiveSession.note')}
              </p>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        isOpen={pendingSessionDelete !== null}
        title={t(lang, 'admin.confirm.deleteSession.title')}
        isDestructive
        confirmLabel={t(lang, 'admin.confirm.deleteSession.confirm')}
        cancelLabel={t(lang, 'admin.confirm.deleteSession.cancel')}
        onCancel={() => setPendingSessionDelete(null)}
        onConfirm={confirmSessionDelete}
        description={
          pendingSessionDelete ? (
            <>
              <p>
                {t(lang, 'maplist.sessionOf')} <strong>{pendingSessionDelete.clientName}</strong>{' '}
                {t(lang, 'maplist.sessionOn')}{' '}
                <strong>
                  {pendingSessionDelete.sessionDate || pendingSessionDelete.title}
                </strong>{' '}
                {t(lang, 'admin.confirm.deleteSession.tail')}
              </p>
              <p className="mt-2 text-content-subtle">
                {t(lang, 'admin.confirm.deleteSession.undo')}
              </p>
            </>
          ) : null
        }
      />

      {/* Undo window: the deleted record stays restorable while the toast is
          up. The toast dismisses itself (8s, pausing on hover/focus), closes
          on X/Escape, and shows the countdown as a bar. */}
      {undoClientDeleteState && (
        <UndoToast
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]"
          message={
            <span>
              {t(lang, 'admin.toast.clientDeleted')} <strong>{undoClientDeleteState.client.name}</strong>{' '}
              {t(lang, 'admin.toast.deleted')}
              {undoClientDeleteState.sessionCount > 0
                ? ` (${t(
                    lang,
                    undoClientDeleteState.sessionCount === 1
                      ? 'admin.confirm.count.one'
                      : 'admin.confirm.count.many'
                  ).replace('{n}', String(undoClientDeleteState.sessionCount))})`
                : ''}
              .
            </span>
          }
          undoLabel={t(lang, 'admin.toast.undo')}
          onUndo={() => void handleUndoClientDelete()}
          dismissLabel={t(lang, 'admin.toast.dismiss')}
          onDismiss={() => setUndoClientDeleteState(null)}
        />
      )}

      {undoSessionDeleteState && (
        <UndoToast
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60]"
          message={
            <span>
              {t(lang, 'admin.toast.sessionDeleted')}{' '}
              <strong>{undoSessionDeleteState.sessionDate || undoSessionDeleteState.title}</strong>{' '}
              {t(lang, 'admin.toast.deletedF')}
            </span>
          }
          undoLabel={t(lang, 'admin.toast.undo')}
          onUndo={() => void handleUndoSessionDelete()}
          dismissLabel={t(lang, 'admin.toast.dismiss')}
          onDismiss={() => setUndoSessionDeleteState(null)}
        />
      )}
    </>
  );
};
