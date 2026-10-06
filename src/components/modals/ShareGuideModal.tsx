import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2, EyeOff } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Tabs, TabPanel } from '../ui/Tabs';
import { t, type Language } from '../../i18n/strings';
import { useLang } from '../../i18n/LanguageContext';

interface ShareGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenClientWindow: () => void;
  theme: 'papel' | 'noite';
}

type Platform = 'meet' | 'zoom' | 'teams';

const PLATFORM_ITEMS = [
  { value: 'meet' as const, label: 'Google Meet' },
  { value: 'zoom' as const, label: 'Zoom' },
  { value: 'teams' as const, label: 'Microsoft Teams' },
];

const buildSteps = (lang: Language): Record<Platform, React.ReactNode> => ({
  meet: (
    <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-content">
      <li>{t(lang, 'share.meet.s1')} <strong>{t(lang, 'share.windowName')}</strong>.</li>
      <li>{t(lang, 'share.meet.s2a')} <strong>{t(lang, 'share.ui.meetPresent')}</strong> {t(lang, 'share.meet.s2b')}</li>
      <li>
        {t(lang, 'share.meet.s3a')} <strong>{t(lang, 'share.ui.meetWindow')}</strong> {t(lang, 'share.meet.s3b')}{' '}
        <em>{t(lang, 'share.meet.s3c')}</em>
      </li>
      <li>{t(lang, 'share.meet.s4')} <strong>&quot;Mapa&quot;</strong>.</li>
      <li>{t(lang, 'share.meet.s5')}</li>
    </ol>
  ),
  zoom: (
    <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-content">
      <li>{t(lang, 'share.steps.openBelow')}</li>
      <li>{t(lang, 'share.zoom.s2')} <strong>{t(lang, 'share.ui.zoomShare')}</strong>.</li>
      <li>{t(lang, 'share.zoom.s3a')} <strong>{t(lang, 'share.ui.zoomBasic')}</strong>{t(lang, 'share.zoom.s3b')} <strong>&quot;Mapa&quot;</strong>.</li>
      <li>{t(lang, 'share.zoom.s4')}</li>
    </ol>
  ),
  teams: (
    <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-content">
      <li>{t(lang, 'share.steps.openBelow')}</li>
      <li>{t(lang, 'share.teams.s2a')} <strong>{t(lang, 'share.ui.teamsShare')}</strong> {t(lang, 'share.teams.s2b')}</li>
      <li>{t(lang, 'share.teams.s3a')} <strong>{t(lang, 'share.ui.teamsWindow')}</strong>{t(lang, 'share.teams.s3b')} <strong>&quot;Mapa&quot;</strong>.</li>
      <li>{t(lang, 'share.teams.s4')}</li>
    </ol>
  ),
});

interface Guarantee {
  id: string;
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}

const buildGuarantees = (lang: Language): Guarantee[] => [
  {
    id: 'isolated',
    icon: <CheckCircle2 className="w-4 h-4 shrink-0" />,
    title: t(lang, 'share.g.isolated.t'),
    body: t(lang, 'share.g.isolated.b'),
  },
  {
    id: 'neutral',
    icon: <EyeOff className="w-4 h-4 shrink-0" />,
    title: t(lang, 'share.g.neutral.t'),
    body: (
      <>
        {t(lang, 'share.g.neutral.b1')} <strong>&quot;Mapa&quot;</strong>. {t(lang, 'share.g.neutral.b2')}
      </>
    ),
  },
  {
    id: 'clean',
    icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
    title: t(lang, 'share.g.clean.t'),
    body: t(lang, 'share.g.clean.b'),
  },
];

export const ShareGuideModal: React.FC<ShareGuideModalProps> = ({
  isOpen,
  onClose,
  onOpenClientWindow,
}) => {
  const [activeTab, setActiveTab] = useState<Platform>('meet');
  const lang = useLang();
  const guarantees = buildGuarantees(lang);
  const steps = buildSteps(lang);

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(lang, 'share.title')}
      description={t(lang, 'share.subtitle')}
      icon={<ShieldCheck className="w-5 h-5" />}
      maxWidth="max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-xs text-content-subtle">
            {t(lang, 'share.tip')}
          </span>
          <button type="button" onClick={onClose} className="ctl">
            {t(lang, 'share.understood')}
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenClientWindow();
              onClose();
            }}
            className="ctl ctl-primary"
          >
            {t(lang, 'share.open')}
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 list-none p-0 m-0">
          {guarantees.map((g) => (
            <li
              key={g.id}
              className="p-3 rounded-panel border border-line bg-surface"
            >
              <div className="flex items-center gap-2 font-medium text-xs mb-1 text-positive">
                <span aria-hidden="true">{g.icon}</span>
                <span>{g.title}</span>
              </div>
              <p className="text-xs text-content-muted">{g.body}</p>
            </li>
          ))}
        </ul>

        <div>
          <Tabs
            idPrefix="share-platform"
            label={t(lang, 'share.tabs')}
            items={PLATFORM_ITEMS}
            value={activeTab}
            onChange={setActiveTab}
            className="mb-4"
            stretch
          />
          <TabPanel
            id={`share-platform-panel-${activeTab}`}
            labelledBy={`share-platform-tab-${activeTab}`}
            className="p-4 rounded-panel border border-line bg-surface"
          >
            {steps[activeTab]}
          </TabPanel>
        </div>
      </div>
    </Modal>
  );
};
