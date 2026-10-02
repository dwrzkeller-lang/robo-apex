/* ROBÔ KELLER — aba SIMULAÇÃO: roda a estratégia escolhida (ou TODAS) num período passado com dados reais,
   mostra quanto teria ganhado/perdido e permite assistir candle a candle como se fosse ao vivo. */
(() => {
  "use strict";
  const RK = window.RK, $ = RK.$;
  const SIM = { D: null, seq: 0, k: null, timer: null, rodando: false, emReplay: false, velho: true, ultRender: 0 };
  RK.sim = SIM;

  // período mostrado no cartão (vem do topo)
  function textoPeriodo(D) { $("simPeriodo").textContent = D ? `${RK.dataTxt(D.meta.dataIni)} a ${RK.dataTxt(D.meta.dataFim)}` : ""; }
  RK.on("dadosVivo", (D) => { if (!SIM.D || SIM.velho) textoPeriodo(D); });

  // ---------------------------------------------------------------- calcular
  async function simular({ assistir = false } = {}) {
    pararReplay(false);
    const seq = ++SIM.seq;
    RK.erro("erroSim", null);
    $("btSimular").disabled = $("btAssistir").disabled = true;
    $("carregando").classList.remove("oculto");
    try {
      const D = await RK.json("/api/sim?" + RK.parametros({ aten: 1 }));
      if (seq !== SIM.seq) return;
      SIM.D = D; SIM.velho = false;
      textoPeriodo(D);
      if (RK.aba !== "sim") return;
      if (assistir) iniciarReplay();
      else {
        SIM.k = D.meta.iFim;
        $("cardReplay").classList.add("oculto");
        RK.mostrar(D, D.meta.iFim);
        renderResultado(D, null);
      }
    } catch (e) {
      if (seq === SIM.seq) { RK.erro("erroSim", e); $("simResultado").innerHTML = ""; }
    } finally {
      if (seq === SIM.seq) { $("btSimular").disabled = $("btAssistir").disabled = false; $("carregando").classList.add("oculto"); }
    }
  }

  // ---------------------------------------------------------------- replay (assistir candle a candle)
  function iniciarReplay() {
    const D = SIM.D, m = D.meta;
    SIM.k = Math.max(0, m.iIni - 1);
    SIM.emReplay = true;
    RK.mostrar(D, SIM.k);
    $("replayCtl").classList.remove("oculto"); $("cardReplay").classList.remove("oculto");
    $("simResultado").innerHTML = "";
    atualizarReplay(true);
    tocar(true);
  }
  function tocar(sim) {
    SIM.rodando = sim;
    $("rpPlay").textContent = sim ? "⏸" : "▶";
    clearInterval(SIM.timer); SIM.timer = null;
    if (!sim) return;
    const vel = +$("rpVel").value, intervalo = Math.max(20, 1000 / vel), porTique = Math.max(1, Math.round((vel * intervalo) / 1000));
    SIM.timer = setInterval(() => avancar(porTique), intervalo);
  }
  function avancar(n) {
    const D = SIM.D;
    if (!D || !SIM.emReplay) return tocar(false);
    const alvo = Math.min(D.meta.iFim, SIM.k + n);
    if (alvo > SIM.k) {
      const antes = SIM.k;
      SIM.k = alvo;
      if (RK.graficoMostra() !== D) RK.mostrar(D, alvo, { manterZoom: true }); else RK.avancar(alvo);
      const ts = RK.chart.timeScale(), r = ts.getVisibleLogicalRange();
      if (r && alvo > r.to - 4) ts.setVisibleLogicalRange({ from: r.from + (alvo - (r.to - 8)), to: alvo + 8 });
      if (RK.pref.som && +$("rpVel").value <= 5 && D.ordens.some((o) => o.i_sinal > antes && o.i_sinal <= alvo)) RK.som("ordem");
      atualizarReplay(false);
    }
    if (SIM.k >= D.meta.iFim) { pararReplay(true); RK.toast("Replay terminou: resultado completo abaixo.", "ok"); }
  }
  function atualizarReplay(forcar) {
    const D = SIM.D, m = D.meta, k = SIM.k;
    RK.cartaoMomento($("cardReplay"), D, k);
    const tot = Math.max(1, m.iFim - (m.iIni - 1));
    $("rpBarra").style.width = (100 * Math.max(0, k - (m.iIni - 1))) / tot + "%";
    const p = parcial(D, k);
    $("rpTxt").innerHTML = `${RK.quando(D, k, true)} · ${p.n} operações fechadas · acerto ${RK.pct(p.acerto)} · resultado <b class="${RK.cls(p.total)}">${RK.dinheiro(p.total, D, true)}</b>`;
    const agora = performance.now();
    if (forcar || agora - SIM.ultRender > 300) { SIM.ultRender = agora; renderParcial(D, k, p); }
  }
  function pararReplay(mostrarTudo) {
    tocar(false);
    const estava = SIM.emReplay;
    SIM.emReplay = false;
    $("replayCtl").classList.add("oculto");
    if (estava && mostrarTudo && SIM.D) {
      SIM.k = SIM.D.meta.iFim;
      $("cardReplay").classList.add("oculto");
      RK.mostrar(SIM.D, SIM.k);
      renderResultado(SIM.D, null);
    }
  }

  // ---------------------------------------------------------------- contas parciais (durante o replay)
  function parcial(D, k) {
    const cap = D.meta.capital, trs = D.trades.filter((t) => t.i_sai <= k);
    let eq = cap, pico = cap, dd = 0, g = 0, somaR = 0;
    const curva = [cap];
    for (const t of trs) { eq += t.dinheiro; curva.push(eq); pico = Math.max(pico, eq); dd = Math.max(dd, pico - eq); if (t.R > 0) g++; somaR += t.R; }
    return { trs, n: trs.length, acerto: trs.length ? (100 * g) / trs.length : null, total: eq - cap, dd, somaR, curva };
  }
  function renderParcial(D, k, p) {
    $("simResultado").classList.remove("vazio-bloco");
    $("simResultado").innerHTML = `<div class="card"><div class="rot">ATÉ ${RK.quando(D, k, true)}</div>
      <div class="kpis"><div><small>Resultado</small><b class="${RK.cls(p.total)}">${RK.dinheiro(p.total, D, true)}</b><em>${RK.R(p.somaR, 1)} somados</em></div>
      <div><small>Operações</small><b>${p.n}</b></div><div><small>Acerto</small><b>${RK.pct(p.acerto)}</b></div>
      <div><small>Pior queda</small><b class="ruim">${RK.dinheiro(-p.dd, D)}</b></div>
      <div><small>Capital</small><b>${RK.dinheiro(D.meta.capital + p.total, D)}</b></div>
      <div><small>Candle</small><b>${k - D.meta.iIni + 1}</b><em>de ${D.meta.iFim - D.meta.iIni + 1}</em></div></div>
      <canvas class="graf" id="cvCapital"></canvas></div>`;
    curvaCapital($("cvCapital"), p.curva, D.meta.capital);
  }

  // ---------------------------------------------------------------- resultado completo
  function renderResultado(D, _k) {
    $("simResultado").classList.remove("vazio-bloco");
    const m = D.meta, st = D.stats, lote = m.fracionado ? "lote(s)" : "contrato(s)";
    const cab = `${RK.esc(RK.nomeEst(m.est))} · ${RK.esc(m.ativo)} · ${m.nomeTf}`;
    const per = `${RK.dataTxt(m.dataIni)} a ${RK.dataTxt(m.dataFim)}`;
    const premissas = `<div class="nota">Gestão: ${RK.esc(RK.cfg.gestoes[m.gestao])} · ${RK.num(m.contratos, m.fracionado ? 2 : 0)} ${lote} · para o dia após ${m.maxStops} stops${m.intraday ? ` · entradas até ${hora(m.horaFim)}, zeragem ${hora(m.horaZeragem)}` : " · swing (sem zeragem)"}.
      ${(m.gestao === "parcial" || m.gestao === "conducao") && !m.fracionado && m.contratos < 2 ? "<b>Com 1 contrato não há parcial</b>: no 1:1 o stop só vai para o 0x0 (use 2 contratos ou mais). " : ""}Execução conservadora: ordem stop com escorregamento, alvo só conta se passar 1 tick, candle que toca stop e alvo conta como stop, custos descontados.</div>`;
    let html = `<div class="card"><div class="rot">RESULTADO · ${cab} <span class="dir">${per}</span></div>`;
    if (st.n) {
      html += `<div class="resumo-topo"><div><div class="grande ${RK.cls(st.total)}">${RK.dinheiro(st.total, D, true)}</div>
          <div class="sub">${st.n} operações · acerto ${RK.pct(st.acerto, 0)} (empata com ${RK.pct(st.empate, 0)}) · ${RK.pct((100 * st.total) / m.capital)} do capital</div></div>${RK.seloCurto(st)}</div>
        <canvas class="graf" id="cvCapital"></canvas>
        <div class="kpis">
          <div><small>Média por operação</small><b class="${RK.cls(st.mediaDin)}">${RK.dinheiro(st.mediaDin, D, true)}</b><em>± ${RK.dinheiro(st.icDin, D)}</em></div>
          <div><small>Pior queda</small><b class="ruim">${RK.dinheiro(-st.ddMax, D)}</b><em>${RK.pct(st.ddPct, 0)} do pico</em></div>
          <div><small>Capital final</small><b>${RK.dinheiro(st.capitalFinal, D)}</b><em>começou com ${RK.dinheiro(m.capital, D)}</em></div>
          <div><small>Ganho ÷ perda</small><b>${RK.num(st.payoff, 2)}</b><em>fator de lucro ${RK.num(st.fatorLucro, 2)}</em></div>
          <div><small>Perdas seguidas</small><b>${st.perdasSeguidas}</b><em>maior sequência</em></div>
          <div><small>1ª / 2ª metade</small><b class="${RK.cls(st.exp1)}">${RK.dinheiro(st.exp1, D, true)}</b><em class="${RK.cls(st.exp2)}">${RK.dinheiro(st.exp2, D, true)} por operação</em></div>
        </div>
        <details><summary>Como ler · premissas</summary><div class="nota">${RK.esc(st.explica || "")} Capital recomendado para aguentar a pior queda com folga: <b>${RK.dinheiro(3 * st.ddMax, D)}</b> (3× a pior queda).</div>${premissas}</details>`;
    } else {
      html += `<div class="resumo-topo"><div><div class="grande neutro">sem operações</div><div class="sub">${RK.esc(st.explica || "")}</div></div>${RK.seloCurto(st)}</div>${premissas}`;
    }
    html += `</div>`;
    if (st.n) {
      html += `<div class="card"><div class="rot">RESULTADO POR MÊS</div><canvas class="graf baixo" id="cvMeses"></canvas>
        <table class="tab"><tr><th>Mês</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Em R</th><th class="n">Resultado</th></tr>` +
        st.meses.map((x) => `<tr><td>${String(x.mes).slice(4)}/${String(x.mes).slice(0, 4)}</td><td class="n">${x.n}</td><td class="n">${RK.pct((100 * x.ganhos) / x.n, 0)}</td><td class="n ${RK.cls(x.R)}">${RK.R(x.R, 1)}</td><td class="n ${RK.cls(x.dinheiro)}">${RK.dinheiro(x.dinheiro, D, true)}</td></tr>`).join("") + `</table></div>`;
    }
    if (m.est === "TODAS" && D.porEst) {
      html += `<div class="card"><details><summary style="margin-top:0">Cada estratégia: sozinha × dentro do "TODAS"</summary><div class="rolagem" style="margin-top:6px"><table class="tab">
        <tr><th>Estratégia</th><th class="n">Sozinha: ops</th><th class="n">acerto</th><th class="n">média</th><th class="n">resultado</th><th class="n">No TODAS: ops</th><th class="n">resultado</th></tr>` +
        Object.entries(D.porEst).map(([c, r]) => { const s = r.isolada, j = r.naJunta; return `<tr><td title="${RK.esc(s.veredito)}">${c} ${RK.esc(RK.nomeEst(c))}</td><td class="n">${s.n}</td><td class="n">${RK.pct(s.acerto)}</td><td class="n ${RK.cls(s.expR)}">${RK.R(s.expR)}</td><td class="n ${RK.cls(s.total)}">${RK.dinheiro(s.total, D, true)}</td><td class="n">${j.n}</td><td class="n ${RK.cls(j.total)}">${RK.dinheiro(j.total, D, true)}</td></tr>`; }).join("") +
        `</table></div><div class="nota">No "TODAS" só existe uma operação por vez: quando uma estratégia está posicionada, os sinais das outras são ignorados.</div></details></div>`;
    }
    if (st.n) {
      html += `<div class="card"><div class="rot">OPERAÇÕES (${st.n}) <button class="mini-btn" id="btCsv">Exportar CSV</button></div><div class="rolagem"><table class="tab">
        <tr><th>Entrada</th><th>Est.</th><th></th><th class="n">Preço</th><th class="n">Stop</th><th class="n">Saída</th><th>Motivo</th><th class="n">R</th><th class="n">Resultado</th></tr>` +
        D.trades.map((t, j) => `<tr class="clic" data-j="${j}"><td>${RK.quando(D, t.i_ent)}</td><td>${t.est}</td><td class="${t.dir > 0 ? "bom" : "ruim"}">${t.dir > 0 ? "C" : "V"}</td><td class="n">${RK.fmt(t.ent)}</td><td class="n">${RK.fmt(t.stop)}</td><td class="n">${RK.fmt(t.sai)}</td><td>${RK.esc(t.motivo)}</td><td class="n ${RK.cls(t.R)}">${RK.R(t.R)}</td><td class="n ${RK.cls(t.dinheiro)}">${RK.dinheiro(t.dinheiro, D, true)}</td></tr>`).join("") +
        `</table></div><div class="nota">Clique numa operação para vê-la no gráfico.</div></div>`;
    }
    $("simResultado").innerHTML = html;
    desenharGraficos();
    $("simResultado").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => {
      const t = D.trades[+tr.dataset.j];
      if (RK.graficoMostra() !== D) RK.mostrar(D, SIM.k ?? D.meta.iFim, { manterZoom: true });
      if (RK.ops) RK.ops.selecionar(t, D.meta); else RK.focar(t.i_ent);
      $("simResultado").querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel")); tr.classList.add("sel");
    }));
    const b = $("btCsv"); if (b) b.onclick = () => exportarCsv(D);
  }
  const hora = (hm) => `${String(Math.floor(hm / 100)).padStart(2, "0")}:${String(hm % 100).padStart(2, "0")}`;

  // ---------------------------------------------------------------- gráficos em canvas
  function preparar(cv) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return null;                       // aba escondida: desenha quando aparecer
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    c.font = "11px Segoe UI, system-ui";
    return { c, w, h };
  }
  function curvaCapital(cv, curva, base) {
    const P = cv && preparar(cv); if (!P) return;
    const { c, w, h } = P, pad = { l: 8, r: 8, t: 10, b: 16 };
    const min = Math.min(base, ...curva), max = Math.max(base, ...curva), amp = max - min || 1;
    const X = (i) => pad.l + (i * (w - pad.l - pad.r)) / Math.max(1, curva.length - 1);
    const Y = (v) => pad.t + ((max - v) * (h - pad.t - pad.b)) / amp;
    c.strokeStyle = "#3a475e"; c.setLineDash([4, 4]); c.beginPath(); c.moveTo(pad.l, Y(base)); c.lineTo(w - pad.r, Y(base)); c.stroke(); c.setLineDash([]);
    const fim = curva[curva.length - 1], cor = fim >= base ? "#00e676" : "#ff4d5e";
    c.beginPath(); curva.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.strokeStyle = cor; c.lineWidth = 2; c.stroke();
    c.lineTo(X(curva.length - 1), Y(base)); c.lineTo(X(0), Y(base)); c.closePath();
    c.fillStyle = fim >= base ? "rgba(0,230,118,.08)" : "rgba(255,77,94,.08)"; c.fill();
    c.fillStyle = "#8a96a8"; c.textAlign = "left"; c.fillText(RK.dinheiro(max), pad.l, 10); c.fillText(RK.dinheiro(min), pad.l, h - 3);
    c.textAlign = "right"; c.fillStyle = cor; c.fillText(RK.dinheiro(fim), w - pad.r, Math.max(12, Math.min(h - 18, Y(fim) - 4)));
  }
  function barrasMes(cv, meses) {
    const P = cv && preparar(cv); if (!P) return;
    const { c, w, h } = P, pad = { l: 6, r: 6, t: 8, b: 16 };
    const vals = meses.map((x) => x.dinheiro), mx = Math.max(1e-9, ...vals.map(Math.abs));
    const y0 = pad.t + (h - pad.t - pad.b) / 2, esc = (h - pad.t - pad.b) / 2 / mx;
    const bw = (w - pad.l - pad.r) / Math.max(1, meses.length);
    c.strokeStyle = "#3a475e"; c.beginPath(); c.moveTo(pad.l, y0); c.lineTo(w - pad.r, y0); c.stroke();
    meses.forEach((x, i) => {
      const v = x.dinheiro, bh = Math.abs(v) * esc, x0 = pad.l + i * bw + bw * 0.15;
      c.fillStyle = v >= 0 ? "#00e676" : "#ff4d5e";
      c.fillRect(x0, v >= 0 ? y0 - bh : y0, bw * 0.7, Math.max(1, bh));
      if (bw > 26 || i === 0 || i === meses.length - 1) { c.fillStyle = "#8a96a8"; c.textAlign = "center"; c.fillText(`${String(x.mes).slice(4)}/${String(x.mes).slice(2, 4)}`, x0 + bw * 0.35, h - 3); }
    });
  }
  function desenharGraficos() {
    const D = SIM.D; if (!D || !D.stats.n) return;
    if (SIM.emReplay) { renderParcial(D, SIM.k, parcial(D, SIM.k)); return; }
    const cap = D.meta.capital, curva = [cap]; let eq = cap;
    for (const t of D.trades) { eq += t.dinheiro; curva.push(eq); }
    curvaCapital($("cvCapital"), curva, cap);
    barrasMes($("cvMeses"), D.stats.meses);
  }
  window.addEventListener("resize", () => { if (RK.aba === "sim") desenharGraficos(); });

  function exportarCsv(D) {
    const f = (v, d = 4) => (v == null ? "" : Number(v).toFixed(d).replace(".", ","));
    const linhas = [["entrada", "saida", "estrategia", "lado", "preco_entrada", "stop", "alvo", "preco_saida", "motivo", "R", "resultado_" + D.meta.moeda.replace("$", "S")].join(";")];
    for (const t of D.trades) linhas.push([RK.quando(D, t.i_ent, true), RK.quando(D, t.i_sai, true), t.est, t.dir > 0 ? "compra" : "venda",
      f(t.ent), f(t.stop), f(t.alvo), f(t.sai), t.motivo, f(t.R, 3), f(t.dinheiro, 2)].join(";"));
    const blob = new Blob(["﻿" + linhas.join("\r\n")], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `robo_keller_${D.meta.ativo}_${D.meta.nomeTf.replace(/\s/g, "")}_${D.meta.est}.csv`.replace(/[^A-Za-z0-9_.\-]/g, "_");
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  // link direto (abre a simulação já calculada, ou o replay parado em um candle)
  RK.simDemo = async ({ acao, passos }) => {
    await simular({ assistir: acao === "replay" });
    if (acao === "replay" && SIM.emReplay) { tocar(false); if (passos) avancar(passos); RK.mostrar(SIM.D, SIM.k); }
    await new Promise((ok) => setTimeout(ok, 800));       // deixa o gráfico redesenhar
  };

  // ---------------------------------------------------------------- ligações
  $("btSimular").onclick = () => simular();
  $("btAssistir").onclick = () => simular({ assistir: true });
  $("rpPlay").onclick = () => { if (SIM.k >= SIM.D.meta.iFim) return; tocar(!SIM.rodando); };
  $("rpPasso").onclick = () => { tocar(false); avancar(1); };
  $("rpVel").onchange = () => { if (SIM.rodando) tocar(true); };
  $("rpFim").onclick = () => { tocar(false); if (SIM.D) avancar(SIM.D.meta.iFim - SIM.k); };
  $("rpSair").onclick = () => pararReplay(true);
  RK.on("tecla", (e) => {
    if (RK.aba !== "sim" || !SIM.emReplay) return;
    if (e.key === " ") { e.preventDefault(); $("rpPlay").click(); }
    if (e.key === "ArrowRight") { e.preventDefault(); $("rpPasso").click(); }
  });
  RK.on("mudou", (o) => {
    SIM.velho = true;
    if (SIM.emReplay) pararReplay(false);
    if (RK.aba === "sim" && SIM.D) simular();
  });
  RK.on("aba", (nome) => {
    if (nome !== "sim") { if (SIM.rodando) tocar(false); return; }       // saiu da aba: pausa o replay
    if (SIM.D && SIM.velho) { simular(); return; }
    if (SIM.D) {
      RK.mostrar(SIM.D, SIM.k ?? SIM.D.meta.iFim, { manterZoom: RK.graficoMostra() === SIM.D });
      desenharGraficos();
    } else if (RK.vivo.D) {
      textoPeriodo(RK.vivo.D);
      $("simResultado").innerHTML = `<div class="card nota">Clique em <b>Calcular resultado</b> para ver quanto ${RK.esc(RK.nomeEst(RK.pref.est))} teria feito no período, ou em <b>Assistir</b> para ver candle a candle.</div>`;
    }
  });
})();
