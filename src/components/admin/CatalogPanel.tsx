import React, { useState } from 'react';
import { Check, Edit2, Layers, Plus, Trash2 } from 'lucide-react';
import { Modality, SessionTemplate } from '../../types';
import { ModalityBadge } from '../ui/ModalityBadge';
import { t } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';

interface CatalogPanelProps {
  modalities: Modality[];
  templates: SessionTemplate[];
  maps: { modalityId?: string | null }[];
  /** Parent persists: the panel only edits in memory. */
  onModalitiesChange: (next: Modality[]) => void;
  onTemplatesChange: (next: SessionTemplate[]) => void;
  /** Deleting a kind unclassifies sessions, so the parent confirms first. */
  onDeleteModalityRequest: (m: Modality) => void;
}

interface TemplateDraft {
  title: string;
  modalityId: string;
  markdown: string;
}

/**
 * Global catalog administration: kinds of work and starting skeletons.
 *
 * This used to live INSIDE one client's session history, which answered
 * "why is the configuration of everything filed under Ana?". Kinds belong
 * to no client — every session of every client picks one — so they get
 * their own tab, at the same level as the client list rather than under
 * one of its rows.
 */
export const CatalogPanel: React.FC<CatalogPanelProps> = ({
  modalities,
  templates,
  maps,
  onModalitiesChange,
  onTemplatesChange,
  onDeleteModalityRequest,
}) => {
  const [newModalityName, setNewModalityName] = useState('');
  const [editingModalityId, setEditingModalityId] = useState<string | null>(null);
  const [editingModalityName, setEditingModalityName] = useState('');
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const lang = useLang();
  const [templateDraft, setTemplateDraft] = useState<TemplateDraft>({
    title: '',
    modalityId: '',
    markdown: '',
  });

  const handleAddModality = (e: React.FormEvent) => {
    e.preventDefault();
    const name = newModalityName.trim();
    if (!name) return;
    onModalitiesChange([
      ...modalities,
      {
        id: `mod_${Date.now().toString(36)}`,
        name,
        color: null,
        createdAt: new Date().toISOString(),
      },
    ]);
    setNewModalityName('');
  };

  const handleRenameModality = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingModalityId || !editingModalityName.trim()) return;
    onModalitiesChange(
      modalities.map((m) =>
        m.id === editingModalityId ? { ...m, name: editingModalityName.trim() } : m
      )
    );
    setEditingModalityId(null);
  };

  const startTemplateDraft = (tpl: SessionTemplate | null) => {
    setEditingTemplateId(tpl ? tpl.id : 'new');
    setTemplateDraft(
      tpl
        ? { title: tpl.title, modalityId: tpl.modalityId ?? '', markdown: tpl.markdown }
        : { title: '', modalityId: '', markdown: '' }
    );
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateDraft.title.trim() || !templateDraft.markdown.trim()) return;
    const now = new Date().toISOString();
    if (editingTemplateId && editingTemplateId !== 'new') {
      onTemplatesChange(
        templates.map((tpl) =>
          tpl.id === editingTemplateId
            ? {
                ...tpl,
                title: templateDraft.title.trim(),
                modalityId: templateDraft.modalityId || null,
                markdown: templateDraft.markdown,
                updatedAt: now,
              }
            : tpl
        )
      );
    } else {
      onTemplatesChange([
        ...templates,
        {
          id: `tpl_${Date.now().toString(36)}`,
          title: templateDraft.title.trim(),
          modalityId: templateDraft.modalityId || null,
          markdown: templateDraft.markdown,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
    setEditingTemplateId(null);
  };

  const handleDeleteTemplate = (id: string) => {
    onTemplatesChange(templates.filter((tpl) => tpl.id !== id));
    if (editingTemplateId === id) setEditingTemplateId(null);
  };

  return (
    <div className="space-y-6">
      {/* Kinds */}
      <section aria-label={t(lang, 'catalog.types.aria')}>
        <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider">
          {t(lang, 'catalog.types.title').replace('{n}', String(modalities.length))}
        </h3>
        <p className="mt-1 text-[11px] text-content-muted font-medium">
          {t(lang, 'catalog.types.desc')}
        </p>
        <div className="mt-3 space-y-2">
          {modalities.map((m) => {
            const inUse = maps.filter((s) => s.modalityId === m.id).length;
            return (
              <div
                key={m.id}
                className="flex items-center gap-1.5 p-1.5 rounded-panel border border-line bg-surface"
              >
                {editingModalityId === m.id ? (
                  <form
                    onSubmit={handleRenameModality}
                    className="flex-1 min-w-0 flex items-center gap-1"
                  >
                    <label htmlFor={`catalog-rename-${m.id}`} className="sr-only">
                      {t(lang, 'catalog.types.renameOf').replace('{name}', m.name)}
                    </label>
                    <input
                      id={`catalog-rename-${m.id}`}
                      autoFocus
                      type="text"
                      value={editingModalityName}
                      onChange={(e) => setEditingModalityName(e.target.value)}
                      className="flex-1 min-w-0 h-10 px-2.5 text-xs rounded-control border border-line bg-surface-raised text-content"
                    />
                    <button
                      type="submit"
                      className="ctl ctl-primary w-10 px-0"
                      aria-label={t(lang, 'catalog.types.confirmRenameOf').replace('{name}', m.name)}
                    >
                      <Check className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </form>
                ) : (
                  <div className="flex-1 min-w-0 px-1">
                    <ModalityBadge modality={m} />
                    <div className="text-[11px] font-mono text-content-subtle mt-0.5">
                      {t(lang, inUse === 1 ? 'catalog.types.usage.one' : 'catalog.types.usage.many').replace('{n}', String(inUse))}
                    </div>
                  </div>
                )}
                {editingModalityId !== m.id && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        setEditingModalityId(m.id);
                        setEditingModalityName(m.name);
                      }}
                      aria-label={t(lang, 'catalog.types.renameType').replace('{name}', m.name)}
                      className="ctl w-10 px-0"
                    >
                      <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteModalityRequest(m)}
                      aria-label={t(lang, 'catalog.types.deleteType').replace('{name}', m.name)}
                      title={t(lang, 'catalog.types.deleteTitle')}
                      className="ctl ctl-danger w-10 px-0"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <form onSubmit={handleAddModality} className="flex items-center gap-1.5">
            <label htmlFor="catalog-new-modality-name" className="sr-only">
              {t(lang, 'catalog.types.newName')}
            </label>
            <input
              id="catalog-new-modality-name"
              type="text"
              value={newModalityName}
              onChange={(e) => setNewModalityName(e.target.value)}
              placeholder={t(lang, 'catalog.types.newPlaceholder')}
              className="flex-1 min-w-0 h-10 px-2.5 text-xs rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle"
            />
            <button
              type="submit"
              className="ctl ctl-primary h-10 px-3 text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t(lang, 'catalog.types.add')}</span>
            </button>
          </form>
        </div>
      </section>

      {/* Templates */}
      <section aria-label={t(lang, 'catalog.scripts.aria')}>
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider">
            {t(lang, 'catalog.scripts.title').replace('{n}', String(templates.length))}
          </h3>
          <button
            type="button"
            onClick={() => startTemplateDraft(null)}
            className="ctl h-9 px-2.5 text-[11px] font-bold"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{t(lang, 'catalog.scripts.add')}</span>
          </button>
        </div>
        <p className="mt-1 text-[11px] text-content-muted font-medium">
          {t(lang, 'catalog.scripts.desc')}
        </p>
        <div className="mt-3 space-y-2">
          {templates.map((tpl) => (
            <div key={tpl.id} className="p-2.5 rounded-panel border border-line bg-surface">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-content truncate">{tpl.title}</div>
                  <div className="mt-0.5">
                    <ModalityBadge
                      modality={modalities.find((m) => m.id === tpl.modalityId) ?? null}
                      fallbackLabel={t(lang, 'catalog.scripts.general')}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => startTemplateDraft(tpl)}
                    aria-label={t(lang, 'catalog.scripts.edit').replace('{title}', tpl.title)}
                    className="ctl w-10 px-0"
                  >
                    <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(tpl.id)}
                    aria-label={t(lang, 'catalog.scripts.delete').replace('{title}', tpl.title)}
                    className="ctl ctl-danger w-10 px-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {editingTemplateId === tpl.id && (
                <TemplateForm
                  draft={templateDraft}
                  onDraftChange={setTemplateDraft}
                  modalities={modalities}
                  submitLabel={t(lang, 'catalog.scripts.save')}
                  onSubmit={handleSaveTemplate}
                  onCancel={() => setEditingTemplateId(null)}
                />
              )}
            </div>
          ))}
          {editingTemplateId === 'new' && (
            <div className="p-2.5 rounded-panel border border-line bg-surface">
              <TemplateForm
                draft={templateDraft}
                onDraftChange={setTemplateDraft}
                modalities={modalities}
                submitLabel={t(lang, 'catalog.scripts.save')}
                onSubmit={handleSaveTemplate}
                onCancel={() => setEditingTemplateId(null)}
                autoFocus
              />
            </div>
          )}
          {templates.length === 0 && editingTemplateId === null && (
            <p className="p-4 text-center text-xs font-medium text-content-muted border-2 border-dashed border-line-muted rounded-panel flex items-center justify-center gap-1.5">
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              {t(lang, 'catalog.scripts.empty')}
            </p>
          )}
        </div>
      </section>
    </div>
  );
};

