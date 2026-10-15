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
  function fechar() { modal.classList.add("oculto"); M.seq++; M.aba = null; M.aberto = false; }
  $("roboFechar").onclick = fechar;
  modal.addEventListener("pointerdown", (e) => { if (e.target === modal) fechar(); });
  AX.on("tecla", (e) => { if (e.key === "Escape" && !modal.classList.contains("oculto")) fechar(); });
  const carregando = (t) => `<div class="tst-carregando"><i class="giro"></i>${AX.esc(t)}</div>`;
  const aviso = '<div class="nota tst-aviso">Simulação com dados passados, já com custos e escorregamento. É estudo: resultado passado não garante resultado futuro.</div>';

  // ---------------------------------------------------------------- testar esta estratégia
  // período só desta janela (começa igual ao do topo): atalhos, semanas e datas de/até
  const ATALHOS = [["hoje", "Hoje"], ["7", "1 semana"], ["14", "2 semanas"], ["30", "1 mês"], ["91", "3 meses"], ["182", "6 meses"], ["tudo", "Tudo"]];
  const isoDe = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  function periodoInicial() {
    const p = AX.pref;
    if (p.per === "custom") return { at: "", de: p.de || "", ate: p.ate || "" };
    return { at: { hoje: "hoje", "5d": "7", "1m": "30", "3m": "91", tudo: "tudo" }[p.per] || "30", de: "", ate: "" };
  }
  function datasDoAtalho(at) {                 // atalho -> datas (contadas a partir de hoje)
    if (at === "tudo") return { de: "", ate: "" };
    if (at === "hoje") return { de: isoDe(new Date()), ate: "" };
    const dt = new Date(); dt.setDate(dt.getDate() - (+at - 1));
    return { de: isoDe(dt), ate: "" };
  }
  function consultaTeste(cod) {
    const per = M.per, ds = per.at ? datasDoAtalho(per.at) : per;
    return AX.parametros({ est: cod, per: per.at === "hoje" ? "hoje" : "tudo", de: per.at === "hoje" ? 0 : AX.isoInt(ds.de) || 0, ate: AX.isoInt(ds.ate) || 0 });
  }
  const aoVivo = () => !M.per || !M.per.ate || AX.isoInt(M.per.ate) >= AX.isoInt(isoDe(new Date()));
  function barraPeriodo() {
    const p = M.per;
    return `<div class="tst-per">
      <div class="seg tst-atalhos">${ATALHOS.map(([k, t]) => `<button data-at="${k}" class="${p.at === k ? "on" : ""}">${t}</button>`).join("")}</div>
      <div class="tst-datas"><label class="tst-data"><span>de</span><input type="date" id="tstDe" value="${AX.esc(p.at ? datasDoAtalho(p.at).de : p.de)}"></label>
      <label class="tst-data"><span>até</span><input type="date" id="tstAte" value="${AX.esc(p.at ? "" : p.ate)}"></label>
      <button class="mini-btn" id="tstAplicar">Ver</button>
      ${AX.q("Escolha o período só desta janela: os atalhos contam a partir de hoje (1 semana = os últimos 7 dias). Ou escolha as datas de início e fim e clique em Ver. Sem data de fim, a janela se atualiza sozinha a cada minuto enquanto estiver aberta.")}</div>
    </div>`;
  }
  async function testar(est, silencioso = false) {
    const cod = est || (AX.pref.est !== "TODAS" ? AX.pref.est : AX.pref.ultEst);
    const e = AX.cfg.estMap[cod];
    if (!e) return AX.toast("Escolha uma estratégia no topo.", "aviso");
    if (!silencioso) { M.per = M.per && M.cod === cod && M.aberto ? M.per : periodoInicial(); M.cod = cod; M.aberto = true; }
    const seq = ++M.seq;
    M.aba = "testar";
    const titulo = () => `<div class="tst-cab"><div><small>TESTAR ESTRATÉGIA</small><h2>${AX.esc(cod)} · ${AX.esc(e.nome)}</h2>
      <span>${AX.esc(AX.rotAtivo(AX.pref.ativo))} · ${M.dados && M.dados.dataIni ? `${AX.dataTxt(M.dados.dataIni)} a ${AX.dataTxt(M.dados.dataFim)}` : "período escolhido"} · ${AX.unidade(AX.vivo.D ? AX.vivo.D.meta : { fracionado: false }, AX.pref.contratos)}</span></div>
      ${aoVivo() ? `<span class="tst-vivo" data-dica="Sem data de fim: os números e a curva se atualizam sozinhos a cada minuto com os candles novos."><i class="luz vivo"></i>ao vivo${M.quando ? " · " + M.quando : ""}</span>` : ""}</div>` + barraPeriodo();
    M.titulo = titulo;
    if (!silencioso) { M.dados = null; abrir(titulo() + carregando("Rodando a estratégia em 5, 15 e 60 minutos…")); ligarPeriodo(cod); }
    let d;
    try { d = await AX.json("/api/testar?" + consultaTeste(cod), { tempo: 120000 }); }
    catch (err) {
      if (seq === M.seq && !silencioso) { corpo.innerHTML = titulo() + `<div class="erro">⚠ ${AX.esc(err.message)}</div>`; ligarPeriodo(cod); }
      return;
    }
    if (seq !== M.seq || modal.classList.contains("oculto")) return;
    const ref = d.tempos.find((x) => !x.erro) || {};
    M.dados = { tempos: d.tempos, dataIni: ref.dataIni, dataFim: ref.dataFim };
    M.quando = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (!silencioso || !d.tempos.some((x) => x.tf === M.tfSel && !x.erro))
      M.tfSel = d.tempos.some((x) => x.tf === +AX.pref.tf && !x.erro) ? +AX.pref.tf : ref.tf;
    pintarTestar(cod);
  }
  function ligarPeriodo(cod) {
    corpo.querySelectorAll(".tst-atalhos button").forEach((b) => (b.onclick = () => { M.per = { at: b.dataset.at, de: "", ate: "" }; testar(cod); }));
    const ap = $("tstAplicar");
    if (ap) ap.onclick = () => {
      const de = $("tstDe").value, ate = $("tstAte").value;
      if (de && ate && de > ate) return AX.toast("A data de início precisa ser antes da data de fim.", "aviso");
      M.per = { at: "", de, ate }; testar(cod);
    };
  }
  // atualiza sozinho a cada minuto enquanto a janela estiver aberta num período sem data de fim
  setInterval(() => {
    if (M.aba === "testar" && M.cod && M.dados && !modal.classList.contains("oculto") && !document.hidden && aoVivo()) testar(M.cod, true);
  }, 60000);
  function cartaoTf(x) {
    if (x.erro) return `<div class="tst-tf erro-tf"><small>${tfNome(x.tf)}</small><b class="neutro">sem dados</b><em>${AX.esc(x.erro)}</em></div>`;
    const ag = AGORA[x.agora] || AGORA.aguardando;
    return `<button class="tst-tf ${x.tf === M.tfSel ? "on" : ""} ${x.n ? (x.total >= 0 ? "pos" : "neg") : ""}" data-tf="${x.tf}">
      <small>${tfNome(x.tf)}${x.tf === +AX.pref.tf ? " · no gráfico" : ""}</small>
      <b class="${AX.cls(x.total)}">${x.n ? din(x.total, x.moeda) : "sem operações"}</b>
      <em>${x.n} operações · acerto ${AX.pct(x.acerto, 0)}</em>
      <span class="tst-agora ${ag[1]}">● ${ag[0]}</span></button>`;
  }
  // pontos da curva: dia a dia quando o período tem mais de um dia; senão, operação a operação
  function pontosCurva(x) {
    if (M.modo !== "op" && x.dias && x.dias.length > 1)
      return { pts: x.dias.map((r) => ({ x: diaTxt(r[0]), v: r[2], d: r[1], n: r[3] })), rot: "dia" };
    return { pts: (x.pontos || []).map((r) => ({ x: AX.quandoT(r[0]).slice(0, 5), dica: AX.quandoT(r[0]).slice(-5), v: r[1], d: r[2] })), rot: "operação" };
  }
  function pintarTestar(cod) {
    const d = M.dados, x = d.tempos.find((y) => y.tf === M.tfSel) || d.tempos[0];
    let h = M.titulo() + `<div class="tst-tfs">${d.tempos.map(cartaoTf).join("")}</div>`;
    if (x && !x.erro) {
      const m = x.moeda, diasPos = (x.dias || []).filter((r) => r[1] > 0).length, diasNeg = (x.dias || []).filter((r) => r[1] < 0).length;
      h += `<div class="tst-det">
        <div class="tst-kpis">
          <div><small>Resultado</small><b class="${AX.cls(x.total)}">${din(x.total, m)}</b></div>
          <div><small>Ganho médio</small><b class="bom">${din(x.ganhoMedio, m)}</b></div>
          <div><small>Perda média</small><b class="ruim">${din(x.perdaMedia, m)}</b></div>
          <div><small>Pior queda</small><b class="ruim">${din(-x.ddMax, m)}</b></div>
          <div><small>Maior ganho</small><b class="bom">${din(x.maiorGanho, m)}</b></div>
          <div><small>Maior perda</small><b class="ruim">${din(x.maiorPerda, m)}</b></div>
        </div>
        <div class="tst-curva-caixa">
          <div class="tst-curva-cab"><span class="rot">RESULTADO ACUMULADO ${AX.q("A linha soma o resultado de cada dia (ou de cada operação). Acima do zero fica verde, abaixo do zero fica vermelho. Passe o mouse para ver o dia, o resultado do dia e o acumulado.")}</span>
            <span class="tst-dias">${x.dias && x.dias.length ? `<b class="bom">${diasPos}</b> dia${diasPos === 1 ? "" : "s"} no positivo · <b class="ruim">${diasNeg}</b> no negativo` : ""}</span>
            <div class="seg mini"><button data-modo="dia" class="${M.modo !== "op" ? "on" : ""}">dia a dia</button><button data-modo="op" class="${M.modo === "op" ? "on" : ""}">por operação</button></div></div>
          <canvas class="tst-curva" id="tstCurva"></canvas>
        </div>
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
    const jan = modal.querySelector(".modal-janela"), rolagem = jan ? jan.scrollTop : 0;
    corpo.innerHTML = h;
    if (jan) jan.scrollTop = rolagem;
    ligarPeriodo(cod);
    corpo.querySelectorAll(".tst-tf[data-tf]").forEach((b) => (b.onclick = () => { M.tfSel = +b.dataset.tf; pintarTestar(cod); }));
    if (x && !x.erro) {
      const desenhar = () => { const c = pontosCurva(x); AX.curvaPL($("tstCurva"), c.pts, { moeda: x.moeda, rotulo: c.rot }); };
      requestAnimationFrame(desenhar);
      corpo.querySelectorAll("[data-modo]").forEach((b) => (b.onclick = () => { M.modo = b.dataset.modo; pintarTestar(cod); }));
      $("tstGrafico").onclick = () => { fechar(); irPara(cod, x.tf); };
      $("tstLigar").onclick = async () => { fechar(); irPara(cod, x.tf); setTimeout(() => AX.ops && AX.ops.ligarTeste && AX.ops.ligarTeste(), 600); };
      $("tstFav").onclick = () => { favoritar(cod, !(AX.pref.minhas || []).includes(cod)); pintarTestar(cod); };
    }
  }
  window.addEventListener("resize", () => { if (M.aba === "testar" && M.dados && !modal.classList.contains("oculto")) pintarTestar(M.cod); });
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
