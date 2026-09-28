import React, { useState, useMemo, useRef } from 'react';
import {
  X,
  Download,
  Copy,
  Check,
  FileText,
  Image,
  Code,
  Upload,
  Archive,
  FolderArchive,
  Layers,
  Sparkles,
} from 'lucide-react';
import { Client, MindMap, MindMapNode } from '../../types';
import {
  exportToMarkdown,
  exportToOPML,
  exportToFreeMind,
  exportToPNG,
  exportToSVG,
  downloadFile,
  copyToClipboard,
  sanitizeFilename,
  parseOPML,
  exportSessionMarkdown,
  exportClientSessionsZip,
  exportAllClientsZip,
} from '../../utils/export';
import { parseMarkdownToTree, formatSessionTimestamp } from '../../utils/tree';
import { getAllClients, getAllMaps } from '../../services/storage';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  map: MindMap;
  clients?: Client[];
  maps?: MindMap[];
  svgRef: React.RefObject<SVGSVGElement | null>;
  theme: 'papel' | 'noite';
  onImportMap: (importedMap: MindMap) => void;
  onUpdateCurrentMapRoot?: (newRoot: MindMapNode) => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  map,
  clients: initialClients,
  maps: initialMaps,
  svgRef,
  theme,
  onImportMap,
  onUpdateCurrentMapRoot,
}) => {
  const [activeTab, setActiveTab] = useState<'md' | 'png' | 'svg' | 'opml' | 'freemind' | 'json' | 'import'>('md');
  const [copied, setCopied] = useState(false);
  const [isExportingZip, setIsExportingZip] = useState(false);

  // Import State
  const [importText, setImportText] = useState('');
  const [importTarget, setImportTarget] = useState<'current_session' | 'new_session' | 'append_current'>('current_session');
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const isDark = theme === 'noite';

  const markdownContent = useMemo(() => exportToMarkdown(map), [map]);
  const opmlContent = useMemo(() => exportToOPML(map), [map]);
  const freeMindContent = useMemo(() => exportToFreeMind(map), [map]);
  const jsonContent = useMemo(() => JSON.stringify(map, null, 2), [map]);

  if (!isOpen) return null;

  const handleCopy = async (text: string) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleDownloadPNG = async () => {
    if (svgRef.current) {
      await exportToPNG(svgRef.current, map.title, theme, 2);
    }
  };

  const handleDownloadSVG = () => {
    if (svgRef.current) {
      exportToSVG(svgRef.current, map.title, theme);
    }
  };

  // Export 1: Single session markdown
  const handleExportSingleSession = () => {
    exportSessionMarkdown(map);
  };

  // Export 2: All sessions of current client zipped
  const handleExportClientSessionsZip = async () => {
    try {
      setIsExportingZip(true);
      const allMaps = initialMaps && initialMaps.length > 0 ? initialMaps : await getAllMaps();
      const clientSessions = allMaps.filter((m) => m.clientId === map.clientId || m.clientName === map.clientName);
      await exportClientSessionsZip(map.clientName || 'Cliente', clientSessions.length > 0 ? clientSessions : [map]);
    } finally {
      setIsExportingZip(false);
    }
  };

  // Export 3: All sessions of all clients zipped
  const handleExportAllClientsZip = async () => {
    try {
      setIsExportingZip(true);
      const [allClients, allMaps] = await Promise.all([
        initialClients && initialClients.length > 0 ? Promise.resolve(initialClients) : getAllClients(),
        initialMaps && initialMaps.length > 0 ? Promise.resolve(initialMaps) : getAllMaps(),
      ]);
      await exportAllClientsZip(allClients, allMaps);
    } finally {
      setIsExportingZip(false);
    }
  };

  const handleFullBackup = async () => {
    const all = await getAllMaps();
    const backupJson = JSON.stringify(all, null, 2);
    downloadFile(
      backupJson,
      `narratips_backup_${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    );
  };

  // File Upload handler
  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        setImportText(content);
        setImportStatus({
          type: 'success',
          message: `Arquivo "${file.name}" carregado (${content.length} caracteres). Pronto para importar.`,
        });
      }
    };
    reader.onerror = () => {
      setImportStatus({
        type: 'error',
        message: 'Falha ao ler o arquivo selecionado.',
      });
    };
    reader.readAsText(file);
  };

  // Execute Import
  const handleDoImport = () => {
    const trimmed = importText.trim();
    if (!trimmed) return;

    try {
      if (trimmed.startsWith('{')) {
        // JSON format
        const parsed = JSON.parse(trimmed);
        if (parsed.root) {
          if (importTarget === 'current_session' && onUpdateCurrentMapRoot) {
            onUpdateCurrentMapRoot(parsed.root);
            setImportStatus({ type: 'success', message: 'Sessão atual atualizada com sucesso!' });
          } else {
            onImportMap(parsed as MindMap);
            setImportStatus({ type: 'success', message: 'Novo mapa importado com sucesso!' });
          }
          setTimeout(onClose, 1000);
          return;
        }
      } else if (trimmed.includes('<opml') || trimmed.includes('<outline')) {
        // OPML format
        const rootNode = parseOPML(trimmed, map.title || 'Sessão Importada');
        if (importTarget === 'current_session' && onUpdateCurrentMapRoot) {
          onUpdateCurrentMapRoot(rootNode);
          setImportStatus({ type: 'success', message: 'Conteúdo OPML aplicado à sessão atual!' });
        } else {
          const timestamp = formatSessionTimestamp();
          const newMap: MindMap = {
            schema: 1,
            id: `m_${Date.now().toString(36)}`,
            clientId: map.clientId || 'c_default',
            clientName: map.clientName || 'Cliente',
            sessionDate: timestamp,
            title: rootNode.text || timestamp,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            root: rootNode,
          };
          onImportMap(newMap);
          setImportStatus({ type: 'success', message: 'Nova sessão OPML criada com sucesso!' });
        }
        setTimeout(onClose, 1000);
        return;
      } else {
        // Markdown outline (# Raiz ou listas - com recuo)
        const parsedNode = parseMarkdownToTree(trimmed, map.sessionDate || map.title || 'Sessão Importada');

        if (importTarget === 'current_session') {
          if (onUpdateCurrentMapRoot) {
            onUpdateCurrentMapRoot(parsedNode);
          } else {
            onImportMap({
              ...map,
              root: parsedNode,
              updatedAt: new Date().toISOString(),
            });
          }
          setImportStatus({ type: 'success', message: 'Tópicos de Markdown aplicados à sessão atual!' });
        } else if (importTarget === 'append_current') {
          const existingChildren = map.root.children || [];
          const importedChildren = parsedNode.children || [];
          const mergedRoot: MindMapNode = {
            ...map.root,
            children: [...existingChildren, ...importedChildren],
          };
          if (onUpdateCurrentMapRoot) {
            onUpdateCurrentMapRoot(mergedRoot);
          } else {
            onImportMap({
              ...map,
              root: mergedRoot,
              updatedAt: new Date().toISOString(),
            });
          }
          setImportStatus({ type: 'success', message: 'Tópicos anexados ao final da sessão atual!' });
        } else {
          // 'new_session'
          const timestamp = formatSessionTimestamp();
          const newMap: MindMap = {
            schema: 1,
            id: `m_${Date.now().toString(36)}`,
            clientId: map.clientId || 'c_default',
            clientName: map.clientName || 'Cliente',
            sessionDate: timestamp,
            title: parsedNode.text || timestamp,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            root: parsedNode,
          };
          onImportMap(newMap);
          setImportStatus({ type: 'success', message: `Nova sessão criada para ${map.clientName || 'o cliente'}!` });
        }
        setTimeout(onClose, 1200);
        return;
      }
    } catch {
      setImportStatus({
        type: 'error',
        message: 'Erro ao interpretar o conteúdo. Certifique-se de que o texto está em Markdown (# Raiz, - item), OPML ou JSON.',
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <div
        className={`w-full max-w-3xl rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[92vh] ${
          isDark ? 'bg-[#0B0F19] border-slate-800 text-slate-100' : 'bg-white border-slate-300 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div>
            <h3 className="text-base font-extrabold tracking-tight text-slate-950 dark:text-white">
              Exportar & Importar Sessões
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
              Cliente: <strong className="font-bold text-slate-950 dark:text-white">{map.clientName || 'Cliente'}</strong> · Sessão: <span className="font-mono font-semibold">{map.sessionDate || map.title}</span>
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

        {/* Tab Navigation */}
        <div className="flex items-center gap-1 px-6 pt-3 border-b border-slate-200 dark:border-slate-800 overflow-x-auto text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('md')}
            className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'md'
                ? 'border-amber-500 text-slate-950 dark:text-white font-extrabold'
                : 'border-transparent text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Markdown (.md / .zip)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('import')}
            className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer flex items-center gap-1.5 ${
              activeTab === 'import'
                ? 'border-amber-500 text-slate-950 dark:text-white font-extrabold'
                : 'border-transparent text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            <Upload className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
            <span>Importar Markdown</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('png')}
            className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'png'
                ? 'border-amber-500 text-slate-950 dark:text-white font-extrabold'
                : 'border-transparent text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Imagem PNG (2×)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('svg')}
            className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'svg'
                ? 'border-amber-500 text-slate-950 dark:text-white font-extrabold'
                : 'border-transparent text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            Vetor SVG
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('opml')}
            className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'opml'
                ? 'border-amber-500 text-slate-950 dark:text-white font-extrabold'
                : 'border-transparent text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            OPML 2.0
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('freemind')}
            className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'freemind'
                ? 'border-amber-500 text-slate-950 dark:text-white font-extrabold'
                : 'border-transparent text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            FreeMind (.mm)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('json')}
            className={`pb-2.5 px-3 border-b-2 transition-colors whitespace-nowrap cursor-pointer ${
              activeTab === 'json'
                ? 'border-amber-500 text-slate-950 dark:text-white font-extrabold'
                : 'border-transparent text-slate-600 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white'
            }`}
          >
            JSON Backup
          </button>
        </div>

        {/* Tab Body */}
        <div className="flex-1 overflow-y-auto p-6 text-sm">
          {activeTab === 'md' && (
            <div className="space-y-5">
              {/* 3 Export Options Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {/* 1. Single Session Markdown */}
                <div
                  className={`p-4 rounded-xl border flex flex-col justify-between ${
                    isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-slate-50 border-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 text-slate-950 dark:text-white font-bold text-xs">
                      <FileText className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Uma Única Sessão</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1.5 leading-snug">
                      Exporta apenas esta sessão atual em arquivo <code>.md</code> individual formatado.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportSingleSession}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 dark:hover:bg-slate-100 text-xs font-bold shadow-xs transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar Sessão (.md)</span>
                  </button>
                </div>

                {/* 2. All Sessions of Current Client (ZIP) */}
                <div
                  className={`p-4 rounded-xl border flex flex-col justify-between ${
                    isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-slate-50 border-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 text-slate-950 dark:text-white font-bold text-xs">
                      <Archive className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                      <span>Todas Sessões do Cliente</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1.5 leading-snug">
                      Gera um arquivo <code>.zip</code> com todas as sessões em Markdown de <strong>{map.clientName || 'Cliente'}</strong>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportClientSessionsZip}
                    disabled={isExportingZip}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold shadow-xs transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Archive className="w-3.5 h-3.5" />
                    <span>{isExportingZip ? 'Compactando…' : `Zipar ${map.clientName || 'Cliente'} (.zip)`}</span>
                  </button>
                </div>

                {/* 3. All Sessions of All Clients (ZIP) */}
                <div
                  className={`p-4 rounded-xl border flex flex-col justify-between ${
                    isDark ? 'bg-slate-900/90 border-slate-800' : 'bg-slate-50 border-slate-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-2 text-slate-950 dark:text-white font-bold text-xs">
                      <FolderArchive className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                      <span>Todos os Clientes & Sessões</span>
                    </div>
                    <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1.5 leading-snug">
                      Gera um arquivo <code>.zip</code> completo com pastas separadas por cliente contendo todo o consultório.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleExportAllClientsZip}
                    disabled={isExportingZip}
                    className="mt-3 w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border-2 border-slate-950 dark:border-slate-600 bg-white dark:bg-slate-950 text-slate-950 dark:text-white hover:bg-slate-100 dark:hover:bg-slate-900 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <FolderArchive className="w-3.5 h-3.5" />
                    <span>{isExportingZip ? 'Compactando…' : 'Zipar Tudo (.zip)'}</span>
                  </button>
                </div>
              </div>

              {/* Markdown Preview & Copy */}
              <div className="space-y-2 pt-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    Prévia do Conteúdo da Sessão Atual:
                  </span>
                  <button
                    type="button"
                    onClick={() => handleCopy(markdownContent)}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copiado!' : 'Copiar Texto'}</span>
                  </button>
                </div>
                <pre
                  className={`p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-52 border ${
                    isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
                  }`}
                >
                  {markdownContent}
                </pre>
              </div>
            </div>
          )}

          {activeTab === 'import' && (
            <div className="space-y-5">
              {/* Target selection */}
              <div>
                <label className="block text-xs font-bold text-slate-950 dark:text-white mb-2 uppercase tracking-wide">
                  1. Escolha o destino da importação:
                </label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      importTarget === 'current_session'
                        ? 'border-2 border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 text-slate-950 dark:text-white font-bold'
                        : 'border-slate-300 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importTarget"
                      checked={importTarget === 'current_session'}
                      onChange={() => setImportTarget('current_session')}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div>
                      <div className="font-extrabold">Na Sessão Atual</div>
                      <div className="text-[11px] font-normal opacity-80 mt-0.5">
                        Substitui os tópicos da sessão atual ({map.sessionDate || map.title})
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      importTarget === 'new_session'
                        ? 'border-2 border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 text-slate-950 dark:text-white font-bold'
                        : 'border-slate-300 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importTarget"
                      checked={importTarget === 'new_session'}
                      onChange={() => setImportTarget('new_session')}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div>
                      <div className="font-extrabold">Como Nova Sessão</div>
                      <div className="text-[11px] font-normal opacity-80 mt-0.5">
                        Cria nova sessão datada para {map.clientName || 'o cliente'}
                      </div>
                    </div>
                  </label>

                  <label
                    className={`flex items-start gap-2.5 p-3 rounded-xl border cursor-pointer transition-all ${
                      importTarget === 'append_current'
                        ? 'border-2 border-amber-500 bg-amber-50/70 dark:bg-amber-950/40 text-slate-950 dark:text-white font-bold'
                        : 'border-slate-300 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importTarget"
                      checked={importTarget === 'append_current'}
                      onChange={() => setImportTarget('append_current')}
                      className="mt-0.5 accent-amber-500"
                    />
                    <div>
                      <div className="font-extrabold">Anexar ao Final</div>
                      <div className="text-[11px] font-normal opacity-80 mt-0.5">
                        Mantém os tópicos atuais e adiciona os novos abaixo
                      </div>
                    </div>
                  </label>
                </div>
              </div>

              {/* File upload or paste */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-bold text-slate-950 dark:text-white uppercase tracking-wide">
                    2. Carregue um arquivo Markdown (.md) ou cole o texto:
                  </label>
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-900 dark:text-white font-bold text-xs transition-colors cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                    <span>Selecionar Arquivo .md / .txt</span>
                  </button>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".md,.markdown,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </div>

                <textarea
                  rows={8}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={`# Tópico Principal\n- Ponto 1\n  - Subponto A\n  - Subponto B\n- Ponto 2\n  - Subponto C`}
                  className={`w-full p-3.5 rounded-xl font-mono text-xs border outline-none leading-relaxed ${
                    isDark
                      ? 'bg-slate-950 border-slate-800 text-white focus:border-amber-400 placeholder:text-slate-500'
                      : 'bg-slate-50 border-slate-300 text-slate-950 focus:border-amber-500 placeholder:text-slate-500'
                  }`}
                />
              </div>

              {importStatus && (
                <div
                  className={`text-xs p-3 rounded-xl border font-bold flex items-center gap-2 ${
                    importStatus.type === 'success'
                      ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-300 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                      : 'bg-rose-50 dark:bg-rose-950/50 border-rose-300 dark:border-rose-800 text-rose-900 dark:text-rose-200'
                  }`}
                >
                  <span>{importStatus.message}</span>
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 text-xs font-semibold text-slate-600 dark:text-slate-400 hover:text-slate-950 dark:hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleDoImport}
                  disabled={!importText.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 text-xs font-bold text-white bg-slate-950 dark:bg-white dark:text-slate-950 rounded-xl hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-sm disabled:opacity-40 cursor-pointer"
                >
                  <Upload className="w-4 h-4" />
                  <span>Confirmar Importação de Markdown</span>
                </button>
              </div>
            </div>
          )}

          {activeTab === 'png' && (
            <div className="space-y-4 text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                <Image className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-base text-slate-950 dark:text-white">Exportar Imagem de Alta Resolução</h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto mt-1 font-medium">
                  Gera um PNG nítido em resolução 2× com o mapa completo e fundo neutro correspondente ao tema atual.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadPNG}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-slate-950 dark:bg-white dark:text-slate-950 rounded-xl hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Imagem PNG</span>
              </button>
            </div>
          )}

          {activeTab === 'svg' && (
            <div className="space-y-4 text-center py-6">
              <div className="w-16 h-16 mx-auto rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                <Code className="w-8 h-8" />
              </div>
              <div>
                <h4 className="font-bold text-base text-slate-950 dark:text-white">Exportar Vetor SVG</h4>
                <p className="text-xs text-slate-600 dark:text-slate-300 max-w-sm mx-auto mt-1 font-medium">
                  Arquivo vetorial escalável infinitamente, perfeito para ilustrações, relatórios e apresentações.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDownloadSVG}
                className="inline-flex items-center gap-2 px-5 py-2.5 text-xs font-bold text-white bg-slate-950 dark:bg-white dark:text-slate-950 rounded-xl hover:bg-slate-800 transition-colors shadow-xs cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Baixar Vetor SVG</span>
              </button>
            </div>
          )}

          {activeTab === 'opml' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-medium">
                <span>Formato padrão OPML 2.0 para outline e mapas:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(opmlContent)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFile(
                        opmlContent,
                        `${sanitizeFilename(map.title)}.opml`,
                        'text/x-opml'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 font-bold transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar .opml</span>
                  </button>
                </div>
              </div>
              <pre
                className={`p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-64 border ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              >
                {opmlContent}
              </pre>
            </div>
          )}

          {activeTab === 'freemind' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-medium">
                <span>Formato compatível com FreeMind (.mm):</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleCopy(freeMindContent)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copied ? 'Copiado!' : 'Copiar'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFile(
                        freeMindContent,
                        `${sanitizeFilename(map.title)}.mm`,
                        'application/x-freemind'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 font-bold transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar .mm</span>
                  </button>
                </div>
              </div>
              <pre
                className={`p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-64 border ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              >
                {freeMindContent}
              </pre>
            </div>
          )}

          {activeTab === 'json' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-600 dark:text-slate-400 font-medium">
                <span>Backup completo ou mapa único em JSON:</span>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleFullBackup}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Backup de Todos os Mapas</span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadFile(
                        jsonContent,
                        `${sanitizeFilename(map.title)}.json`,
                        'application/json'
                      )
                    }
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-950 dark:bg-white text-white dark:text-slate-950 hover:bg-slate-800 font-bold transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Baixar este mapa</span>
                  </button>
                </div>
              </div>
              <pre
                className={`p-4 rounded-xl font-mono text-xs overflow-x-auto max-h-64 border ${
                  isDark ? 'bg-slate-950 border-slate-800 text-slate-200' : 'bg-slate-50 border-slate-300 text-slate-900'
                }`}
              >
                {jsonContent}
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