/**
 * One form for creating and editing: the two used to be 60-line copies,
 * which is how they drifted (different labels, different placeholders for
 * the same fields).
 */
function TemplateForm({
  draft,
  onDraftChange,
  modalities,
  submitLabel,
  onSubmit,
  onCancel,
  autoFocus = false,
}: {
  draft: { title: string; modalityId: string; markdown: string };
  onDraftChange: (d: { title: string; modalityId: string; markdown: string }) => void;
  modalities: Modality[];
  submitLabel: string;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  autoFocus?: boolean;
}) {
  const lang = useLang();
  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-2">
      <label className="block">
        <span className="sr-only">{t(lang, 'catalog.form.title')}</span>
        <input
          type="text"
          autoFocus={autoFocus}
          value={draft.title}
          onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
          placeholder={t(lang, 'catalog.form.titlePlaceholder')}
          className="w-full h-10 px-2.5 text-xs rounded-control border border-line bg-surface-raised text-content"
        />
      </label>
      <label className="block">
        <span className="sr-only">{t(lang, 'catalog.form.kind')}</span>
        <select
          value={draft.modalityId}
          onChange={(e) => onDraftChange({ ...draft, modalityId: e.target.value })}
          className="w-full h-10 px-2.5 text-xs rounded-control border border-line bg-surface-raised text-content font-bold"
        >
          <option value="">{t(lang, 'catalog.form.generalAll')}</option>
          {modalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="sr-only">{t(lang, 'catalog.form.text')}</span>
        <textarea
          value={draft.markdown}
          onChange={(e) => onDraftChange({ ...draft, markdown: e.target.value })}
          placeholder={t(lang, 'catalog.form.textPlaceholder')}
          rows={5}
          className="w-full p-2.5 text-xs font-mono rounded-control border border-line bg-surface-raised text-content"
        />
      </label>
      <div className="flex items-center justify-end gap-1.5">
        <button
          type="button"
          onClick={onCancel}
          className="ctl h-9 px-3 text-[11px] font-bold"
        >
          {t(lang, 'catalog.form.cancel')}
        </button>
        <button type="submit" className="ctl ctl-primary h-9 px-3 text-[11px] font-bold">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
