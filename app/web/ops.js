/* ROBÔ APEX — operações e testes ao vivo.
   (1) Desenha cada operação no gráfico (entrada, stop, alvos, saída).
   (2) Lista as operações na aba Ao vivo e explica passo a passo como cada uma foi feita.
   (3) TESTE AO VIVO: liga uma estratégia em modo simulado (sem dinheiro) a partir de agora. Quem roda o teste é o
       SENTINELA, dentro do robô: ele continua vigiando com esta tela fechada e gera os sinais (ordem armada, entrada,
       saída). A tela mostra o teste, toca os avisos e deixa mexer nele NA MÃO: arrastar o stop e o alvo no gráfico,
       entrar ou cancelar uma ordem armada e sair de uma operação.
   (4) CENTRAL DE SINAIS: os últimos sinais de todos os testes ligados. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$, COR = AX.COR;
  const chave = (t) => t.est + "|" + t.t_ent;
  const chaveOrd = (o) => o.est + "|" + o.t_sinal + "|" + o.dir;      // a mesma chave que o servidor usa nos ajustes
  const pausa = (ms) => new Promise((ok) => setTimeout(ok, ms));
  let SEL = null;                     // operação clicada: { chave, tr, ativo, tf }

  // ================================================================ 1. operações no gráfico
  function indices(D, t) {            // candles do sinal, da entrada e da saída no gráfico mostrado
    if (t.i_ent != null && D.t[t.i_ent] === t.t_ent) return { s: t.i_sinal, e: t.i_ent, x: t.i_sai ?? null };
    const e = AX.idxT(D, t.t_ent);
    if (e < 0) return null;
    return { s: AX.idxT(D, t.t_sinal), e, x: t.t_sai != null ? AX.idxT(D, t.t_sai) : null };
  }
  function etiqueta(ctx, txt, x, y, cor, alinhar = "left") {
    ctx.font = "11px Segoe UI, system-ui"; ctx.textBaseline = "middle"; ctx.textAlign = "left";
    const w = ctx.measureText(txt).width, x0 = alinhar === "right" ? x - w : alinhar === "center" ? x - w / 2 : x;
    ctx.fillStyle = "rgba(11,14,20,.88)"; ctx.fillRect(x0 - 3, y - 8, w + 6, 16);
    ctx.fillStyle = cor; ctx.fillText(txt, x0, y);
  }
  function desenhar(ctx, u, D, t, completo, sel) {
    const ix = indices(D, t), k = AX.i;
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
    const reta = (y, c, traco) => { ctx.strokeStyle = c; ctx.lineWidth = 1; ctx.setLineDash(traco || []); ctx.beginPath(); ctx.moveTo(xe, Math.round(y) + 0.5); ctx.lineTo(x2, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]); };
    if (completo || sel) {
      const a = sel ? 0.17 : 0.08;
      if (yS != null) { ctx.fillStyle = `rgba(255,92,110,${a})`; ctx.fillRect(xe, Math.min(yE, yS), x2 - xe, Math.abs(yS - yE)); }
      if (yA != null) { ctx.fillStyle = `rgba(34,227,154,${a})`; ctx.fillRect(xe, Math.min(yE, yA), x2 - xe, Math.abs(yA - yE)); }
      ctx.globalAlpha = sel ? 1 : 0.6;
      reta(yE, "#d9e0ea");
      if (yS != null) reta(yS, COR.perda, [4, 3]);
      if (yA != null && !longe) reta(yA, COR.ganho, [4, 3]);
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
    etiqueta(ctx, `${t.dir > 0 ? "COMPRA" : "VENDA"} ${AX.fmt(t.ent)}`, X, yE, "#fff", al);
    if (yS != null && Math.abs(yS - yE) > 14) etiqueta(ctx, `STOP ${AX.fmt(stop)}`, X, yS, COR.perda, al);
    const parciais = [[t.alvo1, "ALVO 1"], [t.alvo2, "ALVO 2"]].filter((a) => a[0] != null);      // estratégias de 2 ou 3 alvos
    for (const [p, nome] of parciais) {
      const y = u.y(p); if (y == null) continue;
      ctx.globalAlpha = 0.75; reta(y, COR.ganho, [2, 3]); ctx.globalAlpha = 1;
      if (Math.abs(y - yE) > 14 && (yA == null || Math.abs(y - yA) > 14)) etiqueta(ctx, `${nome} ${AX.fmt(p)}`, X, y, COR.ganho, al);
    }
    if (yA != null && Math.abs(yA - yE) > 14) etiqueta(ctx, `${parciais.length ? "ALVO " + (parciais.length + 1) : "ALVO"} ${AX.fmt(t.alvo)}`, X, yA, COR.ganho, al);
    // linhas de prumo: uma no candle da entrada e outra no da saída, com o horário no pé do gráfico
    const hora = (i2) => AX.quando(D, i2).slice(-5);
    for (const [x, i2, c2, nome] of [[xe, ix.e, "#d9e0ea", "entrada "], aberta ? null : [x2, ix.x, cor, "saída "]].filter(Boolean)) {
      ctx.strokeStyle = c2; ctx.globalAlpha = 0.35; ctx.lineWidth = 1; ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, 0); ctx.lineTo(Math.round(x) + 0.5, u.H); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
      if (D.meta.intraday) etiqueta(ctx, nome + hora(i2), x, u.H - 10, c2, "center");
    }
    const fimTxt = aberta ? `AGORA ${AX.fmt(precoFim)} · ${AX.R((t.dir * (precoFim - t.ent)) / t.risco)}` : `SAÍDA ${AX.fmt(t.sai)} · ${AX.R(t.R)}${t.dinheiro != null ? " · " + AX.dinheiro(t.dinheiro, D, true) : ""}`;
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
  AX.camadas.push((ctx, u) => {
    const D = AX.graficoMostra(); if (!D) return;
    const modo = AX.ind ? AX.ind.ops() : "detalhe", k = AX.i;
    const r = AX.chart.timeScale().getVisibleLogicalRange(); if (!r) return;
    const F = AX.fonteOps(D);                              // com teste ao vivo nesta tela, depois que ele foi ligado valem as operações dele
    const lista = F.trades.filter((t) => t.i_ent <= k && t.i_sai >= r.from - 1 && t.i_ent <= r.to + 1);
    if (k === D.meta.iFim) for (const a of F.abertas) lista.push(a);
    const selAqui = SEL && SEL.ativo === D.meta.ativo && SEL.tf === D.meta.tf ? SEL : null;
    const completo = modo === "detalhe" && lista.length <= 14;
    let achou = false;
    for (const t of lista) {
      const sel = !!selAqui && chave(t) === selAqui.chave;
      if (sel) { achou = true; continue; }
      // a operação que está ABERTA agora aparece sempre completa (entrada, stop, alvos e resultado escritos), sem precisar clicar
      const viva = !selAqui && t.i_sai == null && k === D.meta.iFim;
      if (viva) desenhar(ctx, u, D, t, true, true);
      else if (modo !== "nada") desenhar(ctx, u, D, t, completo, false);
    }
    if (selAqui) desenhar(ctx, u, D, achou ? lista.find((t) => chave(t) === selAqui.chave) : selAqui.tr, true, true);
  });

  function selecionar(tr, meta, focar = true) {
    if (!tr || (SEL && SEL.chave === chave(tr) && SEL.ativo === meta.ativo && SEL.tf === meta.tf && focar === "alternar")) SEL = null;
    else SEL = { chave: chave(tr), tr, ativo: meta.ativo, tf: meta.tf };
    const D = AX.graficoMostra();
    if (SEL && focar && D && D.meta.ativo === meta.ativo && D.meta.tf === meta.tf) {
      const ix = indices(D, tr);
      if (ix) AX.focar(ix.e, ix.x != null && ix.x >= 0 ? ix.x : AX.i);
      else AX.toast("Esta operação está fora dos candles carregados neste tempo gráfico.", "aviso");
    }
    AX.redesenhar(); renderOps();
  }
  AX.ops = { selecionar: (tr, meta) => selecionar(tr, meta, true), limpar: () => { if (SEL) { SEL = null; AX.redesenhar(); renderOps(); } },
    abrir: (n) => { const d = document.querySelectorAll("#cardOps .op")[n - 1]; if (d) d.click(); } };      // link direto: ?op=2

  // ================================================================ 2. lista de operações + "como foi feita"
  const NA_MAO = { entrada: "entrada feita na mão", saida: "saída feita na mão", ajuste: "stop ou alvo movido na mão" };
  function comoFoi(t, meta, aberta) {
    const q = t.q != null ? t.q : meta.contratos, din = (v) => AX.dinheiro(v, { meta }), f = (v) => AX.fmt(v, meta.decimais);
    const stop = t.stop_ini ?? t.stop, riscoDin = !aberta && t.R && t.dinheiro ? Math.abs(t.dinheiro / t.R) : t.risco * meta.valorPonto * q + 2 * meta.custo * q;
    const razao = t.alvo != null && t.risco ? Math.abs(t.alvo - t.ent) / t.risco : null;
    const hora = (x) => AX.quandoT(x, meta.intraday);
    const parciais = [t.alvo1 != null ? "1º em " + f(t.alvo1) : "", t.alvo2 != null ? "2º em " + f(t.alvo2) : ""].filter(Boolean);
    const semFixo = `sem alvo fixo (${AX.esc(AX.gestaoTxt(t.gestao))})`;
    const linhas = [
      ["1 · Sinal ▲", `candle de ${hora(t.t_sinal)} · ${AX.esc(AX.nomeEst(t.est))}${t.info ? " (" + AX.esc(t.info) + ")" : ""}`],
      ["2 · Entrada", `${t.dir > 0 ? "compra" : "venda"} de ${AX.unidade(meta, q)} em ${hora(t.t_ent)} a <b>${f(t.ent)}</b>${t.ctx ? " · " + AX.ctxTxt(t.ctx, null) : ""}`],
      ["3 · Stop", `${f(stop)}${aberta && t.stop !== stop ? ` → movido para <b>${f(t.stop)}</b>` : ""} · risco ${f(t.risco)} pts = ${din(riscoDin)}`],
      ["4 · Alvo", t.alvo != null ? `${parciais.length ? parciais.join(", ") + ", final em " : ""}${f(t.alvo)}${razao ? ` · ${AX.num(razao, 1)} : 1` : ""}` : parciais.length ? `${parciais.join(", ")}; o resto ${semFixo}` : semFixo],
      aberta ? ["5 · Agora", `aberta · <b class="${AX.cls(t.R)}">${AX.R(t.R)}</b>${t.parcial ? " · parcial feita, stop no 0x0" : ""}${t.sair ? " · sai na abertura do próximo candle (" + AX.esc(t.sair) + ")" : ""}`]
        : ["5 · Saída", `${hora(t.t_sai)} a <b>${f(t.sai)}</b> · ${AX.esc(t.motivo)} → <b class="${AX.cls(t.R)}">${AX.R(t.R)} = ${AX.dinheiro(t.dinheiro, { meta }, true)}</b>${t.parcial ? " · com parcial" : ""}`],
    ];
    if (t.ia) linhas.push(["IA", `quando o sinal apareceu, dava <b>${AX.num(100 * t.ia[0], 0)}%</b> de chance de ganho (esperado <span class="${AX.cls(t.ia[1])}">${AX.R(t.ia[1])}</span>). Nota de um modelo que ainda não conhecia esta operação.`]);
    if (NA_MAO[t.manual]) linhas.push(["✋ Na mão", NA_MAO[t.manual] + ": esta operação não é a estratégia pura."]);
    return `<div class="op-det">${linhas.map(([a, b]) => `<div><span>${a}</span><p>${b}</p></div>`).join("")}
      ${!aberta && t.maxR != null ? `<div class="nota">Chegou a andar ${AX.R(Math.max(0, t.maxR))} a favor. Resultado já com custos e escorregamento.</div>` : ""}</div>`;
  }
  function renderOps() {
    const el = $("cardOps"), D = AX.vivo.D;
    if (!D) return;
    const x = T.atual(), r = x && T.det && T.det.id === x.id ? T.det : null;
    const vista = AX.pref.opsVista === "teste" && r ? "teste" : "per";
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
          <span class="op-h">${AX.quandoT(t.t_ent, meta.intraday)}</span><span class="op-e">${t.est}</span>
          <span class="${t.dir > 0 ? "bom" : "ruim"}">${t.dir > 0 ? "C" : "V"}</span>
          <span class="op-m">${aberta ? '<i class="luz vivo"></i> aberta' : AX.esc(t.motivo)}${t.manual ? " ✋" : ""}</span>
          <b class="${AX.cls(t.R)}">${AX.R(t.R, 1)}</b><b class="op-d ${AX.cls(din)}">${AX.dinheiro(din, { meta }, true)}</b>
        </div>${sel ? comoFoi(t, meta, aberta) : ""}`;
    };
    const total = fechadas.length + abertas.length;
    el.innerHTML = `<div class="rot"><svg class="ic" viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10"/></svg>OPERAÇÕES${r ? `<span class="seg mini dir" id="opsVista"><button data-v="teste" class="${vista === "teste" ? "on" : ""}">Teste ao vivo (${r.trades.length + r.abertas.length})</button><button data-v="per" class="${vista === "per" ? "on" : ""}">Período (${D.trades.length + D.abertas.length})</button></span>`
      : `<span class="dir">${total} no período</span>`}</div>
      ${linhas.length ? `<div class="ops">${linhas.map(linha).join("")}</div>` : `<div class="nota">${vista !== "teste" ? "Nenhuma operação ainda." : x.ate ? "Este teste terminou sem nenhuma operação." : "Nenhuma operação ainda neste teste: o robô está esperando o setup."}</div>`}
      <div class="nota">${linhas.length ? "Clique numa operação para ver no gráfico como ela foi feita." : ""}${total > linhas.length ? ` Mostrando as ${linhas.length} mais recentes; todas estão na aba Simulação.` : ""}</div>`;
    el.querySelectorAll(".op").forEach((d) => (d.onclick = () => selecionar(linhas[+d.dataset.j][0], meta, "alternar")));
    const det = el.querySelector(".op-det");
    if (det) det.scrollIntoView({ block: "nearest" });
    el.querySelectorAll("#opsVista button").forEach((b) => (b.onclick = () => { AX.pref.opsVista = b.dataset.v; AX.salvarPref(); renderOps(); }));
  }

  // ================================================================ 3. testes ao vivo (rodam no Sentinela, dentro do robô)
  // T.lista = todos os testes do usuário (resumo de cada um); T.det = o teste desta tela inteiro (operações, ordens, ajustes);
  // T.sinais = últimos sinais de todos os testes; T.seq = número do último sinal que a tela já recebeu.
  const T = { lista: [], det: null, seq: 0, sinais: [], visto: 0, pronto: false, ocupado: false, denovo: null, erro: null, avisoErro: null,
    sigVivo: "-", arma: null, pendente: false, todos: false };
  const combo = (x) => x.ativo + "|" + (+x.tf) + "|" + x.est;
  T.atual = () => T.lista.find((x) => combo(x) === combo(AX.pref)) || null;
  const detDe = (x) => (x && T.det && T.det.id === x.id ? T.det : null);

  // O teste ligado nesta tela, convertido para os índices do conjunto D do gráfico (o teste e o gráfico são pedidos em
  // momentos diferentes; o que os liga é o horário de cada candle). null = não há teste ligado aqui.
  let memoV = { D: null, det: null, v: null };
  function vivo(D) {
    const x = T.atual(), r = detDe(x);
    if (!D || !r || x.ate || D !== AX.vivo.D || D.meta.ativo !== r.meta.ativo || +D.meta.tf !== +r.meta.tf) return null;
    if (memoV.D === D && memoV.det === r) return memoV.v;
    const i = (t) => AX.idxT(D, t), m = r.meta, desde = m.desde, tr = [], ab = [];
    for (const t of r.trades) { const e = i(t.t_ent), s = i(t.t_sai); if (e >= 0 && s >= 0) tr.push(Object.assign({}, t, { i_sinal: i(t.t_sinal), i_ent: e, i_sai: s })); }
    for (const a of r.abertas) { const e = i(a.t_ent); if (e >= 0) ab.push(Object.assign({}, a, { i_sinal: i(a.t_sinal), i_ent: e })); }
    const a0 = ab[0];
    const v = {
      x, r,
      pos: a0 ? Object.assign({}, a0, { stopAgora: a0.stop, stop: a0.stop_ini, Ragora: a0.R, aberta: true }) : null,
      pend: r.pend.map((o) => Object.assign({}, o, { i_sinal: i(o.t_sinal) })),
      ajPend: r.ajPend || [],
      saidas: (k) => tr.filter((t) => t.i_sai === k),
      ops: { trades: D.trades.filter((t) => t.t_ent <= desde).concat(tr), abertas: D.abertas.filter((a) => a.t_ent <= desde).concat(ab) },
      meta: Object.assign({}, D.meta, { contratos: m.contratos, capital: m.capital, tam: m.tam, riscoPct: m.riscoPct, lossDia: m.lossDia, metaDia: m.metaDia,
        seletivo: m.seletivo, dia: m.dia || D.meta.dia, gestao: m.gestao, ia: m.ia || D.meta.ia }),
    };
    memoV = { D, det: r, v };
    return v;
  }
  AX.testes = { cobre: (m) => T.lista.some((x) => !x.ate && x.res && combo(x) === combo(m)), lista: () => T.lista, vivo, sinais: () => T.sinais };

  // ---------------------------------------------------------------- conversa com o servidor
  const rotSinal = (ev) => `${AX.rotAtivo(ev.ativo)} ${ev.nomeTf}`;
  function textoSinal(ev) {
    const f = (v) => AX.fmt(v, ev.dec), lado = ev.dir > 0 ? "COMPRA" : "VENDA";
    if (ev.tipo === "ordem") return `${ev.est} · ${lado} armada ${ev.gatilho == null ? "a mercado no próximo candle" : (ev.ordem === "limite" ? "limitada em " : ev.dir > 0 ? "acima de " : "abaixo de ") + f(ev.gatilho)}`;
    if (ev.tipo === "entrada") return `${ev.est} · ${lado} executada a ${f(ev.ent)}`;
    return `${ev.est} · saiu (${ev.motivo}) ${AX.R(ev.R)} = ${AX.dinheiro(ev.dinheiro, { meta: { moeda: ev.moeda } }, true)}`;
  }
  function anunciar(novos) {
    const peso = { ordem: 1, entrada: 2, saida: 3 };
    const top = novos.slice().sort((a, b) => peso[b.tipo] - peso[a.tipo] || b.seq - a.seq)[0];
    const txt = textoSinal(top), resto = novos.length > 1 ? ` (+${novos.length - 1} sinal${novos.length > 2 ? "is" : ""})` : "";
    AX.som(top.tipo === "saida" ? (top.ganho ? "ganho" : "perda") : top.tipo);
    AX.toast(`${rotSinal(top)} · ${txt}${resto}`, top.tipo === "saida" ? (top.ganho ? "ok" : "erro") : "");
    AX.notificar("Robô Apex · " + rotSinal(top), txt + resto);
    if (document.hidden) document.title = "● Robô Apex";
    const x = T.atual();
    if (x && novos.some((e) => e.teste === x.id)) { const c = $("cardVivo"); c.classList.remove("pulso"); void c.offsetWidth; c.classList.add("pulso"); }
  }
  function aplicar(r) {
    const primeira = !T.pronto;
    T.lista = Array.isArray(r.testes) ? r.testes : []; T.pronto = true; T.avisoErro = r.avisoErro || null; T.erro = null;
    const novos = (r.eventos || []).filter((e) => e.seq > T.seq);
    if (novos.length) { T.sinais = T.sinais.concat(novos).slice(-120); T.seq = novos[novos.length - 1].seq; }
    if (r.seq > T.seq) T.seq = r.seq;
    if (primeira) T.visto = AX.pref.sinalVisto > 0 && AX.pref.sinalVisto <= T.seq ? AX.pref.sinalVisto : 0;      // o que já tinha sido visto na última visita
    else if (novos.length) anunciar(novos);
  }
  const sigVivo = () => { const x = T.atual(), r = detDe(x); return r && !x.ate ? JSON.stringify([r.id, r.abertas, r.pend, r.ajPend, r.trades.length, r.meta.dia]) : "-"; };
  function tudo() {
    renderTeste(); renderSinais(); renderOps();
    const s = sigVivo();
    if (s !== T.sigVivo) { T.sigVivo = s; AX.refazerVivo(); }       // o "agora" do teste mudou: cartão do momento, setas e linhas
  }
  // Uma rodada: a lista dos testes + sinais novos e, se há teste nesta tela, ele inteiro. soDetalhe = só a segunda parte.
  async function ciclo(soDetalhe = false, repetiu = false) {
    if (!AX.cfg) return;
    if (T.ocupado) { T.denovo = soDetalhe && T.denovo !== "tudo" ? "det" : "tudo"; return; }
    T.ocupado = true;
    let maisSinais = false;
    try {
      if (!soDetalhe || !T.pronto) aplicar(await AX.json("/api/testes?seq=" + T.seq, { tempo: 20000 }));
      const x = T.atual();
      if (!x) T.det = null;
      else if (!x.ate || !detDe(x)) {
        try {
          const r = await AX.json("/api/teste?id=" + encodeURIComponent(x.id), { tempo: 20000 });
          const y = T.atual();
          if (y && y.id === r.id) { T.det = r; if (r.seq > T.seq) maisSinais = true; }
        } catch (e) { x.erro = x.erro || e.message; }
      }
    } catch (e) { T.erro = e.message; }
    finally { T.ocupado = false; }
    tudo();
    const d = T.denovo; T.denovo = null;
    if ((maisSinais && !repetiu) || d === "tudo") ciclo(false, true); else if (d) ciclo(true, true);
  }
  // Pedido que fica esperando no servidor até aparecer um sinal novo: o aviso chega na hora mesmo com a janela minimizada
  // (o navegador atrasa os relógios de uma página escondida, mas não as respostas).
  async function ouvir() {
    for (;;) {
      if (!T.pronto) { await pausa(1500); continue; }
      try {
        const antes = T.seq;
        aplicar(await AX.json(`/api/testes?seq=${T.seq}&espera=25`, { tempo: 45000 }));
        if (T.seq !== antes) { tudo(); ciclo(true); }
      } catch (e) { await pausa(6000); }
    }
  }
  async function pedir(corpo, tempo = 60000) {
    const r = await AX.post("/api/testes", Object.assign({ seq: T.seq }, corpo), { tempo });
    aplicar(r);
    return r;
  }

  // ---------------------------------------------------------------- ligar, parar, apagar
  const nomeCombo = (x) => (x.est === "TODAS" ? "TODAS juntas" : x.est + " · " + AX.nomeEst(x.est));
  const tfTxt = (tf) => ((AX.cfg.tempos.find((t) => +t.tf === +tf) || {}).nome || tf + " min");
  const tamTxt = (x) => (x.tam === "risco" ? "risco de " + AX.num(x.risco, 1) + "% por operação" : AX.unidade({ fracionado: !!(AX.infoAtivo(x.ativo) || {}).fracionado }, x.contratos));
  async function ligar() {
    const p = AX.pref, bt = $("tLigar");
    if (bt) bt.disabled = true;
    try {
      await pedir({ acao: "ligar", ativo: p.ativo, tf: +p.tf, est: p.est, gestao: p.gestao, contratos: p.contratos, capital: p.capital, maxstops: p.maxstops,
        tam: p.tam, risco: p.risco, lossDia: p.lossDia, metaDia: p.metaDia, seletivo: !!p.seletivo, prot: p.prot || [] });      // o plano fica gravado no teste
      AX.pref.opsVista = "teste"; AX.salvarPref();
      AX.som("ordem");
      AX.toast("Teste ao vivo ligado: o Sentinela registra as operações a partir do próximo candle, mesmo com esta tela fechada.", "ok");
    } catch (e) { AX.toast(e.message, "erro"); }
    T.det = null; tudo(); ciclo(true);
  }
  async function parar(x) {
    try { await pedir({ acao: "parar", id: x.id }); } catch (e) { AX.toast(e.message, "erro"); }
    T.det = null; tudo(); ciclo(true);
  }
  async function apagar(x) {
    try { await pedir({ acao: "apagar", id: x.id }); if (AX.pref.opsVista === "teste") { AX.pref.opsVista = "per"; AX.salvarPref(); } }
    catch (e) { AX.toast(e.message, "erro"); }
    T.det = null; tudo();
  }

  // ---------------------------------------------------------------- na mão: sair, entrar, cancelar, mover stop e alvo
  async function ajuste(p) {
    const x = T.atual();
    if (!x || x.ate) throw new Error("Não há teste ao vivo ligado nesta tela.");
    await pedir(Object.assign({ acao: "ajuste", id: x.id }, p), 30000);
    await ciclo(true);
  }
  const TXT_ACAO = { sair: "Saída na mão registrada.", entrar: "Entrada na mão registrada.", cancelar: "Ordem cancelada." };
  async function acao(tipo, ch) {
    T.arma = null;
    try { await ajuste({ tipo, chave: ch }); AX.toast(TXT_ACAO[tipo], "ok"); }
    catch (e) { AX.toast(e.message, "erro"); tudo(); }
  }
  // "128.300", "128300", "5432,5", "1.08345": o ponto pode ser milhar ou decimal; vale a leitura mais perto do preço de agora
  function lerPreco(txt, ref) {
    const s = String(txt || "").trim().replace(/\s/g, "");
    if (!s || !/^[0-9.,]+$/.test(s)) return null;
    const a = parseFloat(s.replace(/\./g, "").replace(",", ".")), b = parseFloat(s.replace(/,/g, "."));
    const ok = [a, b].filter((v) => v > 0 && isFinite(v));
    if (!ok.length) return null;
    return ref > 0 ? ok.sort((p, q) => Math.abs(Math.log(p / ref)) - Math.abs(Math.log(q / ref)))[0] : ok[0];
  }
  const semMilhar = (v, dec) => (v == null ? "" : (+v).toFixed(dec).replace(".", ","));
  const ultimoAj = (det, ch, tipo) => (det.ajPend || []).filter((a) => a.chave === ch && a.tipo === tipo).pop() || null;
  function alvoManual(det) {          // a operação aberta ou, sem ela, a ordem armada mais nova: é nela que os ajustes mexem
    const a = det.abertas[0], o = a ? null : det.pend[det.pend.length - 1];
    return a ? { op: a, pos: true } : o ? { op: o, pos: false } : null;
  }
  async function moverCampos() {
    const x = T.atual(), det = detDe(x), am = det && alvoManual(det);
    if (!am) return;
    const op = am.op, ch = chaveOrd(op), dec = det.meta.decimais, ref = det.meta.preco;
    const ps = ultimoAj(det, ch, "stop"), pa = ultimoAj(det, ch, "alvo");
    const stopAgora = ps ? ps.valor : op.stop, alvoAgora = pa ? pa.valor : op.alvo;
    const vs = lerPreco($("ajStop").value, ref), va = lerPreco($("ajAlvo").value, ref);
    const mudou = (novo, velho) => novo != null && (velho == null || Math.abs(novo - velho) >= Math.pow(10, -dec) / 2);
    const fila = [];
    if ($("ajStop").value.trim() && vs == null) return AX.toast("Não entendi o preço do stop.", "aviso");
    if ($("ajAlvo").value.trim() && va == null) return AX.toast("Não entendi o preço do alvo.", "aviso");
    if (mudou(vs, stopAgora)) fila.push({ tipo: "stop", chave: ch, valor: vs });
    if (mudou(va, alvoAgora)) fila.push({ tipo: "alvo", chave: ch, valor: va });
    if (!fila.length) return AX.toast("Os preços são os mesmos de antes.", "aviso");
    T.pendente = false;
    try { for (const p of fila) await ajuste(p); AX.toast(fila.length > 1 ? "Stop e alvo movidos." : fila[0].tipo === "stop" ? "Stop movido." : "Alvo movido.", "ok"); }
    catch (e) { AX.toast(e.message, "erro"); tudo(); }
  }
  function painelManual(x, det) {
    const am = det && alvoManual(det);
    const nAj = x.nAjustes ? `<div class="nota">✋ ${x.nAjustes} ajuste${x.nAjustes > 1 ? "s" : ""} na mão neste teste: ele deixou de ser a estratégia pura. O resumo do período continua mostrando a estratégia sem ajustes.</div>` : "";
    if (!am) return nAj;
    const op = am.op, ch = chaveOrd(op), dec = det.meta.decimais, fechado = !det.meta.formando;
    const ps = ultimoAj(det, ch, "stop"), pa = ultimoAj(det, ch, "alvo");
    const armado = (a) => T.arma && T.arma.acao === a && T.arma.chave === ch && T.arma.ate > Date.now();
    const bt = (a, txt, dica, cls = "") => `<button data-acao="${a}" class="${armado(a) ? "confirma" : cls}" ${fechado ? "disabled" : ""} data-dica="${AX.esc(fechado ? "O mercado deste ativo está fechado agora: não há preço para executar." : dica)}">${armado(a) ? "Confirmar: clique de novo" : txt}</button>`;
    const varios = op.alvo1 != null || op.alvo2 != null;
    return `<div class="manual" data-ch="${AX.esc(ch)}">
      <div class="manual-tit">NA MÃO ${AX.q("O teste segue a estratégia sozinho, mas você pode interferir: sair de uma operação, entrar numa ordem antes do gatilho, cancelar a ordem ou mover o stop e o alvo. Tudo continua simulado, sem dinheiro. As operações mexidas ficam marcadas com ✋ e deixam de ser a estratégia pura.")}
        <span class="dir">${am.pos ? (op.dir > 0 ? "comprado" : "vendido") : (op.dir > 0 ? "compra" : "venda") + " armada"} · ${AX.esc(op.est)}</span></div>
      <div class="manual-bts">${am.pos
        ? bt("sair", "✕ Sair agora", "Encerra a operação simulada pelo preço de agora (com o escorregamento de sempre). Fica marcada como saída na mão.", "perigo")
        : bt("entrar", "▶ Entrar agora", "Executa a ordem armada pelo preço de agora, sem esperar o gatilho. O stop e o alvo continuam os mesmos.", "primario") + bt("cancelar", "✕ Cancelar ordem", "Cancela a ordem armada. A estratégia volta a procurar o próximo setup.")}</div>
      <div class="manual-campos">
        <label class="campo"><span>Stop</span><input type="text" inputmode="decimal" id="ajStop" autocomplete="off" value="${semMilhar(ps ? ps.valor : op.stop, dec)}"></label>
        <label class="campo"><span>Alvo${varios ? " final" : ""}</span><input type="text" inputmode="decimal" id="ajAlvo" autocomplete="off" value="${semMilhar(pa ? pa.valor : op.alvo, dec)}" placeholder="sem alvo fixo"></label>
        <button id="ajMover" data-dica="Move o stop e o alvo para os preços digitados. O stop tem de ficar do lado da perda e o alvo do lado do ganho. Vale a partir do candle seguinte.">Mover</button>
      </div>
      <div class="nota">Ou <b>arraste</b> no gráfico as linhas marcadas com ⇕ (STOP e ALVO).${ps || pa ? ` <span class="alerta">⏳ ${[ps ? "stop novo em " + AX.fmt(ps.valor, dec) : "", pa ? "alvo novo em " + AX.fmt(pa.valor, dec) : ""].filter(Boolean).join(" e ")}: passa a valer quando o candle atual fechar.</span>` : ""}</div>${nAj}</div>`;
  }

  // ---------------------------------------------------------------- cartão do teste ao vivo
  const DICA_TESTE = "Teste ao vivo: a estratégia roda a partir de agora em modo simulado (sem dinheiro e sem enviar ordem). Cada operação fica registrada, com aviso sonoro. Quem roda é o Sentinela, dentro do robô: pode trocar de ativo, de aba ou fechar esta janela que o teste continua (o robô precisa ficar aberto).";
  function estadoTxt(rs) {
    if (rs.estado === "operacao") return `em operação: ${rs.dir > 0 ? "comprado" : "vendido"} <b class="${AX.cls(rs.R)}">${AX.R(rs.R)}</b>`;
    if (rs.estado === "ordem") return `<b>${rs.dir > 0 ? "compra" : "venda"} armada</b>`;
    if (rs.trava) return `<b class="ruim">parou por hoje (${AX.esc(rs.trava)})</b>`;
    return "esperando o setup";
  }
  function renderTeste() {
    const el = $("cardTeste"), p = AX.pref;
    if (!AX.cfg) return;
    const foco = document.activeElement;
    if (foco && foco.tagName === "INPUT" && el.contains(foco)) { T.pendente = true; return; }      // digitando o stop/alvo: não refaz por baixo
    T.pendente = false;
    const x = T.atual(), rs = x && x.res, det = detDe(x);
    const csv = String(p.ativo).startsWith("CSV:");
    const cab = (luz, txt, dir) => `<div class="rot">${luz}${txt} ${AX.q(DICA_TESTE)}<span class="dir">${dir}</span></div>`;
    let h;
    if (!T.pronto) h = cab("", "TESTE AO VIVO", T.erro ? "" : "carregando…") + (T.erro ? `<div class="erro">⚠ ${AX.esc(T.erro)}</div>` : "");
    else if (!x) {
      h = cab("", "TESTE AO VIVO", "simulado · sem dinheiro") +
        `<button id="tLigar" class="primario largo" ${csv ? "disabled" : ""}>▶ Ligar ${AX.esc(nomeCombo(p))} · ${AX.esc(AX.rotAtivo(p.ativo))} · ${tfTxt(p.tf)}</button>
        <div class="nota">${csv ? "Arquivo CSV não recebe candles novos: escolha um ativo ao vivo." : "Deixa a estratégia rodando a partir de agora: cada operação fica registrada aqui e no gráfico, com aviso sonoro. Dá para mover o stop e o alvo, entrar e sair na mão."}</div>`;
    } else if (!rs) {
      h = cab("", "TESTE AO VIVO", x.erro ? "" : "calculando…") + (x.erro ? `<div class="erro">⚠ ${AX.esc(x.erro)}</div><div class="botoes"><button id="tApagar">Apagar teste</button></div>` : "");
    } else {
      const mm = { meta: { moeda: rs.moeda } };
      h = cab(x.ate ? '<i class="luz hist"></i>' : '<i class="luz vivo"></i>', x.ate ? "TESTE ENCERRADO" : "TESTE AO VIVO",
        `${AX.quandoT(x.desde, rs.intraday)}${x.ate ? " a " + AX.quandoT(x.ate, rs.intraday) : " até agora"}`) +
        `<div class="resumo-topo"><div><div class="grande ${AX.cls(rs.total || 0)}">${AX.dinheiro(rs.total || 0, mm, true)}</div>
          <div class="sub">${rs.n} operaç${rs.n === 1 ? "ão" : "ões"}${rs.n ? ` · acerto ${AX.pct(rs.acerto, 0)}` : ""} · ${tamTxt(x)}${x.seletivo ? " · seletivo" : ""}${x.ate ? "" : " · " + estadoTxt(rs)}</div></div>
          ${x.ate ? "" : '<button id="tParar" data-dica="Encerra o teste e guarda o resultado dele. Uma operação que estiver aberta deixa de ser acompanhada.">■ Parar</button>'}</div>` +
        (x.ate ? '<div class="botoes"><button id="tLigar" class="primario">▶ Novo teste</button><button id="tApagar">Apagar</button></div>'
          : painelManual(x, det) + (rs.formando ? '<div class="nota">O candle atual ainda está aberto: sinal novo só depois que ele fechar.</div>' : ""));
    }
    const outros = T.lista.filter((y) => y !== x);
    if (outros.length) {
      h += `<div class="testes-outros">` + outros.map((y) => {
        const ry = y.res, tot = ry ? ry.total || 0 : null;
        const est = ry && !y.ate ? (ry.estado === "operacao" ? " · em operação" : ry.estado === "ordem" ? " · ordem armada" : "") : "";
        return `<div class="teste-linha" data-id="${y.id}" data-dica="Abrir este teste"><i class="luz ${y.ate ? "hist" : "vivo"}"></i>
          <span>${AX.esc(AX.rotAtivo(y.ativo))} · ${tfTxt(y.tf)} · ${AX.esc(y.est)}${est}</span>
          <b class="${AX.cls(tot)}">${ry ? AX.dinheiro(tot, { meta: { moeda: ry.moeda } }, true) : y.erro ? "erro" : "…"}</b><small>${ry ? ry.n + " ops" : ""}</small></div>`;
      }).join("") + `</div>`;
    }
    el.innerHTML = h;
    const bt = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    bt("tLigar", ligar);
    bt("tParar", () => parar(x));
    bt("tApagar", () => { if (confirm("Apagar este teste e o resultado dele?")) apagar(x); });
    bt("ajMover", moverCampos);
    el.querySelectorAll(".manual-bts button").forEach((b) => (b.onclick = () => {
      const ch = el.querySelector(".manual").dataset.ch, a = b.dataset.acao;
      if (T.arma && T.arma.acao === a && T.arma.chave === ch && T.arma.ate > Date.now()) return acao(a, ch);
      T.arma = { acao: a, chave: ch, ate: Date.now() + 4000 };      // 1º clique arma, o 2º (em até 4 s) confirma
      renderTeste();
      setTimeout(() => { if (T.arma && T.arma.ate <= Date.now()) { T.arma = null; renderTeste(); } }, 4100);
    }));
    el.querySelectorAll(".manual-campos input").forEach((inp) => {
      inp.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); moverCampos(); } else if (e.key === "Escape") { inp.blur(); } };
      inp.onblur = () => setTimeout(() => { if (T.pendente) renderTeste(); }, 150);      // o clique em "Mover" ainda precisa ler o que foi digitado
    });
    el.querySelectorAll(".teste-linha").forEach((d) => (d.onclick = () => {
      const y = T.lista.find((z) => String(z.id) === d.dataset.id);
      if (y) abrirTeste(y);
    }));
    const n = T.lista.filter((y) => !y.ate).length, bd = $("badgeTestes");
    bd.textContent = n; bd.classList.toggle("oculto", !n);
  }
  function abrirTeste(y) {
    if (!AX.ativoValido(y.ativo)) return AX.toast("O ativo deste teste não está mais na lista.", "aviso");
    AX.pref.opsVista = "teste";
    if (AX.ehCripto(y.ativo) && !AX.pref.criptos.some((c) => c.chave === y.ativo)) AX.abrirCripto(y.ativo);
    AX.irPara({ ativo: y.ativo, tf: +y.tf, est: y.est });
    if (AX.aba !== "vivo") AX.trocarAba("vivo");
  }

  // ================================================================ 4. central de sinais (Sentinela)
  const DICA_SENTINELA = "O Sentinela é a parte do robô que roda os testes ao vivo. Ele confere cada teste ligado a cada poucos segundos e registra aqui o que aconteceu: ordem armada, entrada e saída, com a chance estimada pela IA. Continua trabalhando com esta janela fechada; para ser avisado no celular, ligue os avisos no botão da sua conta.";
  let vistoT = null;
  function renderSinais() {
    const el = $("cardSinais"), ativos = T.lista.filter((x) => !x.ate);
    if (!T.pronto || (!ativos.length && !T.sinais.length)) { el.classList.add("oculto"); return; }
    el.classList.remove("oculto");
    const lista = T.sinais.slice().reverse(), mostra = lista.slice(0, T.todos ? 40 : 5);
    const novos = lista.filter((e) => e.seq > T.visto).length;
    const hoje = AX.diaBR(Date.now() / 1000);
    const linha = (ev, j) => {
      const dia = AX.diaBR(ev.quando), f = (v) => AX.fmt(v, ev.dec), lado = ev.dir > 0 ? "COMPRA" : "VENDA";
      const cls = ev.tipo === "saida" ? (ev.ganho ? "ganho" : "perda") : ev.tipo;
      const oque = ev.tipo === "ordem" ? `<b class="${ev.dir > 0 ? "cmp" : "vnd"}">${lado}</b> armada ${ev.gatilho == null ? "a mercado" : (ev.ordem === "limite" ? "limitada em " : ev.dir > 0 ? "acima de " : "abaixo de ") + f(ev.gatilho)}`
        : ev.tipo === "entrada" ? `<b class="${ev.dir > 0 ? "cmp" : "vnd"}">${lado}</b> executada a ${f(ev.ent)}`
          : `saiu: ${AX.esc(ev.motivo || "")} <b class="${AX.cls(ev.R)}">${AX.R(ev.R)}</b> <span class="${AX.cls(ev.dinheiro)}">${AX.dinheiro(ev.dinheiro, { meta: { moeda: ev.moeda } }, true)}</span>`;
      const ia = ev.ia && ev.tipo !== "saida" ? `<span class="sn-ia ${ev.iaOk ? "ok" : ""}" data-dica="Chance de ganho estimada pela IA quando o sinal apareceu${ev.iaOk ? " (modelo aprovado fora da amostra neste ativo)." : ". Neste ativo a IA ainda não acertou mais que o acaso: é só leitura."}">IA ${AX.num(100 * ev.ia[0], 0)}%</span>` : "";
      return `<div class="sn ${cls}${ev.seq > T.visto ? " novo" : ""}" data-j="${j}" data-dica="Abrir este ativo e este teste no gráfico">
        <i class="sn-p"></i><span class="sn-h">${dia === hoje ? "" : dia + " "}${AX.horaBR(ev.quando)}</span>
        <span class="sn-a">${AX.esc(AX.rotAtivo(ev.ativo))} · ${AX.esc(ev.nomeTf)} · ${AX.esc(ev.est)}</span><span class="sn-t">${oque}</span>${ia}</div>`;
    };
    el.innerHTML = `<div class="rot"><i class="radar${ativos.length ? " on" : ""}"></i>SENTINELA · CENTRAL DE SINAIS ${AX.q(DICA_SENTINELA)}
        <span class="dir">${ativos.length ? ativos.length + (ativos.length > 1 ? " testes vigiando" : " teste vigiando") : "nenhum teste ligado"}${novos ? ` · <b class="alerta">${novos} novo${novos > 1 ? "s" : ""}</b>` : ""}</span></div>
      ${mostra.length ? `<div class="sinais">${mostra.map(linha).join("")}</div>` : '<div class="nota">Nenhum sinal ainda. Quando um teste armar uma ordem, entrar ou sair, aparece aqui e toca o aviso.</div>'}
      ${T.avisoErro ? `<div class="aviso-custo">⚠ Não consegui mandar o aviso para o celular: ${AX.esc(T.avisoErro)}</div>` : ""}
      <div class="sn-pe">${lista.length > 5 ? `<button class="mini-btn" id="snMais">${T.todos ? "mostrar menos" : "ver os últimos " + Math.min(40, lista.length)}</button>` : ""}
        <button class="mini-btn" id="snAvisos" data-dica="Abre os avisos da sua conta: receber cada sinal no celular pelo Telegram e o aviso do Windows.">🔔 Avisos no celular</button></div>`;
    el.querySelectorAll(".sn").forEach((d) => (d.onclick = () => {
      const ev = mostra[+d.dataset.j], x = T.lista.find((y) => y.id === ev.teste);
      abrirTeste({ ativo: ev.ativo, tf: ev.tf, est: x ? x.est : ev.est });
    }));
    const mais = $("snMais"); if (mais) mais.onclick = () => { T.todos = !T.todos; renderSinais(); };
    $("snAvisos").onclick = () => (AX.conta && AX.conta.abrir ? AX.conta.abrir("avisos") : AX.toast("Os avisos ficam no botão da sua conta, no canto de cima.", "aviso"));
    // os destaques de "novo" somem depois de alguns segundos com o painel à vista
    if (novos && !vistoT && !document.hidden && AX.aba === "vivo") vistoT = setTimeout(() => {
      vistoT = null;
      if (document.hidden || AX.aba !== "vivo") return;
      T.visto = T.seq; AX.pref.sinalVisto = T.seq; AX.salvarPref(); renderSinais();
    }, 9000);
  }

  // ================================================================ 5. arrastar o stop e o alvo no gráfico
  const area = $("areaGrafico"), grafEl = $("chart");
  let drag = null;                    // { L: linha arrastada, y0, moveu, preco, ok }
  const tickDe = () => { const d = detDe(T.atual()); return d && d.meta.tick > 0 ? d.meta.tick : Math.pow(10, -AX.dec()); };
  function linhaEm(e) {               // linha arrastável debaixo do ponteiro (só com o cursor comum, na área dos candles)
    if (!AX.linhasVivas || (AX.desenho && AX.desenho.ferramenta() !== "cursor")) return null;
    if (!e.target || !grafEl.contains(e.target)) return null;
    const linhas = AX.linhasVivas();
    if (!linhas.length) return null;
    const r = grafEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || x > AX.chart.timeScale().width()) return null;
    let melhor = null, dmin = 6.5;
    for (const L of linhas) { const yy = AX.S.candle.priceToCoordinate(L.preco); if (yy != null && Math.abs(yy - y) < dmin) { dmin = Math.abs(yy - y); melhor = L; } }
    return melhor;
  }
  // o stop tem de ficar do lado da perda e o alvo do lado do ganho (em relação ao preço de agora ou ao gatilho da ordem)
  function ladoCerto(a, preco) {
    const D = AX.D, ref = a.pos || a.gatilho == null ? (D ? D.c[AX.i] : a.ent) : a.gatilho;
    return a.tipo === "stop" ? a.dir * (ref - preco) > 0 : a.dir * (preco - ref) > 0;
  }
  function textoArrasto(a, preco) {
    const f = AX.fmt(preco), nome = a.tipo === "stop" ? "STOP" : "ALVO";
    if (!drag.ok) return `${nome} ${f} · ${a.tipo === "stop" ? "o stop não pode passar para o lado do ganho" : "o alvo não pode passar para o lado da perda"}`;
    if (a.pos && a.risco > 0) {
      const r = (a.dir * (preco - a.ent)) / a.risco;
      return `${nome} ${f} · ${a.tipo === "stop" ? (r >= 0 ? "garante " : "perde ") + AX.R(r) : "ganha " + AX.R(r)} · solte para mover`;
    }
    return `${nome} ${f} · solte para mover`;
  }
  function fimArrasto(cancelar) {
    const d = drag; if (!d) return;
    drag = null; area.style.cursor = "";
    if (cancelar || !d.moveu) { AX.travarLinhas(false); AX.redesenhar(); return; }
    if (!d.ok) { AX.travarLinhas(false); AX.redesenhar(); AX.toast(d.L.arr.tipo === "stop" ? "O stop precisa ficar do lado da perda." : "O alvo precisa ficar do lado do ganho.", "aviso"); return; }
    ajuste({ tipo: d.L.arr.tipo, chave: d.L.arr.chave, valor: d.preco })
      .then(() => AX.toast(d.L.arr.tipo === "stop" ? "Stop movido." : "Alvo movido.", "ok"), (e) => AX.toast(e.message, "erro"))
      .then(() => { AX.travarLinhas(false); AX.redesenhar(); });
  }
  area.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.isPrimary === false || drag) return;
    const L = linhaEm(e); if (!L) return;
    e.preventDefault(); e.stopImmediatePropagation();          // este clique não é do gráfico (senão ele arrastaria a tela)
    drag = { L, y0: e.clientY, moveu: false, preco: L.preco, ok: true };
    AX.travarLinhas(true);
    try { area.setPointerCapture(e.pointerId); } catch (err) { /* ponteiro que não aceita captura */ }
    area.style.cursor = "ns-resize";
  }, true);
  area.addEventListener("pointermove", (e) => {
    if (!drag) {
      if (!e.buttons && linhaEm(e)) area.style.cursor = "ns-resize";
      return;
    }
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.buttons) return fimArrasto(false);                  // soltou fora da janela
    if (!drag.moveu && Math.abs(e.clientY - drag.y0) < 3) return;
    const r = grafEl.getBoundingClientRect(), p = AX.S.candle.coordinateToPrice(e.clientY - r.top);
    if (p == null || !(p > 0)) return;
    const tk = tickDe();
    drag.moveu = true; drag.preco = +(Math.round(p / tk) * tk).toFixed(AX.dec() + 2); drag.ok = ladoCerto(drag.L.arr, drag.preco);
    drag.L.linha.applyOptions({ price: drag.preco, color: drag.ok ? (drag.L.arr.tipo === "stop" ? COR.perda : COR.ganho) : "#7b8799", lineStyle: 0, lineWidth: 2 });
    AX.redesenhar();
  }, true);
  area.addEventListener("pointerup", (e) => { if (drag) { e.stopImmediatePropagation(); fimArrasto(false); } }, true);
  area.addEventListener("pointercancel", () => fimArrasto(true), true);
  area.addEventListener("click", (e) => { if (drag) e.stopImmediatePropagation(); }, true);
  // toque: a biblioteca arrasta o gráfico pelos eventos de toque, que o pointerdown cancelado não segura
  area.addEventListener("touchstart", (e) => { if (drag) e.stopImmediatePropagation(); }, { capture: true, passive: true });
  area.addEventListener("touchmove", (e) => { if (drag) { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, passive: false });
  // pegas das linhas que dão para arrastar, e o texto que acompanha a linha durante o arrasto
  AX.camadas.push((ctx, u) => {
    const D = AX.graficoMostra();
    if (!D || D !== AX.vivo.D || !AX.linhasVivas) return;
    for (const L of AX.linhasVivas()) {
      const meu = drag && drag.L === L, y = u.y(meu ? drag.preco : L.preco);
      if (y == null || y < 9 || y > u.H - 9) continue;
      ctx.font = "12px Segoe UI, system-ui";               // a pega fica logo à esquerda da etiqueta que a biblioteca escreve na linha
      const x = Math.max(12, u.W - ctx.measureText(L.titulo).width - 24), cor = meu && !drag.ok ? "#7b8799" : L.arr.tipo === "stop" ? COR.perda : COR.ganho;
      ctx.fillStyle = "#0b0e14"; ctx.strokeStyle = cor; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, 7.5, 0, 7); ctx.fill(); ctx.stroke();
      ctx.fillStyle = cor;
      for (const s of [-1, 1]) { ctx.beginPath(); ctx.moveTo(x, y + s * 5.2); ctx.lineTo(x - 3.2, y + s * 1.6); ctx.lineTo(x + 3.2, y + s * 1.6); ctx.closePath(); ctx.fill(); }
      if (meu && drag.moveu) etiqueta(ctx, textoArrasto(L.arr, drag.preco), x - 14, y - 13 < 10 ? y + 13 : y - 13, drag.ok ? "#fff" : "#ffb0b8", "right");
    }
  });

  // ================================================================ ligação com o resto da tela
  AX.on("tecla", (e) => { if (e.key === "Escape") { if (drag) fimArrasto(true); else AX.ops.limpar(); } });
  AX.on("mudou", (o) => {
    if (o === "ativo" || o === "tf") { SEL = null; AX.redesenhar(); }
    T.arma = null; renderTeste(); renderOps(); ciclo(true);
  });
  AX.on("dadosVivo", () => { renderTeste(); renderOps(); const x = T.atual(); if (x && !x.ate) ciclo(true); });
  AX.on("aba", (nome) => { if (nome === "vivo") renderSinais(); });
  AX.on("config", () => { renderTeste(); ciclo(); ouvir(); });
  setInterval(() => { if (!document.hidden) ciclo(); }, 4000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) ciclo(); });
})();
