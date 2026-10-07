import React, { useEffect, useState } from 'react';
import { ArrowRight, Eye, Pencil, Play } from 'lucide-react';
import { Modality, SessionTemplate } from '../../types';
import {
  loadModalities,
  loadTemplates,
  templatesFor,
} from '../../services/storage';
import { Modal } from '../ui/Modal';
import { Select } from '../ui/Select';
import { t } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';

interface NewSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  defaultModalityId?: string | null;
  onConfirm: (modalityId: string | null, template: SessionTemplate | null) => void;
  /**
   * Where "Gerenciar tipos e roteiros" leads. Without it the dialog can only
   * NAME the catalog ("crie um em…"), which is how users concluded the
   * picker was fixed furniture. Both hosts wire it: the admin panel jumps
   * to its catalog tab, the main view opens the panel there.
   */
  onOpenCatalog?: () => void;
  /**
   * Editing of the SELECTED script starts here but lands in the catalog:
   * the picker closes and the catalog opens with that script's editor
   * already open. The picker never edits — selection and editing stay in
   * separate rooms, and the preview below never pretends otherwise.
   */
  onEditTemplate?: (tpl: SessionTemplate) => void;
}

/**
 * The chosen skeleton, rendered so nobody mistakes it for a field.
 *
 * It used to be a monospace <pre> in a bordered box — visually a textarea —
 * and users tried to edit the text right there. Now: proportional type,
 * real bullets, no input border, and a header that says PRÉVIA + "só
 * leitura" next to the one action that does edit (which jumps to the
 * catalog with this script's editor open).
 */
function ScriptPreview({
  markdown,
  onEdit,
  editLabel,
}: {
  markdown: string;
  onEdit?: () => void;
  editLabel: string;
}) {
  const lang = useLang();
  const blocks = parsePreviewLines(markdown);
  return (
    <div className="mt-2 rounded-control border border-line-muted bg-surface-sunken overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-line-muted">
        <Eye className="w-3.5 h-3.5 text-content-subtle shrink-0" aria-hidden="true" />
        <span className="text-[11px] font-extrabold uppercase tracking-wider text-content-muted">
          {t(lang, 'newsession.previewTitle')}
        </span>
        <span className="text-[10px] font-bold uppercase tracking-wide text-content-subtle border border-line-muted rounded px-1.5 py-px">
          {t(lang, 'newsession.previewReadonly')}
        </span>
        <span className="flex-1" />
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 text-[11px] font-bold text-accent-text underline underline-offset-2 hover:no-underline"
          >
            <Pencil className="w-3 h-3" aria-hidden="true" />
            <span>{editLabel}</span>
          </button>
        )}
      </div>
      <div className="px-3 py-2.5 max-h-40 overflow-y-auto text-xs text-content cursor-default select-text space-y-1">
        {blocks.map((b, i) =>
          b.kind === 'h' ? (
            <div key={i} className="font-extrabold text-content">
              {b.text}
            </div>
          ) : b.kind === 'li' ? (
            <div key={i} className="flex gap-2" style={{ paddingLeft: `${b.level * 1.25}rem` }}>
              <span aria-hidden="true" className="text-accent-text font-black">
                •
              </span>
              <span>{b.text}</span>
            </div>
          ) : (
            <div key={i}>{b.text}</div>
          )
        )}
      </div>
    </div>
  );
}

interface PreviewBlock {
  kind: 'h' | 'p' | 'li';
  level: number;
  text: string;
}

