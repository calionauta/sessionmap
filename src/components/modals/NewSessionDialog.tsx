import React, { useEffect, useState } from 'react';
import { Play } from 'lucide-react';
import { Modality, SessionTemplate } from '../../types';
import {
  loadModalities,
  loadTemplates,
  templatesFor,
} from '../../services/storage';
import { Modal } from '../ui/Modal';

interface NewSessionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  clientName: string;
  defaultModalityId?: string | null;
  onConfirm: (modalityId: string | null, template: SessionTemplate | null) => void;
}

/**
 * Picks the kind and the starting skeleton before a session exists.
 *
 * Two selects, deliberately, not one combined list: the kind is a PROPERTY
 * of the session (it drives the badge, the filter and the client's union),
 * while the template is a ONE-TIME body. Merging them would couple "this
 * session is therapy" to "it started from the therapy skeleton", and a
 * therapy session started blank would then be unrepresentable.
 */
export const NewSessionDialog: React.FC<NewSessionDialogProps> = ({
  isOpen,
  onClose,
  clientName,
  defaultModalityId = null,
  onConfirm,
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

  const offered = templatesFor(templates, modalityId);
  const chosen: SessionTemplate | null =
    offered.find((t) => t.id === templateId) ?? null;

  const modalityName =
    modalities.find((m) => m.id === modalityId)?.name ?? 'Sem tipo';

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={`Nova sessão · ${clientName}`}
      description="Escolha o tipo de atendimento e, se quiser, um roteiro inicial"
      icon={<Play className="w-5 h-5" />}
      maxWidth="max-w-lg"
    >
      <div className="space-y-4">
        <div>
          <label
            htmlFor="new-session-modality"
            className="block text-xs font-bold text-content uppercase tracking-wider mb-1.5"
          >
            Tipo de atendimento
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
            <option value="">Sem tipo</option>
            {modalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          <p className="mt-1 text-[11px] text-content-muted font-medium">
            A sessão entra para o histórico de {clientName} como {modalityName}.
          </p>
        </div>

        <div>
          <label
            htmlFor="new-session-template"
            className="block text-xs font-bold text-content uppercase tracking-wider mb-1.5"
          >
            Roteiro inicial
          </label>
          <select
            id="new-session-template"
            value={templateId ?? ''}
            onChange={(e) => setTemplateId(e.target.value || null)}
            className="w-full h-11 px-3 text-sm rounded-control border border-line bg-surface-raised text-content font-medium"
          >
            <option value="">Sessão em branco</option>
            {offered.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
                {t.modalityId ? '' : ' (geral)'}
              </option>
            ))}
          </select>
          {chosen ? (
            <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap p-3 rounded-control border border-line bg-surface-sunken text-[11px] font-mono text-content-muted">
              {chosen.markdown}
            </pre>
          ) : (
            <p className="mt-1 text-[11px] text-content-muted font-medium">
              {offered.length === 0
                ? 'Nenhum roteiro para este tipo ainda — crie um em Participantes & Sessões.'
                : 'Começa só com a data, como sempre.'}
            </p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="ctl">
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => onConfirm(modalityId, chosen)}
            className="ctl ctl-primary"
          >
            <Play className="w-4 h-4" aria-hidden="true" />
            <span>Iniciar sessão</span>
          </button>
        </div>
      </div>
    </Modal>
  );
};
