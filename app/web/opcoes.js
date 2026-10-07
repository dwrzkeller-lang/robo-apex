/* ROBÔ APEX — aba Opções (B3). Para aprender e enxergar oportunidades: o robô não envia ordem nenhuma.
   Mostra o ativo-objeto, a grade de um vencimento (calls à esquerda, puts à direita), 5 estruturas clássicas montadas
   com séries reais (com gráfico de resultado, passo a passo, riscos e conferência das regras), um montador livre,
   uma triagem de oportunidades e um glossário. Toda conta (Black-Scholes, VI, gregas, resultado) vem do servidor.
   Os dados têm atraso: a grade é a de fim de dia da B3 e a cotação do dia chega com cerca de 15 minutos. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const ATIVO_OK = /^[A-Z]{4}[0-9]{1,2}$/;
  const S = { ativo: "PETR4", venc: null, painel: null, grade: null, estr: null, oport: null, sim: null, pernas: [],
    selK: null, ativa: false, seq: 0, relogio: null, ocupado: false, montado: false, graf: {}, abertos: {}, opSeg: "vi",
    oportData: null, simT: null, simSeq: 0, rolou: "" };
  try { const a = localStorage.getItem("apex_opcoes_ativo"); if (a && ATIVO_OK.test(a)) S.ativo = a; } catch (e) { /* sem armazenamento */ }

  // ---------------------------------------------------------------- formatação
  const esc = AX.esc, q = AX.q;
  const ic = (d) => `<svg class="ic" viewBox="0 0 24 24">${d}</svg>`;
  const n2 = (v) => AX.num(v, 2);
  const rs = (v, sinal = false) => {
    if (v == null || isNaN(v)) return "—";
    return (v < 0 ? "−" : sinal && v > 0 ? "+" : "") + "R$ " + Math.abs(v).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };
  const inteiro = (v) => (v == null || isNaN(v) ? "—" : Math.round(v).toLocaleString("pt-BR"));
  const curto = (v) => {                       // 1.234.500 -> 1,2 mi
    if (v == null || isNaN(v)) return "—";
    const a = Math.abs(v);
    if (a >= 1e9) return AX.num(v / 1e9, 1) + " bi";
    if (a >= 1e6) return AX.num(v / 1e6, 1) + " mi";
    if (a >= 1e4) return AX.num(v / 1e3, 0) + " mil";
    return inteiro(v);
  };
  const vol = (v, d = 1) => (v == null ? "—" : AX.pct(100 * v, d));          // 0,3507 -> 35,1%
  const dataBR = (iso, ano = false) => (iso && iso.length >= 10 ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}${ano ? "/" + iso.slice(0, 4) : ""}` : "—");
  const hora = (s) => { const m = /(\d{2}:\d{2})/.exec(s || ""); return m ? m[1] : ""; };
  const sinalNum = (v, d = 2) => (v == null ? "—" : (v > 0 ? "+" : v < 0 ? "−" : "") + AX.num(Math.abs(v), d));
  const url = (rota, p) => "/api/opcoes/" + rota + (p ? "?" + new URLSearchParams(p).toString() : "");

  // ---------------------------------------------------------------- esqueleto
  function montar() {
    if (S.montado) return;
    const el = $("opConteudo");
    if (!el) return;
    el.innerHTML = `<div id="opCab"></div><div id="opVencs"></div><div id="opGrade"></div><div id="opEstr"></div>
      <div id="opMontar"></div><div id="opOport"></div><div id="opGloss"></div>`;
    $("opGloss").innerHTML = glossario();
    el.addEventListener("click", clique);
    el.addEventListener("change", mudou);
    el.addEventListener("submit", (e) => { e.preventDefault(); const f = e.target.querySelector("input"); if (f) trocarAtivo(f.value); });
    el.addEventListener("toggle", (e) => { const k = e.target && e.target.dataset && e.target.dataset.ab; if (k) S.abertos[k] = e.target.open; }, true);
    el.addEventListener("mousemove", cursor);
    el.addEventListener("mouseleave", () => limparCursor(), true);
    S.montado = true;
  }

  // ---------------------------------------------------------------- cabeçalho
  function renderCab() {
    const el = $("opCab"), p = S.painel;
    const chips = (p ? p.ativos : ["PETR4", "VALE3", "BOVA11", "ITUB4", "BBAS3", "BBDC4", "ABEV3", "B3SA3", "MGLU3", "WEGE3"]);
    const lista = chips.includes(S.ativo) ? chips : [S.ativo].concat(chips);
    let h = `<div class="card op-cab"><div class="rot">${ic('<path d="M4 19h16M6 16l4-5 3 3 5-7"/>')}OPÇÕES DA B3 ${q("Opção é um contrato que dá o direito de comprar (call) ou de vender (put) uma ação por um preço combinado (strike) até uma data (vencimento). Esta aba serve para estudar: o robô não envia ordens. Veja o glossário no fim da página.")}<span class="dir">para aprender · o robô não envia ordens</span></div>
      <div class="op-ativos">${lista.map((a) => `<button class="op-chip${a === S.ativo ? " on" : ""}" data-ac="ativo" data-v="${esc(a)}">${esc(a)}</button>`).join("")}
        <form class="op-busca"><input maxlength="6" placeholder="outro: ex. SUZB3" aria-label="Outro ativo" autocomplete="off" spellcheck="false"><button type="submit">Ver</button></form></div>`;
    if (!p) { el.innerHTML = h + `<div class="nota">carregando ${esc(S.ativo)}…</div></div>`; return; }
    const b = p.base, t = b.tendencia || {}, dl = p.download || {};
    const seloT = { alta: ["verde", "▲ ALTA"], baixa: ["vermelho", "▼ BAIXA"], lateral: ["neutro", "◆ SEM TENDÊNCIA"], sem: ["neutro", "SEM DADOS"] }[t.cod] || ["neutro", "—"];
    h += `<div class="op-preco"><b>${esc(p.ativo)}</b><span class="op-val">${b.preco == null ? "—" : rs(b.preco)}</span>
        ${b.var == null ? "" : `<span class="${AX.cls(b.var)}">${b.var > 0 ? "▲ +" : b.var < 0 ? "▼ −" : ""}${AX.num(Math.abs(b.var), 2)}%</span>`}
        <span class="op-quando">${b.hora ? "às " + esc(hora(b.hora)) + " · " : ""}${esc(b.fonte || "sem cotação")}</span></div>
      <div class="op-tiles">
        <div class="tile"><small>Tendência${q("Leitura simples pelas médias móveis do preço de fechamento: alta quando o preço está acima da média de 20 dias e ela acima da de 50; baixa no espelho disso. É só um retrato do passado recente, não uma previsão.")}</small>
          <b><span class="selo ${seloT[0]}">${seloT[1]}</span></b><em data-dica="${esc(t.txt || "")}">MM20 ${n2(b.mm20)} · MM50 ${n2(b.mm50)} · MM200 ${n2(b.mm200)}</em></div>
        <div class="tile"><small>Vol. histórica${q("Quanto o preço da ação balançou de verdade, em % ao ano, nos últimos 21 e 63 pregões. É a régua para saber se as opções estão caras ou baratas: compare com a volatilidade implícita (VI).")}</small>
          <b>${vol(b.hv21)}</b><em>21 pregões · 63 pregões: ${vol(b.hv63)}</em></div>
        <div class="tile"><small>VI no dinheiro${q("Volatilidade implícita: o balanço futuro que o PREÇO das opções está embutindo, em % ao ano. Calculada aqui com as opções mais próximas do preço da ação, no fechamento de " + dataBR(p.dataGrade) + (p.vi.venc ? " (vencimento " + dataBR(p.vi.venc) + ")" : "") + ". VI acima da histórica = opções relativamente caras (bom para quem vende, ruim para quem compra), e quase sempre há um motivo.")}</small>
          <b>${vol(p.vi.atm)}</b><em>${p.vi.rank == null ? "sem ranking ainda" : (p.vi.modo === "vi" ? "ranking de VI: " : "percentil da vol. histórica: ") + AX.num(p.vi.rank, 0)}${q(p.vi.txt || "")}</em></div>
        <div class="tile"><small>Juros (CDI)${q("Taxa livre de risco usada nas contas das opções (CDI anualizado do Banco Central). É também o que o seu dinheiro renderia parado: qualquer estrutura precisa ser comparada com isso." + (p.cdi.reserva ? " ATENÇÃO: o Banco Central não respondeu; este valor é de reserva." : ""))}</small>
          <b>${AX.num(p.cdi.valor, 2)}%</b><em>ao ano${p.cdi.data ? " · " + esc(p.cdi.data) : ""}${p.cdi.reserva ? ' · <span class="alerta">valor de reserva</span>' : ""}</em></div>
      </div>`;
    if (dl.estado === "baixando") {
      h += `<div class="op-baixa" role="status"><div class="op-barra"><i style="width:${Math.max(3, Math.min(100, +dl.progresso || 0))}%"></i></div>
        <span>Baixando a grade oficial da B3: ${AX.num(dl.progresso, 0)}%${dl.etapa ? " · " + esc(dl.etapa) : ""}. Acontece uma vez por pregão.</span></div>`;
    }
    h += `<div class="op-atraso"><b>Dados com atraso.</b> Grade de fim de dia${p.dataGrade ? " (pregão de " + dataBR(p.dataGrade, true) + (p.fonteGrade ? ", " + esc(p.fonteGrade) : "") + ")" : ""} + cotação com cerca de 15 minutos.
      Os prêmios são de último negócio: na hora de operar existe diferença entre o preço de compra e o de venda. Nenhuma estrutura é infalível.</div>`;
    if ((p.avisos || []).length) h += `<ul class="seg-lista">${p.avisos.map((a) => `<li class="aviso">⚠ ${esc(a)}</li>`).join("")}</ul>`;
    el.innerHTML = h + "</div>";
  }

  function renderVencs() {
    const el = $("opVencs"), p = S.painel;
    if (!p || !(p.vencs || []).length) { el.innerHTML = ""; return; }
    el.innerHTML = `<div class="card"><div class="rot">${ic('<rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M8 3v4M16 3v4"/>')}VENCIMENTO ${q("Data em que a opção deixa de existir. As mensais vencem na terceira sexta-feira do mês e concentram os negócios; as semanais (marcadas com S) têm menos liquidez. O número é quantos dias úteis faltam. Quanto mais perto do vencimento, mais rápido a opção perde valor com o tempo.")}<span class="dir">dias úteis até vencer</span></div>
      <div class="op-vencs">${p.vencs.slice(0, 14).map((v) => `<button class="op-chip${v.data === S.venc ? " on" : ""}${v.negocios ? "" : " op-fraco"}" data-ac="venc" data-v="${esc(v.data)}"
        data-dica="${esc(dataBR(v.data, true) + " · " + (v.semanal ? "semanal" : "mensal") + " · " + v.series + " séries · " + inteiro(v.negocios) + " negócios no último pregão")}">${dataBR(v.data)}<small>${v.du} d.u.${v.semanal ? " · S" : ""}</small></button>`).join("")}</div></div>`;
  }

  // ---------------------------------------------------------------- grade
  const marca = (x) => (x.fonte === "agora" ? "" : x.fonte === "fech" ? "<sup>f</sup>" : x.fonte === "ref" ? "<sup>r</sup>" : "");
  function ladoTd(x, espelho) {
    if (!x) return '<td class="n op-vz" colspan="4">—</td>';
    const itm = x.mon === "ITM" ? " op-itm" : "";
    const cel = [
      `<td class="n${itm}">${x.neg ? inteiro(x.neg) : '<span class="op-fraco">0</span>'}</td>`,
      `<td class="n${itm}">${vol(x.vi)}</td>`,
      `<td class="n${itm}">${x.delta == null ? "—" : n2(x.delta)}</td>`,
      `<td class="n op-pr${itm}"><span class="${x.semNeg ? "op-fraco" : ""}">${x.preco == null ? "—" : n2(x.preco)}</span>${marca(x)}</td>`];
    return (espelho ? cel.reverse() : cel).join("");
  }
  function renderGrade() {
    const el = $("opGrade"), g = S.grade, p = S.painel;
    if (!g) {
      const dl = (p && p.download) || {};
      const msg = !p ? "" : dl.estado === "baixando" ? "A grade aparece aqui assim que o download da B3 terminar." :
        !(p.vencs || []).length ? "Sem grade de opções para mostrar agora." : "carregando a grade…";
      el.innerHTML = msg ? `<div class="vazio-bloco">${esc(msg)}</div>` : "";
      return;
    }
    const rol = el.querySelector(".rolagem"), topo = rol ? rol.scrollTop : null;
    let h = `<div class="card"><div class="rot">${ic('<path d="M4 6h16M4 12h16M4 18h16M12 4v16"/>')}GRADE · ${esc(g.ativo)} · ${dataBR(g.venc, true)}<span class="dir">${g.du == null ? "" : g.du + " dias úteis · "}VI no dinheiro ${vol(g.viAtm)}${q("Média da VI da call e da put mais próximas do preço da ação neste vencimento.")}</span></div>`;
    if (!g.linhas.length) {
      el.innerHTML = h + `<div class="vazio-bloco">Sem séries para mostrar neste vencimento agora.</div>${avisos(g.avisos)}</div>`;
      return;
    }
    h += `<div class="rolagem op-rol"><table class="tab op-tab"><thead>
      <tr><th colspan="4" class="op-lado">CALLS (direito de comprar)</th><th class="op-k"></th><th colspan="4" class="op-lado">PUTS (direito de vender)</th></tr>
      <tr><th class="n">Neg.${q("Número de negócios da série no último pregão. Série sem negócio (0) pode ter preço só teórico: na prática é difícil comprar ou vender.")}</th>
        <th class="n">VI${q("Volatilidade implícita desta série, em % ao ano: a volatilidade que faz o modelo Black-Scholes bater com o prêmio. Fica vazia quando o preço não serve para a conta (sem negócio, ou abaixo do valor intrínseco).")}</th>
        <th class="n">Delta${q("Quanto o prêmio muda quando a ação anda R$ 1,00. Também serve de aproximação grosseira da chance de a opção terminar com valor: delta 0,25 ≈ 25%. Calls têm delta positivo; puts, negativo.")}</th>
        <th class="n">Prêmio${q("Preço de uma opção (por ação). O lote é de 100, então prêmio 1,50 = R$ 150,00 por lote. Sem marca: cotação do dia (~15 min). f = último negócio do fechamento anterior. r = preço de referência da B3 (teórico, série sem negócio).")}</th>
        <th class="op-k">Strike${q("Preço de exercício: por quanto a ação é comprada (call) ou vendida (put) se a opção for exercida. Atenção: o número no código da série NÃO é o strike.")}</th>
        <th class="n">Prêmio</th><th class="n">Delta</th><th class="n">VI</th><th class="n">Neg.</th></tr></thead><tbody>`;
    h += g.linhas.map((l) => `<tr class="clic${l.atm ? " op-atm" : ""}${S.selK === l.k ? " sel" : ""}" data-ac="linha" data-v="${l.k}">
      ${ladoTd(l.call, false)}<td class="op-k"><b>${n2(l.k)}</b><small>${sinalNum(l.dist, 1)}%</small></td>${ladoTd(l.put, true)}</tr>`).join("");
    h += `</tbody></table></div>
      <div class="op-leg"><span><i class="op-q itm"></i> dentro do dinheiro (ITM)</span><span><i class="op-q atm"></i> strike mais perto do preço (ATM)</span>
        <span><sup>f</sup> fechamento de ${dataBR(g.dataGrade)}</span><span><sup>r</sup> referência (sem negócio)</span><span>${g.agora} séries com cotação do dia</span></div>
      <div id="opDet">${detalhe()}</div>
      <div class="nota">Clique numa linha para ver as gregas e mandar a série para o montador. Ação a ${rs(g.spot)}; juros ${AX.num(g.juros, 2)}% a.a.
        ${g.temAmericana ? "Há calls americanas (podem ser exercidas antes do vencimento): aqui elas são calculadas como europeias, o que é uma aproximação. " : ""}As contas ignoram dividendos.</div>
      ${avisos(g.avisos)}</div>`;
    el.innerHTML = h;
    const novo = el.querySelector(".rolagem");
    const chave = g.ativo + "|" + g.venc;
    if (novo) {
      if (topo != null && S.rolou === chave) novo.scrollTop = topo;
      else { const a = novo.querySelector("tr.op-atm"); if (a) novo.scrollTop = Math.max(0, a.offsetTop - novo.clientHeight / 2); S.rolou = chave; }
    }
  }
  const avisos = (l) => ((l || []).length ? `<ul class="seg-lista">${l.map((a) => `<li class="aviso">⚠ ${esc(a)}</li>`).join("")}</ul>` : "");

  function detLado(x, nome) {
    if (!x) return `<div class="op-det-l"><div class="op-det-t">${nome}</div><div class="nota">Não há série deste lado neste strike.</div></div>`;
    const fonte = { agora: "cotação do dia" + (x.hora ? " às " + hora(x.hora) : ""), fech: "último negócio do pregão anterior", ref: "preço de referência da B3 (teórico)" }[x.fonte] || "sem preço";
    const li = (r, v, d) => `<div><small>${r}${d ? q(d) : ""}</small><b>${v}</b></div>`;
    return `<div class="op-det-l"><div class="op-det-t">${nome} <b>${esc(x.tk)}</b> <span class="chip">${esc(x.estilo)}</span> <span class="chip">${esc(x.mon)}</span>${x.semNeg ? ' <span class="chip esticada">sem negócio</span>' : ""}</div>
      <div class="op-det-g">
        ${li("Prêmio", x.preco == null ? "—" : rs(x.preco), "Fonte: " + fonte + ". Por lote de 100: " + rs(x.preco == null ? null : x.preco * 100) + ".")}
        ${li("Valor intrínseco", rs(x.intr), "A parte do prêmio que já é dinheiro: quanto a opção valeria se vencesse agora. Zero para opções fora do dinheiro.")}
        ${li("Valor do tempo", rs(x.tempo), "O resto do prêmio: o que se paga pela chance de a ação andar até o vencimento. Essa parte vai a zero no vencimento.")}
        ${li("VI", vol(x.vi), "Volatilidade implícita desta série.")}
        ${li("Delta", x.delta == null ? "—" : AX.num(x.delta, 3), "Se a ação subir R$ 1,00, o prêmio muda mais ou menos isto (em R$ por ação).")}
        ${li("Gamma", x.gamma == null ? "—" : AX.num(x.gamma, 4), "Quanto o delta muda quando a ação anda R$ 1,00. Alto perto do dinheiro e do vencimento: o risco muda rápido.")}
        ${li("Theta / dia", x.theta == null ? "—" : rs(x.theta), "Quanto o prêmio perde por dia útil só pela passagem do tempo, com tudo o mais parado. Ruim para quem comprou, bom para quem vendeu.")}
        ${li("Vega / ponto", x.vega == null ? "—" : rs(x.vega), "Quanto o prêmio muda se a volatilidade implícita subir 1 ponto percentual.")}
        ${li("Negócios", inteiro(x.neg), "No último pregão. Volume financeiro: " + (x.vol == null ? "—" : "R$ " + curto(x.vol)) + ".")}
        ${li("Em aberto", curto(x.oi), "Posições em aberto: contratos que existem hoje nesta série (coberto: " + curto(x.coberto) + "; descoberto: " + curto(x.descoberto) + "). Muito contrato em aberto costuma significar série mais fácil de negociar.")}
        ${li("Mín. / máx.", x.min == null ? "—" : n2(x.min) + " / " + n2(x.max), "Do último pregão.")}
        ${li("Referência", x.ref == null ? "—" : rs(x.ref), "Preço de referência calculado pela B3 no fechamento.")}
      </div>
      <div class="botoes finos"><button data-ac="add" data-tk="${esc(x.tk)}" data-lado="compra">+ Comprar no montador</button><button data-ac="add" data-tk="${esc(x.tk)}" data-lado="venda">+ Vender no montador</button></div></div>`;
  }
  function detalhe() {
    const g = S.grade;
    if (!g || S.selK == null) return "";
    const l = g.linhas.find((x) => x.k === S.selK);
    if (!l) return "";
    return `<div class="op-det"><div class="op-det-c">Strike ${rs(l.k)} · ${sinalNum(l.dist, 1)}% do preço da ação</div><div class="grade2">${detLado(l.call, "CALL")}${detLado(l.put, "PUT")}</div></div>`;
  }
  const serie = (tk) => { for (const l of (S.grade ? S.grade.linhas : [])) { if (l.call && l.call.tk === tk) return l.call; if (l.put && l.put.tk === tk) return l.put; } return null; };

  // ---------------------------------------------------------------- gráfico de resultado (SVG)
  const GW = 580, GH = 190, GM = { e: 58, d: 12, t: 12, b: 24 };
  function grafico(id, r) {
    const pf = r && r.payoff;
    if (!pf || !(pf.venc || []).length) return "";
    const xs = pf.venc.map((p) => p[0]), todos = pf.venc.concat(pf.hoje || []).map((p) => p[1]);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    let y0 = Math.min(0, ...todos), y1 = Math.max(0, ...todos);
    const folga = (y1 - y0) * 0.08 || 1; y0 -= folga; y1 += folga;
    const X = (x) => GM.e + ((x - x0) / (x1 - x0 || 1)) * (GW - GM.e - GM.d);
    const Y = (y) => GM.t + (1 - (y - y0) / (y1 - y0)) * (GH - GM.t - GM.b);
    const linha = (pts) => pts.map((p, i) => (i ? "L" : "M") + X(p[0]).toFixed(1) + " " + Y(p[1]).toFixed(1)).join("");
    const zero = Y(0), base = GH - GM.b;
    const area = linha(pf.venc) + `L${X(x1).toFixed(1)} ${zero.toFixed(1)}L${X(x0).toFixed(1)} ${zero.toFixed(1)}Z`;
    S.graf[id] = { x0, x1, venc: pf.venc, hoje: pf.hoje || [], X, Y };
    const emp = (r.empates || []).filter((e) => e >= x0 && e <= x1);
    const fmtY = (v) => (Math.abs(v) >= 10000 ? AX.num(v / 1000, 1) + " mil" : AX.num(v, 0));
    const ticksY = [y1 - folga, 0, y0 + folga].filter((v, i, a) => i === 1 || Math.abs(Y(v) - zero) > 14);
    const sx = X(pf.spot);
    return `<svg class="op-graf" data-g="${esc(id)}" viewBox="0 0 ${GW} ${GH}" role="img" aria-label="Resultado da estrutura em reais conforme o preço da ação no vencimento">
      <defs><clipPath id="${id}-cp"><rect x="${GM.e}" y="${GM.t}" width="${GW - GM.e - GM.d}" height="${Math.max(0, zero - GM.t)}"/></clipPath>
        <clipPath id="${id}-cn"><rect x="${GM.e}" y="${zero}" width="${GW - GM.e - GM.d}" height="${Math.max(0, base - zero)}"/></clipPath></defs>
      <path d="${area}" class="op-g-lucro" clip-path="url(#${id}-cp)"/><path d="${area}" class="op-g-perda" clip-path="url(#${id}-cn)"/>
      ${ticksY.map((v) => `<text x="${GM.e - 6}" y="${(Y(v) + 3.5).toFixed(1)}" text-anchor="end" class="op-g-eixo">${v === 0 ? "0" : (v > 0 ? "+" : "−") + fmtY(Math.abs(v))}</text>`).join("")}
      <text x="4" y="${GM.t + 3}" class="op-g-eixo">R$</text>
      <line x1="${GM.e}" x2="${GW - GM.d}" y1="${zero}" y2="${zero}" class="op-g-zero"/>
      ${(pf.strikes || []).filter((k) => k >= x0 && k <= x1).map((k) => `<line x1="${X(k)}" x2="${X(k)}" y1="${base}" y2="${base + 4}" class="op-g-tick"/><text x="${X(k)}" y="${GH - 6}" text-anchor="middle" class="op-g-eixo">${n2(k)}</text>`).join("")}
      <text x="${GM.e}" y="${GH - 6}" class="op-g-eixo">${n2(x0)}</text><text x="${GW - GM.d}" y="${GH - 6}" text-anchor="end" class="op-g-eixo">${n2(x1)}</text>
      <line x1="${sx}" x2="${sx}" y1="${GM.t}" y2="${base}" class="op-g-spot"/><text x="${Math.min(GW - GM.d - 40, sx + 4)}" y="${GM.t + 9}" class="op-g-rot">ação agora ${n2(pf.spot)}</text>
      ${(pf.hoje || []).length ? `<path d="${linha(pf.hoje)}" class="op-g-hoje"/>` : ""}
      <path d="${linha(pf.venc)}" class="op-g-venc"/>
      ${emp.map((e) => `<circle cx="${X(e)}" cy="${zero}" r="4.5" class="op-g-emp"/><text x="${X(e)}" y="${zero - 8}" text-anchor="middle" class="op-g-rot">empate ${n2(e)}</text>`).join("")}
      <line class="op-g-cx" x1="0" x2="0" y1="${GM.t}" y2="${base}" style="display:none"/></svg>
      <div class="op-g-leg"><span><i class="l-venc"></i> no vencimento</span><span><i class="l-hoje"></i> hoje (modelo)${q("Resultado estimado se a ação fosse para aquele preço HOJE, com as opções ainda valendo tempo (Black-Scholes com a VI de cada série). É estimativa de modelo.")}</span>
        <span><i class="l-lucro"></i> área de lucro</span><span><i class="l-perda"></i> área de prejuízo</span><span><i class="l-emp"></i> empate</span></div>
      <div class="op-g-leit" id="${esc(id)}-leit">Passe o mouse no gráfico para ver o resultado em cada preço da ação.</div>`;
  }
  const interp = (pts, x) => {
    if (!pts.length) return null;
    if (x <= pts[0][0]) return pts[0][1];
    for (let i = 1; i < pts.length; i++) if (x <= pts[i][0]) { const a = pts[i - 1], b = pts[i]; return a[1] + ((b[1] - a[1]) * (x - a[0])) / (b[0] - a[0] || 1); }
    return pts[pts.length - 1][1];
  };
  let svgAtivo = null;
  function limparCursor() {
    if (!svgAtivo) return;
    const cx = svgAtivo.querySelector(".op-g-cx"); if (cx) cx.style.display = "none";
    svgAtivo = null;
  }
  function cursor(e) {
    const svg = e.target.closest ? e.target.closest("svg.op-graf") : null;
    if (!svg) { limparCursor(); return; }
    const g = S.graf[svg.dataset.g]; if (!g) return;
    if (svgAtivo && svgAtivo !== svg) limparCursor();
    svgAtivo = svg;
    const cx = svg.querySelector(".op-g-cx"), leit = $(svg.dataset.g + "-leit");
    const caixa = svg.getBoundingClientRect(), vx = ((e.clientX - caixa.left) / (caixa.width || 1)) * GW;
    const fr = Math.max(0, Math.min(1, (vx - GM.e) / (GW - GM.e - GM.d))), x = g.x0 + fr * (g.x1 - g.x0);
    const px = GM.e + fr * (GW - GM.e - GM.d), v = interp(g.venc, x), hj = interp(g.hoje, x);
    if (cx) { cx.setAttribute("x1", px); cx.setAttribute("x2", px); cx.style.display = ""; }
    if (leit) leit.innerHTML = `Ação a <b>${rs(x)}</b> → no vencimento: <b class="${AX.cls(v)}">${rs(v, true)}</b> (${v > 0 ? "lucro" : v < 0 ? "prejuízo" : "empate"})${hj == null ? "" : ` · hoje, pelo modelo: <b class="${AX.cls(hj)}">${rs(hj, true)}</b>`}`;
  }

  // ---------------------------------------------------------------- números de uma estrutura
  function tiles(r) {
    const liq = r.liquido, semTeto = r.ganhoMax == null, semPiso = r.perdaMax == null;
    return `<div class="op-tiles t3">
      <div class="tile"><small>${liq >= 0 ? "Recebe agora" : "Paga agora"}${q("Saldo dos prêmios das opções, por lote de 100, antes dos custos. Crédito = entra dinheiro na montagem; débito = sai. Receber na montagem não é lucro: o resultado só se define no vencimento ou quando você desmonta.")}</small><b>${rs(Math.abs(liq))}</b><em>${liq >= 0 ? "crédito" : "débito"} · custos B3 ≈ ${rs(r.custos)}${q("Estimativa de 0,134% sobre o prêmio de cada perna (emolumentos, registro e liquidação). Corretagem, imposto de renda e a diferença entre compra e venda NÃO estão incluídos.")}</em></div>
      <div class="tile"><small>Ganho máximo${q("O melhor resultado possível no vencimento, já com os custos estimados. É um teto, não o resultado esperado.")}</small><b class="${semTeto ? "" : "bom"}">${semTeto ? "sem teto" : rs(r.ganhoMax, true)}</b><em>${r.retorno == null ? "no vencimento" : AX.num(r.retorno, 1) + "% do capital" + (r.retornoAno == null ? "" : " · " + AX.num(r.retornoAno, 0) + "% a.a.")}${r.retornoAno == null ? "" : q("A taxa ao ano só repete a conta do período como se desse para refazer a mesma operação o ano inteiro com o mesmo resultado, o que não acontece. Serve apenas para comparar com o CDI.")}</em></div>
      <div class="tile"><small>Perda máxima${q("O pior resultado possível no vencimento, já com os custos estimados. Em estruturas com ação, considera a ação indo a zero.")}</small><b class="ruim">${semPiso ? "SEM LIMITE" : rs(-r.perdaMax)}</b><em>${semPiso ? "o prejuízo cresce sem parar" : "pior caso no vencimento"}</em></div>
      <div class="tile"><small>Empate${q("Preço da ação no vencimento em que a estrutura sai no zero a zero (já com custos estimados).")}</small><b>${(r.empates || []).length ? r.empates.map((e) => n2(e)).join(" e ") : "—"}</b><em>preço da ação no vencimento</em></div>
      <div class="tile"><small>Chance de lucro${q("Conta aproximada de modelo: probabilidade de a ação terminar na faixa de lucro, supondo distribuição lognormal com a VI de agora (base N(d2) do Black-Scholes). Não é previsão. O mercado real tem quedas bruscas mais frequentes do que o modelo supõe. E chance alta quase sempre vem com ganho pequeno e perda grande.")}</small><b>${r.prob == null ? "—" : "≈ " + AX.num(r.prob, 0) + "%"}</b><em>estimativa de modelo</em></div>
      <div class="tile"><small>Capital / garantia${q(r.capitalTxt || "")}</small><b>${r.capital == null ? "margem" : rs(r.capital)}</b><em>${r.capital == null ? "exigida pela corretora" : "para 1 lote (100)"}</em></div>
    </div>`;
  }
  const NOME_LADO = { compra: "Compra", venda: "Venda", tem: "Tem", vende: "Vende" };
  function pernasTab(r) {
    return `<table class="tab op-pernas"><tr><th>Perna</th><th>Papel</th><th class="n">Strike</th><th class="n">Preço</th><th class="n">Delta</th><th class="n">Neg.</th></tr>
      ${(r.pernas || []).map((p) => `<tr><td><b>${esc(NOME_LADO[p.lado] || p.lado)}</b> ${p.qtd * 100} ${p.tipo === "acao" ? "ações" : esc(p.tipo) + "s"}</td><td>${esc(p.tk)}</td>
        <td class="n">${p.k == null ? "—" : n2(p.k)}</td><td class="n">${n2(p.preco)}${p.fonte === "fech" ? "<sup>f</sup>" : p.fonte === "ref" ? "<sup>r</sup>" : ""}</td>
        <td class="n">${p.delta == null ? "—" : n2(p.delta)}</td><td class="n">${p.neg == null ? "—" : inteiro(p.neg)}</td></tr>`).join("")}</table>`;
  }
  const det = (chave, titulo, corpo, aberto = false) => `<details data-ab="${esc(chave)}"${(chave in S.abertos ? S.abertos[chave] : aberto) ? " open" : ""}><summary>${titulo}</summary>${corpo}</details>`;

  function cartao(e) {
    const cab = `<div class="op-e-cab"><div><b>${esc(e.nome)}</b><small>visão ${esc(e.visao || "")}</small></div>`;
    if (!e.disponivel) return `<div class="card op-e">${cab}<span class="selo neutro">INDISPONÍVEL AGORA</span></div><p class="op-e-res">${esc(e.resumo || "")}</p><div class="nota">${esc(e.motivo || "Não deu para montar com as séries deste vencimento.")}</div></div>`;
    const m = e.entra_agora || { motivos: [] }, okN = m.motivos.filter((c) => c.ok).length;
    return `<div class="card op-e">${cab}<span class="selo ${m.ok ? "verde" : "neutro"}" data-dica="${esc(m.nota || "")}">${m.ok ? "✓ REGRAS ATENDIDAS" : `REGRAS: ${okN} DE ${m.motivos.length}`}</span></div>
      <p class="op-e-res">${esc(e.resumo || "")}</p>
      ${pernasTab(e)}${tiles(e)}${grafico("g-" + e.id, e)}
      ${det(e.id + ":regras", `Conferência das regras agora (${okN} de ${m.motivos.length})`, `<ul class="op-ck">${m.motivos.map((c) => `<li class="${c.ok ? "ok" : "nao"}"><i>${c.ok ? "✓" : "✗"}</i><span><b>${c.ok ? "Atende" : "Não atende"}:</b> ${esc(c.txt)}</span></li>`).join("")}</ul><div class="nota">${esc(m.nota || "")}</div>`, true)}
      ${det(e.id + ":passos", "Passo a passo", `<ol class="op-passos">${(e.passos || []).map((p) => `<li>${esc(p)}</li>`).join("")}</ol>`)}
      ${det(e.id + ":riscos", "Quando perde e o risco de cauda", `<div class="op-risco"><b>Quando perde</b><p>${esc(e.quandoPerde || "")}</p><b>Risco de cauda (o dia ruim de verdade)</b><p>${esc(e.riscoCauda || "")}</p>
        <b>Sensibilidade agora (1 lote)</b><p>Delta ${sinalNum(e.gregas.delta, 0)} (ganha ou perde isso em R$ se a ação subir R$ 1,00) · Theta ${rs(e.gregas.theta, true)} por dia útil · Vega ${rs(e.gregas.vega, true)} por ponto de VI.</p></div>`)}
      ${avisos(e.avisos)}</div>`;
  }
  function renderEstr() {
    const el = $("opEstr"), d = S.estr;
    if (!d) { el.innerHTML = ""; return; }
    let h = `<div class="card"><div class="rot">${ic('<path d="M4 18l5-6 4 3 7-9"/><path d="M4 21h16"/>')}5 ESTRUTURAS PARA ESTUDAR ${q("Cada estrutura é montada pelo robô com séries reais deste vencimento, seguindo regras fixas (prazo, delta, liquidez, tendência). O selo mostra só se as regras da própria estrutura estão atendidas agora. Não é recomendação de compra ou venda.")}<span class="dir">${esc(d.ativo)} · ${dataBR(d.venc, true)}${d.du == null ? "" : " · " + d.du + " d.u."}</span></div>
      <div class="nota">${esc(d.nota || "")} Valores para 1 lote (100 opções).</div></div>`;
    if (!(d.lista || []).length) h += `<div class="vazio-bloco">Sem dados suficientes para montar as estruturas neste vencimento agora.</div>`;
    else h += d.lista.map(cartao).join("");
    el.innerHTML = h;
  }

  // ---------------------------------------------------------------- montar a minha
  function renderMontar() {
    const el = $("opMontar"), g = S.grade;
    if (!g || !g.linhas.length) { el.innerHTML = ""; return; }
    let h = `<div class="card"><div class="rot">${ic('<path d="M12 5v14M5 12h14"/>')}MONTAR A MINHA ${q("Junte pernas da grade (clique numa linha e use os botões “+ Comprar” / “+ Vender”) e veja o resultado da combinação. Tudo no mesmo vencimento. É simulação: nada é enviado para a corretora.")}<span class="dir">${esc(g.ativo)} · ${dataBR(g.venc, true)}</span></div>`;
    if (!S.pernas.length) {
      h += `<div class="nota">Nenhuma perna ainda. Clique numa linha da grade e escolha “+ Comprar no montador” ou “+ Vender no montador”.</div>
        <div class="botoes finos"><button data-ac="acao">+ 100 ações de ${esc(g.ativo)}</button></div></div>`;
      el.innerHTML = h; return;
    }
    h += `<table class="tab op-pernas"><tr><th>Lado</th><th>Papel</th><th class="n">Strike</th><th class="n">Lotes</th><th class="n">Preço${q("Em branco, o robô usa o preço da grade. Digite outro valor para simular o preço que você acha que conseguiria.")}</th><th></th></tr>
      ${S.pernas.map((p, i) => `<tr><td><div class="seg mini"><button class="${p.lado === "compra" ? "on" : ""}" data-ac="lado" data-i="${i}" data-v="compra">Compra</button><button class="${p.lado === "venda" ? "on" : ""}" data-ac="lado" data-i="${i}" data-v="venda">Venda</button></div></td>
        <td>${p.tipo === "acao" ? "ações " + esc(g.ativo) : esc(p.tipo) + " " + esc(p.tk)}</td><td class="n">${p.k == null ? "—" : n2(p.k)}</td>
        <td class="n"><input class="op-in" type="number" min="1" max="1000" step="1" value="${+p.qtd || 1}" data-ac="qtd" data-i="${i}" aria-label="Lotes"></td>
        <td class="n"><input class="op-in" type="number" min="0.01" step="0.01" value="${p.preco == null ? "" : +p.preco}" placeholder="${p.ref == null ? "" : n2(p.ref)}" data-ac="preco" data-i="${i}" aria-label="Preço"></td>
        <td class="n"><button class="mini-btn" data-ac="rm" data-i="${i}" aria-label="Remover perna">✕</button></td></tr>`).join("")}</table>
      <div class="botoes finos"><button data-ac="acao">+ 100 ações de ${esc(g.ativo)}</button><button data-ac="limpar">Limpar</button></div><div id="opSim">${simHtml()}</div></div>`;
    el.innerHTML = h;
  }
  function simHtml() {
    const r = S.sim;
    if (!r) return '<div class="nota">calculando…</div>';
    if (r.erro) return `<div class="erro">⚠ ${esc(r.erro)}</div>`;
    return `${tiles(r)}${grafico("g-sim", r)}<div class="nota">${esc(r.capitalTxt || "")}. ${esc(r.nota || "")}</div>${avisos(r.avisos)}`;
  }
  function simular() {
    clearTimeout(S.simT);
    if (!S.pernas.length) { S.sim = null; return; }
    S.simT = setTimeout(async () => {
      const seq = ++S.simSeq, g = S.grade;
      if (!g) return;
      const pernas = S.pernas.map((p) => ({ tipo: p.tipo, lado: p.lado, tk: p.tk || "", k: p.k, qtd: p.qtd, preco: p.preco, ativo: g.ativo, venc: g.venc }));
      let r;
      try { r = await AX.post("/api/opcoes/simular", { pernas, ativo: g.ativo, venc: g.venc }, { tempo: 25000 }); }
      catch (e) { r = { erro: e.message || String(e) }; }
      if (seq !== S.simSeq) return;
      S.sim = r;
      const el = $("opSim"); if (el) el.innerHTML = simHtml();
    }, 300);
  }

  // ---------------------------------------------------------------- oportunidades
  function renderOport() {
    const el = $("opOport"), d = S.oport;
    if (!d) { el.innerHTML = ""; return; }
    const seg = [["vi", "VI × histórica"], ["volume", "Mais negociadas"], ["cobertas", "Lançamento coberto"]];
    let h = `<div class="card"><div class="rot">${ic('<circle cx="11" cy="11" r="6"/><path d="M20 20l-4.5-4.5"/>')}OPORTUNIDADES (TRIAGEM) ${q("Um filtro para saber onde olhar, com os dados do fechamento do último pregão nos ativos mais líquidos. Não é sinal de compra nem de venda.")}<span class="dir">${d.dataGrade ? "fechamento de " + dataBR(d.dataGrade, true) : ""}</span></div>
      <div class="seg mini op-seg">${seg.map(([k, n]) => `<button class="${S.opSeg === k ? "on" : ""}" data-ac="opseg" data-v="${k}">${n}</button>`).join("")}</div>`;
    const lista = d[S.opSeg] || [];
    if (!lista.length) h += `<div class="vazio-bloco">${esc(d.dataGrade ? "Nada passou nos filtros desta lista." : d.aviso || "Sem dados para a triagem agora.")}</div>`;
    else if (S.opSeg === "vi") {
      h += `<table class="tab"><tr><th>Ativo</th><th class="n">Fech.</th><th class="n">VI${q("VI no dinheiro, no vencimento com mais negócios entre 8 e 60 dias úteis.")}</th><th class="n">Vol. hist. 21</th><th class="n">VI ÷ hist.${q("Acima de 1: o mercado está cobrando mais volatilidade do que a ação mostrou no último mês (opções relativamente caras). Abaixo de 1: relativamente baratas. Normalmente há motivo: resultado chegando, notícia, eleição.")}</th><th>Vencimento</th></tr>
        ${lista.map((x) => `<tr class="clic" data-ac="ir" data-v="${esc(x.ativo)}" data-venc="${esc(x.venc)}"><td><b>${esc(x.ativo)}</b></td><td class="n">${n2(x.spot)}</td><td class="n">${vol(x.viAtm)}</td><td class="n">${vol(x.hv21)}</td>
          <td class="n"><b>${x.razao == null ? "—" : AX.num(x.razao, 2)}</b> <span class="neutro">${x.razao == null ? "" : x.razao >= 1.15 ? "cara" : x.razao <= 0.9 ? "barata" : "na média"}</span></td><td>${dataBR(x.venc)} · ${x.du} d.u.</td></tr>`).join("")}</table>`;
    } else if (S.opSeg === "volume") {
      h += `<div class="rolagem"><table class="tab"><tr><th>Série</th><th>Tipo</th><th class="n">Strike</th><th class="n">Dist.</th><th>Venc.</th><th class="n">Último</th><th class="n">Neg.</th><th class="n">Volume</th><th class="n">Em aberto</th></tr>
        ${lista.map((x) => `<tr class="clic" data-ac="ir" data-v="${esc(x.ativo)}" data-venc="${esc(x.venc)}"><td><b>${esc(x.tk)}</b> <span class="neutro">${esc(x.ativo)}</span></td><td>${esc(x.tipo)}</td><td class="n">${n2(x.k)}</td><td class="n">${sinalNum(x.dist, 1)}%</td>
          <td>${dataBR(x.venc)}</td><td class="n">${n2(x.ult)}</td><td class="n">${inteiro(x.neg)}</td><td class="n">R$ ${curto(x.vol)}</td><td class="n">${curto(x.oi)}</td></tr>`).join("")}</table></div>`;
    } else {
      h += `<div class="rolagem"><table class="tab"><tr><th>Série</th><th class="n">Strike</th><th class="n">Acima${q("Quanto o strike está acima do preço da ação: é até onde a ação pode subir antes de você ser exercido.")}</th><th>Venc.</th><th class="n">Prêmio</th><th class="n">Delta</th>
        <th class="n">Taxa${q("Prêmio ÷ preço da ação: quanto o lançamento coberto rende no período SE a ação não cair e você não for exercido. É também o tamanho da queda que o prêmio amortece.")}</th>
        <th class="n">Ao ano${q("A taxa do período repetida o ano inteiro (252 dias úteis). Não é renda garantida: supõe que a ação nunca cai e que sempre há série igual para vender.")}</th><th class="n">Neg.</th></tr>
        ${lista.map((x) => `<tr class="clic" data-ac="ir" data-v="${esc(x.ativo)}" data-venc="${esc(x.venc)}"><td><b>${esc(x.tk)}</b> <span class="neutro">${esc(x.ativo)}</span></td><td class="n">${n2(x.k)}</td><td class="n">${sinalNum(x.dist, 1)}%</td>
          <td>${dataBR(x.venc)} · ${x.du} d.u.${x.semanal ? " · S" : ""}</td><td class="n">${n2(x.premio)}</td><td class="n">${n2(x.delta)}</td><td class="n"><b>${AX.num(x.pctSpot, 2)}%</b></td><td class="n">${AX.num(x.aoAno, 0)}%</td><td class="n">${inteiro(x.neg)}</td></tr>`).join("")}</table></div>`;
    }
    h += `<div class="nota">${esc(d.aviso || "")}</div>${d.filtros ? `<div class="nota">${esc(d.filtros)} Clique numa linha para abrir o ativo e o vencimento.</div>` : ""}</div>`;
    el.innerHTML = h;
  }

  // ---------------------------------------------------------------- glossário
  function glossario() {
    const G = [
      ["Call", "Opção de compra. Quem COMPRA uma call paga o prêmio e ganha o direito de comprar a ação pelo strike até o vencimento: ganha se a ação subir bastante. Quem VENDE a call recebe o prêmio e assume a obrigação de entregar a ação pelo strike se for exercido."],
      ["Put", "Opção de venda. Quem COMPRA uma put paga o prêmio e ganha o direito de vender a ação pelo strike: funciona como um seguro contra queda. Quem VENDE a put recebe o prêmio e assume a obrigação de comprar a ação pelo strike se for exercido."],
      ["Strike", "O preço combinado de exercício. Atenção: na B3 o número que aparece no código da série (ex.: PETRK556) não é o strike; o strike verdadeiro está na coluna do meio da grade e muda quando a empresa paga dividendos."],
      ["Prêmio", "O preço da opção, cotado por ação. Como o lote é de 100, um prêmio de R$ 1,50 custa R$ 150,00. Quem compra a opção pode perder o prêmio inteiro, e isso acontece com frequência."],
      ["Dentro, no e fora do dinheiro (ITM, ATM, OTM)", "Dentro do dinheiro: a opção já teria valor se vencesse agora (call com strike abaixo do preço; put com strike acima). No dinheiro: strike colado no preço. Fora do dinheiro: só terá valor se a ação andar até lá."],
      ["Delta", "Quanto o prêmio anda quando a ação anda R$ 1,00. Vai de 0 a 1 nas calls e de −1 a 0 nas puts. Serve também de aproximação grosseira da chance de a opção terminar com valor: delta 0,25 ≈ 25%."],
      ["Theta", "A perda de valor só pela passagem do tempo, por dia útil. Todo dia que passa, a opção vale um pouco menos, e essa perda acelera perto do vencimento. É o inimigo de quem compra e o aliado de quem vende."],
      ["VI (volatilidade implícita)", "A volatilidade que o preço da opção está “embutindo”. VI alta = opções caras: o mercado espera movimento forte (resultado, notícia). Comparar com a volatilidade histórica ajuda a ver se o prêmio está gordo ou magro, mas caro pode ficar mais caro."],
      ["Exercício", "Usar o direito da opção. No vencimento, opções dentro do dinheiro são exercidas automaticamente: quem vendeu call entrega as ações; quem vendeu put compra as ações. As calls americanas podem ser exercidas antes; as europeias, só no vencimento."],
      ["Lote", "Opções sobre ações são negociadas em lotes de 100. Todos os valores em reais desta aba são para 1 lote, salvo quando dito."],
      ["Garantia (margem)", "Quem VENDE opção assume uma obrigação e precisa deixar garantia bloqueada na corretora: as próprias ações (venda coberta), dinheiro ou títulos. Venda sem cobertura tem risco de perda muito maior que o prêmio recebido e pode gerar chamada de margem: se você não depositar, a corretora encerra a posição no prejuízo."],
      ["Vencimento", "O último dia da opção. As mensais vencem na terceira sexta-feira do mês. Depois dele a opção deixa de existir: ou foi exercida, ou virou pó."],
    ];
    return `<div class="card"><details data-ab="gloss"><summary class="op-gl-s">GLOSSÁRIO PARA QUEM ESTÁ COMEÇANDO</summary>
      <dl class="op-gl">${G.map(([t, d]) => `<dt>${t}</dt><dd>${d}</dd>`).join("")}</dl>
      <div class="nota">Opções podem levar à perda de todo o valor investido e, na venda a descoberto, a perdas maiores que ele. Estude com valores pequenos e confira as regras e os custos na sua corretora. Esta aba não é recomendação de investimento.</div></details></div>`;
  }

  // ---------------------------------------------------------------- servidor
  const tudo = () => { renderCab(); renderVencs(); renderGrade(); renderEstr(); renderMontar(); renderOport(); };
  function agendar(ms) {
    clearTimeout(S.relogio);
    if (S.ativa) S.relogio = setTimeout(() => carregar(false), ms);
  }
  async function carregar(primeira) {
    if (!S.ativa) return;
    if (document.hidden) return;                       // volta sozinho quando a janela reaparecer (visibilitychange)
    if (S.ocupado && !primeira) { agendar(5000); return; }
    const seq = ++S.seq, ativo = S.ativo;
    S.ocupado = true;
    let espera = 30000;
    try {
      let p;
      try { p = await AX.json(url("painel", { ativo }), { tempo: 25000 }); }
      catch (e) { if (seq === S.seq) { AX.erro("erroOpcoes", e); if (!S.painel) renderCab(); } espera = 15000; return; }
      if (seq !== S.seq) return;
      AX.erro("erroOpcoes", null);
      S.painel = p;
      const datas = (p.vencs || []).map((v) => v.data);
      if (!S.venc || !datas.includes(S.venc)) S.venc = p.vencPadrao || datas[0] || null;
      renderCab(); renderVencs();
      if (!datas.length) {
        S.grade = null; S.estr = null; renderGrade(); renderEstr(); renderMontar();
        espera = p.download && p.download.estado === "baixando" ? 2500 : 30000;
      } else {
        const venc = S.venc, par = { ativo, venc };
        if (!S.grade || S.grade.ativo !== ativo || S.grade.venc !== venc) renderGrade();
        const [g, e] = await Promise.allSettled([AX.json(url("grade", par), { tempo: 30000 }), AX.json(url("estruturas", par), { tempo: 30000 })]);
        if (seq !== S.seq) return;
        if (g.status === "fulfilled") { S.grade = g.value; if (S.grade.venc && S.grade.venc !== S.venc) { S.venc = S.grade.venc; renderVencs(); } }
        else AX.erro("erroOpcoes", g.reason);
        if (e.status === "fulfilled") S.estr = e.value;
        renderGrade(); renderEstr();
        if (!$("opMontar").innerHTML || !S.pernas.length) renderMontar();
        if (S.pernas.length) simular();
        if (p.download && p.download.estado === "baixando") espera = 5000;
      }
      if (p.dataGrade && S.oportData !== p.dataGrade) {
        try { const o = await AX.json(url("oportunidades"), { tempo: 40000 }); if (seq === S.seq) { S.oport = o; S.oportData = o.dataGrade || null; renderOport(); } }
        catch (er) { /* a triagem é um extra: tenta de novo na próxima volta */ }
      }
    } finally {
      if (seq === S.seq) { S.ocupado = false; agendar(espera); }
    }
  }

  // ---------------------------------------------------------------- ações do usuário
  function trocarAtivo(txt, venc) {
    const a = String(txt || "").trim().toUpperCase();
    if (!ATIVO_OK.test(a)) { AX.toast("Código inválido. Use 4 letras e 1 ou 2 números, como PETR4.", "erro"); return; }
    if (a === S.ativo && (!venc || venc === S.venc)) return;
    const outro = a !== S.ativo;
    S.ativo = a; S.venc = venc || (outro ? null : S.venc);
    if (outro) S.painel = null;
    S.grade = null; S.estr = null; S.selK = null; S.pernas = []; S.sim = null; S.graf = {};
    try { localStorage.setItem("apex_opcoes_ativo", a); } catch (e) { /* ok */ }
    tudo();
    S.ocupado = false;
    carregar(true);
    if (venc || outro) { const c = $("opCab"); if (c && c.scrollIntoView) c.scrollIntoView({ block: "nearest" }); }
  }
  function trocarVenc(v) {
    if (!v || v === S.venc) return;
    S.venc = v; S.grade = null; S.estr = null; S.selK = null; S.sim = null; S.graf = {};
    if (S.pernas.length) AX.toast("O montador foi limpo: as pernas eram de outro vencimento.");
    S.pernas = [];
    renderVencs(); renderGrade(); renderEstr(); renderMontar();
    S.ocupado = false;
    carregar(true);
  }
  function clique(e) {
    const b = e.target.closest("[data-ac]");
    if (!b || b.tagName === "INPUT") return;
    const ac = b.dataset.ac, v = b.dataset.v, i = +b.dataset.i;
    if (ac === "ativo") trocarAtivo(v);
    else if (ac === "venc") trocarVenc(v);
    else if (ac === "ir") trocarAtivo(v, b.dataset.venc);
    else if (ac === "linha") {
      if (e.target.closest(".q")) return;
      const k = parseFloat(v); S.selK = S.selK === k ? null : k;
      b.parentNode.querySelectorAll("tr.sel").forEach((t) => t.classList.remove("sel"));
      if (S.selK != null) b.classList.add("sel");
      const d = $("opDet"); if (d) d.innerHTML = detalhe();
    } else if (ac === "add") {
      const x = serie(b.dataset.tk);
      if (!x) return;
      if (S.pernas.length >= 8) { AX.toast("No máximo 8 pernas.", "erro"); return; }
      S.pernas.push({ tipo: x.tipo, lado: b.dataset.lado === "venda" ? "venda" : "compra", tk: x.tk, k: x.k, qtd: 1, preco: null, ref: x.preco });
      S.sim = null; renderMontar(); simular();
      AX.toast(`${b.dataset.lado === "venda" ? "Venda" : "Compra"} de ${x.tk} adicionada ao montador.`);
    } else if (ac === "acao") {
      if (S.pernas.length >= 8) { AX.toast("No máximo 8 pernas.", "erro"); return; }
      S.pernas.push({ tipo: "acao", lado: "compra", tk: "", k: null, qtd: 1, preco: null, ref: S.grade ? S.grade.spot : null });
      S.sim = null; renderMontar(); simular();
    } else if (ac === "rm") { S.pernas.splice(i, 1); S.sim = null; renderMontar(); simular(); }
    else if (ac === "limpar") { S.pernas = []; S.sim = null; renderMontar(); }
    else if (ac === "lado") { if (S.pernas[i]) { S.pernas[i].lado = v === "venda" ? "venda" : "compra"; S.sim = null; renderMontar(); simular(); } }
    else if (ac === "opseg") { S.opSeg = v; renderOport(); }
  }
  function mudou(e) {
    const b = e.target, ac = b.dataset && b.dataset.ac, p = S.pernas[+b.dataset.i];
    if (!p) return;
    if (ac === "qtd") { p.qtd = Math.max(1, Math.min(1000, Math.round(+b.value) || 1)); b.value = p.qtd; }
    else if (ac === "preco") { const x = parseFloat(b.value); p.preco = x > 0 && isFinite(x) ? x : null; if (p.preco == null) b.value = ""; }
    else return;
    const s = $("opSim"); if (s) s.innerHTML = '<div class="nota">calculando…</div>';
    simular();
  }

  // ---------------------------------------------------------------- ligar e desligar
  AX.on("aba", (nome) => {
    S.ativa = nome === "opcoes";
    if (!S.ativa) { clearTimeout(S.relogio); return; }
    montar();
    if (!S.montado) return;
    tudo();
    S.ocupado = false;
    carregar(true);
  });
  document.addEventListener("visibilitychange", () => { if (S.ativa && !document.hidden) { S.ocupado = false; carregar(true); } });
})();
