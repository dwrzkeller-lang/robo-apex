/* ROBÔ KELLER — botão "⚡ RODAR ROBÔ": estratégia que mais se encaixa no mercado de agora (neste ativo, em
   5/15/60 min) e projeção de ganho/perda por Monte Carlo com as operações reais dela. */
(() => {
  "use strict";
  const RK = window.RK, $ = RK.$;
  const R = { dados: null, chave: "", seq: 0 };

  const chaveAtual = () => [RK.pref.ativo, RK.pref.gestao, RK.pref.contratos, RK.pref.capital, RK.pref.maxstops].join("|");

  async function rodar(forcar = false) {
    RK.trocarAba("vivo");
    const seq = ++R.seq, bt = $("btRobo");
    bt.classList.add("rodando");
    $("radarVivo").innerHTML = `<div class="card radar"><div class="rot">⚡ RODANDO O ROBÔ EM ${RK.esc(RK.pref.ativo)}</div>
      <div class="nota">Testando as ${RK.cfg.estrategias.length} estratégias e o "TODAS juntas" em 5, 15 e 60 min com toda a base (até 5 meses)… pode levar até 30 segundos.</div></div>`;
    try {
      const q = new URLSearchParams({ ativo: RK.pref.ativo, gestao: RK.pref.gestao, contratos: RK.pref.contratos,
        capital: RK.pref.capital, maxstops: RK.pref.maxstops, forcar: forcar ? 1 : 0 });
      const d = await RK.json("/api/radar?" + q);
      if (seq !== R.seq) return;
      R.dados = d; R.chave = chaveAtual();
      render();
    } catch (e) {
      if (seq === R.seq) $("radarVivo").innerHTML = `<div class="erro">⚠ ${RK.esc(e.message)}</div>`;
    } finally {
      if (seq === R.seq) bt.classList.remove("rodando");
    }
  }

  const din = (v, s = true) => RK.dinheiro(v, { meta: { moeda: R.dados.moeda } }, s);
  const nomeTf = (tf) => (+tf >= 1440 ? "Diário" : tf + " min");

  function caixaProj(titulo, p) {
    if (!p) return `<div><small>${titulo}</small><b class="neutro">—</b><em>sem operações suficientes</em></div>`;
    return `<div><small>${titulo} · ~${p.ops} operações</small>
      <b class="${RK.cls(p.p50)}">${din(p.p50)}</b><em>resultado mais provável (mediana)</em>
      <em>80% dos cenários entre <span class="${RK.cls(p.p10)}">${din(p.p10)}</span> e <span class="${RK.cls(p.p90)}">${din(p.p90)}</span></em>
      <em>chance de terminar no prejuízo: <b class="${p.chancePerda > 40 ? "ruim" : p.chancePerda > 25 ? "" : "bom"}">${RK.pct(p.chancePerda, 0)}</b> · queda no caminho de até ${din(-p.quedaP90, false)} (9 em 10 cenários)</em></div>`;
  }

  function render() {
    const d = R.dados;
    if (!d) return;
    const velho = R.chave !== chaveAtual();
    const melhores = {};
    for (const m of d.linhas) if (d.melhorTf[m.est] === m.tf) melhores[m.est] = m;
    const esc = d.escolha && d.linhas.find((m) => m.est === d.escolha.est && m.tf === d.escolha.tf);
    const quando = new Date(d.calculado * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    let html = `<div class="card radar ${esc ? "" : "nenhuma"}"><div class="rot">⚡ ESTRATÉGIA DO MOMENTO · ${RK.esc(d.ativo)} <span class="dir">calculado às ${quando} <button class="mini-btn" id="radarRefaz">refazer</button></span></div>`;
    if (velho) html += `<div class="nota" style="color:var(--laranja)">Você mudou o ativo, a gestão ou os contratos: clique em ⚡ RODAR ROBÔ de novo.</div>`;
    if (esc) {
      html += `<div class="top"><span class="titulo-est">${esc.est} · ${RK.esc(RK.nomeEst(esc.est))}</span><span class="tf">em ${nomeTf(esc.tf)}</span>
        <button class="mini-btn primario" id="radarUsar">Usar esta</button></div>
        <div class="nota">${RK.esc(d.texto)}</div>
        <div class="kpis"><div><small>Últimos ${d.diasRecentes} pregões</small><b class="${RK.cls(esc.rec.total)}">${din(esc.rec.total)}</b><em>${esc.rec.n} ops · acerto ${RK.pct(esc.rec.acerto, 0)}</em></div>
        <div><small>Base toda (${esc.dias} dias)</small><b class="${RK.cls(esc.total)}">${din(esc.total)}</b><em>${esc.n} ops · acerto ${RK.pct(esc.acerto, 0)}</em></div>
        <div><small>Veredito</small>${RK.seloCurto(esc)}<em>${RK.esc(esc.explica || "")}</em></div></div>
        <div class="proj">${caixaProj("Próximo mês", esc.proj1m)}${caixaProj("Até 31/12", esc.projAno)}</div>`;
    } else {
      html += `<div class="top"><span class="titulo-est">FICAR DE FORA</span></div><div class="nota">${RK.esc(d.texto)}</div>`;
      const td = melhores.TODAS;
      if (td) html += `<div class="proj">${caixaProj("TODAS juntas · próximo mês", td.proj1m)}${caixaProj("TODAS juntas · até 31/12", td.projAno)}</div>`;
    }
    const lista = Object.values(melhores).sort((a, b) => b.encaixe - a.encaixe);
    html += `<div class="rot" style="margin-top:10px">TODAS AS ESTRATÉGIAS NO MELHOR TEMPO GRÁFICO DE CADA UMA</div><div class="rolagem"><table class="tab">
      <tr><th>Estratégia</th><th>Tempo</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Últ. ${d.diasRecentes} pregões</th><th class="n">Base toda</th><th class="n">Mês (mediana)</th></tr>` +
      lista.map((m) => `<tr class="clic ${esc && m === esc ? "escolha" : ""}" data-est="${m.est}" data-tf="${m.tf}" title="${RK.esc(m.veredito || "")}">
        <td class="nome">${m.est === "TODAS" ? "TODAS juntas" : m.est + " " + RK.esc(RK.nomeEst(m.est))}</td><td>${nomeTf(m.tf)}</td><td class="n">${m.n}</td><td class="n">${RK.pct(m.acerto, 0)}</td>
        <td class="n ${RK.cls(m.rec.total)}">${din(m.rec.total)}</td><td class="n ${RK.cls(m.total)}">${din(m.total)}</td>
        <td class="n ${m.proj1m ? RK.cls(m.proj1m.p50) : ""}">${m.proj1m ? din(m.proj1m.p50) : "—"}</td></tr>`).join("") +
      `</table></div><div class="nota">Clique numa linha para usar a estratégia no tempo gráfico dela. Estratégias com menos de 20 operações não entram.
      Projeção = sorteio (Monte Carlo) das operações reais que a estratégia fez, no ritmo de operações por dia dela; é estatística do passado, não promessa.
      Fontes: ${Object.entries(d.fontes).map(([tf, f]) => nomeTf(tf) + ": " + RK.esc(f)).join(" · ")}</div></div>`;
    $("radarVivo").innerHTML = html;
    const usar = (est, tf) => { RK.escolherTf(tf); RK.escolherEst(est); RK.toast(`Usando ${est === "TODAS" ? "TODAS juntas" : est + " " + RK.nomeEst(est)} em ${nomeTf(tf)}`, "ok"); };
    if ($("radarUsar")) $("radarUsar").onclick = () => usar(esc.est, esc.tf);
    $("radarRefaz").onclick = () => rodar(true);
    $("radarVivo").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => usar(tr.dataset.est, +tr.dataset.tf)));
  }

  RK.on("rodarRobo", () => rodar(false));
  RK.on("mudou", () => { if (R.dados) render(); });
})();
