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
    som: true, auto: true, per: "1m", de: "", ate: "" };
  RK.pref = Object.assign({}, PADRAO);
  try { Object.assign(RK.pref, JSON.parse(localStorage.getItem("rk_pref") || "{}")); } catch (e) { /* sem armazenamento */ }
  RK.salvarPref = () => { try { localStorage.setItem("rk_pref", JSON.stringify(RK.pref)); } catch (e) { /* ok */ } };
  const PERIODOS = { hoje: "hoje", "5d": "5 dias", "1m": "1 mês", "3m": "3 meses", tudo: "tudo", custom: "datas" };
  if (!(RK.pref.per in PERIODOS)) RK.pref.per = "1m";

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
    const it = (cor, nome, v) => (v == null ? "" : `<span><i style="background:${cor}"></i>${nome} ${RK.fmt(v)}</span>`);
    $("legenda").innerHTML = `<span><b>${RK.esc(D.meta.ativo)}</b> · ${D.meta.nomeTf} · ${RK.quando(D, k, true)}</span>` +
      `<span>A ${RK.fmt(D.o[k])} · M ${RK.fmt(D.h[k])} · m ${RK.fmt(D.l[k])} · F ${RK.fmt(D.c[k])}</span>` +
      it(COR.mm9, "MM9", D.mm9[k]) + it(COR.mm20, "MM20", D.mm20[k]) + it(COR.mm200, "MM200", D.mm200[k]) + (D.vw ? it(COR.vw, "VWAP", D.vw[k]) : "");
  }

  // janela visível = o período escolhido no topo (no máximo ~900 candles, senão o gráfico vira um borrão)
  RK.mostrarPeriodo = (D) => {
    const m = D.meta, ini = Math.max(m.iIni, m.iFim - 900);
    chart.timeScale().setVisibleLogicalRange({ from: ini - 2, to: m.iFim + 6 });
  };
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
    else if (!manterZoom || trocouAtivo) {
      if (k === D.meta.iFim) RK.mostrarPeriodo(D);
      else chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, k - 140), to: k + 8 });
    }
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

  // cartão "o que fazer agora" (ao vivo, fim do período e replay)
  RK.cartaoMomento = (el, D, k) => {
    const e = RK.estadoEm(D, k), m = D.meta, q = m.contratos;
    const hist = k === m.iFim && !m.aoVivo;
    const riscoTxt = (pts) => `${RK.fmt(pts)} pts = ${RK.dinheiro(pts * m.valorPonto * q + 2 * m.custo * q, D)}`;
    const tr = (cor, nome, v, extra = "") => `<tr><td><span class="sw" style="background:${cor}"></span>${nome}</td><td>${RK.fmt(v)}</td><td>${extra}</td></tr>`;
    let cls = "", html = "";
    const quem = (cod) => `<div class="quem">${RK.esc(cod)} · ${RK.esc(RK.nomeEst(cod))}${hist ? `<span class="tag-hist">FIM DO PERÍODO · ${RK.quando(D, k, true)}</span>` : ""}</div>`;
    const saiu = e.saidas.length ? `<div class="detalhe">Neste candle saiu: ${e.saidas.map((t) => `${t.est} ${RK.dirTxt(t.dir).toLowerCase()} <b class="${RK.cls(t.R)}">${RK.R(t.R)}</b> (${RK.esc(t.motivo)})`).join(" · ")}</div>` : "";
    if (e.pos) {
      const p = e.pos, R = p.Ragora;
      cls = "pos";
      html = `<div class="estado">${p.dir > 0 ? "COMPRADO" : "VENDIDO"} <span class="${RK.cls(R)}">${RK.R(R)}</span></div>${quem(p.est)}
        <div class="detalhe">Entrou em ${RK.quando(D, p.i_ent)}${p.parcial ? " · <b>parcial feita, stop no 0x0</b>" : ""}${p.sair ? " · <b>sai na abertura do próximo candle</b> (" + RK.esc(p.sair) + ")" : ""}</div>
        <table>${tr("#fff", "Entrada", p.ent)}${tr(COR.perda, p.stopAgora != null && p.stopAgora !== p.stop ? "Stop (movido)" : "Stop", p.stopAgora ?? p.stop, riscoTxt(p.risco))}${p.alvo != null ? tr(COR.ganho, "Alvo", p.alvo) : ""}</table>${saiu}`;
    } else if (e.pend.length) {
      const o = e.pend[e.pend.length - 1];
      const ref = o.gatilho ?? D.c[k], risco = Math.abs(ref - o.stop);
      cls = o.dir > 0 ? "compra" : "venda";
      const quando = o.gatilho == null ? "a mercado na abertura do próximo candle" : `${o.dir > 0 ? "acima de" : "abaixo de"} ${RK.fmt(o.gatilho)}`;
      const razao = o.alvo != null && risco ? Math.abs(o.alvo - ref) / risco : null;
      html = `<div class="estado">${o.dir > 0 ? "COMPRA ARMADA" : "VENDA ARMADA"}</div>${quem(o.est)}
        <div class="detalhe">${RK.dirTxt(o.dir)} ${quando} · vale ${o.validade} candle(s)${o.info ? " · " + RK.esc(o.info) : ""}</div>
        <table>${tr(o.dir > 0 ? COR.compra : COR.venda, "Entrada", ref)}${tr(COR.perda, "Stop", o.stop, riscoTxt(risco))}${o.alvo != null ? tr(COR.ganho, `Alvo${razao ? " " + RK.num(razao, 1) + ":1" : ""}`, o.alvo, "+" + RK.dinheiro(Math.abs(o.alvo - ref) * m.valorPonto * q, D)) : `<tr><td colspan="3" class="neutro">Saída: ${RK.esc(RK.cfg.gestoes[o.gestao] || o.gestao)}</td></tr>`}</table>
        ${e.pend.length > 1 ? `<div class="detalhe">+${e.pend.length - 1} outra(s) ordem(ns): ${e.pend.slice(0, -1).map((x) => x.est + " " + RK.dirTxt(x.dir).toLowerCase()).join(", ")} — a primeira que executar vale.</div>` : ""}${saiu}`;
    } else if (e.aten.length) {
      const [cod, dir] = e.aten[0];
      cls = "aten";
      html = `<div class="estado">ATENÇÃO: ${dir > 0 ? "COMPRA" : "VENDA"} SE FORMANDO</div>${quem(cod)}
        <div class="detalhe">Aguardando: ${RK.esc((RK.cfg.estMap[cod] || {}).aguardando || "")}. Ainda <b>não</b> é sinal.</div>${saiu}`;
    } else {
      html = `<div class="estado">AGUARDANDO SETUP</div><div class="detalhe">${m.est === "TODAS" ? "Nenhuma estratégia" : RK.esc(RK.nomeEst(m.est)) + " não"} tem setup ${hist ? "no fim do período (" + RK.quando(D, k, true) + ")" : "agora"}.</div>${saiu}`;
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
    for (const [k, v] of Object.entries(extra)) q.set(k, v);
    return q.toString();
  };
  RK.periodoTexto = (D) => (D ? `${RK.dataCurta(D.meta.dataIni)} a ${RK.dataCurta(D.meta.dataFim)}` : PERIODOS[RK.pref.per]);

  // ---------------------------------------------------------------- topo
  function ajustarContratos() {
    const a = RK.cfg.ativos.find((x) => x.chave === RK.pref.ativo) || {};
    const inp = $("contratos");
    inp.step = a.fracionado ? "0.01" : "1"; inp.min = a.fracionado ? "0.01" : "1";
    $("rotContratos").textContent = a.fracionado ? "Lotes" : "Contratos";
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
    const curto = (n) => {                  // "Mini Índice (WIN) - proxy: ..." -> "Mini Índice (WIN)"; nome completo no title
      let c = n.split(" - ")[0].replace(/\s*\(hor.*$/, "").trim();
      if ((c.match(/\(/g) || []).length > (c.match(/\)/g) || []).length) c = c.split("(")[0].trim();
      return c;
    };
    sa.innerHTML = RK.cfg.ativos.map((a) => `<option value="${RK.esc(a.chave)}" title="${RK.esc(a.nome)}">${RK.esc(curto(a.nome))}</option>`).join("");
    st.innerHTML = RK.cfg.tempos.map((t) => `<option value="${t.tf}">${t.nome}</option>`).join("");
    sg.innerHTML = Object.entries(RK.cfg.gestoes).map(([k, v]) => `<option value="${k}">${RK.esc(v)}</option>`).join("");
    if (!RK.cfg.ativos.some((a) => a.chave === RK.pref.ativo)) RK.pref.ativo = "WIN";
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
      const a = RK.cfg.ativos.find((x) => x.chave === RK.pref.ativo) || {};
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
      RK.pref.capital = v > 0 ? v : 10000; $("capital").value = RK.pref.capital; RK.salvarPref(); RK.emit("mudou", "capital");
    };
    $("maxstops").onchange = () => {
      const v = parseInt($("maxstops").value, 10);
      RK.pref.maxstops = v > 0 ? Math.min(20, v) : 2; $("maxstops").value = RK.pref.maxstops; RK.salvarPref(); RK.emit("mudou", "maxstops");
    };
    $("autoVivo").onchange = (e) => { RK.pref.auto = e.target.checked; RK.salvarPref(); };
    $("somVivo").onchange = (e) => { RK.pref.som = e.target.checked; RK.salvarPref(); if (e.target.checked) RK.bip(660); };
    $("btAtualizar").onclick = () => { RK.fecharPopovers(); carregarVivo(); };
    $("btRobo").onclick = () => RK.emit("rodarRobo");
    document.addEventListener("pointerdown", (e) => {
      if (!e.target.closest(".popover") && !e.target.closest("#btAjustes") && !e.target.closest("#periodo")) RK.fecharPopovers();
    });
  }

  // ---------------------------------------------------------------- aba AO VIVO
  const V = { D: null, seq: 0, velho: true };
  RK.vivo = V;
  async function carregarVivo(silencioso = false) {
    const seq = ++V.seq;
    if (!silencioso) $("carregando").classList.remove("oculto");
    try {
      const D = await RK.json("/api/sim?" + RK.parametros());
      if (seq !== V.seq) return false;                 // chegou uma resposta velha: ignora
      const antes = V.D;
      V.D = D; V.velho = false;
      RK.erro("erroVivo", null);
      if (RK.aba === "vivo" || RK.aba === "cal" || !RK.graficoMostra()) RK.mostrar(D, D.meta.iFim, { manterZoom: silencioso });
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

  function assinatura(D) {
    if (!D) return "";
    const e = RK.estadoEm(D, D.meta.iFim);
    return [D.meta.ativo, D.meta.tf, D.meta.est, e.pos ? "p" + e.pos.i_ent : "", e.pend.map((o) => o.est + o.i_sinal).join(","), e.aten.map((a) => a.join("")).join(",")].join("|");
  }
  function avisarNovidade(antes, D) {
    if (!antes || !D.meta.aoVivo || antes.meta.ativo !== D.meta.ativo || antes.meta.tf !== D.meta.tf || antes.meta.est !== D.meta.est) return;
    if (assinatura(antes) === assinatura(D)) return;
    const e = RK.estadoEm(D, D.meta.iFim);
    const card = $("cardVivo"); card.classList.remove("pulso"); void card.offsetWidth; card.classList.add("pulso");
    if (RK.pref.som && (e.pend.length || e.pos)) { RK.bip(880); setTimeout(() => RK.bip(1180), 250); }
    else if (RK.pref.som && e.aten.length) RK.bip(520);
    if (document.hidden) document.title = "● Robô Keller";
  }

  function renderVivo(D) {
    const m = D.meta, st = D.stats, k = m.iFim;
    RK.cartaoMomento($("cardVivo"), D, k);
    // status no topo
    const dt = RK.quando(D, D.meta.ultimo, true);
    $("statusDados").innerHTML = m.aoVivo ? `<i class="luz vivo"></i><span>ao vivo · último candle ${dt}</span>` : `<i class="luz hist"></i><span>histórico · até ${RK.dataTxt(m.dataFim)}</span>`;
    $("statusDados").title = m.fonte;
    // resumo do período
    const est = m.est, eInfo = RK.cfg.estMap[est];
    const regras = est === "TODAS" ? RK.cfg.estrategias.map((e) => `<li><b>${e.cod} ${RK.esc(e.nome)}</b> — ${RK.esc(e.regras[0])}</li>`).join("")
      : eInfo.regras.map((r) => `<li>${RK.esc(r)}</li>`).join("") + (eInfo.ideal ? `<li><b>Onde funciona melhor:</b> ${RK.esc(eInfo.ideal)}</li>` : "");
    const seta = (v) => (v === 1 ? '<span class="bom">▲ alta</span>' : v === -1 ? '<span class="ruim">▼ baixa</span>' : '<span class="neutro">■ indefinida</span>');
    const ctx = D.contexto ? `<span>Dow (só leitura): semanal ${seta(D.contexto.semanal)} · diário ${seta(D.contexto.diario)}</span>` : "";
    const lote = m.fracionado ? "lote(s)" : "contrato(s)";
    let html = `<div class="rot">NO PERÍODO · ${RK.esc(RK.nomeEst(est))}<span class="dir">${RK.dataTxt(m.dataIni)} a ${RK.dataTxt(m.dataFim)}</span></div>`;
    if (st.n) {
      html += `<div class="resumo-topo"><div><div class="grande ${RK.cls(st.total)}">${RK.dinheiro(st.total, D, true)}</div>
          <div class="sub">${st.n} operações · acerto ${RK.pct(st.acerto, 0)} (empata com ${RK.pct(st.empate, 0)}) · ${RK.num(m.contratos, m.fracionado ? 2 : 0)} ${lote}</div></div>${RK.seloCurto(st)}</div>
        <canvas class="spark" id="sparkVivo"></canvas>
        <div class="kpis">
          <div><small>Média por operação</small><b class="${RK.cls(st.mediaDin)}">${RK.dinheiro(st.mediaDin, D, true)}</b><em>± ${RK.dinheiro(st.icDin, D)}</em></div>
          <div><small>Pior queda</small><b class="ruim">${RK.dinheiro(-st.ddMax, D)}</b><em>${RK.pct(st.ddPct, 0)} do pico</em></div>
          <div><small>Ganho ÷ perda</small><b>${RK.num(st.payoff, 2)}</b><em>fator de lucro ${RK.num(st.fatorLucro, 2)}</em></div>
        </div>`;
    } else {
      html += `<div class="resumo-topo"><div><div class="grande neutro">sem operações</div><div class="sub">nenhum setup desta estratégia no período escolhido</div></div>${RK.seloCurto(st)}</div>`;
    }
    html += `<div class="linha-ctx">${ctx}</div>
      <details><summary>Como ler · regras · detalhes</summary>
        <div class="nota">${RK.esc(st.explica || "")}${st.n ? ` Média na 1ª metade: ${RK.dinheiro(st.exp1, D, true)} · na 2ª: ${RK.dinheiro(st.exp2, D, true)}.` : ""}</div>
        <ul class="regras">${regras}</ul>
        <div class="nota">Gestão: ${RK.esc(RK.cfg.gestoes[m.gestao])}. Custos: escorregamento de ${RK.fmt(m.slip)} por lado + ${RK.dinheiro(m.custo, D)} por ${m.fracionado ? "lote" : "contrato"} por lado. Fonte: ${RK.esc(m.fonte)}.</div>
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
  function trocarAba(nome) {
    RK.aba = nome;
    document.querySelectorAll(".abas button").forEach((b) => b.classList.toggle("on", b.dataset.aba === nome));
    document.querySelectorAll(".aba").forEach((s) => s.classList.toggle("on", s.id === "aba-" + nome));
    $("painel").classList.toggle("largo", nome === "cmp");
    $("painel").classList.toggle("medio", nome === "sim" || nome === "cal");
    if (nome === "vivo" || nome === "cal") {
      if (V.D && !V.velho) { if (RK.graficoMostra() !== V.D) RK.mostrar(V.D, V.D.meta.iFim); if (nome === "vivo") renderVivo(V.D); }
      else RK.carregarVivo();
    }
    RK.emit("aba", nome);
  }
  RK.trocarAba = trocarAba;
  document.querySelectorAll(".abas button").forEach((b) => (b.onclick = () => trocarAba(b.dataset.aba)));
  window.addEventListener("resize", () => { if (V.D && RK.aba === "vivo") RK.sparkline($("sparkVivo"), V.D.trades.map((t) => t.dinheiro)); });

  RK.on("mudou", () => {
    V.velho = true;
    if (RK.aba === "vivo" || RK.aba === "cal") RK.carregarVivo();
  });

  // atualização automática (período que chega até hoje, aba ao vivo, janela visível)
  setInterval(() => {
    if (RK.cfg && RK.pref.auto && RK.aba === "vivo" && !document.hidden && V.D && V.D.meta.aoVivo) RK.carregarVivo(true);
  }, 60000);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      document.title = "Robô Keller";
      if (RK.cfg && RK.aba === "vivo" && RK.pref.auto && V.D && V.D.meta.aoVivo) RK.carregarVivo(true);
    }
  });
  document.addEventListener("keydown", (e) => {
    const alvo = e.target && e.target.tagName;
    if (alvo === "INPUT" || alvo === "SELECT" || alvo === "TEXTAREA") return;
    if (e.key === "Escape") RK.fecharPopovers();
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
      RK.cfg = await RK.json("/api/config");
      RK.cfg.estMap = Object.fromEntries(RK.cfg.estrategias.map((e) => [e.cod, e]));
      // link direto: ?ativo=WIN&tf=5&est=TODAS&per=5d&aba=sim&acao=simular|replay|robo&passos=40
      const u = new URLSearchParams(location.search);
      for (const k of ["ativo", "est", "gestao", "per"]) if (u.has(k)) RK.pref[k] = u.get(k);
      for (const k of ["tf", "contratos"]) if (u.has(k) && +u.get(k) > 0) RK.pref[k] = +u.get(k);
      if (u.has("de") && u.has("ate")) { RK.pref.per = "custom"; RK.pref.de = u.get("de"); RK.pref.ate = u.get("ate"); }
      if (!(RK.pref.per in PERIODOS)) RK.pref.per = "1m";
      ligarTopo();
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
      const aba = u.get("aba");
      if (["sim", "cmp", "cal", "news"].includes(aba)) trocarAba(aba);
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
