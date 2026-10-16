---
name: conferir-visual
description: Conferir visualmente uma página HTML do Robô Apex (landing em app/web/site, páginas do curso) em tela de computador e de celular, com o Edge sem janela, antes de dizer que está pronta. Use sempre que mexer em layout, imagens ou CSS.
---

# Conferir visual (barato e sem erro)

1. Sirva a pasta com o Python (só biblioteca padrão), numa porta livre:
   `python -m http.server 8791 --bind 127.0.0.1` dentro de `app/web` (a landing fica em `/site/index.html`).
2. Tire prints com o harness que já existe em `%TEMP%\ccpdf\cdp.mjs` (`abrir({porta, perfil, w, h})`, `b.ir(url)`
   aceita URL absoluta, `b.print(caminho)`, `b.js(expr)`). Use um perfil próprio (ex.: `edgecdp_site`) e feche
   o navegador no fim (`b.fechar()`); nunca mate processos que você não abriu.
3. Larguras obrigatórias: **1440** e **390** (celular). Role a página inteira em fatias de ~1 tela e olhe cada uma.
4. Antes de olhar, rode no navegador e corrija até dar zero:
   - imagens quebradas: `[...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.src)`
   - imagens deformadas: compare `i.clientWidth/i.clientHeight` com `i.naturalWidth/i.naturalHeight` (tolerância 2%,
     exceto as que usam `object-fit: cover` de propósito)
   - rolagem lateral: `document.documentElement.scrollWidth > innerWidth`
   - erros no console (`b.erros`).
5. Toda `img` precisa de `height: auto` (ou `aspect-ratio` + `object-fit`) quando tiver `width`/`height` no HTML.
6. Olhe os prints em tamanho reduzido (escala ~0,5) para economizar; abra só o trecho com problema em tamanho cheio.

Regras de conteúdo que valem sempre (CLAUDE.md): nada de promessa de lucro; todo número de print com ativo, tempo
gráfico, período, nº de operações e contratos; nome das estratégias borrado nos prints do site; sem nome de professor,
curso ou apostila.
