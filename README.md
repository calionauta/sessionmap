# SessionMap

Mapa mental em tempo real: você digita em tópicos e os
participantes acompanham o mapa, numa segunda janela ou projeção — **100% offline
e privado por padrão**.

- **Usar agora:** <https://calionauta.github.io/sessionmap/>
- **Como funciona:** [página pública](https://calionauta.github.io/sessionmap/landing.html)
- **Recursos completos:** [FEATURES.md](FEATURES.md)

## Como funciona (30 segundos)

1. Cadastre o participante em **Participantes & Sessões** e inicie uma sessão (escolha o
   tipo e, se quiser, um roteiro inicial).
2. Abra a **Janela do Participante** e projete/ compartilhe só ela.
3. Digite os tópicos: cada linha vira um balão na tela do participante, ao vivo.
4. `Ctrl+.` pausa a tela do participante a qualquer momento.

A janela do participante nunca mostra menus, outline, notas privadas nem o nome do
participante na aba — só o mapa.

## Privacidade

- Tudo fica no navegador (IndexedDB + `localStorage`); a sincronia entre as
  janelas usa `BroadcastChannel` local. Sem conta, sem servidor, sem tracking.
- Suas notas sobre cada participante nunca são transmitidas.
- O único dado que sai do navegador é o **backup em nuvem** ([Puter](https://puter.com)),
  desligado por padrão — você liga quando quiser,
  sempre criptografado no navegador (AES-256-GCM) com senha que só existe na sua
  memória. Desligado por padrão.

## Backup

- **Local:** backup JSON completo (sessões, participantes, tipos, roteiros) com
  restore, além de Markdown/OPML/FreeMind/PNG/SVG e ZIPs por participante ou geral.
- **Nuvem:** em Configurações → Backup em nuvem: conectar ao Puter, definir a
  senha, enviar manual ou automático (~1 min após salvar). Apagar tudo exige
  digitar `APAGAR`. Perdeu a senha? O local está intacto — recomece com uma
  nova que o próximo envio substitui o arquivo ilegível.

## Desenvolvimento

```bash
bun install
bun run dev      # http://localhost:3000
bun test         # 265 testes
bun run lint     # tsc --noEmit
bun run build    # dist/ (publicado no GitHub Pages pela main)
```

- Stack: React 19 + Vite 8 + Tailwind 4 + TypeScript; IndexedDB + `localStorage`.
- Deploy: push na `main` publica `dist/` no GitHub Pages.
- Convenções e sincronia de docs em [AGENTS.md](AGENTS.md).

## Estrutura

```
src/
  components/   # TherapistView, ClientView, mindmap, outline, modals, admin, ui
  services/     # storage (IDB), sync, export, cloudCrypto, puterCloud, cloudBackup
  utils/        # parser Markdown, árvore, layout, export
  types/        # MindMap, Client, Modality, SessionTemplate, Settings
public/
  landing.html  # página pública (vai para dist/ no build)
FEATURES.md     # inventário completo de recursos
AGENTS.md       # instruções para agentes (inclui regra de sincronia de docs)
```
