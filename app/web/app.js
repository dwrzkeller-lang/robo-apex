/* ROBÔ APEX — núcleo da tela: topo (ativo, tempo, estratégia, período, contratos, ajustes), tela de abertura,
   gráfico e a aba AO VIVO. Toda conta de estratégia e de resultado é feita no servidor (Python); a tela só mostra.
   Ao vivo a tela pede ao servidor só o que mudou (o trecho novo dos candles) e atualiza o gráfico no lugar. */
(() => {
  "use strict";
  const AX = (window.AX = {});
  const $ = (id) => document.getElementById(id);
  AX.$ = $;

  // ---------------------------------------------------------------- eventos
  const ouvintes = {};
  AX.on = (ev, fn) => (ouvintes[ev] = ouvintes[ev] || []).push(fn);
  AX.emit = (ev, ...a) => (ouvintes[ev] || []).forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } });

  // ---------------------------------------------------------------- preferências (neste navegador, uma por usuário)
  const PADRAO = { ativo: "WIN", tf: 5, est: "TODAS", ultEst: "E1", gestao: "padrao", contratos: 1, capital: 10000, maxstops: 2,
    som: true, auto: true, per: "1m", de: "", ate: "", larg: {}, ind: null, opsVista: "per",
    tam: "fixo", risco: 1, lossDia: 0, metaDia: 0, seletivo: false, metaMes: 0, quedaMax: 0,     // aba Plano
    criptos: [], prot: [],
    candles: { alta: "#26a69a", baixa: "#ef5350", tipo: "cheio", tendencia: false }, notificar: false };
  const lerLS = (k) => { try { return JSON.parse(localStorage.getItem(k) || "null"); } catch (e) { return null; } };
  // A tela só sabe quem entrou depois da primeira resposta do servidor; por isso guarda o último usuário deste navegador.
  // Se quem entrou for outro, as preferências dele são carregadas e a página recomeça (ver `identificar`).
  let uidPref = "";
  try { uidPref = localStorage.getItem("apex_usuario") || ""; } catch (e) { /* sem armazenamento */ }
  const chavePref = () => "apex_pref:" + uidPref;
  AX.pref = Object.assign({}, PADRAO, (uidPref && lerLS(chavePref())) || lerLS("rk_pref") || {});
  AX.salvarPref = () => { if (!uidPref) return; try { localStorage.setItem(chavePref(), JSON.stringify(AX.pref)); } catch (e) { /* ok */ } };
  function identificar(u) {
    if (!u || u.id === uidPref) return false;
    uidPref = u.id;
    try { localStorage.setItem("apex_usuario", u.id); } catch (e) { return false; }
    if (lerLS(chavePref()) != null) { location.reload(); return true; }       // este usuário já tem as preferências dele
    AX.salvarPref();                                                           // 1ª vez: fica com o que já estava na tela
    try { localStorage.removeItem("rk_pref"); } catch (e) { /* ok */ }
    return false;
  }
  const PERIODOS = { hoje: "hoje", "5d": "5 dias", "1m": "1 mês", "3m": "3 meses", tudo: "tudo", custom: "datas" };
  if (!(AX.pref.per in PERIODOS)) AX.pref.per = "1m";
  if (!Array.isArray(AX.pref.criptos)) AX.pref.criptos = [];
  if (AX.pref.tam !== "risco") AX.pref.tam = "fixo";
  const corOk = (c) => /^#[0-9a-f]{6}$/i.test(c || "");
  const pc = AX.pref.candles || {};
  AX.pref.candles = { alta: corOk(pc.alta) ? pc.alta : PADRAO.candles.alta, baixa: corOk(pc.baixa) ? pc.baixa : PADRAO.candles.baixa,
    tipo: pc.tipo === "vazado" ? "vazado" : "cheio", tendencia: !!pc.tendencia };

  // ---------------------------------------------------------------- servidor
  let saindo = false;
  function irParaLogin() { if (!saindo) { saindo = true; location.replace("/"); } }
  // Todo pedido tem tempo limite: sem isso, um pedido que nunca volta deixava a tela parada esperando para sempre.
  AX.json = async (url, opts = {}) => {
    const ctl = new AbortController();
    const relogio = setTimeout(() => ctl.abort(), opts.tempo || 60000);
    let r;
    try { r = await fetch(url, Object.assign({ signal: ctl.signal, credentials: "same-origin" }, opts)); }
    catch (e) { throw new Error(e.name === "AbortError" ? "O robô demorou demais para responder." : "O robô não respondeu. Ele ainda está aberto? (" + e.message + ")"); }
    finally { clearTimeout(relogio); }
    let j = null;
    try { j = await r.json(); } catch (e) { throw new Error("Resposta inválida do robô (HTTP " + r.status + ")"); }
    if (r.status === 401 || (r.status === 403 && j && j.trocar)) { irParaLogin(); throw new Error((j && j.erro) || "Sessão encerrada."); }
    if (!r.ok || (j && j.erro)) throw new Error((j && j.erro) || "HTTP " + r.status);
    return j;
  };
  AX.post = (url, corpo, opts) => AX.json(url, Object.assign({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo || {}) }, opts));
  AX.api = {   // desenhos e outros estados salvos na pasta de dados do usuário
    async get(nome) { return (await AX.json("/api/estado?nome=" + encodeURIComponent(nome))).valor; },
    async set(nome, valor) { await AX.post("/api/estado?nome=" + encodeURIComponent(nome), valor); },
  };

  // ---------------------------------------------------------------- formatação
  const nf = (d) => ({ minimumFractionDigits: d, maximumFractionDigits: d });
  AX.dec = () => (AX.D ? AX.D.meta.decimais : 2);
  AX.fmt = (v, d) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("pt-BR", nf(d ?? AX.dec())));
  AX.num = (v, d = 1) => (v == null || isNaN(v) ? "—" : Number(v).toLocaleString("pt-BR", nf(d)));
  AX.pct = (v, d = 1) => (v == null || isNaN(v) ? "—" : AX.num(v, d) + "%");
  AX.R = (v, d = 2) => {                     // o sinal vem do valor já arredondado: nada de "−0,00R"
    if (v == null || isNaN(v)) return "—";
    const p = Math.pow(10, d), r = Math.round(v * p) / p;
    return (r > 0 ? "+" : r < 0 ? "−" : "") + AX.num(Math.abs(r), d) + "R";
  };
  AX.moeda = (D) => ((D || AX.D) ? (D || AX.D).meta.moeda : "R$");
  AX.dinheiro = (v, D, sinal = false) => {
    if (v == null || isNaN(v)) return "—";
    const s = v < 0 ? "−" : sinal && v > 0 ? "+" : "";
    return s + AX.moeda(D) + " " + Math.abs(v).toLocaleString("pt-BR", nf(2));
  };
  AX.reais = (v) => AX.dinheiro(v);                    // usado pela régua de desenho
  AX.valorPontoR = () => (AX.D ? AX.D.meta.valorPonto : 1);
  AX.cls = (v) => (v > 0 ? "bom" : v < 0 ? "ruim" : "neutro");
  const p2 = (n) => String(n).padStart(2, "0");
  AX.quando = (D, k, ano = false) => {
    const dt = new Date(D.t[k] * 1000);
    const dia = `${p2(dt.getUTCDate())}/${p2(dt.getUTCMonth() + 1)}${ano || !D.meta.intraday ? "/" + dt.getUTCFullYear() : ""}`;
    return D.meta.intraday ? `${dia} ${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}` : dia;
  };
  AX.quandoT = (t, intraday = true, ano = false) => {
    const dt = new Date(t * 1000);
    const dia = `${p2(dt.getUTCDate())}/${p2(dt.getUTCMonth() + 1)}${ano || !intraday ? "/" + dt.getUTCFullYear() : ""}`;
    return intraday ? `${dia} ${p2(dt.getUTCHours())}:${p2(dt.getUTCMinutes())}` : dia;
  };
  AX.idxT = (D, t) => {                      // índice do candle com o horário t (−1 se não existir)
    const T = D.t; let lo = 0, hi = T.length - 1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (T[m] === t) return m; if (T[m] < t) lo = m + 1; else hi = m - 1; }
    return -1;
  };
  // relógio: tudo no robô é em horário de Brasília (o do gráfico e da B3), mesmo que o computador esteja em outro fuso
  const FUSO_BR = "America/Sao_Paulo";
  AX.horaBR = (t, seg = false) => new Date(t * 1000).toLocaleTimeString("pt-BR", Object.assign({ timeZone: FUSO_BR, hour: "2-digit", minute: "2-digit" }, seg ? { second: "2-digit" } : {}));
  AX.diaBR = (t) => new Date(t * 1000).toLocaleDateString("pt-BR", { timeZone: FUSO_BR, day: "2-digit", month: "2-digit" });
  AX.dataTxt = (d) => { const s = String(d); return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`; };
  AX.dataCurta = (d) => { const s = String(d); return `${s.slice(6, 8)}/${s.slice(4, 6)}`; };
  AX.dataISO = (d) => { const s = String(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
  AX.isoInt = (iso) => (iso ? parseInt(String(iso).replace(/-/g, ""), 10) || 0 : 0);
  AX.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  AX.nomeEst = (cod) => (cod === "TODAS" ? "TODAS juntas" : ((AX.cfg && AX.cfg.estMap[cod]) || {}).nome || cod);
  AX.dirTxt = (d) => (d > 0 ? "COMPRA" : "VENDA");
  // pontinho de interrogação com a explicação ao passar o mouse (dicas.js)
  AX.q = (txt) => `<i class="q" data-dica="${AX.esc(txt)}"></i>`;

  let toastT = null;
  AX.toast = (msg, tipo = "") => {
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
  AX.sons = {};                               // sons próprios: dados/sons/entrada.wav etc.
  AX.som = (nome, forcar = false) => {
    if (!AX.pref.som && !forcar) return;
    const url = AX.sons[nome];
    if (url) { try { const a = new Audio(url); a.volume = 0.8; a.play().catch(() => SINT[nome] && SINT[nome]()); return; } catch (e) { /* cai no sintetizado */ } }
    if (SINT[nome]) SINT[nome]();
  };
  AX.bip = (freq = 880) => tom(freq, 0, 0.2, 0.1);
  AX.erro = (id, e) => {
    const el = $(id);
    if (!e) { el.classList.add("oculto"); el.textContent = ""; return; }
    el.textContent = "⚠ " + (e.message || e); el.classList.remove("oculto");
  };
  AX.fecharPopovers = () => document.querySelectorAll(".popover").forEach((p) => p.classList.add("oculto"));
  // aviso do Windows (quando a janela não está na frente e o usuário ligou em Conta › Avisos)
  AX.notificar = (titulo, corpo) => {
    try {
      if (AX.pref.notificar && document.hidden && window.Notification && Notification.permission === "granted")
        new Notification(titulo, { body: corpo, icon: "icone.png", silent: true });
    } catch (e) { /* o navegador não deixou */ }
  };

  // ---------------------------------------------------------------- tela de abertura
  const ORDEM_SPLASH = ["dados", "est", "resumo", "news"];
  AX.splash = {
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
  const COR = { mm9: "#ee5a67", mm20: "#4795f1", mm200: "#8448d2", vw: "#b48c14", compra: "#22d3ee", venda: "#e056fd", ganho: "#22e39a", perda: "#ff5c6e" };
  const chart = LightweightCharts.createChart($("chart"), {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0b0e14" }, textColor: "#8491a5", fontFamily: "Segoe UI, system-ui" },
    grid: { vertLines: { color: "#141a24" }, horzLines: { color: "#141a24" } },
    rightPriceScale: { borderColor: "#232c3b" },
    timeScale: { borderColor: "#232c3b", timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: 0 },
    localization: { locale: "pt-BR", priceFormatter: (p) => AX.fmt(p) },
  });
  // aparência dos candles (botão "Candles"): cores de alta/baixa, cheio ou vazado
  const NEUTRO = "#7b8799";
  function opcoesCandle() {
    const c = AX.pref.candles, vaz = c.tipo === "vazado";
    return { upColor: vaz ? "rgba(0,0,0,0)" : c.alta, downColor: c.baixa, borderVisible: vaz, borderUpColor: c.alta, borderDownColor: c.baixa,
      wickUpColor: c.alta, wickDownColor: c.baixa };
  }
  const S = { candle: chart.addCandlestickSeries(opcoesCandle()) };
  // Série "âncora": invisível, sempre com as mesmas datas dos candles. Com os candles SOZINHOS no gráfico, a biblioteca
  // usa um atalho ao trocar os dados que deixa a escala de tempo apontando para objetos velhos quando as datas não mudam
  // (por exemplo, ao trocar só de estratégia). Na troca de ativo seguinte ela apagava parte dos candles e o gráfico
  // quebrava ("Value is null"). Com a âncora os candles nunca ficam sozinhos e o atalho nunca é usado.
  S.ancora = chart.addLineSeries({ visible: false, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
    autoscaleInfoProvider: () => null });
  AX.chart = chart; AX.S = S; AX.COR = COR;
  AX.camadas = [];                            // funções que desenham por cima do gráfico (operações, painéis): ver desenho.js
  AX.redesenhar = () => {};

  const G = { D: null, k: -1, linhasPreco: [], sigLinhas: "", viva: null, arrastando: false };
  AX.i = 0;
  // candle i do conjunto D; com "colorir pela tendência", a cor vem das médias: MM9 acima da MM20 e preço acima dela = alta
  function vela(D, i) {
    const v = { time: D.t[i], open: D.o[i], high: D.h[i], low: D.l[i], close: D.c[i] };
    const c = AX.pref.candles;
    if (c.tendencia && D.mm9 && D.mm20) {
      const a = D.mm9[i], b = D.mm20[i];
      const cor = a == null || b == null ? NEUTRO : (a > b && D.c[i] > b ? c.alta : a < b && D.c[i] < b ? c.baixa : NEUTRO);
      v.color = c.tipo === "vazado" && D.c[i] >= D.o[i] ? "rgba(0,0,0,0)" : cor; v.borderColor = cor; v.wickColor = cor;
    }
    return v;
  }

  // De onde vêm as operações desenhadas no gráfico. Com um TESTE AO VIVO ligado nesta mesma tela (ativo, tempo e
  // estratégia), do momento em que ele foi ligado em diante valem as operações DELE (com os ajustes feitos na mão);
  // antes disso, e sem teste, as da estratégia no período. Ver ops.js.
  AX.fonteOps = (D) => { const v = AX.testes ? AX.testes.vivo(D) : null; return v ? v.ops : D; };
  function marcadores(D, k) {
    const m = [], F = AX.fonteOps(D);      // seta = entrada (azul compra, rosa venda); quadrado = saída (verde ganho, vermelho perda)
    // As últimas operações levam o texto na própria marca: "COMPRA 128.450" na entrada e "SAÍDA 128.900 +2,0R" na saída.
    // As mais antigas ficam só com a marca, para o gráfico não virar um mar de letras.
    // As setas e os quadrados só marcam o candle; quem escreve o preço, o horário e o resultado são as placas (ops.js).
    for (const t of F.trades) {
      if (t.i_ent > k) continue;
      m.push({ time: D.t[t.i_ent], position: t.dir > 0 ? "belowBar" : "aboveBar", color: t.dir > 0 ? COR.compra : COR.venda,
        shape: t.dir > 0 ? "arrowUp" : "arrowDown", size: 1.2 });
      if (t.i_sai <= k) m.push({ time: D.t[t.i_sai], position: t.dir > 0 ? "aboveBar" : "belowBar", color: t.R > 0 ? COR.ganho : COR.perda,
        shape: "square", size: 0.8 });
    }
    for (const a2 of F.abertas) if (a2.i_ent <= k && k === D.meta.iFim)
      m.push({ time: D.t[a2.i_ent], position: a2.dir > 0 ? "belowBar" : "aboveBar", color: a2.dir > 0 ? COR.compra : COR.venda,
        shape: a2.dir > 0 ? "arrowUp" : "arrowDown", size: 1.6 });
    m.sort((a, b) => a.time - b.time);
    return m;
  }

  // alvos que ainda valem numa operação/ordem de 2 ou 3 alvos: [[preço, "ALVO 1"], …]; alvo único: [[preço, "ALVO"]]
  AX.alvosDe = (o) => {
    const l = [];
    if (o.alvo1 != null && !o.parcial) l.push(o.alvo1);
    if (o.alvo2 != null && !o.parcial2) l.push(o.alvo2);
    if (o.alvo != null) l.push(o.alvo);
    const varios = o.alvo1 != null || o.alvo2 != null, n = (o.alvo1 != null ? 1 : 0) + (o.alvo2 != null ? 1 : 0) + 1;
    return l.map((p, j) => [p, varios ? "ALVO " + (n - l.length + j + 1) : "ALVO"]);
  };
  // Linhas de preço do "agora": entrada, stop e alvos da operação aberta e das ordens armadas. Quando elas são de um
  // teste ao vivo, o stop e o alvo final levam "⇕" e podem ser arrastados (ops.js cuida do arrasto e manda ao servidor).
  // Um stop/alvo movido com o candle ainda aberto só vale no candle seguinte: até lá aparece como linha pontilhada "NOVO".
  function linhasDoEstado(D, k) {
    if (G.arrastando) return;                              // uma linha está sendo arrastada: não refaz por baixo do mouse
    const e = AX.estadoEm(D, k), lista = [], mov = !!e.teste;
    const add = (price, color, title, style = 2, w = 1, arr = null) => { if (price != null) lista.push({ o: { price, color, lineWidth: w, lineStyle: style, axisLabelVisible: true, title }, arr }); };
    const novo = (ch, tipo) => (mov ? (e.ajPend || []).filter((a) => a.chave === ch && a.tipo === tipo).pop() : null);
    const stopEAlvos = (o, stop, suf, ref, pos) => {
      const ch = o.est + "|" + o.t_sinal + "|" + o.dir, ns = novo(ch, "stop"), na = novo(ch, "alvo");
      const arr = (tipo) => ({ tipo, chave: ch, dir: o.dir, pos, ent: pos ? o.ent : ref, risco: pos ? o.risco : Math.abs(ref - o.stop), gatilho: pos ? null : o.gatilho });
      add(stop, COR.perda, (mov && !ns ? "⇕ " : "") + "STOP" + suf, 2, 1, mov && !ns ? arr("stop") : null);
      if (ns) add(ns.valor, COR.perda, "⇕ STOP NOVO" + suf, 1, 1, arr("stop"));
      const alvos = AX.alvosDe(o);
      alvos.forEach(([pr, nome], j) => {
        const fim = mov && !na && o.alvo != null && j === alvos.length - 1;
        add(pr, COR.ganho, (fim ? "⇕ " : "") + nome + suf, 2, 1, fim ? arr("alvo") : null);
      });
      if (na) add(na.valor, COR.ganho, "⇕ ALVO NOVO" + suf, 1, 1, arr("alvo"));
    };
    if (e.pos) {
      const p = e.pos;
      add(p.ent, "#ffffff", (p.dir > 0 ? "COMPRADO " : "VENDIDO ") + p.est, 0, 2);
      stopEAlvos(p, p.stopAgora ?? p.stop, "", D.c[k], true);
    }
    for (const o of e.pend) {
      const ref = o.gatilho ?? D.c[k];
      const como = o.gatilho == null ? "A MERCADO " : o.tipo === "limite" ? (o.dir > 0 ? "COMPRA LIMITE " : "VENDA LIMITE ") : o.dir > 0 ? "COMPRA ACIMA " : "VENDA ABAIXO ";
      add(ref, o.dir > 0 ? COR.compra : COR.venda, como + o.est, 2, 2);
      stopEAlvos(o, o.stop, " " + o.est, ref, false);
    }
    const sig = JSON.stringify(lista);
    if (sig === G.sigLinhas) return;                       // nada mudou: não pisca as linhas
    G.sigLinhas = sig;
    G.linhasPreco.forEach((l) => S.candle.removePriceLine(l.linha));
    G.linhasPreco = lista.map((l) => ({ linha: S.candle.createPriceLine(l.o), arr: l.arr, preco: l.o.price, titulo: l.o.title }));
  }
  AX.linhasVivas = () => G.linhasPreco.filter((l) => l.arr);
  AX.travarLinhas = (sim) => { G.arrastando = !!sim; if (!sim && G.D) { G.sigLinhas = ""; linhasDoEstado(G.D, G.k); } };
  // o teste ao vivo desta tela mudou (ordem, entrada, saída, ajuste): refaz o cartão do momento, as setas e as linhas
  AX.refazerVivo = () => {
    const D = G.D;
    if (!D || D !== AX.vivo.D || G.k !== D.meta.iFim) return;
    S.candle.setMarkers(marcadores(D, G.k)); linhasDoEstado(D, G.k);
    AX.cartaoMomento($("cardVivo"), D, G.k);
    AX.redesenhar();
  };

  function legenda(D, k) {
    $("legenda").innerHTML = `<span><b>${AX.esc(AX.rotAtivo(D.meta.ativo))}</b> · ${D.meta.nomeTf} · ${AX.quando(D, k, true)}</span>` +
      `<span>A ${AX.fmt(D.o[k])} · M ${AX.fmt(D.h[k])} · m ${AX.fmt(D.l[k])} · F ${AX.fmt(D.c[k])}</span>` + (AX.ind ? AX.ind.legenda(D, k) : "");
  }

  // A escala de preço volta SEMPRE para o automático quando o gráfico é reposicionado: se o usuário arrastou o eixo de
  // preço (isso desliga o automático) e depois trocou de ativo/tempo/estratégia, os candles ficavam fora da tela.
  const JANELA = 220;                         // candles visíveis ao abrir (legível); o resto do período está à esquerda
  AX.autoPreco = () => chart.priceScale("right").applyOptions({ autoScale: true });
  AX.mostrarPeriodo = (D, tudo = false) => {
    const m = D.meta, ini = tudo ? m.iIni : Math.max(m.iIni, m.iFim - JANELA);
    AX.autoPreco();
    chart.timeScale().setVisibleLogicalRange({ from: ini - 2, to: m.iFim + 6 });
  };
  // botão "centralizar": volta para o último candle com a escala de preço automática
  AX.centralizar = (tudo = false) => {
    const D = G.D; if (!D) return;
    AX.autoPreco();
    if (G.k === D.meta.iFim) AX.mostrarPeriodo(D, tudo);
    else chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, G.k - 140), to: G.k + 8 });
  };
  // mostra o conjunto D no gráfico até o candle k (inclusive)
  AX.mostrar = (D, k, { manterZoom = false, foco = null } = {}) => {
    const trocouAtivo = !G.D || G.D.meta.ativo !== D.meta.ativo || G.D.meta.tf !== D.meta.tf;
    G.D = D; G.k = k; G.viva = null; AX.D = D; AX.i = k; AX.ativo = D.meta.ativo;
    const dec = D.meta.decimais;
    S.candle.applyOptions({ priceFormat: { type: "price", precision: dec, minMove: Math.pow(10, -dec) } });
    chart.applyOptions({ timeScale: { timeVisible: D.meta.intraday } });
    const velas = new Array(k + 1), datas = new Array(k + 1);
    for (let i = 0; i <= k; i++) { velas[i] = vela(D, i); datas[i] = { time: D.t[i] }; }
    S.candle.setData(velas);
    S.ancora.setData(datas);
    if (AX.ind) AX.ind.pintar(D, k);
    S.candle.setMarkers(marcadores(D, k));
    G.sigLinhas = ""; linhasDoEstado(D, k); legenda(D, k);
    if (foco != null) AX.focar(foco);
    else if (!manterZoom || trocouAtivo) AX.centralizar();
    if (trocouAtivo) AX.emit("carregado");
    AX.redesenhar();
  };
  // avança o gráfico já mostrado até o candle k (replay)
  AX.avancar = (k) => {
    const D = G.D; if (!D || k <= G.k) return;
    for (let i = G.k + 1; i <= k; i++) {
      S.candle.update(vela(D, i));
      S.ancora.update({ time: D.t[i] });
      if (AX.ind) AX.ind.avancar(D, i);
    }
    G.k = k; AX.i = k;
    S.candle.setMarkers(marcadores(D, k)); linhasDoEstado(D, k); legenda(D, k);
  };
  // Ao vivo: D é o conjunto novo (mesmos candles do que está no gráfico até `i0 − 1`). Atualiza só do candle i0 em diante,
  // sem refazer o gráfico inteiro; se algo não bate (candle antigo corrigido, outro conjunto na tela), refaz tudo.
  AX.atualizar = (D, antigo, i0) => {
    const k = D.meta.iFim;
    if (G.D !== antigo || G.k !== i0 || k < i0 || D._revisado) return AX.mostrar(D, k, { manterZoom: true });
    G.D = D; AX.D = D; G.viva = null;
    try {
      for (let i = i0; i <= k; i++) { S.candle.update(vela(D, i)); S.ancora.update({ time: D.t[i] }); }
      if (AX.ind) AX.ind.atualizar(D, i0, k);
    } catch (e) { console.error(e); return AX.mostrar(D, k, { manterZoom: true }); }
    G.k = k; AX.i = k;
    S.candle.setMarkers(marcadores(D, k)); linhasDoEstado(D, k); legenda(D, k);
    AX.redesenhar();
  };
  AX.focar = (i, ate = i) => { AX.autoPreco(); chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, i - 70), to: Math.max(i + 40, ate + 25) }); };
  AX.repintar = () => { if (G.D) { if (AX.ind) AX.ind.pintar(G.D, G.k); legenda(G.D, G.k); AX.redesenhar(); } };
  AX.graficoMostra = () => G.D;
  // preço em tempo real (aba Cripto): mexe só no desenho do último candle; os sinais continuam vindo do servidor
  AX.tick = (chave, preco) => {
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

  // ---------------------------------------------------------------- aparência dos candles (botão e duplo clique)
  const PREDEF = [["Verde e vermelho", "#26a69a", "#ef5350"], ["Azul e laranja (daltônico)", "#3b8cff", "#ff9f1a"], ["Branco e cinza", "#e6ebf2", "#5b6578"], ["Verde e vermelho vivos", "#00d49a", "#ff3b4e"]];
  function aplicarCandles(refazer) {
    AX.salvarPref();
    S.candle.applyOptions(opcoesCandle());
    if (G.D && refazer) AX.mostrar(G.D, G.k, { manterZoom: true });
  }
  function janelaCandles() {
    const c = AX.pref.candles, pop = $("popCandles");
    pop.innerHTML = `<div class="rot">APARÊNCIA DOS CANDLES</div>
      <div class="ind-titulo">Cores</div>
      <div class="cd-pre">${PREDEF.map(([nome, a, b], j) => `<button data-j="${j}" class="${c.alta === a && c.baixa === b ? "on" : ""}" data-dica="${AX.esc(nome)}"><i style="background:${a}"></i><i style="background:${b}"></i></button>`).join("")}</div>
      <div class="grade2"><label class="campo"><span>Alta</span><input type="color" id="cdAlta" value="${c.alta}"></label>
        <label class="campo"><span>Baixa</span><input type="color" id="cdBaixa" value="${c.baixa}"></label></div>
      <div class="ind-titulo">Tipo</div>
      <div class="seg" id="cdTipo"><button data-v="cheio" class="${c.tipo === "cheio" ? "on" : ""}">Cheio</button><button data-v="vazado" class="${c.tipo === "vazado" ? "on" : ""}">Vazado (alta sem preenchimento)</button></div>
      <label class="chk" style="margin-top:8px"><input type="checkbox" id="cdTend" ${c.tendencia ? "checked" : ""}> <span><b>Colorir pela tendência</b>: candle na cor de alta quando a MM9 está acima da MM20 e o preço acima dela; na cor de baixa no inverso; cinza quando as médias não confirmam</span></label>
      <div class="nota">É só aparência: as estratégias continuam lendo os mesmos candles.</div>
      <div class="botoes"><button id="cdPadrao">Voltar ao padrão</button><button id="cdFechar" class="primario">Fechar</button></div>`;
    pop.querySelectorAll(".cd-pre button").forEach((b) => (b.onclick = () => { const p = PREDEF[+b.dataset.j]; c.alta = p[1]; c.baixa = p[2]; aplicarCandles(c.tendencia); janelaCandles(); }));
    $("cdAlta").onchange = (e) => { c.alta = e.target.value; aplicarCandles(c.tendencia); janelaCandles(); };
    $("cdBaixa").onchange = (e) => { c.baixa = e.target.value; aplicarCandles(c.tendencia); janelaCandles(); };
    pop.querySelectorAll("#cdTipo button").forEach((b) => (b.onclick = () => { c.tipo = b.dataset.v; aplicarCandles(c.tendencia); janelaCandles(); }));
    $("cdTend").onchange = (e) => { c.tendencia = e.target.checked; aplicarCandles(true); };
    $("cdPadrao").onclick = () => { AX.pref.candles = Object.assign({}, PADRAO.candles); aplicarCandles(true); janelaCandles(); };
    $("cdFechar").onclick = AX.fecharPopovers;
  }
  function abrirCandles() { AX.fecharPopovers(); janelaCandles(); $("popCandles").classList.remove("oculto"); }
  $("btCandles").onclick = () => { const aberto = !$("popCandles").classList.contains("oculto"); AX.fecharPopovers(); if (!aberto) abrirCandles(); };
  $("chart").addEventListener("dblclick", (e) => {
    if (!G.D || (AX.desenho && (AX.desenho.ferramenta() !== "cursor" || AX.desenho.sobreDesenho(e)))) return;
    const r = $("chart").getBoundingClientRect();
    if (e.clientX - r.left > chart.timeScale().width() || e.clientY - r.top > r.height - chart.timeScale().height()) return;   // eixos: não
    abrirCandles();
  });

  // ---------------------------------------------------------------- estado das estratégias no candle k
  AX.estadoEm = (D, k) => {
    // com um teste ao vivo ligado nesta tela, o "agora" é o do teste (é nele que dá para mover stop e alvo, entrar e sair)
    const v = k === D.meta.iFim && AX.testes ? AX.testes.vivo(D) : null;
    if (v) return { pos: v.pos, pend: v.pend, aten: D.atenUlt || [], saidas: v.saidas(k), teste: v, meta: v.meta, ajPend: v.ajPend };
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

  // Régua da operação: stop à esquerda, alvo (ou +3R, se não há alvo fixo) à direita. O trecho do risco fica em vermelho
  // apagado e o do ganho em verde apagado; o preenchimento forte vai da entrada até o preço de agora.
  AX.medidor = (o, preco, dec) => {
    const f = (v) => AX.fmt(v, dec), dir = o.dir;
    const fim = o.alvo != null ? o.alvo : o.ent + dir * 3 * o.risco;
    const total = dir * (fim - o.stop);
    if (!(total > 0)) return "";
    const pos = (v) => Math.max(0, Math.min(100, (100 * dir * (v - o.stop)) / total));
    const pe = pos(o.ent), pp = preco == null ? pe : pos(preco), favor = pp >= pe;
    const marcas = [o.alvo1, o.alvo2].filter((x) => x != null).map((x, j) => `<i class="md-alvo" style="left:${pos(x)}%" data-dica="Alvo ${j + 1}: ${f(x)}"></i>`).join("");
    return `<div class="medidor" role="img" aria-label="Stop ${f(o.stop)}, entrada ${f(o.ent)}${o.alvo != null ? ", alvo " + f(o.alvo) : ""}">
      <div class="md-trilho"><i class="md-risco" style="width:${pe}%"></i><i class="md-ganho" style="left:${pe}%;width:${100 - pe}%"></i>
        <i class="md-cheio ${favor ? "bom" : "ruim"}" style="left:${Math.min(pe, pp)}%;width:${Math.abs(pp - pe)}%"></i>${marcas}
        <i class="md-ent" style="left:${pe}%"></i>${preco == null ? "" : `<i class="md-agora ${favor ? "bom" : "ruim"}" style="left:${pp}%"></i>`}</div>
      <div class="md-rot"><span>STOP ${f(o.stop)}</span>${pe > 30 && pe < 68 ? `<span class="md-meio" style="left:${pe}%">entrada ${f(o.ent)}</span>` : ""}<span>${o.alvo != null ? "ALVO " + f(o.alvo) : "sem alvo fixo · régua até +3R"}</span></div></div>`;
  };
  // linha da IA num sinal: chance estimada, quanto precisa para empatar e o que mais pesou
  AX.iaLinha = (o, meta, quando) => {
    if (!o.ia) return "";
    const ok = meta && meta.ia && meta.ia.comprovada;
    const pq = (o.iaPq || []).map((x) => `<span class="chip ${x.efeito > 0 ? "sobe" : "desce"}">${x.efeito > 0 ? "▲" : "▼"} ${AX.esc(x.rotulo)}</span>`).join("");
    return`<div class="mo-ia"><span class="ia-selo">IA</span><span><b>${AX.num(100 * o.ia[0], 0)}%</b> de chance de ganho${quando || ""} · esperado <b class="${AX.cls(o.ia[1])}">${AX.R(o.ia[1])}</b>
      <em>${ok ? "· aprovada fora da amostra neste ativo" : "· ainda sem comprovação neste ativo"}</em></span>${AX.q("Estimativa de um modelo que aprende com as operações já encerradas deste ativo e tempo gráfico. A nota dele é medida sempre em operações que ele ainda não tinha visto (aba IA). “Sem comprovação” quer dizer que, até aqui, a IA não acertou mais que o acaso: use só como leitura.")}${pq ? `<div class="mo-pq">${pq}</div>` : ""}</div>`;
  };

  // cartão "o que fazer agora" (ao vivo, fim do período e replay)
  AX.cartaoMomento = (el, D, k) => {
    const e = AX.estadoEm(D, k), m = e.meta || D.meta;      // e.meta = regras do teste ao vivo, quando o "agora" é o dele
    const hist = k === m.iFim && !m.aoVivo, agora = k === m.iFim && m.aoVivo;
    const selo = e.teste ? `<span class="tag-teste" data-dica="Este cartão está mostrando o TESTE AO VIVO ligado nesta tela: ele começou quando você ligou e segue os ajustes que você fizer na mão (mover stop e alvo, entrar, sair). O resumo do período, mais abaixo, continua sendo a estratégia pura.">TESTE AO VIVO</span>` : "";
    const qtd = (x) => (x.q != null ? x.q : m.contratos);
    const perdaNoStop = (pts, q, ref) => (pts * m.valorPonto + 2 * m.custo + 2 * (m.custoPct || 0) * Math.abs(ref) * m.valorPonto) * q;
    // quanto do capital a operação perde se for stopada: sempre à vista (laranja acima de 2%, vermelho acima de 5%)
    const capAgora = (m.dia && m.dia.capital) || m.capital;
    const pctCap = (pts, q, ref) => {
      if (!(capAgora > 0)) return "";
      const p = (100 * perdaNoStop(pts, q, ref)) / capAgora;
      return `<span class="${p > 5 ? "ruim" : p > 2 ? "alerta" : ""}">${AX.pct(p, 1)} do capital</span>`;
    };
    const bloco = (rot, valor, sub = "", dica = "") => `<div><small>${rot}${dica ? AX.q(dica) : ""}</small><b>${valor}</b>${sub ? `<em>${sub}</em>` : ""}</div>`;
    const aviso = agora && AX.agendaAviso ? AX.agendaAviso(m.ativo) : "";
    let cls = "", html = "";
    const quem = (cod, extra = "") => `<div class="quem"><b>${AX.esc(cod)}</b> · ${AX.esc(AX.nomeEst(cod))}${extra}${hist ? `<span class="tag-hist">FIM DO PERÍODO · ${AX.quando(D, k, true)}</span>` : ""}${selo}</div>`;
    const saiu = e.saidas.length ? `<div class="detalhe">Neste candle saiu: ${e.saidas.map((t) => `${t.est} ${AX.dirTxt(t.dir).toLowerCase()} <b class="${AX.cls(t.R)}">${AX.R(t.R)}</b> (${AX.esc(t.motivo)})`).join(" · ")}</div>` : "";
    if (e.pos) {
      const p = e.pos, R = p.Ragora, q = qtd(p);
      const movido = p.stopAgora != null && p.stopAgora !== p.stop;      // stop já andou: o risco inicial não vale mais
      cls = "pos";
      html = `<div class="estado">${p.dir > 0 ? "COMPRADO" : "VENDIDO"} <span class="${AX.cls(R)}">${AX.R(R)}</span></div>${quem(p.est, " · entrou em " + (p.t_ent != null ? AX.quandoT(p.t_ent, m.intraday) : AX.quando(D, p.i_ent)))}
        ${AX.medidor({ dir: p.dir, ent: p.ent, stop: p.stopAgora ?? p.stop, alvo: p.alvo, risco: p.risco, alvo1: p.parcial ? null : p.alvo1, alvo2: p.parcial2 ? null : p.alvo2 }, D.c[k], m.decimais)}
        <div class="mo-grade">${bloco("Entrada", AX.fmt(p.ent))}
          ${bloco(movido ? "Stop (movido)" : "Stop", AX.fmt(p.stopAgora ?? p.stop), movido ? "o inicial era " + AX.fmt(p.stop) : `${AX.fmt(p.risco)} pts = ${AX.dinheiro(perdaNoStop(p.risco, q, p.ent), D)}`)}
          ${bloco("Tamanho", AX.unidade(m, q), movido ? "" : pctCap(p.risco, q, p.ent), "Quantidade da operação e quanto do capital ela perde se for stopada, já com os custos. Fica laranja acima de 2% e vermelho acima de 5%.")}</div>
        ${p.parcial || p.sair || p.manual ? `<div class="detalhe">${[p.parcial ? "<b>Parcial feita, stop no 0x0</b>" : "", p.parcial2 ? "<b>alvo 2 batido, stop no alvo 1</b>" : "",
          p.sair ? "<b>sai na abertura do próximo candle</b> (" + AX.esc(p.sair) + ")" : "", p.manual ? "✋ com ajuste feito na mão" : ""].filter(Boolean).join(" · ")}</div>` : ""}
        ${AX.iaLinha(p, m, " na entrada")}${saiu}${aviso}`;
    } else if (e.pend.length) {
      const o = e.pend[e.pend.length - 1];
      const ref = o.gatilho ?? D.c[k], risco = Math.abs(ref - o.stop);
      cls = o.dir > 0 ? "compra" : "venda";
      const quando = o.gatilho == null ? "a mercado na abertura do próximo candle" : o.tipo === "limite" ? `limitada em ${AX.fmt(o.gatilho)} (executa se o preço ${o.dir > 0 ? "recuar" : "subir"} até lá)` : `${o.dir > 0 ? "acima de" : "abaixo de"} ${AX.fmt(o.gatilho)}`;
      const razao = o.alvo != null && risco ? Math.abs(o.alvo - ref) / risco : null;
      const q = qtd(o), qv = q > 0 ? q : m.contratos;
      const alvos = AX.alvosDe(o);
      html = `<div class="estado">${o.dir > 0 ? "COMPRA ARMADA" : "VENDA ARMADA"}</div>${quem(o.est)}
        <div class="detalhe">${AX.dirTxt(o.dir)} ${quando} · vale ${o.validade} candle(s)${o.info ? " · " + AX.esc(o.info) : ""}</div>
        ${AX.medidor({ dir: o.dir, ent: ref, stop: o.stop, alvo: o.alvo, risco, alvo1: o.alvo1, alvo2: o.alvo2 }, D.c[k], m.decimais)}
        <div class="mo-grade">${bloco("Entrada", AX.fmt(ref))}
          ${bloco("Risco no stop", AX.dinheiro(perdaNoStop(risco, qv, ref), D), AX.fmt(risco) + " pts")}
          ${o.alvo != null ? bloco(alvos.length > 1 ? "Alvo final" : "Alvo", razao ? AX.num(razao, 1) + " : 1" : AX.fmt(o.alvo), "+" + AX.dinheiro(Math.abs(o.alvo - ref) * m.valorPonto * qv, D), alvos.length > 1 ? "Esta estratégia tem " + alvos.length + " alvos: " + alvos.map(([pr, nm]) => nm.toLowerCase() + " em " + AX.fmt(pr)).join(", ") + ". A cada alvo batido o stop sobe." : "Quantas vezes o risco a operação busca ganhar.") : bloco("Saída", "sem alvo", AX.esc(AX.gestaoTxt(o.gestao)))}
          ${q > 0 ? bloco("Tamanho", AX.unidade(m, q), pctCap(risco, q, ref)) : ""}</div>
        ${q > 0 ? "" : `<div class="detalhe ruim"><b>Fora do plano:</b> o lote mínimo arrisca mais que ${AX.num(m.riscoPct, 1)}% do capital. Pelo plano, não entra.</div>`}
        ${o.ctx != null ? `<div class="detalhe">Contexto: ${AX.ctxTxt(o.ctx, o.er)}</div>` : ""}
        ${AX.iaLinha(o, m)}
        ${e.pend.length > 1 ? `<div class="detalhe">+${e.pend.length - 1} outra(s) ordem(ns): ${e.pend.slice(0, -1).map((x) => x.est + " " + AX.dirTxt(x.dir).toLowerCase()).join(", ")} — a primeira que executar vale.</div>` : ""}${saiu}${aviso}`;
    } else if (agora && m.intraday && m.dia && m.dia.trava && m.dia.data === D.d[k]) {
      cls = "trava";                                       // regra do plano: o dia acabou para esta estratégia
      html = `<div class="estado">PARE POR HOJE</div><div class="detalhe"><b>${AX.esc(m.dia.trava)}</b> · resultado do dia: <b class="${AX.cls(m.dia.resultado)}">${AX.dinheiro(m.dia.resultado, D, true)}</b>.
        O robô não arma mais entradas hoje${m.est === "TODAS" ? "" : " nesta estratégia"}.</div>${saiu}`;
    } else if (e.aten.length) {
      const [cod, dir] = e.aten[0];
      cls = "aten";
      html = `<div class="estado">ATENÇÃO: ${dir > 0 ? "COMPRA" : "VENDA"} SE FORMANDO</div>${quem(cod)}
        <div class="detalhe">Aguardando: ${AX.esc((AX.cfg.estMap[cod] || {}).aguardando || "")}. Ainda <b>não</b> é sinal.</div>${saiu}${aviso}`;
    } else {
      const leitura = k === m.iFim && m.ctx ? `<div class="mo-chips"><span class="chip ${m.ctx.diario > 0 ? "sobe" : m.ctx.diario < 0 ? "desce" : ""}">${m.ctx.diario > 0 ? "▲ diário em alta" : m.ctx.diario < 0 ? "▼ diário em baixa" : "■ diário sem tendência"}</span><span class="chip">${m.ctx.er >= 0.35 ? "movimento limpo" : "movimento em serrote"}</span>${m.seletivo ? '<span class="chip">modo seletivo</span>' : ""}</div>` : "";
      const antiga = e.teste && D.abertas.some((a) => a.t_ent <= e.teste.r.meta.desde);
      html = `<div class="estado">AGUARDANDO SETUP</div><div class="detalhe">${m.est === "TODAS" ? "Nenhuma estratégia" : AX.esc(AX.nomeEst(m.est)) + " não"} tem setup ${hist ? "no fim do período (" + AX.quando(D, k, true) + ")" : "agora"}.${selo}</div>
        ${antiga ? '<div class="detalhe">A operação aberta no gráfico começou antes de o teste ser ligado: ela não conta no teste.</div>' : ""}${leitura}${saiu}${aviso}`;
    }
    el.className = "card momento " + cls + (hist ? " hist" : "");
    el.innerHTML = html;
    return e;
  };

  const CURTO = { "VANTAGEM ESTATÍSTICA": "VANTAGEM", "PROMISSORA, NÃO COMPROVADA": "NÃO COMPROVADA" };
  AX.seloCurto = (st) => `<span class="selo ${st.cor || "neutro"}" data-dica="${AX.esc((st.veredito || "") + ": " + (st.explica || ""))}">${AX.esc(CURTO[st.veredito] || st.veredito || "—")}</span>`;

  // curva do capital pequena (uma marca por operação); ao passar o mouse mostra a operação e o acumulado
  AX.sparkline = (cv, valores, rotular) => {
    if (!cv) return;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const pts = [0]; let s = 0; for (const v of valores) { s += v; pts.push(s); }
    if (pts.length < 2) return;
    const mn = Math.min(...pts), mx = Math.max(...pts), amp = mx - mn || 1;
    const X = (i) => 2 + (i * (w - 4)) / (pts.length - 1), Y = (v) => 4 + ((mx - v) * (h - 8)) / amp;
    c.strokeStyle = "#2a3445"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, Math.round(Y(0)) + 0.5); c.lineTo(w, Math.round(Y(0)) + 0.5); c.stroke();
    const cor = s >= 0 ? "#22e39a" : "#ff5c6e";
    c.beginPath(); pts.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = cor; c.lineWidth = 2; c.stroke();
    c.lineTo(X(pts.length - 1), Y(0)); c.lineTo(X(0), Y(0)); c.closePath();
    c.fillStyle = s >= 0 ? "rgba(34,227,154,.10)" : "rgba(255,92,110,.10)"; c.fill();
    const ult = pts.length - 1;                              // ponto final com anel na cor do fundo
    c.beginPath(); c.arc(X(ult), Y(pts[ult]), 4, 0, 7); c.fillStyle = cor; c.fill(); c.lineWidth = 2; c.strokeStyle = "#171e2a"; c.stroke();
    cv.onmousemove = (e) => {
      const r = cv.getBoundingClientRect(), i = Math.max(1, Math.min(ult, Math.round(((e.clientX - r.left - 2) * ult) / (w - 4))));
      cv.dataset.dica = rotular ? rotular(i, valores[i - 1], pts[i]) : `Operação ${i} de ${ult}`;
    };
  };

  // ---------------------------------------------------------------- parâmetros para o servidor
  AX.cfg = null;
  AX.parametros = (extra = {}) => {
    const p = AX.pref;
    const q = new URLSearchParams({ ativo: p.ativo, tf: p.tf, est: p.est, gestao: p.gestao, contratos: p.contratos,
      capital: p.capital, maxstops: p.maxstops, per: p.per === "custom" ? "tudo" : p.per });
    if (p.per === "custom") { q.set("de", AX.isoInt(p.de)); q.set("ate", AX.isoInt(p.ate)); }
    for (const [k, v] of Object.entries(AX.planoParams())) q.set(k, v);
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return q.toString();
  };
  // regras do plano de trade (aba Plano) que vão em todo pedido ao servidor; só o que não é o padrão
  AX.planoParams = (p = AX.pref) => {
    const o = {};
    if (p.tam === "risco") { o.tam = "risco"; o.risco = p.risco; }
    if (p.lossDia > 0) o.lossDia = p.lossDia;
    if (p.metaDia > 0) o.metaDia = p.metaDia;
    if (p.seletivo) o.seletivo = 1;
    if (Array.isArray(p.prot) && p.prot.length) o.prot = p.prot.join(",");      // proteções do stop (aba Plano)
    return o;
  };
  // nome da gestão de uma operação: as do menu e as internas (saída/alvos da própria estratégia)
  AX.gestaoTxt = (g) => AX.cfg.gestoes[g] || { propria: "regra de saída da própria estratégia", fixo: "alvo da própria estratégia",
    fibo: "dois alvos de Fibonacci da própria estratégia", fibo3: "três alvos de Fibonacci da própria estratégia" }[g] || g || "";
  // ativos: os do robô + as criptomoedas abertas pela aba Cripto ("BN:DOGEUSDT" à vista, "BF:POPCATUSDT" futuro)
  AX.ehCripto = (c) => /^B[NF]:[A-Z0-9]{2,24}$/.test(c || "");
  AX.nomeCripto = (c) => { const s2 = c.slice(3); return (s2.endsWith("USDT") ? s2.slice(0, -4) + "/USDT" : s2) + (c.startsWith("BF:") ? " (futuro)" : ""); };
  AX.infoAtivo = (c) => (AX.cfg && AX.cfg.ativos.find((x) => x.chave === c)) || AX.pref.criptos.find((x) => x.chave === c) ||
    (AX.ehCripto(c) ? { chave: c, nome: AX.nomeCripto(c), fracionado: true, cripto: true } : null);
  AX.ativoValido = (c) => !!AX.infoAtivo(c);
  AX.rotAtivo = (c) => (AX.ehCripto(c) ? AX.nomeCripto(c) : c);
  AX.unidade = (m, q) => `${AX.num(q, m.fracionado ? 2 : 0)} ${m.fracionado ? "lote" : "contrato"}${q === 1 ? "" : "s"}`;
  AX.ctxTxt = (ctx, er) => (ctx > 0 ? '<span class="bom">a favor da tendência do diário</span>' : ctx < 0 ? '<span class="ruim">contra a tendência do diário</span>' : "diário sem tendência")
    + (er == null ? "" : er >= 0.35 ? " · movimento limpo" : " · movimento em serrote");
  AX.periodoTexto = (D) => (D ? `${AX.dataCurta(D.meta.dataIni)} a ${AX.dataCurta(D.meta.dataFim)}` : PERIODOS[AX.pref.per]);

  // ---------------------------------------------------------------- topo
  const nomeCurto = (n) => {                 // "Mini Índice (WIN) - proxy: ..." -> "Mini Índice (WIN)"; nome completo no title
    let c = n.split(" - ")[0].replace(/\s*\(hor.*$/, "").trim();
    if ((c.match(/\(/g) || []).length > (c.match(/\)/g) || []).length) c = c.split("(")[0].trim();
    return c;
  };
  function montarAtivos() {
    const op = (a) => `<option value="${AX.esc(a.chave)}" title="${AX.esc(a.nome)}">${AX.esc(nomeCurto(a.nome))}</option>`;
    const cr = AX.pref.criptos;
    $("ativo").innerHTML = (cr.length ? `<optgroup label="Mercados">` : "") + AX.cfg.ativos.map(op).join("") +
      (cr.length ? `</optgroup><optgroup label="Cripto (Binance, tempo real)">${cr.map(op).join("")}</optgroup>` : "");
    $("ativo").value = AX.pref.ativo;
  }
  // abre uma moeda da Binance no gráfico (vem da aba Cripto): entra na lista de ativos e vira o ativo atual
  AX.abrirCripto = (chave, nome) => {
    if (!AX.ehCripto(chave)) return false;
    AX.pref.criptos = [{ chave, nome: nome || AX.nomeCripto(chave), fracionado: true, cripto: true }]
      .concat(AX.pref.criptos.filter((x) => x.chave !== chave)).slice(0, 12);
    montarAtivos();
    if (AX.pref.ativo !== chave) AX.escolherAtivo(chave); else AX.salvarPref();
    return true;
  };
  function ajustarContratos() {
    const a = AX.infoAtivo(AX.pref.ativo) || {};
    const inp = $("contratos");
    const peloRisco = AX.pref.tam === "risco";
    inp.step = a.fracionado ? "0.01" : "1"; inp.min = a.fracionado ? "0.01" : "1";
    inp.disabled = peloRisco;
    $("rotContratos").textContent = (a.fracionado ? "Lotes" : "Contratos") + (peloRisco ? " · risco" : "");
    if (!a.fracionado) AX.pref.contratos = Math.max(1, Math.round(AX.pref.contratos));
    inp.value = AX.pref.contratos;
  }
  function montarEstrategias() {
    const diario = +AX.pref.tf >= 1440;
    $("est").innerHTML = `<option value="TODAS">▶ TODAS juntas</option>` + AX.cfg.estrategias.map((e) =>
      `<option value="${e.cod}" ${e.intraday && diario ? "disabled" : ""}>${e.cod} · ${AX.esc(e.nome)}${e.intraday && diario ? " (só intraday)" : ""}</option>`).join("");
    $("est").value = AX.pref.est;
    $("btTodas").classList.toggle("on", AX.pref.est === "TODAS");
  }
  function marcarPeriodo() {
    document.querySelectorAll("#periodo button").forEach((b) => b.classList.toggle("on", b.dataset.p === AX.pref.per));
    $("periodoTxt").textContent = V.D ? AX.periodoTexto(V.D) : "";
  }
  AX.escolherEst = (cod) => {
    if (cod === AX.pref.est) return;
    const e = AX.cfg.estMap[cod];
    if (e && e.intraday && +AX.pref.tf >= 1440) { AX.toast(`${e.nome} só funciona em gráfico intraday.`, "aviso"); montarEstrategias(); return; }
    if (cod !== "TODAS") AX.pref.ultEst = cod;
    AX.pref.est = cod; AX.salvarPref(); montarEstrategias();
    AX.emit("mudou", "est");
  };
  AX.escolherTf = (tf) => {
    if (+tf === +AX.pref.tf) return;
    AX.pref.tf = +tf; $("tf").value = tf; corrigirEst(); AX.salvarPref(); AX.emit("mudou", "tf");
  };
  AX.escolherGestao = (g) => {
    if (!(g in AX.cfg.gestoes) || g === AX.pref.gestao) return;
    AX.pref.gestao = g; $("gestao").value = g; AX.salvarPref(); AX.emit("mudou", "gestao");
  };
  function corrigirEst() {
    const e = AX.cfg.estMap[AX.pref.est];
    if (e && e.intraday && +AX.pref.tf >= 1440) { AX.pref.est = "TODAS"; AX.toast(`${e.nome} só funciona em gráfico intraday — mudei para TODAS juntas.`, "aviso"); }
    montarEstrategias();
  }
  AX.atualizarTopo = () => {
    $("ativo").value = AX.pref.ativo; $("tf").value = AX.pref.tf; $("gestao").value = AX.pref.gestao;
    ajustarContratos(); montarEstrategias(); marcarPeriodo();
  };
  AX.escolherAtivo = (a) => {
    AX.pref.ativo = a; $("ativo").value = a; ajustarContratos(); AX.salvarPref(); AX.emit("mudou", "ativo");
  };
  AX.irPara = ({ ativo, tf, est }) => {
    const p = AX.pref;
    if (ativo === p.ativo && +tf === +p.tf && est === p.est) return false;
    p.ativo = ativo; p.tf = +tf; p.est = est; if (est !== "TODAS") p.ultEst = est;
    AX.salvarPref(); AX.atualizarTopo(); AX.emit("mudou", "ativo");
    return true;
  };
  function abrirDatas() {
    AX.fecharPopovers();
    const D = V.D;
    if (D) {
      const min = AX.dataISO(D.meta.dataMin), max = AX.dataISO(D.meta.dataMax);
      $("perDe").min = $("perAte").min = min; $("perDe").max = $("perAte").max = max;
      $("perDe").value = AX.pref.de && AX.pref.de >= min ? AX.pref.de : AX.dataISO(D.meta.dataIni);
      $("perAte").value = AX.pref.ate && AX.pref.ate <= max ? AX.pref.ate : AX.dataISO(D.meta.dataFim);
      $("perDisponivel").textContent = `Dados de ${AX.dataTxt(D.meta.dataMin)} a ${AX.dataTxt(D.meta.dataMax)} neste tempo gráfico.`;
    }
    $("popDatas").classList.remove("oculto");
  }
  function ligarTopo() {
    const sa = $("ativo"), st = $("tf"), sg = $("gestao"), sc = $("contratos");
    AX.pref.criptos = [];                                  // o mercado de cripto saiu do robô na versão 2.1
    if (AX.ehCripto(AX.pref.ativo) || AX.pref.ativo === "BTCUSD") AX.pref.ativo = "WIN";
    if (!Array.isArray(AX.pref.prot)) AX.pref.prot = [];
    if (AX.ehCripto(AX.pref.ativo) && !AX.pref.criptos.some((x) => x.chave === AX.pref.ativo))
      AX.pref.criptos.unshift({ chave: AX.pref.ativo, nome: AX.nomeCripto(AX.pref.ativo), fracionado: true, cripto: true });
    st.innerHTML = AX.cfg.tempos.map((t) => `<option value="${t.tf}">${t.nome}</option>`).join("");
    sg.innerHTML = Object.entries(AX.cfg.gestoes).map(([k, v]) => `<option value="${k}">${AX.esc(v)}</option>`).join("");
    if (!AX.ativoValido(AX.pref.ativo)) AX.pref.ativo = "WIN";
    montarAtivos();
    if (!AX.cfg.tempos.some((t) => +t.tf === +AX.pref.tf)) AX.pref.tf = 5;
    if (!(AX.pref.gestao in AX.cfg.gestoes)) AX.pref.gestao = "padrao";
    if (AX.pref.est !== "TODAS" && !AX.cfg.estMap[AX.pref.est]) AX.pref.est = "TODAS";
    if (!AX.cfg.estMap[AX.pref.ultEst]) AX.pref.ultEst = "E1";
    sa.value = AX.pref.ativo; st.value = AX.pref.tf; sg.value = AX.pref.gestao;
    ajustarContratos(); corrigirEst(); marcarPeriodo();
    sa.onchange = () => AX.escolherAtivo(sa.value);
    st.onchange = () => AX.escolherTf(+st.value);
    $("est").onchange = () => AX.escolherEst($("est").value);
    $("btTodas").onclick = () => AX.escolherEst(AX.pref.est === "TODAS" ? AX.pref.ultEst : "TODAS");
    sc.onchange = () => {
      const a = AX.infoAtivo(AX.pref.ativo) || {};
      let v = parseFloat(String(sc.value).replace(",", "."));
      if (!(v > 0)) v = a.fracionado ? 0.01 : 1;
      AX.pref.contratos = a.fracionado ? Math.max(0.01, Math.round(v * 100) / 100) : Math.max(1, Math.round(v));
      sc.value = AX.pref.contratos; AX.salvarPref(); AX.emit("mudou", "contratos");
    };
    document.querySelectorAll("#periodo button").forEach((b) => (b.onclick = () => {
      if (b.dataset.p === "custom") return abrirDatas();
      AX.fecharPopovers();
      if (AX.pref.per === b.dataset.p) return;
      AX.pref.per = b.dataset.p; AX.salvarPref(); marcarPeriodo(); AX.emit("mudou", "periodo");
    }));
    $("perCancelar").onclick = AX.fecharPopovers;
    $("perAplicar").onclick = () => {
      const de = $("perDe").value, ate = $("perAte").value;
      if (!de || !ate) return AX.toast("Escolha as duas datas.", "aviso");
      if (de > ate) return AX.toast("A data inicial é depois da final.", "aviso");
      AX.pref.per = "custom"; AX.pref.de = de; AX.pref.ate = ate; AX.salvarPref(); AX.fecharPopovers(); marcarPeriodo();
      AX.emit("mudou", "periodo");
    };
    // ajustes
    $("capital").value = AX.pref.capital; $("maxstops").value = AX.pref.maxstops;
    $("autoVivo").checked = AX.pref.auto; $("somVivo").checked = AX.pref.som;
    $("btAjustes").onclick = () => { const p = $("popAjustes"), aberto = !p.classList.contains("oculto"); AX.fecharPopovers(); if (!aberto) p.classList.remove("oculto"); };
    $("ajFechar").onclick = AX.fecharPopovers;
    sg.onchange = () => AX.escolherGestao(sg.value);
    $("capital").onchange = () => {
      const v = parseFloat(String($("capital").value).replace(",", "."));
      AX.pref.capital = v > 0 ? v : 10000; $("capital").value = AX.pref.capital; AX.salvarPref(); AX.emit("mudou", "plano");
    };
    $("maxstops").onchange = () => {
      const v = parseInt($("maxstops").value, 10);
      AX.pref.maxstops = v > 0 ? Math.min(20, v) : 2; $("maxstops").value = AX.pref.maxstops; AX.salvarPref(); AX.emit("mudou", "plano");
    };
    AX.on("mudou", (o) => { if (o === "plano") { $("capital").value = AX.pref.capital; $("maxstops").value = AX.pref.maxstops; ajustarContratos(); } });
    $("autoVivo").onchange = (e) => { AX.pref.auto = e.target.checked; AX.salvarPref(); };
    $("somVivo").onchange = (e) => { AX.pref.som = e.target.checked; AX.salvarPref(); if (e.target.checked) AX.som("entrada"); };
    // aviso do Windows: o navegador só deixa pedir a permissão a partir de um clique do usuário
    const nt = $("notifVivo");
    nt.checked = !!AX.pref.notificar && !!window.Notification && Notification.permission === "granted";
    nt.onchange = async () => {
      if (!nt.checked) { AX.pref.notificar = false; AX.salvarPref(); return; }
      let ok = false;
      try { ok = !!window.Notification && (Notification.permission === "granted" || (await Notification.requestPermission()) === "granted"); } catch (e) { ok = false; }
      AX.pref.notificar = ok; nt.checked = ok; AX.salvarPref();
      if (!ok) return AX.toast("O navegador não deixou mostrar avisos do Windows (permissão negada ou recurso indisponível nesta janela).", "aviso");
      try { new Notification("Robô Apex", { body: "Avisos do Windows ligados: eles aparecem quando esta janela estiver minimizada ou atrás de outra.", icon: "icone.png", silent: true }); } catch (e) { /* ok */ }
    };
    document.querySelectorAll("#ouvirSons button").forEach((b) => (b.onclick = () => AX.som(b.dataset.s, true)));
    $("btAtualizar").onclick = () => { AX.fecharPopovers(); V.velho = true; carregarVivo(); };
    $("btRobo").onclick = () => AX.emit("rodarRobo");
    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".popover") && !e.target.closest("#btAjustes") && !e.target.closest("#periodo") && !e.target.closest("#btInd") && !e.target.closest("#btCandles")) AX.fecharPopovers();
    });
  }

  // ---------------------------------------------------------------- aba AO VIVO
  // V.D = conjunto ao vivo; V.consulta = parâmetros com que ele foi pedido (só dá para pedir "só o que mudou" com os mesmos)
  const V = { D: null, seq: 0, velho: true, pedido: 0, consulta: "", buscando: false, falhas: 0, ok: 0 };
  AX.vivo = V;
  const SERIES = ["t", "d", "hm", "o", "h", "l", "c", "v", "mm9", "mm20", "mm200"];
  // Junta o trecho novo (resposta "delta") com o que a tela já tem. O que terminou antes do candle `de` não muda; dali em
  // diante vale o que veio agora. As listas grandes são continuadas no lugar; o objeto D é novo (para os outros módulos
  // perceberem que os dados mudaram).
  function fundir(base, X) {
    const de = X.delta.de;
    const D = Object.assign({}, base, X);
    for (const k of Object.keys(D)) if (k[0] === "_") delete D[k];        // contas guardadas pelos indicadores no conjunto antigo
    // "revisado" = mudou algo ANTES do último candle que a tela tinha (candle corrigido pela fonte, ou a VWAP do dia
    // refeita porque chegou o primeiro volume do dia): aí o gráfico é refeito inteiro em vez de só continuar
    D._revisado = !(X.t[0] === base.t[de] && X.o[0] === base.o[de] && X.h[0] === base.h[de] && X.l[0] === base.l[de] && X.c[0] === base.c[de]);
    if (!D._revisado && X.vw && base.vw) for (let i = X.delta.vwDe, j = 0; i <= de && j < X.vw.length; i++, j++) if (X.vw[j] !== base.vw[i]) { D._revisado = true; break; }
    const emendar = (lista, corte, novos) => { lista.length = Math.min(lista.length, corte); for (const v of novos) lista.push(v); return lista; };
    for (const c of SERIES) D[c] = emendar(base[c], de, X[c]);
    D.vw = X.vw && base.vw ? emendar(base.vw, X.delta.vwDe, X.vw) : null;
    D.ruido = X.ruido && base.ruido ? emendar(base.ruido, de, X.ruido) : null;
    D.trades = base.trades.filter((t) => t.i_sai < de).concat(X.trades);
    D.ordens = base.ordens.filter((o) => o.i_fim != null && o.i_fim < de).concat(X.ordens).sort((a, b) => a.k - b.k);
    D.aten = base.aten;
    D.porEst = {};
    for (const [cod, pe] of Object.entries(X.porEst || {})) {
      const velhas = ((base.porEst || {})[cod] || {}).ops || [];
      D.porEst[cod] = Object.assign({}, pe, { ops: velhas.filter((x) => x[1] < de).concat(pe.ops) });
    }
    delete D.delta;
    return D;
  }
  async function carregarVivo(silencioso = false) {
    const seq = ++V.seq;
    V.pedido = Date.now(); V.buscando = true;
    const consulta = AX.parametros();
    const base = silencioso && V.D && !V.velho && V.consulta === consulta && V.D.meta.aoVivo ? V.D : null;
    if (!silencioso) $("carregando").classList.remove("oculto");
    try {
      let url = "/api/sim?" + consulta;
      if (base) { const m = base.meta; url += `&sid=${m.sid}&n=${m.n}&fp=${encodeURIComponent(m.fp)}&fo=${m.formando ? 1 : 0}&ii=${m.iIni}&ia=${encodeURIComponent(m.iaSel || "")}`; }
      const X = await AX.json(url, { tempo: base ? 25000 : 90000 });
      if (seq !== V.seq) return false;                 // chegou uma resposta velha: ignora
      V.falhas = 0; V.ok = Date.now();
      AX.erro("erroVivo", null);
      if (X.igual) { statusDados(V.D, X.idade); return true; }
      const antes = V.D, n0 = base ? base.t.length : 0;
      const retratoAntes = antes ? retrato(antes) : null, tAntes = antes ? antes.t[antes.meta.ultimo] : 0, metaAntes = antes && antes.meta;
      const D = X.delta && base ? fundir(base, X) : X;
      V.D = D; V.velho = false; V.consulta = consulta;
      if (ABAS_VIVAS.includes(AX.aba) || !AX.graficoMostra()) {
        if (X.delta && base) AX.atualizar(D, base, n0 - 1);
        else AX.mostrar(D, D.meta.iFim, { manterZoom: silencioso });
      }
      renderVivo(D);
      marcarPeriodo();
      AX.emit("dadosVivo", D);
      avisarNovidade(metaAntes, retratoAntes, tAntes, D);
      return true;
    } catch (e) {
      if (seq !== V.seq) return false;
      V.falhas++;
      if (!silencioso || V.falhas >= 3) AX.erro("erroVivo", e);          // uma falha passageira ao vivo não vira aviso
      if (!silencioso) { AX.toast(e.message, "erro"); throw e; }
      statusDados(V.D, null, true);
      return false;
    } finally {
      if (seq === V.seq) { V.buscando = false; $("carregando").classList.add("oculto"); }
    }
  }
  AX.carregarVivo = (s) => carregarVivo(s).catch(() => false);

  // O que aconteceu entre dois retratos da mesma estratégia: ordem armada, entrada executada, saída no ganho/na perda.
  // x = { pend, abertas, trades } (cada item com est e os horários t_sinal / t_ent / t_sai); tAntes = último candle do retrato velho.
  AX.novidades = (antes, depois, tAntes) => {
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
  AX.anunciar = (ev, meta, prefixo = "") => {
    if (!ev.length) return;
    const peso = { ordem: 1, entrada: 2, ganho: 3, perda: 3 };
    const top = ev.slice().sort((a, b) => peso[b.tipo] - peso[a.tipo])[0], o = top.o;
    const dec = meta.decimais, f = (v) => Number(v).toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
    const lado = o.dir > 0 ? "COMPRA" : "VENDA";
    const txt = top.tipo === "ordem" ? `${o.est}: ${lado} armada${o.gatilho != null ? (o.tipo === "limite" || o.ordem === "limite" ? " limitada em " : o.dir > 0 ? " acima de " : " abaixo de ") + f(o.gatilho) : " (a mercado no próximo candle)"}`
      : top.tipo === "entrada" ? `${o.est}: ${lado} executada a ${f(o.ent)}`
        : `${o.est}: saiu (${o.motivo}) ${AX.R(o.R)} = ${AX.dinheiro(o.dinheiro, { meta }, true)}`;
    AX.som(top.tipo);
    AX.toast(prefixo + txt, top.tipo === "ganho" ? "ok" : top.tipo === "perda" ? "erro" : "");
    AX.notificar("Robô Apex · " + (meta.nome || meta.ativo || ""), prefixo + txt);
    if (document.hidden) document.title = "● Robô Apex";
  };
  const retrato = (D) => ({ pend: D.ordens.filter((o) => o.status === "pendente"), abertas: D.abertas, trades: D.trades });
  function avisarNovidade(a, antes, tAntes, D) {
    const m = D.meta;
    if (!a || !m.aoVivo || !a.aoVivo || a.ativo !== m.ativo || a.tf !== m.tf || a.est !== m.est || a.gestao !== m.gestao ||
      a.contratos !== m.contratos || a.maxStops !== m.maxStops || a.iIni !== m.iIni || a.tam !== m.tam || a.riscoPct !== m.riscoPct ||
      a.seletivo !== m.seletivo || a.lossDia !== m.lossDia || a.metaDia !== m.metaDia) return;
    const ev = AX.novidades(antes, retrato(D), tAntes);
    if (!ev.length) return;
    const card = $("cardVivo"); card.classList.remove("pulso"); void card.offsetWidth; card.classList.add("pulso");
    if (AX.testes && AX.testes.cobre(m)) return;          // o teste ao vivo deste mesmo ativo/estratégia já avisa
    AX.anunciar(ev, m);
  }

  // status no topo: ao vivo / histórico, e um alerta se os dados pararam de chegar
  // Painel AO VIVO em cima do gráfico: o que o robô está fazendo agora, com entrada, stop, alvo e resultado escritos,
  // o preço atual e há quanto tempo chegou o último dado (para ninguém ficar na dúvida se está andando).
  function hudVivo() {
    const el = $("hudVivo"), D = V.D;
    if (!el) return;
    if (!D || AX.graficoMostra() !== D || !ABAS_VIVAS.includes(AX.aba)) { el.classList.add("oculto"); return; }
    const m = D.meta, k = m.iFim, e = AX.estadoEm(D, k), f = (v) => AX.fmt(v);
    const seg = V.ok ? Math.max(0, Math.round((Date.now() - V.ok) / 1000)) : null;
    const atraso = /atraso/.test(m.fonte || "") ? " · fonte com ~15 min de atraso" : "";
    let est;
    if (e.pos) {
      const p = e.pos, alvos = AX.alvosDe(p).map(([pr, nm]) => nm.toLowerCase() + " " + f(pr)).join(" · ");
      est = `<b class="${p.dir > 0 ? "cmp" : "vnd"}">${p.dir > 0 ? "COMPRADO" : "VENDIDO"}</b> ${AX.esc(p.est)} · entrada <b>${f(p.ent)}</b>${p.t_ent != null ? " às " + AX.quandoT(p.t_ent, m.intraday).slice(-5) : ""} · stop <b>${f(p.stopAgora ?? p.stop)}</b>${alvos ? " · " + alvos : ""} · agora <b class="${AX.cls(p.Ragora)}">${AX.R(p.Ragora)}</b>`;
    } else if (e.pend.length) {
      const o = e.pend[e.pend.length - 1];
      est = `<b class="${o.dir > 0 ? "cmp" : "vnd"}">${o.dir > 0 ? "COMPRA" : "VENDA"} ARMADA</b> ${AX.esc(o.est)} · entra ${o.gatilho == null ? "a mercado no próximo candle" : (o.tipo === "limite" ? "no limite " : o.dir > 0 ? "acima de " : "abaixo de ") + "<b>" + f(o.gatilho) + "</b>"} · stop <b>${f(o.stop)}</b>${o.alvo != null ? " · alvo <b>" + f(o.alvo) + "</b>" : ""}`;
    } else est = `<span class="neutro">sem operação aberta: aguardando setup</span>`;
    el.innerHTML = `<i class="luz ${m.aoVivo ? "vivo" : "hist"}"></i><span class="hud-preco">${f(D.c[k])}</span><span class="hud-est">${est}</span>
      <span class="hud-tempo" data-dica="Há quanto tempo o robô respondeu pela última vez. A tela pergunta a cada 5 segundos; o candle de agora muda quando a fonte manda preço novo.">${m.aoVivo ? (seg == null ? "" : "atualizado há " + seg + " s") + atraso : "histórico"}</span>`;
    el.classList.remove("oculto");
  }
  setInterval(hudVivo, 1000);
  AX.on("dadosVivo", hudVivo);
  function statusDados(D, idade, semResposta = false) {
    if (!D) return;
    const m = D.meta, dt = AX.quando(D, m.ultimo);
    if (idade !== undefined && idade !== null) m.idade = idade;
    const parado = semResposta || (m.aoVivo && m.idade != null && m.idade > 120);
    $("statusDados").innerHTML = !m.aoVivo ? `<i class="luz hist"></i><span>histórico · até ${AX.dataTxt(m.dataFim)}</span>`
      : parado ? `<i class="luz hist"></i><span>${semResposta ? "sem resposta do robô" : "sem dados novos há " + Math.round(m.idade / 60) + " min"} · ${dt}</span>`
        : `<i class="luz vivo"></i><span>ao vivo · ${dt}</span>`;
    $("statusDados").dataset.dica = `Último candle: ${AX.quando(D, m.ultimo, true)} (horário de Brasília). Fonte dos dados: ${m.fonte}.` +
      (m.aoVivo ? " A tela pergunta ao robô a cada 5 segundos e recebe só o que mudou. Se a luz ficar laranja, os dados pararam de chegar." : " Luz laranja: período no passado (histórico).");
  }

  // ---------------------------------------------------------------- resumo do período (aba Ao vivo)
  const GEST = { aberto: false, chave: "", dados: null };
  async function gestoesLado() {
    const el = $("gestLado"); if (!el) return;
    const chave = AX.parametros();
    if (GEST.chave !== chave || !GEST.dados) {
      el.innerHTML = '<div class="nota">comparando as gestões neste período…</div>';
      try { GEST.dados = await AX.json("/api/gestoes?" + chave); GEST.chave = chave; } catch (e) { el.innerHTML = `<div class="nota ruim">${AX.esc(e.message)}</div>`; return; }
      if (!$("gestLado")) return;
    }
    const g = GEST.dados, D = { meta: { moeda: g.moeda } }, max = Math.max(1, ...g.linhas.map((x) => Math.abs(x.total)));
    $("gestLado").innerHTML = `<table class="tab gl"><tr><th>Gestão</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Resultado</th><th></th><th class="n">Pior queda</th></tr>` +
      g.linhas.map((x) => `<tr class="clic ${x.gestao === AX.pref.gestao ? "sel" : ""}" data-g="${x.gestao}"><td>${AX.esc(x.nome)}</td><td class="n">${x.n}</td><td class="n">${AX.pct(x.acerto, 0)}</td>
        <td class="n ${AX.cls(x.total)}">${AX.dinheiro(x.total, D, true)}</td><td class="gl-b"><i class="${x.total >= 0 ? "bom" : "ruim"}" style="width:${Math.max(2, (46 * Math.abs(x.total)) / max)}px"></i></td>
        <td class="n">${AX.dinheiro(-x.ddMax, D)}</td></tr>`).join("") + `</table>
      <div class="nota">Mesma estratégia, mesmo período, mesmos custos: só muda a condução depois da entrada. Clique numa linha para usar aquela gestão. Período curto engana: confira também em “3 meses” e “Tudo”.</div>`;
    $("gestLado").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => AX.escolherGestao(tr.dataset.g)));
  }
  // abre a comparação das gestões no painel Ao vivo (chamado pela aba IA)
  AX.abrirGestoes = () => {
    GEST.aberto = true;
    if (AX.aba !== "vivo") AX.trocarAba("vivo"); else if (V.D) renderVivo(V.D);
    setTimeout(() => { const g = $("btGestLado"); if (g) g.scrollIntoView({ block: "center", behavior: "smooth" }); }, 80);
  };
  function renderVivo(D) {
    const m = D.meta, st = D.stats, k = m.iFim;
    AX.cartaoMomento($("cardVivo"), D, k);
    statusDados(D);
    // resumo do período
    const est = m.est;
    const seta = (v) => (v === 1 ? "▲ alta" : v === -1 ? "▼ baixa" : "■ indefinida");
    const ctx = D.contexto ? `<span class="chip ${D.contexto.semanal > 0 ? "sobe" : D.contexto.semanal < 0 ? "desce" : ""}" data-dica="Tendência pela Teoria de Dow no gráfico semanal (topos e fundos). É só leitura: não entra na decisão das estratégias.">semanal ${seta(D.contexto.semanal)}</span><span class="chip ${D.contexto.diario > 0 ? "sobe" : D.contexto.diario < 0 ? "desce" : ""}" data-dica="Tendência pela Teoria de Dow no gráfico diário. É só leitura.">diário ${seta(D.contexto.diario)}</span>` : "";
    const tamanho = m.tam === "risco" ? `risco de ${AX.num(m.riscoPct, 1)}% do capital por operação` : AX.unidade(m, m.contratos);
    const plano = [m.seletivo ? "modo seletivo" : "", m.lossDia > 0 ? `para o dia em −${AX.dinheiro(m.lossDia, D)}` : "", m.metaDia > 0 ? `para o dia em +${AX.dinheiro(m.metaDia, D)}` : ""].filter(Boolean).join(" · ");
    const gc = AX.cfg.gestoesCurto || {};
    let html = `<div class="rot"><svg class="ic" viewBox="0 0 24 24"><path d="M4 19h16M7 16V9M12 16V5M17 16v-4"/></svg>NO PERÍODO · ${AX.esc(AX.nomeEst(est))}<span class="dir">${AX.dataTxt(m.dataIni)} a ${AX.dataTxt(m.dataFim)}</span></div>`;
    if (st.n) {
      const cr = st.custoR || 0;
      html += `<div class="resumo-topo"><div><div class="grande ${AX.cls(st.total)}">${AX.dinheiro(st.total, D, true)}</div>
          <div class="sub">${st.n} operações · acerto ${AX.pct(st.acerto, 0)} (empata com ${AX.pct(st.empate, 0)}) · ${tamanho}</div></div>${AX.seloCurto(st)}</div>
        <canvas class="spark" id="sparkVivo"></canvas>
        <div class="kpis">
          <div><small>Média por operação${AX.q("Resultado médio de cada operação, já com custos. O “±” é a margem de erro (95%): enquanto ela for maior que a média, o resultado ainda pode ser sorte.")}</small><b class="${AX.cls(st.mediaDin)}">${AX.dinheiro(st.mediaDin, D, true)}</b><em>± ${AX.dinheiro(st.icDin, D)}</em></div>
          <div><small>Pior queda${AX.q("A maior perda acumulada entre um pico e o fundo seguinte da curva de resultado no período. É o tamanho do buraco que você teria de aguentar.")}</small><b class="ruim">${AX.dinheiro(-st.ddMax, D)}</b><em>${AX.pct(st.ddPct, 0)} do pico</em></div>
          <div><small>Custos${AX.q("Taxas, corretagem e escorregamento somados. Sem eles o resultado seria " + AX.dinheiro(st.bruto, D, true) + ". Acima de 15% do risco por operação fica quase impossível ganhar.")}</small><b class="${cr >= 0.15 ? "ruim" : ""}">${AX.dinheiro(-st.custos, D)}</b><em>${AX.pct(100 * cr, 0)} do risco de cada operação</em></div>
        </div>
        ${st.n >= 10 && cr >= 0.15 ? `<div class="aviso-custo">⚠ Aqui os custos comem <b>${AX.pct(100 * cr, 0)}</b> do risco de cada operação (sem custos o resultado seria ${AX.dinheiro(st.bruto, D, true)}). Com custo tão alto é quase impossível ganhar: teste um tempo gráfico maior (60 min) ou um ativo de custo menor.</div>` : ""}`;
    } else {
      html += `<div class="resumo-topo"><div><div class="grande neutro">sem operações</div><div class="sub">nenhum setup desta estratégia no período escolhido</div></div>${AX.seloCurto(st)}</div>`;
    }
    const cx = st.ctx;
    html += `<div class="gest"><small>Gestão${AX.q("Como a operação é conduzida depois da entrada. Padrão = a de cada estratégia. 2:1, 3:1, 4:1 = alvo a tantas vezes o risco. Parcial = metade no 1:1 e o resto no 2:1. Condução = metade no 1:1 e o resto carregado pela MM9. Trailing ATR = sem alvo, o stop sobe 2 ATR atrás do melhor preço. Trailing degraus = sem alvo, a cada 1R a favor o stop sobe 1R.")}</small>
        <div class="gest-btns">${Object.keys(AX.cfg.gestoes).map((g) => `<button data-g="${g}" class="${g === m.gestao ? "on" : ""}" data-dica="${AX.esc(AX.cfg.gestoes[g])}">${AX.esc(gc[g] || g)}</button>`).join("")}</div>
        <button class="gest-cmp ${GEST.aberto ? "on" : ""}" id="btGestLado" data-dica="Roda esta mesma estratégia, neste período, com cada gestão, e mostra lado a lado. Serve para ver se carregar a operação (trailing) teria rendido mais que o alvo fixo.">comparar todas ${GEST.aberto ? "▴" : "▾"}</button></div>
      ${GEST.aberto ? '<div id="gestLado"></div>' : ""}
      ${plano ? `<div class="linha-ctx"><span>Plano: ${plano}</span></div>` : ""}
      ${m.foraDoPlano ? `<div class="linha-ctx"><span class="ruim">${m.foraDoPlano} ordem(ns) ficaram de fora: o lote mínimo arriscava mais que ${AX.num(m.riscoPct, 1)}% do capital.</span></div>` : ""}
      <div class="linha-ctx">${ctx}</div>
      <div class="botoes finos"><button id="btExplica" data-dica="Abre uma minijanela com o desenho do setup e o passo a passo desta estratégia.">❔ Como funciona ${est === "TODAS" ? "o modo TODAS" : "a " + AX.esc(est)}</button></div>
      <details><summary>Como ler · detalhes</summary>
        <div class="nota">${AX.esc(st.explica || "")}${st.n ? ` Média na 1ª metade: ${AX.dinheiro(st.exp1, D, true)} · na 2ª: ${AX.dinheiro(st.exp2, D, true)}. Ganho médio ÷ perda média: ${AX.num(st.payoff, 2)} · fator de lucro ${AX.num(st.fatorLucro, 2)}.` : ""}</div>
        ${cx && (cx.favor.n || cx.contra.n) ? `<div class="nota">A favor da tendência do diário: ${cx.favor.n} operações, média ${AX.dinheiro(cx.favor.media, D, true)}. Contra: ${cx.contra.n} operações, média ${AX.dinheiro(cx.contra.media, D, true)}.</div>` : ""}
        <div class="nota">Gestão: ${AX.esc(AX.cfg.gestoes[m.gestao])}. Custos: escorregamento de ${AX.fmt(m.slip)} por lado${m.custo ? ` + ${AX.dinheiro(m.custo, D)} por ${m.fracionado ? "lote" : "contrato"} por lado` : ""}${m.custoPct ? ` + taxa de ${AX.num(100 * m.custoPct, 2)}% do valor por lado` : ""}. ${m.lote ? "Tamanho: " + AX.esc(m.lote) + ". " : ""}Fonte: ${AX.esc(m.fonte)}.</div>
      </details>`;
    $("resumoVivo").innerHTML = html;
    AX.sparkline($("sparkVivo"), D.trades.map((t) => t.dinheiro), (i, v, ac) => `Operação ${i} de ${D.trades.length}: ${AX.dinheiro(v, D, true)} · acumulado ${AX.dinheiro(ac, D, true)}`);
    $("resumoVivo").querySelectorAll(".gest-btns button").forEach((b) => (b.onclick = () => AX.escolherGestao(b.dataset.g)));
    $("btGestLado").onclick = () => { GEST.aberto = !GEST.aberto; renderVivo(V.D); };
    $("btExplica").onclick = () => (AX.explica ? AX.explica.abrir(est) : AX.toast("A explicação ainda está carregando.", "aviso"));
    if (GEST.aberto) gestoesLado();
    // TODAS: cada estratégia sozinha
    const tv = $("tabelaVivo");
    if (est === "TODAS" && D.porEst && Object.keys(D.porEst).length) {
      tv.classList.remove("oculto");
      const aberto = tv.querySelector("details") && tv.querySelector("details").open;
      tv.innerHTML = `<details ${aberto ? "open" : ""}><summary style="margin-top:0">Cada estratégia sozinha no período (clique para ver)</summary><table class="tab" style="margin-top:6px"><tr><th>Estratégia</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Resultado</th><th></th></tr>` +
        Object.entries(D.porEst).map(([c, r]) => { const s = r.isolada; return `<tr class="clic" data-est="${c}"><td class="nome" title="${AX.esc(AX.nomeEst(c))}">${c} ${AX.esc(AX.nomeEst(c))}</td><td class="n">${s.n}</td><td class="n">${AX.pct(s.acerto, 0)}</td><td class="n ${AX.cls(s.total)}">${AX.dinheiro(s.total, D, true)}</td><td>${AX.seloCurto(s)}</td></tr>`; }).join("") +
        `</table><div class="nota">Clique numa linha para ver só aquela estratégia.</div></details>`;
      tv.querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => AX.escolherEst(tr.dataset.est)));
    } else tv.classList.add("oculto");
  }

  // ---------------------------------------------------------------- abas
  AX.aba = "vivo";
  // largura do painel: arraste a divisória (cada tamanho de aba guarda a sua); duplo clique volta ao padrão
  const classeLarg = () => (AX.aba === "cmp" ? "l" : AX.aba === "opcoes" ? "c" : AX.aba === "sim" || AX.aba === "cal" ? "m" : "n");
  const limiteLarg = (w) => Math.round(Math.max(320, Math.min(window.innerWidth - 380, w)));
  function aplicarLargura() {
    const w = (AX.pref.larg || {})[classeLarg()];
    $("painel").style.width = w > 0 ? limiteLarg(w) + "px" : "";
  }
  (() => {
    const dv = $("divisor"); let arrastando = false;
    dv.addEventListener("pointerdown", (e) => { arrastando = true; dv.setPointerCapture(e.pointerId); document.body.classList.add("arrastando"); e.preventDefault(); });
    dv.addEventListener("pointermove", (e) => {
      if (!arrastando) return;
      const w = limiteLarg(window.innerWidth - e.clientX - 3);
      $("painel").style.width = w + "px";
      AX.pref.larg = Object.assign({}, AX.pref.larg, { [classeLarg()]: w });
    });
    const fim = () => {
      if (!arrastando) return;
      arrastando = false; document.body.classList.remove("arrastando"); AX.salvarPref();
      window.dispatchEvent(new Event("resize"));
    };
    dv.addEventListener("pointerup", fim); dv.addEventListener("pointercancel", fim);
    dv.addEventListener("dblclick", () => {
      const l = Object.assign({}, AX.pref.larg); delete l[classeLarg()]; AX.pref.larg = l; AX.salvarPref(); aplicarLargura();
      window.dispatchEvent(new Event("resize"));
    });
    window.addEventListener("resize", () => { if (!arrastando) aplicarLargura(); });
  })();
  $("btCentro").onclick = () => AX.centralizar();
  $("btPeriodoTodo").onclick = () => AX.centralizar(true);
  const ABAS_VIVAS = ["vivo", "ia", "cal", "plano", "opcoes"];       // abas em que o gráfico mostra o "agora"
  function trocarAba(nome) {
    AX.aba = nome;
    document.querySelectorAll(".abas button").forEach((b) => b.classList.toggle("on", b.dataset.aba === nome));
    document.querySelectorAll(".aba").forEach((s) => s.classList.toggle("on", s.id === "aba-" + nome));
    $("painel").classList.toggle("largo", nome === "cmp");
    $("painel").classList.toggle("medio", nome === "sim" || nome === "cal");
    $("painel").classList.toggle("cripto", nome === "opcoes");
    aplicarLargura();
    if (ABAS_VIVAS.includes(nome)) {
      if (V.D && !V.velho) { if (AX.graficoMostra() !== V.D) AX.mostrar(V.D, V.D.meta.iFim); if (nome === "vivo") renderVivo(V.D); }
      else AX.carregarVivo();
    }
    AX.emit("aba", nome);
  }
  AX.trocarAba = trocarAba;
  document.querySelectorAll(".abas button").forEach((b) => (b.onclick = () => trocarAba(b.dataset.aba)));
  window.addEventListener("resize", () => { if (V.D && AX.aba === "vivo") renderVivo(V.D); });

  AX.on("mudou", () => {
    V.velho = true;
    if (ABAS_VIVAS.includes(AX.aba)) AX.carregarVivo();
  });

  // Atualização automática: a cada 5 s a tela pergunta "mudou algo?" e recebe só o trecho novo. Um pedido pendurado há
  // mais de 40 s é abandonado e refeito (antes, um pedido sem resposta deixava a tela congelada).
  setInterval(() => {
    if (!(AX.cfg && AX.pref.auto && ABAS_VIVAS.includes(AX.aba) && AX.aba !== "cal" && !document.hidden && V.D && V.D.meta.aoVivo)) return;
    if (V.buscando && Date.now() - V.pedido < 40000) return;
    if (Date.now() - V.pedido >= 4700) AX.carregarVivo(!V.velho);
  }, 1000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = "Robô Apex";
      if (AX.cfg && ABAS_VIVAS.includes(AX.aba) && AX.pref.auto && V.D && V.D.meta.aoVivo && !V.buscando) AX.carregarVivo(!V.velho);
    }
  });
  document.addEventListener("keydown", (e) => {
    const alvo = e.target && e.target.tagName;
    if (alvo === "INPUT" || alvo === "SELECT" || alvo === "TEXTAREA") return;
    if (e.key === "Escape") AX.fecharPopovers();
    if (e.key === "Home") { e.preventDefault(); AX.centralizar(); }
    AX.emit("tecla", e);
  });
  window.addEventListener("error", (e) => { if (!/ResizeObserver/.test(e.message || "")) AX.toast("Erro na tela: " + e.message, "erro"); });
  window.addEventListener("unhandledrejection", (e) => { if (!saindo) AX.toast("Erro: " + ((e.reason && e.reason.message) || e.reason), "erro"); });

  // ---------------------------------------------------------------- início (com a tela de abertura)
  const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
  (async function iniciar() {
    const t0 = performance.now();
    const sp = AX.splash;
    try {
      sp.passo("dados", "fazendo", "conectando ao robô…");
      // espera os outros módulos (ind, sim, calendário, operações…) carregarem: eles ouvem o evento "config"
      if (document.readyState === "loading") await new Promise((ok) => document.addEventListener("DOMContentLoaded", ok, { once: true }));
      AX.cfg = await AX.json("/api/config");
      if (identificar(AX.cfg.usuario)) return;
      document.querySelector(".topo .titulo").innerHTML = 'ROBÔ APEX <small class="versao">' + AX.esc(AX.cfg.versao || "") + "</small>";         // outro usuário neste navegador: a página recomeça com as preferências dele
      AX.cfg.estMap = Object.fromEntries(AX.cfg.estrategias.map((e) => [e.cod, e]));
      // link direto: ?ativo=WIN&tf=5&est=TODAS&per=5d&aba=sim&acao=simular|replay|robo&passos=40
      const u = new URLSearchParams(location.search);
      for (const k of ["ativo", "est", "gestao", "per"]) if (u.has(k)) AX.pref[k] = u.get(k);
      for (const k of ["tf", "contratos", "risco", "lossDia", "metaDia", "metaMes", "quedaMax", "capital"]) if (u.has(k) && +u.get(k) > 0) AX.pref[k] = +u.get(k);
      if (u.has("tam")) AX.pref.tam = u.get("tam") === "risco" ? "risco" : "fixo";
      if (u.has("seletivo")) AX.pref.seletivo = u.get("seletivo") === "1";
      if (u.has("seg")) AX.pref.criptoSeg = u.get("seg");
      if (u.has("de") && u.has("ate")) { AX.pref.per = "custom"; AX.pref.de = u.get("de"); AX.pref.ate = u.get("ate"); }
      if (!(AX.pref.per in PERIODOS)) AX.pref.per = "1m";
      ligarTopo();
      aplicarLargura();
      AX.json("/api/profit/estado").then((e) => {
        $("profitEstado").innerHTML = `<b>Profit:</b> ${AX.esc(e.situacao)} · ordens em modo <b>simulador</b> (${e.ordens} registradas)${AX.q(e.falta + " Pasta: " + e.pasta + ". Enquanto isso o robô registra cada ordem armada dos testes ao vivo num arquivo, sem enviar nada à corretora.")}`;
      }).catch(() => {});
      AX.json("/api/sons").then((j) => { AX.sons = j.sons || {}; AX.pastaSons = j.pasta; }).catch(() => {});
      AX.emit("config", AX.cfg);
      sp.passo("dados", "fazendo", `baixando ${AX.pref.ativo} em ${AX.pref.tf >= 1440 ? "diário" : AX.pref.tf + " min"}…`);
      sp.passo("est", "fazendo");
      let ok = true;
      try { await carregarVivo(); } catch (e) { ok = false; }
      sp.passo("dados", ok ? "feito" : "falhou", ok ? "dados carregados" : "não consegui carregar os dados (veja o aviso)");
      await espera(150);
      sp.passo("est", ok ? "feito" : "falhou", `${AX.cfg.estrategias.length} estratégias prontas`);
      sp.passo("resumo", "fazendo", "calculando o resumo do período…");
      await espera(150);
      sp.passo("resumo", ok ? "feito" : "falhou", ok && V.D ? `${V.D.stats.n} operações no período` : "");
      sp.passo("news", "fazendo", "buscando notícias do mercado…");
      const n = await Promise.race([AX.noticiasPrimeira ? AX.noticiasPrimeira() : Promise.resolve(null), espera(9000).then(() => null)]);
      sp.passo("news", n ? "feito" : "falhou", n ? `${n} notícias das últimas horas` : "notícias demorando — continuam carregando");
      if (u.has("ind") && AX.ind) AX.ind.ligar(u.get("ind").split(","));
      if (u.has("op") && AX.ops) AX.ops.abrir(+u.get("op") || 1);
      if (u.get("pop") === "ind") $("btInd").click();
      if (u.get("pop") === "candles") $("btCandles").click();
      if (u.get("pop") === "explica" && AX.explica) AX.explica.abrir(AX.pref.est);
      if (u.get("pop") === "gestoes") { GEST.aberto = true; if (V.D) renderVivo(V.D); }
      const aba = u.get("aba");
      if (["sim", "cmp", "cal", "news", "plano", "opcoes", "ia"].includes(aba)) trocarAba(aba);
      if (aba === "sim" && u.get("acao") && AX.simDemo) await AX.simDemo({ acao: u.get("acao"), passos: +u.get("passos") || 0 });
      if (aba === "cmp" && u.get("acao") === "comparar") $("btComparar").click();
      if (u.get("acao") === "robo") AX.emit("rodarRobo");
      if (u.get("conta") && AX.conta) AX.conta.abrir(u.get("conta"));
    } catch (e) {
      if (saindo) return;
      $("splashTxt").textContent = "Não consegui iniciar: " + e.message;
      await espera(2500);
    }
    await espera(Math.max(0, 1300 - (performance.now() - t0)));
    sp.fechar();
  })();
})();
