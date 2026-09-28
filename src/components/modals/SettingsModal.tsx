import React from 'react';
import { X, Sliders, Moon, Sun, Type, Clock, Eye, Sparkles } from 'lucide-react';
import { Settings } from '../../types';

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
  if (!isOpen) return null;

  const isDark = settings.theme === 'noite';

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    onUpdateSettings({ ...settings, [key]: value });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div
        className={`w-full max-w-lg rounded-2xl shadow-2xl border overflow-hidden flex flex-col ${
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <Sliders className="w-5 h-5 text-amber-700 dark:text-amber-400" />
            <div>
              <h3 className="text-base font-extrabold text-slate-950 dark:text-white">Configurações da Sessão</h3>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Ajuste a visualização e o ritmo de interação com o cliente
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-500 hover:text-slate-950 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="p-6 space-y-5 text-sm">
          {/* Theme */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-bold text-xs text-slate-900 dark:text-slate-100">Tema Visual</label>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Papel suave (claro) ou Noite acolhedora (escuro)
              </p>
            </div>
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => update('theme', 'papel')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  settings.theme === 'papel'
                    ? 'bg-slate-950 text-white shadow-xs'
                    : 'text-slate-700 hover:text-slate-950 dark:text-slate-300'
                }`}
              >
                <Sun className="w-3.5 h-3.5" />
                <span>Papel</span>
              </button>
              <button
                type="button"
                onClick={() => update('theme', 'noite')}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  settings.theme === 'noite'
                    ? 'bg-white text-slate-950 shadow-xs'
                    : 'text-slate-700 hover:text-slate-950 dark:text-slate-300'
                }`}
              >
                <Moon className="w-3.5 h-3.5" />
                <span>Noite</span>
              </button>
            </div>
          </div>

          <div className="w-full h-[1px] bg-slate-200 dark:bg-slate-800" />

          {/* Live text mode (RF-24) */}
          <div className="flex items-start justify-between gap-4">
            <div>
              <label className="font-bold text-xs text-slate-900 dark:text-slate-100">Exibição da Digitação na Janela do Cliente</label>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium leading-relaxed">
                <strong>Ao vivo:</strong> o cliente acompanha cada letra em tempo real.<br />
                <strong>Só ao confirmar:</strong> mostra apenas "digitando…" até você apertar Enter.
              </p>
            </div>
            <div className="flex items-center p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shrink-0">
              <button
                type="button"
                onClick={() => update('liveTextMode', 'live')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  settings.liveTextMode === 'live'
                    ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-xs'
                    : 'text-slate-700 hover:text-slate-950 dark:text-slate-300'
                }`}
              >
                Ao vivo
              </button>
              <button
                type="button"
                onClick={() => update('liveTextMode', 'confirm_only')}
                className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                  settings.liveTextMode === 'confirm_only'
                    ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-xs'
                    : 'text-slate-700 hover:text-slate-950 dark:text-slate-300'
                }`}
              >
                Só ao Enter
              </button>
            </div>
          </div>

          <div className="w-full h-[1px] bg-slate-200 dark:bg-slate-800" />

          {/* Thin bar always visible (RF-25) */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-bold text-xs text-slate-900 dark:text-slate-100">Barra Fina no Rodapé</label>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                {settings.thinBarAlwaysVisible
                  ? 'Permanece sempre visível na tela'
                  : 'Recolhe suavemente após 4s sem digitação'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => update('thinBarAlwaysVisible', !settings.thinBarAlwaysVisible)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                settings.thinBarAlwaysVisible
                  ? 'bg-amber-500'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white dark:bg-slate-950 w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  settings.thinBarAlwaysVisible ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="w-full h-[1px] bg-slate-200 dark:bg-slate-800" />

          {/* 3s Focus Dwell Duration (RF-33) */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" />
                <span>Tempo do Foco Automático no Outline</span>
              </label>
              <span className="text-xs font-mono font-bold text-slate-800 dark:text-slate-200">
                {settings.focusDwellSeconds === 0 ? 'Desligado' : `${settings.focusDwellSeconds} segundos`}
              </span>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-300 font-medium mb-2">
              Tempo com o cursor parado numa linha para iluminar o balão correspondente para você e para o cliente.
            </p>
            <input
              type="range"
              min="0"
              max="8"
              step="1"
              value={settings.focusDwellSeconds}
              onChange={(e) => update('focusDwellSeconds', Number(e.target.value))}
              className="w-full accent-amber-500 cursor-pointer"
            />
            <div className="flex justify-between text-[11px] font-mono text-slate-600 dark:text-slate-400 mt-1">
              <span>Desligado</span>
              <span className="font-bold text-amber-700 dark:text-amber-400">3s (recomendado)</span>
              <span>8s</span>
            </div>
          </div>

          <div className="w-full h-[1px] bg-slate-200 dark:bg-slate-800" />

          {/* Focus Zoom Mode */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-bold text-xs text-slate-900 dark:text-slate-100">Foco com Zoom no Nó (Pais e Filhos)</label>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                {settings.focusZoomMode
                  ? 'Aproxima com zoom no nó selecionado, mantendo visíveis seus pais e filhos'
                  : 'Mantém a visão panorâmica sem aproximar'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => update('focusZoomMode', !settings.focusZoomMode)}
              className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors cursor-pointer ${
                settings.focusZoomMode
                  ? 'bg-amber-500'
                  : 'bg-slate-300 dark:bg-slate-700'
              }`}
            >
              <div
                className={`bg-white dark:bg-slate-950 w-4 h-4 rounded-full shadow-md transform transition-transform ${
                  settings.focusZoomMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>

          <div className="w-full h-[1px] bg-slate-200 dark:bg-slate-800" />

          {/* Client Font Scale (RF-46) */}
          <div className="flex items-center justify-between">
            <div>
              <label className="font-bold text-xs text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                <Type className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                <span>Tamanho do Texto na Janela do Cliente</span>
              </label>
              <p className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                Ajuste para legibilidade ideal no vídeo compartilhado
              </p>
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              {[0.85, 1.0, 1.15, 1.3].map((scale) => (
                <button
                  key={scale}
                  type="button"
                  onClick={() => update('clientFontScale', scale)}
                  className={`px-2.5 py-1 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
                    settings.clientFontScale === scale
                      ? 'bg-slate-950 text-white dark:bg-white dark:text-slate-950 shadow-xs'
                      : 'text-slate-700 hover:text-slate-950 dark:text-slate-300'
                  }`}
                >
                  {Math.round(scale * 100)}%
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end px-6 py-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 text-xs font-bold text-white bg-slate-950 dark:bg-white dark:text-slate-950 rounded-xl hover:bg-slate-800 dark:hover:bg-slate-100 transition-colors shadow-xs cursor-pointer"
          >
            Concluir
          </button>
        </div>
      </div>
    </div>
  );
};
