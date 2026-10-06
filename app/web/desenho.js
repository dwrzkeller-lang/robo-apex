/* ROBÔ APEX — ferramentas de desenho estilo TradingView/Profit. A barra da esquerda é montada aqui, em grupos com menu:
   linhas (tendência, raio, estendida, seta, horizontal, raio horizontal, vertical, canal), Fibonacci (retração e
   projeção), formas, posição comprada/vendida, régua, pincel, texto e borracha. Com o cursor: clicar seleciona, arrastar
   move, as bolinhas ajustam; Ctrl+C / Ctrl+V / Ctrl+D copiam, colam e duplicam; Ctrl+Z / Ctrl+Y desfazem e refazem.
   Cada ponto é guardado como (horário, preço), então o desenho acompanha zoom e rolagem. Salvo por ativo em
   dados/estado_desenhos_<ativo>.json. */
(() => {
  "use strict";
  const AX = window.AX, $ = (id) => document.getElementById(id);
  const cv = $("desenho"), area = $("areaGrafico"), grafEl = $("chart"), nav = $("ferramentas"), ctx = cv.getContext("2d");

  // ---------------------------------------------------------------- ferramentas
  // n = cliques que criam o desenho (0 = não desenha nada); fixo = tem cores próprias (a cor/espessura do usuário não mudam nada)
  const FERR = {
    cursor: { nome: "Cursor", n: 0, ico: '<path d="M5 3l14 8-6 1.5L10 19z"/>',
      dica: "Cursor: clique num desenho para selecionar; arraste para mover ou puxe as bolinhas para ajustar. Delete apaga, Ctrl+C copia, Ctrl+V cola e Ctrl+D duplica." },
    tendencia: { nome: "Linha de tendência", n: 2, ico: '<path d="M5.5 17.7l13-11.4"/><circle cx="4" cy="19" r="2"/><circle cx="20" cy="5" r="2"/>',
      dica: "Linha de tendência: clique no primeiro ponto e depois no segundo (ou clique, arraste e solte)." },
    raio: { nome: "Raio", n: 2, ico: '<circle cx="5" cy="18" r="2"/><path d="M6.5 16.7L21 4"/>',
      dica: "Raio: clique onde ele começa e depois num segundo ponto. A linha segue sem fim nessa direção." },
    estendida: { nome: "Linha estendida", n: 2, ico: '<path d="M2 21l5.3-4.7M9.9 13.9l4.2-3.8M16.7 7.7L22 3"/><circle cx="8.6" cy="15" r="1.8"/><circle cx="15.4" cy="9" r="1.8"/>',
      dica: "Linha estendida: clique em dois pontos. A linha passa por eles e segue sem fim para os dois lados." },
    seta: { nome: "Seta", n: 2, ico: '<path d="M5 19L19 5M10 5h9v9"/>',
      dica: "Seta: clique onde ela começa e depois onde ela aponta." },
    horizontal: { nome: "Linha horizontal", n: 1, ico: '<path d="M2 12h7.5M14.5 12H22"/><circle cx="12" cy="12" r="2.5"/>',
      dica: "Linha horizontal: um clique marca o preço de ponta a ponta (suporte ou resistência)." },
    raioh: { nome: "Raio horizontal", n: 1, ico: '<circle cx="5" cy="12" r="2.5"/><path d="M7.5 12H22"/>',
      dica: "Raio horizontal: um clique marca o preço daquele candle até a borda direita." },
    vertical: { nome: "Linha vertical", n: 1, ico: '<path d="M12 2v7.5M12 14.5V22"/><circle cx="12" cy="12" r="2.5"/>',
      dica: "Linha vertical: um clique marca o horário de cima a baixo." },
    canal: { nome: "Canal paralelo", n: 3, ico: '<path d="M3 14L16 4M8 20l13-10"/><path d="M5.5 17l13-10" stroke-dasharray="2 3"/>',
      dica: "Canal paralelo: clique nos dois pontos da linha de base e dê um terceiro clique para definir a largura do canal." },
    fibo: { nome: "Retração de Fibonacci", n: 2, fixo: true, ico: '<path d="M3 5h18M3 10h18M3 14h18M3 19h18"/><path d="M6 19L18 5" stroke-dasharray="2 2.5"/>',
      dica: "Retração de Fibonacci: clique no início e depois no fim do movimento. Mostra 23,6%, 38,2%, 50%, 61,8% (zona de ouro), 78,6% e as extensões 127,2% e 161,8%." },
    fiboproj: { nome: "Projeção de Fibonacci", n: 3, fixo: true, ico: '<path d="M3 20l5-11 4 6"/><path d="M12 15h9M12 10h9M12 5h9"/>',
      dica: "Projeção de Fibonacci: clique no início da pernada (A), no fim (B) e no fim da correção (C). Mostra os alvos 61,8%, 100%, 127,2%, 161,8%, 200% e 261,8%." },
    retangulo: { nome: "Retângulo", n: 2, ico: '<rect x="4" y="6" width="16" height="12" rx="1"/>',
      dica: "Retângulo: clique num canto e depois no canto oposto (ou clique, arraste e solte)." },
    elipse: { nome: "Elipse", n: 2, ico: '<ellipse cx="12" cy="12" rx="9" ry="6"/>',
      dica: "Elipse: clique num canto e depois no canto oposto; a elipse fica dentro dessa caixa." },
    poscompra: { nome: "Posição comprada", n: 2, fixo: true, pos: 1, ico: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 14h16"/><path d="M12 11V6M9.5 8.5L12 6l2.5 2.5"/>',
      dica: "Posição comprada: clique na entrada e depois no alvo, acima. O stop nasce a meia distância (2 : 1); puxe as bolinhas para ajustar. Mostra risco, retorno e dinheiro por contrato." },
    posvenda: { nome: "Posição vendida", n: 2, fixo: true, pos: -1, ico: '<rect x="4" y="3" width="16" height="18" rx="1"/><path d="M4 10h16"/><path d="M12 13v5M9.5 15.5L12 18l2.5-2.5"/>',
      dica: "Posição vendida: clique na entrada e depois no alvo, abaixo. O stop nasce a meia distância (2 : 1); puxe as bolinhas para ajustar. Mostra risco, retorno e dinheiro por contrato." },
    regua: { nome: "Régua", n: 2, fixo: true, ico: '<path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/>',
      dica: "Régua: clique em dois pontos para medir pontos, %, candles e dinheiro por contrato." },
    pincel: { nome: "Pincel", n: 2, livre: true, ico: '<path d="M3 21c3 0 5-2 5-4s2-3 3-3l9-9-2-2-9 9c0 1-1 3-3 3s-4 2-4 5z"/>',
      dica: "Pincel: segure o clique e arraste para riscar à mão livre." },
    texto: { nome: "Texto", n: 1, ico: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>',
      dica: "Texto: clique no gráfico, escreva e aperte Enter (Esc cancela). Duplo clique num texto pronto edita." },
    borracha: { nome: "Borracha", n: 0, ico: '<path d="M4 16l8-8 6 6-5 5H8z"/><path d="M13 19h7"/>',
      dica: "Borracha: clique num desenho para apagar, ou segure o clique e passe por cima de vários." },
  };
  const ferr = (t) => (Object.prototype.hasOwnProperty.call(FERR, t) ? FERR[t] : null);
  // um botão por grupo na barra (mostra a última ferramenta usada do grupo); o triângulo do canto abre as outras
  const GRUPOS = [
    ["cursor", "Cursor", ["cursor"]],
    ["linhas", "Linhas", ["tendencia", "raio", "estendida", "seta", "horizontal", "raioh", "vertical", "canal"]],
    ["fibonacci", "Fibonacci", ["fibo", "fiboproj"]],
    ["formas", "Formas", ["retangulo", "elipse"]],
    ["posicao", "Posição", ["poscompra", "posvenda"]],
    ["medir", "Medir", ["regua"]],
    ["anotar", "Anotar", ["pincel", "texto"]],
    ["borracha", "Borracha", ["borracha"]],
  ];
  const ICO = {
    ima: '<path d="M6 3v8a6 6 0 0012 0V3h-4v8a2 2 0 01-4 0V3z"/>',
    olho: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.8"/>',
    olhoFechado: '<path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z"/><path d="M4 4l16 16"/>',
    desfazer: '<path d="M9 14L4 9l5-5"/><path d="M4 9h11a5 5 0 010 10h-3"/>',
    refazer: '<path d="M15 14l5-5-5-5"/><path d="M20 9H9a5 5 0 000 10h3"/>',
    lixo: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h3"/>',
    duplicar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7a2 2 0 002 2h3"/><path d="M14.5 12v5M12 14.5h5"/>',
  };
  // retração: nível = fim − razão × (fim − início); as razões negativas são as extensões (tracejadas)
  const FIBO = [[0, "0%", "#9aa5b5"], [0.236, "23,6%", "#8bc34a"], [0.382, "38,2%", "#ffaa3c"], [0.5, "50%", "#ff8c00"], [0.618, "61,8%", "#ffd700"],
    [0.786, "78,6%", "#c87828"], [1, "100%", "#9aa5b5"], [-0.272, "127,2%", "#22d3ee"], [-0.618, "161,8%", "#3b9cff"]];
  // projeção (A, B, C): alvo = C + razão × (B − A)
  const PROJ = [[0, "0%", "#9aa5b5"], [0.618, "61,8%", "#ffd700"], [1, "100%", "#ff8c00"], [1.272, "127,2%", "#22d3ee"], [1.618, "161,8%", "#3b9cff"],
    [2, "200%", "#b35cff"], [2.618, "261,8%", "#e056fd"]];
  const PRECOS = ["ent", "alvo", "stop"];            // preços das ferramentas de posição (ficam fora de pts)
  const CANTOS = [[0, 0], [1, 1], [0, 1], [1, 0]];   // alças do retângulo/elipse: de qual ponto vem o horário e de qual vem o preço
  const TOL = 6, FRACO = TOL - 0.5;                  // acerto do clique em px; dentro de uma área pintada o acerto é "fraco" e perde para uma linha por cima
  const LIMITE = 80, LARG_POS = 30, COR_PADRAO = "#ffd23f", FONTE = "11px Segoe UI, system-ui";
  const VERDE = "#22e39a", VERM = "#ff5c6e", CLARO = "#d9e0ea", PI2 = Math.PI * 2;
  const CLIP = "apex_desenho_clip", UI = "apex_desenho_ui";

  // ---------------------------------------------------------------- estado
  let desenhos = [], ferramenta = "cursor", selecionado = null, oculto = false;
  let chave = null, carregado = false, buscando = null, falhas = 0;      // ativo aberto e se a lista dele já veio do servidor
  let hist = ["[]"], hpos = 0, ultJunta = null, ultJuntaT = 0;
  let sujo = 0, assinatura = "", ultErro = "";
  let rascunho = null;      // desenho sendo criado: { tipo, pts, cur, n, cx, cy } (pincel: { tipo, pts, livre, ux, uy })
  let arrasto = null;       // desenho sendo movido (j < 0) ou ajustado pela alça j, com o cursor
  let apagando = null;      // borracha com o botão apertado
  let realce = null;        // desenho debaixo da borracha
  let vazio = null;         // clique no vazio: só tira a seleção se não virar arrasto do gráfico
  let pendTexto = null;     // ponto clicado com a ferramenta Texto (a caixa abre ao soltar o botão)
  let engolir = false;      // o "click" que vem depois de um pointerdown usado aqui não é de mais ninguém
  let segurando = false;    // botão apertado num clique que é dos desenhos (até soltar)
  let corViva = false;      // cor do selecionado mudando ao vivo no seletor, ainda sem retrato no histórico
  let ultClique = { id: null, t: 0, x: 0, y: 0 }, menuAberto = null, barraOn = false, clipMem = null, colaDe = 0, colas = 0;
  let Wp = 0, Hp = 0, x0 = null, passo = 0;                   // painel de preços (sem as escalas) e a reta x = x0 + índice × passo
  let largCss = 0, altCss = 0, dpr = 0, medidaNova = true;
  const mouse = { x: 0, y: 0, dentro: false }, tamBarra = [null, null];
  const geo = new Map();    // id → pontos em pixels deste quadro (o teste de clique reaproveita o que o redesenho calculou)

  const fin = Number.isFinite;
  const copia = (o) => JSON.parse(JSON.stringify(o));
  // id = hora + contador: nunca repete, nem no mesmo milissegundo (só Date.now() + Math.random() não garante isso:
  // num número desse tamanho cabem só ~4 mil frações diferentes)
  let seq = Math.floor(Math.random() * 1000);
  function novoId() { let id; do { id = Date.now() + (seq++ % 1000) / 1000; } while (desenhos.some((d) => d.id === id)); return id; }
  const porId = (id) => (id == null ? null : desenhos.find((d) => d.id === id) || null);
  const limite = (v, a, b) => Math.max(a, Math.min(b, v));
  const sujar = () => { sujo++; geo.clear(); };
  const temDados = () => !!(AX.D && AX.D.t && AX.D.t.length);
  const decimais = () => (AX.D && AX.D.meta.decimais >= 0 ? AX.D.meta.decimais : 2);
  const tick = () => Math.pow(10, -decimais());

  // ---------------------------------------------------------------- coordenadas
  const eixoT = () => AX.chart.timeScale();
  const barraSeg = () => (AX.D ? AX.D.meta.tf * 60 : 300);
  function idxDoTempo(t) {
    const T = AX.D.t, n = T.length;
    if (t <= T[0]) return (t - T[0]) / barraSeg();
    if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / barraSeg();
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return lo + (t - T[lo]) / Math.max(1, T[hi] - T[lo]);
  }
  // inverso exato de idxDoTempo: vale para índice quebrado (desenho feito em outro tempo gráfico) e para antes/depois dos candles
  function tempoDoIdx(i) {
    const T = AX.D.t, n = T.length;
    if (i <= 0) return T[0] + i * barraSeg();
    if (i >= n - 1) return T[n - 1] + (i - (n - 1)) * barraSeg();
    const k = Math.floor(i);
    return T[k] + (i - k) * (T[k + 1] - T[k]);
  }
  // A biblioteca só converte índice INTEIRO em x (para índice quebrado ela devolve 0, e o ponto ia parar na borda esquerda).
  // Como x é uma reta em função do índice, meço dois inteiros e calculo qualquer ponto por ela — é o que mantém no lugar
  // um desenho feito no 5 min quando ele é visto no 60 min, e o que deixa o pincel liso.
  function medirPainel() {
    const ts = eixoT(), a = ts.logicalToCoordinate(0), b = ts.logicalToCoordinate(1);
    Wp = ts.width(); Hp = altCss - ts.height();
    x0 = a; passo = a == null || b == null ? 0 : b - a;
  }
  const xDe = (t) => (x0 == null ? null : x0 + idxDoTempo(t) * passo);
  const yDe = (p) => AX.S.candle.priceToCoordinate(p);
  function xyDe(e) { const r = cv.getBoundingClientRect(); medirPainel(); return [e.clientX - r.left, e.clientY - r.top]; }
  function pontoXY(x, y, ima, livre) {
    let p = AX.S.candle.coordinateToPrice(y);
    if (p == null || x0 == null || !passo) return null;
    if (livre) return { t: Math.round(tempoDoIdx((x - x0) / passo)), p: +p.toFixed(Math.min(12, decimais() + 2)) };      // pincel: sem prender no candle (arredondado só para o arquivo não inchar)
    const k = Math.round((x - x0) / passo), D = AX.D;
    if (ima && k >= 0 && k <= AX.i) {                               // ímã: gruda na abertura/máxima/mínima/fechamento do candle
      let dist = 16;
      for (const v of [D.o[k], D.h[k], D.l[k], D.c[k]]) { const yy = yDe(v); if (yy != null && Math.abs(yy - y) < dist) { dist = Math.abs(yy - y); p = v; } }
    }
    return { t: tempoDoIdx(k), p };
  }
  function pxPorPreco() {            // quantos pixels vale 1 de preço agora (escala linear)
    if (!temDados()) return null;
    const ref = AX.D.c[AX.i], a = yDe(ref), b = yDe(ref * 1.01);
    return !ref || a == null || b == null ? null : Math.abs(b - a) / Math.abs(ref * 0.01);
  }
  function pix(d) {                  // pontos do desenho em pixels; null se a escala não consegue converter algum
    const guarda = d.id != null;
    let P = guarda ? geo.get(d.id) : undefined;
    if (P === undefined) {
      P = [];
      for (const q of d.pts) { const x = xDe(q.t), y = yDe(q.p); if (x == null || y == null) { P = null; break; } P.push([x, y]); }
      if (guarda) geo.set(d.id, P);
    }
    return P;
  }

  // ---------------------------------------------------------------- persistência
  const nomeChave = () => "desenhos_" + String(AX.ativo).replace(/[^A-Za-z0-9_\-.]/g, "_");
  function sanear(lista) {           // só entra o que dá para desenhar sem erro (inclusive o que a versão antiga salvou)
    const ok = [], vistos = new Set();
    for (const d of Array.isArray(lista) ? lista : []) {
      const F = d && typeof d === "object" ? ferr(d.tipo) : null;
      if (!F || !F.n || !Array.isArray(d.pts) || d.pts.length < F.n || !d.pts.every((q) => q && fin(q.t) && fin(q.p))) continue;
      if (F.pos && !(fin(d.ent) && fin(d.alvo) && fin(d.stop))) continue;
      if (d.tipo === "texto") { d.texto = String(d.texto == null ? "" : d.texto).slice(0, 120); if (!d.texto.trim()) continue; }
      if (d.id == null || vistos.has(d.id)) d.id = novoId();      // a seleção e o arrasto procuram o desenho pelo id
      vistos.add(d.id);
      if (typeof d.cor !== "string") d.cor = COR_PADRAO;
      if (!(d.esp >= 1 && d.esp <= 6)) d.esp = 2;
      ok.push(d);
    }
    return ok;
  }
  async function carregar() {
    if (!AX.ativo) return;
    const k = nomeChave();
    if (k !== chave) {                               // trocou de ativo: o que estava na fila para salvar é do anterior
      salvarJa();
      chave = k; carregado = false; falhas = 0; desenhos = []; hist = ["[]"]; hpos = 0; ultJunta = null;
      rascunho = null; arrasto = null; apagando = null; realce = null; pendTexto = null;
      if (editor.aberto) fecharEditor(false);
      selecionar(null); sujar(); pintarHist();
    } else if (carregado || buscando === k) return;
    buscando = k;
    let lista = null, falhou = false;
    try { lista = await AX.api.get(k); } catch (e) { falhou = true; }
    if (buscando === k) buscando = null;
    if (chave !== k || carregado) return;            // o usuário já foi para outro ativo
    if (falhou) {
      // Sem a lista do servidor NADA é salvo: gravar agora apagaria os desenhos guardados. Tenta de novo, cada vez mais
      // espaçado (até 30 s), avisando só na primeira falha.
      if (!falhas++) AX.toast("Não consegui ler os desenhos deste ativo; vou tentar de novo.", "aviso");
      setTimeout(() => { if (chave === k && !carregado) carregar(); }, Math.min(30000, 3000 * falhas));
      return;
    }
    const feitos = desenhos;                         // o que foi desenhado enquanto a lista não chegava continua valendo
    desenhos = sanear(lista).concat(feitos); carregado = true;
    hist = [JSON.stringify(desenhos)]; hpos = 0; ultJunta = null;
    sujar(); pintarHist();
    if (feitos.length) salvar();
  }
  let salvarT = null, pendente = null;
  function salvar() {
    if (!chave || !carregado) return;
    pendente = { k: chave, lista: desenhos };
    clearTimeout(salvarT); salvarT = setTimeout(salvarJa, 400);
  }
  function salvarJa() {
    clearTimeout(salvarT);
    const p = pendente; pendente = null;
    if (p) AX.api.set(p.k, p.lista).catch(() => AX.toast("Não consegui salvar os desenhos", "erro"));
  }

  // ---------------------------------------------------------------- histórico (desfazer / refazer)
  // Toda alteração confirmada passa por aqui: redesenha, guarda um retrato da lista inteira e salva. Um arrasto chama
  // isto uma vez só, ao soltar o botão. "junta" funde mexidas repetidas em seguida (setas do teclado) num passo só.
  function gravar(junta) {
    sujar();
    const s = JSON.stringify(desenhos), agora = Date.now();
    if (s === hist[hpos]) return;
    if (junta && junta === ultJunta && agora - ultJuntaT < 900 && hpos > 0 && hpos === hist.length - 1) hist[hpos] = s;
    else { hist.length = hpos + 1; hist.push(s); if (hist.length > LIMITE + 1) hist.shift(); hpos = hist.length - 1; }
    ultJunta = junta || null; ultJuntaT = agora;
    pintarHist(); salvar();
  }
  function passoHist(dir) {          // −1 desfaz, +1 refaz
    firmarCor();
    if (arrasto) { cancelarArrasto(); return; }
    if (largar()) return;                            // com um desenho pela metade, Ctrl+Z só desiste dele
    const alvo = hpos + dir;
    if (alvo < 0 || alvo >= hist.length) { AX.toast(dir < 0 ? "Nada para desfazer." : "Nada para refazer.", "aviso"); return; }
    if (editor.aberto) fecharEditor(false);
    hpos = alvo; desenhos = JSON.parse(hist[hpos]); ultJunta = null;
    if (oculto) olho(false);
    if (porId(selecionado)) atualizarBarra(); else selecionar(null);
    sujar(); pintarHist(); salvar();
  }
  function pintarHist() {
    const semDesf = hpos <= 0, semRef = hpos >= hist.length - 1;
    desfEl.classList.toggle("dz-apagado", semDesf); desfEl.setAttribute("aria-disabled", String(semDesf));
    refEl.classList.toggle("dz-apagado", semRef); refEl.setAttribute("aria-disabled", String(semRef));
  }

  // ---------------------------------------------------------------- barra lateral (montada aqui, em grupos)
  const svg = (m) => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${m}</svg>`;
  function cria(tag, cls, attrs) {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    for (const k in attrs || {}) el.setAttribute(k, attrs[k]);
    return el;
  }
  // todo botão leva o nome em aria-label e a explicação em data-dica (as dicas da tela leem esse atributo; nada de title)
  function botao(cls, nome, dica, ico) {
    const b = cria("button", cls, { type: "button", "aria-label": nome, "data-dica": dica });
    if (ico) b.innerHTML = svg(ico);                 // só ícones fixos deste arquivo: texto do usuário nunca passa por innerHTML
    return b;
  }
  const grupos = {}, grupoDe = {};
  nav.textContent = "";
  for (const [gid, gnome, itens] of GRUPOS) {
    const cx = cria("div", "dz-grupo"), bt = botao("", FERR[itens[0]].nome, FERR[itens[0]].dica);
    const g = (grupos[gid] = { cx, bt, itens, atual: itens[0], mostra: null, mais: null, menu: null, longo: false });
    for (const f of itens) grupoDe[f] = gid;
    cx.appendChild(bt); nav.appendChild(cx);
    bt.addEventListener("click", () => { if (g.longo) { g.longo = false; return; } fecharMenu(); usar(g.atual); });
    if (itens.length < 2) continue;
    g.mais = botao("dz-mais", "Mais ferramentas: " + gnome, `Abre as outras ferramentas de ${gnome}. Também abre segurando o clique no botão ou com o botão direito.`);
    g.mais.setAttribute("aria-haspopup", "true"); g.mais.setAttribute("aria-expanded", "false");
    cx.appendChild(g.mais);
    g.menu = cria("div", "dz-menu oculto", { role: "menu", "aria-label": gnome });
    const tit = cria("div", "dz-titulo"); tit.textContent = gnome; g.menu.appendChild(tit);
    for (const f of itens) {
      const it = botao("", FERR[f].nome, FERR[f].dica, FERR[f].ico), s = cria("span");
      it.dataset.f = f; it.setAttribute("role", "menuitem"); s.textContent = FERR[f].nome; it.appendChild(s);
      it.addEventListener("click", () => { fecharMenu(); usar(f); });
      g.menu.appendChild(it);
    }
    document.body.appendChild(g.menu);               // fora da barra: ela tem rolagem própria e cortaria o menu
    g.mais.addEventListener("click", () => abrirMenu(g));
    cx.addEventListener("contextmenu", (e) => { e.preventDefault(); if (menuAberto !== g) abrirMenu(g); });
    let espera = null;                               // segurar o clique no botão também abre o menu
    bt.addEventListener("pointerdown", (e) => {
      g.longo = false; clearTimeout(espera);
      if (e.button === 0) espera = setTimeout(() => { g.longo = true; if (menuAberto !== g) abrirMenu(g); }, 450);
    });
    for (const ev of ["pointerup", "pointerleave", "pointercancel"]) bt.addEventListener(ev, () => clearTimeout(espera));
  }
  nav.appendChild(cria("div", "sep"));
  const imaEl = botao("toggle", "Ímã", "Ímã: ligado, os pontos grudam na abertura, máxima, mínima ou fechamento do candle debaixo do mouse.", ICO.ima);
  const olhoEl = botao("toggle", "Mostrar ou ocultar desenhos", "Mostrar/ocultar desenhos: esconde todos sem apagar nada. Clique de novo para mostrar.", ICO.olho);
  const corEl = cria("input", "", { type: "color", "aria-label": "Cor dos próximos desenhos",
    "data-dica": "Cor dos próximos desenhos. Para mudar um desenho pronto, clique nele e use a barrinha que aparece ao lado." });
  const espEl = cria("select", "", { "aria-label": "Espessura dos próximos desenhos", "data-dica": "Espessura da linha dos próximos desenhos (no texto, o tamanho da letra)." });
  const desfEl = botao("", "Desfazer", "Desfazer a última alteração nos desenhos (Ctrl+Z).", ICO.desfazer);
  const refEl = botao("", "Refazer", "Refazer o que foi desfeito (Ctrl+Y ou Ctrl+Shift+Z).", ICO.refazer);
  const limpaEl = botao("", "Apagar todos", "Apagar todos os desenhos deste ativo. Se foi sem querer, Ctrl+Z traz de volta.", ICO.lixo);
  imaEl.id = "ima"; olhoEl.id = "olhoDesenhos"; corEl.id = "corDesenho"; espEl.id = "espDesenho"; desfEl.id = "desfazer"; refEl.id = "refazer"; limpaEl.id = "limparDesenhos";
  imaEl.setAttribute("aria-pressed", "false"); olhoEl.setAttribute("aria-pressed", "false");
  for (const v of [1, 2, 3, 4]) { const o = cria("option", "", { value: v }); o.textContent = v; espEl.appendChild(o); }
  corEl.value = COR_PADRAO; espEl.value = "2";
  nav.append(imaEl, olhoEl, corEl, espEl, desfEl, refEl, limpaEl);

  const imaLigado = () => imaEl.classList.contains("on");
  const estilo = () => ({ cor: corEl.value, esp: +espEl.value || 2 });
  function lerUi() { try { return JSON.parse(localStorage.getItem(UI) || "{}") || {}; } catch (e) { return {}; } }
  function salvarUi() {              // lembra, só neste navegador: última ferramenta de cada grupo, cor, espessura e ímã
    const ult = {}; for (const k in grupos) ult[k] = grupos[k].atual;
    try { localStorage.setItem(UI, JSON.stringify({ grupos: ult, cor: corEl.value, esp: +espEl.value, ima: imaLigado() })); } catch (e) { /* sem armazenamento: só não lembra */ }
  }
  imaEl.onclick = () => { imaEl.setAttribute("aria-pressed", String(imaEl.classList.toggle("on"))); salvarUi(); };
  olhoEl.onclick = () => olho();
  // tirar o foco do campo depois da escolha: com o foco num <input>/<select>, Delete e Ctrl+C não chegam aos desenhos
  corEl.onchange = () => { salvarUi(); corEl.blur(); };
  espEl.onchange = () => { salvarUi(); espEl.blur(); };
  desfEl.onclick = () => passoHist(-1);
  refEl.onclick = () => passoHist(1);
  limpaEl.onclick = () => {
    const n = desenhos.length;
    if (!n) { AX.toast("Não há desenhos neste ativo.", "aviso"); return; }
    if (!confirm(n === 1 ? "Apagar o desenho deste ativo?" : `Apagar os ${n} desenhos deste ativo?`)) return;
    largar(); desenhos = []; selecionar(null); gravar();
    AX.toast("Desenhos apagados. Ctrl+Z traz de volta.", "ok");
  };

  function pintarGrupos() {
    for (const k in grupos) {
      const g = grupos[k], F = FERR[g.atual], on = g.atual === ferramenta;
      if (g.mostra !== g.atual) {
        g.mostra = g.atual; g.bt.innerHTML = svg(F.ico); g.bt.dataset.f = g.atual; g.bt.dataset.dica = F.dica; g.bt.setAttribute("aria-label", F.nome);
        if (g.menu) g.menu.querySelectorAll("button").forEach((b) => b.classList.toggle("on", b.dataset.f === g.atual));
      }
      g.bt.classList.toggle("on", on); g.bt.setAttribute("aria-pressed", String(on));
    }
  }
  function abrirMenu(g) {
    if (menuAberto === g) { fecharMenu(); return; }
    fecharMenu(); menuAberto = g;
    g.menu.classList.remove("oculto"); g.cx.classList.add("aberto"); g.mais.setAttribute("aria-expanded", "true");
    const r = g.cx.getBoundingClientRect(), n = nav.getBoundingClientRect(), mw = g.menu.offsetWidth, mh = g.menu.offsetHeight;
    const deitada = n.width > n.height;              // tela estreita: a barra fica deitada e o menu abre para baixo
    g.menu.style.left = Math.max(4, Math.min(deitada ? r.left : n.right + 4, window.innerWidth - mw - 4)) + "px";
    g.menu.style.top = Math.max(4, Math.min(deitada ? n.bottom + 4 : r.top, window.innerHeight - mh - 4)) + "px";
  }
  function fecharMenu() {
    const g = menuAberto; if (!g) return;
    menuAberto = null; g.menu.classList.add("oculto"); g.cx.classList.remove("aberto"); g.mais.setAttribute("aria-expanded", "false");
  }
  document.addEventListener("pointerdown", (e) => { const g = menuAberto; if (g && !g.menu.contains(e.target) && !g.cx.contains(e.target)) fecharMenu(); }, true);
  for (const ev of ["resize", "blur", "scroll"]) window.addEventListener(ev, fecharMenu);     // o menu é fixo na tela: se ela muda, fecha
  nav.addEventListener("scroll", fecharMenu);

  function usar(f) {
    if (!ferr(f)) f = "cursor";
    if (editor.aberto) fecharEditor(true);
    ferramenta = f; rascunho = null; apagando = null; realce = null; pendTexto = null; arrasto = null;
    if (f !== "cursor") {
      selecionar(null);
      if (oculto) olho(false);                       // desenhar com tudo escondido não mostraria nada
      const g = grupos[grupoDe[f]];
      if (g.atual !== f) { g.atual = f; salvarUi(); }
    }
    pintarGrupos();
    cv.classList.toggle("ativo", f !== "cursor");
    cv.style.cursor = f === "borracha" ? "not-allowed" : f === "texto" ? "text" : "crosshair";
    area.style.cursor = "";
    sujar();
  }
  function olho(v) {
    oculto = v == null ? !oculto : !!v;
    olhoEl.classList.toggle("on", oculto); olhoEl.setAttribute("aria-pressed", String(oculto));
    olhoEl.innerHTML = svg(oculto ? ICO.olhoFechado : ICO.olho);
    if (oculto) { if (ferramenta !== "cursor") usar("cursor"); selecionar(null); }
    sujar();
  }

  // ---------------------------------------------------------------- barrinha do desenho selecionado
  const barra = cria("div", "dz-barra oculto", { role: "toolbar", "aria-label": "Desenho selecionado" });
  const bCor = cria("input", "dz-estilo", { type: "color", "aria-label": "Cor do desenho selecionado", "data-dica": "Cor do desenho selecionado." });
  const bEsp = botao("dz-estilo", "Espessura do desenho selecionado", "Espessura do desenho selecionado: cada clique passa para a seguinte (1, 2, 3, 4). No texto, muda o tamanho da letra.");
  const bTraco = cria("span", "dz-traco");
  const bDup = botao("", "Duplicar", "Duplicar: cria uma cópia do desenho selecionado um pouco ao lado (Ctrl+D).", ICO.duplicar);
  const bCop = botao("", "Copiar", "Copiar o desenho selecionado (Ctrl+C). Cole com Ctrl+V onde o mouse estiver; vale até em outro ativo.", ICO.copiar);
  const bDel = botao("", "Apagar", "Apagar o desenho selecionado (tecla Delete).", ICO.lixo);
  bEsp.appendChild(bTraco);
  barra.append(bCor, bEsp, cria("span", "dz-div dz-estilo"), bDup, bCop, bDel);
  area.appendChild(barra);
  // a cor muda ao vivo enquanto o seletor está aberto; o retrato do histórico (um só) fica para quando ele fecha —
  // ou para quando a seleção muda, caso o navegador não avise o fechamento
  const firmarCor = () => { if (corViva) { corViva = false; gravar(); } };
  bCor.oninput = () => { const d = porId(selecionado); if (d) { d.cor = bCor.value; corViva = true; sujar(); } };
  bCor.onchange = () => { firmarCor(); bCor.blur(); };
  bEsp.onclick = () => { const d = porId(selecionado); if (d) { d.esp = ((d.esp | 0) % 4) + 1; atualizarBarra(); gravar(); } };
  bDup.onclick = () => duplicar();
  bCop.onclick = () => copiar();
  bDel.onclick = () => apagarSel();
  function selecionar(id) {
    if (id === selecionado) return;
    firmarCor();
    selecionado = id; atualizarBarra(); sujar();
  }
  function atualizarBarra() {
    const d = porId(selecionado); if (!d) return;
    barra.classList.toggle("dz-fixo", !!FERR[d.tipo].fixo);
    if (/^#[0-9a-f]{6}$/i.test(d.cor)) bCor.value = d.cor;
    bTraco.style.height = limite(d.esp || 2, 1, 6) + "px";
  }
  function posBarra() {              // acima do canto direito do desenho, sempre dentro do gráfico; some enquanto ele é arrastado
    const d = !oculto && ferramenta === "cursor" && !editor.aberto && !(arrasto && arrasto.moveu) ? porId(selecionado) : null;
    const P = d ? pix(d) : null, c = P ? caixaDe(d, P) : null;
    if (!c) { if (barraOn) { barra.classList.add("oculto"); barraOn = false; } return; }
    if (!barraOn) { barra.classList.remove("oculto"); barraOn = true; }
    const v = FERR[d.tipo].fixo ? 1 : 0, tam = tamBarra[v] || (tamBarra[v] = [barra.offsetWidth, barra.offsetHeight]);   // medida uma vez por formato, não a cada quadro
    const bw = tam[0], bh = tam[1], folga = FERR[d.tipo].pos ? 30 : 12;
    let x = c[2] - c[0] >= bw ? c[2] - bw : (c[0] + c[2]) / 2 - bw / 2, y = c[1] - bh - folga;
    if (y < 4) y = c[3] + folga;                     // sem espaço em cima: vai para baixo do desenho
    if (y + bh > Hp - 4 && c[1] - bh - folga < 4) y = 4;
    x = limite(x, 4, Math.max(4, Wp - bw - 4)); y = limite(y, 4, Math.max(4, Hp - bh - 4));
    barra.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
  }

  // ---------------------------------------------------------------- texto (caixa no lugar do clique, sem prompt)
  const editor = { el: cria("input", "dz-texto oculto", { type: "text", maxlength: "120", placeholder: "Escreva e aperte Enter", "aria-label": "Texto da anotação", autocomplete: "off", spellcheck: "false" }),
    aberto: false, id: null, pt: null };
  area.appendChild(editor.el);
  const tamTexto = (d) => 10 + (d.esp || 2) * 2;
  const fonteTexto = (d) => `${tamTexto(d)}px Segoe UI, system-ui`;
  function caixaTexto(d, P) {        // [x, y, largura, altura] do texto na tela
    ctx.save(); ctx.font = fonteTexto(d);
    const w = ctx.measureText(d.texto || "").width, h = tamTexto(d) * 1.4;
    ctx.restore();
    return [P[0][0], P[0][1] - h / 2, w + 8, h];
  }
  function abrirEditor(d, pt) {      // d = texto existente (edição) ou null (novo, no ponto pt)
    const el = editor.el, est = d || estilo();
    editor.aberto = true; editor.id = d ? d.id : null; editor.pt = d ? { t: d.pts[0].t, p: d.pts[0].p } : pt;
    el.value = d ? d.texto || "" : "";
    el.style.color = est.cor; el.style.fontSize = tamTexto(est) + "px";
    el.classList.remove("oculto"); larguraEditor(); posEditor(); sujar();
    el.focus(); el.select();
  }
  function larguraEditor() {
    const el = editor.el;
    ctx.save(); ctx.font = `${el.style.fontSize} Segoe UI, system-ui`;
    const w = ctx.measureText(el.value || el.placeholder).width;
    ctx.restore();
    el.style.width = Math.ceil(w) + 24 + "px";
  }
  function posEditor() {
    const x = xDe(editor.pt.t), y = yDe(editor.pt.p);
    if (x == null || y == null) return;
    editor.el.style.left = Math.round(limite(x, 2, Math.max(2, largCss - 90))) + "px";
    editor.el.style.top = Math.round(limite(y, 14, Math.max(14, altCss - 14))) + "px";
  }
  function fecharEditor(ok) {
    if (!editor.aberto) return;
    editor.aberto = false;                           // antes de tudo: o blur() logo abaixo volta a chamar esta função
    const el = editor.el, txt = el.value.trim().slice(0, 120), id = editor.id, pt = editor.pt;
    editor.id = null; editor.pt = null; el.classList.add("oculto");
    if (document.activeElement === el) el.blur();
    let criado = null;
    if (ok && txt) {
      if (id == null) criado = novo("texto", [pt], { texto: txt });
      else { const d = porId(id); if (d && d.texto !== txt) { d.texto = txt; gravar(); } }
    }
    if (ferramenta === "texto") usar("cursor");
    if (criado) selecionar(criado.id);
    sujar();
  }
  editor.el.addEventListener("keydown", (e) => {
    e.stopPropagation();                             // o que se digita aqui não é atalho do gráfico
    if (e.isComposing) return;
    if (e.key === "Enter") { e.preventDefault(); fecharEditor(true); }
    else if (e.key === "Escape") { e.preventDefault(); fecharEditor(false); }
  });
  editor.el.addEventListener("input", larguraEditor);
  editor.el.addEventListener("blur", () => fecharEditor(true));

  // ---------------------------------------------------------------- criar, mover, ajustar
  function precoNaBase(d, t) {       // preço da linha de base do canal no horário t
    const i0 = idxDoTempo(d.pts[0].t), i1 = idxDoTempo(d.pts[1].t);
    return Math.abs(i1 - i0) < 1e-9 ? d.pts[0].p : d.pts[0].p + ((d.pts[1].p - d.pts[0].p) * (idxDoTempo(t) - i0)) / (i1 - i0);
  }
  const offCanal = (d) => d.pts[2].p - precoNaBase(d, d.pts[2].t);
  // o 3º ponto do canal só guarda a distância da paralela; fica sempre no meio dela, onde a alça é desenhada
  function centrarCanal(d, off) {
    const t = tempoDoIdx((idxDoTempo(d.pts[0].t) + idxDoTempo(d.pts[1].t)) / 2);
    d.pts[2] = { t, p: precoNaBase(d, t) + off };
  }
  // dos pontos clicados ao objeto que vai para a lista; a prévia tracejada usa a mesma função, então mostra o que vai nascer
  function montar(tipo, pts) {
    const d = Object.assign({ tipo, pts: pts.map((q) => ({ t: q.t, p: q.p })) }, estilo()), s = FERR[tipo].pos;
    if (s && pts.length > 1) {
      const a = pts[0], b = pts[1], tk = tick(), dist = (b.p - a.p) * s;
      d.ent = a.p;
      if (dist >= 0) { const g = Math.max(dist, 2 * tk); d.alvo = a.p + s * g; d.stop = a.p - (s * g) / 2; }     // 2º clique = alvo; o stop nasce na metade (2 : 1)
      else { const r = Math.max(-dist, tk); d.stop = a.p - s * r; d.alvo = a.p + s * 2 * r; }                    // clicou do lado contrário: vale como stop, alvo no dobro
      let i1 = idxDoTempo(a.t), i2 = idxDoTempo(b.t);
      if (Math.abs(i2 - i1) < 2) i2 = i1 + LARG_POS;                                                             // 2º clique na coluna da entrada: largura padrão
      d.pts = [{ t: tempoDoIdx(Math.min(i1, i2)), p: a.p }, { t: tempoDoIdx(Math.max(i1, i2)), p: a.p }];
    } else if (tipo === "canal" && pts.length > 2) centrarCanal(d, offCanal(d));
    return d;
  }
  function novo(tipo, pts, extra) {
    const d = Object.assign(montar(tipo, pts), extra, { id: novoId() });
    desenhos.push(d); gravar();
    return d;
  }
  function previa() {
    const r = rascunho;
    if (r.livre) return r.pts.length > 1 ? montar(r.tipo, r.pts) : null;
    return montar(r.tipo, r.pts.concat([r.cur]));
  }
  function concluir() {              // o desenho pronto fica selecionado e a ferramenta volta para o cursor
    const r = rascunho; rascunho = null;
    const d = novo(r.tipo, r.pts);
    usar("cursor"); selecionar(d.id);
  }
  function largar() {                // abandona o que estiver pela metade (Esc, botão direito, Ctrl+Z)
    const tinha = !!(rascunho || apagando || pendTexto), apagou = !!(apagando && apagando.mudou);
    rascunho = null; apagando = null; pendTexto = null;
    if (apagou) gravar(); else if (tinha) sujar();
    return tinha;
  }
  // mover o desenho inteiro: todos os pontos andam o mesmo número de BARRAS (pelo índice, então atravessa fim de semana
  // e passa do último candle) e a mesma diferença de preço
  function deslocar(d, db, dp) {
    for (const q of d.pts) { if (db) q.t = tempoDoIdx(idxDoTempo(q.t) + db); q.p += dp; }
    for (const k of PRECOS) if (fin(d[k])) d[k] += dp;
  }
  function repor(d, o) { d.pts = o.pts.map((q) => ({ t: q.t, p: q.p })); for (const k of PRECOS) if (k in o) d[k] = o[k]; }
  function ajustar(d, j, p) {        // a alça j foi puxada para o ponto p
    const q = d.pts, s = FERR[d.tipo].pos, tk = tick();
    if (d.tipo === "horizontal") q[0].p = p.p;
    else if (d.tipo === "vertical") q[0].t = p.t;
    else if (d.tipo === "retangulo" || d.tipo === "elipse") { q[CANTOS[j][0]].t = p.t; q[CANTOS[j][1]].p = p.p; }
    else if (d.tipo === "canal") {
      if (j < 2) { const off = offCanal(d); q[j] = { t: p.t, p: p.p }; centrarCanal(d, off); }                  // mexer na base mantém a largura do canal
      else centrarCanal(d, p.p - precoNaBase(d, p.t));
    } else if (s) {
      if (j === 0) { const a = Math.min(d.stop, d.alvo) + tk, b = Math.max(d.stop, d.alvo) - tk; if (a <= b) d.ent = limite(p.p, a, b); q[0].t = p.t; }
      else if (j === 1) d.alvo = s > 0 ? Math.max(p.p, d.ent + tk) : Math.min(p.p, d.ent - tk);                 // o alvo não atravessa a entrada
      else if (j === 2) d.stop = s > 0 ? Math.min(p.p, d.ent - tk) : Math.max(p.p, d.ent + tk);
      else q[1].t = p.t;
      q[0].p = q[1].p = d.ent;
    } else q[j] = { t: p.t, p: p.p };
  }
  function cancelarArrasto() {
    const a = arrasto, d = a && porId(a.id);
    arrasto = null; area.style.cursor = "";
    if (d) repor(d, a.orig);
    sujar(); salvar();                               // se algum salvamento saiu no meio do arrasto, este devolve o original ao servidor
  }
  function apagarSel() {
    const d = porId(selecionado); if (!d) return false;
    desenhos.splice(desenhos.indexOf(d), 1); selecionar(null); gravar();
    return true;
  }

  // ---------------------------------------------------------------- copiar, colar, duplicar
  function fazerClip(d) {            // guarda também as distâncias em barras e a escala da tela, para colar em outro ativo
    const i0 = idxDoTempo(d.pts[0].t);
    return { ativo: AX.ativo, quando: novoId(), pxp: pxPorPreco(), rel: d.pts.map((q) => idxDoTempo(q.t) - i0), d: copia(d) };     // quando = hora + fração: nunca repete
  }
  function copiar() {
    const d = porId(selecionado); if (!d || !temDados()) return;
    clipMem = fazerClip(d);
    try { localStorage.setItem(CLIP, JSON.stringify(clipMem)); } catch (e) { /* sem armazenamento: vale só nesta aba */ }
    AX.toast("Desenho copiado. Ctrl+V cola onde o mouse estiver.", "ok");
  }
  function lerClip() {               // o mais novo entre a memória desta aba e o que outra aba deixou no navegador
    let c = null;
    try { c = JSON.parse(localStorage.getItem(CLIP) || "null"); } catch (e) { c = null; }
    if (!c || typeof c !== "object" || !sanear([c.d]).length || (clipMem && !(c.quando >= clipMem.quando))) c = clipMem;
    return c || null;
  }
  function inserirCopia(c, noMouse) {
    if (!c || !temDados()) return;
    if (ferramenta !== "cursor") usar("cursor");
    if (oculto) olho(false);
    medirPainel();
    const d = copia(c.d), n = d.pts.length, b0 = idxDoTempo(d.pts[0].t), base = d.pts[0].p, mesmo = c.ativo === AX.ativo;
    // em outro ativo os horários e os preços não se correspondem: vale a forma (barras entre os pontos) e a altura em
    // pixels que o desenho tinha na tela de origem; no mesmo ativo os horários e os preços são os verdadeiros
    const rel = !mesmo && Array.isArray(c.rel) && c.rel.length === n && c.rel.every(fin) ? c.rel : d.pts.map((q) => idxDoTempo(q.t) - b0);
    const pxp = pxPorPreco(), f = !mesmo && c.pxp > 0 && pxp > 0 ? c.pxp / pxp : 1;
    let i0 = null, p0 = null;
    if (noMouse && mouse.dentro && mouse.x >= 0 && mouse.x <= Wp && mouse.y >= 0 && mouse.y <= Hp && passo) {     // 1º ponto debaixo do mouse
      const p = AX.S.candle.coordinateToPrice(mouse.y);
      if (p != null) { i0 = Math.round((mouse.x - x0) / passo); p0 = p; }
    }
    if (i0 == null && mesmo) {                                                                                    // um pouco ao lado do original
      if (colaDe !== c.quando) { colaDe = c.quando; colas = 0; }                                                  // colar a mesma cópia de novo vai mais um passo, sem empilhar
      colas++; i0 = b0 + 3 * colas; p0 = base - colas * (pxp > 0 ? 14 / pxp : Math.abs(base) * 0.002);
    }
    if (i0 == null) {                                                                                             // outro ativo, mouse fora: no meio da tela
      const r = eixoT().getVisibleLogicalRange(), pc = AX.S.candle.coordinateToPrice(Hp / 2);
      let r1 = Infinity, r2 = -Infinity, h1 = 0, h2 = 0;
      for (const v of rel) { if (v < r1) r1 = v; if (v > r2) r2 = v; }
      for (const v of d.pts.map((q) => q.p).concat(PRECOS.map((k) => d[k]).filter(fin))) { const h = (v - base) * f; if (h < h1) h1 = h; if (h > h2) h2 = h; }
      i0 = Math.round((r ? (r.from + r.to) / 2 : AX.i) - (r1 + r2) / 2);
      p0 = (pc != null ? pc : AX.D.c[AX.i]) - (h1 + h2) / 2;
    }
    const conv = (p) => p0 + (p - base) * f;
    for (const k of PRECOS) if (fin(d[k])) d[k] = conv(d[k]);
    d.pts = d.pts.map((q, j) => ({ t: tempoDoIdx(i0 + rel[j]), p: conv(q.p) }));
    d.id = novoId();
    desenhos.push(d); selecionar(d.id); gravar();
  }
  function duplicar() { const d = porId(selecionado); if (d && temDados()) inserirCopia(fazerClip(d), false); }

  // ---------------------------------------------------------------- ponteiro
  // Um único jogo de ouvintes na fase de captura de #areaGrafico. Com uma ferramenta ativa o canvas recebe tudo (o gráfico
  // nem vê o mouse). Com o cursor o canvas não recebe nada: o clique só é "roubado" do gráfico quando acerta um desenho
  // ou uma alça; senão passa direto e o gráfico arrasta e dá zoom normalmente.
  function consumir(e) {             // este clique é dos desenhos: nem o gráfico nem outro módulo devem reagir a ele
    e.preventDefault();              // sem o mousedown de compatibilidade a biblioteca não começa a arrastar o gráfico
    e.stopImmediatePropagation(); engolir = true; segurando = true;
    const a = document.activeElement, s = window.getSelection ? window.getSelection() : null;
    if (a && a !== editor.el && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) a.blur();     // com o foco preso num campo, Delete e Ctrl+C não chegariam aqui
    if (s && !s.isCollapsed) s.removeAllRanges();                                         // clicar num desenho desmarca texto da página, como qualquer clique
  }
  function baixar(e) {
    engolir = false; vazio = null;
    if (editor.aberto && e.target !== editor.el) {   // clicar fora da caixa de texto confirma o que foi escrito
      const noCanvas = e.target === cv;
      fecharEditor(true);
      if (noCanvas) { consumir(e); return; }
    }
    if (!temDados() || e.button !== 0 || e.isPrimary === false) return;
    if (e.target !== cv && !grafEl.contains(e.target)) return;      // botões, legenda e a barrinha não são "gráfico"
    const [x, y] = xyDe(e);
    if (ferramenta !== "cursor") { if (e.target === cv) baixarFerramenta(e, x, y); return; }
    const a = acertar(x, y);
    if (!a) { vazio = { x: e.clientX, y: e.clientY }; return; }
    consumir(e);
    const d = a.d, agora = performance.now();
    const duplo = d.id === ultClique.id && agora - ultClique.t < 450 && Math.hypot(e.clientX - ultClique.x, e.clientY - ultClique.y) < 6;
    ultClique = { id: d.id, t: agora, x: e.clientX, y: e.clientY };
    selecionar(d.id);
    arrasto = { id: d.id, j: a.j, orig: copia(d), i0: passo ? Math.round((x - x0) / passo) : NaN, p0: AX.S.candle.coordinateToPrice(y),
      cx: e.clientX, cy: e.clientY, moveu: false, editar: duplo && d.tipo === "texto" };
    const cur = cursorDe(a);
    area.style.cursor = cur === "grab" ? "grabbing" : cur;
    try { area.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro que não aceita captura */ }
  }
  function baixarFerramenta(e, x, y) {
    consumir(e);
    try { cv.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    if (ferramenta === "borracha") { apagando = { mudou: apagarEm(x, y) }; return; }
    if (!rascunho && (x > Wp || y > Hp)) return;     // em cima das escalas não nasce desenho
    const F = FERR[ferramenta];
    if (F.livre) { const p = pontoXY(x, y, false, true); if (p) rascunho = { tipo: ferramenta, pts: [p], livre: true, ux: x, uy: y }; return; }
    const p = pontoXY(x, y, imaLigado()); if (!p) return;
    if (ferramenta === "texto") { pendTexto = p; return; }
    if (F.n === 1) { const d = novo(ferramenta, [p]); usar("cursor"); selecionar(d.id); return; }
    const r = rascunho;
    if (!r) rascunho = { tipo: ferramenta, pts: [p], cur: p, n: F.n, cx: e.clientX, cy: e.clientY };
    else if (Math.hypot(e.clientX - r.cx, e.clientY - r.cy) >= 3) {      // duplo clique no mesmo lugar não vira desenho de tamanho zero
      r.pts.push(p); r.cur = p; r.cx = e.clientX; r.cy = e.clientY;
      if (r.pts.length >= r.n) { concluir(); return; }
    }
    sujar();
  }
  function realcar(id) {             // borracha: acende o desenho que vai ser apagado
    if (id === realce) return;
    realce = id; sujar();
    if (ferramenta === "borracha") cv.style.cursor = id == null ? "not-allowed" : "pointer";
  }
  function apagarEm(x, y) {
    const a = acertar(x, y); if (!a) return false;
    desenhos.splice(desenhos.indexOf(a.d), 1); realcar(null); sujar();
    return true;
  }
  function mover(e) {
    const [x, y] = xyDe(e), meu = e.target === cv;
    mouse.x = x; mouse.y = y; mouse.dentro = true;
    if (meu) e.stopImmediatePropagation();
    if (!temDados()) return;
    // botão solto sem o pointerup ter chegado (soltou fora da janela, captura recusada): encerra aqui, senão o desenho
    // ficaria "grudado" no mouse
    if (!e.buttons && (arrasto || apagando || (rascunho && rascunho.livre))) { soltar(e); return; }
    if (arrasto) { e.preventDefault(); e.stopImmediatePropagation(); arrastar(x, y, e); return; }
    if (ferramenta !== "cursor") { if (meu) moverFerramenta(x, y); return; }
    if (e.buttons) return;                           // o gráfico está sendo arrastado: não fica trocando o cursor
    const c = cursorDe(grafEl.contains(e.target) ? acertar(x, y) : null);
    if (area.style.cursor !== c) area.style.cursor = c;
  }
  function arrastar(x, y, e) {
    const a = arrasto, d = porId(a.id);
    if (!d) { arrasto = null; return; }
    if (!a.moveu && Math.hypot(e.clientX - a.cx, e.clientY - a.cy) < 3) return;      // tremidinha do clique não é arrasto
    if (a.j < 0) {
      const db = Math.round((x - x0) / passo) - a.i0, pr = AX.S.candle.coordinateToPrice(y);
      if (!fin(db) || pr == null || a.p0 == null) return;
      repor(d, a.orig); deslocar(d, db, pr - a.p0);  // sempre a partir do original: nada de erro acumulado a cada movimento
    } else {
      const p = pontoXY(x, y, imaLigado()); if (!p) return;
      repor(d, a.orig); ajustar(d, a.j, p);
    }
    a.moveu = true; sujar();
  }
  function moverFerramenta(x, y) {
    if (ferramenta === "borracha") {
      if (apagando) { if (apagarEm(x, y)) apagando.mudou = true; return; }
      const a = acertar(x, y);
      realcar(a ? a.d.id : null);
      return;
    }
    const r = rascunho; if (!r) return;
    if (r.livre) {
      if (Math.abs(x - r.ux) + Math.abs(y - r.uy) > 2) { const p = pontoXY(x, y, false, true); if (p) { r.pts.push(p); r.ux = x; r.uy = y; sujar(); } }
      return;
    }
    const p = pontoXY(x, y, imaLigado());
    if (p) { r.cur = p; sujar(); }
  }
  function soltar(e) {
    const cancelado = e.type === "pointercancel";
    segurando = false;
    if (e.target === cv) e.stopImmediatePropagation();
    if (arrasto) {
      e.stopImmediatePropagation();
      const a = arrasto; arrasto = null; area.style.cursor = "";
      if (a.moveu) gravar();                         // um retrato só por arrasto
      else if (a.editar && !cancelado) { const d = porId(a.id); if (d) abrirEditor(d); }
      sujar(); return;
    }
    if (vazio) { if (!cancelado && Math.hypot(e.clientX - vazio.x, e.clientY - vazio.y) < 4) selecionar(null); vazio = null; }
    if (apagando) { const m = apagando.mudou; apagando = null; if (m) gravar(); return; }
    if (pendTexto) { const p = pendTexto; pendTexto = null; if (!cancelado && temDados()) { xyDe(e); abrirEditor(null, p); } return; }
    const r = rascunho; if (!r || !temDados()) return;
    if (r.livre) { rascunho = null; if (r.pts.length > 1) novo(r.tipo, r.pts); else sujar(); return; }
    if (cancelado || Math.hypot(e.clientX - r.cx, e.clientY - r.cy) <= 5) return;      // foi só um clique: o próximo ponto vem no próximo clique
    const xy = xyDe(e), p = pontoXY(xy[0], xy[1], imaLigado()); if (!p) return;         // clicou, arrastou e soltou: o ponto seguinte é onde soltou
    r.pts.push(p); r.cur = p; r.cx = e.clientX; r.cy = e.clientY;
    if (r.pts.length >= r.n) concluir(); else sujar();
  }
  area.addEventListener("pointerdown", baixar, true);
  area.addEventListener("pointermove", mover, true);
  area.addEventListener("pointerup", soltar, true);
  area.addEventListener("pointercancel", soltar, true);
  area.addEventListener("pointerleave", () => { mouse.dentro = false; realcar(null); });
  area.addEventListener("click", (e) => {
    if (!engolir) return;
    engolir = false;
    if (e.target === cv || e.target === area || grafEl.contains(e.target)) e.stopImmediatePropagation();
  }, true);
  // arrastar um desenho para fora do gráfico não pode sair marcando o texto do painel ao lado
  document.addEventListener("selectstart", (e) => { if (segurando) e.preventDefault(); });
  window.addEventListener("pointerup", () => { segurando = false; }, true);
  // toque: a biblioteca arrasta o gráfico pelos eventos de toque, que o pointerdown cancelado não segura
  area.addEventListener("touchstart", (e) => { if (arrasto) e.stopImmediatePropagation(); }, { capture: true, passive: true });
  area.addEventListener("touchmove", (e) => { if (arrasto) { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, passive: false });
  cv.addEventListener("contextmenu", (e) => { e.preventDefault(); if (!largar()) usar("cursor"); });      // botão direito: desiste do desenho; de novo, volta ao cursor
  // com uma ferramenta ativa o canvas cobre o gráfico: a roda do mouse é repassada para o zoom continuar funcionando
  cv.addEventListener("wheel", (e) => {
    const alvo = grafEl.querySelector(".tv-lightweight-charts") || grafEl.firstElementChild;
    if (!alvo || !e.deltaY || typeof WheelEvent !== "function") return;
    e.preventDefault();
    alvo.dispatchEvent(new WheelEvent("wheel", { deltaY: e.deltaY, deltaMode: e.deltaMode, clientX: e.clientX, clientY: e.clientY, bubbles: true, cancelable: true }));
  }, { passive: false });

  // ---------------------------------------------------------------- teclado
  AX.on("tecla", (e) => {
    const k = String(e.key || "").toLowerCase();
    if (k === "escape") {            // desiste do desenho pela metade; senão volta ao cursor; senão tira a seleção
      if (menuAberto) fecharMenu();
      else if (arrasto) cancelarArrasto();
      else if (largar()) return;
      else if (ferramenta !== "cursor") usar("cursor");
      else selecionar(null);
      return;
    }
    if (e.defaultPrevented) return;                  // outro módulo já usou esta tecla (ex.: seta para a direita no replay)
    const d = porId(selecionado);
    if (e.ctrlKey || e.metaKey) {
      if (e.altKey) return;
      if (k === "z") { e.preventDefault(); passoHist(e.shiftKey ? 1 : -1); }
      else if (k === "y") { e.preventDefault(); passoHist(1); }
      else if (k === "c" && !e.shiftKey) { if (d && !String(window.getSelection() || "")) { e.preventDefault(); copiar(); } }      // com texto marcado na página, o Ctrl+C é do navegador
      else if (k === "v" && !e.shiftKey) { const c = temDados() ? lerClip() : null; if (c) { e.preventDefault(); inserirCopia(c, true); } }
      else if (k === "d" && !e.shiftKey) { if (d) { e.preventDefault(); duplicar(); } }
      return;
    }
    if (e.altKey) return;
    if (k === "delete" || k === "backspace") {
      if (d) { e.preventDefault(); apagarSel(); }
      else if (desenhos.length && !oculto) AX.toast("Clique num desenho para selecionar e apagar.", "aviso");
      return;
    }
    const sx = k === "arrowright" ? 1 : k === "arrowleft" ? -1 : 0, sy = k === "arrowup" ? 1 : k === "arrowdown" ? -1 : 0;
    if ((sx || sy) && d && temDados()) {             // setas: 1 barra / 1 tick (com Shift, 10)
      e.preventDefault();
      const m = e.shiftKey ? 10 : 1;
      deslocar(d, sx * m, sy * m * tick()); gravar("seta" + d.id);
    }
  });

  // ---------------------------------------------------------------- acerto do clique
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    const u = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
    return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
  }
  function distCaixa(x, y, xa, ya, xb, yb) {         // distância até a borda; lá dentro, no máximo o acerto "fraco"
    const x1 = Math.min(xa, xb), x2 = Math.max(xa, xb), y1 = Math.min(ya, yb), y2 = Math.max(ya, yb);
    if (x >= x1 && x <= x2 && y >= y1 && y <= y2) return Math.min(FRACO, x - x1, x2 - x, y - y1, y2 - y);
    return Math.hypot(Math.max(x1 - x, 0, x - x2), Math.max(y1 - y, 0, y - y2));
  }
  // corta a reta P1→P2 no retângulo visível (Liang–Barsky); t0/t1 dizem até onde ela vai: 0..1 é só o trecho entre os
  // pontos, ±Infinity é sem fim daquele lado. Assim raio e linha estendida nunca mandam coordenadas absurdas para o canvas.
  function recorte(x1, y1, x2, y2, t0, t1) {
    const dx = x2 - x1, dy = y2 - y1, M = 20;
    if (!dx && !dy) return null;
    const p = [-dx, dx, -dy, dy], q = [x1 + M, Wp + M - x1, y1 + M, Hp + M - y1];
    for (let k = 0; k < 4; k++) {
      if (!p[k]) { if (q[k] < 0) return null; continue; }
      const r = q[k] / p[k];
      if (p[k] < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [x1 + t0 * dx, y1 + t0 * dy, x1 + t1 * dx, y1 + t1 * dy];
  }
  function paralela(d) {             // y da paralela do canal nos dois extremos da base
    const off = offCanal(d), ya = yDe(d.pts[0].p + off), yb = yDe(d.pts[1].p + off);
    return ya == null || yb == null ? null : [ya, yb];
  }
  function posPx(d, P) {
    const yE = yDe(d.ent), yA = yDe(d.alvo), yS = yDe(d.stop);
    if (P.length < 2 || yE == null || yA == null || yS == null) return null;
    return { x1: Math.min(P[0][0], P[1][0]), x2: Math.max(P[0][0], P[1][0]), yE, yA, yS };
  }
  // alças (bolinhas) do desenho: [x, y, cursor]. O índice é o mesmo que ajustar() recebe.
  function alcas(d, P) {
    switch (d.tipo) {
      case "pincel": case "texto": return [];
      case "horizontal": return [[Wp / 2, P[0][1], "ns-resize"]];        // a linha não tem ponta: a alça fica no meio da tela
      case "vertical": return [[P[0][0], Hp / 2, "ew-resize"]];
      case "retangulo": case "elipse": return CANTOS.map((c) => [P[c[0]][0], P[c[1]][1], "grab"]);
      case "poscompra": case "posvenda": {
        const g = posPx(d, P);
        return g ? [[P[0][0], g.yE, "grab"], [P[0][0], g.yA, "ns-resize"], [P[0][0], g.yS, "ns-resize"], [P[1][0], g.yE, "ew-resize"]] : [];
      }
      default: return P.map((q) => [q[0], q[1], "grab"]);
    }
  }
  function distancia(d, x, y) {      // distância em px do ponteiro ao desenho (Infinity = não tem como acertar)
    const P = pix(d), F = FERR[d.tipo];
    if (!P || !F || P.length < Math.min(F.n, 2)) return Infinity;
    const a = P[0], b = P[1], q = d.pts;
    switch (d.tipo) {
      case "tendencia": case "seta": return distSeg(x, y, a[0], a[1], b[0], b[1]);
      case "raio": case "estendida": {
        const s = recorte(a[0], a[1], b[0], b[1], d.tipo === "raio" ? 0 : -Infinity, Infinity);
        return s ? distSeg(x, y, s[0], s[1], s[2], s[3]) : Math.hypot(x - a[0], y - a[1]);
      }
      case "horizontal": return Math.abs(y - a[1]);
      case "raioh": return distSeg(x, y, a[0], a[1], Math.max(a[0], Wp), a[1]);
      case "vertical": return Math.abs(x - a[0]);
      case "canal": {
        let dist = distSeg(x, y, a[0], a[1], b[0], b[1]);
        const par = P.length > 2 ? paralela(d) : null, larg = b[0] - a[0];
        if (!par) return dist;
        dist = Math.min(dist, distSeg(x, y, a[0], par[0], b[0], par[1]));
        if (Math.abs(larg) > 1) {                    // entre as duas linhas
          const u = (x - a[0]) / larg;
          if (u >= 0 && u <= 1 && (y - (a[1] + u * (b[1] - a[1]))) * (y - (par[0] + u * (par[1] - par[0]))) <= 0) dist = Math.min(dist, FRACO);
        }
        return dist;
      }
      case "fibo": {                                 // a diagonal ou qualquer nível (os níveis vão até a borda direita)
        let dist = distSeg(x, y, a[0], a[1], b[0], b[1]);
        if (x >= Math.min(a[0], b[0]) - 4) for (const n of FIBO) { const yy = yDe(q[1].p - n[0] * (q[1].p - q[0].p)); if (yy != null) dist = Math.min(dist, Math.abs(y - yy)); }
        return dist;
      }
      case "fiboproj": {
        let dist = distSeg(x, y, a[0], a[1], b[0], b[1]);
        const c = P[2]; if (!c) return dist;
        dist = Math.min(dist, distSeg(x, y, b[0], b[1], c[0], c[1]));
        if (x >= c[0] - 4) for (const n of PROJ) { const yy = yDe(q[2].p + n[0] * (q[1].p - q[0].p)); if (yy != null) dist = Math.min(dist, Math.abs(y - yy)); }
        return dist;
      }
      case "retangulo": return distCaixa(x, y, a[0], a[1], b[0], b[1]);
      case "regua": return Math.min(distCaixa(x, y, a[0], a[1], b[0], b[1]), distSeg(x, y, a[0], a[1], b[0], b[1]));
      case "elipse": {
        const rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2, dx = x - (a[0] + b[0]) / 2, dy = y - (a[1] + b[1]) / 2;
        if (rx < 2 || ry < 2) return distSeg(x, y, a[0], a[1], b[0], b[1]);
        const v = Math.hypot(dx / rx, dy / ry), borda = v > 0 ? Math.hypot(dx, dy) * Math.abs(1 - 1 / v) : Math.min(rx, ry);     // distância até a borda, medida no raio que sai do centro
        return v <= 1 ? Math.min(FRACO, borda) : borda;
      }
      case "poscompra": case "posvenda": {
        const g = posPx(d, P); if (!g) return Infinity;
        return Math.min(distCaixa(x, y, g.x1, Math.min(g.yA, g.yS), g.x2, Math.max(g.yA, g.yS)), distSeg(x, y, g.x1, g.yE, g.x2, g.yE));
      }
      case "texto": { const c = caixaTexto(d, P); return x >= c[0] && x <= c[0] + c[2] && y >= c[1] && y <= c[1] + c[3] ? 0 : Infinity; }
      case "pincel": {
        let dist = P.length < 2 ? Math.hypot(x - a[0], y - a[1]) : Infinity;
        for (let j = 1; j < P.length && dist > 1; j++) dist = Math.min(dist, distSeg(x, y, P[j - 1][0], P[j - 1][1], P[j][0], P[j][1]));
        return dist;
      }
    }
    return Infinity;
  }
  function alcaEm(d, x, y, raio) {
    const P = pix(d); if (!P) return -1;
    let j = -1, dmin = raio;
    alcas(d, P).forEach((a, k) => { const dist = Math.hypot(a[0] - x, a[1] - y); if (dist <= dmin) { dmin = dist; j = k; } });
    return j;
  }
  // o que está debaixo do ponteiro: { d, j } (j = alça, ou −1 para o corpo). As alças do selecionado ganham de tudo;
  // depois vale o desenho mais perto e, no empate, o que está por cima.
  function acertar(x, y) {
    if (oculto || !(x >= 0 && y >= 0 && x <= Wp && y <= Hp)) return null;
    const s = porId(selecionado);
    if (s) { const j = alcaEm(s, x, y, 9); if (j >= 0) return { d: s, j }; }
    let melhor = null, dmin = TOL;
    for (let k = desenhos.length - 1; k >= 0; k--) { const dist = distancia(desenhos[k], x, y); if (dist < dmin) { dmin = dist; melhor = desenhos[k]; } }
    return melhor ? { d: melhor, j: alcaEm(melhor, x, y, 7) } : null;
  }
  function cursorDe(a) {
    if (!a) return "";
    if (a.j < 0) return "move";
    const P = pix(a.d), h = P ? alcas(a.d, P)[a.j] : null;
    return (h && h[2]) || "grab";
  }
  function caixaDe(d, P) {           // retângulo (px) que serve de âncora para a barrinha do selecionado
    let pts = alcas(d, P);
    if (d.tipo === "texto") { const c = caixaTexto(d, P); pts = [[c[0], c[1]], [c[0] + c[2], c[1] + c[3]]]; }
    else if (d.tipo === "pincel") pts = P;
    else if (FERR[d.tipo].pos) { const g = posPx(d, P); if (g) pts = [[g.x1, Math.min(g.yA, g.yS)], [g.x2, Math.max(g.yA, g.yS)]]; }
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    for (const p of pts) { if (p[0] < x1) x1 = p[0]; if (p[0] > x2) x2 = p[0]; if (p[1] < y1) y1 = p[1]; if (p[1] > y2) y2 = p[1]; }
    return x1 <= x2 && y1 <= y2 ? [x1, y1, x2, y2] : null;
  }

  // ---------------------------------------------------------------- desenho no canvas
  function rotulo(txt, x, y, cor, alinhar = "left") {
    const brilho = ctx.shadowBlur; ctx.shadowBlur = 0;               // a etiqueta nunca leva o brilho do desenho selecionado
    ctx.font = FONTE; ctx.textAlign = alinhar; ctx.textBaseline = "bottom";
    const w = ctx.measureText(txt).width, xi = alinhar === "right" ? x - w : alinhar === "center" ? x - w / 2 : x;
    ctx.fillStyle = "rgba(13,16,22,.75)"; ctx.fillRect(xi - 3, y - 14, w + 6, 14);
    ctx.fillStyle = cor; ctx.fillText(txt, x, y - 1);
    ctx.shadowBlur = brilho;
  }
  function rotuloMeio(txt, xm, y, cor) {             // centralizado em xm, sem deixar a etiqueta sair pela lateral
    ctx.font = FONTE;
    const m = ctx.measureText(txt).width / 2 + 6;
    rotulo(txt, Wp > 2 * m ? limite(xm, m, Wp - m) : xm, y, cor, "center");
  }
  const linha = (x1, y1, x2, y2) => { ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); };
  const trecho = (a, b) => { const s = recorte(a[0], a[1], b[0], b[1], 0, 1); if (s) linha(s[0], s[1], s[2], s[3]); };
  const letra = (txt, p, abaixo) => rotulo(txt, p[0], abaixo ? p[1] + 21 : p[1] - 7, CLARO, "center");
  function desenharUm(d, temp) {
    const P = pix(d), F = FERR[d.tipo];
    if (!P || !F || P.length < Math.min(F.n, 2)) return;
    const sel = !temp && (d.id === selecionado || d.id === realce), cor = d.cor, esp = d.esp || 2, q = d.pts;
    const brilho = (c) => { ctx.shadowColor = c; ctx.shadowBlur = sel ? 10 : 0; };
    ctx.save();
    try {
      ctx.strokeStyle = cor; ctx.fillStyle = cor; ctx.lineWidth = esp + (sel ? 1 : 0); ctx.setLineDash(temp && !F.livre ? [5, 4] : []);
      brilho(cor);
      switch (d.tipo) {
        case "tendencia": case "raio": case "estendida": case "seta": {
          const a = P[0]; let b = P[1];
          if (d.tipo === "seta") {
            const tam = 8 + esp * 2, ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
            ctx.beginPath(); ctx.moveTo(b[0], b[1]);
            ctx.lineTo(b[0] - tam * Math.cos(ang - 0.42), b[1] - tam * Math.sin(ang - 0.42));
            ctx.lineTo(b[0] - tam * Math.cos(ang + 0.42), b[1] - tam * Math.sin(ang + 0.42));
            ctx.closePath(); ctx.fill();
            // a haste para na base da ponta: senão a linha grossa aparece por cima do bico
            if (Math.hypot(b[0] - a[0], b[1] - a[1]) > tam) b = [b[0] - tam * 0.8 * Math.cos(ang), b[1] - tam * 0.8 * Math.sin(ang)];
          }
          const s = recorte(a[0], a[1], b[0], b[1], d.tipo === "estendida" ? -Infinity : 0, d.tipo === "raio" || d.tipo === "estendida" ? Infinity : 1);
          if (s) linha(s[0], s[1], s[2], s[3]);
          break;
        }
        case "horizontal": linha(0, P[0][1], Wp, P[0][1]); rotulo(AX.fmt(q[0].p), Wp - 4, P[0][1], cor, "right"); break;
        case "raioh":
          if (P[0][0] <= Wp) { linha(Math.max(P[0][0], 0), P[0][1], Wp, P[0][1]); rotulo(AX.fmt(q[0].p), Wp - 4, P[0][1], cor, "right"); }
          break;
        case "vertical": linha(P[0][0], 0, P[0][0], Hp); break;
        case "canal": {
          const par = P.length > 2 ? paralela(d) : null, a = P[0], b = P[1];
          if (!par) { trecho(a, b); break; }             // prévia só com a linha de base
          ctx.shadowBlur = 0; ctx.globalAlpha = 0.1;
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.lineTo(b[0], par[1]); ctx.lineTo(a[0], par[0]); ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1; brilho(cor);
          trecho(a, b); trecho([a[0], par[0]], [b[0], par[1]]);
          ctx.shadowBlur = 0; ctx.globalAlpha = 0.6; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
          trecho([a[0], (a[1] + par[0]) / 2], [b[0], (b[1] + par[1]) / 2]);
          break;
        }
        case "fibo": {
          const a = q[0].p, b = q[1].p, xi = Math.max(0, Math.min(P[0][0], P[1][0]));
          ctx.setLineDash([]); ctx.shadowBlur = 0;
          ctx.strokeStyle = "rgba(154,165,181,.5)"; ctx.lineWidth = 1; trecho(P[0], P[1]);
          if (xi > Wp) break;
          const y50 = yDe(b - 0.5 * (b - a)), y618 = yDe(b - 0.618 * (b - a));
          if (y50 != null && y618 != null) { ctx.fillStyle = "rgba(255,215,0,.08)"; ctx.fillRect(xi, Math.min(y50, y618), Wp - xi, Math.abs(y618 - y50)); }     // zona de ouro
          for (const [r, nome, c] of FIBO) {
            const pr = b - r * (b - a), y = yDe(pr); if (y == null) continue;
            ctx.strokeStyle = c; ctx.lineWidth = r === 0.618 || r === 0.5 ? 2 : 1; ctx.setLineDash(r < 0 ? [4, 3] : []); brilho(c);
            linha(xi, y, Wp, y);
            rotulo(`${nome}  ${AX.fmt(pr)}`, xi + 2, y, c);
          }
          break;
        }
        case "fiboproj": {
          const A = P[0], B = P[1], C = P[2];
          ctx.shadowBlur = 0; ctx.strokeStyle = "rgba(154,165,181,.75)"; ctx.lineWidth = 1;
          trecho(A, B); if (C) trecho(B, C);             // as pernadas A-B e B-C
          if (C && C[0] <= Wp) {
            const mov = q[1].p - q[0].p, xi = Math.max(0, C[0]);
            ctx.setLineDash([]);
            for (const [r, nome, c] of PROJ) {
              const pr = q[2].p + r * mov, y = yDe(pr); if (y == null) continue;
              ctx.strokeStyle = c; ctx.lineWidth = r === 1 || r === 1.618 ? 2 : 1; brilho(c);
              linha(xi, y, Wp, y);
              rotulo(`${nome}  ${AX.fmt(pr)}`, xi + 12, y, c);
            }
          }
          letra("A", A, A[1] > B[1]); letra("B", B, B[1] > A[1]); if (C) letra("C", C, C[1] > B[1]);
          break;
        }
        case "retangulo": case "elipse": {
          const x = Math.min(P[0][0], P[1][0]), y = Math.min(P[0][1], P[1][1]), w = Math.abs(P[1][0] - P[0][0]), h = Math.abs(P[1][1] - P[0][1]);
          ctx.beginPath();
          if (d.tipo === "elipse") ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, PI2); else ctx.rect(x, y, w, h);
          ctx.shadowBlur = 0; ctx.globalAlpha = 0.12; ctx.fill();
          ctx.globalAlpha = 1; brilho(cor); ctx.stroke();
          break;
        }
        case "poscompra": case "posvenda": {
          const g = posPx(d, P); if (!g) break;
          const { x1, x2, yE, yA, yS } = g, w = x2 - x1;
          ctx.setLineDash([]); ctx.shadowBlur = 0;
          ctx.fillStyle = "rgba(34,227,154,.16)"; ctx.fillRect(x1, Math.min(yE, yA), w, Math.abs(yA - yE));      // entrada → alvo
          ctx.fillStyle = "rgba(255,92,110,.16)"; ctx.fillRect(x1, Math.min(yE, yS), w, Math.abs(yS - yE));      // entrada → stop
          ctx.lineWidth = 1; ctx.strokeStyle = VERDE; linha(x1, yA, x2, yA); ctx.strokeStyle = VERM; linha(x1, yS, x2, yS);
          ctx.strokeStyle = CLARO; ctx.lineWidth = sel ? 2 : 1.5; brilho(CLARO); linha(x1, yE, x2, yE);
          if (x2 < 0 || x1 > Wp) break;
          const ganho = Math.abs(d.alvo - d.ent), risco = Math.abs(d.ent - d.stop), vp = AX.valorPontoR(), xm = (x1 + x2) / 2;
          const razao = risco > 0 ? (ganho / risco).toFixed(1).replace(".", ",") : "—";
          rotuloMeio(`Alvo ${AX.fmt(d.alvo)} · ${AX.fmt(ganho)} pts · ${AX.reais(ganho * vp)}/contr.`, xm, yA < yE ? yA - 3 : yA + 17, VERDE);
          rotuloMeio(`Stop ${AX.fmt(d.stop)} · ${AX.fmt(risco)} pts · ${AX.reais(risco * vp)}/contr.`, xm, yS < yE ? yS - 3 : yS + 17, VERM);
          rotuloMeio(`${F.pos > 0 ? "Compra" : "Venda"} ${AX.fmt(d.ent)} · retorno/risco ${razao} : 1`, xm, yA < yE ? yE - 3 : yE + 17, CLARO);
          break;
        }
        case "regua": {
          const [x1, y1] = P[0], [x2, y2] = P[1], dp = q[1].p - q[0].p, sobe = dp >= 0, c = sobe ? "#00e676" : "#ff3b4e";
          ctx.shadowBlur = 0; ctx.globalAlpha = 0.15; ctx.fillStyle = c;
          ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
          ctx.globalAlpha = 1; ctx.strokeStyle = c; brilho(c); trecho(P[0], P[1]);
          const barras = Math.round(idxDoTempo(q[1].t) - idxDoTempo(q[0].t)), pct = (dp / q[0].p) * 100, vpr = AX.valorPontoR();
          const txt = `${dp >= 0 ? "+" : ""}${AX.fmt(dp)} pts · ${pct >= 0 ? "+" : ""}${pct.toFixed(2).replace(".", ",")}% · ${barras} candles · ${AX.reais(Math.abs(dp) * vpr)}/contr.`;
          rotulo(txt, Math.max(x1, x2) + 6, Math.min(y1, y2) + 16, c);
          break;
        }
        case "pincel":
          ctx.lineJoin = "round"; ctx.lineCap = "round"; ctx.beginPath();
          for (let j = 0; j < P.length; j++) { if (j) ctx.lineTo(P[j][0], P[j][1]); else ctx.moveTo(P[j][0], P[j][1]); }
          ctx.stroke();
          break;
        case "texto": {
          if (editor.aberto && editor.id === d.id) break;          // em edição: a caixa de texto está por cima
          ctx.font = fonteTexto(d); ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(d.texto || "", P[0][0] + 4, P[0][1]);
          if (sel) { const c = caixaTexto(d, P); ctx.shadowBlur = 0; ctx.lineWidth = 1; ctx.setLineDash([3, 3]); ctx.strokeRect(c[0], c[1], c[2], c[3]); }
          break;
        }
      }
    } finally { ctx.restore(); }
  }
  function desenharAlcas(d) {
    const P = pix(d); if (!P) return;
    ctx.save(); ctx.setLineDash([]); ctx.lineWidth = 1.5; ctx.fillStyle = "#0d1016"; ctx.strokeStyle = FERR[d.tipo].fixo ? CLARO : d.cor;
    for (const a of alcas(d, P)) { ctx.beginPath(); ctx.arc(a[0], a[1], 4.5, 0, PI2); ctx.fill(); ctx.stroke(); }
    ctx.restore();
  }
  const tentar = (f) => { try { f(); } catch (e) { console.error(e); } };
  function redesenhar() {
    geo.clear(); medirPainel();
    ctx.clearRect(0, 0, largCss, altCss);
    ctx.save();
    try {
      ctx.beginPath(); ctx.rect(0, 0, Wp, Hp); ctx.clip();
      // camadas dos outros módulos (operações, níveis, painéis) vêm antes dos desenhos do usuário
      const ts = eixoT(), util = { W: Wp, H: Hp, x: (i) => ts.logicalToCoordinate(i), y: yDe, rotulo };
      for (const f of AX.camadas) { ctx.save(); try { f(ctx, util); } catch (e) { console.error(e); } ctx.restore(); }
      if (!oculto) for (const d of desenhos) tentar(() => desenharUm(d, false));
      if (rascunho) tentar(() => { const d = previa(); if (d) desenharUm(d, true); });
      const s = oculto ? null : porId(selecionado);
      if (s) tentar(() => desenharAlcas(s));
    } finally { ctx.restore(); }
    posBarra();
    if (editor.aberto) posEditor();
  }
  function ajustarTamanho() {
    medidaNova = false; dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(largCss * dpr); cv.height = Math.round(altCss * dpr); cv.style.width = largCss + "px"; cv.style.height = altCss + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); sujar();
  }
  // o tamanho vem de um ResizeObserver: nada de ler clientWidth/clientHeight (e forçar layout) a cada quadro
  function medir(w, h) { w = Math.round(w); h = Math.round(h); if (w !== largCss || h !== altCss) { largCss = w; altCss = h; medidaNova = true; } }
  if (window.ResizeObserver) new window.ResizeObserver((es) => { const r = es[es.length - 1].contentRect; medir(r.width, r.height); }).observe(area);
  else window.addEventListener("resize", () => medir(area.clientWidth, area.clientHeight));
  medir(area.clientWidth, area.clientHeight);
  // redesenha só quando algo mudou (zoom, rolagem, escala de preço, tamanho, candle novo ou os próprios desenhos)
  function laco() {
    requestAnimationFrame(laco);                     // agenda antes: um erro num quadro não pode parar os seguintes
    try {
      if (medidaNova || dpr !== (window.devicePixelRatio || 1)) ajustarTamanho();
      if (!temDados()) {
        if (assinatura !== "-") { assinatura = "-"; ctx.clearRect(0, 0, largCss, altCss); barra.classList.add("oculto"); barraOn = false; }
        return;
      }
      const f = eixoT().getVisibleLogicalRange(), ref = AX.D.c[AX.i];
      const sig = (f ? f.from + "|" + f.to : "") + "|" + yDe(ref) + "|" + yDe(ref * 1.01) + "|" + sujo + "|" + AX.i;
      if (sig !== assinatura) { assinatura = sig; redesenhar(); }
    } catch (e) { const m = String((e && e.message) || e); if (m !== ultErro) { ultErro = m; console.error(e); } }
  }

  // ---------------------------------------------------------------- ligação com o resto da tela
  AX.redesenhar = sujar;
  AX.desenho = {                     // para outros módulos saberem se o clique/mouse é dos desenhos
    selecionado: () => !!porId(selecionado),
    ferramenta: () => ferramenta,
    sobreDesenho(e) {
      if (arrasto || rascunho || apagando) return true;
      const t = e && e.target;
      if (!t) return false;
      if (t === editor.el || (t.nodeType === 1 && barra.contains(t))) return true;
      if (ferramenta !== "cursor") return t === cv;
      if (!temDados() || !fin(e.clientX) || !fin(e.clientY)) return false;
      const xy = xyDe(e);
      return !!acertar(xy[0], xy[1]);
    },
  };
  const ui = lerUi();
  if (/^#[0-9a-f]{6}$/i.test(ui.cor || "")) corEl.value = ui.cor;
  if ([1, 2, 3, 4].includes(ui.esp)) espEl.value = String(ui.esp);
  if (ui.ima) { imaEl.classList.add("on"); imaEl.setAttribute("aria-pressed", "true"); }
  for (const k in grupos) { const f = ui.grupos && ui.grupos[k]; if (grupos[k].itens.includes(f)) grupos[k].atual = f; }
  usar("cursor"); pintarHist();
  AX.on("carregado", () => { carregar(); });
  window.addEventListener("pagehide", salvarJa);     // fechando a página com um salvamento na fila: manda já
  if (AX.ativo && temDados()) carregar();
  requestAnimationFrame(laco);
})();
