import React from 'react';
import { Sliders, Moon, Sun, Type, Eye } from 'lucide-react';
import { Settings } from '../../types';
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

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configurações da Sessão"
      description="Ajuste a visualização e o ritmo de interação com o participante"
      icon={<Sliders className="w-5 h-5" />}
      footer={
        <button type="button" onClick={onClose} className="ctl ctl-primary">
          Concluir
        </button>
      }
    >
      <div className="space-y-5 text-sm">
        <SettingRow
          id="theme"
          label="Tema Visual"
          description="Papel suave (claro) ou Noite acolhedora (escuro)"
          control={
            <Segmented
              label="Tema visual"
              value={settings.theme}
              onChange={(v) => update('theme', v)}
              options={[
                { value: 'papel', label: 'Papel', icon: <Sun className="w-3.5 h-3.5" /> },
                { value: 'noite', label: 'Noite', icon: <Moon className="w-3.5 h-3.5" /> },
              ]}
            />
          }
        />

        <Divider />

        <SettingRow
          id="live-text"
          align="start"
          label="Exibição da Digitação na Janela do Participante"
          description={
            <>
              <strong>Ao vivo:</strong> o participante acompanha cada letra em tempo real.
              <br />
              <strong>Só ao confirmar:</strong> mostra apenas &quot;digitando…&quot;
              até você apertar Enter.
            </>
          }
          control={
            <Segmented
              label="Exibição da digitação"
              value={settings.liveTextMode}
              onChange={(v) => update('liveTextMode', v)}
              options={[
                { value: 'live', label: 'Ao vivo' },
                { value: 'confirm_only', label: 'Só ao Enter' },
              ]}
            />
          }
        />

        <Divider />

        <SettingRow
          id="thin-bar"
          label="Barra Fina no Rodapé"
          description={
            settings.thinBarAlwaysVisible
              ? 'Permanece sempre visível na tela'
              : 'Recolhe suavemente após 4s sem digitação'
          }
          control={
            <Switch
              label="Barra fina sempre visível"
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
              <span>Foco com Zoom no Nó (Pais e Filhos)</span>
            </>
          }
          description={
            settings.focusZoomMode
              ? 'Aproxima com zoom no nó selecionado, mantendo visíveis seus pais e filhos'
              : 'Mantém a visão panorâmica sem aproximar'
          }
          control={
            <Switch
              label="Foco com zoom no nó"
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
            <span>Tamanho da Fonte dos Tópicos</span>
          </div>
          <Segmented
            label="Escala da fonte dos tópicos"
            value={settings.outlineFontScale}
            onChange={(v) => update('outlineFontScale', v)}
            fluid
            options={[0.85, 1.0, 1.15, 1.3, 1.5].map((s) => ({
              value: s,
              label: `${Math.round(s * 100)}%`,
            }))}
          />
          <p className="text-xs text-content-muted font-medium leading-relaxed">
            Aumenta a letra com que você escreve e lê os tópicos na coluna da
            esquerda. A altura das linhas e a indentação crescem junto, para a
            hierarquia continuar legível.
          </p>
        </div>

        <Divider />

        <div className="space-y-2">
          <div className="font-bold text-xs text-content flex items-center gap-1.5">
            <Type className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
            <span>Fonte das Anotações do Participante</span>
          </div>
          <Segmented
            label="Escala da fonte das anotações do participante"
            value={settings.clientFontScale}
            onChange={(v) => update('clientFontScale', v)}
            fluid
            options={[0.85, 1.0, 1.15, 1.3, 1.5, 1.75].map((s) => ({
              value: s,
              label: `${Math.round(s * 100)}%`,
            }))}
          />
          <p className="text-xs text-content-muted font-medium leading-relaxed">
            O tamanho dos balões que o <strong>participante</strong> lê na segunda tela —
            ajuste para a distância da sala: quanto maior a sala, maior a fonte.
            <br />
            A prévia ao lado é o espelho dessa tela e acompanha o mesmo valor.
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
