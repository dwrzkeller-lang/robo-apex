/* ROBÔ KELLER — operações: (1) desenha cada operação no gráfico (entrada, stop, alvo, saída); (2) lista as operações
   na aba Ao vivo e explica passo a passo como cada uma foi feita; (3) TESTE AO VIVO: liga uma estratégia em modo
   simulado (sem dinheiro) a partir de agora e acompanha as operações dela, com som, mesmo olhando outro ativo. */
(() => {
  "use strict";
  const RK = window.RK, $ = RK.$, COR = RK.COR;
  const chave = (t) => t.est + "|" + t.t_ent;
  let SEL = null;                     // operação clicada: { chave, tr, ativo, tf }

  // ================================================================ 1. operações no gráfico
  function indices(D, t) {            // candles do sinal, da entrada e da saída no gráfico mostrado
    if (t.i_ent != null && D.t[t.i_ent] === t.t_ent) return { s: t.i_sinal, e: t.i_ent, x: t.i_sai ?? null };
    const e = RK.idxT(D, t.t_ent);
    if (e < 0) return null;
    return { s: RK.idxT(D, t.t_sinal), e, x: t.t_sai != null ? RK.idxT(D, t.t_sai) : null };
  }
  function etiqueta(ctx, txt, x, y, cor, alinhar = "left") {
    ctx.font = "11px Segoe UI, system-ui"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const w = ctx.measureText(txt).width, x0 = alinhar === "right" ? x - w : alinhar === "center" ? x - w / 2 : x;
    ctx.fillStyle = "rgba(11,14,20,.88)"; ctx.fillRect(x0 - 3, y - 8, w + 6, 16);
    ctx.fillStyle = cor; ctx.fillText(txt, x0, y);
  }
  function desenhar(ctx, u, D, t, completo, sel) {
    const ix = indices(D, t), k = RK.i;
    if (!ix || ix.e > k) return;
    const aberta = ix.x == null || ix.x < 0 || ix.x > k;
    const xe = u.x(ix.e), xf = u.x(aberta ? k : ix.x);
    if (xe == null || xf == null) return;
    const x2 = Math.max(xf, xe + 8);
    if (x2 < -40 || xe > u.W + 40) return;
    const stop = t.stop_ini ?? t.stop, precoFim = aberta ? D.c[k] : t.sai;
    // alvo muito longe (ex.: 10:1 do ORB): fora da operação clicada a faixa verde vai só até 3x o risco, sem a linha
    const longe = !sel && t.alvo != null && t.risco > 0 && Math.abs(t.alvo - t.ent) > 3 * t.risco;
    const yE = u.y(t.ent), yS = u.y(stop), yA = t.alvo == null ? null : u.y(longe ? t.ent + t.dir * 3 * t.risco : t.alvo), yX = u.y(precoFim);
    if (yE == null || yX == null) return;
    const ganho = aberta ? t.dir * (precoFim - t.ent) > 0 : t.R > 0, cor = ganho ? COR.ganho : COR.perda;
    if (completo || sel) {
      const a = sel ? 0.17 : 0.08;
      if (yS != null) { ctx.fillStyle = `rgba(255,92,110,${a})`; ctx.fillRect(xe, Math.min(yE, yS), x2 - xe, Math.abs(yS - yE)); }
      if (yA != null) { ctx.fillStyle = `rgba(34,227,154,${a})`; ctx.fillRect(xe, Math.min(yE, yA), x2 - xe, Math.abs(yA - yE)); }
      const reta = (y, c, traco) => { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash(traco ? [4, 3] : []); ctx.beginPath(); ctx.moveTo(xe, Math.round(y) + 0.5); ctx.lineTo(x2, Math.round(y) + 0.5); ctx.stroke(); };
      ctx.globalAlpha = sel ? 1 : 0.6;
      reta(yE, "#d9e0ea", false);
      if (yS != null) reta(yS, COR.perda, true);
      if (yA != null && !longe) reta(yA, COR.ganho, true);
      ctx.globalAlpha = 1;
    }
    // caminho: da entrada até a saída (ou até o preço atual, se ainda está aberta)
    ctx.strokeStyle = cor; ctx.lineWidth = sel ? 2 : 1.5; ctx.setLineDash(sel ? [] : [5, 3]);
    ctx.beginPath(); ctx.moveTo(xe, yE); ctx.lineTo(x2, yX); ctx.stroke(); ctx.setLineDash([]);
    if (!sel) return;
    for (const [x, y] of [[xe, yE], [x2, yX]]) { ctx.fillStyle = "#0b0e14"; ctx.beginPath(); ctx.arc(x, y, 4, 0, 7); ctx.fill(); ctx.strokeStyle = cor; ctx.lineWidth = 2; ctx.stroke(); }
    const xs = ix.s >= 0 && ix.s <= k ? u.x(ix.s) : null;  // candle de sinal
    const borda = Math.min(xe, xs ?? xe) - 12;             // textos à esquerda do candle de sinal; se não couber, por dentro
    const esq = borda > 150;
    const X = esq ? borda : xe + 6, al = esq ? "right" : "left";
    etiqueta(ctx, `${t.dir > 0 ? "COMPRA" : "VENDA"} ${RK.fmt(t.ent)}`, X, yE, "#fff", al);
    if (yS != null && Math.abs(yS - yE) > 14) etiqueta(ctx, `STOP ${RK.fmt(stop)}`, X, yS, COR.perda, al);
    if (yA != null && Math.abs(yA - yE) > 14) etiqueta(ctx, `ALVO ${RK.fmt(t.alvo)}`, X, yA, COR.ganho, al);
    const fimTxt = aberta ? `agora ${RK.R((t.dir * (precoFim - t.ent)) / t.risco)}` : `SAÍDA ${RK.fmt(t.sai)} · ${RK.R(t.R)}`;
    const dir = x2 + 8 + 130 < u.W;
    etiqueta(ctx, fimTxt, dir ? x2 + 8 : x2 - 8, yX, cor, dir ? "left" : "right");
    if (xs != null) {                                      // triângulo amarelo no candle de sinal, do lado oposto ao da entrada
      const ys = u.y(t.dir > 0 ? D.l[ix.s] : D.h[ix.s]);
      if (ys != null) {
        const s = t.dir > 0 ? 1 : -1, y0 = ys + s * 5;
        ctx.fillStyle = "#ffd23f"; ctx.beginPath(); ctx.moveTo(xs, y0); ctx.lineTo(xs - 5, y0 + s * 8); ctx.lineTo(xs + 5, y0 + s * 8); ctx.closePath(); ctx.fill();
      }
    }
  }
  RK.camadas.push((ctx, u) => {
    const D = RK.graficoMostra(); if (!D) return;
    const modo = RK.ind ? RK.ind.ops() : "detalhe", k = RK.i;
    const r = RK.chart.timeScale().getVisibleLogicalRange(); if (!r) return;
    const lista = D.trades.filter((t) => t.i_ent <= k && t.i_sai >= r.from - 1 && t.i_ent <= r.to + 1);
    if (k === D.meta.iFim) for (const a of D.abertas) lista.push(a);
    const selAqui = SEL && SEL.ativo === D.meta.ativo && SEL.tf === D.meta.tf ? SEL : null;
    const completo = modo === "detalhe" && lista.length <= 14;
    let achou = false;
    for (const t of lista) {
      const sel = !!selAqui && chave(t) === selAqui.chave;
      if (sel) { achou = true; continue; }
      if (modo !== "nada") desenhar(ctx, u, D, t, completo, false);
    }
    if (selAqui) desenhar(ctx, u, D, achou ? lista.find((t) => chave(t) === selAqui.chave) : selAqui.tr, true, true);
  });

  function selecionar(tr, meta, focar = true) {
    if (!tr || (SEL && SEL.chave === chave(tr) && SEL.ativo === meta.ativo && SEL.tf === meta.tf && focar === "alternar")) SEL = null;
    else SEL = { chave: chave(tr), tr, ativo: meta.ativo, tf: meta.tf };
    const D = RK.graficoMostra();
    if (SEL && focar && D && D.meta.ativo === meta.ativo && D.meta.tf === meta.tf) {
      const ix = indices(D, tr);
      if (ix) RK.focar(ix.e, ix.x != null && ix.x >= 0 ? ix.x : RK.i);
      else RK.toast("Esta operação está fora dos candles carregados neste tempo gráfico.", "aviso");
    }
    RK.redesenhar(); renderOps();
  }
  RK.ops = { selecionar: (tr, meta) => selecionar(tr, meta, true), limpar: () => { if (SEL) { SEL = null; RK.redesenhar(); renderOps(); } },
    abrir: (n) => { const d = document.querySelectorAll("#cardOps .op")[n - 1]; if (d) d.click(); } };      // link direto: ?op=2
  RK.on("tecla", (e) => { if (e.key === "Escape") RK.ops.limpar(); });
  RK.on("mudou", (o) => { if (o === "ativo" || o === "tf") { SEL = null; RK.redesenhar(); } renderTeste(); });

  // ================================================================ 2. lista de operações + "como foi feita"
  function comoFoi(t, meta, aberta) {
    const q = t.q != null ? t.q : meta.contratos, din = (v) => RK.dinheiro(v, { meta }), f = (v) => RK.fmt(v, meta.decimais);
    const stop = t.stop_ini ?? t.stop, riscoDin = !aberta && t.R && t.dinheiro ? Math.abs(t.dinheiro / t.R) : t.risco * meta.valorPonto * q + 2 * meta.custo * q;
    const razao = t.alvo != null && t.risco ? Math.abs(t.alvo - t.ent) / t.risco : null;
    const hora = (x) => RK.quandoT(x, meta.intraday);
    const linhas = [
      ["Sinal ▲", `candle de ${hora(t.t_sinal)} · ${RK.esc(RK.nomeEst(t.est))}${t.info ? " (" + RK.esc(t.info) + ")" : ""}`],
      ["Entrada", `${t.dir > 0 ? "compra" : "venda"} de ${RK.unidade(meta, q)} em ${hora(t.t_ent)} a <b>${f(t.ent)}</b>${t.ctx ? " · " + RK.ctxTxt(t.ctx, null) : ""}`],
      ["Stop", `${f(stop)}${aberta && t.stop !== stop ? ` → movido para <b>${f(t.stop)}</b>` : ""} · risco ${f(t.risco)} pts = ${din(riscoDin)}`],
      ["Alvo", t.alvo != null ? `${f(t.alvo)}${razao ? ` · ${RK.num(razao, 1)} : 1` : ""}` : `sem alvo fixo (${RK.esc(RK.gestaoTxt(t.gestao))})`],
      aberta ? ["Agora", `aberta · <b class="${RK.cls(t.R)}">${RK.R(t.R)}</b>${t.parcial ? " · parcial feita, stop no 0x0" : ""}${t.sair ? " · sai na abertura do próximo candle (" + RK.esc(t.sair) + ")" : ""}`]
        : ["Saída", `${hora(t.t_sai)} a <b>${f(t.sai)}</b> · ${RK.esc(t.motivo)} → <b class="${RK.cls(t.R)}">${RK.R(t.R)} = ${RK.dinheiro(t.dinheiro, { meta }, true)}</b>${t.parcial ? " · com parcial no 1:1" : ""}`],
    ];
    return `<div class="op-det">${linhas.map(([a, b], j) => `<div><span>${j + 1} · ${a}</span><p>${b}</p></div>`).join("")}
      ${!aberta && t.maxR != null ? `<div class="nota">Chegou a andar ${RK.R(Math.max(0, t.maxR))} a favor. Resultado já com custos e escorregamento.</div>` : ""}</div>`;
  }
  function renderOps() {
    const el = $("cardOps"), D = RK.vivo.D;
    if (!D) return;
    const x = T.atual(), r = x && T.res[x.id];
    let vista = RK.pref.opsVista === "teste" && r ? "teste" : "per";
    const fonte = vista === "teste" ? r : D, meta = fonte.meta;
    const abertas = fonte.abertas || [], fechadas = fonte.trades;
    if (!r && !fechadas.length && !abertas.length) { el.classList.add("oculto"); return; }
    el.classList.remove("oculto");
    const MAX = 40, linhas = [];
    for (const a of abertas) linhas.push([a, true]);
    for (let j = fechadas.length - 1; j >= 0 && linhas.length < MAX; j--) linhas.push([fechadas[j], false]);
    const selAqui = SEL && SEL.ativo === meta.ativo && SEL.tf === meta.tf ? SEL.chave : null;
    const linha = ([t, aberta], j) => {
      const sel = chave(t) === selAqui;
      const din = aberta ? t.R * t.risco * meta.valorPonto * (t.q != null ? t.q : meta.contratos) : t.dinheiro;
      return `<div class="op${sel ? " sel" : ""}" data-j="${j}">
          <span class="op-h">${RK.quandoT(t.t_ent, meta.intraday)}</span><span class="op-e">${t.est}</span>
          <span class="${t.dir > 0 ? "bom" : "ruim"}">${t.dir > 0 ? "C" : "V"}</span>
          <span class="op-m">${aberta ? '<i class="luz vivo"></i> aberta' : RK.esc(t.motivo)}</span>
          <b class="${RK.cls(t.R)}">${RK.R(t.R, 1)}</b><b class="op-d ${RK.cls(din)}">${RK.dinheiro(din, { meta }, true)}</b>
        </div>${sel ? comoFoi(t, meta, aberta) : ""}`;
    };
    const total = fechadas.length + abertas.length;
    el.innerHTML = `<div class="rot">OPERAÇÕES${r ? `<span class="seg mini dir" id="opsVista"><button data-v="teste" class="${vista === "teste" ? "on" : ""}">Teste ao vivo (${r.trades.length + r.abertas.length})</button><button data-v="per" class="${vista === "per" ? "on" : ""}">Período (${D.trades.length + D.abertas.length})</button></span>`
      : `<span class="dir">${total} no período</span>`}</div>
      ${linhas.length ? `<div class="ops">${linhas.map(linha).join("")}</div>` : `<div class="nota">${vista !== "teste" ? "Nenhuma operação ainda." : x.ate ? "Este teste terminou sem nenhuma operação." : "Nenhuma operação ainda neste teste: o robô está esperando o setup."}</div>`}
      <div class="nota">${linhas.length ? "Clique numa operação para ver no gráfico como ela foi feita." : ""}${total > linhas.length ? ` Mostrando as ${linhas.length} mais recentes; todas estão na aba Simulação.` : ""}</div>`;
    el.querySelectorAll(".op").forEach((d) => (d.onclick = () => selecionar(linhas[+d.dataset.j][0], meta, "alternar")));
    const det = el.querySelector(".op-det");
    if (det) det.scrollIntoView({ block: "nearest" });
    el.querySelectorAll("#opsVista button").forEach((b) => (b.onclick = () => { RK.pref.opsVista = b.dataset.v; RK.salvarPref(); renderOps(); }));
  }

  // ================================================================ 3. teste ao vivo (simulado)
  const T = { lista: [], res: {}, ocupado: false, denovo: false };
  const combo = (x) => x.ativo + "|" + (+x.tf) + "|" + x.est;
  T.atual = () => T.lista.find((x) => combo(x) === combo(RK.pref)) || null;
  RK.testes = { cobre: (m) => T.lista.some((x) => !x.ate && T.res[x.id] && combo(x) === combo(m)), lista: () => T.lista };
  const guardar = () => RK.api.set("testes", T.lista).catch(() => RK.toast("Não consegui salvar o teste ao vivo.", "erro"));
  const url = (x) => "/api/teste?" + new URLSearchParams(Object.assign({ ativo: x.ativo, tf: x.tf, est: x.est, gestao: x.gestao, contratos: x.contratos,
    capital: x.capital, maxstops: x.maxstops, desde: x.desde, ate: x.ate || 0 }, RK.planoParams(x)));

  async function atualizarUm(x, avisar) {
    const r = await RK.json(url(x));
    if (!T.lista.includes(x)) return;                      // apagado enquanto a resposta vinha
    const antes = T.res[x.id];
    T.res[x.id] = r; x.erro = null;
    if (avisar && antes && !x.ate) {
      const ev = RK.novidades(antes, r, antes.meta.ultimoT);
      if (ev.length) RK.anunciar(ev, r.meta, combo(x) === combo(RK.pref) ? "Teste ao vivo · " : `Teste ${x.ativo} ${r.meta.nomeTf} · `);
    }
  }
  async function atualizarTodos(avisar = true) {
    if (!T.lista.length) return;
    if (T.ocupado) { T.denovo = true; return; }           // já tem uma rodada em andamento: repete quando ela acabar
    T.ocupado = true;
    try {
      for (const x of T.lista.slice()) {
        if (x.ate && T.res[x.id]) continue;                // teste parado: o resultado não muda mais
        try { await atualizarUm(x, avisar); } catch (e) { x.erro = e.message; }
      }
    } finally { T.ocupado = false; }
    renderTeste(); renderOps();
    if (T.denovo) { T.denovo = false; atualizarTodos(false); }
  }
  setInterval(() => { if (T.lista.some((x) => !x.ate)) atualizarTodos(true); }, 30000);

  function ligar() {
    const D = RK.vivo.D, p = RK.pref;
    if (!D || D.meta.ativo !== p.ativo || D.meta.tf !== +p.tf) return RK.toast("Espere os dados deste ativo carregarem.", "aviso");
    T.lista = T.lista.filter((x) => { const mesmo = combo(x) === combo(p); if (mesmo) delete T.res[x.id]; return !mesmo; });
    T.lista.push({ id: Date.now(), ativo: p.ativo, tf: +p.tf, est: p.est, gestao: p.gestao, contratos: p.contratos, capital: p.capital,
      maxstops: p.maxstops, desde: D.t[D.meta.ultimo], criado: Date.now(), ate: 0,
      tam: p.tam, risco: p.risco, lossDia: p.lossDia, metaDia: p.metaDia, seletivo: !!p.seletivo });      // o plano fica gravado no teste
    RK.pref.opsVista = "teste"; RK.salvarPref();
    guardar(); RK.som("ordem");
    RK.toast("Teste ao vivo ligado: o robô registra as operações a partir do próximo candle.", "ok");
    renderTeste(); atualizarTodos(false);
  }
  function parar(x) {
    const r = T.res[x.id];
    x.ate = (r && r.meta.ultimoT) || x.desde;
    delete T.res[x.id];
    guardar(); renderTeste(); atualizarTodos(false);
  }
  function apagar(x) {
    T.lista = T.lista.filter((y) => y !== x); delete T.res[x.id];
    if (RK.pref.opsVista === "teste") { RK.pref.opsVista = "per"; RK.salvarPref(); }
    guardar(); renderTeste(); renderOps();
  }
  const nomeCombo = (x) => `${x.est === "TODAS" ? "TODAS juntas" : x.est + " · " + RK.nomeEst(x.est)}`;
  const tfTxt = (tf) => ((RK.cfg.tempos.find((t) => +t.tf === +tf) || {}).nome || tf + " min");
  function renderTeste() {
    const el = $("cardTeste"), p = RK.pref;
    if (!RK.cfg) return;
    const x = T.atual(), r = x && T.res[x.id];
    const csv = String(p.ativo).startsWith("CSV:");
    let h;
    if (!x) {
      h = `<div class="rot">TESTE AO VIVO <span class="dir">simulado · sem dinheiro</span></div>
        <button id="tLigar" class="primario largo" ${csv ? "disabled" : ""}>▶ Ligar ${RK.esc(nomeCombo(p))} · ${RK.esc(RK.ehCripto(p.ativo) ? RK.nomeCripto(p.ativo) : p.ativo)} · ${tfTxt(p.tf)}</button>
        <div class="nota">${csv ? "Arquivo CSV não recebe candles novos: escolha um ativo ao vivo." : "Deixa a estratégia rodando a partir de agora: cada operação fica registrada aqui e no gráfico, com aviso sonoro. Pode trocar de ativo que o teste continua."}</div>`;
    } else if (!r) {
      h = `<div class="rot">TESTE AO VIVO <span class="dir">${x.erro ? "" : "carregando…"}</span></div>${x.erro ? `<div class="erro">⚠ ${RK.esc(x.erro)}</div><div class="botoes"><button id="tApagar">Apagar teste</button></div>` : ""}`;
    } else {
      const st = r.stats, m = r.meta, meta = { meta: m }, a = r.abertas[0];
      const agora = x.ate ? "" : a ? `em operação: ${a.dir > 0 ? "comprado" : "vendido"} <b class="${RK.cls(a.R)}">${RK.R(a.R)}</b>` : r.pend.length ? `<b>${r.pend[0].dir > 0 ? "compra" : "venda"} armada</b>` : "esperando o setup";
      h = `<div class="rot">${x.ate ? '<i class="luz hist"></i> TESTE ENCERRADO' : '<i class="luz vivo"></i> TESTE AO VIVO'}
          <span class="dir">${RK.quandoT(x.desde, m.intraday)}${x.ate ? " a " + RK.quandoT(x.ate, m.intraday) : " até agora"}</span></div>
        <div class="resumo-topo"><div><div class="grande ${RK.cls(st.total || 0)}">${RK.dinheiro(st.total || 0, meta, true)}</div>
          <div class="sub">${st.n} operaç${st.n === 1 ? "ão" : "ões"}${st.n ? ` · acerto ${RK.pct(st.acerto, 0)}` : ""} · ${m.tam === "risco" ? "risco de " + RK.num(m.riscoPct, 1) + "% por operação" : RK.unidade(m, m.contratos)}${m.seletivo ? " · seletivo" : ""}${m.dia && m.dia.trava && !x.ate ? ' · <b class="ruim">parou por hoje (' + RK.esc(m.dia.trava) + ")</b>" : agora ? " · " + agora : ""}</div></div>
          ${x.ate ? "" : '<button id="tParar" title="Encerra o teste e guarda o resultado">■ Parar</button>'}</div>
        ${x.ate ? '<div class="botoes"><button id="tLigar" class="primario">▶ Novo teste</button><button id="tApagar">Apagar</button></div>' : `<div class="nota">Simulado, sem dinheiro. ${m.formando ? "O candle atual ainda está aberto: sinal novo só depois que ele fechar." : ""}</div>`}`;
    }
    const outros = T.lista.filter((y) => y !== x);
    if (outros.length) {
      h += `<div class="testes-outros">` + outros.map((y) => {
        const ry = T.res[y.id], tot = ry ? ry.stats.total || 0 : null;
        const est = ry && !y.ate ? (ry.abertas.length ? " · em operação" : ry.pend.length ? " · ordem armada" : "") : "";
        return `<div class="teste-linha" data-id="${y.id}" title="Abrir este teste"><i class="luz ${y.ate ? "hist" : "vivo"}"></i>
          <span>${RK.esc(RK.ehCripto(y.ativo) ? RK.nomeCripto(y.ativo) : y.ativo)} · ${tfTxt(y.tf)} · ${RK.esc(y.est)}${est}</span>
          <b class="${RK.cls(tot)}">${ry ? RK.dinheiro(tot, { meta: ry.meta }, true) : y.erro ? "erro" : "…"}</b><small>${ry ? ry.stats.n + " ops" : ""}</small></div>`;
      }).join("") + `</div>`;
    }
    el.innerHTML = h;
    const bt = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    bt("tLigar", ligar);
    bt("tParar", () => parar(x));
    bt("tApagar", () => { if (confirm("Apagar este teste e o resultado dele?")) apagar(x); });
    el.querySelectorAll(".teste-linha").forEach((d) => (d.onclick = () => {
      const y = T.lista.find((z) => String(z.id) === d.dataset.id);
      if (y) { RK.pref.opsVista = "teste"; if (RK.ehCripto(y.ativo)) RK.abrirCripto(y.ativo); RK.irPara(y); if (RK.aba !== "vivo") RK.trocarAba("vivo"); }
    }));
    const n = T.lista.filter((y) => !y.ate).length, bd = $("badgeTestes");
    bd.textContent = n; bd.classList.toggle("oculto", !n);
  }

  RK.on("dadosVivo", () => { renderTeste(); renderOps(); });
  RK.on("config", async () => {
    try {
      const l = await RK.api.get("testes");
      if (Array.isArray(l)) T.lista = l.filter((x) => x && x.id && x.ativo && x.est && x.desde > 0 &&
        (x.est === "TODAS" || RK.cfg.estMap[x.est]) && RK.ativoValido(x.ativo));
    } catch (e) { /* sem testes salvos */ }
    renderTeste();
    atualizarTodos(false);
  });
})();
