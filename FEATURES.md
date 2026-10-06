# SessionMap — recursos

Inventário completo do que o app faz. Este arquivo é a fonte da verdade
para a [página pública](public/landing.html) e o [README](README.md):
toda capacidade nova ou removida atualiza os três juntos (ver `AGENTS.md`).

## Sessão ao vivo (duas janelas)

- **Janela do anfitrião (privada):** outline editável + prévia do mapa lado a lado.
- **Janela do participante (`?view=client`):** só os balões, sem menus nem outline.
- **Espelho em tempo real:** cada letra, seleção e posição do cursor viajam por
  `BroadcastChannel` (com fallback via evento de storage); sem servidor, sem conta.
- **Barra de digitação única:** a mesma frase nos dois lados, some sozinha após
  ~1s parado — sem flicker.
- **Tela do participante segue o cursor:** o mapa do participante centraliza o tópico sob
  o seu cursor, sem precisar pausar para "alcançar".
- **Apresentar na top bar:** `Apresentar` abre a tela do participante em nova janela; ao vivo, o indicador `Ao vivo` mostra o estado e `Encerrar apresentação` fecha. Sem pausa: encerrar e apresentar de novo cobre tudo.
- **Título e URL neutros na janela B:** aba diz só "Mapa"; nome do participante nunca
  aparece na tela compartilhada.
- **Tela cheia, cursor que se esconde e barra fina** que recolhe sozinha na
  janela do participante (pensada para projeção).
- **Zoom no foco:** ao navegar, aproxima o nó atual + pais + filhos nas duas telas.
- **Status de conexão** anfitrião↔participante com heartbeat (sem pílula separada de status na top bar).

## Outline (como se escreve)

- **Um textarea, linguagem Markdown:** `- tópico` com 2 espaços por nível;
  `#` na primeira linha nomeia a sessão.
- **Parser CommonMark de verdade** (marked): aceita `*`, `+`, listas numeradas,
  headings e parágrafos, e normaliza tudo para a forma canônica.
- **Enter** abre o próximo tópico no mesmo nível; **Enter em bullet vazio** encerra.
- **Tab / Shift+Tab** indentam o bloco; **Esc** solta o foco (o Tab é capturado).
- **Recortar/copiar/colar entre níveis** de graça, pelo próprio navegador.
- **Sem placeholder:** sessão vazia abre com uma linha editável, sem "Ponto Inicial".
- **Sem linhas em branco acumuladas:** folhas vazias são podadas ao trocar de sessão.
- **Undo/redo** (até 50 passos) fora de campos de texto; `Ctrl+Z` no texto é do navegador.
- **Autosave com debounce + rede de segurança:** `beforeunload` grava a raiz
  pendente e o próximo load reconcilia (só aplica se for mais nova).
- **Ajuda progressiva** embutida (botão `?`) e contagem de balões no cabeçalho.

## Mapa mental

- Zoom pela roda do mouse, `+`/`-`, botões; pan por arrasto e setas; `Ctrl+0` enquadra.
- Colapso de ramos, destaque do caminho selecionado, balão-fantasma do rascunho.
- **Navegação por teclado** (padrão árvore WAI-ARIA): setas, Home/End, Enter/Espaço.
- Nomes de acessibilidade por nível/posição; conectores decorativos ocultos de AT.
- Largura do painel de tópicos **persistida** (arrasto, setas, Home/Esc).
- **Maximizar outline ou mapa**; no celular, alternância tópicos↔mapa em tela cheia.

## Participantes & sessões

- Cadastro, renomeação, busca, contagem de sessões. Começa vazio: nenhum dado de exemplo.
- **Notas privadas por participante:** sobrevivem a trocas de sessão e **nunca** são
  transmitidas à janela do participante.
- **Arquivar/restaurar** participantes (leva as sessões junto) e sessões avulsas.
- **Excluir com desfazer** (participante volta com as sessões; sessão volta sozinha; o aviso some em 10s).
- **Sessões órfãs visíveis:** nada some em silêncio se o participante sair da lista.
- **Importar `.md`** como sessão nova; numeração `Sessão N` por participante.
- Painel em abas: **Participantes** (fluxo diário) e **Tipos e roteiros** (catálogo global).

## Tipos de atendimento e roteiros

- **Uma modalidade por sessão** (Mentoria, Consultoria, Reunião + as que você criar).
- **Badges derivados no participante:** a união das sessões — ninguém é "de um tipo só".
- Filtro por tipo no histórico e no drawer; reclassificação posterior sem recriar.
- **Catálogo global editável** (criar/renomear/excluir; excluir vira "sem tipo", nunca apaga sessão).
- **Roteiros por tipo + gerais**, em Markdown, com preview; picker ao iniciar sessão.

## Exportação e backup local

- Por sessão: **Markdown, OPML, FreeMind (.mm), JSON, PNG, SVG**, copiar.
- **ZIP por participante** e **ZIP geral**; backup JSON completo (envelope versionado
  com participantes, sessões, tipos e roteiros) **com restore** (aceita arquivos legados).
- Restore confirma contagens antes de escrever; tipos/roteiros somam, nunca renomeiam.

## Backup em nuvem (Puter, opcional, desligado por padrão)

- Opt-in em Configurações, em 3 passos: conectar → senha (≥12) → primeiro envio.
- **Cifragem no navegador (AES-256-GCM + PBKDF2-600k)** antes de subir; a nuvem só
  vê `{salt, iv, ct}`. **Senha só em memória** — recarregar pausa o automático.
- Status na top bar e no rodapé (`nuvem há 2h`, `aguardando senha`, `erro`, `nunca`).
- **Automático conservador:** ~1 min após você parar, teto de 5 min digitando sem
  parar, tentativa ao ocultar a aba; só desbloqueado e online; nunca
  abre login sozinho; restore nunca é automático.
- Transparência: conta, lista de arquivos (nome/tamanho/data) e cota (100 MiB grátis).
- **Apagar tudo exige digitar APAGAR**; recomeço após senha esquecida sem perder o local.
- Sem Web Crypto (HTTP na LAN), a função se recusa a operar em vez de subir claro.

## Privacidade e dados

- **Offline-first:** IndexedDB + fallback em `localStorage`; persistência pedida
  ao navegador; funciona sem rede depois de carregado.
- Nada sai do navegador exceto o backup em nuvem (criptografado), que vem desligado.
- Snapshots por sessão; migração segura do banco legado `narratips_db`.
- Largura, tema, fontes e sessão ativa lembrados entre reloads.

## Personalização

- Temas **papel/noite** aplicados antes da primeira pintura (sem flash claro).
- **Idioma PT/EN** em Configurações (PT padrão); vale para toda a interface e
  sincroniza `document.lang`. Sementes e roteiros ficam no idioma em que foram escritos.
  A página pública detecta o idioma do navegador na primeira visita e lembra a troca manual.
- Escala de fonte dos tópicos e dos balões separadas; modos ao-vivo/só-ao-Enter;
  barra fina sempre visível ou temporária.

## Atalhos

| Onde | Teclas |
|---|---|
| Global | `Ctrl+E` exportar · `Ctrl+Z` / `Ctrl+Shift+Z` desfazer/refazer (fora de texto) |
| Outline | `Enter` novo tópico · `Shift+Enter` quebra suave · `Tab`/`Shift+Tab` nível · `Esc` solta |
| Mapa | `+`/`-` zoom · setas pan/navegação · `Ctrl+0` enquadrar · `Enter`/`Espaço` selecionar |
| Painel | `Home` largura mínima · `Esc` fecha diálogos |
