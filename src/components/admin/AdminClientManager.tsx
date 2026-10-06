import React, { useState, useRef } from 'react';
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
import { Modal, ConfirmDialog } from '../ui/Modal';
import { ModalityBadge } from '../ui/ModalityBadge';
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
  const nodeCount = countTotalNodes(session.root);
  const sessionLabel = session.sessionDate || session.title;
  return (
    <div className="p-3 rounded-panel border border-caution/40 bg-surface flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="min-w-0">
        <div className="text-xs font-bold text-content break-words">{sessionLabel}</div>
        <div className="text-[11px] text-content-muted font-medium mt-0.5 break-words">
          <span className="font-mono">
            {nodeCount} {nodeCount === 1 ? 'balão' : 'balões'}
          </span>
          {' · '}registrado como <strong>{session.clientName || 'sem nome'}</strong> (id{' '}
          {session.clientId})
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button type="button" onClick={onOpen} className="ctl text-xs font-bold">
          <span>Abrir</span>
          <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
        </button>
        {canDelete && (
          <button
            type="button"
            onClick={onDelete}
            aria-label={`Excluir sessão ${sessionLabel}`}
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

  // Kind + template picker for the next session. Resolved on CONFIRM, not on
  // open: the client row could change under the open dialog.
  const [pendingSessionFor, setPendingSessionFor] = useState<Client | null>(null);

  // The panel has two rooms: the client workflow, and the global catalog.
  // Kinds and templates belong to no client — filing them under one client's
  // history is what made them undiscoverable — so they get a tab at the same
  // level as the client list rather than a section inside one of its rows.
  const [panelTab, setPanelTab] = useState<'clientes' | 'catalogo'>('clientes');

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
   * towards the "N clientes" export totals.
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
        title="Painel do Terapeuta · Clientes & Sessões"
        description="Organize cada cliente e inicie novas sessões datadas em tempo real"
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
        {/* Two rooms, one panel: the client workflow, and the global catalog.
            The catalog configures every client at once, so it sits beside
            the client list rather than inside one client's history. */}
        <div
          className="-m-6 px-6 pt-4 pb-3 border-b border-line bg-surface"
          role="tablist"
          aria-label="Clientes ou catálogo global"
        >
          <div className="flex p-1 bg-surface-inset rounded-xl border border-line">
            {(
              [
                { key: 'clientes' as const, label: `Clientes (${scopedClients.length})` },
                { key: 'catalogo' as const, label: 'Tipos e roteiros' },
              ]
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={panelTab === t.key}
                tabIndex={panelTab === t.key ? 0 : -1}
                onClick={() => setPanelTab(t.key)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setPanelTab(t.key === 'clientes' ? 'catalogo' : 'clientes');
                  }
                }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  panelTab === t.key
                    ? 'bg-surface-raised text-content shadow-xs'
                    : 'text-content-muted hover:text-content'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div className="-mx-6 -mb-6 flex flex-col md:flex-row md:h-[70vh] overflow-hidden">
        {panelTab === 'clientes' && (
          <>
          {/* Left Column: Client List */}
          <div className="w-full md:w-72 md:shrink-0 min-h-0 max-h-[40vh] md:max-h-none border-b md:border-b-0 md:border-r border-line flex flex-col bg-surface-sunken">
            {/* Search and + Client button */}
            <div className="p-3 border-b border-line space-y-2">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-xs font-bold text-content uppercase tracking-wider">
                  Clientes ({scopedClients.length})
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCreatingClient(true)}
                  className="ctl ctl-primary px-2.5 text-xs font-bold"
                >
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Novo</span>
                </button>
              </div>

              {/* Active / Archived switch, mirroring the session drawer so
                  both surfaces expose the archive the same way. */}
              <div
                role="tablist"
                aria-label="Clientes ativos ou arquivados"
                className="flex p-1 bg-surface-inset rounded-xl border border-line"
              >
                {(
                  [
                    { key: false, label: 'Ativos', count: activeClients.length },
                    { key: true, label: 'Arquivados', count: archivedClients.length },
                  ] as const
                ).map((t) => (
                  <button
                    key={String(t.key)}
                    type="button"
                    role="tab"
                    aria-selected={showArchived === t.key}
                    tabIndex={showArchived === t.key ? 0 : -1}
                    onClick={() => setShowArchived(t.key)}
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                        e.preventDefault();
                        setShowArchived(!t.key);
                      }
                    }}
                    className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                      showArchived === t.key
                        ? 'bg-surface-raised text-content shadow-xs'
                        : 'text-content-muted hover:text-content'
                    }`}
                  >
                    {t.label}
                    <span className="ml-1.5 font-mono text-[10px] opacity-70">
                      {t.count}
                    </span>
                  </button>
                ))}
              </div>

              {isCreatingClient && (
                <form onSubmit={handleSaveNewClient} className="flex items-center gap-2 pt-1">
                  <label htmlFor="admin-new-client-name" className="sr-only">
                    Nome do novo cliente
                  </label>
                  <input
                    id="admin-new-client-name"
                    autoFocus
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Nome do cliente…"
                    className="flex-1 min-w-0 h-11 px-3 text-sm rounded-control border border-line bg-surface-raised text-content font-medium placeholder:text-content-subtle"
                  />
                  <button
                    type="submit"
                    className="ctl ctl-primary w-11 px-0"
                    title="Confirmar"
                    aria-label="Confirmar novo cliente"
                  >
                    <Check className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingClient(false)}
                    className="ctl w-11 px-0"
                    aria-label="Cancelar novo cliente"
                    title="Cancelar"
                  >
                    <X className="w-4 h-4" aria-hidden="true" />
                  </button>
                </form>
              )}

              <div className="relative flex items-center">
                <label htmlFor="admin-client-search" className="sr-only">
                  Buscar cliente
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
                  placeholder="Buscar cliente…"
                  className="w-full h-11 pl-10 pr-3 text-sm rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle"
                />
              </div>
            </div>

            {/* Clients Scrollable List */}
            <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-1.5">
              {filteredClients.length === 0 ? (
                <p className="p-4 text-center text-xs font-medium text-content-muted border-2 border-dashed border-line-muted rounded-panel">
                  Nenhum cliente encontrado. Use “Novo” para cadastrar.
                </p>
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
                            Renomear {client.name}
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
                            aria-label={`Confirmar novo nome de ${client.name}`}
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
                            {count} {count === 1 ? 'sessão' : 'sessões'}
                          </div>
                          {/* The union of this client's sessions' kinds.
                              Derived, never stored: a therapy client who
                              starts mentoring grows a second badge on its
                              own, and no client is ever filed in one drawer. */}
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
                          aria-label={`Renomear ${client.name}`}
                          className="ctl w-11 px-0"
                        >
                          <Edit2 className="w-4 h-4" aria-hidden="true" />
                        </button>
                        {archived ? (
                          <>
                            <button
                              type="button"
                              onClick={() => handleUnarchiveClient(client)}
                              aria-label={`Restaurar ${client.name}`}
                              title="Restaurar cliente e sessões"
                              className="ctl w-11 px-0"
                            >
                              <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClient(client)}
                              aria-label={`Excluir ${client.name} e todas as sessões`}
                              title="Excluir cliente e sessões"
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
                              aria-label={`Arquivar ${client.name} e todas as sessões`}
                              title="Arquivar cliente e sessões"
                              className="ctl w-11 px-0"
                            >
                              <Archive className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              type="button"
                              onClick={() => handleDeleteClient(client)}
                              aria-label={`Excluir ${client.name}`}
                              title="Excluir cliente e sessões"
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
                title="Exportar todas as sessões de todos os clientes em um arquivo .zip completo"
                className="ctl w-full text-xs font-bold shadow-2xs"
              >
                <FolderArchive className="w-3.5 h-3.5 text-positive shrink-0" aria-hidden="true" />
                <span className="text-left leading-snug">
                  {isExporting ? 'Compactando…' : 'Zipar Todos os Clientes (.zip)'}
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
                      Cliente Selecionado
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
                      aria-label={`Exportar todas as ${clientSessions.length} sessões de ${currentClient.name} em .zip`}
                      title={`Exportar todas as ${clientSessions.length} sessões de ${currentClient.name} compactadas em .zip`}
                      className="ctl w-full sm:w-auto text-xs font-bold shadow-2xs"
                    >
                      <Archive className="w-3.5 h-3.5 text-accent-text shrink-0" aria-hidden="true" />
                      <span>Exportar (.zip)</span>
                    </button>

                    {/* Import Markdown file */}
                    <button
                      type="button"
                      onClick={() => importFileInputRef.current?.click()}
                      aria-label="Importar arquivo Markdown (.md) como nova sessão para este cliente"
                      title="Importar arquivo Markdown (.md) como nova sessão para este cliente"
                      className="ctl w-full sm:w-auto text-xs font-bold shadow-2xs text-accent-text"
                    >
                      <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>+ Importar (.md)</span>
                    </button>

                    {/* Create New Session */}
                    <button
                      type="button"
                      onClick={() => currentClient && setPendingSessionFor(currentClient)}
                      className="ctl ctl-primary w-full sm:w-auto text-xs font-bold shadow-2xs"
                    >
                      <Plus className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>+ Nova Sessão</span>
                    </button>
                  </div>
                </div>

                {/* Sessions List. Scrolls on its own only once the pane
                    is a fixed-height column; stacked, the pane owns
                    the scroll. */}
                <div className="flex-1 min-h-0 p-4 sm:p-5 space-y-3 overflow-visible md:overflow-y-auto">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider">
                      Histórico de Sessões ({clientSessions.length})
                    </h3>
                    {modalities.length > 0 && (
                      <label className="flex items-center gap-1.5 text-[11px] font-bold text-content-muted">
                        <span className="sr-only">Filtrar por tipo</span>
                        <select
                          value={modalityFilter}
                          onChange={(e) => setModalityFilter(e.target.value)}
                          aria-label="Filtrar sessões por tipo"
                          className="h-9 px-2 text-[11px] rounded-control border border-line bg-surface text-content font-bold"
                        >
                          <option value="all">Todos os tipos</option>
                          {modalities.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name}
                            </option>
                          ))}
                          <option value="none">Sem tipo</option>
                        </select>
                      </label>
                    )}
                  </div>

                  {clientSessions.length === 0 ? (
                    <div className="py-12 text-center text-xs font-medium text-content-muted border-2 border-dashed border-line-muted rounded-panel p-6">
                      Nenhuma sessão iniciada para este cliente. Clique em “+ Nova Sessão” ou
                      “+ Importar (.md)” acima para começar.
                    </div>
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
                                  sessão ativa
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
                                <span>{nodeCount} balões</span>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="min-w-0 break-words">Raiz: {session.root.text}</span>
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
                                  Tipo da sessão {sessionLabel}
                                </span>
                                <select
                                  value={session.modalityId ?? ''}
                                  onChange={(e) =>
                                    void handleSessionModality(session, e.target.value || null)
                                  }
                                  className="h-9 px-2 text-[11px] rounded-control border border-line bg-surface text-content font-bold"
                                >
                                  <option value="">Sem tipo</option>
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
                              aria-label={`Baixar a sessão de ${sessionLabel} em Markdown`}
                              title="Baixar esta sessão em Markdown (.md)"
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
                              <span>{isActive ? 'Continuar' : 'Abrir Sessão'}</span>
                              <ArrowRight className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            </button>

                            {isArchived(session) ? (
                              <button
                                type="button"
                                onClick={() => handleUnarchiveSession(session)}
                                aria-label={`Restaurar sessão ${sessionLabel}`}
                                title="Restaurar sessão"
                                className="ctl w-11 px-0"
                              >
                                <ArchiveRestore className="w-4 h-4" aria-hidden="true" />
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setPendingSessionArchive(session)}
                                aria-label={`Arquivar sessão ${sessionLabel}`}
                                title="Arquivar sessão"
                                className="ctl w-11 px-0"
                              >
                                <Archive className="w-4 h-4" aria-hidden="true" />
                              </button>
                            )}

                            {clientSessions.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleDeleteSession(session)}
                                aria-label={`Excluir sessão ${sessionLabel}`}
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
                        Sem cliente atribuído ({orphanedMaps.length})
                      </h3>
                      <p className="text-[11px] text-content-muted font-medium mt-1 mb-3">
                        Estas sessões não correspondem a nenhum cliente na lista. Abra
                        uma para ver a quem ela pertence, ou exclua se não for mais
                        necessária.
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
                <div className="py-6 text-center text-xs font-medium text-content-muted border-2 border-dashed border-line-muted rounded-panel p-6">
                  {clients.length === 0
                    ? 'Nenhum cliente cadastrado neste navegador. Crie um cliente para iniciar uma sessão.'
                    : 'Selecione um cliente para ver o histórico de sessões.'}
                </div>

                {orphanedMaps.length > 0 && (
                  <div className="pt-2 mt-2 border-t border-line">
                    <h3 className="text-xs font-bold text-caution uppercase tracking-wider flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5" aria-hidden="true" />
                      Sem cliente atribuído ({orphanedMaps.length})
                    </h3>
                    <p className="text-[11px] text-content-muted font-medium mt-1 mb-3">
                      Estas sessões não correspondem a nenhum cliente na lista. Abra uma
                      para ver a quem ela pertence, ou exclua se não for mais necessária.
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
            </>
        )}
        </div>
        {panelTab === 'catalogo' && (
          <div className="-mx-6 -mb-6 flex flex-col md:h-[70vh] max-h-[70vh] md:max-h-none min-h-0 overflow-hidden">
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
        clientName={pendingSessionFor?.name ?? 'Cliente'}
        defaultModalityId={
          (pendingSessionFor &&
            maps.find(
              (m) => m.clientId === pendingSessionFor.id && m.modalityId
            )?.modalityId) ??
          null
        }
        onConfirm={(modalityId, template) => void handleConfirmNewSession(modalityId, template)}
      />
      <ConfirmDialog
        isOpen={pendingModalityDelete !== null}
        title="Excluir este tipo?"
        isDestructive
        confirmLabel="Excluir tipo"
        cancelLabel="Manter"
        onCancel={() => setPendingModalityDelete(null)}
        onConfirm={() => void confirmModalityDelete()}
        description={
          pendingModalityDelete ? (
            <>
              <p>
                O tipo <strong>{pendingModalityDelete.name}</strong> sai do
                catálogo. As{' '}
                <strong>
                  {maps.filter((m) => m.modalityId === pendingModalityDelete.id).length}{' '}
                  sessões
                </strong>{' '}
                que o usam passam a “sem tipo”.
              </p>
              <p className="mt-2 text-content-subtle">
                Nada é apagado: só o rótulo sai, e você pode reclassificar cada
                sessão depois.
              </p>
            </>
          ) : null
        }
      />
      <ConfirmDialog
        isOpen={pendingClientDelete !== null}
        title="Excluir este cliente?"
        isDestructive
        confirmLabel="Excluir cliente e sessões"
        cancelLabel="Cancelar"
        onCancel={() => setPendingClientDelete(null)}
        onConfirm={confirmClientDelete}
        description={
          pendingClientDelete ? (
            <>
              <p>
                <strong>{pendingClientDelete.name}</strong> e{' '}
                <strong>
                  {maps.filter((m) => m.clientId === pendingClientDelete.id).length}{' '}
                  {maps.filter((m) => m.clientId === pendingClientDelete.id).length === 1
                    ? 'sessão'
                    : 'sessões'}
                </strong>{' '}
                {maps.filter((m) => m.clientId === pendingClientDelete.id).length === 1
                  ? 'será removida'
                  : 'serão removidas'}{' '}
                deste navegador. Não há servidor: o apagamento é definitivo e local.
              </p>
              <p className="mt-2 text-content-subtle">
                Você poderá restaurar o cadastro e todas as sessões logo após, pela janela
                de desfazer. Arquivar em vez de excluir deixa tudo recuperável.
              </p>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        isOpen={pendingClientArchive !== null}
        title="Arquivar este cliente?"
        confirmLabel="Arquivar cliente e sessões"
        cancelLabel="Manter ativo"
        onCancel={() => setPendingClientArchive(null)}
        onConfirm={confirmClientArchive}
        description={
          pendingClientArchive ? (
            <>
              <p>
                <strong>{pendingClientArchive.name}</strong> e as{' '}
                <strong>
                  {maps.filter((m) => m.clientId === pendingClientArchive.id).length}{' '}
                  {maps.filter((m) => m.clientId === pendingClientArchive.id).length === 1
                    ? 'sessão'
                    : 'sessões'}
                </strong>{' '}
                sairão da lista de clientes ativos.
              </p>
              <p className="mt-2 text-content-subtle">
                Nada é apagado: tudo continua em &quot;Arquivados&quot;, onde você pode
                consultar, restaurar ou excluir definitivamente.
              </p>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        isOpen={pendingSessionArchive !== null}
        title="Arquivar esta sessão?"
        confirmLabel="Arquivar sessão"
        cancelLabel="Manter ativa"
        onCancel={() => setPendingSessionArchive(null)}
        onConfirm={confirmSessionArchive}
        description={
          pendingSessionArchive ? (
            <>
              <p>
                A sessão de <strong>{pendingSessionArchive.clientName}</strong> em{' '}
                <strong>
                  {pendingSessionArchive.sessionDate || pendingSessionArchive.title}
                </strong>{' '}
                sai da lista de ativas. O cliente não é afetado.
              </p>
              <p className="mt-2 text-content-subtle">
                Nada é apagado: você continua podendo consultar, restaurar ou excluir em
                &quot;Arquivadas&quot;.
              </p>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        isOpen={pendingSessionDelete !== null}
        title="Excluir esta sessão?"
        isDestructive
        confirmLabel="Excluir sessão"
        cancelLabel="Cancelar"
        onCancel={() => setPendingSessionDelete(null)}
        onConfirm={confirmSessionDelete}
        description={
          pendingSessionDelete ? (
            <>
              <p>
                A sessão de <strong>{pendingSessionDelete.clientName}</strong> em{' '}
                <strong>
                  {pendingSessionDelete.sessionDate || pendingSessionDelete.title}
                </strong>{' '}
                será removida deste navegador.
              </p>
              <p className="mt-2 text-content-subtle">
                Você poderá restaurá-la logo após, pela janela de desfazer. Arquivar em vez
                de excluir deixa o registro recuperável.
              </p>
            </>
          ) : null
        }
      />

      {/* Undo window: the deleted record stays restorable for as long as
          the panel is open. There is no countdown — see needsDecision. */}
      {undoClientDeleteState && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-wrap items-center justify-center gap-3 px-4 py-3 rounded-panel bg-surface-raised text-content border border-line shadow-2xl text-xs max-w-[92vw]"
        >
          <span>
            Cliente <strong>{undoClientDeleteState.client.name}</strong> excluído
            {undoClientDeleteState.sessionCount > 0
              ? ` (${undoClientDeleteState.sessionCount} ${
                  undoClientDeleteState.sessionCount === 1 ? 'sessão' : 'sessões'
                })`
              : ''}
            .
          </span>
          <button
            type="button"
            onClick={handleUndoClientDelete}
            className="ctl ctl-primary px-4"
          >
            Desfazer
          </button>
        </div>
      )}

      {undoSessionDeleteState && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] flex flex-wrap items-center justify-center gap-3 px-4 py-3 rounded-panel bg-surface-raised text-content border border-line shadow-2xl text-xs max-w-[92vw]"
        >
          <span>
            Sessão <strong>{undoSessionDeleteState.sessionDate || undoSessionDeleteState.title}</strong>{' '}
            excluída.
          </span>
          <button
            type="button"
            onClick={handleUndoSessionDelete}
            className="ctl ctl-primary px-4"
          >
            Desfazer
          </button>
        </div>
      )}
    </>
  );
};
