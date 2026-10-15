/* ROBÔ APEX: "Testar estratégia" e "Minhas estratégias" (os dois botões do topo).
   Testar: a estratégia escolhida no ativo do topo, no período do topo, em 5, 15 e 60 minutos, com o resultado mês a mês e
   semana a semana e o que ela está fazendo agora. Dali dá para abrir no gráfico ou ligar o teste ao vivo.
   Minhas estratégias: as favoritas do usuário, cada uma sozinha e todas juntas, e o que cada uma está fazendo agora. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const M = { seq: 0, aba: null, dados: null, tfSel: null };
  const modal = $("modalRobo"), corpo = $("roboConteudo");
  const AGORA = { operacao: ["em operação", "bom"], ordem: ["ordem armada", "alerta"], atencao: ["setup se formando", "alerta"], aguardando: ["aguardando setup", "neutro"] };
  const din = (v, moeda) => AX.dinheiro(v, { meta: { moeda: moeda || "R$" } }, true);
  const tfNome = (tf) => (tf >= 1440 ? "diário" : tf + " min");
  const mesTxt = (m) => ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"][(m % 100) - 1] + "/" + String(Math.floor(m / 100)).slice(2);
  const diaTxt = (d) => String(d % 100).padStart(2, "0") + "/" + String(Math.floor(d / 100) % 100).padStart(2, "0");

  function abrir(html) {
    corpo.innerHTML = html;
    modal.classList.remove("oculto");
  }
  function fechar() { modal.classList.add("oculto"); M.seq++; M.aba = null; }
  $("roboFechar").onclick = fechar;
  modal.addEventListener("pointerdown", (e) => { if (e.target === modal) fechar(); });
  AX.on("tecla", (e) => { if (e.key === "Escape" && !modal.classList.contains("oculto")) fechar(); });
  const carregando = (t) => `<div class="tst-carregando"><i class="giro"></i>${AX.esc(t)}</div>`;
  const aviso = '<div class="nota tst-aviso">Simulação com dados passados, já com custos e escorregamento. É estudo: resultado passado não garante resultado futuro.</div>';

  // ---------------------------------------------------------------- testar esta estratégia
  async function testar(est) {
    const cod = est || (AX.pref.est !== "TODAS" ? AX.pref.est : AX.pref.ultEst);
    const e = AX.cfg.estMap[cod];
    if (!e) return AX.toast("Escolha uma estratégia no topo.", "aviso");
    const seq = ++M.seq;
    M.aba = "testar";
    const titulo = `<div class="tst-cab"><div><small>TESTAR ESTRATÉGIA</small><h2>${AX.esc(cod)} · ${AX.esc(e.nome)}</h2>
      <span>${AX.esc(AX.rotAtivo(AX.pref.ativo))} · período: ${AX.esc(AX.periodoTexto(AX.vivo.D))} · ${AX.unidade(AX.vivo.D ? AX.vivo.D.meta : { fracionado: false }, AX.pref.contratos)}</span></div></div>`;
    abrir(titulo + carregando("Rodando a estratégia em 5, 15 e 60 minutos…"));
    let d;
    try { d = await AX.json("/api/testar?" + AX.parametros({ est: cod }), { tempo: 120000 }); }
    catch (err) { if (seq === M.seq) corpo.innerHTML = titulo + `<div class="erro">⚠ ${AX.esc(err.message)}</div>`; return; }
    if (seq !== M.seq) return;
    M.dados = d;
    M.tfSel = d.tempos.some((x) => x.tf === +AX.pref.tf && !x.erro) ? +AX.pref.tf : (d.tempos.find((x) => !x.erro) || {}).tf;
    pintarTestar(titulo, cod);
  }
  function cartaoTf(x) {
    if (x.erro) return `<div class="tst-tf erro-tf"><small>${tfNome(x.tf)}</small><b class="neutro">sem dados</b><em>${AX.esc(x.erro)}</em></div>`;
    const ag = AGORA[x.agora] || AGORA.aguardando;
    return `<button class="tst-tf ${x.tf === M.tfSel ? "on" : ""}" data-tf="${x.tf}">
      <small>${tfNome(x.tf)}${x.tf === +AX.pref.tf ? " · no gráfico" : ""}</small>
      <b class="${AX.cls(x.total)}">${x.n ? din(x.total, x.moeda) : "sem operações"}</b>
      <em>${x.n} operações · acerto ${AX.pct(x.acerto, 0)}</em>
      <span class="tst-agora ${ag[1]}">● ${ag[0]}</span></button>`;
  }
  function pintarTestar(titulo, cod) {
    const d = M.dados, x = d.tempos.find((y) => y.tf === M.tfSel) || d.tempos[0];
    let h = titulo + `<div class="tst-tfs">${d.tempos.map(cartaoTf).join("")}</div>`;
    if (x && !x.erro) {
      const m = x.moeda;
      h += `<div class="tst-det">
        <div class="tst-kpis">
          <div><small>Resultado</small><b class="${AX.cls(x.total)}">${din(x.total, m)}</b></div>
          <div><small>Ganho médio</small><b class="bom">${din(x.ganhoMedio, m)}</b></div>
          <div><small>Perda média</small><b class="ruim">${din(x.perdaMedia, m)}</b></div>
          <div><small>Pior queda</small><b class="ruim">${din(-x.ddMax, m)}</b></div>
          <div><small>Maior ganho</small><b class="bom">${din(x.maiorGanho, m)}</b></div>
          <div><small>Maior perda</small><b class="ruim">${din(x.maiorPerda, m)}</b></div>
        </div>
        <canvas class="spark tst-curva" id="tstCurva"></canvas>
        <div class="tst-grade">
          <div><div class="rot">MÊS A MÊS</div><table class="tab">${x.meses.length ? x.meses.map((r) => `<tr><td>${mesTxt(r[0])}</td><td class="n">${r[1]} ops</td><td class="n">${AX.pct((100 * r[3]) / r[1], 0)}</td><td class="n ${AX.cls(r[2])}">${din(r[2], m)}</td></tr>`).join("") : '<tr><td class="neutro">sem operações</td></tr>'}</table></div>
          <div><div class="rot">SEMANA A SEMANA</div><table class="tab">${x.semanas.length ? x.semanas.slice().reverse().map((r) => `<tr><td>semana de ${diaTxt(r[0])}</td><td class="n">${r[1]} ops</td><td class="n ${AX.cls(r[2])}">${din(r[2], m)}</td></tr>`).join("") : '<tr><td class="neutro">sem operações</td></tr>'}</table></div>
        </div>
        ${x.ultimas.length ? `<div class="rot">ÚLTIMAS OPERAÇÕES</div><table class="tab">${x.ultimas.map((t) => `<tr><td>${AX.quandoT(t.t_ent, x.intraday)}</td><td class="${t.dir > 0 ? "bom" : "ruim"}">${t.dir > 0 ? "compra" : "venda"}</td><td>${AX.esc(t.motivo)}</td><td class="n ${AX.cls(t.dinheiro)}">${din(t.dinheiro, m)}</td></tr>`).join("")}</table>` : ""}
        ${x.aberta ? `<div class="nota">Agora: ${x.aberta.dir > 0 ? "comprado" : "vendido"} desde ${AX.fmt(x.aberta.ent, x.decimais)}, <b class="${AX.cls(x.aberta.dinheiro)}">${din(x.aberta.dinheiro, m)}</b>.</div>` : ""}
      </div>
      <div class="tst-acoes">
        <button class="primario" id="tstGrafico">Ver no gráfico (${tfNome(x.tf)})</button>
        <button class="secundario" id="tstLigar">▶ Ligar teste ao vivo em ${tfNome(x.tf)}</button>
        <button id="tstFav">${(AX.pref.minhas || []).includes(cod) ? "★ Está nas minhas estratégias" : "☆ Pôr nas minhas estratégias"}</button>
      </div>`;
    }
    h += aviso;
    corpo.innerHTML = h;
    corpo.querySelectorAll(".tst-tf[data-tf]").forEach((b) => (b.onclick = () => { M.tfSel = +b.dataset.tf; pintarTestar(titulo, cod); }));
    if (x && !x.erro) {
      const vals = []; let ant = 0; for (const v of x.curva) { vals.push(v - ant); ant = v; }
      requestAnimationFrame(() => AX.sparkline($("tstCurva"), vals, (i, v, ac) => `Acumulado: ${din(ac, x.moeda)}`));
      $("tstGrafico").onclick = () => { fechar(); irPara(cod, x.tf); };
      $("tstLigar").onclick = async () => { fechar(); irPara(cod, x.tf); setTimeout(() => AX.ops && AX.ops.ligarTeste && AX.ops.ligarTeste(), 600); };
      $("tstFav").onclick = () => { favoritar(cod, !(AX.pref.minhas || []).includes(cod)); pintarTestar(titulo, cod); };
    }
  }
  function irPara(cod, tf) {
    if (AX.aba !== "vivo") AX.trocarAba("vivo");
    AX.irPara({ ativo: AX.pref.ativo, tf, est: cod });
  }
  function favoritar(cod, sim) {
    const s = new Set(AX.pref.minhas || []);
    if (sim) s.add(cod); else s.delete(cod);
    if (!s.size) return AX.toast("Deixe pelo menos uma estratégia nas suas.", "aviso");
    AX.pref.minhas = AX.cfg.estrategias.map((e) => e.cod).filter((c) => s.has(c));
    AX.salvarPref();
    if (AX.montarEstrategias) AX.montarEstrategias();
    if (AX.pref.est === "TODAS") AX.emit("mudou", "est");
  }

  // ---------------------------------------------------------------- minhas estratégias
  function escolha() {
    const minhas = new Set(AX.pref.minhas || []);
    return `<div class="min-escolha"><div class="rot">ESCOLHA AS SUAS ESTRATÉGIAS ${AX.q("As marcadas aparecem no topo da lista de estratégias e formam o modo “Minhas estratégias juntas”, em que elas procuram entrada ao mesmo tempo (uma operação por vez).")}</div>
      <div class="min-lista">${AX.cfg.estrategias.map((e) => `<label class="chk min-item" data-dica="${AX.esc(e.ideal || e.aguardando || "")}"><input type="checkbox" data-c="${e.cod}"${minhas.has(e.cod) ? " checked" : ""}> <span><b>${e.cod}</b> ${AX.esc(e.nome)}</span></label>`).join("")}</div></div>`;
  }
  async function minhas(rodar = true) {
    const seq = ++M.seq;
    M.aba = "minhas";
    const cods = AX.pref.minhas || [];
    const titulo = `<div class="tst-cab"><div><small>MINHAS ESTRATÉGIAS</small><h2>${cods.length} estratégia${cods.length > 1 ? "s" : ""} em ${AX.esc(AX.rotAtivo(AX.pref.ativo))} · ${tfNome(+AX.pref.tf)}</h2>
      <span>período: ${AX.esc(AX.periodoTexto(AX.vivo.D))} · cada uma sozinha e todas juntas</span></div></div>`;
    const pe = `<div class="tst-acoes"><button class="primario" id="minRodar">▶ Rodar minhas estratégias</button><button class="secundario" id="minJuntas">★ Usar todas juntas no gráfico</button></div>`;
    abrir(titulo + escolha() + pe + `<div id="minRes">${rodar ? carregando("Rodando cada estratégia…") : ""}</div>` + aviso);
    ligarEscolha(titulo);
    if (!rodar) return;
    let d;
    try { d = await AX.json("/api/minhas?" + AX.parametros({ cods: cods.join(",") }), { tempo: 120000 }); }
    catch (err) { if (seq === M.seq) $("minRes").innerHTML = `<div class="erro">⚠ ${AX.esc(err.message)}</div>`; return; }
    if (seq !== M.seq || !$("minRes")) return;
    const linhas = d.linhas.slice().sort((a, b) => (b.erro ? -1e12 : b.total) - (a.erro ? -1e12 : a.total));
    const lin = (x) => {
      if (x.erro) return `<tr><td><b>${x.est}</b> ${AX.esc(x.nome)}</td><td colspan="5" class="neutro">${AX.esc(x.erro)}</td></tr>`;
      const ag = AGORA[x.agora] || AGORA.aguardando;
      return `<tr class="clic" data-est="${x.est}"><td><b>${x.est}</b> ${AX.esc(x.nome)}</td><td class="n ${AX.cls(x.total)}">${x.n ? din(x.total, x.moeda) : "-"}</td><td class="n">${x.n}</td>
        <td class="n">${x.n ? AX.pct(x.acerto, 0) : "-"}</td><td class="n ruim">${x.n ? din(-x.ddMax, x.moeda) : "-"}</td><td><span class="tst-agora ${ag[1]}">● ${ag[0]}</span></td>
        <td><button class="mini-btn" data-ver="${x.est}">ver</button> <button class="mini-btn" data-testar="${x.est}">testar</button></td></tr>`;
    };
    const j = d.juntas;
    $("minRes").innerHTML = `<table class="tab min-tab"><tr><th>Estratégia</th><th class="n">Resultado</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Pior queda</th><th>Agora</th><th></th></tr>
      ${linhas.map(lin).join("")}
      ${j && !j.erro ? `<tr class="min-juntas"><td><b>Todas juntas</b> (uma operação por vez)</td><td class="n ${AX.cls(j.total)}">${j.n ? din(j.total, j.moeda) : "-"}</td><td class="n">${j.n}</td><td class="n">${j.n ? AX.pct(j.acerto, 0) : "-"}</td><td class="n ruim">${j.n ? din(-j.ddMax, j.moeda) : "-"}</td><td></td><td></td></tr>` : ""}</table>`;
    $("minRes").querySelectorAll("[data-ver]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); fechar(); irPara(b.dataset.ver, +AX.pref.tf); }));
    $("minRes").querySelectorAll("[data-testar]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); testar(b.dataset.testar); }));
    $("minRes").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => { fechar(); irPara(tr.dataset.est, +AX.pref.tf); }));
  }
  function ligarEscolha(titulo) {
    corpo.querySelectorAll(".min-item input").forEach((c) => (c.onchange = () => {
      favoritar(c.dataset.c, c.checked);
      c.checked = (AX.pref.minhas || []).includes(c.dataset.c);
    }));
    $("minRodar").onclick = () => minhas(true);
    $("minJuntas").onclick = () => { fechar(); if (AX.aba !== "vivo") AX.trocarAba("vivo"); AX.escolherEst("TODAS"); };
  }

  AX.on("testar", () => testar());
  AX.on("minhas", () => minhas(false));
  AX.testar = { testar, minhas, favoritar };
})();
