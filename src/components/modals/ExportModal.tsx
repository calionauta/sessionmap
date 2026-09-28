import React, { useId, useMemo, useRef, useState } from 'react';
import {
  Archive,
  Check,
  Code,
  Copy,
  Download,
  FileText,
  FolderArchive,
  Image,
  Upload,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Tabs, TabPanel, type TabItem } from '../ui/Tabs';
import { SettingRow } from '../ui/Controls';
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

type TabId = 'arquivo' | 'importar' | 'opml' | 'freemind' | 'json';
type ImportTarget = 'current_session' | 'new_session' | 'append_current';

const TAB_ITEMS: TabItem<TabId>[] = [
  { value: 'arquivo', label: 'Arquivo' },
  { value: 'importar', label: 'Importar' },
  { value: 'opml', label: 'OPML' },
  { value: 'freemind', label: 'FreeMind' },
  { value: 'json', label: 'JSON' },
];

const IMPORT_TARGETS: {
  value: ImportTarget;
  label: string;
  describe: (map: MindMap) => string;
}[] = [
  {
    value: 'current_session',
    label: 'Na Sessão Atual',
    describe: (map) => `Substitui os tópicos da sessão atual (${map.sessionDate || map.title})`,
  },
  {
    value: 'new_session',
    label: 'Como Nova Sessão',
    describe: (map) => `Cria nova sessão datada para ${map.clientName || 'o cliente'}`,
  },
  {
    value: 'append_current',
    label: 'Anexar ao Final',
    describe: () => 'Mantém os tópicos atuais e adiciona os novos abaixo',
  },
];

interface PreviewProps {
  title: string;
  content: string;
  copied: boolean;
  onCopy: () => void;
  /** Format-specific download, appended before the copy button. */
  download?: React.ReactNode;
}

/**
 * One read-only preview of a serialised format. The four formats used to
 * ship four byte-level copies of this markup; they differ only in the
 * caption, the payload and the download action.
 */
