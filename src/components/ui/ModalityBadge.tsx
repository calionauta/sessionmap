import React from 'react';
import { Modality } from '../../types';
import { t } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';

/**
 * The kind dot + name shown on client rows, session cards and the drawer.
 *
 * A dot, not a chip with a background fill: the catalog colors are user data
 * (any hex), and white text on an arbitrary fill cannot promise contrast.
 * The dot carries the color, the text stays the theme's own.
 */
export const ModalityBadge: React.FC<{
  modality: Modality | null;
  fallbackLabel?: string;
}> = ({ modality, fallbackLabel }) => {
  const lang = useLang();
  const label = fallbackLabel ?? t(lang, 'common.noType');
  if (!modality) {
    return (
      <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-content-subtle">
        <span
          aria-hidden="true"
          className="w-2 h-2 rounded-full bg-content-subtle inline-block"
        />
        {label}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-content-muted">
      <span
        aria-hidden="true"
        className="w-2 h-2 rounded-full inline-block"
        style={{ backgroundColor: modality.color || 'var(--accent-text)' }}
      />
      {modality.name}
    </span>
  );
};
