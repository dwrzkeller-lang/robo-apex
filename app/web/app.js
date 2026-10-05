/* ROBÔ KELLER — núcleo da tela: topo (ativo, tempo, estratégia, período, contratos, ajustes), tela de abertura,
   gráfico e a aba AO VIVO. Toda conta de estratégia e de resultado é feita no servidor (Python); a tela só mostra. */
(() => {
  "use strict";
  const RK = (window.RK = {});
  const $ = (id) => document.getElementById(id);
  RK.$ = $;

  // ---------------------------------------------------------------- eventos
  const ouvintes = {};
  RK.on = (ev, fn) => (ouvintes[ev] = ouvintes[ev] || []).push(fn);
  RK.emit = (ev, ...a) => (ouvintes[ev] || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } });

  // ---------------------------------------------------------------- preferências (só neste navegador)
  const PADRAO = { ativo: "WIN", tf: 5, est: "TODAS", ultEst: "E1", gestao: "padrao", contratos: 1, capital: 10000, maxstops: 2,
    som: true, auto: true, per: "1m", de: "", ate: "", larg: {}, ind: null, opsVista: "per",
    tam: "fixo", risco: 1, lossDia: 0, metaDia: 0, seletivo: false, metaMes: 0, quedaMax: 0,     // aba Plano
    criptos: [], criptoSeg: "memes", criptoAviso: false };
  RK.pref = Object.assign({}, PADRAO);
  try { Object.assign(RK.pref, JSON.parse(localStorage.getItem("rk_pref") || "{}")); } catch (e) { /* sem armazenamento */ }
  RK.salvarPref = () => { try { localStorage.setItem("rk_pref", JSON.stringify(RK.pref)); } catch (e) { /* ok */ } };
  const PERIODOS = { hoje: "hoje", "5d": "5 dias", "1m": "1 mês", "3m": "3 meses", tudo: "tudo", custom: "datas" };
  if (!(RK.pref.per in PERIODOS)) RK.pref.per = "1m";
  if (!Array.isArray(RK.pref.criptos)) RK.pref.criptos = [];
  if (RK.pref.tam !== "risco") RK.pref.tam = "fixo";

  // ---------------------------------------------------------------- servidor
  RK.json = async (url, opts) => {
    let r;
    try { r = await fetch(url, opts); } catch (e) { throw new Error("O robô não respondeu. Ele ainda está aberto? (" + e.message + ")"); }
    let j = null;
    try { j = await r.json(); } catch (e) { throw new Error("Resposta inválida do robô (HTTP " + r.status + ")"); }
    if (!r.ok || (j && j.erro)) throw new Error((j && j.erro) || "HTTP " + r.status);
    return j;
  };
  RK.api = {   // desenhos salvos na pasta dados
    async get(nome) { return (await RK.json("/api/estado?nome=" + encodeURIComponent(nome))).valor; },
    async set(nome, valor) {
      await RK.json("/api/estado?nome=" + encodeURIComponent(nome), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valor) });
    },
  };

  // ---------------------------------------------------------------- formatação
  const nf = (d) => ({ minimumFractionDigits: d, maximumFractionDigits: d });
  RK.dec = () => (RK.D ? RK.D.meta.decimais : 2);
  RK.fmt = (v, d) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("pt-BR", nf(d ?? RK.dec())));
  RK.num = (v, d = 1) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("pt-BR", nf(d)));
  RK.pct = (v, d = 1) => (v == null || isNaN(v) ? "—" : RK.num(v, d) + "%");
  RK.R = (v, d = 2) => (v == null || isNaN(v) ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + RK.num(Math.abs(v), d) + "R");
  RK.moeda = (D) => ((D || RK.D) ? (D || RK.D).meta.moeda : "R$");
  RK.dinheiro = (v, D, sinal = false) => {
    if (v == null || isNaN(v)) return "—";
    const s = v < 0 ? "−" : sinal && v > 0 ? "+" : "";
    return s + RK.moeda(D) + " " + Math.abs(v).toLocaleString("pt-BR", nf(2));
  };
  RK.reais = (v) => RK.dinheiro(v);                    // usado pela régua de desenho
  RK.valorPontoR = () => (RK.D ? RK.D.meta.valorPonto : 1);
  RK.cls = (v) => (v > 0 ? "bom" : v < 0 ? "ruim" : "neutro");
  const p2 = (n) => String(n).padStart(2, "0");
  RK.quando = (D, k, ano = false) => {
    const dt = new Date(D.t[k] * 1000);
    const dia = `${p2(dt.getUTCDate())}/${p2(dt.getUTCMonth() + 1)}${ano || !D.meta.intraday ? "/" + dt.getUTCFullYear() : ""}`;
    return D.meta.intraday ? `${dia} ${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}` : dia;
  };
  RK.quandoT = (t, intraday = true, ano = false) => {
    const dt = new Date(t * 1000);
    const dia = `${p2(dt.getUTCDate())}/${p2(dt.getUTCMonth() + 1)}${ano || !intraday ? "/" + dt.getUTCFullYear() : ""}`;
    return intraday ? `${dia} ${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}` : dia;
  };
  RK.idxT = (D, t) => {                      // índice do candle com o horário t (−1 se não existir)
    const T = D.t; let lo = 0, hi = T.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] === t) return m; if (T[m] < t) lo = m + 1; else hi = m - 1; }
    return -1;
  };
  // relógio: tudo no robô é em horário de Brasília (o do gráfico e da B3), mesmo que o computador esteja em outro fuso
  const FUSO_BR = "America/Sao_Paulo";
  RK.horaBR = (t, seg = false) => new Date(t * 1000).toLocaleTimeString("pt-BR", Object.assign({ timeZone: FUSO_BR, hour: "2-digit", minute: "2-digit" }, seg ? { second: "2-digit" } : {}));
  RK.diaBR = (t) => new Date(t * 1000).toLocaleDateString("pt-BR", { timeZone: FUSO_BR, day: "2-digit", month: "2-digit" });
  RK.dataTxt = (d) => { const s = String(d); return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`; };
  RK.dataCurta = (d) => { const s = String(d); return `${s.slice(6, 8)}/${s.slice(4, 6)}`; };
  RK.dataISO = (d) => { const s = String(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
  RK.isoInt = (iso) => (iso ? parseInt(String(iso).replace(/-/g, ""), 10) || 0 : 0);
  RK.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  RK.nomeEst = (cod) => (cod === "TODAS" ? "TODAS juntas" : ((RK.cfg && RK.cfg.estMap[cod]) || {}).nome || cod);
  RK.dirTxt = (d) => (d > 0 ? "COMPRA" : "VENDA");

  let toastT = null;
  RK.toast = (msg, tipo = "") => {
    const t = $("toast"); t.textContent = msg; t.className = "toast on " + tipo;
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 4500);
  };
  // ---------------------------------------------------------------- sons (sintetizados; ou arquivos em dados/sons)
  let audio = null;
  function tom(freq, quando, dur, vol = 0.16, tipo = "sine") {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const t0 = audio.currentTime + quando, o = audio.createOscillator(), g = audio.createGain();
      o.type = tipo; o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(audio.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    } catch (e) { /* sem som */ }
  }
  const sino = (f, q, d, v = 0.2) => { tom(f, q, d, v); tom(f * 2, q, d * 0.6, v * 0.3); tom(f * 3, q, d * 0.35, v * 0.12); };
  const SINT = {
    ordem() { tom(1175, 0, 0.09, 0.12, "triangle"); tom(1568, 0.1, 0.18, 0.12, "triangle"); },          // ordem armada: "tic-tic"
    entrada() { sino(784, 0, 0.2); sino(1175, 0.17, 1.0, 0.22); },                                     // ordem executada: "ta-dam"
    ganho() { [1047, 1319, 1568, 2093].forEach((f, j) => sino(f, j * 0.085, j === 3 ? 0.9 : 0.25, 0.16)); },   // saída no lucro
    perda() { tom(330, 0, 0.3, 0.2, "triangle"); tom(247, 0.24, 0.6, 0.2, "triangle"); },               // saída no prejuízo
    aviso() { tom(880, 0, 0.14, 0.1); tom(1320, 0.16, 0.25, 0.1); },                                   // notícia forte
  };
  RK.sons = {};                               // sons próprios: dados/sons/entrada.wav etc.
  RK.som = (nome, forcar = false) => {
    if (!RK.pref.som && !forcar) return;
    const url = RK.sons[nome];
    if (url) { try { const a = new Audio(url); a.volume = 0.8; a.play().catch(() => SINT[nome] && SINT[nome]()); return; } catch (e) { /* cai no sintetizado */ } }
    if (SINT[nome]) SINT[nome]();
  };
  RK.bip = (freq = 880) => tom(freq, 0, 0.2, 0.1);
  RK.erro = (id, e) => {
    const el = $(id);
    if (!e) { el.classList.add("oculto"); el.textContent = ""; return; }
    el.textContent = "⚠ " + (e.message || e); el.classList.remove("oculto");
  };
  RK.fecharPopovers = () => document.querySelectorAll(".popover").forEach((p) => p.classList.add("oculto"));

  // ---------------------------------------------------------------- tela de abertura
  const ORDEM_SPLASH = ["dados", "est", "resumo", "news"];
  RK.splash = {
    passo(nome, estado, txt) {
      const li = document.querySelector(`#splashPassos li[data-p="${nome}"]`);
      if (li) li.className = estado;
      const feitos = ORDEM_SPLASH.filter((p) => { const x = document.querySelector(`#splashPassos li[data-p="${p}"]`); return x && /feito|falhou/.test(x.className); }).length;
      $("splashBarra").style.width = Math.max(3, (100 * (feitos + (estado === "fazendo" ? 0.4 : 0))) / ORDEM_SPLASH.length) + "%";
      if (txt) $("splashTxt").textContent = txt;
    },
    fechar() {
      const s = $("splash");
      if (!s || s.classList.contains("saindo")) return;
      $("splashBarra").style.width = "100%";
      setTimeout(() => { s.classList.add("saindo"); setTimeout(() => s.remove(), 500); }, 250);
    },
  };

  // ---------------------------------------------------------------- gráfico
  const COR = { mm9: "#ff5b6e", mm20: "#3b9cff", mm200: "#b35cff", vw: "#ffd23f", compra: "#22d3ee", venda: "#e056fd", ganho: "#22e39a", perda: "#ff5c6e" };
  const chart = LightweightCharts.createChart($("chart"), {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0b0e14" }, textColor: "#8491a5", fontFamily: "Segoe UI, system-ui" },
    grid: { vertLines: { color: "#141a24" }, horzLines: { color: "#141a24" } },
    rightPriceScale: { borderColor: "#232c3b" },
    timeScale: { borderColor: "#232c3b", timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: 0 },
    localization: { locale: "pt-BR", priceFormatter: (p) => RK.fmt(p) },
  });
  const S = {
    candle: chart.addCandlestickSeries({ upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350" }),
  };
  // Série "âncora": invisível, sempre com as mesmas datas dos candles. Com os candles SOZINHOS no gráfico, a biblioteca
  // usa um atalho ao trocar os dados que deixa a escala de tempo apontando para objetos velhos quando as datas não mudam
  // (por exemplo, ao trocar só de estratégia). Na troca de ativo seguinte ela apagava parte dos candles e o gráfico
  // quebrava ("Value is null"). Com a âncora os candles nunca ficam sozinhos e o atalho nunca é usado.
  S.ancora = chart.addLineSeries({ visible: false, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    autoscaleInfoProvider: () => null });
  RK.chart = chart; RK.S = S; RK.COR = COR;
  RK.camadas = [];                            // funções que desenham por cima do gráfico (operações, painéis): ver desenho.js
  RK.redesenhar = () => {};

  const G = { D: null, k: -1, linhasPreco: [], viva: null };
  RK.i = 0;
  const vela = (D, i) => ({ time: D.t[i], open: D.o[i], high: D.h[i], low: D.l[i], close: D.c[i] });

  function marcadores(D, k) {
    const m = [];      // seta = entrada (azul compra, rosa venda); ponto = saída (verde ganho, vermelho perda)
    for (const t of D.trades) {
      if (t.i_ent > k) continue;
      m.push({ time: D.t[t.i_ent], position: t.dir > 0 ? "belowBar" : "aboveBar", color: t.dir > 0 ? COR.compra : COR.venda,
        shape: t.dir > 0 ? "arrowUp" : "arrowDown", size: 0.8 });
      if (t.i_sai <= k) m.push({ time: D.t[t.i_sai], position: t.dir > 0 ? "aboveBar" : "belowBar", color: t.R > 0 ? COR.ganho : COR.perda,
        shape: "circle", size: 0.6 });
    }
    for (const a of D.abertas) if (a.i_ent <= k && k === D.meta.iFim)
      m.push({ time: D.t[a.i_ent], position: a.dir > 0 ? "belowBar" : "aboveBar", color: a.dir > 0 ? COR.compra : COR.venda,
        shape: a.dir > 0 ? "arrowUp" : "arrowDown", size: 0.8 });
    m.sort((a, b) => a.time - b.time);
    return m;
  }

  function linhasDoEstado(D, k) {
    G.linhasPreco.forEach((l) => S.candle.removePriceLine(l)); G.linhasPreco = [];
    const e = RK.estadoEm(D, k);
    const add = (price, color, title, style = 2, w = 1) => { if (price != null) G.linhasPreco.push(S.candle.createPriceLine({ price, color, lineWidth: w, lineStyle: style, axisLabelVisible: true, title })); };
    if (e.pos) {
      const p = e.pos;
      add(p.ent, "#ffffff", (p.dir > 0 ? "COMPRADO " : "VENDIDO ") + p.est, 0, 2);
      add(p.stopAgora ?? p.stop, COR.perda, "STOP");
      if (p.alvo != null) add(p.alvo, COR.ganho, "ALVO");
    }
    for (const o of e.pend) {
      const ref = o.gatilho ?? D.c[k];
      add(ref, o.dir > 0 ? COR.compra : COR.venda, (o.gatilho == null ? "A MERCADO " : o.dir > 0 ? "COMPRA ACIMA " : "VENDA ABAIXO ") + o.est, 2, 2);
      add(o.stop, COR.perda, "STOP " + o.est);
      if (o.alvo != null) add(o.alvo, COR.ganho, "ALVO " + o.est);
    }
  }

  function legenda(D, k) {
    $("legenda").innerHTML = `<span><b>${RK.esc(RK.rotAtivo(D.meta.ativo))}</b> · ${D.meta.nomeTf} · ${RK.quando(D, k, true)}</span>` +
      `<span>A ${RK.fmt(D.o[k])} · M ${RK.fmt(D.h[k])} · m ${RK.fmt(D.l[k])} · F ${RK.fmt(D.c[k])}</span>` + (RK.ind ? RK.ind.legenda(D, k) : "");
  }

  // A escala de preço volta SEMPRE para o automático quando o gráfico é reposicionado: se o usuário arrastou o eixo de
  // preço (isso desliga o automático) e depois trocou de ativo/tempo/estratégia, os candles ficavam fora da tela.
  const JANELA = 220;                         // candles visíveis ao abrir (legível); o resto do período está à esquerda
  RK.autoPreco = () => chart.priceScale("right").applyOptions({ autoScale: true });
  RK.mostrarPeriodo = (D, tudo = false) => {
    const m = D.meta, ini = tudo ? m.iIni : Math.max(m.iIni, m.iFim - JANELA);
    RK.autoPreco();
    chart.timeScale().setVisibleLogicalRange({ from: ini - 2, to: m.iFim + 6 });
  };
  // botão "centralizar": volta para o último candle com a escala de preço automática
  RK.centralizar = (tudo = false) => {
    const D = G.D; if (!D) return;
    RK.autoPreco();
    if (G.k === D.meta.iFim) RK.mostrarPeriodo(D, tudo);
    else chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, G.k - 140), to: G.k + 8 });
  };
  // mostra o conjunto D no gráfico até o candle k (inclusive)
  RK.mostrar = (D, k, { manterZoom = false, foco = null } = {}) => {
    const trocouAtivo = !G.D || G.D.meta.ativo !== D.meta.ativo || G.D.meta.tf !== D.meta.tf;
    G.D = D; G.k = k; G.viva = null; RK.D = D; RK.i = k; RK.ativo = D.meta.ativo;
    const dec = D.meta.decimais;
    S.candle.applyOptions({ priceFormat: { type: "price", precision: dec, minMove: Math.pow(10, -dec) } });
    chart.applyOptions({ timeScale: { timeVisible: D.meta.intraday } });
    const velas = []; for (let i = 0; i <= k; i++) velas.push(vela(D, i));
    S.candle.setData(velas);
    S.ancora.setData(velas.map((v) => ({ time: v.time })));
    if (RK.ind) RK.ind.pintar(D, k);
    S.candle.setMarkers(marcadores(D, k));
    linhasDoEstado(D, k); legenda(D, k);
    if (foco != null) RK.focar(foco);
    else if (!manterZoom || trocouAtivo) RK.centralizar();
    if (trocouAtivo) RK.emit("carregado");
    RK.redesenhar();
  };
  // avança o gráfico já mostrado até o candle k (replay)
  RK.avancar = (k) => {
    const D = G.D; if (!D || k <= G.k) return;
    for (let i = G.k + 1; i <= k; i++) {
      S.candle.update(vela(D, i));
      S.ancora.update({ time: D.t[i] });
      if (RK.ind) RK.ind.avancar(D, i);
    }
    G.k = k; RK.i = k;
    S.candle.setMarkers(marcadores(D, k)); linhasDoEstado(D, k); legenda(D, k);
  };
  RK.focar = (i, ate = i) => { RK.autoPreco(); chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, i - 70), to: Math.max(i + 40, ate + 25) }); };
  RK.repintar = () => { if (G.D) { if (RK.ind) RK.ind.pintar(G.D, G.k); legenda(G.D, G.k); RK.redesenhar(); } };
  RK.graficoMostra = () => G.D;
  // preço em tempo real (aba Cripto): mexe só no desenho do último candle; os sinais continuam vindo do servidor
  RK.tick = (chave, preco) => {
    const D = G.D;
    if (!D || D.meta.ativo !== chave || !D.meta.aoVivo || G.k !== D.meta.ultimo || !(preco > 0)) return;
    const i = G.k, agora = Date.now() / 1000 - (D.meta.intraday ? 10800 : 0);      // candles em horário de Brasília
    if (agora >= D.t[i] + D.meta.tf * 60) return;                                 // já é outro candle: espera o servidor
    const v = G.viva || (G.viva = vela(D, i));
    v.close = preco; if (preco > v.high) v.high = preco; if (preco < v.low) v.low = preco;
    S.candle.update(v);
  };
  chart.subscribeCrosshairMove((p) => {
    const D = G.D; if (!D) return;
    let k = G.k;
    if (p && p.time != null) { const idx = p.logical; if (idx != null && idx >= 0 && idx <= G.k) k = Math.round(idx); }
    legenda(D, k);
  });

  // ---------------------------------------------------------------- estado das estratégias no candle k
  RK.estadoEm = (D, k) => {
    let pos = null;
    if (k === D.meta.iFim && D.abertas.length) {
      const a = D.abertas[0]; pos = Object.assign({}, a, { stopAgora: a.stop, stop: a.stop_ini, Ragora: a.R, aberta: true });
    } else {
      const t = D.trades.find((x) => x.i_ent <= k && k < x.i_sai);
      if (t) pos = Object.assign({}, t, { Ragora: (t.dir * (D.c[k] - t.ent)) / t.risco });
    }
    const pend = D.ordens.filter((o) => o.i_sinal <= k && (o.i_fim == null || k < o.i_fim));
    const aten = (k === D.meta.iFim ? D.atenUlt : (D.aten && D.aten[k])) || [];
    const saidas = D.trades.filter((x) => x.i_sai === k);
    return { pos, pend, aten, saidas };
  };

  // cartão "o que fazer agora" (ao vivo, fim do período e replay)
  RK.cartaoMomento = (el, D, k) => {
    const e = RK.estadoEm(D, k), m = D.meta;
    const hist = k === m.iFim && !m.aoVivo, agora = k === m.iFim && m.aoVivo;
    const qtd = (x) => (x.q != null ? x.q : m.contratos);
    const perdaNoStop = (pts, q, ref) => (pts * m.valorPonto + 2 * m.custo + 2 * (m.custoPct || 0) * Math.abs(ref) * m.valorPonto) * q;
    const riscoTxt = (pts, q, ref) => `${RK.fmt(pts)} pts = ${RK.dinheiro(perdaNoStop(pts, q, ref), D)}`;
    // quanto do capital a operação perde se for stopada: sempre à vista (laranja acima de 2%, vermelho acima de 5%)
    const capAgora = (m.dia && m.dia.capital) || m.capital;
    const pctCap = (pts, q, ref) => {
      if (!(capAgora > 0)) return "";
      const p = (100 * perdaNoStop(pts, q, ref)) / capAgora;
      return `<span class="${p > 5 ? "ruim" : p > 2 ? "alerta" : ""}">${RK.pct(p, 1)} do capital</span>`;
    };
    const tamTxt = (q, pts, ref, comPct = true) => (q > 0 ? `<tr><td><span class="sw" style="background:#8491a5"></span>Tamanho</td><td>${RK.unidade(m, q)}</td><td>${comPct ? pctCap(pts, q, ref) : ""}</td></tr>`
      : `<tr><td colspan="3" class="ruim"><b>Fora do plano:</b> o lote mínimo arrisca mais que ${RK.num(m.riscoPct, 1)}% do capital. Pelo plano, não entra.</td></tr>`);
    const aviso = agora && RK.agendaAviso ? RK.agendaAviso(m.ativo) : "";
    const tr = (cor, nome, v, extra = "") => `<tr><td><span class="sw" style="background:${cor}"></span>${nome}</td><td>${RK.fmt(v)}</td><td>${extra}</td></tr>`;
    let cls = "", html = "";
    const quem = (cod) => `<div class="quem">${RK.esc(cod)} · ${RK.esc(RK.nomeEst(cod))}${hist ? `<span class="tag-hist">FIM DO PERÍODO · ${RK.quando(D, k, true)}</span>` : ""}</div>`;
    const saiu = e.saidas.length ? `<div class="detalhe">Neste candle saiu: ${e.saidas.map((t) => `${t.est} ${RK.dirTxt(t.dir).toLowerCase()} <b class="${RK.cls(t.R)}">${RK.R(t.R)}</b> (${RK.esc(t.motivo)})`).join(" · ")}</div>` : "";
    if (e.pos) {
      const p = e.pos, R = p.Ragora;
      const movido = p.stopAgora != null && p.stopAgora !== p.stop;      // stop já andou: o risco inicial não vale mais
      cls = "pos";
      html = `<div class="estado">${p.dir > 0 ? "COMPRADO" : "VENDIDO"} <span class="${RK.cls(R)}">${RK.R(R)}</span></div>${quem(p.est)}
        <div class="detalhe">Entrou em ${RK.quando(D, p.i_ent)}${p.parcial ? " · <b>parcial feita, stop no 0x0</b>" : ""}${p.sair ? " · <b>sai na abertura do próximo candle</b> (" + RK.esc(p.sair) + ")" : ""}</div>
        <table>${tr("#fff", "Entrada", p.ent)}${tr(COR.perda, movido ? "Stop (movido)" : "Stop", p.stopAgora ?? p.stop, riscoTxt(p.risco, qtd(p), p.ent))}${p.alvo != null ? tr(COR.ganho, "Alvo", p.alvo) : ""}${tamTxt(qtd(p), p.risco, p.ent, !movido)}</table>${saiu}${aviso}`;
    } else if (e.pend.length) {
      const o = e.pend[e.pend.length - 1];
      const ref = o.gatilho ?? D.c[k], risco = Math.abs(ref - o.stop);
      cls = o.dir > 0 ? "compra" : "venda";
      const quando = o.gatilho == null ? "a mercado na abertura do próximo candle" : `${o.dir > 0 ? "acima de" : "abaixo de"} ${RK.fmt(o.gatilho)}`;
      const razao = o.alvo != null && risco ? Math.abs(o.alvo - ref) / risco : null;
      const q = qtd(o), qv = q > 0 ? q : m.contratos;
      html = `<div class="estado">${o.dir > 0 ? "COMPRA ARMADA" : "VENDA ARMADA"}</div>${quem(o.est)}
        <div class="detalhe">${RK.dirTxt(o.dir)} ${quando} · vale ${o.validade} candle(s)${o.info ? " · " + RK.esc(o.info) : ""}</div>
        <table>${tr(o.dir > 0 ? COR.compra : COR.venda, "Entrada", ref)}${tr(COR.perda, "Stop", o.stop, riscoTxt(risco, qv, ref))}${o.alvo != null ? tr(COR.ganho, `Alvo${razao ? " " + RK.num(razao, 1) + ":1" : ""}`, o.alvo, "+" + RK.dinheiro(Math.abs(o.alvo - ref) * m.valorPonto * qv, D)) : `<tr><td colspan="3" class="neutro">Saída: ${RK.esc(RK.gestaoTxt(o.gestao))}</td></tr>`}${tamTxt(q, risco, ref)}</table>
        ${o.ctx != null ? `<div class="detalhe">Contexto: ${RK.ctxTxt(o.ctx, o.er)}</div>` : ""}
        ${e.pend.length > 1 ? `<div class="detalhe">+${e.pend.length - 1} outra(s) ordem(ns): ${e.pend.slice(0, -1).map((x) => x.est + " " + RK.dirTxt(x.dir).toLowerCase()).join(", ")} — a primeira que executar vale.</div>` : ""}${saiu}${aviso}`;
    } else if (agora && m.intraday && m.dia && m.dia.trava && m.dia.data === D.d[k]) {
      cls = "trava";                                       // regra do plano: o dia acabou para esta estratégia
      html = `<div class="estado">PARE POR HOJE</div><div class="detalhe"><b>${RK.esc(m.dia.trava)}</b> · resultado do dia: <b class="${RK.cls(m.dia.resultado)}">${RK.dinheiro(m.dia.resultado, D, true)}</b>.
        O robô não arma mais entradas hoje${m.est === "TODAS" ? "" : " nesta estratégia"}.</div>${saiu}`;
    } else if (e.aten.length) {
      const [cod, dir] = e.aten[0];
      cls = "aten";
      html = `<div class="estado">ATENÇÃO: ${dir > 0 ? "COMPRA" : "VENDA"} SE FORMANDO</div>${quem(cod)}
        <div class="detalhe">Aguardando: ${RK.esc((RK.cfg.estMap[cod] || {}).aguardando || "")}. Ainda <b>não</b> é sinal.</div>${saiu}${aviso}`;
    } else {
      const leitura = k === m.iFim && m.ctx ? `<div class="detalhe">Mercado agora: ${m.ctx.diario > 0 ? "diário em alta" : m.ctx.diario < 0 ? "diário em baixa" : "diário sem tendência"} · ${m.ctx.er >= 0.35 ? "movimento limpo" : "movimento em serrote"}${m.seletivo ? " · modo seletivo ligado" : ""}</div>` : "";
      html = `<div class="estado">AGUARDANDO SETUP</div><div class="detalhe">${m.est === "TODAS" ? "Nenhuma estratégia" : RK.esc(RK.nomeEst(m.est)) + " não"} tem setup ${hist ? "no fim do período (" + RK.quando(D, k, true) + ")" : "agora"}.</div>${leitura}${saiu}${aviso}`;
    }
    el.className = "card momento " + cls + (hist ? " hist" : "");
    el.innerHTML = html;
    return e;
  };

  const CURTO = { "VANTAGEM ESTATÍSTICA": "VANTAGEM", "PROMISSORA, NÃO COMPROVADA": "NÃO COMPROVADA" };
  RK.seloCurto = (st) => `<span class="selo ${st.cor || "neutro"}" title="${RK.esc((st.veredito || "") + ": " + (st.explica || ""))}">${RK.esc(CURTO[st.veredito] || st.veredito || "—")}</span>`;

  // curva do capital pequena (uma marca por operação)
  RK.sparkline = (cv, valores) => {
    if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const pts = [0]; let s = 0; for (const v of valores) { s += v; pts.push(s); }
    if (pts.length < 2) return;
    const mn = Math.min(...pts), mx = Math.max(...pts), amp = mx - mn || 1;
    const X = (i) => 2 + (i * (w - 4)) / (pts.length - 1), Y = (v) => 3 + ((mx - v) * (h - 6)) / amp;
    c.strokeStyle = "#2f3a4d"; c.setLineDash([3, 3]); c.beginPath(); c.moveTo(0, Y(0)); c.lineTo(w, Y(0)); c.stroke(); c.setLineDash([]);
    const cor = s >= 0 ? "#22e39a" : "#ff5c6e";
    c.beginPath(); pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.strokeStyle = cor; c.lineWidth = 2; c.stroke();
    c.lineTo(X(pts.length - 1), Y(0)); c.lineTo(X(0), Y(0)); c.closePath();
    c.fillStyle = s >= 0 ? "rgba(34,227,154,.10)" : "rgba(255,92,110,.10)"; c.fill();
  };

  // ---------------------------------------------------------------- parâmetros para o servidor
  RK.cfg = null;
  RK.parametros = (extra = {}) => {
    const p = RK.pref;
    const q = new URLSearchParams({ ativo: p.ativo, tf: p.tf, est: p.est, gestao: p.gestao, contratos: p.contratos,
      capital: p.capital, maxstops: p.maxstops, per: p.per === "custom" ? "tudo" : p.per });
    if (p.per === "custom") { q.set("de", RK.isoInt(p.de)); q.set("ate", RK.isoInt(p.ate)); }
    for (const [k, v] of Object.entries(RK.planoParams())) q.set(k, v);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return q.toString();
  };
  // regras do plano de trade (aba Plano) que vão em todo pedido ao servidor; só o que não é o padrão
  RK.planoParams = (p = RK.pref) => {
    const o = {};
    if (p.tam === "risco") { o.tam = "risco"; o.risco = p.risco; }
    if (p.lossDia > 0) o.lossDia = p.lossDia;
    if (p.metaDia > 0) o.metaDia = p.metaDia;
    if (p.seletivo) o.seletivo = 1;
    return o;
  };
  // nome da gestão de uma operação: as do menu e as duas internas (saída/alvo da própria estratégia)
  RK.gestaoTxt = (g) => RK.cfg.gestoes[g] || { propria: "regra de saída da própria estratégia", fixo: "alvo da própria estratégia" }[g] || g || "";
  // ativos: os do robô + as criptomoedas abertas pela aba Cripto ("BN:DOGEUSDT" à vista, "BF:POPCATUSDT" futuro)
  RK.ehCripto = (c) => /^B[NF]:[A-Z0-9]{2,24}$/.test(c || "");
  RK.nomeCripto = (c) => { const s2 = c.slice(3); return (s2.endsWith("USDT") ? s2.slice(0, -4) + "/USDT" : s2) + (c.startsWith("BF:") ? " (futuro)" : ""); };
  RK.infoAtivo = (c) => (RK.cfg && RK.cfg.ativos.find((x) => x.chave === c)) || RK.pref.criptos.find((x) => x.chave === c) ||
    (RK.ehCripto(c) ? { chave: c, nome: RK.nomeCripto(c), fracionado: true, cripto: true } : null);
  RK.ativoValido = (c) => !!RK.infoAtivo(c);
  RK.rotAtivo = (c) => (RK.ehCripto(c) ? RK.nomeCripto(c) : c);
  RK.unidade = (m, q) => `${RK.num(q, m.fracionado ? 2 : 0)} ${m.fracionado ? "lote" : "contrato"}${q === 1 ? "" : "s"}`;
  RK.ctxTxt = (ctx, er) => (ctx > 0 ? '<span class="bom">a favor da tendência do diário</span>' : ctx < 0 ? '<span class="ruim">contra a tendência do diário</span>' : "diário sem tendência")
    + (er == null ? "" : er >= 0.35 ? " · movimento limpo" : " · movimento em serrote");
  RK.periodoTexto = (D) => (D ? `${RK.dataCurta(D.meta.dataIni)} a ${RK.dataCurta(D.meta.dataFim)}` : PERIODOS[RK.pref.per]);

  // ---------------------------------------------------------------- topo
  const nomeCurto = (n) => {                 // "Mini Índice (WIN) - proxy: ..." -> "Mini Índice (WIN)"; nome completo no title
    let c = n.split(" - ")[0].replace(/\s*\(hor.*$/, "").trim();
    if ((c.match(/\(/g) || []).length > (c.match(/\)/g) || []).length) c = c.split("(")[0].trim();
    return c;
  };
  function montarAtivos() {
    const op = (a) => `<option value="${RK.esc(a.chave)}" title="${RK.esc(a.nome)}">${RK.esc(nomeCurto(a.nome))}</option>`;
    const cr = RK.pref.criptos;
    $("ativo").innerHTML = (cr.length ? `<optgroup label="Mercados">` : "") + RK.cfg.ativos.map(op).join("") +
      (cr.length ? `</optgroup><optgroup label="Cripto (Binance, tempo real)">${cr.map(op).join("")}</optgroup>` : "");
    $("ativo").value = RK.pref.ativo;
  }
  // abre uma moeda da Binance no gráfico (vem da aba Cripto): entra na lista de ativos e vira o ativo atual
  RK.abrirCripto = (chave, nome) => {
    if (!RK.ehCripto(chave)) return false;
    RK.pref.criptos = [{ chave, nome: nome || RK.nomeCripto(chave), fracionado: true, cripto: true }]
      .concat(RK.pref.criptos.filter((x) => x.chave !== chave)).slice(0, 12);
    montarAtivos();
    if (RK.pref.ativo !== chave) RK.escolherAtivo(chave); else RK.salvarPref();
    return true;
  };
  function ajustarContratos() {
    const a = RK.infoAtivo(RK.pref.ativo) || {};
    const inp = $("contratos");
    const peloRisco = RK.pref.tam === "risco";
    inp.step = a.fracionado ? "0.01" : "1"; inp.min = a.fracionado ? "0.01" : "1";
    inp.disabled = peloRisco;
    $("rotContratos").textContent = (a.fracionado ? "Lotes" : "Contratos") + (peloRisco ? " · risco" : "");
    inp.parentElement.title = peloRisco ? "O tamanho de cada operação está sendo calculado pelo risco (aba Plano)" : "";
    if (!a.fracionado) RK.pref.contratos = Math.max(1, Math.round(RK.pref.contratos));
    inp.value = RK.pref.contratos;
  }
  function montarEstrategias() {
    const diario = +RK.pref.tf >= 1440;
    $("est").innerHTML = `<option value="TODAS">▶ TODAS juntas</option>` + RK.cfg.estrategias.map((e) =>
      `<option value="${e.cod}" ${e.intraday && diario ? "disabled" : ""}>${e.cod} · ${RK.esc(e.nome)}${e.intraday && diario ? " (só intraday)" : ""}</option>`).join("");
    $("est").value = RK.pref.est;
    $("btTodas").classList.toggle("on", RK.pref.est === "TODAS");
  }
  function marcarPeriodo() {
    document.querySelectorAll("#periodo button").forEach((b) => b.classList.toggle("on", b.dataset.p === RK.pref.per));
    $("periodoTxt").textContent = V.D ? RK.periodoTexto(V.D) : "";
  }
  RK.escolherEst = (cod) => {
    if (cod === RK.pref.est) return;
    const e = RK.cfg.estMap[cod];
    if (e && e.intraday && +RK.pref.tf >= 1440) { RK.toast(`${e.nome} só funciona em gráfico intraday.`, "aviso"); montarEstrategias(); return; }
    if (cod !== "TODAS") RK.pref.ultEst = cod;
    RK.pref.est = cod; RK.salvarPref(); montarEstrategias();
    RK.emit("mudou", "est");
  };
  RK.escolherTf = (tf) => {
    if (+tf === +RK.pref.tf) return;
    RK.pref.tf = +tf; $("tf").value = tf; corrigirEst(); RK.salvarPref(); RK.emit("mudou", "tf");
  };
  function corrigirEst() {
    const e = RK.cfg.estMap[RK.pref.est];
    if (e && e.intraday && +RK.pref.tf >= 1440) { RK.pref.est = "TODAS"; RK.toast(`${e.nome} só funciona em gráfico intraday — mudei para TODAS juntas.`, "aviso"); }
    montarEstrategias();
  }
  RK.atualizarTopo = () => {
    $("ativo").value = RK.pref.ativo; $("tf").value = RK.pref.tf; $("gestao").value = RK.pref.gestao;
    ajustarContratos(); montarEstrategias(); marcarPeriodo();
  };
  RK.escolherAtivo = (a) => {
    RK.pref.ativo = a; $("ativo").value = a; ajustarContratos(); RK.salvarPref(); RK.emit("mudou", "ativo");
  };
  RK.irPara = ({ ativo, tf, est }) => {
    const p = RK.pref;
    if (ativo === p.ativo && +tf === +p.tf && est === p.est) return false;
    p.ativo = ativo; p.tf = +tf; p.est = est; if (est !== "TODAS") p.ultEst = est;
    RK.salvarPref(); RK.atualizarTopo(); RK.emit("mudou", "ativo");
    return true;
  };
  function abrirDatas() {
    RK.fecharPopovers();
    const D = V.D;
    if (D) {
      const min = RK.dataISO(D.meta.dataMin), max = RK.dataISO(D.meta.dataMax);
      $("perDe").min = $("perAte").min = min; $("perDe").max = $("perAte").max = max;
      $("perDe").value = RK.pref.de && RK.pref.de >= min ? RK.pref.de : RK.dataISO(D.meta.dataIni);
      $("perAte").value = RK.pref.ate && RK.pref.ate <= max ? RK.pref.ate : RK.dataISO(D.meta.dataFim);
      $("perDisponivel").textContent = `Dados de ${RK.dataTxt(D.meta.dataMin)} a ${RK.dataTxt(D.meta.dataMax)} neste tempo gráfico.`;
    }
    $("popDatas").classList.remove("oculto");
  }
  function ligarTopo() {
    const sa = $("ativo"), st = $("tf"), sg = $("gestao"), sc = $("contratos");
    RK.pref.criptos = RK.pref.criptos.filter((x) => x && RK.ehCripto(x.chave)).slice(0, 12);
    if (RK.ehCripto(RK.pref.ativo) && !RK.pref.criptos.some((x) => x.chave === RK.pref.ativo))
      RK.pref.criptos.unshift({ chave: RK.pref.ativo, nome: RK.nomeCripto(RK.pref.ativo), fracionado: true, cripto: true });
    st.innerHTML = RK.cfg.tempos.map((t) => `<option value="${t.tf}">${t.nome}</option>`).join("");
    sg.innerHTML = Object.entries(RK.cfg.gestoes).map(([k, v]) => `<option value="${k}">${RK.esc(v)}</option>`).join("");
    if (!RK.ativoValido(RK.pref.ativo)) RK.pref.ativo = "WIN";
    montarAtivos();
    if (!RK.cfg.tempos.some((t) => +t.tf === +RK.pref.tf)) RK.pref.tf = 5;
    if (!(RK.pref.gestao in RK.cfg.gestoes)) RK.pref.gestao = "padrao";
    if (RK.pref.est !== "TODAS" && !RK.cfg.estMap[RK.pref.est]) RK.pref.est = "TODAS";
    if (!RK.cfg.estMap[RK.pref.ultEst]) RK.pref.ultEst = "E1";
    sa.value = RK.pref.ativo; st.value = RK.pref.tf; sg.value = RK.pref.gestao;
    ajustarContratos(); corrigirEst(); marcarPeriodo();
    sa.onchange = () => RK.escolherAtivo(sa.value);
    st.onchange = () => RK.escolherTf(+st.value);
    $("est").onchange = () => RK.escolherEst($("est").value);
    $("btTodas").onclick = () => RK.escolherEst(RK.pref.est === "TODAS" ? RK.pref.ultEst : "TODAS");
    sc.onchange = () => {
      const a = RK.infoAtivo(RK.pref.ativo) || {};
      let v = parseFloat(String(sc.value).replace(",", "."));
      if (!(v > 0)) v = a.fracionado ? 0.01 : 1;
      RK.pref.contratos = a.fracionado ? Math.max(0.01, Math.round(v * 100) / 100) : Math.max(1, Math.round(v));
      sc.value = RK.pref.contratos; RK.salvarPref(); RK.emit("mudou", "contratos");
    };
    document.querySelectorAll("#periodo button").forEach((b) => (b.onclick = () => {
      if (b.dataset.p === "custom") return abrirDatas();
      RK.fecharPopovers();
      if (RK.pref.per === b.dataset.p) return;
      RK.pref.per = b.dataset.p; RK.salvarPref(); marcarPeriodo(); RK.emit("mudou", "periodo");
    }));
    $("perCancelar").onclick = RK.fecharPopovers;
    $("perAplicar").onclick = () => {
      const de = $("perDe").value, ate = $("perAte").value;
      if (!de || !ate) return RK.toast("Escolha as duas datas.", "aviso");
      if (de > ate) return RK.toast("A data inicial é depois da final.", "aviso");
      RK.pref.per = "custom"; RK.pref.de = de; RK.pref.ate = ate; RK.salvarPref(); RK.fecharPopovers(); marcarPeriodo();
      RK.emit("mudou", "periodo");
    };
    // ajustes
    $("capital").value = RK.pref.capital; $("maxstops").value = RK.pref.maxstops;
    $("autoVivo").checked = RK.pref.auto; $("somVivo").checked = RK.pref.som;
    $("btAjustes").onclick = () => { const p = $("popAjustes"), aberto = !p.classList.contains("oculto"); RK.fecharPopovers(); if (!aberto) p.classList.remove("oculto"); };
    $("ajFechar").onclick = RK.fecharPopovers;
    sg.onchange = () => { RK.pref.gestao = sg.value; RK.salvarPref(); RK.emit("mudou", "gestao"); };
    $("capital").onchange = () => {
      const v = parseFloat(String($("capital").value).replace(",", "."));
      RK.pref.capital = v > 0 ? v : 10000; $("capital").value = RK.pref.capital; RK.salvarPref(); RK.emit("mudou", "plano");
    };
    $("maxstops").onchange = () => {
      const v = parseInt($("maxstops").value, 10);
      RK.pref.maxstops = v > 0 ? Math.min(20, v) : 2; $("maxstops").value = RK.pref.maxstops; RK.salvarPref(); RK.emit("mudou", "plano");
    };
    RK.on("mudou", (o) => { if (o === "plano") { $("capital").value = RK.pref.capital; $("maxstops").value = RK.pref.maxstops; ajustarContratos(); } });
    $("autoVivo").onchange = (e) => { RK.pref.auto = e.target.checked; RK.salvarPref(); };
    $("somVivo").onchange = (e) => { RK.pref.som = e.target.checked; RK.salvarPref(); if (e.target.checked) RK.som("entrada"); };
    document.querySelectorAll("#ouvirSons button").forEach((b) => (b.onclick = () => RK.som(b.dataset.s, true)));
    $("btAtualizar").onclick = () => { RK.fecharPopovers(); carregarVivo(); };
    $("btRobo").onclick = () => RK.emit("rodarRobo");
    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".popover") && !e.target.closest("#btAjustes") && !e.target.closest("#periodo") && !e.target.closest("#btInd")) RK.fecharPopovers();
    });
  }

  // ---------------------------------------------------------------- aba AO VIVO
  const V = { D: null, seq: 0, velho: true, pedido: 0 };
  RK.vivo = V;
  async function carregarVivo(silencioso = false) {
    const seq = ++V.seq;
    V.pedido = Date.now();
    if (!silencioso) $("carregando").classList.remove("oculto");
    try {
      const D = await RK.json("/api/sim?" + RK.parametros());
      if (seq !== V.seq) return false;                 // chegou uma resposta velha: ignora
      const antes = V.D;
      V.D = D; V.velho = false;
      RK.erro("erroVivo", null);
      if (ABAS_VIVAS.includes(RK.aba) || !RK.graficoMostra()) RK.mostrar(D, D.meta.iFim, { manterZoom: silencioso });
      renderVivo(D);
      marcarPeriodo();
      RK.emit("dadosVivo", D);
      avisarNovidade(antes, D);
      return true;
    } catch (e) {
      if (seq !== V.seq) return false;
      RK.erro("erroVivo", e); RK.toast(e.message, "erro");
      throw e;
    } finally {
      if (seq === V.seq) $("carregando").classList.add("oculto");
    }
  }
  RK.carregarVivo = (s) => carregarVivo(s).catch(() => false);

  // O que aconteceu entre dois retratos da mesma estratégia: ordem armada, entrada executada, saída no ganho/na perda.
  // x = { pend, abertas, trades } (cada item com est e os horários t_sinal / t_ent / t_sai); tAntes = último candle do retrato velho.
  RK.novidades = (antes, depois, tAntes) => {
    const chP = (o) => o.est + "|" + o.t_sinal + "|" + o.dir, chA = (a) => a.est + "|" + a.t_ent;
    const velhasP = new Set(antes.pend.map(chP)), velhasA = new Set(antes.abertas.map(chA)), velhasT = new Set(antes.trades.map(chA));
    const ev = [];
    for (const t of depois.trades) if (!velhasT.has(chA(t)) && t.t_sai >= tAntes) {
      if (!velhasA.has(chA(t))) ev.push({ tipo: "entrada", o: t });           // entrou e saiu entre duas atualizações
      ev.push({ tipo: t.R > 0 ? "ganho" : "perda", o: t });
    }
    for (const a of depois.abertas) if (!velhasA.has(chA(a))) ev.push({ tipo: "entrada", o: a });
    for (const o of depois.pend) if (!velhasP.has(chP(o))) ev.push({ tipo: "ordem", o });
    return ev;
  };
  // toca o som do evento mais importante e mostra o aviso
  RK.anunciar = (ev, meta, prefixo = "") => {
    if (!ev.length) return;
    const peso = { ordem: 1, entrada: 2, ganho: 3, perda: 3 };
    const top = ev.slice().sort((a, b) => peso[b.tipo] - peso[a.tipo])[0], o = top.o;
    const dec = meta.decimais, f = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const lado = o.dir > 0 ? "COMPRA" : "VENDA";
    const txt = top.tipo === "ordem" ? `${o.est}: ${lado} armada${o.gatilho != null ? (o.dir > 0 ? " acima de " : " abaixo de ") + f(o.gatilho) : " (a mercado no próximo candle)"}`
      : top.tipo === "entrada" ? `${o.est}: ${lado} executada a ${f(o.ent)}`
        : `${o.est}: saiu (${o.motivo}) ${RK.R(o.R)} = ${RK.dinheiro(o.dinheiro, { meta }, true)}`;
    RK.som(top.tipo);
    RK.toast(prefixo + txt, top.tipo === "ganho" ? "ok" : top.tipo === "perda" ? "erro" : "");
    if (document.hidden) document.title = "● Robô Keller";
  };
  const retrato = (D) => ({ pend: D.ordens.filter((o) => o.status === "pendente"), abertas: D.abertas, trades: D.trades });
  function avisarNovidade(antes, D) {
    const a = antes && antes.meta, m = D.meta;
    if (!a || !m.aoVivo || !a.aoVivo || a.ativo !== m.ativo || a.tf !== m.tf || a.est !== m.est || a.gestao !== m.gestao ||
      a.contratos !== m.contratos || a.maxStops !== m.maxStops || a.iIni !== m.iIni || a.tam !== m.tam || a.riscoPct !== m.riscoPct ||
      a.seletivo !== m.seletivo || a.lossDia !== m.lossDia || a.metaDia !== m.metaDia) return;
    const ev = RK.novidades(retrato(antes), retrato(D), antes.t[a.ultimo]);
    if (!ev.length) return;
    const card = $("cardVivo"); card.classList.remove("pulso"); void card.offsetWidth; card.classList.add("pulso");
    if (RK.testes && RK.testes.cobre(m)) return;          // o teste ao vivo deste mesmo ativo/estratégia já avisa
    RK.anunciar(ev, m);
  }

  function renderVivo(D) {
    const m = D.meta, st = D.stats, k = m.iFim;
    RK.cartaoMomento($("cardVivo"), D, k);
    // status no topo
    const dt = RK.quando(D, D.meta.ultimo, true);
    $("statusDados").innerHTML = m.aoVivo ? `<i class="luz vivo"></i><span>ao vivo · último candle ${dt}</span>` : `<i class="luz hist"></i><span>histórico · até ${RK.dataTxt(m.dataFim)}</span>`;
    $("statusDados").title = m.fonte;
    if (!$("contratos").disabled) $("contratos").parentElement.title = m.lote && m.lote !== "contrato" ? "Tamanho de 1 lote: " + m.lote : "";
    // resumo do período
    const est = m.est, eInfo = RK.cfg.estMap[est];
    const regras = est === "TODAS" ? RK.cfg.estrategias.map((e) => `<li><b>${e.cod} ${RK.esc(e.nome)}</b> — ${RK.esc(e.regras[0])}</li>`).join("")
      : eInfo.regras.map((r) => `<li>${RK.esc(r)}</li>`).join("") + (eInfo.ideal ? `<li><b>Onde funciona melhor:</b> ${RK.esc(eInfo.ideal)}</li>` : "");
    const seta = (v) => (v === 1 ? '<span class="bom">▲ alta</span>' : v === -1 ? '<span class="ruim">▼ baixa</span>' : '<span class="neutro">■ indefinida</span>');
    const ctx = D.contexto ? `<span>Dow (só leitura): semanal ${seta(D.contexto.semanal)} · diário ${seta(D.contexto.diario)}</span>` : "";
    const tamanho = m.tam === "risco" ? `risco de ${RK.num(m.riscoPct, 1)}% do capital por operação` : RK.unidade(m, m.contratos);
    const plano = [m.seletivo ? "modo seletivo" : "", m.lossDia > 0 ? `para o dia em −${RK.dinheiro(m.lossDia, D)}` : "", m.metaDia > 0 ? `para o dia em +${RK.dinheiro(m.metaDia, D)}` : ""].filter(Boolean).join(" · ");
    let html = `<div class="rot">NO PERÍODO · ${RK.esc(RK.nomeEst(est))}<span class="dir">${RK.dataTxt(m.dataIni)} a ${RK.dataTxt(m.dataFim)}</span></div>`;
    if (st.n) {
      const cr = st.custoR || 0;
      html += `<div class="resumo-topo"><div><div class="grande ${RK.cls(st.total)}">${RK.dinheiro(st.total, D, true)}</div>
          <div class="sub">${st.n} operações · acerto ${RK.pct(st.acerto, 0)} (empata com ${RK.pct(st.empate, 0)}) · ${tamanho}</div></div>${RK.seloCurto(st)}</div>
        <canvas class="spark" id="sparkVivo"></canvas>
        <div class="kpis">
          <div><small>Média por operação</small><b class="${RK.cls(st.mediaDin)}">${RK.dinheiro(st.mediaDin, D, true)}</b><em>± ${RK.dinheiro(st.icDin, D)}</em></div>
          <div><small>Pior queda</small><b class="ruim">${RK.dinheiro(-st.ddMax, D)}</b><em>${RK.pct(st.ddPct, 0)} do pico</em></div>
          <div title="Taxas, corretagem e escorregamento somados. Sem eles o resultado seria ${RK.dinheiro(st.bruto, D, true)}"><small>Custos</small><b class="${cr >= 0.15 ? "ruim" : ""}">${RK.dinheiro(-st.custos, D)}</b><em>${RK.pct(100 * cr, 0)} do risco de cada operação</em></div>
        </div>
        ${st.n >= 10 && cr >= 0.15 ? `<div class="aviso-custo">⚠ Aqui os custos comem <b>${RK.pct(100 * cr, 0)}</b> do risco de cada operação (sem custos o resultado seria ${RK.dinheiro(st.bruto, D, true)}). Com custo tão alto é quase impossível ganhar: teste um tempo gráfico maior (60 min) ou um ativo de custo menor.</div>` : ""}`;
    } else {
      html += `<div class="resumo-topo"><div><div class="grande neutro">sem operações</div><div class="sub">nenhum setup desta estratégia no período escolhido</div></div>${RK.seloCurto(st)}</div>`;
    }
    const cx = st.ctx;
    html += `${plano ? `<div class="linha-ctx"><span>Plano: ${plano}</span></div>` : ""}
      ${m.foraDoPlano ? `<div class="linha-ctx"><span class="ruim">${m.foraDoPlano} ordem(ns) ficaram de fora: o lote mínimo arriscava mais que ${RK.num(m.riscoPct, 1)}% do capital.</span></div>` : ""}
      <div class="linha-ctx">${ctx}</div>
      <details><summary>Como ler · regras · detalhes</summary>
        <div class="nota">${RK.esc(st.explica || "")}${st.n ? ` Média na 1ª metade: ${RK.dinheiro(st.exp1, D, true)} · na 2ª: ${RK.dinheiro(st.exp2, D, true)}. Ganho médio ÷ perda média: ${RK.num(st.payoff, 2)} · fator de lucro ${RK.num(st.fatorLucro, 2)}.` : ""}</div>
        ${cx && (cx.favor.n || cx.contra.n) ? `<div class="nota">A favor da tendência do diário: ${cx.favor.n} operações, média ${RK.dinheiro(cx.favor.media, D, true)}. Contra: ${cx.contra.n} operações, média ${RK.dinheiro(cx.contra.media, D, true)}.</div>` : ""}
        <ul class="regras">${regras}</ul>
        <div class="nota">Gestão: ${RK.esc(RK.cfg.gestoes[m.gestao])}. Custos: escorregamento de ${RK.fmt(m.slip)} por lado${m.custo ? ` + ${RK.dinheiro(m.custo, D)} por ${m.fracionado ? "lote" : "contrato"} por lado` : ""}${m.custoPct ? ` + taxa de ${RK.num(100 * m.custoPct, 2)}% do valor por lado` : ""}. ${m.lote ? "Tamanho: " + RK.esc(m.lote) + ". " : ""}Fonte: ${RK.esc(m.fonte)}.</div>
      </details>`;
    $("resumoVivo").innerHTML = html;
    RK.sparkline($("sparkVivo"), D.trades.map((t) => t.dinheiro));
    // TODAS: cada estratégia sozinha
    const tv = $("tabelaVivo");
    if (est === "TODAS" && D.porEst && Object.keys(D.porEst).length) {
      tv.classList.remove("oculto");
      tv.innerHTML = `<details><summary style="margin-top:0">Cada estratégia sozinha no período (clique para ver)</summary><table class="tab" style="margin-top:6px"><tr><th>Estratégia</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Resultado</th><th></th></tr>` +
        Object.entries(D.porEst).map(([c, r]) => { const s = r.isolada; return `<tr class="clic" data-est="${c}"><td class="nome" title="${RK.esc(RK.nomeEst(c))}">${c} ${RK.esc(RK.nomeEst(c))}</td><td class="n">${s.n}</td><td class="n">${RK.pct(s.acerto, 0)}</td><td class="n ${RK.cls(s.total)}">${RK.dinheiro(s.total, D, true)}</td><td>${RK.seloCurto(s)}</td></tr>`; }).join("") +
        `</table><div class="nota">Clique numa linha para ver só aquela estratégia.</div></details>`;
      tv.querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => RK.escolherEst(tr.dataset.est)));
    } else tv.classList.add("oculto");
  }

  // ---------------------------------------------------------------- abas
  RK.aba = "vivo";
  // largura do painel: arraste a divisória (cada tamanho de aba guarda a sua); duplo clique volta ao padrão
  const classeLarg = () => (RK.aba === "cmp" ? "l" : RK.aba === "cripto" ? "c" : RK.aba === "sim" || RK.aba === "cal" ? "m" : "n");
  const limiteLarg = (w) => Math.round(Math.max(300, Math.min(window.innerWidth - 380, w)));
  function aplicarLargura() {
    const w = (RK.pref.larg || {})[classeLarg()];
    $("painel").style.width = w > 0 ? limiteLarg(w) + "px" : "";
  }
  (() => {
    const dv = $("divisor"); let arrastando = false;
    dv.addEventListener("pointerdown", (e) => { arrastando = true; dv.setPointerCapture(e.pointerId); document.body.classList.add("arrastando"); e.preventDefault(); });
    dv.addEventListener("pointermove", (e) => {
      if (!arrastando) return;
      const w = limiteLarg(window.innerWidth - e.clientX - 3);
      $("painel").style.width = w + "px";
      RK.pref.larg = Object.assign({}, RK.pref.larg, { [classeLarg()]: w });
    });
    const fim = () => {
      if (!arrastando) return;
      arrastando = false; document.body.classList.remove("arrastando"); RK.salvarPref();
      window.dispatchEvent(new Event("resize"));
    };
    dv.addEventListener("pointerup", fim); dv.addEventListener("pointercancel", fim);
    dv.addEventListener("dblclick", () => {
      const l = Object.assign({}, RK.pref.larg); delete l[classeLarg()]; RK.pref.larg = l; RK.salvarPref(); aplicarLargura();
      window.dispatchEvent(new Event("resize"));
    });
    window.addEventListener("resize", () => { if (!arrastando) aplicarLargura(); });
  })();
  $("btCentro").onclick = () => RK.centralizar();
  $("btPeriodoTodo").onclick = () => RK.centralizar(true);
  function trocarAba(nome) {
    RK.aba = nome;
    document.querySelectorAll(".abas button").forEach((b) => b.classList.toggle("on", b.dataset.aba === nome));
    document.querySelectorAll(".aba").forEach((s) => s.classList.toggle("on", s.id === "aba-" + nome));
    $("painel").classList.toggle("largo", nome === "cmp");
    $("painel").classList.toggle("medio", nome === "sim" || nome === "cal");
    $("painel").classList.toggle("cripto", nome === "cripto");
    aplicarLargura();
    if (nome === "vivo" || nome === "cal" || nome === "plano" || nome === "cripto") {
      if (V.D && !V.velho) { if (RK.graficoMostra() !== V.D) RK.mostrar(V.D, V.D.meta.iFim); if (nome === "vivo") renderVivo(V.D); }
      else RK.carregarVivo();
    }
    RK.emit("aba", nome);
  }
  RK.trocarAba = trocarAba;
  document.querySelectorAll(".abas button").forEach((b) => (b.onclick = () => trocarAba(b.dataset.aba)));
  window.addEventListener("resize", () => { if (V.D && RK.aba === "vivo") RK.sparkline($("sparkVivo"), V.D.trades.map((t) => t.dinheiro)); });

  const ABAS_VIVAS = ["vivo", "cal", "plano", "cripto"];       // abas em que o gráfico mostra o "agora"
  RK.on("mudou", () => {
    V.velho = true;
    if (ABAS_VIVAS.includes(RK.aba)) RK.carregarVivo();
  });

  // atualização automática (período que chega até hoje, janela visível): 30 s; criptomoeda da Binance, 10 s
  setInterval(() => {
    if (!(RK.cfg && RK.pref.auto && ABAS_VIVAS.includes(RK.aba) && RK.aba !== "cal" && !document.hidden && V.D && V.D.meta.aoVivo)) return;
    if (Date.now() - V.pedido >= (V.D.meta.cripto ? 10000 : 30000) - 600) RK.carregarVivo(true);
  }, 5000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = "Robô Keller";
      if (RK.cfg && ABAS_VIVAS.includes(RK.aba) && RK.pref.auto && V.D && V.D.meta.aoVivo) RK.carregarVivo(true);
    }
  });
  document.addEventListener("keydown", (e) => {
    const alvo = e.target && e.target.tagName;
    if (alvo === "INPUT" || alvo === "SELECT" || alvo === "TEXTAREA") return;
    if (e.key === "Escape") RK.fecharPopovers();
    if (e.key === "Home") { e.preventDefault(); RK.centralizar(); }
    RK.emit("tecla", e);
  });
  window.addEventListener("error", (e) => { if (!/ResizeObserver/.test(e.message || "")) RK.toast("Erro na tela: " + e.message, "erro"); });
  window.addEventListener("unhandledrejection", (e) => RK.toast("Erro: " + ((e.reason && e.reason.message) || e.reason), "erro"));

  // ---------------------------------------------------------------- início (com a tela de abertura)
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  (async function iniciar() {
    const t0 = performance.now();
    const sp = RK.splash;
    try {
      sp.passo("dados", "fazendo", "conectando ao robô…");
      // espera os outros módulos (ind, sim, calendário, operações…) carregarem: eles ouvem o evento "config"
      if (document.readyState === "loading") await new Promise((ok) => document.addEventListener("DOMContentLoaded", ok, { once: true }));
      RK.cfg = await RK.json("/api/config");
      RK.cfg.estMap = Object.fromEntries(RK.cfg.estrategias.map((e) => [e.cod, e]));
      // link direto: ?ativo=WIN&tf=5&est=TODAS&per=5d&aba=sim&acao=simular|replay|robo&passos=40
      const u = new URLSearchParams(location.search);
      for (const k of ["ativo", "est", "gestao", "per"]) if (u.has(k)) RK.pref[k] = u.get(k);
      for (const k of ["tf", "contratos", "risco", "lossDia", "metaDia", "metaMes", "quedaMax", "capital"]) if (u.has(k) && +u.get(k) > 0) RK.pref[k] = +u.get(k);
      if (u.has("tam")) RK.pref.tam = u.get("tam") === "risco" ? "risco" : "fixo";
      if (u.has("seletivo")) RK.pref.seletivo = u.get("seletivo") === "1";
      if (u.has("seg")) RK.pref.criptoSeg = u.get("seg");
      if (u.has("de") && u.has("ate")) { RK.pref.per = "custom"; RK.pref.de = u.get("de"); RK.pref.ate = u.get("ate"); }
      if (!(RK.pref.per in PERIODOS)) RK.pref.per = "1m";
      ligarTopo();
      aplicarLargura();
      RK.json("/api/sons").then((j) => { RK.sons = j.sons || {}; RK.pastaSons = j.pasta; }).catch(() => {});
      RK.emit("config", RK.cfg);
      sp.passo("dados", "fazendo", `baixando ${RK.pref.ativo} em ${RK.pref.tf >= 1440 ? "diário" : RK.pref.tf + " min"}…`);
      sp.passo("est", "fazendo");
      let ok = true;
      try { await carregarVivo(); } catch (e) { ok = false; }
      sp.passo("dados", ok ? "feito" : "falhou", ok ? "dados carregados" : "não consegui carregar os dados (veja o aviso)");
      await espera(150);
      sp.passo("est", ok ? "feito" : "falhou", `${RK.cfg.estrategias.length} estratégias prontas`);
      sp.passo("resumo", "fazendo", "calculando o resumo do período…");
      await espera(150);
      sp.passo("resumo", ok ? "feito" : "falhou", ok && V.D ? `${V.D.stats.n} operações no período` : "");
      sp.passo("news", "fazendo", "buscando notícias do mercado…");
      const n = await Promise.race([RK.noticiasPrimeira ? RK.noticiasPrimeira() : Promise.resolve(null), espera(9000).then(() => null)]);
      sp.passo("news", n ? "feito" : "falhou", n ? `${n} notícias das últimas horas` : "notícias demorando — continuam carregando");
      if (u.has("ind") && RK.ind) RK.ind.ligar(u.get("ind").split(","));
      if (u.has("op") && RK.ops) RK.ops.abrir(+u.get("op") || 1);
      if (u.get("pop") === "ind") $("btInd").click();
      const aba = u.get("aba");
      if (["sim", "cmp", "cal", "news", "plano", "cripto"].includes(aba)) trocarAba(aba);
      if (aba === "sim" && u.get("acao") && RK.simDemo) await RK.simDemo({ acao: u.get("acao"), passos: +u.get("passos") || 0 });
      if (aba === "cmp" && u.get("acao") === "comparar") $("btComparar").click();
      if (u.get("acao") === "robo") RK.emit("rodarRobo");
    } catch (e) {
      $("splashTxt").textContent = "Não consegui iniciar: " + e.message;
      await espera(2500);
    }
    await espera(Math.max(0, 1300 - (performance.now() - t0)));
    sp.fechar();
  })();
})();