function Preview({ title, content, copied, onCopy, download }: PreviewProps) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-bold text-content-muted">{title}</span>
        {/* The JSON tab passes two download buttons plus Copiar: ~460px of
            controls that do not fit a 375px viewport, so the group wraps
            instead of pushing the dialog into a horizontal scroll. */}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {download}
          <button type="button" onClick={onCopy} className="ctl">
            {copied ? (
              <Check className="w-3.5 h-3.5 text-positive" aria-hidden="true" />
            ) : (
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            {copied ? 'Copiado!' : 'Copiar'}
          </button>
        </div>
      </div>
      {/* The global user-select:none is gone; select-text keeps the
          preview copyable by hand, not only via the button (SC 1.4.1). */}
      <pre className="select-text max-w-full p-4 rounded-control bg-surface-sunken border border-line text-content font-mono text-xs leading-relaxed overflow-x-auto max-h-64">
        {content}
      </pre>
    </div>
  );
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
  const [activeTab, setActiveTab] = useState<TabId>('arquivo');
  // Which format was copied, not a bare boolean: the success state used
  // to leak between the Markdown, OPML, FreeMind and JSON buttons.
  const [copiedTab, setCopiedTab] = useState<TabId | null>(null);
  const [isExportingZip, setIsExportingZip] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  // Import State
  const [importText, setImportText] = useState('');
  const [importTarget, setImportTarget] = useState<ImportTarget>('current_session');
  const [importStatus, setImportStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const importTextId = useId();
  const importStatusId = useId();

  const markdownContent = useMemo(() => exportToMarkdown(map), [map]);
  const opmlContent = useMemo(() => exportToOPML(map), [map]);
  const freeMindContent = useMemo(() => exportToFreeMind(map), [map]);
  const jsonContent = useMemo(() => JSON.stringify(map, null, 2), [map]);

  if (!isOpen) return null;

  const handleCopy = async (text: string, tab: TabId) => {
    const success = await copyToClipboard(text);
    if (success) {
      setCopiedTab(tab);
      setTimeout(() => setCopiedTab((current) => (current === tab ? null : current)), 2000);
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

  const handleRunZip = async (run: () => Promise<void>) => {
    setExportStatus('Compactando o arquivo .zip…');
    setIsExportingZip(true);
    try {
      await run();
      setExportStatus('Arquivo .zip pronto.');
    } catch {
      setExportStatus('Não foi possível gerar o arquivo .zip. Tente novamente.');
    } finally {
      setIsExportingZip(false);
    }
  };

  // Export 2: All sessions of current client zipped
  const handleExportClientSessionsZip = () =>
    handleRunZip(async () => {
      const allMaps = initialMaps && initialMaps.length > 0 ? initialMaps : await getAllMaps();
      const clientSessions = allMaps.filter((m) => m.clientId === map.clientId || m.clientName === map.clientName);
      await exportClientSessionsZip(map.clientName || 'Cliente', clientSessions.length > 0 ? clientSessions : [map]);
    });

  // Export 3: All sessions of all clients zipped
  const handleExportAllClientsZip = () =>
    handleRunZip(async () => {
      const [allClients, allMaps] = await Promise.all([
        initialClients && initialClients.length > 0 ? Promise.resolve(initialClients) : getAllClients(),
        initialMaps && initialMaps.length > 0 ? Promise.resolve(initialMaps) : getAllMaps(),
      ]);
      await exportAllClientsZip(allClients, allMaps);
    });

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

  const clientLabel = map.clientName || 'o cliente';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Exportar & Importar Sessões"
      description={`Cliente: ${map.clientName || 'Cliente'} · Sessão: ${map.sessionDate || map.title}`}
      maxWidth="max-w-3xl"
    >
      <Tabs
        label="Formato de exportação e importação"
        items={TAB_ITEMS}
        value={activeTab}
        onChange={setActiveTab}
        idPrefix="export"
        className="mb-5 flex-wrap [&_[role=tab]]:min-h-touch"
      />

      {activeTab === 'arquivo' && (
        <TabPanel id="export-panel-arquivo" labelledBy="export-tab-arquivo" className="space-y-5">
          {/* One primary action, four secondary ones. The three exports
              used to be three equal-weight icon cards where the rarest
              (full practice backup) was the loudest.

              Responsive: SettingRow lays its label and control out in a
              fixed side-by-side row with no wrap. Below 640px — and at
              200% browser zoom, which halves the CSS viewport — that
              crushes the label into a one-word-per-line column. These two
              utilities re-point the row's own flex container instead of
              forking the component, so every row stacks and goes
              full-bleed on a phone. */}
          <div
            className="divide-y divide-line max-sm:[&>div>div]:flex-col max-sm:[&_button]:w-full"
            aria-busy={isExportingZip}
          >
            <div className="py-3 first:pt-0">
              <SettingRow
                id="export-md"
                align="start"
                label={
                  <>
                    <FileText className="w-4 h-4 text-accent-text" aria-hidden="true" />
                    Sessão atual
                  </>
                }
                description={<>Arquivo <code>.md</code> individual, formatado para leitura.</>}
                control={
                  <button type="button" onClick={handleExportSingleSession} className="ctl ctl-primary shrink-0">
                    <Download className="w-4 h-4" aria-hidden="true" />
                    Baixar .md
                  </button>
                }
              />
            </div>

            <div className="py-3">
              <SettingRow
                id="export-client-zip"
                align="start"
                label={
                  <>
                    <Archive className="w-4 h-4 text-accent-text" aria-hidden="true" />
                    Todas as sessões de {clientLabel}
                  </>
                }
                description={<>Arquivo <code>.zip</code> com todas as sessões em Markdown deste cliente.</>}
                control={
                  <button
                    type="button"
                    onClick={handleExportClientSessionsZip}
                    disabled={isExportingZip}
                    className="ctl shrink-0"
                  >
                    <Archive className="w-4 h-4" aria-hidden="true" />
                    {isExportingZip ? 'Compactando…' : 'Baixar .zip'}
                  </button>
                }
              />
            </div>

            <div className="py-3">
              <SettingRow
                id="export-all-zip"
                align="start"
                label={
                  <>
                    <FolderArchive className="w-4 h-4 text-accent-text" aria-hidden="true" />
                    Todos os clientes
                  </>
                }
                description={<>Arquivo <code>.zip</code> completo, com uma pasta por cliente.</>}
                control={
                  <button
                    type="button"
                    onClick={handleExportAllClientsZip}
                    disabled={isExportingZip}
                    className="ctl shrink-0"
                  >
                    <FolderArchive className="w-4 h-4" aria-hidden="true" />
                    {isExportingZip ? 'Compactando…' : 'Baixar .zip'}
                  </button>
                }
              />
            </div>

            <div className="py-3">
              <SettingRow
                id="export-png"
                align="start"
                label={
                  <>
                    <Image className="w-4 h-4 text-accent-text" aria-hidden="true" />
                    Imagem PNG (2×)
                  </>
                }
                description="Rasteriza o mapa atual em alta resolução, com fundo neutro do tema atual."
                control={
                  <button type="button" onClick={handleDownloadPNG} className="ctl shrink-0">
                    <Download className="w-4 h-4" aria-hidden="true" />
                    Baixar PNG
                  </button>
                }
              />
            </div>

            <div className="py-3 last:pb-0">
              <SettingRow
                id="export-svg"
                align="start"
                label={
                  <>
                    <Code className="w-4 h-4 text-accent-text" aria-hidden="true" />
                    Vetor SVG
                  </>
                }
                description="Arquivo vetorial escalável do mapa atual."
                control={
                  <button type="button" onClick={handleDownloadSVG} className="ctl shrink-0">
                    <Download className="w-4 h-4" aria-hidden="true" />
                    Baixar SVG
                  </button>
                }
              />
            </div>
          </div>

          {/* Zip progress is async and silent for a screen reader. */}
          <p role="status" className="sr-only">
            {exportStatus}
          </p>

          <Preview
            title="Prévia do conteúdo da sessão atual"
            content={markdownContent}
            copied={copiedTab === 'arquivo'}
            onCopy={() => handleCopy(markdownContent, 'arquivo')}
          />
        </TabPanel>
      )}

      {activeTab === 'importar' && (
        <TabPanel id="export-panel-importar" labelledBy="export-tab-importar" className="space-y-5">
          <fieldset>
            <legend className="text-xs font-bold text-content uppercase tracking-wide mb-2">
              1. Escolha o destino da importação
            </legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              {IMPORT_TARGETS.map((target) => {
                const selected = importTarget === target.value;
                return (
                  <label
                    key={target.value}
                    className={`flex items-start gap-2.5 p-3 rounded-control border cursor-pointer transition-colors ${
                      selected
                        ? 'border-accent bg-accent-soft text-content font-bold'
                        : 'border-line text-content-muted hover:bg-surface-inset'
                    }`}
                  >
                    <input
                      type="radio"
                      name="importTarget"
                      value={target.value}
                      checked={selected}
                      onChange={() => setImportTarget(target.value)}
                      className="mt-0.5 w-4 h-4 shrink-0 accent-[var(--accent)]"
                    />
                    <span className="min-w-0">
                      <span className="block font-extrabold">{target.label}</span>
                      <span className="block text-xs font-normal mt-0.5">
                        {target.describe(map)}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-bold text-content uppercase tracking-wide mb-2">
              2. Arquivo Markdown (.md) ou texto colado
            </legend>
            <div className="mb-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="ctl max-sm:w-full"
              >
                <Upload className="w-4 h-4 text-accent-text" aria-hidden="true" />
                Selecionar arquivo .md / .txt
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".md,.markdown,.txt"
                onChange={handleFileUpload}
                className="hidden"
              />
            </div>

            <label htmlFor={importTextId} className="sr-only">
              Conteúdo Markdown, OPML ou JSON para importar
            </label>
            <textarea
              id={importTextId}
              rows={8}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              aria-describedby={importStatus ? importStatusId : undefined}
              placeholder={`# Tópico Principal\n- Ponto 1\n  - Subponto A\n  - Subponto B\n- Ponto 2\n  - Subponto C`}
              className="w-full p-3.5 rounded-control font-mono text-xs leading-relaxed bg-surface-sunken border border-line text-content placeholder:text-content-subtle"
            />
          </fieldset>

          {importStatus && (
            <div
              id={importStatusId}
              // role="alert" is an assertive interruption and belongs on
              // failures. Announcing a successful import assertively was a
              // misuse added by the a11y pass; success is a polite status.
              role={importStatus.type === 'error' ? 'alert' : 'status'}
              aria-live={importStatus.type === 'error' ? 'assertive' : 'polite'}
              className={`text-xs p-3 rounded-control border font-bold ${
                importStatus.type === 'success'
                  ? 'border-line bg-surface-inset text-positive'
                  : 'border-negative/40 bg-surface-inset text-negative'
              }`}
            >
              {importStatus.message}
            </div>
          )}

          {/* Stacks below 640px: side by side these two buttons total
              ~300px of chrome, which is the entire content width of a
              375px dialog. */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
            <button type="button" onClick={onClose} className="ctl w-full sm:w-auto">
              Cancelar
            </button>
            <button
              type="button"
              onClick={handleDoImport}
              disabled={!importText.trim()}
              className="ctl ctl-primary w-full sm:w-auto"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              Confirmar importação
            </button>
          </div>
        </TabPanel>
      )}

      {activeTab === 'opml' && (
        <TabPanel id="export-panel-opml" labelledBy="export-tab-opml">
          <Preview
            title="Formato padrão OPML 2.0 para outline e mapas"
            content={opmlContent}
            copied={copiedTab === 'opml'}
            onCopy={() => handleCopy(opmlContent, 'opml')}
            download={
              <button
                type="button"
                onClick={() =>
                  downloadFile(opmlContent, `${sanitizeFilename(map.title)}.opml`, 'text/x-opml')
                }
                className="ctl ctl-primary"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Baixar .opml
              </button>
            }
          />
        </TabPanel>
      )}

      {activeTab === 'freemind' && (
        <TabPanel id="export-panel-freemind" labelledBy="export-tab-freemind">
          <Preview
            title="Formato compatível com FreeMind (.mm)"
            content={freeMindContent}
            copied={copiedTab === 'freemind'}
            onCopy={() => handleCopy(freeMindContent, 'freemind')}
            download={
              <button
                type="button"
                onClick={() =>
                  downloadFile(
                    freeMindContent,
                    `${sanitizeFilename(map.title)}.mm`,
                    'application/x-freemind'
                  )
                }
                className="ctl ctl-primary"
              >
                <Download className="w-4 h-4" aria-hidden="true" />
                Baixar .mm
              </button>
            }
          />
        </TabPanel>
      )}

      {activeTab === 'json' && (
        <TabPanel id="export-panel-json" labelledBy="export-tab-json">
          <Preview
            title="Backup completo ou mapa único em JSON"
            content={jsonContent}
            copied={copiedTab === 'json'}
            onCopy={() => handleCopy(jsonContent, 'json')}
            download={
              <>
                <button type="button" onClick={handleFullBackup} className="ctl">
                  <Download className="w-4 h-4" aria-hidden="true" />
                  Backup de todos os mapas
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
                  className="ctl ctl-primary"
                >
                  <Download className="w-4 h-4" aria-hidden="true" />
                  Baixar este mapa
                </button>
              </>
            }
          />
        </TabPanel>
      )}
    </Modal>
  );
};
