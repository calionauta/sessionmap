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
} from 'lucide-react';
import { MindMap } from '../../types';
import { countTotalNodes } from '../../utils/tree';
import { getAllMaps, deleteMap, saveMap } from '../../services/storage';
import { downloadFile } from '../../utils/export';

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
  theme,
}) => {
  const [search, setSearch] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState('');

  if (!isOpen) return null;

  const isDark = theme === 'noite';

  const filteredMaps = maps.filter((m) =>
    (m.title || '').toLowerCase().includes(search.toLowerCase()) ||
    (m.root?.text || '').toLowerCase().includes(search.toLowerCase())
  );

  const startRename = (map: MindMap, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(map.id);
    setEditingTitle(map.title);
  };

  const confirmRename = (mapId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (editingTitle.trim()) {
      onRenameMap(mapId, editingTitle.trim());
    }
    setEditingId(null);
  };

  const handleBackupAll = async () => {
    const all = await getAllMaps();
    downloadFile(
      JSON.stringify(all, null, 2),
      `narratips_backup_completo_${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-start bg-black/40 backdrop-blur-xs">
      <div
        className={`w-full max-w-md h-full shadow-2xl border-r flex flex-col ${
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-base font-extrabold text-slate-950 dark:text-white">Mapas & Sessões</h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              {maps.length} {maps.length === 1 ? 'mapa salvo' : 'mapas salvos'} neste navegador
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Action bar & Search */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 space-y-3">
          <button
            type="button"
            onClick={() => {
              onCreateNewMap();
              onClose();
            }}
            className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-bold text-white bg-slate-950 dark:bg-white dark:text-slate-950 rounded-xl hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-xs cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            <span>Novo Mapa</span>
          </button>

          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-3 text-slate-500 dark:text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar por cliente ou anotação…"
              className={`w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border outline-none font-medium ${
                isDark
                  ? 'bg-slate-800 border-slate-700 text-slate-100 placeholder:text-slate-400 focus:border-amber-400'
                  : 'bg-slate-50 border-slate-300 text-slate-900 placeholder:text-slate-500 focus:border-amber-500'
              }`}
            />
          </div>
        </div>

        {/* Map List */}
        <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
          {filteredMaps.length === 0 ? (
            <div className="py-12 text-center text-xs font-medium text-slate-600 dark:text-slate-400">
              Nenhum mapa encontrado.
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
                  onClick={() => {
                    onSelectMap(m.id);
                    onClose();
                  }}
                  className={`group p-3 rounded-xl border transition-all cursor-pointer ${
                    isActive
                      ? isDark
                        ? 'bg-slate-800 border-2 border-amber-400 shadow-md ring-1 ring-amber-400/20'
                        : 'bg-amber-50/90 border-2 border-amber-500 shadow-sm'
                      : isDark
                      ? 'bg-slate-900/80 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/60'
                      : 'bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50 shadow-2xs'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    {editingId === m.id ? (
                      <form
                        onSubmit={(e) => confirmRename(m.id, e)}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 flex-1"
                      >
                        <input
                          autoFocus
                          type="text"
                          value={editingTitle}
                          onChange={(e) => setEditingTitle(e.target.value)}
                          className="flex-1 px-2 py-0.5 text-xs rounded border border-slate-400 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100"
                        />
                        <button
                          type="submit"
                          className="p-1 text-emerald-600 hover:bg-emerald-50 rounded"
                        >
                          <Check className="w-3.5 h-3.5" />
                        </button>
                      </form>
                    ) : (
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="text-xs font-bold truncate text-slate-950 dark:text-white">
                            {m.title || 'Sem título'}
                          </h4>
                          {isActive && (
                            <span className="text-[10px] font-black px-2 py-0.5 rounded bg-amber-400 text-slate-950 border border-amber-500 uppercase tracking-wide">
                              ativo
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] font-medium text-slate-700 dark:text-slate-300 truncate mt-0.5">
                          Tema: {m.root.text}
                        </p>
                      </div>
                    )}

                    {/* Action buttons on card hover */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => startRename(m, e)}
                        title="Renomear"
                        className="p-1 rounded text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/50"
                      >
                        <Edit2 className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDuplicateMap(m);
                        }}
                        title="Duplicar"
                        className="p-1 rounded text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white hover:bg-slate-200/50"
                      >
                        <Copy className="w-3.5 h-3.5" />
                      </button>
                      {maps.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onDeleteMapWithUndo(m);
                          }}
                          title="Excluir"
                          className="p-1 rounded text-rose-600 hover:text-rose-800 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-200 dark:hover:bg-rose-950/40"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Card metadata (zero-pill text with separators) */}
                  <div className="flex items-center gap-2 mt-2 text-[11px] font-medium text-slate-600 dark:text-slate-400">
                    <span className="flex items-center gap-1 font-mono">
                      <Layers className="w-3 h-3 text-amber-700 dark:text-amber-400" />
                      <span>{nodeCount} balões</span>
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="flex items-center gap-1 font-mono">
                      <Calendar className="w-3 h-3" />
                      <span>{formattedDate}</span>
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer Backup */}
        <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
          <button
            type="button"
            onClick={handleBackupAll}
            className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300 hover:text-slate-950 dark:hover:text-white transition-colors cursor-pointer"
          >
            <FileDown className="w-3.5 h-3.5" />
            <span>Fazer Backup Completo (JSON)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
