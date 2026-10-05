/* ROBÔ KELLER — botão "⚡ RODAR ROBÔ": estratégia que mais se encaixa no mercado de agora (neste ativo, em
   5/15/60 min) e projeção de ganho/perda por Monte Carlo com as operações reais dela.
   O resultado abre numa janela; na aba Ao vivo fica só um aviso curto ("estratégia do momento"). */
(() => {
  "use strict";
  const RK = window.RK, $ = RK.$;
  const R = { dados: null, chave: "", seq: 0 };

  const chaveAtual = () => [RK.pref.ativo, RK.pref.gestao, RK.pref.contratos, RK.pref.capital, RK.pref.maxstops, JSON.stringify(RK.planoParams())].join("|");
  const abrirJanela = () => $("modalRobo").classList.remove("oculto");
  const fecharJanela = () => $("modalRobo").classList.add("oculto");

  async function rodar(forcar = false) {
    const seq = ++R.seq, bt = $("btRobo");
    bt.classList.add("rodando"); bt.disabled = true;
    abrirJanela();
    $("roboConteudo").innerHTML = `<div class="rot">⚡ RODANDO O ROBÔ EM ${RK.esc(RK.rotAtivo(RK.pref.ativo))}</div>
      <div class="radar-nome" style="font-size:16px">Testando as ${RK.cfg.estrategias.length} estratégias e o "TODAS juntas" em 5, 15 e 60 min…</div>
      <div class="nota">Usa toda a base (até 5 meses). Pode levar até 30 segundos.</div>`;
    try {
      const q = new URLSearchParams(Object.assign({ ativo: RK.pref.ativo, gestao: RK.pref.gestao, contratos: RK.pref.contratos,
        capital: RK.pref.capital, maxstops: RK.pref.maxstops, forcar: forcar ? 1 : 0 }, RK.planoParams()));
      const d = await RK.json("/api/radar?" + q);
      if (seq !== R.seq) return;
      R.dados = d; R.chave = chaveAtual();
      render(); chip();
    } catch (e) {
      if (seq === R.seq) $("roboConteudo").innerHTML = `<div class="erro">⚠ ${RK.esc(e.message)}</div>`;
    } finally {
      if (seq === R.seq) { bt.classList.remove("rodando"); bt.disabled = false; }
    }
  }

  const din = (v, s = true) => RK.dinheiro(v, { meta: { moeda: R.dados.moeda } }, s);
  const nomeTf = (tf) => (+tf >= 1440 ? "Diário" : tf + " min");
  const escolhida = () => R.dados && R.dados.escolha && R.dados.linhas.find((m) => m.est === R.dados.escolha.est && m.tf === R.dados.escolha.tf);

  function caixaProj(titulo, p) {
    if (!p) return `<div><small>${titulo}</small><b class="neutro">—</b><em>sem operações suficientes</em></div>`;
    return `<div><small>${titulo} · ~${p.ops} operações</small>
      <b class="${RK.cls(p.p50)}">${din(p.p50)}</b><em>resultado mais provável</em>
      <em>8 em 10 cenários entre <span class="${RK.cls(p.p10)}">${din(p.p10)}</span> e <span class="${RK.cls(p.p90)}">${din(p.p90)}</span></em>
      <em>chance de terminar no prejuízo: <b class="${p.chancePerda > 40 ? "ruim" : p.chancePerda > 25 ? "" : "bom"}">${RK.pct(p.chancePerda, 0)}</b></em>
      <em>queda no caminho de até ${din(-p.quedaP90, false)} (9 em 10 cenários)</em></div>`;
  }

  // aviso curto na aba Ao vivo
  function chip() {
    const el = $("chipRobo"), d = R.dados;
    if (!d || d.ativo !== RK.pref.ativo) { el.innerHTML = ""; return; }
    const esc = escolhida();
    el.innerHTML = `<div class="chip-robo" id="chipAbre" title="Ver o resultado do robô">⚡ ${esc
      ? `Momento: <b>${esc.est} ${RK.esc(RK.nomeEst(esc.est))}</b> · ${nomeTf(esc.tf)}`
      : `Robô: <b>ficar de fora</b> em ${RK.esc(RK.rotAtivo(d.ativo))} agora`}<span class="dir">ver ›</span></div>`;
    $("chipAbre").onclick = () => { render(); abrirJanela(); };
  }

  function render() {
    const d = R.dados;
    if (!d) return;
    const velho = R.chave !== chaveAtual();
    const melhores = {};
    for (const m of d.linhas) if (d.melhorTf[m.est] === m.tf) melhores[m.est] = m;
    const esc = escolhida();
    const quando = RK.horaBR(d.calculado);
    let html = `<div class="rot">⚡ ESTRATÉGIA DO MOMENTO · ${RK.esc(RK.rotAtivo(d.ativo))} <span class="dir">calculado às ${quando} · <button class="mini-btn" id="radarRefaz">refazer</button></span></div>`;
    if (velho) html += `<div class="nota" style="color:var(--laranja)">Você mudou o ativo, a gestão, os contratos ou o plano: clique em "refazer".</div>`;
    if (d.seletivo || d.tam === "risco") html += `<div class="nota">Com o plano: ${[d.seletivo ? "modo seletivo" : "", d.tam === "risco" ? "tamanho pelo risco (" + RK.num(d.riscoPct, 1) + "% por operação)" : ""].filter(Boolean).join(" · ")}.</div>`;
    if (esc) {
      html += `<div class="resumo-topo"><div><div class="radar-nome">${esc.est} · ${RK.esc(RK.nomeEst(esc.est))}</div>
          <div class="sub">em ${nomeTf(esc.tf)} · ${RK.esc(d.texto)}</div></div>
          <button class="primario" id="radarUsar">Usar esta</button></div>
        <div class="kpis"><div><small>Últimos ${d.diasRecentes} pregões</small><b class="${RK.cls(esc.rec.total)}">${din(esc.rec.total)}</b><em>${esc.rec.n} ops · acerto ${RK.pct(esc.rec.acerto, 0)}</em></div>
          <div><small>Base toda (${esc.dias} dias)</small><b class="${RK.cls(esc.total)}">${din(esc.total)}</b><em>${esc.n} ops · acerto ${RK.pct(esc.acerto, 0)}</em></div>
          <div><small>Veredito</small><b>${RK.seloCurto(esc)}</b><em>${RK.esc(esc.veredito || "")}</em></div></div>
        <div class="proj">${caixaProj("Próximo mês", esc.proj1m)}${caixaProj("Até 31/12", esc.projAno)}</div>`;
    } else {
      html += `<div class="radar-nome nada">FICAR DE FORA</div><div class="nota">${RK.esc(d.texto)}</div>`;
      const td = melhores.TODAS;
      if (td) html += `<div class="proj">${caixaProj("TODAS juntas · próximo mês", td.proj1m)}${caixaProj("TODAS juntas · até 31/12", td.projAno)}</div>`;
    }
    const lista = Object.values(melhores).sort((a, b) => b.encaixe - a.encaixe);
    html += `<details style="margin-top:10px"><summary>Todas as estratégias no melhor tempo gráfico de cada uma</summary><div class="rolagem" style="margin-top:6px"><table class="tab">
      <tr><th>Estratégia</th><th>Tempo</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n" title="Quanto do risco de cada operação vai embora em taxa e escorregamento">Custo</th><th class="n">Últ. ${d.diasRecentes} pregões</th><th class="n">Base toda</th><th class="n">Mês (provável)</th></tr>` +
      lista.map((m) => `<tr class="clic ${esc && m === esc ? "escolha" : ""}" data-est="${m.est}" data-tf="${m.tf}" title="${RK.esc(m.veredito || "")}">
        <td class="nome">${m.est === "TODAS" ? "TODAS juntas" : m.est + " " + RK.esc(RK.nomeEst(m.est))}</td><td>${nomeTf(m.tf)}</td><td class="n">${m.n}</td><td class="n">${RK.pct(m.acerto, 0)}</td><td class="n ${m.custoR >= 0.15 ? "ruim" : ""}">${m.custoR == null ? "—" : RK.pct(100 * m.custoR, 0)}</td>
        <td class="n ${RK.cls(m.rec.total)}">${din(m.rec.total)}</td><td class="n ${RK.cls(m.total)}">${din(m.total)}</td>
        <td class="n ${m.proj1m ? RK.cls(m.proj1m.p50) : ""}">${m.proj1m ? din(m.proj1m.p50) : "—"}</td></tr>`).join("") +
      `</table></div><div class="nota">Clique numa linha para usar a estratégia no tempo gráfico dela. Estratégias com menos de 20 operações não entram.</div></details>
      <div class="nota">Projeção = sorteio (Monte Carlo) das operações reais que a estratégia fez, no ritmo dela; é estatística do passado, não promessa.</div>`;
    $("roboConteudo").innerHTML = html;
    const usar = (est, tf) => {
      RK.escolherTf(tf); RK.escolherEst(est); fecharJanela(); RK.trocarAba("vivo");
      RK.toast(`Usando ${RK.nomeEst(est)} em ${nomeTf(tf)}`, "ok");
    };
    if ($("radarUsar")) $("radarUsar").onclick = () => usar(esc.est, esc.tf);
    $("radarRefaz").onclick = () => rodar(true);
    $("roboConteudo").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => usar(tr.dataset.est, +tr.dataset.tf)));
  }

  $("roboFechar").onclick = fecharJanela;
  $("modalRobo").addEventListener("pointerdown", (e) => { if (e.target.id === "modalRobo") fecharJanela(); });
  RK.on("tecla", (e) => { if (e.key === "Escape") fecharJanela(); });
  RK.on("rodarRobo", () => rodar(false));
  RK.on("mudou", () => chip());
})();
