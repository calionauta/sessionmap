import React, { useState, useRef } from 'react';
import {
  X,
  Plus,
  Search,
  User,
  Users,
  Calendar,
  Layers,
  Trash2,
  Copy,
  Edit2,
  Check,
  Play,
  ArrowRight,
  Download,
  Upload,
  Archive,
  FolderArchive,
} from 'lucide-react';
import { Client, MindMap } from '../../types';
import { createNewSession, saveMap, saveClient, deleteClient, deleteMap } from '../../services/storage';
import { countTotalNodes, formatSessionTimestamp, parseMarkdownToTree } from '../../utils/tree';
import { exportSessionMarkdown, exportClientSessionsZip, exportAllClientsZip } from '../../utils/export';

interface AdminClientManagerProps {
  isOpen: boolean;
  onClose: () => void;
  clients: Client[];
  maps: MindMap[];
  activeMapId: string;
  activeClientId: string | null;
  onSelectSession: (map: MindMap) => void;
  onRefreshData: () => void;
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
  theme,
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

  if (!isOpen) return null;

  const isDark = theme === 'noite';

  const filteredClients = clients.filter((c) =>
    c.name.toLowerCase().includes(clientSearch.toLowerCase())
  );

  const currentClient =
    clients.find((c) => c.id === selectedClientId) || clients[0] || null;

