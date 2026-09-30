/* ROBÔ KELLER — aba COMPARAR: todas as estratégias em todos os ativos (tempo gráfico e gestão do topo).
   Roda em segundo plano no servidor; a tela só consulta o andamento. Nada começa sozinho. */
(() => {
  "use strict";
  const RK = window.RK, $ = RK.$;
  let consultando = false;

  RK.on("config", (cfg) => {
    $("cmpAtivos").innerHTML = cfg.ativos.filter((a) => !a.chave.startsWith("CSV:"))
      .map((a) => `<label class="chk"><input type="checkbox" value="${RK.esc(a.chave)}" checked> ${RK.esc(a.chave)}</label>`).join("");
  });

  async function comparar() {
    RK.erro("erroCmp", null);
    const ativos = [...$("cmpAtivos").querySelectorAll("input:checked")].map((x) => x.value);
    if (!ativos.length) return RK.erro("erroCmp", new Error("Marque pelo menos um ativo."));
    try {
      const r = await RK.json("/api/comparar", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ativos, tf: RK.pref.tf, gestao: RK.pref.gestao, maxstops: RK.pref.maxstops }) });
      if (r.jaRodando) RK.toast("A comparação anterior ainda está rodando; mostrando o andamento.", "aviso");
      acompanhar();
    } catch (e) { RK.erro("erroCmp", e); }
  }

  async function acompanhar() {
    if (consultando) return;
    consultando = true;
    $("btComparar").disabled = true;
    try {
      for (;;) {
        const st = await RK.json("/api/comparar");
        render(st);
        if (!st.rodando) break;
        await new Promise((ok) => setTimeout(ok, 700));
      }
    } catch (e) { RK.erro("erroCmp", e); }
    finally { consultando = false; $("btComparar").disabled = false; }
  }

  function render(st) {
    const prog = $("cmpProg");
    prog.classList.toggle("oculto", !st.rodando);
    $("cmpBarra").style.width = st.total ? (100 * st.feito) / st.total + "%" : "0";
    if (st.erro) RK.erro("erroCmp", new Error(st.erro));
    if (!st.pedido || !st.linhas.length) { $("cmpResultado").innerHTML = st.rodando ? `<div class="vazio-bloco">Comparando… ${st.feito}/${st.total}</div>` : ""; return; }
    const p = st.pedido, cods = RK.cfg.estrategias.map((e) => e.cod).concat("TODAS");
    const nomeTf = (RK.cfg.tempos.find((t) => +t.tf === +p.tf) || {}).nome || p.tf;
    const difere = +p.tf !== +RK.pref.tf || p.gestao !== RK.pref.gestao;
    let html = `<div class="card"><div class="rot">RESULTADO · ${RK.esc(nomeTf)} · ${RK.esc(RK.cfg.gestoes[p.gestao])}<span class="dir">${st.feito}/${st.total} ativos</span></div>
      ${difere ? `<div class="nota" style="color:var(--laranja)">Atenção: esta tabela é de ${RK.esc(nomeTf)} / ${RK.esc(RK.cfg.gestoes[p.gestao])}; o topo está em outra configuração. Clique em Comparar para refazer.</div>` : ""}
      <div class="nota">Cada célula: <b>resultado com 1 contrato/lote</b> (líquido de custos, na moeda do ativo), número de operações e acerto. Cor = veredito estatístico.</div>
      <div class="rolagem" style="max-height:none"><table class="tab cmp"><tr><th>Ativo</th>${cods.map((c) => `<th class="n" title="${RK.esc(RK.nomeEst(c))}">${c === "TODAS" ? "TODAS" : c}</th>`).join("")}</tr>`;
    for (const l of st.linhas) {
      if (l.erro) { html += `<tr><td>${RK.esc(l.ativo)}</td><td colspan="${cods.length}" class="ruim">${RK.esc(l.erro)}</td></tr>`; continue; }
      html += `<tr><td title="${RK.esc(l.nome)}"><b>${RK.esc(l.ativo)}</b><br><small class="neutro">${l.dias} dias</small></td>` + cods.map((c) => {
        const s = l.res[c];
        if (!s) return `<td class="cel neutro"><small>não se aplica</small></td>`;
        if (!s.n) return `<td class="cel" data-a="${RK.esc(l.ativo)}" data-e="${c}"><small>sem operações</small></td>`;
        return `<td class="cel ${s.cor}" data-a="${RK.esc(l.ativo)}" data-e="${c}" title="${RK.esc(s.veredito + ": " + s.explica)}"><b class="${RK.cls(s.total)}">${moedaCurta(l.moeda)}${fmtCurto(s.total)}</b><small>${s.n} ops · ${RK.pct(s.acerto, 0)} · ${RK.R(s.expR, 2)}</small></td>`;
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
    RK.pref.ativo = ativo; RK.pref.est = est; RK.pref.tf = +p.tf; RK.pref.gestao = p.gestao; RK.salvarPref();
    $("ativo").value = ativo; $("tf").value = p.tf; $("gestao").value = p.gestao;
    $("ativo").dispatchEvent(new Event("change"));             // ajusta contratos/lotes e avisa as outras abas
    RK.marcarEst();
    RK.trocarAba("sim");
    $("simDe").value = ""; $("simAte").value = "";
    $("btSimular").click();
  }

  $("btComparar").onclick = comparar;
  RK.on("aba", (nome) => { if (nome === "cmp" && !consultando) acompanhar(); });   // só mostra o que já existe
})();
