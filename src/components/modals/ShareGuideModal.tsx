import React, { useState } from 'react';
import { X, ShieldCheck, Monitor, Video, CheckCircle2, EyeOff } from 'lucide-react';

interface ShareGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenClientWindow: () => void;
  theme: 'papel' | 'noite';
}

export const ShareGuideModal: React.FC<ShareGuideModalProps> = ({
  isOpen,
  onClose,
  onOpenClientWindow,
  theme,
}) => {
  const [activeTab, setActiveTab] = useState<'zoom' | 'meet' | 'teams'>('meet');
  const isDark = theme === 'noite';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-xs">
      <div
        className={`w-full max-w-2xl rounded-2xl shadow-2xl border overflow-hidden flex flex-col max-h-[90vh] ${
          isDark ? 'bg-slate-900 border-slate-800 text-slate-100' : 'bg-white border-slate-200 text-slate-900'
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200/80 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-semibold">Guia: Compartilhamento Seguro</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Como mostrar apenas o mapa na chamada sem expor suas anotações privadas
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6 text-sm">
          {/* 3 Core Security Guarantees */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className={`p-3 rounded-xl border ${isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/70'}`}>
              <div className="flex items-center gap-2 font-medium text-xs mb-1 text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                <span>Janela Isolada</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                A janela do cliente só contém o mapa em balões. Zero menus ou outlines.
              </p>
            </div>

            <div className={`p-3 rounded-xl border ${isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/70'}`}>
              <div className="flex items-center gap-2 font-medium text-xs mb-1 text-emerald-600 dark:text-emerald-400">
                <EyeOff className="w-4 h-4 shrink-0" />
                <span>Título e URL Neutros</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                O título é apenas <strong>"Mapa"</strong>. Nenhum nome do cliente na aba ou na barra de endereço.
              </p>
            </div>

            <div className={`p-3 rounded-xl border ${isDark ? 'bg-slate-800/40 border-slate-700/60' : 'bg-slate-50 border-slate-200/70'}`}>
              <div className="flex items-center gap-2 font-medium text-xs mb-1 text-emerald-600 dark:text-emerald-400">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>Pausa Rápida (Ctrl+.)</span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Pressione Ctrl+. para trocar instantaneamente o mapa por uma tela calma.
              </p>
            </div>
          </div>

          {/* Platform Tabs */}
          <div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl mb-4">
              <button
                type="button"
                onClick={() => setActiveTab('meet')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activeTab === 'meet'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Google Meet
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('zoom')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activeTab === 'zoom'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Zoom
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('teams')}
                className={`flex-1 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  activeTab === 'teams'
                    ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                Microsoft Teams
              </button>
            </div>

            {/* Steps per platform */}
            <div className={`p-4 rounded-xl border space-y-3 ${isDark ? 'bg-slate-800/30 border-slate-700/60' : 'bg-slate-50 border-slate-200'}`}>
              {activeTab === 'meet' && (
                <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <li>Clique no botão abaixo para abrir a <strong>Janela do Cliente</strong>.</li>
                  <li>No Google Meet, clique no botão <strong>"Apresentar agora"</strong> (ícone de tela).</li>
                  <li>Escolha a opção <strong>"Uma janela"</strong> (ou "Uma guia"). <em>Nunca escolha "A tela inteira".</em></li>
                  <li>Selecione a janela com o nome <strong>"Mapa"</strong>.</li>
                  <li>Pronto! Você pode manter a sua janela privada em outro monitor ou lado a lado.</li>
                </ol>
              )}

              {activeTab === 'zoom' && (
                <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <li>Abra a janela do cliente no botão abaixo.</li>
                  <li>No Zoom, clique no botão verde <strong>"Compartilhar Tela" (Share Screen)</strong>.</li>
                  <li>Na aba <strong>Básico</strong>, escolha a janela que exibe apenas <strong>"Mapa"</strong>.</li>
                  <li>Verifique o retângulo verde ao redor da janela do mapa confirmando que só ela está visível ao cliente.</li>
                </ol>
              )}

              {activeTab === 'teams' && (
                <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                  <li>Abra a janela do cliente no botão abaixo.</li>
                  <li>No Teams, clique em <strong>"Compartilhar"</strong> na barra superior.</li>
                  <li>Na seção <strong>Janela</strong>, selecione a janela <strong>"Mapa"</strong>.</li>
                  <li>Suas anotações privadas e outras abas permanecem 100% invisíveis ao cliente.</li>
                </ol>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50">
          <span className="text-xs text-slate-500">
            Dica: organize as duas janelas lado a lado se tiver um único monitor.
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              Entendi
            </button>
            <button
              type="button"
              onClick={() => {
                onOpenClientWindow();
                onClose();
              }}
              className="px-4 py-2 text-xs font-medium text-white bg-slate-900 dark:bg-slate-100 dark:text-slate-900 rounded-lg hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors shadow-xs"
            >
              Abrir Janela do Cliente
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
