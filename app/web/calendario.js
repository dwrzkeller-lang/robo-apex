/* ROBÔ KELLER — aba CALENDÁRIO: resultado de cada dia (e de cada operação) do robô no ativo e tempo gráfico
   do topo, usando toda a base carregada. Com "TODAS juntas" dá para ver cada estratégia sozinha. */
(() => {
  "use strict";
  const RK = window.RK, $ = RK.$;
  const C = { mes: null, dia: null, filtro: "junto" };
  const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

  // operações no formato único {est, dir, i_ent, i_sai, R, dinheiro, motivo, ent, sai}
  function operacoes(D) {
    if (C.filtro === "junto" || D.meta.est !== "TODAS" || !D.porEst || !D.porEst[C.filtro]) return D.trades.map((t) => Object.assign({}, t));
    return D.porEst[C.filtro].ops.map(([i_ent, i_sai, dir, R, dinheiro, motivo, ent, sai]) => ({ est: C.filtro, i_ent, i_sai, dir, R, dinheiro, motivo, ent, sai }));
  }

  function montarFiltro(D) {
    const sel = $("calFiltro"), atual = C.filtro;
    let ops = [];
    if (D.meta.est === "TODAS") {
      ops.push(["junto", "TODAS juntas (como o robô operaria: uma operação por vez)"]);
      for (const c of Object.keys(D.porEst || {})) ops.push([c, `${c} ${RK.nomeEst(c)} sozinha`]);
    } else ops.push(["junto", `${D.meta.est} ${RK.nomeEst(D.meta.est)}`]);
    sel.innerHTML = ops.map(([v, t]) => `<option value="${v}">${RK.esc(t)}</option>`).join("");
    C.filtro = ops.some(([v]) => v === atual) ? atual : "junto";
    sel.value = C.filtro;
  }

  function render() {
    const D = RK.vivo.D;
    if (!D) { $("calGrade").innerHTML = `<div class="vazio-bloco" style="grid-column:1/-1">Carregando os dados…</div>`; return; }
    montarFiltro(D);
    const m = D.meta;
    $("calFonteTxt").textContent = `${RK.rotAtivo(m.ativo)} · ${m.nomeTf} · ${m.tam === "risco" ? "risco de " + RK.num(m.riscoPct, 1) + "%" : RK.num(m.contratos, m.fracionado ? 2 : 0) + (m.fracionado ? " lote(s)" : " contrato(s)")}`;
    const ops = operacoes(D);
    // resultado por dia (dia da saída = dia em que o dinheiro entra/sai)
    const porDia = new Map();
    for (const t of ops) {
      const d = D.d[t.i_sai];
      const x = porDia.get(d) || { total: 0, n: 0, g: 0, ops: [] };
      x.total += t.dinheiro; x.n++; if (t.R > 0) x.g++; x.ops.push(t);
      porDia.set(d, x);
    }
    const meses = [...new Set([...porDia.keys()].map((d) => Math.floor(d / 100)))].sort();
    if (!meses.length) {
      $("calMeses").innerHTML = ""; $("calTitulo").textContent = "—";
      $("calGrade").innerHTML = `<div class="vazio-bloco" style="grid-column:1/-1">Nenhuma operação nesta seleção.</div>`;
      $("calResumo").innerHTML = ""; $("calDia").innerHTML = "";
      return;
    }
    if (!C.mes || !meses.includes(C.mes)) C.mes = meses[meses.length - 1];
    // atalhos por mês
    $("calMeses").innerHTML = meses.map((ym) => {
      let tot = 0; for (const [d, x] of porDia) if (Math.floor(d / 100) === ym) tot += x.total;
      return `<button data-m="${ym}" class="${ym === C.mes ? "on" : ""}">${NOMES_MES[ym % 100 - 1].slice(0, 3)}/${String(ym).slice(2, 4)} <span class="${RK.cls(tot)}">${RK.dinheiro(tot, D, true)}</span></button>`;
    }).join("");
    $("calMeses").querySelectorAll("button").forEach((b) => (b.onclick = () => { C.mes = +b.dataset.m; C.dia = null; render(); }));
    const ano = Math.floor(C.mes / 100), mes = C.mes % 100;
    $("calTitulo").textContent = `${NOMES_MES[mes - 1]} de ${ano}`;
    $("calAnt").disabled = meses.indexOf(C.mes) <= 0;
    $("calProx").disabled = meses.indexOf(C.mes) >= meses.length - 1;
    $("calAnt").onclick = () => { C.mes = meses[meses.indexOf(C.mes) - 1]; C.dia = null; render(); };
    $("calProx").onclick = () => { C.mes = meses[meses.indexOf(C.mes) + 1]; C.dia = null; render(); };
    // grade
    const primeiro = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();          // 0 = domingo
    const ndias = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    let html = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"].map((x) => `<div class="cab">${x}</div>`).join("");
    for (let k = 0; k < primeiro; k++) html += `<div class="dia vazio"></div>`;
    let tot = 0, n = 0, g = 0, diasPos = 0, diasNeg = 0, melhor = null, pior = null;
    for (let dd = 1; dd <= ndias; dd++) {
      const chave = C.mes * 100 + dd, x = porDia.get(chave);
      if (x) {
        tot += x.total; n += x.n; g += x.g;
        if (x.total > 0) diasPos++; else diasNeg++;
        if (!melhor || x.total > melhor[1]) melhor = [dd, x.total];
        if (!pior || x.total < pior[1]) pior = [dd, x.total];
      }
      const cls = x ? (x.total > 0 ? "tem pos" : x.total < 0 ? "tem neg" : "tem") : "";
      html += `<div class="dia ${cls} ${C.dia === chave ? "sel" : ""}" data-d="${chave}"><span class="n">${dd}</span>` +
        (x ? `<b class="${RK.cls(x.total)}">${RK.dinheiro(x.total, D, true).replace(/,\d\d$/, "")}</b><small>${x.n} op · ${x.g}✓</small>` : "") + `</div>`;
    }
    $("calGrade").innerHTML = html;
    $("calGrade").querySelectorAll(".dia.tem").forEach((el) => (el.onclick = () => { C.dia = +el.dataset.d; render(); }));
    // resumo do mês (+ cada estratégia sozinha quando for TODAS)
    let res = `<div class="card"><div class="rot">RESUMO DE ${NOMES_MES[mes - 1].toUpperCase()}</div><div class="kpis">
      <div><small>Resultado</small><b class="${RK.cls(tot)}">${RK.dinheiro(tot, D, true)}</b></div>
      <div><small>Operações</small><b>${n}</b><em>acerto ${RK.pct(n ? (100 * g) / n : null, 0)}</em></div>
      <div><small>Dias</small><b><span class="bom">${diasPos}</span> / <span class="ruim">${diasNeg}</span></b><em>positivos / negativos</em></div>
      <div><small>Melhor dia</small><b class="bom">${melhor ? RK.dinheiro(melhor[1], D, true) : "—"}</b><em>${melhor ? "dia " + melhor[0] : ""}</em></div>
      <div><small>Pior dia</small><b class="ruim">${pior ? RK.dinheiro(pior[1], D, true) : "—"}</b><em>${pior ? "dia " + pior[0] : ""}</em></div>
      <div><small>Média por dia operado</small><b class="${RK.cls(tot)}">${RK.dinheiro((diasPos + diasNeg) ? tot / (diasPos + diasNeg) : 0, D, true)}</b></div></div>`;
    if (m.est === "TODAS" && D.porEst) {
      res += `<div class="rot" style="margin-top:10px">CADA ESTRATÉGIA SOZINHA NESTE MÊS</div><table class="tab"><tr><th>Estratégia</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Resultado</th></tr>` +
        Object.entries(D.porEst).map(([c, r]) => {
          const os = r.ops.filter((o) => Math.floor(D.d[o[1]] / 100) === C.mes);
          const t = os.reduce((a, o) => a + o[4], 0), gg = os.filter((o) => o[3] > 0).length;
          return `<tr class="clic" data-f="${c}"><td class="nome">${c} ${RK.esc(RK.nomeEst(c))}</td><td class="n">${os.length}</td><td class="n">${RK.pct(os.length ? (100 * gg) / os.length : null, 0)}</td><td class="n ${RK.cls(t)}">${RK.dinheiro(t, D, true)}</td></tr>`;
        }).join("") + `</table><div class="nota">Clique numa estratégia para ver o calendário só dela.</div>`;
    }
    res += `</div>`;
    $("calResumo").innerHTML = res;
    $("calResumo").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => { C.filtro = tr.dataset.f; C.dia = null; render(); }));
    // operações do dia escolhido
    const x = C.dia && porDia.get(C.dia);
    $("calDia").innerHTML = x ? `<div class="card"><div class="rot">OPERAÇÕES DE ${RK.dataTxt(C.dia)} <span class="dir ${RK.cls(x.total)}">${RK.dinheiro(x.total, D, true)}</span></div>
      <div class="rolagem"><table class="tab"><tr><th>Entrada</th><th>Saída</th><th>Est.</th><th></th><th class="n">Preço</th><th class="n">Saída</th><th>Motivo</th><th class="n">R</th><th class="n">Resultado</th></tr>` +
      x.ops.map((t) => `<tr class="clic" data-i="${t.i_ent}"><td>${RK.quando(D, t.i_ent).split(" ").pop()}</td><td>${RK.quando(D, t.i_sai).split(" ").pop()}</td><td>${t.est}</td>
        <td class="${t.dir > 0 ? "bom" : "ruim"}">${t.dir > 0 ? "C" : "V"}</td><td class="n">${RK.fmt(t.ent, D.meta.decimais)}</td><td class="n">${RK.fmt(t.sai, D.meta.decimais)}</td>
        <td>${RK.esc(t.motivo)}</td><td class="n ${RK.cls(t.R)}">${RK.R(t.R)}</td><td class="n ${RK.cls(t.dinheiro)}">${RK.dinheiro(t.dinheiro, D, true)}</td></tr>`).join("") +
      `</table></div><div class="nota">Clique numa operação para vê-la no gráfico.</div></div>` : "";
    $("calDia").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => { if (RK.graficoMostra() !== D) RK.mostrar(D, D.meta.iFim); RK.focar(+tr.dataset.i); }));
  }

  $("calFiltro").onchange = (e) => { C.filtro = e.target.value; C.dia = null; render(); };
  RK.on("aba", (nome) => {
    if (nome !== "cal") return;
    if (RK.vivo.D && !RK.vivo.velho) { if (RK.graficoMostra() !== RK.vivo.D) RK.mostrar(RK.vivo.D, RK.vivo.D.meta.iFim); render(); }
    else RK.carregarVivo();
  });
  RK.on("dadosVivo", () => { if (RK.aba === "cal") setTimeout(render, 0); });
  RK.on("mudou", () => { if (RK.aba === "cal") RK.carregarVivo(); });
})();
