import React, { useState } from 'react';
import { ShieldCheck, CheckCircle2, EyeOff } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Tabs, TabPanel } from '../ui/Tabs';

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

const STEPS: Record<Platform, React.ReactNode> = {
  meet: (
    <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-content">
      <li>Clique no botão abaixo para abrir a <strong>Janela do Participante</strong>.</li>
      <li>No Google Meet, clique no botão <strong>&quot;Apresentar agora&quot;</strong> (ícone de tela).</li>
      <li>
        Escolha a opção <strong>&quot;Uma janela&quot;</strong> (ou &quot;Uma guia&quot;).{' '}
        <em>Nunca escolha &quot;A tela inteira&quot;.</em>
      </li>
      <li>Selecione a janela com o nome <strong>&quot;Mapa&quot;</strong>.</li>
      <li>Pronto! Você pode manter a sua janela privada em outro monitor ou lado a lado.</li>
    </ol>
  ),
  zoom: (
    <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-content">
      <li>Abra a janela do participante no botão abaixo.</li>
      <li>No Zoom, clique no botão verde <strong>&quot;Compartilhar Tela&quot; (Share Screen)</strong>.</li>
      <li>Na aba <strong>Básico</strong>, escolha a janela que exibe apenas <strong>&quot;Mapa&quot;</strong>.</li>
      <li>
        Verifique o retângulo verde ao redor da janela do mapa confirmando que só ela
        está visível ao participante.
      </li>
    </ol>
  ),
  teams: (
    <ol className="list-decimal list-inside space-y-2 text-xs leading-relaxed text-content">
      <li>Abra a janela do participante no botão abaixo.</li>
      <li>No Teams, clique em <strong>&quot;Compartilhar&quot;</strong> na barra superior.</li>
      <li>Na seção <strong>Janela</strong>, selecione a janela <strong>&quot;Mapa&quot;</strong>.</li>
      <li>Suas anotações privadas e outras abas permanecem 100% invisíveis ao participante.</li>
    </ol>
  ),
};

const GUARANTEES = [
  {
    icon: <CheckCircle2 className="w-4 h-4 shrink-0" />,
    title: 'Janela Isolada',
    body: 'A janela do participante só contém o mapa em balões. Zero menus ou outlines.',
  },
  {
    icon: <EyeOff className="w-4 h-4 shrink-0" />,
    title: 'Título e URL Neutros',
    body: (
      <>
        O título é apenas <strong>&quot;Mapa&quot;</strong>. Nenhum nome do participante na aba
        ou na barra de endereço.
      </>
    ),
  },
  {
    icon: <ShieldCheck className="w-4 h-4 shrink-0" />,
    title: 'Pausa Rápida (Ctrl+.)',
    body: 'Pressione Ctrl+. para trocar instantaneamente o mapa por uma tela calma.',
  },
];

export const ShareGuideModal: React.FC<ShareGuideModalProps> = ({
  isOpen,
  onClose,
  onOpenClientWindow,
}) => {
  const [activeTab, setActiveTab] = useState<Platform>('meet');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Guia: Compartilhamento Seguro"
      description="Como mostrar apenas o mapa na chamada sem expor suas anotações privadas"
      icon={<ShieldCheck className="w-5 h-5" />}
      maxWidth="max-w-2xl"
      footer={
        <>
          <span className="mr-auto text-xs text-content-subtle">
            Dica: organize as duas janelas lado a lado se tiver um único monitor.
          </span>
          <button type="button" onClick={onClose} className="ctl">
            Entendi
          </button>
          <button
            type="button"
            onClick={() => {
              onOpenClientWindow();
              onClose();
            }}
            className="ctl ctl-primary"
          >
            Abrir Janela do Participante
          </button>
        </>
      }
    >
      <div className="space-y-6">
        <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 list-none p-0 m-0">
          {GUARANTEES.map((g) => (
            <li
              key={g.title}
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
            label="Plataforma de videoconferência"
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
            {STEPS[activeTab]}
          </TabPanel>
        </div>
      </div>
    </Modal>
  );
};
