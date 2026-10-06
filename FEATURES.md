# SessionMap — recursos

Inventário completo do que o app faz. Este arquivo é a fonte da verdade
para a [página pública](public/landing.html) e o [README](README.md):
toda capacidade nova ou removida atualiza os três juntos (ver `AGENTS.md`).

## Sessão ao vivo (duas janelas)

- **Janela do terapeuta (privada):** outline editável + prévia do mapa lado a lado.
- **Janela do cliente (`?view=client`):** só os balões, sem menus nem outline.
- **Espelho em tempo real:** cada letra, seleção e posição do cursor viajam por
  `BroadcastChannel` (com fallback via evento de storage); sem servidor, sem conta.
- **Barra de digitação única:** a mesma frase nos dois lados, some sozinha após
  ~1s parado — sem flicker.
- **Tela do cliente segue o cursor:** o mapa do cliente centraliza o tópico sob
  o cursor do terapeuta, sem precisar pausar para "alcançar".
- **Modo pausa (`Ctrl+.`):** troca a tela do cliente por uma tela calma na hora.
- **Título e URL neutros na janela B:** aba diz só "Mapa"; nome do cliente nunca
  aparece na tela compartilhada.
- **Tela cheia, cursor que se esconde e barra fina** que recolhe sozinha na
  janela do cliente (pensada para projeção).
- **Zoom no foco:** ao navegar, aproxima o nó atual + pais + filhos nas duas telas.
- **Status de conexão** terapeuta↔cliente com heartbeat e indicador na top bar.

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

## Clientes & sessões

- Cadastro, renomeação, busca, contagem de sessões; cliente demo só na estreia.
- **Notas privadas por cliente:** sobrevivem a trocas de sessão e **nunca** são
  transmitidas à janela do cliente.
- **Arquivar/restaurar** clientes (leva as sessões junto) e sessões avulsas.
- **Excluir com desfazer** (cliente volta com as sessões; sessão volta sozinha).
- **Sessões órfãs visíveis:** nada some em silêncio se o cliente sair da lista.
- **Importar `.md`** como sessão nova; numeração `Sessão N` por cliente.
- Painel em abas: **Clientes** (fluxo diário) e **Tipos e roteiros** (catálogo global).

## Tipos de atendimento e roteiros

- **Uma modalidade por sessão** (Terapia, Mentoria, Consultoria + as que você criar).
- **Badges derivados no cliente:** a união das sessões — ninguém é "de um tipo só".
- Filtro por tipo no histórico e no drawer; reclassificação posterior sem recriar.
- **Catálogo global editável** (criar/renomear/excluir; excluir vira "sem tipo", nunca apaga sessão).
- **Roteiros por tipo + gerais**, em Markdown, com preview; picker ao iniciar sessão.

## Exportação e backup local

- Por sessão: **Markdown, OPML, FreeMind (.mm), JSON, PNG, SVG**, copiar.
- **ZIP por cliente** e **ZIP geral**; backup JSON completo (envelope versionado
  com clientes, sessões, tipos e roteiros) **com restore** (aceita arquivos legados).
- Restore confirma contagens antes de escrever; tipos/roteiros somam, nunca renomeiam.

## Backup em nuvem (Puter, opcional, desligado por padrão)

- Opt-in em Configurações, em 3 passos: conectar → senha (≥12) → primeiro envio.
- **Cifragem no navegador (AES-256-GCM + PBKDF2-600k)** antes de subir; a nuvem só
  vê `{salt, iv, ct}`. **Senha só em memória** — recarregar pausa o automático.
- Status na top bar e no rodapé (`nuvem há 2h`, `aguardando senha`, `erro`, `nunca`).
- **Automático conservador:** ~1 min após salvar, só desbloqueado e online; nunca
  abre login sozinho; restore nunca é automático.
- Transparência: conta, lista de arquivos (nome/tamanho/data) e cota (100 MiB grátis).
- **Apagar tudo exige digitar APAGAR**; recomeço após senha esquecida sem perder o local.
- Sem Web Crypto (HTTP na LAN), a função se recusa a operar em vez de subir claro.

## Privacidade e dados

- **Offline-first:** IndexedDB + fallback em `localStorage`; persistência pedida
  ao navegador; funciona sem rede depois de carregado.
- Nada sai do navegador exceto o backup em nuvem opt-in (criptografado).
- Snapshots por sessão; migração segura do banco legado `narratips_db`.
- Largura, tema, fontes e sessão ativa lembrados entre reloads.

## Personalização

- Temas **papel/noite** aplicados antes da primeira pintura (sem flash claro).
- Escala de fonte dos tópicos e dos balões separadas; modos ao-vivo/só-ao-Enter;
  barra fina sempre visível ou temporária.

## Atalhos

| Onde | Teclas |
|---|---|
| Global | `Ctrl+.` pausa · `Ctrl+E` exportar · `Ctrl+Z` / `Ctrl+Shift+Z` desfazer/refazer (fora de texto) |
| Outline | `Enter` novo tópico · `Shift+Enter` quebra suave · `Tab`/`Shift+Tab` nível · `Esc` solta |
| Mapa | `+`/`-` zoom · setas pan/navegação · `Ctrl+0` enquadrar · `Enter`/`Espaço` selecionar |
| Painel | `Home` largura mínima · `Esc` fecha diálogos |
