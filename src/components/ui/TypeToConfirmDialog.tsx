import React, { useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Modal } from './Modal';
import { t } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';

interface TypeToConfirmDialogProps {
  isOpen: boolean;
  title: string;
  description: React.ReactNode;
  /** The exact word that arms the button. Case-sensitive, deliberate. */
  requireWord?: string;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * For destructive actions with no undo.
 *
 * A plain confirm dialog is one mis-click away from disaster, and clinical
 * backups qualify: typing the word forces the hand to slow down and the eye
 * to read what is about to go. The match is exact and case-sensitive — a
 * "close enough" accept would defeat the whole ritual.
 */
export const TypeToConfirmDialog: React.FC<TypeToConfirmDialogProps> = ({
  isOpen,
  title,
  description,
  requireWord = 'APAGAR',
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}) => {
  const lang = useLang();
  const [typed, setTyped] = useState('');

  // Fresh ritual every open: a word typed for yesterday's deletion must not
  // arm today's.
  useEffect(() => {
    if (isOpen) setTyped('');
  }, [isOpen]);

  const armed = typed.trim() === requireWord;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onCancel}
      title={title}
      description={t(lang, 'confirm.noUndo')}
      icon={<AlertTriangle className="w-5 h-5" />}
      maxWidth="max-w-md"
      footer={
        <>
          <button type="button" onClick={onCancel} className="ctl">
            {cancelLabel ?? t(lang, 'common.cancel')}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={!armed}
            className="ctl ctl-danger"
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <div className="text-content">{description}</div>
        <div>
          <label
            htmlFor="type-to-confirm-input"
            className="block text-xs font-bold text-content uppercase tracking-wider mb-1.5"
          >
            {t(lang, 'confirm.typeToConfirm').split('{word}')[0]}
            <code className="font-mono">{requireWord}</code>
            {t(lang, 'confirm.typeToConfirm').split('{word}')[1]}
          </label>
          <input
            id="type-to-confirm-input"
            type="text"
            autoFocus
            autoComplete="off"
            autoCapitalize="characters"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            placeholder={requireWord}
            className="w-full h-11 px-3 text-sm font-mono rounded-control border border-line bg-surface-raised text-content placeholder:text-content-subtle"
          />
        </div>
      </div>
    </Modal>
  );
};
