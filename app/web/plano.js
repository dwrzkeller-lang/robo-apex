/* ROBÔ APEX — aba PLANO: as regras de risco que valem para o robô inteiro (tamanho pelo risco, limite de perda e
   meta do dia, modo seletivo), a situação de hoje, o que cada regra fez no período do topo (com × sem) e a conta
   "meta × realidade": o que é provável num mês com as operações que a estratégia realmente fez. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const P = { dados: null, seq: 0, velho: true, timer: null };
  const num = (el, padrao, min, max) => {
    let v = parseFloat(String(el.value).replace(",", "."));
    if (!(v >= min)) v = padrao;
    if (max != null && v > max) v = max;
    el.value = v;
    return v;
  };

  // ---------------------------------------------------------------- formulário
  function mostrarForm() {
    const p = AX.pref, a = AX.infoAtivo(p.ativo) || {};
    $("plCapital").value = p.capital; $("plStops").value = p.maxstops; $("plRisco").value = p.risco;
    $("plLoss").value = p.lossDia || ""; $("plMeta").value = p.metaDia || ""; $("plSeletivo").checked = !!p.seletivo;
    $("plMetaMes").value = p.metaMes || ""; $("plQueda").value = p.quedaMax || "";
    document.querySelectorAll("#plTam button").forEach((b) => b.classList.toggle("on", b.dataset.v === p.tam));
    $("plRiscoBox").classList.toggle("oculto", p.tam !== "risco");
    $("plAtivo").textContent = `${AX.esc(a.chave || p.ativo)} · ${AX.nomeEst(p.est)}`;
  }
  function mudou() { AX.salvarPref(); mostrarForm(); AX.emit("mudou", "plano"); }
  $("plCapital").onchange = (e) => { AX.pref.capital = num(e.target, 10000, 1); mudou(); };
  $("plStops").onchange = (e) => { AX.pref.maxstops = Math.round(num(e.target, 2, 1, 20)); mudou(); };
  $("plRisco").onchange = (e) => { AX.pref.risco = num(e.target, 1, 0.05, 10); mudou(); };
  $("plLoss").onchange = (e) => { AX.pref.lossDia = num(e.target, 0, 0); mudou(); };
  $("plMeta").onchange = (e) => { AX.pref.metaDia = num(e.target, 0, 0); mudou(); };
  $("plSeletivo").onchange = (e) => { AX.pref.seletivo = e.target.checked; mudou(); };
  document.querySelectorAll("#aba-plano input[data-prot]").forEach((c) => {
    c.checked = (AX.pref.prot || []).includes(c.dataset.prot);
    c.onchange = () => {
      const s = new Set(AX.pref.prot || []);
      if (c.checked) s.add(c.dataset.prot); else s.delete(c.dataset.prot);
      AX.pref.prot = [...s].sort(); mudou();
    };
  });
  document.querySelectorAll("#plTam button").forEach((b) => (b.onclick = () => { if (AX.pref.tam !== b.dataset.v) { AX.pref.tam = b.dataset.v; mudou(); } }));
  // a meta do mês e a perda aceita não mudam as operações: só refazem a conta de baixo
  $("plMetaMes").onchange = (e) => { AX.pref.metaMes = num(e.target, 0, 0); AX.salvarPref(); carregar(); };
  $("plQueda").onchange = (e) => { AX.pref.quedaMax = num(e.target, 0, 0); AX.salvarPref(); carregar(); };

  // ---------------------------------------------------------------- servidor
  async function carregar() {
    const seq = ++P.seq;
    AX.erro("erroPlano", null);
    try {
      const d = await AX.json("/api/metas?" + AX.parametros({ metaMes: AX.pref.metaMes || 0, quedaMax: AX.pref.quedaMax || 0 }));
      if (seq !== P.seq) return;
      P.dados = d; P.velho = false;
      render();
    } catch (e) {
      if (seq === P.seq) { AX.erro("erroPlano", e); $("plHoje").innerHTML = $("plEfeitos").innerHTML = $("plProj").innerHTML = ""; }
    }
  }

  // ---------------------------------------------------------------- tamanho pelo risco (a mesma conta do simulador)
  function tamanho(m, capital, entrada, stop) {
    const risco = Math.abs(entrada - stop);
    if (!(risco > 0) || !(capital > 0)) return null;
    const porLote = (risco + (2 * m.custo) / m.valorPonto + 2 * (m.custoPct || 0) * Math.abs(entrada)) * m.valorPonto;
    const orc = (capital * AX.pref.risco) / 100;
    const bruto = orc / porLote;
    const q = m.fracionado ? Math.floor(bruto * 100 + 1e-9) / 100 : Math.floor(bruto + 1e-9);
    return { q, porLote, orc, perda: q * porLote };
  }

  function render() {
    const d = P.dados; if (!d) return;
    const m = d.meta, D = { meta: m }, din = (v, s = false) => AX.dinheiro(v, D, s), p = AX.pref;
    $("plPeriodo").textContent = `${AX.dataTxt(m.dataIni)} a ${AX.dataTxt(m.dataFim)}`;

    // ---- hoje
    const dia = d.dia, V = AX.vivo.D;
    let h = `<div class="rot">HOJE</div>`;
    if (!m.intraday) h += `<div class="nota">No gráfico diário as regras "do dia" (stops, perda e meta) não se aplicam.</div>`;
    else if (!m.aoVivo || !dia) h += `<div class="nota">O período do topo não chega até hoje. Escolha Hoje, 5 dias, 1 mês… para ver a situação do dia.</div>`;
    else {
      h += dia.trava ? `<div class="pl-estado ruim">PARE POR HOJE</div><div class="nota"><b>${AX.esc(dia.trava)}</b>. Resultado do dia: <b class="${AX.cls(dia.resultado)}">${din(dia.resultado, true)}</b>.</div>`
        : `<div class="pl-estado bom">PODE OPERAR</div><div class="nota">Resultado do dia: <b class="${AX.cls(dia.resultado)}">${din(dia.resultado, true)}</b> · ${dia.stops} de ${p.maxstops} stops usados${p.lossDia > 0 ? ` · para em −${din(p.lossDia)}` : ""}${p.metaDia > 0 ? ` · para em +${din(p.metaDia)}` : ""}.</div>`;
    }
    // tamanho para o próximo sinal: o sinal armado agora, ou a calculadora
    const cap = (dia && dia.capital) || m.capital;
    const pend = V && V.meta.ativo === m.ativo && V.meta.aoVivo ? V.ordens.filter((o) => o.status === "pendente").slice(-1)[0] : null;
    const ent0 = pend ? (pend.gatilho != null ? pend.gatilho : V.c[V.meta.iFim]) : "", stop0 = pend ? pend.stop : "";
    h += `<div class="rot" style="margin-top:12px">TAMANHO PELO RISCO <span class="dir">${AX.num(p.risco, 1)}% de ${din(cap)}</span></div>
      <div class="grade2"><label class="campo"><span>Entrada</span><input type="number" id="plEnt" step="any" value="${ent0}"></label>
        <label class="campo"><span>Stop</span><input type="number" id="plStop" step="any" value="${stop0}"></label></div>
      <div class="nota" id="plTamTxt"></div>`;
    $("plHoje").innerHTML = h;
    const contaTam = () => {
      const e = parseFloat($("plEnt").value), s = parseFloat($("plStop").value), t = tamanho(m, cap, e, s);
      $("plTamTxt").innerHTML = !t ? (pend ? "" : "Digite a entrada e o stop de uma operação para ver quantos contratos cabem no risco do plano.")
        : t.q > 0 ? `${pend ? `Sinal armado agora (${pend.est}): ` : ""}<b>${AX.unidade(m, t.q)}</b> · se for stopado perde ${din(t.perda)} (${AX.pct((100 * t.perda) / cap, 1)} do capital), já com os custos.`
          : `<span class="ruim"><b>Não cabe:</b> 1 ${m.fracionado ? "lote mínimo" : "contrato"} perde ${din(m.fracionado ? t.porLote * 0.01 : t.porLote)} no stop, mais que os ${din(t.orc)} do plano. Pelo plano, esta operação não entra.</span>`;
    };
    $("plEnt").oninput = $("plStop").oninput = contaTam; contaTam();

    // ---- o que cada regra fez
    const NOMES = { seletivo: "Modo seletivo", tam: "Tamanho pelo risco", lossDia: "Parar o dia na perda", metaDia: "Parar o dia no ganho",
      prot_corte: "Corte antecipado", prot_forca: "Perdeu força", prot_folga: "Folga no stop", prot_tol: "Tolerância de +20%" };
    const cel = (x) => `<td class="n">${x.n}</td><td class="n ${AX.cls(x.total)}">${din(x.total, true)}</td><td class="n ruim">${din(-x.ddMax)}</td>`;
    let e = `<div class="rot">O QUE CADA REGRA FEZ NO PERÍODO</div>
      <table class="tab"><tr><th>Regra</th><th></th><th class="n">Ops</th><th class="n">Resultado</th><th class="n">Pior queda</th></tr>`;
    for (const x of d.efeitos) {
      e += `<tr><td rowspan="2"><b>${NOMES[x.regra] || x.regra}</b>${x.regra === "seletivo" || x.regra.startsWith("prot_") ? `<br><small class="${x.ligado ? "bom" : "neutro"}">${x.ligado ? "ligado" : "desligado"}</small>` : ""}</td><td>com</td>${cel(x.com)}</tr><tr><td>sem</td>${cel(x.sem)}</tr>`;
    }
    e += `</table>`;
    const sel = d.efeitos.find((x) => x.regra === "seletivo");
    if (sel) e += `<div class="nota">Modo seletivo: nos testes com 41 mil operações em 12 ativos ele reduziu muito o número de operações e melhorou a média nos gráficos de 5 e de 60 min dos ativos de custo baixo; em 15 min não fez diferença. Os scripts do Profit não têm esse filtro.</div>`;
    if (d.efeitos.some((x) => x.regra === "metaDia")) e += `<div class="nota">Meta de ganho do dia: não achei estudo que mostre que ela ajuda. Em estratégia de tendência ela costuma cortar justamente os dias que pagam os outros; confira na linha acima.</div>`;
    $("plEfeitos").innerHTML = e;

    // ---- meta x realidade
    const j = d.proj;
    let t = "";
    if (j.vazio) t = `<div class="nota">Período curto demais para projetar um mês: <b>${j.ops} operações em ${j.dias} dias</b>. Com tão pouco, qualquer conta seria enganação. Escolha <b>3 meses</b> ou <b>Tudo</b> no topo (precisa de pelo menos 20 dias e 20 operações).</div>`;
    else {
      const mes = j.diasMes === 30 ? "30 dias" : "um mês (21 pregões)";
      t += `<div class="pl-linha"><span>Um mês típico</span><b class="${AX.cls(j.p50)}">${din(j.p50, true)}</b></div>
        <div class="nota">Em 8 de cada 10 cenários ${mes} fica entre <b>${din(j.p10, true)}</b> e <b>${din(j.p90, true)}</b>. Chance de terminar no prejuízo: <b>${AX.pct(j.chanceNegativo, 0)}</b>. Conta feita com as ${j.ops} operações reais do período (${j.dias} dias), sorteando dias inteiros.</div>`;
      if (j.chanceMeta != null) t += `<div class="pl-linha"><span>Chance de bater ${din(j.metaMes)} no mês</span><b class="${j.chanceMeta >= 50 ? "bom" : j.chanceMeta >= 20 ? "" : "ruim"}">${AX.pct(j.chanceMeta, 0)}</b></div>`;
      if (j.chanceQueda != null) t += `<div class="pl-linha"><span>Chance de passar por uma queda de ${din(j.quedaMax)}</span><b class="${j.chanceQueda >= 30 ? "ruim" : ""}">${AX.pct(j.chanceQueda, 0)}</b></div>`;
      if (j.metaMes > 0) {
        t += j.fatorMeta == null
          ? `<div class="aviso-custo">Neste período a estratégia perdeu em média ${din(-j.mediaMes)} por mês. Com resultado médio negativo nenhum tamanho faz a meta virar o esperado: bater a meta seria sorte. Teste outro tempo gráfico, outra estratégia, o modo seletivo, ou fique de fora.</div>`
          : `<div class="nota">Para ${din(j.metaMes)} virar o resultado <b>médio</b> seria preciso <b>${AX.num(j.fatorMeta, 1)}×</b> o tamanho de hoje${m.tam === "risco" ? ` (arriscar ${AX.num(m.riscoPct * j.fatorMeta, 1)}% do capital por operação)` : ` (${AX.unidade(m, m.fracionado ? Math.round(m.contratos * j.fatorMeta * 100) / 100 : Math.ceil(m.contratos * j.fatorMeta))})`}, e as quedas crescem junto: até <b>${din(j.quedaNaMeta)}</b> num mês ruim.</div>`;
      }
      const margem = j.erroR != null ? ` ± ${AX.num(j.erroR, 2)}R` : "";
      t += `<div class="pl-linha"><span>Vantagem por operação</span><b class="${AX.cls(j.mediaR)}">${AX.R(j.mediaR)}${margem}</b></div>
        <div class="nota">${j.poucasOps ? "Menos de 30 operações: amostra pequena demais para qualquer conclusão. " : ""}${j.mediaR <= 0 ? "Média negativa: no período a estratégia não teve vantagem. O tamanho certo para uma estratégia sem vantagem é zero."
          : j.comprovada ? "A margem de erro fica acima de zero: há vantagem estatística neste período."
            : "A margem de erro inclui o zero: a vantagem <b>não está comprovada</b> (pode ser sorte). Enquanto não estiver, o prudente é o menor tamanho possível."}
          Hoje cada operação arrisca ${AX.pct(j.riscoPctAtual, 1)} do capital${j.kellyTeto > 0 && j.riscoPctAtual > j.kellyTeto / 2 ? `, <b class="ruim">acima do teto prudente (${AX.pct(j.kellyTeto / 2, 1)})</b>: acima dele o capital tende a encolher mesmo com vantagem` : ""}.
          ${j.mediaR <= 0 ? "Mantendo esse risco numa estratégia sem vantagem, perder metade do capital é questão de tempo."
          : j.comprovada && j.ruinaMetade != null ? `Chance de um dia perder metade do capital mantendo esse risco: <b>${AX.pct(j.ruinaMetade, j.ruinaMetade < 1 ? 2 : 0)}</b>.`
            : "Sem vantagem comprovada não dá para calcular a chance de quebrar: ela pode ser alta."}</div>`;
    }
    $("plProj").innerHTML = t;
  }

  // ---------------------------------------------------------------- ligações
  AX.on("aba", (nome) => { if (nome === "plano") { mostrarForm(); if (P.velho || !P.dados) carregar(); else render(); } });
  AX.on("mudou", (o) => {
    P.velho = true;
    if (AX.aba !== "plano") return;
    mostrarForm();
    clearTimeout(P.timer); P.timer = setTimeout(carregar, o === "plano" ? 50 : 400);
  });
  AX.on("dadosVivo", () => { if (AX.aba === "plano" && P.dados && !P.velho) render(); });      // sinal novo: refaz o "tamanho"
  AX.on("config", mostrarForm);
})();
