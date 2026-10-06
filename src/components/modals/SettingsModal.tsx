import React from 'react';
import { Sliders, Moon, Sun, Type, Eye } from 'lucide-react';
import { Settings } from '../../types';
import { t } from '../../i18n/strings';
import { Modal } from '../ui/Modal';
import { CloudBackupSection } from './CloudBackupSection';
import {
  Segmented,
  SettingRow,
  Switch,
  Divider,
} from '../ui/Controls';

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  settings: Settings;
  onUpdateSettings: (newSettings: Settings) => void;
  /** Re-reads storage after a cloud restore lands many records at once. */
  onCloudRestore?: () => void | Promise<void>;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
  onCloudRestore,
}) => {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };
  const lang = settings.language;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={t(lang, 'settings.title')}
      description={t(lang, 'settings.subtitle')}
      icon={<Sliders className="w-5 h-5" />}
      footer={
        <button type="button" onClick={onClose} className="ctl ctl-primary">
          {t(lang, 'settings.done')}
        </button>
      }
    >
      <div className="space-y-5 text-sm">
        <SettingRow
          id="language"
          label={t(lang, 'settings.language.label')}
          description={t(lang, 'settings.language.description')}
          control={
            <Segmented
              label={t(lang, 'settings.language.label')}
              value={settings.language}
              onChange={(v) => update('language', v)}
              options={[
                { value: 'pt', label: t(lang, 'settings.language.pt') },
                { value: 'en', label: t(lang, 'settings.language.en') },
              ]}
            />
          }
        />

        <Divider />

        <SettingRow
          id="theme"
          label={t(lang, 'settings.theme.label')}
          description={t(lang, 'settings.theme.description')}
          control={
            <Segmented
              label={t(lang, 'settings.theme.aria')}
              value={settings.theme}
              onChange={(v) => update('theme', v)}
              options={[
                { value: 'papel', label: t(lang, 'settings.theme.paper'), icon: <Sun className="w-3.5 h-3.5" /> },
                { value: 'noite', label: t(lang, 'settings.theme.night'), icon: <Moon className="w-3.5 h-3.5" /> },
              ]}
            />
          }
        />

        <Divider />

        <SettingRow
          id="live-text"
          align="start"
          label={t(lang, 'settings.typing.label')}
          description={
            <>
              <strong>{t(lang, 'settings.typing.liveStrong')}</strong> {t(lang, 'settings.typing.liveText')}
              <br />
              <strong>{t(lang, 'settings.typing.confirmStrong')}</strong> {t(lang, 'settings.typing.confirmText')}
            </>
          }
          control={
            <Segmented
              label={t(lang, 'settings.typing.aria')}
              value={settings.liveTextMode}
              onChange={(v) => update('liveTextMode', v)}
              options={[
                { value: 'live', label: t(lang, 'settings.typing.live') },
                { value: 'confirm_only', label: t(lang, 'settings.typing.confirm') },
              ]}
            />
          }
        />

        <Divider />

        <SettingRow
          id="thin-bar"
          label={t(lang, 'settings.thinbar.label')}
          description={
            settings.thinBarAlwaysVisible
              ? t(lang, 'settings.thinbar.on')
              : t(lang, 'settings.thinbar.off')
          }
          control={
            <Switch
              label={t(lang, 'settings.thinbar.aria')}
              checked={settings.thinBarAlwaysVisible}
              onChange={(v) => update('thinBarAlwaysVisible', v)}
            />
          }
        />

        <SettingRow
          id="focus-zoom"
          label={
            <>
              <Eye className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
              <span>{t(lang, 'settings.focus.label')}</span>
            </>
          }
          description={
            settings.focusZoomMode
              ? t(lang, 'settings.focus.on')
              : t(lang, 'settings.focus.off')
          }
          control={
            <Switch
              label={t(lang, 'settings.focus.aria')}
              checked={settings.focusZoomMode}
              onChange={(v) => update('focusZoomMode', v)}
            />
          }
        />

        <Divider />



        {/* Stacked, not side-by-side: the user's own suggestion, and the
            right one — a five-option ruler beside a long label squeezed both
            into unreadability. Title names it, the full-width ruler below is
            the gesture, the help lands last. */}
        <div className="space-y-2">
          <div className="font-bold text-xs text-content flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
            <span>{t(lang, 'settings.outlineFont.label')}</span>
          </div>
          <Segmented
            label={t(lang, 'settings.outlineFont.aria')}
            value={settings.outlineFontScale}
            onChange={(v) => update('outlineFontScale', v)}
            fluid
            options={[0.85, 1.0, 1.15, 1.3, 1.5].map((s) => ({
              value: s,
              label: `${Math.round(s * 100)}%`,
            }))}
          />
          <p className="text-xs text-content-muted font-medium leading-relaxed">
            {t(lang, 'settings.outlineFont.help')}
          </p>
        </div>

        <Divider />

        <div className="space-y-2">
          <div className="font-bold text-xs text-content flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
            <span>{t(lang, 'settings.clientFont.label')}</span>
          </div>
          <Segmented
            label={t(lang, 'settings.clientFont.aria')}
            value={settings.clientFontScale}
            onChange={(v) => update('clientFontScale', v)}
            fluid
            options={[0.85, 1.0, 1.15, 1.3, 1.5, 1.75].map((s) => ({
              value: s,
              label: `${Math.round(s * 100)}%`,
            }))}
          />
          <p className="text-xs text-content-muted font-medium leading-relaxed">
            {t(lang, 'settings.clientFont.helpA')} <strong>{t(lang, 'settings.clientFont.helpB')}</strong>{' '}
            {t(lang, 'settings.clientFont.helpC')}
            <br />
            {t(lang, 'settings.clientFont.helpD')}
          </p>
        </div>

        <CloudBackupSection
          settings={settings}
          onUpdateSettings={onUpdateSettings}
          onCloudRestore={onCloudRestore ?? (() => {})}
        />
      </div>
    </Modal>
  );
};
