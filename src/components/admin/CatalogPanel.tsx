import React, { useState } from 'react';
import { Check, Edit2, Layers, Plus, Trash2 } from 'lucide-react';
import { Modality, SessionTemplate } from '../../types';
import { ModalityBadge } from '../ui/ModalityBadge';

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

  const startTemplateDraft = (t: SessionTemplate | null) => {
    setEditingTemplateId(t ? t.id : 'new');
    setTemplateDraft(
      t
        ? { title: t.title, modalityId: t.modalityId ?? '', markdown: t.markdown }
        : { title: '', modalityId: '', markdown: '' }
    );
  };

  const handleSaveTemplate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!templateDraft.title.trim() || !templateDraft.markdown.trim()) return;
    const now = new Date().toISOString();
    if (editingTemplateId && editingTemplateId !== 'new') {
      onTemplatesChange(
        templates.map((t) =>
          t.id === editingTemplateId
            ? {
                ...t,
                title: templateDraft.title.trim(),
                modalityId: templateDraft.modalityId || null,
                markdown: templateDraft.markdown,
                updatedAt: now,
              }
            : t
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
    onTemplatesChange(templates.filter((t) => t.id !== id));
    if (editingTemplateId === id) setEditingTemplateId(null);
  };

  return (
    <div className="space-y-6">
      {/* Kinds */}
      <section aria-label="Tipos de atendimento">
        <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider">
          Tipos de atendimento ({modalities.length})
        </h3>
        <p className="mt-1 text-[11px] text-content-muted font-medium">
          Valem para todas as sessões, de qualquer participante. Cada sessão tem um
          tipo; cada participante pode ter vários.
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
                      Renomear {m.name}
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
                      aria-label={`Confirmar novo nome de ${m.name}`}
                    >
                      <Check className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </form>
                ) : (
                  <div className="flex-1 min-w-0 px-1">
                    <ModalityBadge modality={m} />
                    <div className="text-[11px] font-mono text-content-subtle mt-0.5">
                      {inUse} {inUse === 1 ? 'sessão' : 'sessões'}
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
                      aria-label={`Renomear tipo ${m.name}`}
                      className="ctl w-10 px-0"
                    >
                      <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteModalityRequest(m)}
                      aria-label={`Excluir tipo ${m.name}`}
                      title="Excluir tipo (sessões viram “sem tipo”)"
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
              Nome do novo tipo
            </label>
            <input
              id="catalog-new-modality-name"
              type="text"
              value={newModalityName}
              onChange={(e) => setNewModalityName(e.target.value)}
              placeholder="Novo tipo… ex. Supervisão"
              className="flex-1 min-w-0 h-10 px-2.5 text-xs rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle"
            />
            <button
              type="submit"
              className="ctl ctl-primary h-10 px-3 text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Tipo</span>
            </button>
          </form>
        </div>
      </section>

      {/* Templates */}
      <section aria-label="Roteiros iniciais">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-xs font-bold text-content-muted uppercase tracking-wider">
            Roteiros iniciais ({templates.length})
          </h3>
          <button
            type="button"
            onClick={() => startTemplateDraft(null)}
            className="ctl h-9 px-2.5 text-[11px] font-bold"
          >
            <Plus className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Roteiro</span>
          </button>
        </div>
        <p className="mt-1 text-[11px] text-content-muted font-medium">
          Esqueletos oferecidos ao iniciar uma sessão. Um roteiro de um tipo
          aparece só para aquele tipo; o geral aparece em todos.
        </p>
        <div className="mt-3 space-y-2">
          {templates.map((t) => (
            <div key={t.id} className="p-2.5 rounded-panel border border-line bg-surface">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-content truncate">{t.title}</div>
                  <div className="mt-0.5">
                    <ModalityBadge
                      modality={modalities.find((m) => m.id === t.modalityId) ?? null}
                      fallbackLabel="Geral"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => startTemplateDraft(t)}
                    aria-label={`Editar roteiro ${t.title}`}
                    className="ctl w-10 px-0"
                  >
                    <Edit2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteTemplate(t.id)}
                    aria-label={`Excluir roteiro ${t.title}`}
                    className="ctl ctl-danger w-10 px-0"
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
              {editingTemplateId === t.id && (
                <TemplateForm
                  draft={templateDraft}
                  onDraftChange={setTemplateDraft}
                  modalities={modalities}
                  submitLabel="Salvar roteiro"
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
                submitLabel="Salvar roteiro"
                onSubmit={handleSaveTemplate}
                onCancel={() => setEditingTemplateId(null)}
                autoFocus
              />
            </div>
          )}
          {templates.length === 0 && editingTemplateId === null && (
            <p className="p-4 text-center text-xs font-medium text-content-muted border-2 border-dashed border-line-muted rounded-panel flex items-center justify-center gap-1.5">
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              Nenhum roteiro. Crie o primeiro acima.
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
  return (
    <form onSubmit={onSubmit} className="mt-2 space-y-2">
      <label className="block">
        <span className="sr-only">Título do roteiro</span>
        <input
          type="text"
          autoFocus={autoFocus}
          value={draft.title}
          onChange={(e) => onDraftChange({ ...draft, title: e.target.value })}
          placeholder="Título do roteiro"
          className="w-full h-10 px-2.5 text-xs rounded-control border border-line bg-surface-raised text-content"
        />
      </label>
      <label className="block">
        <span className="sr-only">Tipo do roteiro</span>
        <select
          value={draft.modalityId}
          onChange={(e) => onDraftChange({ ...draft, modalityId: e.target.value })}
          className="w-full h-10 px-2.5 text-xs rounded-control border border-line bg-surface-raised text-content font-bold"
        >
          <option value="">Geral (todos os tipos)</option>
          {modalities.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      <label className="block">
        <span className="sr-only">Texto do roteiro em tópicos</span>
        <textarea
          value={draft.markdown}
          onChange={(e) => onDraftChange({ ...draft, markdown: e.target.value })}
          placeholder={'- Primeiro tópico\n  - Subtópico'}
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
          Cancelar
        </button>
        <button type="submit" className="ctl ctl-primary h-9 px-3 text-[11px] font-bold">
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
