/* ROBÔ KELLER — núcleo da tela: escolhas do topo, gráfico e a aba AO VIVO.
   Toda conta de estratégia e de resultado é feita no servidor (Python); a tela só mostra. */
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
  const PADRAO = { ativo: "WIN", tf: 5, est: "TODAS", gestao: "padrao", contratos: 1, capital: 10000, maxstops: 2, som: true, auto: true };
  RK.pref = Object.assign({}, PADRAO);
  try { Object.assign(RK.pref, JSON.parse(localStorage.getItem("rk_pref") || "{}")); } catch (e) { /* sem armazenamento */ }
  RK.salvarPref = () => { try { localStorage.setItem("rk_pref", JSON.stringify(RK.pref)); } catch (e) { /* ok */ } };

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
  RK.dataTxt = (d) => { const s = String(d); return `${s.slice(6, 8)}/${s.slice(4, 6)}/${s.slice(0, 4)}`; };
  RK.dataISO = (d) => { const s = String(d); return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`; };
  RK.isoInt = (iso) => (iso ? parseInt(iso.replace(/-/g, ""), 10) : 0);
  RK.esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  RK.nomeEst = (cod) => (cod === "TODAS" ? "TODAS juntas" : (RK.cfg.estMap[cod] || {}).nome || cod);
  RK.dirTxt = (d) => (d > 0 ? "COMPRA" : "VENDA");

  let toastT = null;
  RK.toast = (msg, tipo = "") => {
    const t = $("toast"); t.textContent = msg; t.className = "toast on " + tipo;
    clearTimeout(toastT); toastT = setTimeout(() => (t.className = "toast"), 4500);
  };
  let audio = null;
  RK.bip = (freq = 880) => {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      if (audio.state === "suspended") audio.resume();
      const o = audio.createOscillator(), g = audio.createGain();
      o.frequency.value = freq; g.gain.value = 0.08; o.connect(g); g.connect(audio.destination);
      o.start(); o.stop(audio.currentTime + 0.2);
    } catch (e) { /* sem som */ }
  };
  RK.erro = (id, e) => {
    const el = $(id);
    if (!e) { el.classList.add("oculto"); el.textContent = ""; return; }
    el.textContent = "⚠ " + (e.message || e); el.classList.remove("oculto");
  };

  // ---------------------------------------------------------------- gráfico
  const COR = { mm9: "#ff5b6e", mm20: "#3b9cff", mm200: "#b35cff", vw: "#ffd23f", compra: "#22d3ee", venda: "#e056fd", ganho: "#00e676", perda: "#ff4d5e" };
  const chart = LightweightCharts.createChart($("chart"), {
    autoSize: true,
    layout: { background: { type: "solid", color: "#0d1016" }, textColor: "#8a96a8", fontFamily: "Segoe UI, system-ui" },
    grid: { vertLines: { color: "#161c27" }, horzLines: { color: "#161c27" } },
    rightPriceScale: { borderColor: "#262f40" },
    timeScale: { borderColor: "#262f40", timeVisible: true, secondsVisible: false, rightOffset: 6 },
    crosshair: { mode: 0 },
    localization: { locale: "pt-BR", priceFormatter: (p) => RK.fmt(p) },
  });
  const S = {
    candle: chart.addCandlestickSeries({ upColor: "#26a69a", downColor: "#ef5350", borderVisible: false, wickUpColor: "#26a69a", wickDownColor: "#ef5350" }),
  };
  const linha = (cor, w) => chart.addLineSeries({ color: cor, lineWidth: w, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
  S.mm200 = linha(COR.mm200, 2); S.vw = linha(COR.vw, 2); S.mm20 = linha(COR.mm20, 2); S.mm9 = linha(COR.mm9, 1);
  RK.chart = chart; RK.S = S;

  const G = { D: null, k: -1, linhasPreco: [] };
  RK.i = 0;
  const serie = (D, nome, k) => {
    const v = D[nome], out = [];
    if (!v) return out;
    for (let i = 0; i <= k; i++) out.push(v[i] == null ? { time: D.t[i] } : { time: D.t[i], value: v[i] });
    return out;
  };
  const vela = (D, i) => ({ time: D.t[i], open: D.o[i], high: D.h[i], low: D.l[i], close: D.c[i] });

  function marcadores(D, k) {
    const m = [], todas = D.meta.est === "TODAS";
    for (const t of D.trades) {
      if (t.i_ent > k) continue;
      m.push({ time: D.t[t.i_ent], position: t.dir > 0 ? "belowBar" : "aboveBar", color: t.dir > 0 ? COR.compra : COR.venda,
        shape: t.dir > 0 ? "arrowUp" : "arrowDown", text: todas ? t.est : "" });
      if (t.i_sai <= k) m.push({ time: D.t[t.i_sai], position: t.dir > 0 ? "aboveBar" : "belowBar", color: t.R > 0 ? COR.ganho : COR.perda,
        shape: "circle", text: RK.R(t.R, 1) });
    }
    for (const a of D.abertas) if (a.i_ent <= k && k === D.meta.iFim)
      m.push({ time: D.t[a.i_ent], position: a.dir > 0 ? "belowBar" : "aboveBar", color: a.dir > 0 ? COR.compra : COR.venda,
        shape: a.dir > 0 ? "arrowUp" : "arrowDown", text: todas ? a.est : "" });
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
    const it = (cor, nome, v) => (v == null ? "" : `<span><i style="background:${cor}"></i>${nome} ${RK.fmt(v)}</span>`);
    $("legenda").innerHTML = `<span><b>${RK.esc(D.meta.ativo)}</b> · ${D.meta.nomeTf} · ${RK.quando(D, k)}</span>` +
      `<span>A ${RK.fmt(D.o[k])} M ${RK.fmt(D.h[k])} m ${RK.fmt(D.l[k])} F ${RK.fmt(D.c[k])}</span>` +
      it(COR.mm9, "MM9", D.mm9[k]) + it(COR.mm20, "MM20", D.mm20[k]) + it(COR.mm200, "MM200", D.mm200[k]) + (D.vw ? it(COR.vw, "VWAP", D.vw[k]) : "");
  }

  // mostra o conjunto D no gráfico até o candle k (inclusive)
  RK.mostrar = (D, k, { manterZoom = false, foco = null } = {}) => {
    const trocouAtivo = !G.D || G.D.meta.ativo !== D.meta.ativo || G.D.meta.tf !== D.meta.tf;
    G.D = D; G.k = k; RK.D = D; RK.i = k; RK.ativo = D.meta.ativo;
    const dec = D.meta.decimais;
    S.candle.applyOptions({ priceFormat: { type: "price", precision: dec, minMove: Math.pow(10, -dec) } });
    chart.applyOptions({ timeScale: { timeVisible: D.meta.intraday } });
    const velas = []; for (let i = 0; i <= k; i++) velas.push(vela(D, i));
    S.candle.setData(velas);
    S.mm9.setData(serie(D, "mm9", k)); S.mm20.setData(serie(D, "mm20", k)); S.mm200.setData(serie(D, "mm200", k));
    S.vw.setData(D.vw ? serie(D, "vw", k) : []);
    S.candle.setMarkers(marcadores(D, k));
    linhasDoEstado(D, k); legenda(D, k);
    if (foco != null) RK.focar(foco);
    else if (!manterZoom || trocouAtivo) chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, k - 140), to: k + 8 });
    if (trocouAtivo) RK.emit("carregado");
  };
  // avança o gráfico já mostrado até o candle k (replay)
  RK.avancar = (k) => {
    const D = G.D; if (!D || k <= G.k) return;
    for (let i = G.k + 1; i <= k; i++) {
      S.candle.update(vela(D, i));
      for (const n of ["mm9", "mm20", "mm200", "vw"]) if (D[n] && D[n][i] != null) S[n].update({ time: D.t[i], value: D[n][i] });
    }
    G.k = k; RK.i = k;
    S.candle.setMarkers(marcadores(D, k)); linhasDoEstado(D, k); legenda(D, k);
  };
  RK.focar = (i) => chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, i - 70), to: i + 40 });
  RK.graficoMostra = () => G.D;
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

  // cartão "o que fazer agora" (usado ao vivo e no replay)
  RK.cartaoMomento = (el, D, k) => {
    const e = RK.estadoEm(D, k), m = D.meta, q = m.contratos;
    const riscoTxt = (pts) => `${RK.fmt(pts)} pts = ${RK.dinheiro(pts * m.valorPonto * q + 2 * m.custo * q, D)} ${q === 1 ? "por " + (m.fracionado ? "lote" : "contrato") : "em " + RK.num(q, m.fracionado ? 2 : 0) + (m.fracionado ? " lotes" : " contratos")}`;
    const tr = (cor, nome, v, extra = "") => `<tr><td><span class="sw" style="background:${cor}"></span>${nome}</td><td>${RK.fmt(v)}</td><td>${extra}</td></tr>`;
    let cls = "", html = "";
    const quem = (cod) => `<div class="quem">${RK.esc(cod)} · ${RK.esc(RK.nomeEst(cod))}</div>`;
    const saiu = e.saidas.length ? `<div class="detalhe">Neste candle saiu: ${e.saidas.map((t) => `${t.est} ${RK.dirTxt(t.dir).toLowerCase()} <b class="${RK.cls(t.R)}">${RK.R(t.R)}</b> (${RK.esc(t.motivo)})`).join(" · ")}</div>` : "";
    if (e.pos) {
      const p = e.pos, R = p.Ragora;
      cls = "pos";
      html = `<div class="estado">${p.dir > 0 ? "COMPRADO" : "VENDIDO"} <span class="${RK.cls(R)}">${RK.R(R)}</span></div>${quem(p.est)}
        <div class="detalhe">Entrou em ${RK.quando(D, p.i_ent)} · gestão: ${RK.esc(RK.cfg.gestoes[p.gestao] || p.gestao)}${p.parcial ? " · <b>parcial feita, stop no 0x0</b>" : ""}${p.sair ? " · <b>sai na abertura do próximo candle</b> (" + RK.esc(p.sair) + ")" : ""}</div>
        <table>${tr("#fff", "Entrada", p.ent)}${tr(COR.perda, p.stopAgora != null && p.stopAgora !== p.stop ? "Stop (movido)" : "Stop", p.stopAgora ?? p.stop, riscoTxt(p.risco))}${p.alvo != null ? tr(COR.ganho, "Alvo", p.alvo) : ""}</table>${saiu}`;
    } else if (e.pend.length) {
      const o = e.pend[e.pend.length - 1];
      const ref = o.gatilho ?? D.c[k], risco = Math.abs(ref - o.stop);
      cls = o.dir > 0 ? "compra" : "venda";
      const quando = o.gatilho == null ? "a mercado na abertura do próximo candle" : `${o.dir > 0 ? "acima de" : "abaixo de"} ${RK.fmt(o.gatilho)} (ordem stop)`;
      html = `<div class="estado">${o.dir > 0 ? "ORDEM DE COMPRA ARMADA" : "ORDEM DE VENDA ARMADA"}</div>${quem(o.est)}
        <div class="detalhe">${RK.dirTxt(o.dir)} ${quando} · vale ${o.validade} candle(s) · sinal em ${RK.quando(D, o.i_sinal)}${o.info ? " · " + RK.esc(o.info) : ""}</div>
        <table>${tr(o.dir > 0 ? COR.compra : COR.venda, "Entrada", ref)}${tr(COR.perda, "Stop", o.stop, riscoTxt(risco))}${o.alvo != null ? tr(COR.ganho, `Alvo ${Math.round(Math.abs(o.alvo - ref) / (risco || 1))}:1${o.gestao === "parcial" ? " (parcial no 1:1)" : ""}`, o.alvo,"+" + RK.dinheiro(Math.abs(o.alvo - ref) * m.valorPonto * q, D)) : `<tr><td colspan="3" class="neutro">Saída: ${RK.esc(RK.cfg.gestoes[o.gestao] || o.gestao)}</td></tr>`}</table>
        ${e.pend.length > 1 ? `<div class="detalhe">+${e.pend.length - 1} outra(s) ordem(ns) armada(s): ${e.pend.slice(0, -1).map((x) => x.est + " " + RK.dirTxt(x.dir).toLowerCase()).join(", ")} — a primeira que executar vale.</div>` : ""}${saiu}`;
    } else if (e.aten.length) {
      const [cod, dir] = e.aten[0];
      cls = "aten";
      html = `<div class="estado">ATENÇÃO: ${dir > 0 ? "COMPRA" : "VENDA"} SE FORMANDO</div>${quem(cod)}
        <div class="detalhe">Aguardando: ${RK.esc((RK.cfg.estMap[cod] || {}).aguardando || "")}. Ainda <b>não</b> é sinal: espere a ordem armada.</div>
        ${e.aten.length > 1 ? `<div class="detalhe">Também: ${e.aten.slice(1).map(([c, d]) => c + " " + (d > 0 ? "compra" : "venda")).join(", ")}</div>` : ""}${saiu}`;
    } else {
      html = `<div class="estado">AGUARDANDO SETUP</div><div class="detalhe">${m.est === "TODAS" ? "Nenhuma das estratégias" : RK.esc(RK.nomeEst(m.est)) + " não"} tem setup neste candle.</div>${saiu}`;
    }
    el.className = "card momento " + cls;
    el.innerHTML = html;
    return e;
  };

  const CURTO = { "VANTAGEM ESTATÍSTICA": "VANTAGEM", "PROMISSORA, NÃO COMPROVADA": "NÃO COMPROVADA" };
  RK.seloCurto = (st) => `<span class="selo ${st.cor || "neutro"}" title="${RK.esc((st.veredito || "") + ": " + (st.explica || ""))}">${RK.esc(CURTO[st.veredito] || st.veredito || "—")}</span>`;
  RK.seloVeredito = (st) => `<div class="veredito"><span class="selo ${st.cor || "neutro"}">${RK.esc(st.veredito || "—")}</span><span class="txt">${RK.esc(st.explica || "")}</span></div>`;

  // ---------------------------------------------------------------- topo: ativo, tempo, gestão, contratos, estratégia
  RK.cfg = null;
  RK.parametros = (extra = {}) => {
    const p = RK.pref;
    const q = new URLSearchParams({ ativo: p.ativo, tf: p.tf, est: p.est, gestao: p.gestao, contratos: p.contratos, capital: p.capital, maxstops: p.maxstops });
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return q.toString();
  };
  function ajustarContratos() {
    const a = RK.cfg.ativos.find((x) => x.chave === RK.pref.ativo) || {};
    const inp = $("contratos");
    inp.step = a.fracionado ? "0.01" : "1"; inp.min = a.fracionado ? "0.01" : "1";
    $("rotContratos").textContent = a.fracionado ? "Lotes" : "Contratos";
    if (!a.fracionado) RK.pref.contratos = Math.max(1, Math.round(RK.pref.contratos));
    inp.value = RK.pref.contratos;
  }
  function montarBarraEst() {
    const bar = $("barraEst");
    bar.innerHTML = RK.cfg.estrategias.map((e) => `<button data-est="${e.cod}" title="${RK.esc(e.autor)}"><b>${e.cod} · ${RK.esc(e.nome)}</b><small>${RK.esc(e.autor)}</small><span class="ponto oculto"></span></button>`).join("") +
      `<div class="acoes"><button data-est="TODAS" class="todas" title="Roda todas ao mesmo tempo: uma operação por vez, a primeira ordem que executar vale"><b>▶ RODAR TODAS JUNTAS</b><small>busca entrada nas ${RK.cfg.estrategias.length} estratégias</small><span class="ponto oculto"></span></button>` +
      `<button class="robo" id="btRobo" title="Testa todas as estratégias em 5, 15 e 60 min neste ativo, mostra a que mais se encaixa no mercado de agora e a projeção de ganho/perda"><b>⚡ RODAR ROBÔ</b><small>estratégia do momento + projeção</small></button></div>`;
    bar.querySelectorAll("button[data-est]").forEach((b) => (b.onclick = () => escolherEst(b.dataset.est)));
    $("btRobo").onclick = () => RK.emit("rodarRobo");
    marcarEst();
  }
  function marcarEst() {
    const diario = +RK.pref.tf >= 1440;
    $("barraEst").querySelectorAll("button[data-est]").forEach((b) => {
      b.classList.toggle("on", b.dataset.est === RK.pref.est);
      const e = RK.cfg.estMap[b.dataset.est];
      b.disabled = !!(e && e.intraday && diario);
      if (b.disabled) b.title = "Só funciona em gráfico intraday";
    });
  }
  RK.marcarEst = () => marcarEst();
  RK.escolherEst = (cod) => escolherEst(cod);
  RK.escolherTf = (tf) => {
    if (+tf === +RK.pref.tf) return;
    RK.pref.tf = +tf; $("tf").value = tf; RK.salvarPref(); marcarEst(); RK.emit("mudou", "tf");
  };
  function escolherEst(cod) {
    if (cod === RK.pref.est) return;
    RK.pref.est = cod; RK.salvarPref(); marcarEst();
    RK.emit("mudou", "est");
  }
  RK.pontosEst = (D) => {
    const k = D.meta.iFim, e = RK.estadoEm(D, k), cods = new Map();
    for (const [c, d] of e.aten) cods.set(c, "aten");
    for (const o of e.pend) cods.set(o.est, o.dir > 0 ? "compra" : "venda");
    if (e.pos) cods.set(e.pos.est, "pos");
    $("barraEst").querySelectorAll("button[data-est]").forEach((b) => {
      const pt = b.querySelector(".ponto"), c = cods.get(b.dataset.est);
      pt.className = "ponto" + (c ? " " + c : " oculto");
      pt.title = c === "pos" ? "em operação" : c === "aten" ? "atenção: setup se formando" : c ? "ordem armada" : "";
    });
  };

  // ---------------------------------------------------------------- aba AO VIVO
  const V = { D: null, seq: 0, velho: true };
  RK.vivo = V;
  async function carregarVivo(silencioso = false) {
    const seq = ++V.seq;
    if (!silencioso) $("carregando").classList.remove("oculto");
    try {
      const D = await RK.json("/api/sim?" + RK.parametros());
      if (seq !== V.seq) return;                      // chegou uma resposta velha: ignora
      const antes = V.D;
      V.D = D; V.velho = false;
      RK.erro("erroVivo", null);
      RK.emit("dadosVivo", D);
      if (RK.aba === "vivo" || !RK.graficoMostra()) RK.mostrar(D, D.meta.iFim, { manterZoom: silencioso });
      renderVivo(D);
      avisarNovidade(antes, D);
    } catch (e) {
      if (seq !== V.seq) return;
      RK.erro("erroVivo", e); RK.toast(e.message, "erro");
    } finally {
      if (seq === V.seq) $("carregando").classList.add("oculto");
    }
  }
  RK.carregarVivo = carregarVivo;

  function assinatura(D) {
    if (!D) return "";
    const e = RK.estadoEm(D, D.meta.iFim);
    return [D.meta.ativo, D.meta.tf, D.meta.est, e.pos ? "p" + e.pos.i_ent : "", e.pend.map((o) => o.est + o.i_sinal).join(","), e.aten.map((a) => a.join("")).join(",")].join("|");
  }
  function avisarNovidade(antes, D) {
    if (!antes || antes.meta.ativo !== D.meta.ativo || antes.meta.tf !== D.meta.tf || antes.meta.est !== D.meta.est) return;
    const a = assinatura(antes), b = assinatura(D);
    if (a === b) return;
    const e = RK.estadoEm(D, D.meta.iFim);
    const card = $("cardVivo"); card.classList.remove("pulso"); void card.offsetWidth; card.classList.add("pulso");
    if (e.pend.length || e.pos) { if (RK.pref.som) { RK.bip(880); setTimeout(() => RK.bip(1180), 250); } }
    else if (e.aten.length && RK.pref.som) RK.bip(520);
    if (document.hidden) document.title = "● Robô Keller";
  }

  function renderVivo(D) {
    const m = D.meta, st = D.stats, k = m.iFim;
    RK.cartaoMomento($("cardVivo"), D, k);
    RK.pontosEst(D);
    // dados atrasados / mercado fechado
    const ultTxt = RK.quando(D, k, true);
    $("statusDados").innerHTML = `<b>${RK.esc(m.nome)}</b><br>${RK.esc(m.fonte)} · último candle ${ultTxt}`;
    // confiabilidade
    const est = m.est, eInfo = RK.cfg.estMap[est];
    const regras = est === "TODAS" ? RK.cfg.estrategias.map((e) => `<li><b>${e.cod} ${RK.esc(e.nome)}</b> — ${RK.esc(e.regras[0])}</li>`).join("")
      : eInfo.regras.map((r) => `<li>${RK.esc(r)}</li>`).join("") + (eInfo.ideal ? `<li><b>Onde funciona melhor:</b> ${RK.esc(eInfo.ideal)}</li>` : "");
    const periodo = `${RK.dataTxt(m.dataIni)} a ${RK.dataTxt(m.dataFim)}`;
    $("confVivo").innerHTML = `<div class="rot">ESSA ESTRATÉGIA AQUI (${RK.esc(m.ativo)} · ${m.nomeTf}) <span class="dir">${periodo}</span></div>
      ${RK.seloVeredito(st)}
      ${st.n ? `<div class="kpis">
        <div><small>Operações</small><b>${st.n}</b></div>
        <div><small>Acerto</small><b>${RK.pct(st.acerto)}</b><em>precisa de ${RK.pct(st.empate)} p/ empatar</em></div>
        <div><small>Média por operação</small><b class="${RK.cls(st.mediaDin)}">${RK.dinheiro(st.mediaDin, D, true)}</b><em>±${RK.dinheiro(st.icDin, D)} · ${RK.R(st.expR)}</em></div>
        <div><small>Resultado</small><b class="${RK.cls(st.total)}">${RK.dinheiro(st.total, D, true)}</b><em>${RK.num(m.contratos, m.fracionado ? 2 : 0)} ${m.fracionado ? "lote(s)" : "contrato(s)"}</em></div>
        <div><small>Pior queda</small><b class="ruim">${RK.dinheiro(-st.ddMax, D)}</b></div>
        <div><small>Média 1ª / 2ª metade</small><b><span class="${RK.cls(st.exp1)}">${RK.dinheiro(st.exp1, D, true)}</span></b><em class="${RK.cls(st.exp2)}">${RK.dinheiro(st.exp2, D, true)}</em></div>
      </div>` : ""}
      <details><summary>Regras ${est === "TODAS" ? "das 6 estratégias" : "de " + RK.esc(eInfo.nome)} · gestão: ${RK.esc(RK.cfg.gestoes[m.gestao])}</summary><ul class="regras">${regras}</ul></details>`;
    // TODAS: uma linha por estratégia
    const tv = $("tabelaVivo");
    if (est === "TODAS" && D.porEst) {
      tv.classList.remove("oculto");
      tv.innerHTML = `<div class="rot">CADA ESTRATÉGIA SOZINHA NESTE ATIVO</div><table class="tab"><tr><th>Estratégia</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Resultado</th><th>Veredito</th></tr>` +
        Object.entries(D.porEst).map(([c, r]) => { const s = r.isolada; return `<tr><td class="nome" title="${RK.esc(RK.nomeEst(c))}">${c} ${RK.esc(RK.nomeEst(c))}</td><td class="n">${s.n}</td><td class="n">${RK.pct(s.acerto)}</td><td class="n ${RK.cls(s.total)}">${RK.dinheiro(s.total, D, true)}</td><td>${RK.seloCurto(s)}</td></tr>`; }).join("") + `</table>`;
    } else tv.classList.add("oculto");
    // contexto Dow (só leitura)
    const seta = (v) => (v === 1 ? '<span class="bom">▲ alta</span>' : v === -1 ? '<span class="ruim">▼ baixa</span>' : '<span class="neutro">■ indefinida</span>');
    $("ctxVivo").innerHTML = D.contexto ? `<div class="rot">CONTEXTO — TEORIA DE DOW <span class="dir neutro">só leitura, não decide entrada</span></div>
      <div class="ctx"><div><b>Semanal</b>${seta(D.contexto.semanal)}</div><div><b>Diário</b>${seta(D.contexto.diario)}</div></div>` : `<div class="rot">CONTEXTO</div><div class="nota">Sem diário para este arquivo.</div>`;
    // últimas operações
    const ult = D.trades.slice(-8).reverse();
    $("ultimosVivo").innerHTML = `<div class="rot">ÚLTIMAS OPERAÇÕES DO ROBÔ</div>` + (ult.length ? `<table class="tab">` +
      ult.map((t) => `<tr class="clic" data-i="${t.i_ent}"><td>${RK.quando(D, t.i_ent)}</td><td>${t.est}</td><td class="${t.dir > 0 ? "bom" : "ruim"}">${t.dir > 0 ? "C" : "V"}</td><td>${RK.esc(t.motivo)}</td><td class="n ${RK.cls(t.R)}">${RK.R(t.R)}</td><td class="n ${RK.cls(t.dinheiro)}">${RK.dinheiro(t.dinheiro, D, true)}</td></tr>`).join("") + `</table>` : `<div class="nota">Nenhuma operação no período.</div>`);
    $("ultimosVivo").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => { if (RK.graficoMostra() !== D) RK.mostrar(D, D.meta.iFim); RK.focar(+tr.dataset.i); }));
  }

  // ---------------------------------------------------------------- abas
  RK.aba = "vivo";
  function trocarAba(nome) {
    RK.aba = nome;
    document.querySelectorAll(".abas button").forEach((b) => b.classList.toggle("on", b.dataset.aba === nome));
    document.querySelectorAll(".aba").forEach((s) => s.classList.toggle("on", s.id === "aba-" + nome));
    $("painel").classList.toggle("largo", nome === "cmp");
    $("painel").classList.toggle("medio", nome === "sim" || nome === "cal");
    if (nome === "vivo") {
      if (V.D && !V.velho) RK.mostrar(V.D, V.D.meta.iFim, { manterZoom: RK.graficoMostra() === V.D });
      else carregarVivo();
    }
    RK.emit("aba", nome);
  }
  RK.trocarAba = trocarAba;
  document.querySelectorAll(".abas button").forEach((b) => (b.onclick = () => trocarAba(b.dataset.aba)));

  // ---------------------------------------------------------------- mudanças no topo
  RK.on("mudou", () => {
    V.velho = true;
    if (RK.aba === "vivo") carregarVivo();
  });
  function ligarTopo() {
    const sa = $("ativo"), st = $("tf"), sg = $("gestao"), sc = $("contratos");
    sa.innerHTML = RK.cfg.ativos.map((a) => `<option value="${RK.esc(a.chave)}">${RK.esc(a.nome)}</option>`).join("");
    st.innerHTML = RK.cfg.tempos.map((t) => `<option value="${t.tf}">${t.nome}${t.periodo ? " (" + t.periodo + ")" : ""}</option>`).join("");
    sg.innerHTML = Object.entries(RK.cfg.gestoes).map(([k, v]) => `<option value="${k}">${RK.esc(v)}</option>`).join("");
    if (!RK.cfg.ativos.some((a) => a.chave === RK.pref.ativo)) RK.pref.ativo = "WIN";
    if (!RK.cfg.tempos.some((t) => +t.tf === +RK.pref.tf)) RK.pref.tf = 5;
    if (!(RK.pref.gestao in RK.cfg.gestoes)) RK.pref.gestao = "padrao";
    if (RK.pref.est !== "TODAS" && !RK.cfg.estMap[RK.pref.est]) RK.pref.est = "E1";
    sa.value = RK.pref.ativo; st.value = RK.pref.tf; sg.value = RK.pref.gestao;
    ajustarContratos();
    const corrigirEst = () => {
      const e = RK.cfg.estMap[RK.pref.est];
      if (e && e.intraday && +RK.pref.tf >= 1440) { RK.pref.est = "TODAS"; RK.toast(`${e.nome} só funciona em gráfico intraday — mudei para TODAS juntas.`, "aviso"); }
      marcarEst();
    };
    corrigirEst();
    sa.onchange = () => { RK.pref.ativo = sa.value; ajustarContratos(); RK.salvarPref(); RK.emit("mudou", "ativo"); };
    st.onchange = () => { RK.pref.tf = +st.value; corrigirEst(); RK.salvarPref(); RK.emit("mudou", "tf"); };
    sg.onchange = () => { RK.pref.gestao = sg.value; RK.salvarPref(); RK.emit("mudou", "gestao"); };
    sc.onchange = () => {
      const a = RK.cfg.ativos.find((x) => x.chave === RK.pref.ativo) || {};
      let v = parseFloat(String(sc.value).replace(",", "."));
      if (!(v > 0)) v = a.fracionado ? 0.01 : 1;
      RK.pref.contratos = a.fracionado ? Math.round(v * 100) / 100 : Math.max(1, Math.round(v));
      sc.value = RK.pref.contratos; RK.salvarPref(); RK.emit("mudou", "contratos");
    };
    $("autoVivo").checked = RK.pref.auto; $("somVivo").checked = RK.pref.som;
    $("autoVivo").onchange = (e) => { RK.pref.auto = e.target.checked; RK.salvarPref(); };
    $("somVivo").onchange = (e) => { RK.pref.som = e.target.checked; RK.salvarPref(); if (e.target.checked) RK.bip(660); };
    $("btAtualizar").onclick = () => carregarVivo();
  }

  // atualização automática (só na aba ao vivo, com a janela visível)
  setInterval(() => { if (RK.cfg && RK.pref.auto && RK.aba === "vivo" && !document.hidden) carregarVivo(true); }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = "Robô Keller";
      if (RK.cfg && RK.aba === "vivo" && RK.pref.auto) carregarVivo(true);
    }
  });
  document.addEventListener("keydown", (e) => {
    const alvo = e.target && e.target.tagName;
    if (alvo === "INPUT" || alvo === "SELECT" || alvo === "TEXTAREA") return;
    RK.emit("tecla", e);
  });
  window.addEventListener("error", (e) => { if (!/ResizeObserver/.test(e.message || "")) RK.toast("Erro na tela: " + e.message, "erro"); });
  window.addEventListener("unhandledrejection", (e) => RK.toast("Erro: " + ((e.reason && e.reason.message) || e.reason), "erro"));

  // ---------------------------------------------------------------- início
  (async function iniciar() {
    try {
      RK.cfg = await RK.json("/api/config");
      RK.cfg.estMap = Object.fromEntries(RK.cfg.estrategias.map((e) => [e.cod, e]));
      // link direto: ?ativo=WIN&tf=5&est=TODAS&gestao=padrao&contratos=1&aba=sim&de=2026-09-01&ate=2026-09-30&acao=simular|replay&passos=40
      const u = new URLSearchParams(location.search);
      for (const k of ["ativo", "est", "gestao"]) if (u.has(k)) RK.pref[k] = u.get(k);
      for (const k of ["tf", "contratos"]) if (u.has(k) && +u.get(k) > 0) RK.pref[k] = +u.get(k);
      montarBarraEst(); ligarTopo();
      RK.emit("config", RK.cfg);
      await carregarVivo();
      const aba = u.get("aba");
      if (["sim", "cmp", "cal", "news"].includes(aba)) trocarAba(aba);
      if (u.get("acao") === "robo") RK.emit("rodarRobo");
      if (aba === "sim" && u.get("acao")) await RK.simDemo({ de: u.get("de"), ate: u.get("ate"), acao: u.get("acao"), passos: +u.get("passos") || 0 });
      if (aba === "cmp" && u.get("acao") === "comparar") $("btComparar").click();
    } catch (e) {
      $("carregando").textContent = "Não consegui iniciar: " + e.message;
    }
  })();
})();
