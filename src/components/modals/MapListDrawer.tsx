import React, { useState } from 'react';
import {
  X,
  Plus,
  Search,
  Trash2,
  Copy,
  Edit2,
  Check,
  Calendar,
  Layers,
  FileDown,
  Archive,
  ArchiveRestore,
} from 'lucide-react';
import { MindMap } from '../../types';
import { countTotalNodes } from '../../utils/tree';
import {
  getAllMaps,
  deleteMap,
  saveMap,
  isArchived,
  unarchiveMap,
  unarchiveClient,
} from '../../services/storage';
import { downloadFile } from '../../utils/export';
import { useDialogA11y, ConfirmDialog } from '../ui/Modal';

interface MapListDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  maps: MindMap[];
  activeMapId: string;
  onSelectMap: (mapId: string) => void;
  onCreateNewMap: () => void;
  onDuplicateMap: (map: MindMap) => void;
  onRenameMap: (mapId: string, newTitle: string) => void;
  onDeleteMapWithUndo: (map: MindMap) => void;
  /** archive=false restores the record. */
  onArchiveMap: (map: MindMap, archive: boolean) => void;
  /** Re-reads storage after the drawer mutates records itself. */
  onRefresh: () => void;
  theme: 'papel' | 'noite';
}

export const MapListDrawer: React.FC<MapListDrawerProps> = ({
  isOpen,
  onClose,
  maps,
  activeMapId,
  onSelectMap,
  onCreateNewMap,
  onDuplicateMap,
  onRenameMap,
  onDeleteMapWithUndo,
  onArchiveMap,
  onRefresh,
}) => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');
  const [view, setView] = useState<'active' | 'archived'>('active');
  // Confirmation is a dialog, never window.confirm(): the default focus is the
  // safe answer and the dialog names exactly what is about to be removed.
  const [pendingArchive, setPendingArchive] = useState<MindMap | null>(null);
  const [pendingDelete, setPendingDelete] = useState<MindMap | null>(null);

  const panelRef = React.useRef<HTMLDivElement>(null);

  // Escape, focus trap, focus move-in/restore and scroll lock come from the
  // shared dialog hook. This drawer used to carry its own copy of all of it,
  // which had already drifted from Modal's (different focusable selectors, and
  // it silently dropped focus when the panel held none).
  const onKeyDown = useDialogA11y(panelRef, isOpen, onClose);

  // A drawer is not a Modal: the name "theme" is kept in the props for
  // API compatibility but the shell now reads tokens from index.css.
  if (!isOpen) return null;

  // Archived sessions are hidden from the working list; the search filters
  // within whichever view is open rather than across both.
  const activeMaps = maps.filter((m) => !isArchived(m));
  const archivedMaps = maps.filter((m) => isArchived(m));
  const scopedMaps = view === 'active' ? activeMaps : archivedMaps;
  const term = search.trim().toLowerCase();
  const filteredMaps = term
    ? scopedMaps.filter(
        (m) =>
          (m.title || '').toLowerCase().includes(term) ||
          (m.root?.text || '').toLowerCase().includes(term) ||
          (m.clientName || '').toLowerCase().includes(term)
      )
    : scopedMaps;
  const activeCount = activeMaps.length;
  const archivedCount = archivedMaps.length;

  const startRename = (mapId: string, title: string) => {
    setEditingId(mapId);
    setEditingTitle(title);
  };

  const confirmRename = (mapId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (editingTitle.trim()) {
      onRenameMap(mapId, editingTitle.trim());
    }
    setEditingId(null);
  };

  // The backup deliberately includes archived sessions: they are still clinical
  // records, and a backup that silently dropped them would be lossy.
  const handleBackupAll = async () => {
    const all = await getAllMaps();
    downloadFile(
      JSON.stringify(all, null, 2),
      `sessionmap_backup_completo_${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    );
  };

  // Bulk restore, including a client whose whole history was archived at once.
  // Scoped to the sessions this drawer was handed, so it can only touch records
  // this browser actually holds.
  const handleRestoreAll = async () => {
    for (const m of archivedMaps) {
      await unarchiveMap(m.id);
    }
    for (const id of new Set(archivedMaps.map((m) => m.clientId))) {
      await unarchiveClient(id);
    }
    onRefresh();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-start bg-black/50 backdrop-blur-xs"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="map-drawer-title"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="w-full max-w-md h-full shadow-2xl border-r border-line bg-surface-raised text-content flex flex-col focus:outline-none"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line shrink-0">
          <div>
            <h2
              id="map-drawer-title"
              className="text-base font-extrabold text-content"
            >
              Mapas &amp; Sessões
            </h2>
            <p className="text-xs text-content-muted font-medium">
              {maps.length} {maps.length === 1 ? 'mapa salvo' : 'mapas salvos'} neste navegador
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar Mapas e Sessões"
            className="ctl w-9 h-9 !min-h-0 px-0 shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Action bar & Search */}
        <div className="p-4 border-b border-line space-y-3 shrink-0">
          <button
            type="button"
            onClick={() => {
              onCreateNewMap();
              onClose();
            }}
            className="ctl ctl-primary w-full"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>Novo Mapa</span>
          </button>

          {/* Active / Archived switch. Archived sessions are excluded from the
              working list entirely — including the map picker and the session
              exports — so a finished case never competes with a live one. */}
          <div role="tablist" aria-label="Sessões ativas ou arquivadas" className="flex p-1 bg-surface-inset rounded-xl border border-line">
            {(
              [
                { key: 'active' as const, label: 'Ativas' },
                { key: 'archived' as const, label: 'Arquivadas' },
              ]
            ).map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={view === t.key}
                aria-controls="map-list-panel"
                tabIndex={view === t.key ? 0 : -1}
                onClick={() => setView(t.key)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
                    e.preventDefault();
                    setView(view === 'active' ? 'archived' : 'active');
                  }
                }}
                className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-colors ${
                  view === t.key
                    ? 'bg-surface-raised text-content shadow-xs'
                    : 'text-content-muted hover:text-content'
                }`}
              >
                {t.label}
                <span className="ml-1.5 font-mono text-[10px] opacity-70">
                  {t.key === 'active' ? activeCount : archivedCount}
                </span>
              </button>
            ))}
          </div>

          <div className="relative flex items-center">
            <Search
              className="w-4 h-4 absolute left-3 text-content-subtle"
              aria-hidden="true"
            />
            <label htmlFor="map-search" className="sr-only">
              Buscar mapa por cliente ou anotação
            </label>
            <input
              id="map-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente ou anotação…"
              className="w-full pl-9 pr-3 py-2 text-xs rounded-control border border-line bg-surface font-medium text-content placeholder:text-content-subtle"
            />
          </div>
        </div>

        {/* Map List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {filteredMaps.length === 0 ? (
            <div className="py-12 text-center text-xs font-medium text-content-muted">
              {search ? (
                <>
                  Nenhum mapa encontrado para <strong>&quot;{search}&quot;</strong>.
                  <br />
                  Tente outro termo.
                </>
              ) : (
                'Nenhum mapa salvo ainda. Crie o primeiro para começar.'
              )}
            </div>
          ) : (
            filteredMaps.map((m) => {
              const isActive = m.id === activeMapId;
              const nodeCount = countTotalNodes(m.root);
              const formattedDate = new Date(m.updatedAt).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'short',
              });

              return (
                <div
                  key={m.id}
                  className={`group p-3 rounded-panel border transition-colors ${
                    isActive
                      ? 'bg-accent-soft border-2 border-accent shadow-sm'
                      : 'bg-surface-raised border border-line hover:bg-surface'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        onSelectMap(m.id);
                        onClose();
                      }}
                      aria-current={isActive ? 'true' : undefined}
                      className="flex-1 min-w-0 text-left cursor-pointer"
                    >
                      <div className="flex items-center gap-2">
                        <h4 className="text-xs font-bold truncate text-content">
                          {m.title || 'Sem título'}
                        </h4>
                        {isActive && (
                          <span className="text-[10px] font-black px-2 py-0.5 rounded bg-accent text-content-onaccent uppercase tracking-wide">
                            ativo
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] font-medium text-content-muted truncate mt-0.5">
                        Tema: {m.root.text}
                      </p>
                    </button>

                    {/* Siblings of the selection button, never children:
                        a <button> may not contain interactive content, and
                        nesting them swallowed these names in the outer
                        button's accessible name. */}
                    <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => startRename(m.id, m.title)}
                        aria-label={`Renomear ${m.title || 'mapa sem título'}`}
                        className="ctl w-8 h-8 !min-h-0 px-0"
                      >
                        <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => onDuplicateMap(m)}
                        aria-label={`Duplicar ${m.title || 'mapa sem título'}`}
                        className="ctl w-8 h-8 !min-h-0 px-0"
                      >
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      {isArchived(m) ? (
                        <>
                          <button
                            type="button"
                            onClick={() => onArchiveMap(m, false)}
                            aria-label={`Restaurar ${m.title || 'mapa sem título'}`}
                            title="Restaurar para ativas"
                            className="ctl w-8 h-8 !min-h-0 px-0"
                          >
                            <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setPendingDelete(m)}
                            aria-label={`Excluir definitivamente ${m.title || 'mapa sem título'}`}
                            title="Excluir definitivamente"
                            className="ctl ctl-danger w-8 h-8 !min-h-0 px-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => setPendingArchive(m)}
                            aria-label={`Arquivar ${m.title || 'mapa sem título'}`}
                            title="Arquivar sessão"
                            className="ctl w-8 h-8 !min-h-0 px-0"
                          >
                            <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                          {/* No "keep at least one" guard: an empty library
                              is a legitimate state, and the drawer already
                              renders an empty state plus a create button. */}
                          <button
                            type="button"
                            onClick={() => onDeleteMapWithUndo(m)}
                            aria-label={`Excluir ${m.title || 'mapa sem título'}`}
                            className="ctl ctl-danger w-8 h-8 !min-h-0 px-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Card metadata */}
                  <div className="flex items-center gap-2 mt-2 text-[11px] font-medium text-content-muted">
                    {isArchived(m) && (
                      <>
                        <span className="flex items-center gap-1 uppercase tracking-wide text-caution">
                          <Archive className="w-3 h-3" aria-hidden="true" />
                          <span>arquivada</span>
                        </span>
                        <span aria-hidden="true">·</span>
                      </>
                    )}
                    <span className="flex items-center gap-1 font-mono">
                      <Layers className="w-3 h-3 text-accent-text" aria-hidden="true" />
                      <span>{nodeCount} balões</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="flex items-center gap-1 font-mono">
                      <Calendar className="w-3 h-3" aria-hidden="true" />
                      <span>{formattedDate}</span>
                    </span>
                  </div>

                  {editingId === m.id && (
                    <form
                      onSubmit={(e) => confirmRename(m.id, e)}
                      className="flex items-center gap-1.5 mt-2 pt-2 border-t border-line"
                    >
                      <label htmlFor={`rename-${m.id}`} className="sr-only">
                        Novo nome do mapa
                      </label>
                      <input
                        id={`rename-${m.id}`}
                        autoFocus
                        type="text"
                        value={editingTitle}
                        onChange={(e) => setEditingTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="flex-1 px-2 py-1.5 text-xs rounded-control border border-line bg-surface text-content"
                      />
                      <button
                        type="submit"
                        aria-label="Confirmar novo nome"
                        className="ctl ctl-primary w-8 h-8 !min-h-0 px-0"
                      >
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </form>
                  )}
                </div>
              );
            })
          )}
        </div>

        {/* Footer Backup */}
        <div className="p-4 border-t border-line bg-surface flex items-center justify-between shrink-0">
          <button type="button" onClick={handleBackupAll} className="ctl">
            <FileDown className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Fazer Backup Completo (JSON)</span>
          </button>
          <button
            type="button"
            onClick={handleRestoreAll}
            className="ctl"
            disabled={archivedCount === 0}
            title={
              archivedCount === 0
                ? 'Nenhuma sessão arquivada para restaurar'
                : 'Restaurar todas as sessões arquivadas'
            }
          >
            <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Restaurar arquivadas ({archivedCount})</span>
          </button>
        </div>
      </div>

      {/* Both dialogs live OUTSIDE the drawer panel: nested inside it they
          would sit within the drawer's own focus trap and be unreachable. */}
      <ConfirmDialog
        isOpen={pendingArchive !== null}
        title="Arquivar esta sessão?"
        confirmLabel="Arquivar sessão"
        cancelLabel="Manter ativa"
        onCancel={() => setPendingArchive(null)}
        onConfirm={() => {
          if (pendingArchive) onArchiveMap(pendingArchive, true);
          setPendingArchive(null);
        }}
        description={
          pendingArchive ? (
            <>
              <p>
                A sessão de <strong>{pendingArchive.clientName}</strong> em{' '}
                <strong>{pendingArchive.sessionDate || pendingArchive.title}</strong>{' '}
                sai da lista de ativas e passa para Arquivadas.
              </p>
              <p className="mt-2 text-content-subtle">
                Nada é apagado: você continua podendo consultar, restaurar ou
                excluir em &quot;Arquivadas&quot;.
              </p>
            </>
          ) : null
        }
      />

      <ConfirmDialog
        isOpen={pendingDelete !== null}
        title="Excluir definitivamente?"
        isDestructive
        confirmLabel="Excluir para sempre"
        cancelLabel="Manter arquivada"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) onDeleteMapWithUndo(pendingDelete);
          setPendingDelete(null);
        }}
        description={
          pendingDelete ? (
            <>
              <p>
                A sessão de <strong>{pendingDelete.clientName}</strong> em{' '}
                <strong>{pendingDelete.sessionDate || pendingDelete.title}</strong>{' '}
                será removida deste navegador.
              </p>
              <p className="mt-2 text-content-subtle">
                Esta ação é definitiva e não há servidor: o apagamento é local.
                Arquivar em vez de excluir deixa o registro recuperável.
              </p>
            </>
          ) : null
        }
      />
    </div>
  );
};
