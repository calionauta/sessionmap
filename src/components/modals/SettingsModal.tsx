import React from 'react';
import { Sliders, Moon, Sun, Type, Clock, Eye, Sparkles, MoveVertical } from 'lucide-react';
import { Settings } from '../../types';
import { Modal } from '../ui/Modal';
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
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  settings,
  onUpdateSettings,
}) => {
  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Configurações da Sessão"
      description="Ajuste a visualização e o ritmo de interação com o cliente"
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
          label="Exibição da Digitação na Janela do Cliente"
          description={
            <>
              <strong>Ao vivo:</strong> o cliente acompanha cada letra em tempo real.
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

        <Divider />

        <div>
          <div className="flex items-center justify-between mb-1">
            <div
              id="dwell-label"
              className="font-bold text-xs text-content flex items-center gap-1.5"
            >
              <Clock className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
              <span>Tempo do Foco Automático no Outline</span>
            </div>
            <span className="text-xs font-mono font-bold text-content">
              {settings.focusDwellSeconds === 0
                ? 'Desligado'
                : `${settings.focusDwellSeconds} segundos`}
            </span>
          </div>
          <p className="text-xs text-content-muted font-medium mb-3">
            Tempo com o cursor parado numa linha para iluminar o balão
            correspondente para você e para o cliente.
          </p>
          <input
            type="range"
            min="0"
            max="8"
            step="1"
            value={settings.focusDwellSeconds}
            onChange={(e) => update('focusDwellSeconds', Number(e.target.value))}
            aria-labelledby="dwell-label"
            aria-valuetext={
              settings.focusDwellSeconds === 0
                ? 'Desligado'
                : `${settings.focusDwellSeconds} segundos`
            }
            className="w-full accent-amber-500 cursor-pointer"
          />
          <div
            className="flex justify-between text-[11px] font-mono text-content-muted mt-1"
            aria-hidden="true"
          >
            <span>Desligado</span>
            <span className="font-bold text-accent-text">3s (recomendado)</span>
            <span>8s</span>
          </div>
        </div>

        <Divider />

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

        <SettingRow
          id="node-move"
          align="start"
          label={
            <>
              <MoveVertical className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
              <span>Mover Tópico para Outra Hierarquia</span>
            </>
          }
          description={
            settings.enableNodeMove ? (
              <>
                O botão <strong>Mover</strong> na linha — ou{' '}
                <strong>Ctrl+Shift+M</strong> (Cmd+Shift+M no Mac) — levanta o tópico,
                <strong>as setas</strong> escolhem o destino e <strong>Enter</strong>{' '}
                confirma. <strong>Esc</strong> cancela sem mudar nada. O tópico vai sempre
                como último filho, levando os subtópicos junto — para reordenar dentro do
                mesmo pai, use Alt+↑ e Alt+↓.
              </>
            ) : (
              'Desligado. Com ligado, um tópico pode ser movido para dentro de outro ramo, em vez de ser apagado e redigitado.'
            )
          }
          control={
            <Switch
              label="Permitir mover tópicos entre hierarquias"
              checked={settings.enableNodeMove}
              onChange={(v) => update('enableNodeMove', v)}
            />
          }
        />

        <Divider />

        <SettingRow
          id="font-scale"
          label={
            <>
              <Type className="w-3.5 h-3.5 text-accent-text" aria-hidden="true" />
              <span>Tamanho do Texto na Janela do Cliente</span>
            </>
          }
          description="Ajuste para legibilidade ideal no vídeo compartilhado"
          control={
            <Segmented
              label="Escala da fonte na janela do cliente"
              value={settings.clientFontScale}
              onChange={(v) => update('clientFontScale', v)}
              options={[0.85, 1.0, 1.15, 1.3].map((s) => ({
                value: s,
                label: `${Math.round(s * 100)}%`,
              }))}
            />
          }
        />
      </div>
    </Modal>
  );
};