/** Enough markdown for a skeleton glance: headings, bullets, paragraphs. */
function parsePreviewLines(markdown: string): PreviewBlock[] {
  const out: PreviewBlock[] = [];
  for (const raw of markdown.split('\n')) {
    if (!raw.trim()) continue;
    const heading = raw.match(/^#{1,3}\s+(.*)$/);
    if (heading) {
      out.push({ kind: 'h', level: 0, text: heading[1].trim() });
      continue;
    }
    const bullet = raw.match(/^(\s*)[-*+]\s+(.*)$/);
    if (bullet) {
      const indent = bullet[1].replace(/\t/g, '  ').length;
      out.push({ kind: 'li', level: Math.min(2, Math.floor(indent / 2)), text: bullet[2].trim() });
      continue;
    }
    out.push({ kind: 'p', level: 0, text: raw.trim() });
  }
  return out;
}
/**
 * Picks the kind and the starting skeleton before a session exists.
 *
 * Two selects, deliberately, not one combined list: the kind is a PROPERTY
 * of the session (it drives the badge, the filter and the client's union),
 * while the template is a ONE-TIME body. Merging them would couple "this
 * session is a consult" to "it started from the consult skeleton", and a
 * consult session started blank would then be unrepresentable.
 *
 * Selection only — editing lives in the catalog. Both selects carry a
 * visible path there (the kind label has its manage button, the preview
 * has its edit button), so nothing reads as fixed furniture and the
 * preview never reads as a field.
 */
export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  isOpen,
  onClose,
  clientName,
  defaultModalityId = null,
  onConfirm,
  onOpenCatalog,
  onEditTemplate,
}) => {
  const [modalities, setModalities] = useState<Modality[]>([]);
  const [templates, setTemplates] = useState<SessionTemplate[]>([]);
  const [modalityId, setModalityId] = useState<string | null>(defaultModalityId);
  const [templateId, setTemplateId] = useState<string | null>(null);

  // Reloaded on every open: the catalog is edited in the admin panel, and a
  // dialog that cached it would offer a kind that no longer exists.
  useEffect(() => {
    if (!isOpen) return;
    setModalities(loadModalities());
    setTemplates(loadTemplates());
    setModalityId(defaultModalityId);
    setTemplateId(null);
  }, [isOpen, defaultModalityId]);

  if (!isOpen) return null;

  const lang = useLang();
  const offered = templatesFor(templates, modalityId);
  const chosen: SessionTemplate | null =
    offered.find((tpl) => tpl.id === templateId) ?? null;

  const modalityName =
    modalities.find((m) => m.id === modalityId)?.name ?? t(lang, 'common.noType');
  const catalogEmpty = modalities.length === 0;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(lang, 'newsession.title').replace('{client}', clientName)}
      description={t(lang, 'newsession.desc')}
      icon={<Play className="w-5 h-5" />}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div>
          <div className="flex items-center justify-between gap-2 mb-1.5">
            <label
              htmlFor="new-session-modality"
              className="block text-xs font-bold text-content uppercase tracking-wider"
            >
              {t(lang, 'newsession.kind')}
            </label>
            {/* The catalog is one tap away, right where the question "where
                do these come from?" arises — not a sentence naming a room
                somewhere else. */}
            {onOpenCatalog && modalities.length > 0 && (
              <button
                type="button"
                onClick={onOpenCatalog}
                aria-label={t(lang, 'newsession.editKinds')}
                title={t(lang, 'newsession.editKinds')}
                className="inline-flex items-center gap-1 text-[11px] font-bold text-accent-text underline underline-offset-2 hover:no-underline"
              >
                <Pencil className="w-3 h-3" aria-hidden="true" />
                <span>{t(lang, 'newsession.editKinds')}</span>
              </button>
            )}
          </div>
          <Select
            id="new-session-modality"
            value={modalityId ?? ''}
            onChange={(e) => {
              setModalityId(e.target.value || null);
              setTemplateId(null);
            }}
            className="h-11 pl-3 text-sm"
          >
            <option value="">{t(lang, 'common.noType')}</option>
            {modalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </Select>
          <p className="mt-1 text-[11px] text-content-muted font-medium">
            {t(lang, 'newsession.historyNote')
              .replace('{client}', clientName)
              .replace('{modality}', modalityName)}
          </p>
          {/* First run: the catalog is empty on purpose, so the picker says
              so and points at the room where types and scripts are born —
              instead of two bare selects that read as broken or fixed. */}
          {catalogEmpty && (
            <div className="mt-2 p-3 rounded-control border border-line-muted bg-surface-sunken text-[11px] text-content-muted font-medium">
              <p>{t(lang, 'newsession.noKinds')}</p>
              <p className="mt-1">{t(lang, 'newsession.blankHint')}</p>
              {onOpenCatalog && (
                <button
                  type="button"
                  onClick={onOpenCatalog}
                  className="mt-1.5 inline-flex items-center gap-1 font-bold text-accent-text underline underline-offset-2 hover:no-underline"
                >
                  <span>{t(lang, 'newsession.manageCatalog')}</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          )}
        </div>

        <div>
          <label
            htmlFor="new-session-template"
            className="block text-xs font-bold text-content uppercase tracking-wider mb-1.5"
          >
            {t(lang, 'newsession.script')}
          </label>
          <Select
            id="new-session-template"
            value={templateId ?? ''}
            onChange={(e) => setTemplateId(e.target.value || null)}
            className="h-11 pl-3 text-sm"
          >
            <option value="">{t(lang, 'newsession.blank')}</option>
            {offered.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.title}
                {tpl.modalityId ? '' : ` ${t(lang, 'newsession.general')}`}
              </option>
            ))}
          </Select>
          {chosen ? (
            <ScriptPreview
              markdown={chosen.markdown}
              editLabel={t(lang, 'newsession.editScript')}
              onEdit={onEditTemplate ? () => onEditTemplate(chosen) : undefined}
            />
          ) : offered.length === 0 && !catalogEmpty ? (
            <div className="mt-2 p-3 rounded-control border border-line-muted bg-surface-sunken text-[11px] text-content-muted font-medium">
              <p>{t(lang, 'newsession.noScripts')}</p>
              {onOpenCatalog && (
                <button
                  type="button"
                  onClick={onOpenCatalog}
                  className="mt-1.5 inline-flex items-center gap-1 font-bold text-accent-text underline underline-offset-2 hover:no-underline"
                >
                  <span>{t(lang, 'newsession.manageCatalog')}</span>
                  <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          ) : (
            <p className="mt-1 text-[11px] text-content-muted font-medium">
              {offered.length === 0 && !catalogEmpty
                ? t(lang, 'newsession.noScripts')
                : t(lang, 'newsession.dateOnly')}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="ctl">
            {t(lang, 'common.cancel')}
          </button>
          <button
            type="button"
            onClick={() => onConfirm(modalityId, chosen)}
            className="ctl ctl-primary"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            <span>{t(lang, 'newsession.start')}</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
