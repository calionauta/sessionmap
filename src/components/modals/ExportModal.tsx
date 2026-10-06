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
import { Modal, ConfirmDialog } from '../ui/Modal';
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
import { parseMarkdownToTree } from '../../utils/tree';
import { formatSessionTimestamp } from '../../utils/text';
import { t, type Language } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';
import {
  getAllClients,
  getAllMaps,
  buildFullBackup,
  restoreFullBackup,
  type RestoreCounts,
} from '../../services/storage';

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
  /** Re-reads storage after a backup restore lands many records at once. */
  onRestoreBackup?: () => void | Promise<void>;
}

type TabId = 'arquivo' | 'importar' | 'opml' | 'freemind' | 'json';
type ImportTarget = 'current_session' | 'new_session' | 'append_current';

const buildTabItems = (lang: Language): TabItem<TabId>[] => [
  { value: 'arquivo', label: t(lang, 'export.tab.file') },
  { value: 'importar', label: t(lang, 'export.tab.import') },
  { value: 'opml', label: 'OPML' },
  { value: 'freemind', label: 'FreeMind' },
  { value: 'json', label: 'JSON' },
];

const buildImportTargets = (
  lang: Language,
  map: MindMap,
): {
  value: ImportTarget;
  label: string;
  describe: string;
}[] => {
  const client = map.clientName || t(lang, 'export.fallback.participant');
  return [
    {
      value: 'current_session',
      label: t(lang, 'export.import.target.current'),
      describe: t(lang, 'export.import.target.currentDesc').replace(
        '{session}',
        map.sessionDate || map.title
      ),
    },
    {
      value: 'new_session',
      label: t(lang, 'export.import.target.new'),
      describe: t(lang, 'export.import.target.newDesc').replace('{client}', client),
    },
    {
      value: 'append_current',
      label: t(lang, 'export.import.target.append'),
      describe: t(lang, 'export.import.target.appendDesc'),
    },
  ];
};

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
  const lang = useLang();
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
            {copied ? t(lang, 'export.copied') : t(lang, 'export.copy')}
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
  onRestoreBackup,
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

  // Full-backup restore: parsed file waits for an explicit confirmation,
  // because it overwrites sessions and clients by id. Nothing lands on the
  // first click; the dialog names exactly what will change.
  const [pendingRestore, setPendingRestore] = useState<{
    counts: { clients: number; maps: number; modalities: number; templates: number };
    payload: unknown;
    legacy: boolean;
  } | null>(null);
  const [restoreStatus, setRestoreStatus] = useState('');
  const restoreFileInputRef = useRef<HTMLInputElement | null>(null);

  const importTextId = useId();
  const importStatusId = useId();
  const lang = useLang();
  const tabItems = buildTabItems(lang);
  const importTargets = buildImportTargets(lang, map);

  // A confirmed or abandoned restore must not greet the next open.
  const wasOpenRef = useRef(false);
  if (isOpen && !wasOpenRef.current) {
    wasOpenRef.current = true;
    if (pendingRestore) setPendingRestore(null);
    if (restoreStatus) setRestoreStatus('');
  } else if (!isOpen && wasOpenRef.current) {
    wasOpenRef.current = false;
  }

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
    setExportStatus(t(lang, 'export.zip.busy'));
    setIsExportingZip(true);
    try {
      await run();
      setExportStatus(t(lang, 'export.zip.ready'));
    } catch {
      setExportStatus(t(lang, 'export.zip.fail'));
    } finally {
      setIsExportingZip(false);
    }
  };

  // Export 2: All sessions of current client zipped
  const handleExportClientSessionsZip = () =>
    handleRunZip(async () => {
      const allMaps = initialMaps && initialMaps.length > 0 ? initialMaps : await getAllMaps();
      const clientSessions = allMaps.filter((m) => m.clientId === map.clientId || m.clientName === map.clientName);
      await exportClientSessionsZip(map.clientName || t(lang, 'export.fallback.participantName'), clientSessions.length > 0 ? clientSessions : [map]);
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
    const envelope = await buildFullBackup();
    downloadFile(
      JSON.stringify(envelope, null, 2),
      `sessionmap_backup_${new Date().toISOString().slice(0, 10)}.json`,
      'application/json'
    );
  };

  // Restore 1: pick a backup file -> parse only, then ask. Restore 2 (the
  // dialog confirm) writes. Splitting them is what keeps a mis-clicked file
  // from overwriting the practice.
  const handleRestoreFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed: unknown = JSON.parse(String(event.target?.result ?? ''));
        const legacy = Array.isArray(parsed);
        const maps = legacy
          ? (parsed as unknown[])
          : ((parsed as { maps?: unknown }).maps as unknown);
        if (!Array.isArray(maps)) throw new Error(t(lang, 'export.restore.emptyFile'));
        const env = parsed as {
          clients?: unknown[];
          modalities?: unknown[];
          templates?: unknown[];
        };
        setPendingRestore({
          counts: {
            clients: Array.isArray(env.clients) ? env.clients.length : 0,
            maps: maps.length,
            modalities: Array.isArray(env.modalities) ? env.modalities.length : 0,
            templates: Array.isArray(env.templates) ? env.templates.length : 0,
          },
          payload: parsed,
          legacy,
        });
        setRestoreStatus('');
      } catch {
        setRestoreStatus(t(lang, 'export.restore.notBackup'));
      }
    };
    reader.onerror = () => setRestoreStatus(t(lang, 'export.restore.readFail'));
    reader.readAsText(file);
  };

  const confirmRestore = async () => {
    const target = pendingRestore;
    setPendingRestore(null);
    if (!target) return;
    try {
      setRestoreStatus(t(lang, 'export.restore.working'));
      const counts: RestoreCounts = await restoreFullBackup(target.payload);
      const mapsPart = t(
        lang,
        counts.maps === 1 ? 'export.restore.maps.one' : 'export.restore.maps.many'
      ).replace('{n}', String(counts.maps));
      const clientsPart = t(
        lang,
        counts.clients === 1 ? 'export.restore.clients.one' : 'export.restore.clients.many'
      ).replace('{n}', String(counts.clients));
      const extra =
        counts.modalities > 0 || counts.templates > 0
          ? t(lang, 'export.restore.extra')
              .replace('{t}', String(counts.modalities))
              .replace('{r}', String(counts.templates))
          : '';
      setRestoreStatus(
        t(lang, 'export.restore.done').replace('{summary}', `${mapsPart}, ${clientsPart}${extra}`)
      );
      await onRestoreBackup?.();
    } catch {
      setRestoreStatus(t(lang, 'export.restore.fail'));
    }
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
          message: t(lang, 'export.import.fileLoaded')
            .replace('{name}', file.name)
            .replace('{n}', String(content.length)),
        });
      }
    };
    reader.onerror = () => {
      setImportStatus({
        type: 'error',
        message: t(lang, 'export.import.fileFail'),
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
            setImportStatus({ type: 'success', message: t(lang, 'export.import.okCurrent') });
          } else {
            onImportMap(parsed as MindMap);
            setImportStatus({ type: 'success', message: t(lang, 'export.import.okNewMap') });
          }
          setTimeout(onClose, 1000);
          return;
        }
      } else if (trimmed.includes('<opml') || trimmed.includes('<outline')) {
        // OPML format
        const rootNode = parseOPML(trimmed, map.title || t(lang, 'export.fallback.importedSession'));
        if (importTarget === 'current_session' && onUpdateCurrentMapRoot) {
          onUpdateCurrentMapRoot(rootNode);
          setImportStatus({ type: 'success', message: t(lang, 'export.import.okOpmlCurrent') });
        } else {
          const timestamp = formatSessionTimestamp();
          const newMap: MindMap = {
            schema: 1,
            id: `m_${Date.now().toString(36)}`,
            clientId: map.clientId || 'c_default',
            clientName: map.clientName || t(lang, 'export.fallback.participantName'),
            sessionDate: timestamp,
            title: rootNode.text || timestamp,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            root: rootNode,
          };
          onImportMap(newMap);
          setImportStatus({ type: 'success', message: t(lang, 'export.import.okOpmlNew') });
        }
        setTimeout(onClose, 1000);
        return;
      } else {
        // Markdown outline (# Raiz ou listas - com recuo)
        const parsedNode = parseMarkdownToTree(trimmed, map.sessionDate || map.title || t(lang, 'export.fallback.importedSession'));

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
          setImportStatus({ type: 'success', message: t(lang, 'export.import.okMdCurrent') });
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
          setImportStatus({ type: 'success', message: t(lang, 'export.import.okMdAppend') });
        } else {
          // 'new_session'
          const timestamp = formatSessionTimestamp();
          const newMap: MindMap = {
            schema: 1,
            id: `m_${Date.now().toString(36)}`,
            clientId: map.clientId || 'c_default',
            clientName: map.clientName || t(lang, 'export.fallback.participantName'),
            sessionDate: timestamp,
            title: parsedNode.text || timestamp,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            root: parsedNode,
          };
          onImportMap(newMap);
          setImportStatus({ type: 'success', message: t(lang, 'export.import.okMdNew').replace('{client}', map.clientName || t(lang, 'export.fallback.participant')) });
        }
        setTimeout(onClose, 1200);
        return;
      }
    } catch {
      setImportStatus({
        type: 'error',
        message: t(lang, 'export.import.parseFail'),
      });
    }
  };

  const clientLabel = map.clientName || t(lang, 'export.fallback.participant');

  return (
    <>
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(lang, 'export.title')}
      description={t(lang, 'export.subtitle')
        .replace('{client}', map.clientName || t(lang, 'export.fallback.participantName'))
        .replace('{session}', map.sessionDate || map.title)}
      maxWidth="max-w-3xl"
    >
      <Tabs
        label={t(lang, 'export.tabs')}
        items={tabItems}
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
                    {t(lang, 'export.md.title')}
                  </>
                }
                description={<>{t(lang, 'export.md.descA')} <code>.md</code> {t(lang, 'export.md.descB')}</>}
                control={
                  <button type="button" onClick={handleExportSingleSession} className="ctl ctl-primary shrink-0">
                    <Download className="w-4 h-4" aria-hidden="true" />
                    {t(lang, 'export.md.button')}
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
                    {t(lang, 'export.clientZip.title').replace('{client}', clientLabel)}
                  </>
                }
                description={<>{t(lang, 'export.clientZip.descA')} <code>.zip</code> {t(lang, 'export.clientZip.descB')}</>}
                control={
                  <button
                    type="button"
                    onClick={handleExportClientSessionsZip}
                    disabled={isExportingZip}
                    className="ctl shrink-0"
                  >
                    <Archive className="w-4 h-4" aria-hidden="true" />
                    {isExportingZip ? t(lang, 'export.zip.working') : t(lang, 'export.zip.button')}
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
                    {t(lang, 'export.allZip.title')}
                  </>
                }
                description={<>{t(lang, 'export.allZip.descA')} <code>.zip</code> {t(lang, 'export.allZip.descB')}</>}
                control={
                  <button
                    type="button"
                    onClick={handleExportAllClientsZip}
                    disabled={isExportingZip}
                    className="ctl shrink-0"
                  >
                    <FolderArchive className="w-4 h-4" aria-hidden="true" />
                    {isExportingZip ? t(lang, 'export.zip.working') : t(lang, 'export.zip.button')}
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
                    {t(lang, 'export.png.title')}
                  </>
                }
                description={t(lang, 'export.png.desc')}
                control={
                  <button type="button" onClick={handleDownloadPNG} className="ctl shrink-0">
                    <Download className="w-4 h-4" aria-hidden="true" />
                    {t(lang, 'export.png.button')}
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
                    {t(lang, 'export.svg.title')}
                  </>
                }
                description={t(lang, 'export.svg.desc')}
                control={
                  <button type="button" onClick={handleDownloadSVG} className="ctl shrink-0">
                    <Download className="w-4 h-4" aria-hidden="true" />
                    {t(lang, 'export.svg.button')}
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
            title={t(lang, 'export.preview.md')}
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
              {t(lang, 'export.import.step1')}
            </legend>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
              {importTargets.map((target) => {
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
                        {target.describe}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <fieldset>
            <legend className="text-xs font-bold text-content uppercase tracking-wide mb-2">
              {t(lang, 'export.import.step2')}
            </legend>
            <div className="mb-2">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="ctl max-sm:w-full"
              >
                <Upload className="w-4 h-4 text-accent-text" aria-hidden="true" />
                {t(lang, 'export.import.pickFile')}
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
              {t(lang, 'export.import.textLabel')}
            </label>
            <textarea
              id={importTextId}
              rows={8}
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              aria-describedby={importStatus ? importStatusId : undefined}
              placeholder={t(lang, 'export.import.placeholder')}
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
              {t(lang, 'export.import.cancel')}
            </button>
            <button
              type="button"
              onClick={handleDoImport}
              disabled={!importText.trim()}
              className="ctl ctl-primary w-full sm:w-auto"
            >
              <Upload className="w-4 h-4" aria-hidden="true" />
              {t(lang, 'export.import.confirm')}
            </button>
          </div>
        </TabPanel>
      )}

      {activeTab === 'opml' && (
        <TabPanel id="export-panel-opml" labelledBy="export-tab-opml">
          <Preview
            title={t(lang, 'export.preview.opml')}
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
                {t(lang, 'export.opml.button')}
              </button>
            }
          />
        </TabPanel>
      )}

      {activeTab === 'freemind' && (
        <TabPanel id="export-panel-freemind" labelledBy="export-tab-freemind">
          <Preview
            title={t(lang, 'export.preview.freemind')}
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
                {t(lang, 'export.freemind.button')}
              </button>
            }
          />
        </TabPanel>
      )}

      {activeTab === 'json' && (
        <TabPanel id="export-panel-json" labelledBy="export-tab-json">
          <Preview
            title={t(lang, 'export.preview.json')}
            content={jsonContent}
            copied={copiedTab === 'json'}
            onCopy={() => handleCopy(jsonContent, 'json')}
            download={
              <>
                <button type="button" onClick={handleFullBackup} className="ctl">
                  <Download className="w-4 h-4" aria-hidden="true" />
                  {t(lang, 'export.json.full')}
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
                  {t(lang, 'export.json.one')}
                </button>
              </>
            }
          />

          {/* Restore: the file is only PARSED here. The confirm dialog writes,
              and names the counts first — a restore overwrites by id. */}
          <div className="mt-4 p-4 rounded-panel border border-line bg-surface-sunken space-y-2">
            <input
              ref={restoreFileInputRef}
              type="file"
              accept=".json,application/json"
              onChange={handleRestoreFile}
              className="hidden"
              aria-hidden="true"
              tabIndex={-1}
            />
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <h4 className="text-xs font-bold text-content">
                  {t(lang, 'export.restore.title')}
                </h4>
                <p className="text-[11px] text-content-muted font-medium">
                  {t(lang, 'export.restore.desc')}
                </p>
              </div>
              <button
                type="button"
                onClick={() => restoreFileInputRef.current?.click()}
                className="ctl text-xs font-bold"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t(lang, 'export.restore.pick')}</span>
              </button>
            </div>
            {restoreStatus && (
              <p role="status" className="text-[11px] font-semibold text-content">
                {restoreStatus}
              </p>
            )}
          </div>
        </TabPanel>
      )}

      </Modal>

      <ConfirmDialog
        isOpen={pendingRestore !== null}
        title={t(lang, 'export.restore.confirmTitle')}
        confirmLabel={t(lang, 'export.restore.confirmButton')}
        cancelLabel={t(lang, 'export.import.cancel')}
        onCancel={() => setPendingRestore(null)}
        onConfirm={() => void confirmRestore()}
        description={
          pendingRestore ? (
            <>
              <p>
                {t(lang, 'export.restore.fileHas')}{' '}
                <strong>
                  {t(
                    lang,
                    pendingRestore.counts.maps === 1
                      ? 'export.restore.maps.one'
                      : 'export.restore.maps.many'
                  ).replace('{n}', String(pendingRestore.counts.maps))}
                </strong>
                {pendingRestore.counts.clients > 0 && (
                  <>
                    {' '}{t(lang, 'export.restore.and')}{' '}
                    <strong>
                      {t(
                        lang,
                        pendingRestore.counts.clients === 1
                          ? 'export.restore.clients.one'
                          : 'export.restore.clients.many'
                      ).replace('{n}', String(pendingRestore.counts.clients))}
                    </strong>
                  </>
                )}
                {pendingRestore.counts.modalities > 0 && (
                  <> · {t(lang, 'export.restore.typesCount').replace('{n}', String(pendingRestore.counts.modalities))}</>
                )}
                {pendingRestore.counts.templates > 0 && (
                  <> · {t(lang, 'export.restore.scriptsCount').replace('{n}', String(pendingRestore.counts.templates))}</>
                )}
                {pendingRestore.legacy && ` ${t(lang, 'export.restore.legacy')}`}.
              </p>
              <p className="mt-2 text-content-subtle">
                {t(lang, 'export.restore.overwrite')}
              </p>
            </>
          ) : null
        }
      />
    </>
  );
};
