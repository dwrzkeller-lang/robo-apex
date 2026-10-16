/* ROBÔ APEX: boleta simulada (paper trading ao vivo). Compra e venda na hora, com contratos, stop e alvo, sem dinheiro.
   Quem executa é o robô (boleta.py), com os candles do próprio robô: a mercado, limitada ou stop; stop e alvo da posição;
   preço médio, reduzir, zerar e inverter. As linhas da posição aparecem no gráfico e o stop e o alvo podem ser arrastados. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$, COR = AX.COR;
  const B = { e: null, tipo: "mercado", relogio: null, buscando: false, nHist: null, recolhido: false, drag: null, valor: null };
  try { B.recolhido = localStorage.getItem("apex_boleta_rec") === "1"; } catch (e) { /* ok */ }
  const el = () => $("cardBoleta");
  const meta = () => (AX.vivo.D && AX.vivo.D.meta.ativo === AX.pref.ativo ? AX.vivo.D.meta : null);
  const precoAgora = () => { const D = AX.vivo.D; return D && D.meta.ativo === AX.pref.ativo ? D.c[D.meta.iFim] : null; };
  const posAqui = () => (B.e ? B.e.pos.find((p) => p.ativo === AX.pref.ativo) : null);
  const ordensAqui = () => (B.e ? B.e.ordens.filter((o) => o.ativo === AX.pref.ativo) : []);
  const money = (v, moeda) => AX.dinheiro(v, { meta: { moeda: moeda || (meta() || {}).moeda || "R$" } }, true);
  // amplitude media dos ultimos candles: sugestao de stop (1x) e alvo (2x)
  function sugestao() {
    const D = AX.vivo.D, m = meta();
    if (!D || !m) return null;
    const k = m.iFim, n = Math.min(14, k);
    let s = 0; for (let i = k - n + 1; i <= k; i++) s += D.h[i] - D.l[i];
    const tk = m.tick || Math.pow(10, -m.decimais), a = Math.max(tk, Math.round(s / n / tk) * tk);
    return { stop: +a.toFixed(m.decimais), alvo: +(2 * a).toFixed(m.decimais) };       // sem lixo de vírgula (0,000130000000002)
  }
  const lerNum = (v) => { const x = String(v || "").trim().replace(/\s/g, ""); if (!x) return null; const n = parseFloat(x.replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".")); return n > 0 ? n : NaN; };

  function render() {
    const c = el(); if (!c || !AX.cfg) return;
    const m = meta(), agora = precoAgora();
    if (!m) { c.classList.add("oculto"); return; }
    c.classList.remove("oculto");
    const foco = document.activeElement;
    if (foco && c.contains(foco) && foco.tagName === "INPUT") { pintarDinamico(); return; }       // digitando: só o que muda sozinho
    const atraso = /atraso/.test(m.fonte || "");
    const dec = m.decimais, f = (v) => AX.fmt(v, dec);
    let h = `<div class="rot">BOLETA · SIMULAÇÃO AO VIVO ${AX.q("Compre e venda na hora, como numa corretora, mas sem dinheiro: o robô executa as ordens com os preços de agora e registra o resultado em reais, já com custos. A mercado executa já; limitada espera o preço chegar; stop entra no rompimento. O stop e o alvo da posição também podem ser arrastados no gráfico.")}
      <span class="dir">sem dinheiro <button class="mini-btn" id="bolRec">${B.recolhido ? "abrir ▾" : "recolher ▴"}</button></span></div>`;
    if (B.recolhido) { c.innerHTML = h + resumoPos(); ligar(); return; }
    const sug = sugestao() || { stop: "", alvo: "" }, mem = ((AX.pref.bol || {})[m.ativo]) || {};      // cada ativo lembra os seus valores
    const casas = (v) => {                     // número com as casas do ativo (valores antigos guardados com lixo de vírgula também)
      if (v === "" || v == null) return "";
      const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
      return Number.isFinite(n) && /\d{7,}/.test(String(v).split(/[.,]/)[1] || (typeof v === "number" ? String(v).split(".")[1] || "" : ""))
        ? n.toFixed(m.decimais).replace(".", ",") : String(v).replace(".", ",");
    };
    h += `<div class="bol-topo"><div><small>${AX.esc(AX.rotAtivo(m.ativo))}</small><b id="bolAgora">${agora != null ? f(agora) : "-"}</b>${atraso ? '<em class="alerta">preço com ~15 min de atraso</em>' : ""}</div>
        <div class="seg mini" id="bolTipo">${[["mercado", "A mercado"], ["limite", "Limitada"], ["stop", "Stop"]].map(([k, t]) => `<button data-t="${k}" class="${B.tipo === k ? "on" : ""}">${t}</button>`).join("")}</div></div>
      <div class="bol-grade">
        <label class="campo"><span>${m.fracionado ? "Lotes" : "Contratos"}</span><div class="bol-qtd"><button data-q="-1" type="button">−</button><input id="bolQtd" inputmode="decimal" value="${mem.q || (m.cripto || !m.fracionado ? 1 : 0.01)}"><button data-q="1" type="button">+</button></div></label>
        <label class="campo ${B.tipo === "mercado" ? "oculto" : ""}" id="bolPrecoBox"><span>Preço da ordem</span><input id="bolPreco" inputmode="decimal" value="${agora != null ? String(agora).replace(".", ",") : ""}"></label>
        <label class="campo"><span>Stop (distância)</span><input id="bolStop" inputmode="decimal" placeholder="sem stop" value="${casas(mem.s ?? sug.stop)}"></label>
        <label class="campo"><span>Alvo (distância)</span><input id="bolAlvo" inputmode="decimal" placeholder="sem alvo" value="${casas(mem.a ?? sug.alvo)}"></label>
      </div>
      <div class="bol-risco" id="bolRisco"></div>
      <div class="bol-bts"><button class="bol-compra" id="bolCompra">COMPRAR</button><button class="bol-venda" id="bolVenda">VENDER</button></div>
      ${resumoPos()}
      <div id="bolOrdens">${ordensHtml()}</div>
      <div id="bolHist">${histHtml()}</div>`;
    c.innerHTML = h;
    ligar();
    pintarDinamico();
  }
  function resumoPos() {
    const p = posAqui();
    if (!p) return '<div id="bolPos" class="bol-pos vazio">Sem posição neste ativo.</div>';
    const f = (v) => AX.fmt(v, p.dec);
    return `<div id="bolPos" class="bol-pos ${p.lado > 0 ? "cmp" : "vnd"}">
      <div class="bol-pos-l"><b>${p.lado > 0 ? "COMPRADO" : "VENDIDO"} ${AX.num(p.qtd, p.qtd % 1 ? 2 : 0)}</b> a ${f(p.pm)}
        <span class="bol-res ${AX.cls(p.res)}" id="bolRes">${p.res != null ? money(p.res, p.moeda) : "-"}</span></div>
      <div class="bol-pos-l"><span>stop <b class="ruim">${p.stop != null ? f(p.stop) : "sem"}</b> · alvo <b class="bom">${p.alvo != null ? f(p.alvo) : "sem"}</b></span>
        <span class="bol-pos-bts"><button class="mini-btn" id="bolZerar" data-dica="Fecha a posição inteira pelo preço de agora.">Zerar</button><button class="mini-btn" id="bolInverter" data-dica="Fecha a posição e abre a mesma quantidade do lado contrário, pelo preço de agora.">Inverter</button></span></div>
      <div class="nota">Arraste no gráfico as linhas ⇕ STOP e ⇕ ALVO para mover.</div></div>`;
  }
  function ordensHtml() {
    const os = ordensAqui();
    if (!os.length) return "";
    return `<div class="bol-sub">ORDENS PENDENTES <button class="mini-btn" id="bolCancTudo">cancelar todas</button></div>` + os.map((o) =>
      `<div class="bol-ordem"><span class="${o.lado > 0 ? "bom" : "ruim"}">${o.lado > 0 ? "compra" : "venda"} ${o.tipo === "limite" ? "limitada" : "stop"}</span>
        <span>${AX.num(o.qtd, o.qtd % 1 ? 2 : 0)} a <b>${AX.fmt(o.preco, o.dec)}</b>${o.stop != null ? " · stop " + AX.fmt(o.stop, o.dec) : ""}${o.alvo != null ? " · alvo " + AX.fmt(o.alvo, o.dec) : ""}</span>
        <button class="mini-btn" data-canc="${o.id}">✕</button></div>`).join("");
  }
  function histHtml() {
    const e = B.e; if (!e) return "";
    const somas = (s) => Object.entries(s.por_moeda || {}).map(([mo, v]) => `<b class="${AX.cls(v.res)}">${money(v.res, mo)}</b>`).join(" + ") || "<b>R$ 0,00</b>";
    const ult = e.hist.slice(0, 5);
    return `<div class="bol-sub">RESULTADO DA BOLETA</div>
      <div class="bol-tot"><span>Hoje: ${somas(e.dia)} <em>${e.dia.n} operaç${e.dia.n === 1 ? "ão" : "ões"}</em></span><span>Desde o começo: ${somas(e.total)} <em>${e.total.n}</em></span></div>
      ${ult.map((x) => `<div class="bol-hist"><span>${AX.horaBR(x.t_sai)} ${AX.esc(x.nome)}</span><span class="${x.lado > 0 ? "bom" : "ruim"}">${x.lado > 0 ? "C" : "V"} ${AX.num(x.qtd, x.qtd % 1 ? 2 : 0)}</span>
        <span>${AX.fmt(x.ent, x.dec)} → ${AX.fmt(x.sai, x.dec)}</span><span class="neutro">${AX.esc(x.motivo)}</span><b class="${AX.cls(x.res)}">${money(x.res, x.moeda)}</b></div>`).join("")}
      ${e.hist.length && !e.pos.length && !e.ordens.length ? '<div class="botoes finos"><button id="bolLimpar">Limpar o histórico</button></div>' : ""}`;
  }
  // o que muda a cada poucos segundos sem refazer os campos: preço, risco em reais e resultado da posição
  function pintarDinamico() {
    const m = meta(), agora = precoAgora();
    if (!m) return;
    const a = $("bolAgora"); if (a && agora != null) a.textContent = AX.fmt(agora, m.decimais);
    const p = posAqui(), r = $("bolRes");
    if (p && r && p.res != null) { r.textContent = money(p.res, p.moeda); r.className = "bol-res " + AX.cls(p.res); }
    const rk = $("bolRisco"); if (!rk) return;
    const qtd = lerNum($("bolQtd").value), st = lerNum($("bolStop").value), al = lerNum($("bolAlvo").value);
    const ref = B.tipo === "mercado" ? agora : lerNum($("bolPreco").value);
    if (!(qtd > 0) || !(ref > 0)) { rk.textContent = ""; return; }
    const vp = m.valorPonto || 1, f = (v) => AX.fmt(v, m.decimais);
    const parte = (lado) => [st > 0 ? `stop em ${f(ref - lado * st)} (−${money(st * vp * qtd).replace(/^[+−]/, "")})` : "sem stop",
      al > 0 ? `alvo em ${f(ref + lado * al)} (+${money(al * vp * qtd).replace(/^[+−]/, "")})` : "sem alvo"].join(" · ");
    rk.innerHTML = `<span class="bom">Compra:</span> ${parte(1)}<br><span class="ruim">Venda:</span> ${parte(-1)}`;
  }
  function ligar() {
    const c = el(), m = meta();
    const bt = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    bt("bolRec", () => { B.recolhido = !B.recolhido; try { localStorage.setItem("apex_boleta_rec", B.recolhido ? "1" : "0"); } catch (e) { /* ok */ } render(); });
    c.querySelectorAll("#bolTipo button").forEach((b) => (b.onclick = () => { B.tipo = b.dataset.t; render(); }));
    c.querySelectorAll(".bol-qtd button").forEach((b) => (b.onclick = () => {
      const passo = m && m.fracionado ? 0.01 : 1, v = Math.max(passo, (lerNum($("bolQtd").value) || passo) + passo * +b.dataset.q);
      $("bolQtd").value = m && m.fracionado ? v.toFixed(2).replace(".", ",") : String(Math.round(v)); guardar(); pintarDinamico();
    }));
    for (const id of ["bolQtd", "bolPreco", "bolStop", "bolAlvo"]) { const i = $(id); if (i) { i.oninput = pintarDinamico; i.onchange = guardar; i.onkeydown = (e) => e.stopPropagation(); } }
    bt("bolCompra", () => enviar(1));
    bt("bolVenda", () => enviar(-1));
    bt("bolZerar", () => acao({ acao: "zerar", ativo: AX.pref.ativo }, "Posição zerada."));
    bt("bolInverter", () => acao({ acao: "inverter", ativo: AX.pref.ativo }, "Posição invertida."));
    bt("bolCancTudo", () => acao({ acao: "cancelar_tudo", ativo: AX.pref.ativo }, "Ordens canceladas."));
    bt("bolLimpar", () => { if (confirm("Apagar o histórico da boleta?")) acao({ acao: "limpar" }, "Histórico apagado."); });
    c.querySelectorAll("[data-canc]").forEach((b) => (b.onclick = () => acao({ acao: "cancelar", id: b.dataset.canc }, "Ordem cancelada.")));
  }
  function guardar() {
    const q = $("bolQtd"), s2 = $("bolStop"), a = $("bolAlvo"), m = meta();
    if (!m || !q) return;
    AX.pref.bol = Object.assign({}, AX.pref.bol, { [m.ativo]: { q: q.value, s: s2 ? s2.value : "", a: a ? a.value : "" } });
    AX.salvarPref();
  }
  async function enviar(lado) {
    const m = meta(); if (!m) return;
    const qtd = lerNum($("bolQtd").value), st = lerNum($("bolStop").value), al = lerNum($("bolAlvo").value);
    if (!(qtd > 0)) return AX.toast("Quantidade inválida.", "aviso");
    if (Number.isNaN(st) || Number.isNaN(al)) return AX.toast("Não entendi a distância do stop ou do alvo.", "aviso");
    const ref = B.tipo === "mercado" ? precoAgora() : lerNum($("bolPreco").value);
    if (!(ref > 0)) return AX.toast("Escreva o preço da ordem.", "aviso");
    guardar();
    const p = { acao: "ordem", ativo: m.ativo, lado, tipo: B.tipo, qtd, preco: B.tipo === "mercado" ? null : ref,
      stop: st > 0 ? ref - lado * st : null, alvo: al > 0 ? ref + lado * al : null };
    await acao(p, B.tipo === "mercado" ? `${lado > 0 ? "Compra" : "Venda"} executada.` : `Ordem ${B.tipo === "limite" ? "limitada" : "stop"} enviada.`, lado > 0 ? "entrada" : "entrada");
  }
  async function acao(p, ok, som) {
    try {
      B.e = await AX.post("/api/boleta", p);
      B.nHist = B.e.nHist;
      if (ok) AX.toast(ok, "ok");
      if (som) AX.som(som);
      render(); AX.redesenhar();
    } catch (e) { AX.toast(e.message, "erro"); }
  }
  async function atualizar() {
    if (B.buscando || !AX.cfg || document.hidden) return;
    B.buscando = true;
    try {
      const e = await AX.json("/api/boleta?ativo=" + encodeURIComponent(AX.pref.ativo), { tempo: 15000 });
      if (B.nHist != null && e.nHist > B.nHist) {             // a posição saiu sozinha (stop ou alvo)
        const x = e.hist[0];
        AX.som(x.res > 0 ? "ganho" : "perda");
        AX.toast(`Boleta: ${x.nome} saiu no ${x.motivo}: ${money(x.res, x.moeda)}`, x.res > 0 ? "ok" : "erro");
      }
      const mudou = !B.e || JSON.stringify([B.e.pos.map((p) => [p.ativo, p.qtd, p.pm, p.stop, p.alvo]), B.e.ordens.length, B.e.nHist]) !==
        JSON.stringify([e.pos.map((p) => [p.ativo, p.qtd, p.pm, p.stop, p.alvo]), e.ordens.length, e.nHist]);
      B.e = e; B.nHist = e.nHist;
      if (mudou) { render(); AX.redesenhar(); } else pintarDinamico();
    } catch (e) { /* tenta de novo no próximo */ }
    finally { B.buscando = false; }
  }
  function agendar() {
    clearInterval(B.relogio);
    const ativo = B.e && (B.e.pos.length || B.e.ordens.length);
    B.relogio = setInterval(atualizar, AX.aba === "vivo" && ativo ? 2000 : 8000);
  }

  // ---------------------------------------------------------------- boleta no gráfico, como no Profit
  // Cada linha tem uma etiqueta com "✕": na posição zera, no stop/alvo tira, na ordem cancela. Clique na etiqueta da
  // posição abre o editor (stop, alvo, gestão, zerar, inverter); dois cliques abrem direto na gestão. O stop e o alvo
  // também podem ser arrastados.
  const GEST_BOL = [["", "Manual (você move)"], ["alvo2", "Alvo 2:1"], ["alvo3", "Alvo 3:1"], ["alvo4", "Alvo 4:1"], ["be", "Empate no 1:1 (stop no preço médio)"], ["trail", "Trailing stop (1,5 ATR)"]];
  const linhas = () => {
    const p = posAqui(), out = [];
    if (p) {
      const g = p.gestaoNome && p.gestaoNome !== "manual" ? ` · ${p.gestaoNome}` : "";
      out.push({ tipo: "pm", preco: p.pm, cor: p.lado > 0 ? COR.compra : COR.venda, nome: `${p.lado > 0 ? "COMPRADO" : "VENDIDO"} ${AX.num(p.qtd, p.qtd % 1 ? 2 : 0)} @ `, fim: (p.res != null ? "  " + AX.dinheiro(p.res, { meta: { moeda: p.moeda } }, true) : "") + g, arrasta: false });
      if (p.stop != null) out.push({ tipo: "stop", preco: p.stop, cor: COR.perda, nome: "STOP ", fim: "", arrasta: true });
      if (p.alvo != null) out.push({ tipo: "alvo", preco: p.alvo, cor: COR.ganho, nome: "ALVO ", fim: "", arrasta: true });
    }
    for (const o of ordensAqui()) out.push({ tipo: "ordem", id: o.id, preco: o.preco, cor: "#ff9800", nome: `${o.lado > 0 ? "COMPRA" : "VENDA"} ${o.tipo === "limite" ? "LIMITADA" : "STOP"} ${AX.num(o.qtd, o.qtd % 1 ? 2 : 0)} @ `, fim: "", arrasta: false });
    return out;
  };
  B.rects = [];
  AX.camadas.push((ctx, u) => {
    const D = AX.graficoMostra();
    B.rects = [];
    if (!D || D.meta.ativo !== AX.pref.ativo || AX.emReplay) return;
    for (const L of linhas()) {
      const preco = B.drag && B.drag === L.tipo ? B.valor : L.preco;
      const y = u.y(preco); if (y == null) continue;
      ctx.strokeStyle = L.cor; ctx.lineWidth = L.tipo === "pm" ? 1.5 : 1; ctx.setLineDash(L.tipo === "ordem" ? [6, 4] : L.tipo === "pm" ? [] : [4, 3]);
      ctx.beginPath(); ctx.moveTo(0, Math.round(y) + 0.5); ctx.lineTo(u.W, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = "600 11px -apple-system, Segoe UI, Roboto, sans-serif";
      const txt = L.nome + AX.fmt(preco) + L.fim, w = ctx.measureText(txt).width + 12, x0 = 8, h = 20, wx = 20;
      // etiqueta: fundo da cor da linha + caixinha do ✕
      ctx.fillStyle = L.cor; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, y - h / 2, w + wx, h, 3); else ctx.rect(x0, y - h / 2, w + wx, h); ctx.fill();
      ctx.fillStyle = "rgba(0, 0, 0, .22)"; ctx.fillRect(x0 + w, y - h / 2, wx, h);
      ctx.fillStyle = "#fff"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(txt, x0 + 6, y + 0.5);
      ctx.textAlign = "center"; ctx.fillText("✕", x0 + w + wx / 2, y + 0.5);
      B.rects.push({ L, x0, y0: y - h / 2, x1: x0 + w, xX: x0 + w + wx, y1: y + h / 2 });
    }
  });
  const area = $("areaGrafico"), graf = $("chart");
  function pontoNoGraf(e) { const r = graf.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top, ok: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom }; }
  function rotuloSob(e) {
    if (AX.emReplay || (AX.desenho && AX.desenho.ferramenta() !== "cursor")) return null;
    const p = pontoNoGraf(e); if (!p.ok) return null;
    for (const r of B.rects) if (p.y >= r.y0 && p.y <= r.y1 && p.x >= r.x0 && p.x <= r.xX) return { r, noX: p.x > r.x1 };
    return null;
  }
  function linhaSob(e) {
    if (!posAqui() || AX.emReplay || !graf.contains(e.target) || (AX.desenho && AX.desenho.ferramenta() !== "cursor")) return null;
    if (AX.replay && AX.replay.editando && AX.replay.editando()) return null;
    const y = pontoNoGraf(e).y;
    let melhor = null, dmin = 7;
    for (const L of linhas()) {
      if (!L.arrasta) continue;
      const yy = AX.S.candle.priceToCoordinate(L.preco);
      if (yy != null && Math.abs(yy - y) < dmin) { dmin = Math.abs(yy - y); melhor = L.tipo; }
    }
    return melhor;
  }
  async function clicarX(L) {
    if (L.tipo === "pm") { if (confirm("Zerar a posição da boleta agora, a mercado?")) await acao({ acao: "zerar", ativo: AX.pref.ativo }, "Posição zerada.", "perda"); }
    else if (L.tipo === "ordem") await acao({ acao: "cancelar", id: L.id, ativo: AX.pref.ativo }, "Ordem cancelada.");
    else await acao({ acao: "mover", ativo: AX.pref.ativo, [L.tipo]: null }, L.tipo === "stop" ? "Stop retirado." : "Alvo retirado.");
    AX.redesenhar();
  }
  // editor da posição (clique na etiqueta)
  let editor = null;
  function fecharEditor() { if (editor) { editor.remove(); editor = null; } }
  function abrirEditor(r, focoGestao) {
    const p = posAqui(); if (!p) return;
    fecharEditor();
    const m = meta(), f = (v) => (v == null ? "" : AX.fmt(v, m ? m.decimais : p.dec).replace(/\./g, ""));
    editor = document.createElement("div");
    editor.className = "bol-editor";
    editor.innerHTML = `<div class="be-cab"><b>${p.lado > 0 ? "Comprado" : "Vendido"} ${AX.num(p.qtd, p.qtd % 1 ? 2 : 0)} @ ${AX.fmt(p.pm, p.dec)}</b>
        <span class="${AX.cls(p.res)}">${p.res != null ? AX.dinheiro(p.res, { meta: { moeda: p.moeda } }, true) : ""}</span><button class="be-x" aria-label="Fechar">✕</button></div>
      <div class="be-grade"><label class="campo"><span>Stop (preço)</span><input id="beStop" inputmode="decimal" value="${f(p.stop)}" placeholder="sem stop"></label>
        <label class="campo"><span>Alvo (preço)</span><input id="beAlvo" inputmode="decimal" value="${f(p.alvo)}" placeholder="sem alvo"></label></div>
      <label class="campo"><span>Gestão da posição ${AX.q("Alvo 2:1, 3:1 ou 4:1 = o alvo fica a 2, 3 ou 4 vezes a distância até o stop. Empate = quando o preço anda 1 vez o risco a favor, o stop vai para o preço médio. Trailing = o stop acompanha o preço a 1,5 ATR, só andando a favor. O robô confere no fechamento de cada candle.")}</span>
        <select id="beGest">${GEST_BOL.map(([k, t]) => `<option value="${k}"${(p.gestao || (p.gestaoNome && p.gestaoNome.startsWith("alvo") ? "alvo" + p.gestaoNome.slice(5, 6) : "")) === k ? " selected" : ""}>${t}</option>`).join("")}</select></label>
      <div class="be-bts"><button class="primario" id="beSalvar">Salvar</button><button id="beInv">Inverter</button><button class="perigo" id="beZerar">Zerar</button></div>`;
    area.appendChild(editor);
    const ar = area.getBoundingClientRect(), gr = graf.getBoundingClientRect();
    editor.style.left = Math.min(ar.width - 300, gr.left - ar.left + r.xX + 8) + "px";
    editor.style.top = Math.max(8, Math.min(ar.height - 230, gr.top - ar.top + r.y0 - 10)) + "px";
    for (const i of editor.querySelectorAll("input, select")) i.onkeydown = (e) => { e.stopPropagation(); if (e.key === "Escape") fecharEditor(); if (e.key === "Enter") $("beSalvar").click(); };
    editor.querySelector(".be-x").onclick = fecharEditor;
    $("beZerar").onclick = async () => { fecharEditor(); await acao({ acao: "zerar", ativo: AX.pref.ativo }, "Posição zerada.", "perda"); AX.redesenhar(); };
    $("beInv").onclick = async () => { fecharEditor(); await acao({ acao: "inverter", ativo: AX.pref.ativo }, "Posição invertida."); AX.redesenhar(); };
    $("beSalvar").onclick = async () => {
      const st = lerNum($("beStop").value), al = lerNum($("beAlvo").value), g = $("beGest").value;
      if (Number.isNaN(st) || Number.isNaN(al)) return AX.toast("Não entendi o preço do stop ou do alvo.", "aviso");
      const mud = {};
      if ((st ?? null) !== (p.stop ?? null)) mud.stop = st;
      if ((al ?? null) !== (p.alvo ?? null) && !g.startsWith("alvo")) mud.alvo = al;
      if (Object.keys(mud).length) await acao(Object.assign({ acao: "mover", ativo: AX.pref.ativo }, mud), "Stop e alvo salvos.");
      if (g !== (p.gestao || "") || g.startsWith("alvo")) await acao({ acao: "gestao", ativo: AX.pref.ativo, gestao: g }, "Gestão: " + GEST_BOL.find((x) => x[0] === g)[1] + ".");
      fecharEditor(); AX.redesenhar();
    };
    setTimeout(() => (focoGestao ? $("beGest") : $("beStop")).focus(), 30);
  }
  area.addEventListener("dblclick", (e) => {
    const hit = rotuloSob(e);
    if (!hit || hit.noX || hit.r.L.tipo !== "pm") return;
    e.preventDefault(); e.stopImmediatePropagation();
    abrirEditor(hit.r, true);
  }, true);
  area.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || B.drag) return;
    if (editor && !editor.contains(e.target)) fecharEditor();
    const hit = rotuloSob(e);
    if (hit && (hit.noX || hit.r.L.tipo === "pm" || hit.r.L.tipo === "ordem")) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (hit.noX) clicarX(hit.r.L);
      else if (hit.r.L.tipo === "pm") abrirEditor(hit.r, false);
      return;
    }
    const tipo = hit ? hit.r.L.tipo : linhaSob(e); if (!tipo || !["stop", "alvo"].includes(tipo)) return;
    e.preventDefault(); e.stopImmediatePropagation();
    B.drag = tipo; B.valor = posAqui()[tipo];
    try { area.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    area.style.cursor = "ns-resize";
  }, true);
  area.addEventListener("pointermove", (e) => {
    if (!B.drag) {
      if (e.buttons) return;
      // só mexe no cursor por causa da boleta (o editor da operação e os desenhos também usam o cursor)
      const c = rotuloSob(e) ? "pointer" : linhaSob(e) ? "ns-resize" : null;
      if (c) { area.style.cursor = c; B.cursor = true; } else if (B.cursor) { area.style.cursor = ""; B.cursor = false; }
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.buttons) { soltar(e); return; }
    const r = graf.getBoundingClientRect(), pr = AX.S.candle.coordinateToPrice(e.clientY - r.top), m = meta();
    if (pr == null || !m) return;
    const tk = m.tick || Math.pow(10, -m.decimais);
    B.valor = +(Math.round(pr / tk) * tk).toFixed(m.decimais + 2);
    AX.redesenhar();
  }, true);
  async function soltar(e) {
    if (!B.drag) return;
    if (e) e.stopImmediatePropagation();
    const tipo = B.drag, v = B.valor;
    B.drag = null; area.style.cursor = "";
    await acao({ acao: "mover", ativo: AX.pref.ativo, [tipo]: v }, tipo === "stop" ? "Stop movido." : "Alvo movido.");
    AX.redesenhar();
  }
  area.addEventListener("pointerup", soltar, true);
  area.addEventListener("pointercancel", soltar, true);
  area.addEventListener("click", (e) => { if (B.drag) e.stopImmediatePropagation(); }, true);

  AX.on("config", () => { atualizar().then(() => { render(); agendar(); }); });
  AX.on("dadosVivo", () => { if (!B.e) return; pintarDinamico(); });
  AX.on("tecla", (e) => { if (e.key === "Escape") fecharEditor(); });
  AX.on("mudou", fecharEditor);
  AX.on("mudou", (o) => { if (o === "ativo" || o === "tf") { B.e && render(); atualizar(); } });
  AX.on("carregado", () => render());
  AX.on("aba", () => agendar());
  setInterval(agendar, 15000);
  AX.boleta = { render, atualizar, posicao: () => posAqui() };
})();
