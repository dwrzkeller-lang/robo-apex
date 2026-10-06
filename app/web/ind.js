/* ROBÔ APEX — indicadores do gráfico (botão "Indicadores"): médias móveis à escolha, VWAP, Bandas de Bollinger,
   Canal de Keltner, volume, IFR e estocástico, e os NÍVEIS que o robô traça sozinho: máxima, mínima e fechamento de
   ontem, abertura de hoje e os suportes e resistências (topos e fundos tocados mais de uma vez).
   São só para LER o gráfico: as estratégias usam os indicadores calculados no servidor e não mudam com o que for
   ligado ou desligado aqui. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$, chart = AX.chart;
  // As cores das três médias e da VWAP foram conferidas para quem não distingue bem verde e vermelho (o azul e o roxo de
  // antes ficavam quase iguais): vermelho, azul, roxo escuro e dourado se separam em todos os tipos de daltonismo.
  const COR_VWAP = "#b48c14";
  const CORES = ["#ee5a67", "#4795f1", "#8448d2", "#22e39a", "#ffa53a", "#22d3ee", "#e056fd", "#d9e0ea"];
  const ANTIGAS = { "#ff5b6e": "#ee5a67", "#3b9cff": "#4795f1", "#b35cff": "#8448d2" };      // padrão das versões anteriores
  const padrao = () => ({
    medias: [{ tipo: "MMS", n: 9, cor: "#ee5a67", on: true }, { tipo: "MMS", n: 20, cor: "#4795f1", on: true }, { tipo: "MMS", n: 200, cor: "#8448d2", on: true }],
    vwap: true, boll: false, kelt: false, vol: false, ifr: false, ifrN: 14, estoc: false, ops: "detalhe", niveis: true, sr: true,
  });
  function validar(c) {
    const p = padrao();
    if (!c || typeof c !== "object" || !Array.isArray(c.medias)) return p;
    const medias = c.medias.filter((m) => m && (m.tipo === "MMS" || m.tipo === "MME") && m.n >= 2 && m.n <= 600).slice(0, 8)
      .map((m) => ({ tipo: m.tipo, n: Math.round(m.n), cor: /^#[0-9a-f]{6}$/i.test(m.cor) ? ANTIGAS[m.cor.toLowerCase()] || m.cor : "#d9e0ea", on: !!m.on }));
    return { medias, vwap: !!c.vwap, boll: !!c.boll, kelt: !!c.kelt, vol: !!c.vol, ifr: !!c.ifr,
      ifrN: c.ifrN >= 2 && c.ifrN <= 100 ? Math.round(c.ifrN) : 14, estoc: !!c.estoc, ops: ["detalhe", "simples", "nada"].includes(c.ops) ? c.ops : "detalhe",
      niveis: c.niveis !== false, sr: c.sr !== false };
  }
  let cfg = validar(AX.pref.ind);
  const salvar = () => { AX.pref.ind = cfg; AX.salvarPref(); };

  // ---------------------------------------------------------------- contas (as mesmas fórmulas do servidor)
  const vazio = (n) => new Array(n).fill(null);
  function sma(x, p) {
    const out = vazio(x.length); let s = 0;
    for (let i = 0; i < x.length; i++) { s += x[i]; if (i >= p) s -= x[i - p]; if (i >= p - 1) out[i] = s / p; }
    return out;
  }
  function ema(x, p) {            // igual ao Profit: alfa = 2 / (p + 1), começa no 1º preço
    const out = vazio(x.length), k = 2 / (p + 1); let e = x[0];
    for (let i = 0; i < x.length; i++) { e = i === 0 ? x[0] : e + (x[i] - e) * k; out[i] = i >= p - 1 ? e : null; }
    return out;
  }
  function desvio(x, p, media) {
    const out = vazio(x.length);
    for (let i = p - 1; i < x.length; i++) { let s = 0; for (let j = i - p + 1; j <= i; j++) s += (x[j] - media[i]) ** 2; out[i] = Math.sqrt(s / p); }
    return out;
  }
  function atr(D, p) {
    const tr = D.c.map((_, i) => (i === 0 ? D.h[0] - D.l[0] : Math.max(D.h[i] - D.l[i], Math.abs(D.h[i] - D.c[i - 1]), Math.abs(D.l[i] - D.c[i - 1]))));
    return sma(tr, p);
  }
  function rsi(c, p) {            // IFR de Wilder
    const out = vazio(c.length);
    if (c.length <= p) return out;
    let g = 0, q = 0;
    for (let i = 1; i <= p; i++) { const d = c[i] - c[i - 1]; g += Math.max(d, 0); q += Math.max(-d, 0); }
    let mg = g / p, mp = q / p;
    out[p] = mp === 0 ? 100 : 100 - 100 / (1 + mg / mp);
    for (let i = p + 1; i < c.length; i++) {
      const d = c[i] - c[i - 1];
      mg = (mg * (p - 1) + Math.max(d, 0)) / p; mp = (mp * (p - 1) + Math.max(-d, 0)) / p;
      out[i] = mp === 0 ? 100 : 100 - 100 / (1 + mg / mp);
    }
    return out;
  }
  function estocastico(D, p = 14, lento = 3, sinal = 3) {      // estocástico lento (14, 3, 3)
    const n = D.c.length, bruto = vazio(n);
    for (let i = p - 1; i < n; i++) {
      let mx = -Infinity, mn = Infinity;
      for (let j = i - p + 1; j <= i; j++) { if (D.h[j] > mx) mx = D.h[j]; if (D.l[j] < mn) mn = D.l[j]; }
      bruto[i] = mx > mn ? (100 * (D.c[i] - mn)) / (mx - mn) : 50;
    }
    const media = (x, q) => { const out = vazio(n); for (let i = 0; i < n; i++) { let s = 0, ok = true; for (let j = i - q + 1; j <= i; j++) { if (j < 0 || x[j] == null) { ok = false; break; } s += x[j]; } if (ok) out[i] = s / q; } return out; };
    const k = media(bruto, lento);
    return [k, media(k, sinal)];
  }

  // ---------------------------------------------------------------- séries
  // item = { s: série, calc: (D) => valores, rot, cor, casas (null = casas do ativo), hist }
  let itens = [], paineis = [], calcD = null;
  const semEscala = { autoscaleInfoProvider: () => null };       // linhas não esticam a escala: quem manda são os candles
  const base = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
  const linha = (cor, w, extra) => chart.addLineSeries(Object.assign({ color: cor, lineWidth: w }, base, semEscala, extra));
  const oscilador = (cor, id, w = 2) => chart.addLineSeries(Object.assign({ color: cor, lineWidth: w, priceScaleId: id,
    autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 100 } }) }, base));
  const guia = (s, v) => s.createPriceLine({ price: v, color: "#3a475e", lineWidth: 1, lineStyle: 2, axisLabelVisible: false, title: "" });

  let estMontada = null;                       // estratégia para a qual as séries foram montadas (E10 e E11 têm indicador próprio)
  function montar(est = estMontada) {
    itens.forEach((x) => chart.removeSeries(x.s));
    itens = []; paineis = []; calcD = null; estMontada = est;
    const add = (s, calc, rot, cor, extra) => itens.push(Object.assign({ s, calc, rot, cor, val: null }, extra));
    cfg.medias.filter((m) => m.on).forEach((m) =>
      add(linha(m.cor, m.n >= 20 ? 2 : 1), (D) => (m.tipo === "MME" ? ema : sma)(D.c, m.n), (m.tipo === "MME" ? "MME" : "MM") + m.n, m.cor));
    if (cfg.vwap) add(linha(COR_VWAP, 2), (D) => D.vw, "VWAP", COR_VWAP);
    if (cfg.boll) {
      const memo = (D) => (D._boll = D._boll || (() => { const m = sma(D.c, 20), d = desvio(D.c, 20, m); return [m.map((v, i) => (v == null ? null : v + 2 * d[i])), m.map((v, i) => (v == null ? null : v - 2 * d[i]))]; })());
      add(linha("#8fa3bf", 1), (D) => memo(D)[0], "Bollinger ↑", "#8fa3bf");
      add(linha("#8fa3bf", 1), (D) => memo(D)[1], "↓", "#8fa3bf");
    }
    if (est === "E11") {          // a estratégia do gráfico usa a faixa de ruído: mostra as duas bordas dela
      const borda = (lado) => (D) => {
        if (!D.ruido) return null;
        const out = vazio(D.c.length);
        let s2 = 0;
        for (let i = 1; i < D.c.length; i++) {
          if (D.d[i] !== D.d[i - 1]) s2 = i;
          if (s2 === 0 || D.ruido[i] == null) continue;
          const ref = lado > 0 ? Math.max(D.o[s2], D.c[s2 - 1]) : Math.min(D.o[s2], D.c[s2 - 1]);
          out[i] = ref * (1 + lado * D.ruido[i]);
        }
        return out;
      };
      add(linha("#22d3ee", 1, { lineStyle: 2 }), borda(1), "Faixa de ruído ↑", "#22d3ee");
      add(linha("#22d3ee", 1, { lineStyle: 2 }), borda(-1), "↓", "#22d3ee");
    }
    if (cfg.kelt || est === "E10") {   // o canal da estratégia E10: MME20 ± 2,0 e 2,5 ATR(14)
      const memo = (D) => (D._kelt = D._kelt || { m: ema(D.c, 20), a: atr(D, 14) });
      const banda = (mult) => (D) => { const k = memo(D); return k.m.map((v, i) => (v == null || k.a[i] == null ? null : v + mult * k.a[i])); };
      add(linha("#2bb5a0", 1), banda(2.0), "Keltner ↑", "#2bb5a0");
      add(linha("#2bb5a0", 1), banda(-2.0), "↓", "#2bb5a0");
      add(linha("#2bb5a0", 1, { lineStyle: 2 }), banda(2.5), "", "#2bb5a0");
      add(linha("#2bb5a0", 1, { lineStyle: 2 }), banda(-2.5), "", "#2bb5a0");
    }
    if (cfg.vol) {
      const s = chart.addHistogramSeries(Object.assign({ priceScaleId: "vol", priceFormat: { type: "volume" } }, base));
      add(s, (D) => (D.meta.temVolume ? D.v : null), "Vol", "#8491a5", { hist: true, casas: 0 });
    }
    if (cfg.ifr) {
      const s = oscilador("#ffa53a", "ifr"); guia(s, 70); guia(s, 30);
      add(s, (D) => rsi(D.c, cfg.ifrN), "IFR" + cfg.ifrN, "#ffa53a", { casas: 1 });
      paineis.push({ id: "ifr", nome: `IFR ${cfg.ifrN} (70 / 30)` });
    }
    if (cfg.estoc) {
      const memo = (D) => (D._est = D._est || estocastico(D));
      const sk = oscilador("#4795f1", "est"), sd = oscilador("#ee5a67", "est", 1); guia(sk, 80); guia(sk, 20);
      add(sk, (D) => memo(D)[0], "Estoc %K", "#4795f1", { casas: 1 });
      add(sd, (D) => memo(D)[1], "%D", "#ee5a67", { casas: 1 });
      paineis.push({ id: "est", nome: "Estocástico 14, 3, 3 (80 / 20)" });
    }
    arrumar();
  }

  // divide a altura: preço em cima, volume no pé do preço, osciladores em faixas embaixo
  const ALT = 0.16, VAO = 0.02;
  function arrumar() {
    const n = paineis.length, pe = n ? n * (ALT + VAO) + 0.03 : 0.08;
    chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: pe } });
    paineis.forEach((p, j) => {                 // j = 0 é a faixa de cima
      const baixo = 0.01 + (n - 1 - j) * (ALT + VAO);
      p.topo = 1 - baixo - ALT; p.base = 1 - baixo;
      chart.priceScale(p.id).applyOptions({ scaleMargins: { top: p.topo, bottom: baixo } });
    });
    if (cfg.vol) chart.priceScale("vol").applyOptions({ scaleMargins: { top: 1 - pe - 0.13, bottom: pe } });
  }
  // faixas dos osciladores: uma linha separando e o nome
  AX.camadas.push((ctx, u) => {
    for (const p of paineis) {
      const y = Math.round(u.H * (p.topo - VAO / 2)) + 0.5;
      ctx.strokeStyle = "#232c3b"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(u.W, y); ctx.stroke();
      ctx.font = "10px Segoe UI, system-ui"; ctx.fillStyle = "#8491a5"; ctx.textAlign = "left"; ctx.textBaseline = "top";
      ctx.fillText(p.nome, 8, y + 3);
    }
  });

  // ---------------------------------------------------------------- níveis que o robô traça sozinho
  const memoN = { D: null, k: -1, dia: null, sr: [] };
  function niveisDoDia(D, k) {                 // do dia do candle k: máxima, mínima e fechamento de ontem; abertura de hoje
    if (!D.meta.intraday) return null;
    const d = D.d;
    let s2 = k; while (s2 > 0 && d[s2 - 1] === d[k]) s2--;
    if (s2 === 0) return null;
    let a = s2 - 1; while (a > 0 && d[a - 1] === d[s2 - 1]) a--;
    let mx = -Infinity, mn = Infinity;
    for (let i = a; i < s2; i++) { if (D.h[i] > mx) mx = D.h[i]; if (D.l[i] < mn) mn = D.l[i]; }
    return { ini: s2, itens: [[mx, "máx. de ontem"], [mn, "mín. de ontem"], [D.c[s2 - 1], "fech. de ontem"], [D.o[s2], "abertura de hoje"]] };
  }
  function suportesResistencias(D, k) {        // topos e fundos (5 candles de cada lado) dos últimos 320 candles, agrupados
    const N = 320, L = 5, ini = Math.max(L, k - N);
    let amp = 0, c = 0;
    for (let i = Math.max(1, k - 60); i <= k; i++) { amp += D.h[i] - D.l[i]; c++; }
    amp = c ? amp / c : 0;
    if (!(amp > 0)) return [];
    const tol = 0.6 * amp, pts = [];
    for (let i = ini; i <= k - L; i++) {
      let topo = true, fundo = true;
      for (let j = 1; j <= L && (topo || fundo); j++) {
        if (D.h[i] < D.h[i - j] || D.h[i] < D.h[i + j]) topo = false;
        if (D.l[i] > D.l[i - j] || D.l[i] > D.l[i + j]) fundo = false;
      }
      if (topo) pts.push([D.h[i], i]);
      if (fundo) pts.push([D.l[i], i]);
    }
    pts.sort((x, y) => x[0] - y[0]);
    const grupos = [];
    for (const [pr, i] of pts) {
      const g = grupos[grupos.length - 1];
      if (g && pr - g.soma / g.n <= tol) { g.soma += pr; g.n++; g.ult = Math.max(g.ult, i); g.pri = Math.min(g.pri, i); }
      else grupos.push({ soma: pr, n: 1, ult: i, pri: i });
    }
    const agora = D.c[k];
    return grupos.filter((g) => g.n >= 2).sort((x, y) => y.n - x.n || y.ult - x.ult).slice(0, 4)
      .map((g) => ({ p: g.soma / g.n, n: g.n, pri: g.pri, res: g.soma / g.n >= agora }));
  }
  AX.camadas.push((ctx, u) => {
    const D = AX.graficoMostra(), k = AX.i;
    if (!D || (!cfg.niveis && !cfg.sr) || k < 30) return;
    if (memoN.D !== D || memoN.k !== k) { memoN.D = D; memoN.k = k; memoN.dia = niveisDoDia(D, k); memoN.sr = suportesResistencias(D, k); }
    const ocupados = [];
    const linha = (y, x0, cor, traco, txt) => {
      if (y == null || y < 14 || y > u.H - 4) return;
      ctx.strokeStyle = cor; ctx.lineWidth = 1; ctx.setLineDash(traco);
      ctx.beginPath(); ctx.moveTo(Math.max(0, x0), Math.round(y) + 0.5); ctx.lineTo(u.W, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      if (ocupados.some((o) => Math.abs(o - y) < 12)) return;          // rótulo em cima de outro: fica só a linha
      ocupados.push(y);
      ctx.font = "10px Segoe UI, system-ui"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      const w = ctx.measureText(txt).width;
      ctx.fillStyle = "rgba(11,14,20,.8)"; ctx.fillRect(u.W - w - 9, y - 13, w + 6, 12);
      ctx.fillStyle = cor; ctx.fillText(txt, u.W - 6, y - 2);
    };
    if (cfg.sr) for (const g of memoN.sr) linha(u.y(g.p), u.x(g.pri) ?? 0, g.res ? "rgba(255,120,135,.75)" : "rgba(60,220,160,.75)", [], `${g.res ? "resistência" : "suporte"} · ${g.n} toques`);
    if (cfg.niveis && memoN.dia) for (const [pr, txt] of memoN.dia.itens) linha(u.y(pr), u.x(memoN.dia.ini) ?? 0, "rgba(160,176,200,.8)", [5, 4], txt);
  });

  function calcular(D) {
    for (const x of itens) { let v = null; try { v = x.calc(D); } catch (e) { console.error(e); } x.val = v || null; }
    calcD = D;
  }
  const corVol = (D, i) => (D.c[i] >= D.o[i] ? "rgba(38,166,154,.45)" : "rgba(239,83,80,.45)");
  const ponto = (x, D, i) => {
    const v = x.val[i];
    if (v == null) return { time: D.t[i] };
    return x.hist ? { time: D.t[i], value: v, color: corVol(D, i) } : { time: D.t[i], value: v };
  };
  function pintarItem(x, D, k) {
    x.pintado = !!x.val;
    if (!x.val) { x.s.setData([]); return; }
    const out = new Array(k + 1);
    for (let i = 0; i <= k; i++) out[i] = ponto(x, D, i);
    x.s.setData(out);
  }
  const api = (AX.ind = {
    pintar(D, k) {
      if (estMontada !== D.meta.est) montar(D.meta.est);      // indicador próprio da estratégia entra ou sai junto com os dados dela
      if (calcD !== D) calcular(D);
      for (const x of itens) pintarItem(x, D, k);
    },
    avancar(D, i) {
      if (calcD !== D) return api.pintar(D, i);
      for (const x of itens) if (x.val) x.s.update(ponto(x, D, i));
    },
    // Ao vivo: D é o conjunto novo, com os mesmos candles do anterior até i0 − 1. As contas são refeitas (são rápidas),
    // mas no gráfico só entram os pontos de i0 em diante, sem redesenhar cada linha inteira a cada 5 segundos.
    atualizar(D, i0, k) {
      if (estMontada !== D.meta.est) return api.pintar(D, k);
      calcular(D);
      for (const x of itens) {
        if (!!x.val !== x.pintado) { pintarItem(x, D, k); continue; }      // passou a ter (ou deixou de ter) dados: refaz a linha
        if (x.val) for (let i = i0; i <= k; i++) x.s.update(ponto(x, D, i));
      }
    },
    legenda(D, k) {
      if (calcD !== D) return "";
      let h = "";
      for (const x of itens) {
        if (!x.rot || !x.val || x.val[k] == null) continue;
        h += `<span><i style="background:${x.cor}"></i>${x.rot} ${x.casas === 0 ? AX.num(x.val[k], 0) : AX.fmt(x.val[k], x.casas ?? undefined)}</span>`;
      }
      return h;
    },
    ops: () => cfg.ops,
    ligar(nomes) {                 // link direto: ?ind=vol,ifr,estoc,boll,kelt (não muda o que está salvo); "semniveis" esconde os níveis
      cfg = validar(Object.assign({}, cfg, Object.fromEntries(nomes.filter((n) => ["vwap", "boll", "kelt", "vol", "ifr", "estoc"].includes(n)).map((n) => [n, true])),
        nomes.includes("semniveis") ? { niveis: false, sr: false } : {}));
      montar(); AX.repintar();
    },
  });

  // ---------------------------------------------------------------- janela de escolha
  const pop = $("popInd");
  function desenharJanela() {
    const D = AX.D, semVol = D && !D.meta.temVolume, semVwap = D && !D.vw;
    const chk = (id, txt, on, extra = "", desab = false) => `<label class="chk"><input type="checkbox" data-k="${id}" ${on ? "checked" : ""} ${desab ? "disabled" : ""}> ${txt}${extra}</label>`;
    pop.innerHTML = `<div class="rot">INDICADORES</div>
      <div class="ind-titulo">Médias móveis</div>
      <div id="indMedias">${cfg.medias.map((m, j) => `<div class="ind-media" data-j="${j}">
        <input type="checkbox" data-m="on" ${m.on ? "checked" : ""} title="mostrar">
        <select data-m="tipo" title="MMS = simples · MME = exponencial"><option value="MMS" ${m.tipo === "MMS" ? "selected" : ""}>Simples</option><option value="MME" ${m.tipo === "MME" ? "selected" : ""}>Exponencial</option></select>
        <input type="number" data-m="n" min="2" max="600" step="1" value="${m.n}" title="períodos">
        <input type="color" data-m="cor" value="${m.cor}" title="cor">
        <button data-m="x" title="remover">✕</button></div>`).join("")}</div>
      <button id="indMais" class="mini-btn" ${cfg.medias.length >= 8 ? "disabled" : ""}>+ adicionar média</button>
      <div class="ind-titulo">O robô traça sozinho</div>
      ${chk("niveis", "Níveis do dia: máxima, mínima e fechamento de ontem; abertura de hoje", cfg.niveis)}
      ${chk("sr", "Suportes e resistências (topos e fundos tocados 2 vezes ou mais)", cfg.sr)}
      <div class="ind-titulo">No preço</div>
      ${chk("vwap", "VWAP (preço médio do dia)", cfg.vwap, semVwap ? ' <em class="neutro">· só no intraday</em>' : "")}
      ${chk("boll", "Bandas de Bollinger (20, 2)", cfg.boll)}
      ${chk("kelt", "Canal de Keltner (MME20 ± 2,0 e 2,5 ATR)", cfg.kelt)}
      ${chk("vol", "Volume", cfg.vol, semVol ? ' <em class="neutro">· este ativo não traz volume</em>' : "")}
      <div class="ind-titulo">Embaixo do gráfico</div>
      ${chk("ifr", "IFR / RSI de", cfg.ifr, ` <input type="number" id="indIfrN" min="2" max="100" step="1" value="${cfg.ifrN}" class="curto"> períodos`)}
      ${chk("estoc", "Estocástico lento (14, 3, 3)", cfg.estoc)}
      <div class="ind-titulo">Operações no gráfico</div>
      <select id="indOps" class="largo">
        <option value="detalhe" ${cfg.ops === "detalhe" ? "selected" : ""}>Completo: entrada, stop, alvo e saída de cada operação</option>
        <option value="simples" ${cfg.ops === "simples" ? "selected" : ""}>Simples: só a linha da entrada até a saída</option>
        <option value="nada" ${cfg.ops === "nada" ? "selected" : ""}>Só as setas (a operação clicada continua aparecendo)</option>
      </select>
      <div class="nota">Os indicadores são só para leitura do gráfico: as estratégias não mudam.</div>
      <div class="botoes"><button id="indPadrao">Voltar ao padrão</button><button id="indFechar" class="primario">Fechar</button></div>`;
    const aplicar = (redesenha = false) => { salvar(); montar(); AX.repintar(); if (redesenha) desenharJanela(); };
    pop.querySelectorAll("input[data-k]").forEach((el) => (el.onchange = () => {
      cfg[el.dataset.k] = el.checked;
      if (el.dataset.k === "niveis" || el.dataset.k === "sr") { salvar(); AX.redesenhar(); } else aplicar();
    }));
    pop.querySelectorAll(".ind-media").forEach((row) => {
      const m = cfg.medias[+row.dataset.j];
      row.querySelector('[data-m="on"]').onchange = (e) => { m.on = e.target.checked; aplicar(); };
      row.querySelector('[data-m="tipo"]').onchange = (e) => { m.tipo = e.target.value; aplicar(); };
      row.querySelector('[data-m="n"]').onchange = (e) => { const v = Math.round(+e.target.value); m.n = v >= 2 && v <= 600 ? v : m.n; e.target.value = m.n; aplicar(); };
      row.querySelector('[data-m="cor"]').onchange = (e) => { m.cor = e.target.value; aplicar(); };
      row.querySelector('[data-m="x"]').onclick = () => { cfg.medias.splice(+row.dataset.j, 1); aplicar(true); };
    });
    $("indMais").onclick = () => {
      const usados = new Set(cfg.medias.map((m) => m.n)), n = [50, 72, 100, 21, 34, 5, 500].find((v) => !usados.has(v)) || 50;
      cfg.medias.push({ tipo: "MMS", n, cor: CORES[cfg.medias.length % CORES.length], on: true }); aplicar(true);
    };
    $("indIfrN").onchange = (e) => { const v = Math.round(+e.target.value); cfg.ifrN = v >= 2 && v <= 100 ? v : 14; e.target.value = cfg.ifrN; aplicar(); };
    $("indOps").onchange = (e) => { cfg.ops = e.target.value; salvar(); AX.redesenhar(); };
    $("indPadrao").onclick = () => { cfg = padrao(); aplicar(true); };
    $("indFechar").onclick = AX.fecharPopovers;
  }
  $("btInd").onclick = () => {
    const aberto = !pop.classList.contains("oculto");
    AX.fecharPopovers();
    if (!aberto) { desenharJanela(); pop.classList.remove("oculto"); }
  };

  montar(null);
})();
