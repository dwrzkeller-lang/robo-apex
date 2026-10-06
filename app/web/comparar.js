/* ROBÔ APEX — aba COMPARAR: todas as estratégias em todos os ativos (tempo gráfico e gestão do topo).
   Roda em segundo plano no servidor; a tela só consulta o andamento. Nada começa sozinho. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  let consultando = false;

  function montarAtivos() {
    const marcados = new Set([...$("cmpAtivos").querySelectorAll("input:checked")].map((x) => x.value)), primeira = !$("cmpAtivos").children.length;
    const lista = AX.cfg.ativos.filter((a) => !a.chave.startsWith("CSV:")).concat(AX.pref.criptos || []);
    $("cmpAtivos").innerHTML = lista.map((a) => `<label class="chk" title="${AX.esc(a.nome)}"><input type="checkbox" value="${AX.esc(a.chave)}" ${primeira ? (AX.ehCripto(a.chave) ? "" : "checked") : marcados.has(a.chave) ? "checked" : ""}> ${AX.esc(AX.ehCripto(a.chave) ? AX.nomeCripto(a.chave).replace("/USDT", "") : a.chave)}</label>`).join("");
  }
  AX.on("config", montarAtivos);
  AX.on("aba", (nome) => { if (nome === "cmp") montarAtivos(); });

  async function comparar() {
    AX.erro("erroCmp", null);
    const ativos = [...$("cmpAtivos").querySelectorAll("input:checked")].map((x) => x.value);
    if (!ativos.length) return AX.erro("erroCmp", new Error("Marque pelo menos um ativo."));
    try {
      const r = await AX.json("/api/comparar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativos, tf: AX.pref.tf, gestao: AX.pref.gestao, maxstops: AX.pref.maxstops, seletivo: !!AX.pref.seletivo,
          per: AX.pref.per === "custom" ? "tudo" : AX.pref.per,
          de: AX.pref.per === "custom" ? AX.isoInt(AX.pref.de) : 0, ate: AX.pref.per === "custom" ? AX.isoInt(AX.pref.ate) : 0 }) });
      if (r.jaRodando) AX.toast("A comparação anterior ainda está rodando; mostrando o andamento.", "aviso");
      acompanhar();
    } catch (e) { AX.erro("erroCmp", e); }
  }

  async function acompanhar() {
    if (consultando) return;
    consultando = true;
    $("btComparar").disabled = true;
    try {
      for (;;) {
        const st = await AX.json("/api/comparar");
        render(st);
        if (!st.rodando) break;
        await new Promise((ok) => setTimeout(ok, 700));
      }
    } catch (e) { AX.erro("erroCmp", e); }
    finally { consultando = false; $("btComparar").disabled = false; }
  }

  function render(st) {
    const prog = $("cmpProg");
    prog.classList.toggle("oculto", !st.rodando);
    $("cmpBarra").style.width = st.total ? (100 * st.feito) / st.total + "%" : "0";
    if (st.erro) AX.erro("erroCmp", new Error(st.erro));
    if (!st.pedido || !st.linhas.length) { $("cmpResultado").innerHTML = st.rodando ? `<div class="vazio-bloco">Comparando… ${st.feito}/${st.total}</div>` : ""; return; }
    const p = st.pedido, cods = AX.cfg.estrategias.map((e) => e.cod).concat("TODAS");
    const nomeTf = (AX.cfg.tempos.find((t) => +t.tf === +p.tf) || {}).nome || p.tf;
    const perAtual = AX.pref.per === "custom" ? "tudo" : AX.pref.per;
    const difere = +p.tf !== +AX.pref.tf || p.gestao !== AX.pref.gestao || (p.per || "tudo") !== perAtual;
    const l0 = st.linhas.find((l) => l.dataIni);
    let html = `<div class="card"><div class="rot">RESULTADO · ${AX.esc(nomeTf)}${l0 ? ` · ${AX.dataTxt(l0.dataIni)} a ${AX.dataTxt(l0.dataFim)}` : ""}<span class="dir">${st.feito}/${st.total} ativos</span></div>
      <div class="nota">Gestão: ${AX.esc(AX.cfg.gestoes[p.gestao])}.</div>
      ${difere ? `<div class="nota" style="color:var(--laranja)">Atenção: o topo mudou (tempo, período ou gestão) depois desta comparação. Clique em Comparar para refazer.</div>` : ""}
      <div class="nota">Cada célula: <b>resultado com 1 contrato/lote</b> (líquido de custos, na moeda do ativo), número de operações e acerto. Cor = veredito estatístico.</div>
      <div class="rolagem" style="max-height:none"><table class="tab cmp"><tr><th>Ativo</th>${cods.map((c) => `<th class="n" title="${AX.esc(AX.nomeEst(c))}">${c === "TODAS" ? "TODAS" : c}</th>`).join("")}</tr>`;
    for (const l of st.linhas) {
      if (l.erro) { html += `<tr><td>${AX.esc(l.ativo)}</td><td colspan="${cods.length}" class="ruim">${AX.esc(l.erro)}</td></tr>`; continue; }
      html += `<tr><td title="${AX.esc(l.nome)}"><b>${AX.esc(l.ativo)}</b><br><small class="neutro">${l.dias} dias</small></td>` + cods.map((c) => {
        const s = l.res[c];
        if (!s) return `<td class="cel neutro"><small>não se aplica</small></td>`;
        if (!s.n) return `<td class="cel" data-a="${AX.esc(l.ativo)}" data-e="${c}"><small>sem operações</small></td>`;
        return `<td class="cel ${s.cor}" data-a="${AX.esc(l.ativo)}" data-e="${c}" title="${AX.esc(s.veredito + ": " + s.explica)}"><b class="${AX.cls(s.total)}">${moedaCurta(l.moeda)}${fmtCurto(s.total)}</b><small>${s.n} ops · ${AX.pct(s.acerto, 0)} · ${AX.R(s.expR, 2)}</small></td>`;
      }).join("") + `</tr>`;
    }
    html += `</table></div><div class="legenda-cmp"><span class="selo verde">VANTAGEM ESTATÍSTICA</span><span class="selo amarelo">NÃO COMPROVADA / INSTÁVEL / POUCOS DADOS</span><span class="selo vermelho">NÃO OPERAR</span></div>
      <div class="nota">"Vantagem estatística" = média positiva com a margem de erro acima de zero e positiva nas duas metades do período. Mesmo assim é passado: confirme na Simulação e no simulador da corretora antes de usar dinheiro real.</div></div>`;
    $("cmpResultado").innerHTML = html;
    $("cmpResultado").querySelectorAll("td.cel[data-a]").forEach((td) => (td.onclick = () => abrir(td.dataset.a, td.dataset.e, p)));
  }

  const moedaCurta = (m) => (m === "US$" ? "US$" : "R$");
  const fmtCurto = (v) => (v >= 0 ? " +" : " −") + Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 0 });

  function abrir(ativo, est, p) {
    AX.pref.gestao = p.gestao; AX.pref.tf = +p.tf; AX.pref.ativo = ativo; AX.pref.est = est;
    if (est !== "TODAS") AX.pref.ultEst = est;
    AX.salvarPref();
    AX.atualizarTopo();                                          // selects, contratos/lotes e estratégia
    AX.emit("mudou", "ativo");
    AX.trocarAba("sim");
    $("btSimular").click();
  }

  $("btComparar").onclick = comparar;
  AX.on("aba", (nome) => { if (nome === "cmp" && !consultando) acompanhar(); });   // só mostra o que já existe
})();
