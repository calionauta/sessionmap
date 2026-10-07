import React, { useEffect, useState } from 'react';
import { ArrowRight, Play } from 'lucide-react';
import { Modality, SessionTemplate } from '../../types';
import {
  loadModalities,
  loadTemplates,
  templatesFor,
} from '../../services/storage';
import { Modal } from '../ui/Modal';
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
}

/**
 * Picks the kind and the starting skeleton before a session exists.
 *
 * Two selects, deliberately, not one combined list: the kind is a PROPERTY
 * of the session (it drives the badge, the filter and the client's union),
 * while the template is a ONE-TIME body. Merging them would couple "this
 * session is a consult" to "it started from the consult skeleton", and a
 * consult session started blank would then be unrepresentable.
 */
export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  isOpen,
  onClose,
  clientName,
  defaultModalityId = null,
  onConfirm,
  onOpenCatalog,
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

  const openCatalog = () => {
    if (onOpenCatalog) {
      onOpenCatalog();
    }
  };

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
          <label
            htmlFor="new-session-modality"
            className="block text-xs font-bold text-content uppercase tracking-wider mb-1.5"
          >
            {t(lang, 'newsession.kind')}
          </label>
          <select
            id="new-session-modality"
            value={modalityId ?? ''}
            onChange={(e) => {
              setModalityId(e.target.value || null);
              setTemplateId(null);
            }}
            className="w-full h-11 px-3 text-sm rounded-control border border-line bg-surface-raised text-content font-medium"
          >
            <option value="">{t(lang, 'common.noType')}</option>
            {modalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
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
                  onClick={openCatalog}
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
          <select
            id="new-session-template"
            value={templateId ?? ''}
            onChange={(e) => setTemplateId(e.target.value || null)}
            className="w-full h-11 px-3 text-sm rounded-control border border-line bg-surface-raised text-content font-medium"
          >
            <option value="">{t(lang, 'newsession.blank')}</option>
            {offered.map((tpl) => (
              <option key={tpl.id} value={tpl.id}>
                {tpl.title}
                {tpl.modalityId ? '' : ` ${t(lang, 'newsession.general')}`}
              </option>
            ))}
          </select>
          {chosen ? (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap p-3 rounded-control border border-line bg-surface-sunken text-[11px] font-mono text-content-muted">
              {chosen.markdown}
            </pre>
          ) : offered.length === 0 && !catalogEmpty ? (
            <div className="mt-2 p-3 rounded-control border border-line-muted bg-surface-sunken text-[11px] text-content-muted font-medium">
              <p>{t(lang, 'newsession.noScripts')}</p>
              {onOpenCatalog && (
                <button
                  type="button"
                  onClick={openCatalog}
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
