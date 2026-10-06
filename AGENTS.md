# AGENTS.md — instruções para agentes neste repo

## Comandos (bun)

```bash
bun install          # deps (CI usa --frozen-lockfile: commite bun.lock junto)
bun run dev          # http://localhost:3000
bun test             # suíte completa (happy-dom via bunfig preload)
bun run lint         # tsc --noEmit
bun run build        # dist/ — também valida o code-split do Puter
```

Portão de saída de qualquer mudança: `lint` limpo + `bun test` verde + `build` ok.
Teste de arquivo único: `bun test <path>`.

## Convenções

- Commits pequenos e focados, prefixo em minúsculas (`fix:`, `feat:`, `refactor:`,
  `chore:`, `test:`), descrição curta do porquê, não do quê.
- Release = push na `main` (workflow publica `dist/` no GitHub Pages).
- Testes co-localizados (`*.test.ts(x)` ao lado do fonte); testes "lint-shaped"
  (que leem o próprio fonte) existem e são intencionais — atualize-os junto.
- TypeScript estrito; sem `any` novo; `oldString` de edits deve ser único no arquivo.
- Português nas mensagens de usuário e comentários voltados ao anfitrião.

## Arquitetura (resumo)

- `HostView` (privada) + `ClientView` (`?view=client`, só balões) via
  `services/sync.ts` (BroadcastChannel + fallback throttled).
- Fonte da verdade local: IndexedDB (`services/storage.ts`) + `localStorage`.
- Um parse do buffer por texto (`liveTree`), um commit (`commitBuffer`).
- Sessão tem `modalityId`; participante nunca é classificado (badges = união derivada).
- `saveMap` carimba `updatedAt` por padrão; escrita de manutenção usa `{stamp:false}`.
- Nuvem Puter é opt-in e criptografada; `puterCloud.ts` é só transporte (dynamic import,
  fora do chunk inicial); segredo nunca persiste (há teste-canário que garante).

## REGRA DE SINCRONIA DE DOCS (obrigatória)

`FEATURES.md` é a fonte da verdade das capacidades. Qualquer mudança que
adicione, remova ou altere comportamento visível **atualiza os três juntos,
no mesmo commit**:

1. `FEATURES.md` — inventário completo (o que / onde / atalhos).
2. `README.md` — resumo + links (não duplicar o inventário, apontar para ele).
3. `public/landing.html` — página pública autocontida (CSS inline, sem build):
   hero, demo, passos, grade de recursos, footer. Vai para `dist/` no build —
   confira com `bun run build && ls dist/landing.html`.

Mudança só interna (refactor, fix invisível, teste): docs não precisam mudar.
Na dúvida, atualize o FEATURES.md — barato errar para esse lado.

## Verificação de docs

- Links da landing são relativos (`./`) para funcionar no Pages e local.
- Após editar a landing: `bun run build` e abrir `dist/landing.html`.
- Nunca inventar URLs: repo é `github.com/calionauta/sessionmap`,
  Pages em `https://calionauta.github.io/sessionmap/`.