  const clientSessions = maps
    .filter((m) => m.clientId === currentClient?.id)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

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
        onRefreshData();
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
    onRefreshData();
  };

  // Create new session for current client
  const handleCreateSession = async () => {
    if (!currentClient) return;
    const newSession = createNewSession(currentClient.id, currentClient.name);
    await saveMap(newSession);
    onRefreshData();
    onSelectSession(newSession);
    onClose();
  };

  // Rename client
  const handleRenameClient = async (clientId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!editingClientName.trim()) return;

    const c = clients.find((x) => x.id === clientId);
    if (c) {
      await saveClient({ ...c, name: editingClientName.trim() });
      setEditingClientId(null);
      onRefreshData();
    }
  };

  // Delete client
  const handleDeleteClient = async (clientId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm('Tem certeza que deseja excluir este cliente e suas sessões?')) {
      await deleteClient(clientId);
      const remaining = clients.filter((c) => c.id !== clientId);
      if (remaining.length > 0) {
        setSelectedClientId(remaining[0].id);
      }
      onRefreshData();
    }
  };

  // Delete session
  const handleDeleteSession = async (session: MindMap, e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Excluir a sessão ${session.sessionDate || session.title}?`)) {
      await deleteMap(session.id);
      onRefreshData();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        className={`w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl border flex flex-col overflow-hidden ${
          isDark
            ? 'bg-[#0B0F19] border-slate-800 text-slate-100'
            : 'bg-white border-slate-300 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-amber-500/10 text-amber-800 dark:text-amber-400">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold tracking-tight text-slate-950 dark:text-white">
                Painel do Terapeuta · Clientes & Sessões
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Organize cada cliente e inicie novas sessões datadas em tempo real
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 2-Column Workspace */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left Column: Client List */}
          <div className="w-72 border-r border-slate-200 dark:border-slate-800 flex flex-col bg-slate-50 dark:bg-slate-950/60">
            {/* Search and + Client button */}
            <div className="p-3 border-b border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                  Clientes ({clients.length})
                </span>
                <button
                  type="button"
                  onClick={() => setIsCreatingClient(true)}
                  className="flex items-center gap-1 text-xs font-bold text-amber-800 dark:text-amber-400 hover:text-amber-950 dark:hover:text-amber-300 transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" />
                  <span>Novo</span>
                </button>
              </div>

              {isCreatingClient && (
                <form onSubmit={handleSaveNewClient} className="flex items-center gap-1.5 pt-1">
                  <input
                    autoFocus
                    type="text"
                    value={newClientName}
                    onChange={(e) => setNewClientName(e.target.value)}
                    placeholder="Nome do cliente…"
                    className="flex-1 px-2.5 py-1 text-xs rounded-lg border-2 border-amber-500 bg-white dark:bg-slate-900 text-slate-950 dark:text-white font-medium placeholder:text-slate-500 dark:placeholder:text-slate-400 outline-none"
                  />
                  <button
                    type="submit"
                    className="p-1 rounded-lg bg-slate-950 text-white dark:bg-white dark:text-slate-950 hover:opacity-90 transition-opacity"
                    title="Confirmar"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsCreatingClient(false)}
                    className="p-1 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                    title="Cancelar"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </form>
              )}

              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 absolute left-2.5 text-slate-500 dark:text-slate-400" />
                <input
                  type="text"
                  value={clientSearch}
                  onChange={(e) => setClientSearch(e.target.value)}
                  placeholder="Buscar cliente…"
                  className="w-full pl-8 pr-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-950 dark:text-white placeholder:text-slate-500 dark:placeholder:text-slate-400 outline-none focus:border-amber-500 transition-colors"
                />
              </div>
            </div>

            {/* Clients Scrollable List */}
            <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
              {filteredClients.map((client) => {
                const isSelected = client.id === currentClient?.id;
                const count = maps.filter((m) => m.clientId === client.id).length;

                return (
                  <div
                    key={client.id}
                    onClick={() => setSelectedClientId(client.id)}
                    className={`group flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-all border ${
                      isSelected
                        ? isDark
                          ? 'bg-slate-800 border-2 border-amber-400 text-white shadow-md ring-1 ring-amber-400/20'
                          : 'bg-white border-2 border-slate-950 text-slate-950 shadow-xs ring-1 ring-slate-950/10'
                        : isDark
                        ? 'border border-transparent hover:border-slate-700 hover:bg-slate-800/60 text-slate-300'
                        : 'border border-transparent hover:border-slate-300 hover:bg-white text-slate-800'
                    }`}
                  >
                    <div className="flex-1 min-w-0 pr-2">
                      {editingClientId === client.id ? (
                        <form
                          onSubmit={(e) => handleRenameClient(client.id, e)}
                          onClick={(e) => e.stopPropagation()}
                          className="flex items-center gap-1"
                        >
                          <input
                            autoFocus
                            type="text"
                            value={editingClientName}
                            onChange={(e) => setEditingClientName(e.target.value)}
                            className="flex-1 px-1.5 py-0.5 text-xs rounded border border-slate-400 bg-white dark:bg-slate-900 text-slate-950 dark:text-white"
                          />
                          <button type="submit" className="p-0.5 text-emerald-600 dark:text-emerald-400">
                            <Check className="w-3 h-3" />
                          </button>
                        </form>
                      ) : (
                        <div
                          className={`text-xs truncate ${
                            isSelected
                              ? 'font-extrabold text-slate-950 dark:text-white'
                              : 'font-semibold text-slate-900 dark:text-slate-100'
                          }`}
                        >
                          {client.name}
                        </div>
                      )}
                      <div
                        className={`text-[11px] font-mono mt-0.5 ${
                          isSelected
                            ? isDark
                              ? 'text-amber-400 font-bold'
                              : 'text-amber-700 font-bold'
                            : isDark
                            ? 'text-slate-400 font-medium'
                            : 'text-slate-600 font-medium'
                        }`}
                      >
                        {count} {count === 1 ? 'sessão' : 'sessões'}
                      </div>
                    </div>

                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingClientId(client.id);
                          setEditingClientName(client.name);
                        }}
                        title="Renomear cliente"
                        className="p-1 rounded text-slate-600 hover:text-slate-950 hover:bg-slate-200 dark:text-slate-400 dark:hover:text-white dark:hover:bg-slate-700 transition-colors"
                      >
                        <Edit2 className="w-3 h-3" />
                      </button>
                      {clients.length > 1 && (
                        <button
                          type="button"
                          onClick={(e) => handleDeleteClient(client.id, e)}
                          title="Excluir cliente"
                          className="p-1 rounded text-rose-600 hover:text-rose-800 hover:bg-rose-100 dark:text-rose-400 dark:hover:text-rose-200 dark:hover:bg-rose-950 transition-colors"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Left Column Footer: Export All Clients ZIP */}
            <div className="p-3 border-t border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50">
              <button
                type="button"
                onClick={handleExportAllClientsZip}
                disabled={isExporting}
                title="Exportar todas as sessões de todos os clientes em um arquivo .zip completo"
                className="w-full flex items-center justify-center gap-1.5 py-2 px-2.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-800 dark:text-slate-200 font-bold text-xs transition-colors cursor-pointer shadow-2xs disabled:opacity-50"
              >
                <FolderArchive className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>{isExporting ? 'Compactando…' : 'Zipar Todos os Clientes (.zip)'}</span>
              </button>
            </div>
          </div>

          {/* Right Column: Sessions for Selected Client */}
          <div className="flex-1 flex flex-col bg-white dark:bg-slate-900 overflow-hidden">
            {currentClient ? (
              <>
                {/* Client Session Actions Bar */}
                <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 dark:text-amber-400">
                      Cliente Selecionado
                    </span>
                    <h2 className="text-xl font-black tracking-tight text-slate-950 dark:text-white">
                      {currentClient.name}
                    </h2>
                  </div>

                  <div className="flex items-center gap-2">
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
                      title={`Exportar todas as ${clientSessions.length} sessões de ${currentClient.name} compactadas em .zip`}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Archive className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span className="hidden sm:inline">Exportar (.zip)</span>
                    </button>

                    {/* Import Markdown file */}
                    <button
                      type="button"
                      onClick={() => importFileInputRef.current?.click()}
                      title="Importar arquivo Markdown (.md) como nova sessão para este cliente"
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl font-bold text-xs border border-amber-500 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 hover:bg-amber-100 dark:hover:bg-amber-900/40 shadow-2xs transition-colors cursor-pointer"
                    >
                      <Upload className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                      <span>+ Importar (.md)</span>
                    </button>

                    {/* Create New Session */}
                    <button
                      type="button"
                      onClick={handleCreateSession}
                      className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl font-bold text-xs text-white bg-slate-950 dark:bg-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 shadow-sm transition-all cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>+ Nova Sessão</span>
                    </button>
                  </div>
                </div>

                {/* Sessions List */}
                <div className="flex-1 overflow-y-auto p-5 space-y-3">
                  <div className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wider">
                    Histórico de Sessões ({clientSessions.length})
                  </div>

                  {clientSessions.length === 0 ? (
                    <div className="py-12 text-center text-xs font-medium text-slate-600 dark:text-slate-400 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl p-6">
                      Nenhuma sessão iniciada para este cliente. Clique em "+ Nova Sessão" ou "+ Importar (.md)" acima para começar.
                    </div>
                  ) : (
                    clientSessions.map((session) => {
                      const isActive = session.id === activeMapId;
                      const nodeCount = countTotalNodes(session.root);

                      return (
                        <div
                          key={session.id}
                          className={`p-4 rounded-xl border transition-all flex items-center justify-between gap-4 ${
                            isActive
                              ? isDark
                                ? 'bg-slate-800 border-2 border-amber-400 shadow-md ring-1 ring-amber-400/20'
                                : 'bg-amber-50/90 border-2 border-amber-500 shadow-sm'
                              : isDark
                              ? 'bg-slate-900/80 border border-slate-800 hover:border-slate-700 hover:bg-slate-800/60'
                              : 'bg-white border border-slate-300 hover:border-slate-400 hover:bg-slate-50 shadow-2xs'
                          }`}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-sm text-slate-950 dark:text-white">
                                {session.sessionDate || session.title}
                              </span>
                              {isActive && (
                                <span className="text-[10px] font-black px-2 py-0.5 rounded bg-amber-400 text-slate-950 border border-amber-500 uppercase tracking-wide">
                                  sessão ativa
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-3 mt-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium">
                              <span className="flex items-center gap-1 font-mono">
                                <Layers className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                                <span>{nodeCount} balões</span>
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="truncate">
                                Raiz: {session.root.text}
                              </span>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {/* Download Single Session Markdown Button */}
                            <button
                              type="button"
                              onClick={() => exportSessionMarkdown(session)}
                              title="Baixar esta sessão em Markdown (.md)"
                              className="p-2 rounded-lg text-slate-700 hover:text-slate-950 dark:text-slate-300 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={() => {
                                onSelectSession(session);
                                onClose();
                              }}
                              className={`flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                                isActive
                                  ? isDark
                                    ? 'bg-amber-400 hover:bg-amber-300 text-slate-950 font-black shadow-xs'
                                    : 'bg-slate-950 hover:bg-slate-800 text-white font-bold shadow-xs'
                                  : isDark
                                  ? 'bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-100 font-bold'
                                  : 'bg-white hover:bg-slate-100 border border-slate-300 text-slate-900 font-bold shadow-2xs'
                              }`}
                            >
                              <span>{isActive ? 'Continuar' : 'Abrir Sessão'}</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>

                            {clientSessions.length > 1 && (
                              <button
                                type="button"
                                onClick={(e) => handleDeleteSession(session, e)}
                                title="Excluir sessão"
                                className="p-1.5 rounded-lg text-rose-600 hover:text-rose-800 hover:bg-rose-50 dark:text-rose-400 dark:hover:text-rose-200 dark:hover:bg-rose-950/60 transition-colors"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : (
              <div className="flex items-center justify-center h-full text-xs font-medium text-slate-600 dark:text-slate-400">
                Selecione ou crie um cliente para visualizar as sessões.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
