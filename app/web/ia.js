/* ROBÔ APEX — aba IA. Mostra o que o robô aprendeu com as operações já encerradas deste ativo e tempo gráfico:
   a nota da IA medida FORA da amostra (em operações que ela ainda não conhecia), o que teria acontecido seguindo as
   notas dela, as lições que os dados sustentam, o que deu errado que poderia ter dado certo, o que mais pesa na nota e
   o diário de aprendizado. Se a IA não acerta mais que o acaso, a tela diz isso com todas as letras. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const S = { dados: null, chave: "", seq: 0, relogio: null, selo: "" };
  const chaveIA = () => { const p = AX.pref; return [p.ativo, p.tf, p.gestao, p.contratos].join("|"); };
  const consulta = () => { const p = AX.pref; return new URLSearchParams({ ativo: p.ativo, tf: p.tf, est: p.est, gestao: p.gestao, contratos: p.contratos }).toString(); };
  const R = (v) => AX.R(v), pct = (v, d = 0) => AX.pct(v, d);
  const ic = (d) => `<svg class="ic" viewBox="0 0 24 24">${d}</svg>`;

  function veredito(d) {
    if (d.estado === "erro") return { cls: "vermelho", selo: "ERRO", txt: "Não consegui treinar a IA: " + (d.erro || "erro desconhecido") + "." };
    if (d.estado === "treinando") return { cls: "neutro", selo: "ESTUDANDO", txt: "A IA está estudando o histórico deste ativo. Leva alguns segundos; a tela atualiza sozinha." };
    if (d.estado === "poucos") return { cls: "neutro", selo: "APRENDENDO", txt: `Ainda há poucas operações encerradas neste ativo e tempo gráfico para a IA aprender: ${d.n} de ${d.minimo}. Ela começa sozinha quando houver o bastante.` };
    if (!d.nota) return { cls: "neutro", selo: "SEM PROVA AINDA", txt: `A IA já montou um modelo com ${d.n} operações, mas ainda faltam operações para a prova fora da amostra. Por enquanto as notas dela são só leitura.` };
    if (d.nota.comprovada) return { cls: "verde", selo: "APROVADA FORA DA AMOSTRA", txt: "Neste ativo e tempo gráfico, as operações com nota alta renderam mais que as de nota baixa, e isso se repetiu nas duas metades do período de prova. É resultado passado: não garante o futuro." };
    return { cls: "amarelo", selo: "AINDA NÃO COMPROVADA", txt: "Neste ativo e tempo gráfico a IA ainda não separa as operações boas das ruins melhor que o acaso. Use as notas dela só como leitura, não como filtro." };
  }

  // barra que cresce do zero para a direita (positivo) ou para a esquerda (negativo); o número vai escrito ao lado
  function barra(v, max) {
    if (v == null || !(max > 0)) return '<span class="bz"></span>';
    const w = Math.max(1.5, Math.min(50, (50 * Math.abs(v)) / max));
    return `<span class="bz"><i class="${v >= 0 ? "bom" : "ruim"}" style="${v >= 0 ? "left:50%" : "right:50%"};width:${w}%"></i></span>`;
  }
  const fatia = (parte, total) => (total > 0 ? `<span class="fatia"><i style="width:${Math.max(1, (100 * parte) / total)}%"></i></span>` : "");

  function cartaoSinal() {
    const D = AX.vivo.D;
    if (!D) return "";
    const e = AX.estadoEm(D, D.meta.iFim), m = e.meta || D.meta, lista = e.pend.filter((o) => o.ia);
    const ok = m.ia && m.ia.comprovada;
    let h = `<div class="rot">${ic('<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/>')}O SINAL DE AGORA<span class="dir">${AX.esc(AX.rotAtivo(D.meta.ativo))} · ${AX.esc(D.meta.nomeTf)}</span></div>`;
    if (lista.length) {
      h += lista.map((o) => {
        const p = o.ia[0], pq = (o.iaPq || []).map((x) => `<span class="chip ${x.efeito > 0 ? "sobe" : "desce"}">${x.efeito > 0 ? "▲" : "▼"} ${AX.esc(x.rotulo)}</span>`).join("");
        return `<div class="ia-sinal"><div class="ia-chance"><b>${AX.num(100 * p, 0)}%</b><small>chance de ganho</small></div>
          <div><div><b>${AX.esc(o.est)}</b> · ${o.dir > 0 ? "compra" : "venda"} armada${o.gatilho != null ? " em " + AX.fmt(o.gatilho) : " a mercado"} · esperado <b class="${AX.cls(o.ia[1])}">${R(o.ia[1])}</b></div>
          <div class="ia-trilho"><i style="width:${Math.max(2, Math.min(100, 100 * p))}%"></i>${m.ia && m.ia.base != null ? `<u style="left:${Math.min(100, 100 * m.ia.base)}%" data-dica="Acerto médio de todas as operações deste ativo: ${pct(100 * m.ia.base)}"></u>` : ""}</div>
          ${pq ? `<div class="mo-pq">${pq}</div>` : ""}</div></div>`;
      }).join("") + `<div class="nota">${ok ? "Modelo aprovado fora da amostra neste ativo." : "Modelo ainda sem comprovação neste ativo: a chance é só uma leitura."} A marca na barra é o acerto médio de todas as operações; ▲ e ▼ são as leituras que mais empurraram esta nota.</div>`;
    } else if (e.pos && e.pos.ia) {
      h += `<div class="nota">Operação aberta em ${AX.esc(e.pos.est)}: quando o sinal apareceu, a IA dava <b>${AX.num(100 * e.pos.ia[0], 0)}%</b> de chance de ganho e esperava <b class="${AX.cls(e.pos.ia[1])}">${R(e.pos.ia[1])}</b>.</div>`;
    } else {
      h += `<div class="nota">Nenhuma ordem armada agora${m.ia && m.ia.estado !== "pronta" ? " (e a IA deste ativo ainda não tem modelo pronto)" : ""}. Quando uma estratégia armar uma entrada, a chance estimada aparece aqui, no cartão do Ao vivo e na central de sinais.</div>`;
    }
    return h;
  }
  function renderSinal() { const el = $("iaSinal"); if (el) el.innerHTML = cartaoSinal(); }

  function render() {
    const el = $("iaConteudo"), d = S.dados, p = AX.pref;
    const onde = `${AX.esc(AX.rotAtivo(p.ativo))} · ${AX.esc((AX.cfg.tempos.find((t) => +t.tf === +p.tf) || {}).nome || p.tf + " min")} · gestão ${AX.esc((AX.cfg.gestoesCurto || {})[p.gestao] || p.gestao)}`;
    if (!d) {
      el.innerHTML = `<div class="card"><div class="rot">${ic('<rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 7V3M9 12h.01M15 12h.01M9 15.5h6"/>')}IA<span class="dir">${onde}</span></div><div class="nota">carregando…</div></div>`;
      return;
    }
    const v = veredito(d), n = d.nota;
    let h =`<div class="card ia-hero ${v.cls}">
      <div class="rot">${ic('<rect x="5" y="7" width="14" height="11" rx="2"/><path d="M12 7V3M9 12h.01M15 12h.01M9 15.5h6M2 11v4M22 11v4"/>')}IA DO ROBÔ ${AX.q("A IA aprende com as operações encerradas de TODAS as estratégias neste ativo, tempo gráfico e gestão. Para cada sinal ela olha 15 leituras do momento (tamanho do stop, custo, tendência do diário, distância das médias, hora do pregão etc.) e estima a chance de ganho. Um modelo novo é montado sempre que entram operações novas.")}<span class="dir">${onde}</span></div>
      <div class="ia-topo"><span class="selo ${v.cls}">${v.selo}</span>${d.treinando && d.estado !== "treinando" ? '<span class="ia-atual"><i class="luz vivo"></i> reestudando com as operações novas…</span>' : d.feito ? `<span class="ia-atual">estudou às ${AX.horaBR(d.feito)}</span>` : ""}</div>
      <p class="ia-frase">${AX.esc(v.txt)}</p>`;
    if (d.estado === "pronta" || d.estado === "poucos") {
      const dif = n ? n.alto.mediaR - n.baixo.mediaR : null;
      h += `<div class="tiles">
        <div class="tile"><small>Estudadas${AX.q("Operações encerradas de todas as estratégias, cada uma sozinha, no histórico inteiro deste ativo e tempo gráfico. Precisa de " + d.minimo + " para começar.")}</small><b>${AX.num(d.n, 0)}</b><em>${d.base && d.base.acerto != null ? "operações · acerto " + pct(d.base.acerto) + " · média " + R(d.base.mediaR) : "de " + d.minimo + " operações necessárias"}</em></div>
        <div class="tile"><small>Ordenação${AX.q("De cada 100 pares formados por uma operação que ganhou e uma que perdeu, em quantos a IA tinha dado nota maior para a que ganhou. 50% é o mesmo que jogar moeda. Medido só em operações que ela ainda não conhecia.")}</small><b>${n && n.auc != null ? pct(100 * n.auc, 1) : "—"}</b><em>de acerto · 50% é o acaso</em></div>
        <div class="tile"><small>Alta − baixa${AX.q("Resultado médio do terço de operações com as maiores notas menos o do terço com as menores, fora da amostra. Se a IA sabe alguma coisa, este número é positivo e se repete nas duas metades do período.")}</small><b class="${AX.cls(dif)}">${dif == null ? "—" : R(dif)}</b><em>${n ? "nota alta menos nota baixa · metades " + R(n.metades[0]) + " e " + R(n.metades[1]) : "sem prova ainda"}</em></div>
      </div>`;
      if (n && n.auc != null) {
        const lo = 0.4, hi = 0.65, pos = (x) => Math.max(0, Math.min(100, (100 * (x - lo)) / (hi - lo)));
        h += `<div class="auc" role="img" aria-label="Acerto de ordenação ${pct(100 * n.auc, 1)}; 50% é o acaso e 52% é o mínimo para aprovar">
          <div class="auc-trilho"><i class="auc-ruim" style="width:${pos(0.5)}%"></i><i class="auc-meio" style="left:${pos(0.5)}%;width:${pos(0.52) - pos(0.5)}%"></i><i class="auc-bom" style="left:${pos(0.52)}%;width:${100 - pos(0.52)}%"></i>
            <u style="left:${pos(0.5)}%"></u><b style="left:${pos(n.auc)}%"></b></div>
          <div class="auc-rot"><span style="left:${pos(0.5)}%">acaso 50%</span><span style="left:${pos(0.585)}%">melhor que o acaso →</span></div></div>`;
      }
    }
    h += `</div><div class="card" id="iaSinal">${cartaoSinal()}</div>
      <div class="card"><div class="rot">${ic('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>')}AJUSTE DA ESTRATÉGIA ${AX.q("O robô testa todas as gestões (2:1, 3:1, 4:1, parcial, condução, trailing, escalonadas) combinadas com as proteções do stop nesta estratégia. Para não escolher por sorte, escolhe a melhor usando só a primeira metade do histórico e depois confere na segunda metade, que não participou da escolha. Só vira sugestão se ganhar também na segunda metade.")}<span class="dir">${AX.esc(AX.nomeEst(p.est))}</span></div>
        <div id="iaAjuste"><div class="botoes finos"><button id="iaAjustar">Procurar o melhor ajuste para esta estratégia</button></div>
        <div class="nota">Leva de alguns segundos a um minuto: são 60 simulações completas com custos.</div></div></div>`;

    if (n) {
      const linhas = [["Todas as operações", n.todas], ["Só as que a IA aprovava", n.favor], ["As que a IA reprovava", n.contra], ["Terço com as maiores notas", n.alto], ["Terço com as menores notas", n.baixo]];
      const max = Math.max(0.01, ...linhas.map(([, x]) => Math.abs(x.mediaR || 0)));
      h += `<div class="card"><div class="rot">${ic('<path d="M4 19h16M7 16V9M12 16V5M17 16v-4"/>')}SE VOCÊ TIVESSE SEGUIDO A IA ${AX.q("A prova fora da amostra: o histórico é cortado em 6 blocos de tempo; para cada bloco a IA treina só com as operações que já tinham terminado antes dele e dá nota às do bloco. “Aprovava” = valor esperado maior que zero. Os resultados são por operação, em múltiplos do risco (R), já com custos.")}<span class="dir">${n.n} operações de prova</span></div>
        <table class="tab ia-tab"><tr><th>Grupo</th><th class="n">Ops</th><th class="n">Média</th><th></th></tr>
        ${linhas.map(([nome, x]) => `<tr><td>${nome}</td><td class="n">${x.n}</td><td class="n ${AX.cls(x.mediaR)}">${x.n ? R(x.mediaR) : "—"}</td><td class="ia-b">${x.n ? barra(x.mediaR, max) : ""}</td></tr>`).join("")}</table>
        <div class="nota">${n.comprovada ? "As aprovadas renderam mais que as reprovadas no período de prova." : n.favor.n && n.favor.mediaR > n.todas.mediaR ? "As aprovadas foram um pouco melhores, mas a diferença ainda cabe no acaso (ou não se repetiu nas duas metades)." : "Filtrar pelas notas da IA não melhorou o resultado no período de prova."} Mesmo aprovada, a IA só melhora a escolha entre operações de uma estratégia: ela não transforma em lucrativa uma estratégia que perde.</div></div>`;
    }

    if (d.estado === "pronta") {
      const L = d.licoes || [];
      h += `<div class="card"><div class="rot">${ic('<path d="M9 18h6M10 21h4M12 3a6 6 0 00-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0012 3z"/>')}LIÇÕES ${AX.q("Leituras em que o resultado foi claramente diferente do resto: pelo menos 40 operações de cada lado, diferença forte (t de 3 ou mais) e com o mesmo sinal nas duas metades do período. O critério é duro de propósito: com menos que isso apareciam “lições” por puro acaso.")}<span class="dir">o que os dados sustentam</span></div>
        ${L.length ? L.map((x) => `<div class="licao ${x.melhor ? "boa" : "ma"}"><i>${x.melhor ? "▲" : "▼"}</i><div><b>${x.melhor ? "Foi melhor" : "Foi pior"} ${AX.esc(x.quando)}</b>
          <span>${x.n} operações · média <b class="${AX.cls(x.mediaR)}">${R(x.mediaR)}</b> · acerto ${pct(x.acerto)} · nas outras: <b class="${AX.cls(x.restoR)}">${R(x.restoR)}</b></span></div></div>`).join("")
    : '<div class="nota">Nenhuma leitura mostrou diferença firme e repetida nas duas metades do período. Isso é comum e é uma resposta honesta: os dados não sustentam nenhuma regra extra aqui.</div>'}
        ${L.length ? '<div class="nota">São padrões do passado deste ativo. Sirva-se deles para decidir o que testar (por exemplo, o modo seletivo na aba Plano), não como garantia.</div>' : ""}</div>`;

      const er = d.erros;
      if (er && (er.perdas || er.ganhos)) {
        const item = (parte, total, txt, dica) => (total > 0 ? `<div class="erro-ac"><div class="erro-n"><b>${parte}</b><small>de ${total}</small></div><div><span>${txt}</span>${fatia(parte, total)}<em>${pct((100 * parte) / total)} · ${dica}</em></div></div>` : "");
        h += `<div class="card"><div class="rot">${ic('<path d="M12 8v5M12 16.5v.01"/><path d="M10.3 3.9L2.6 17.2A2 2 0 004.3 20h15.4a2 2 0 001.7-2.8L13.7 3.9a2 2 0 00-3.4 0z"/>')}O QUE DEU ERRADO QUE PODERIA TER DADO CERTO ${AX.q("Aqui a IA olha DEPOIS que a operação acabou (os " + er.espera + " candles seguintes), só para aprender. Serve para escolher o que testar na gestão; não é algo que dava para saber na hora.")}</div>
          ${item(er.stopsVoltaram, er.stops, "stops em que o preço foi até o alvo logo depois", "o stop pode estar curto, ou a entrada adiantada")}
          ${item(er.viraramPerda, er.perdas, "perdas que chegaram a andar +1R a favor", "uma parcial ou um stop no 0x0 teria salvo parte delas")}
          ${item(er.ganhosCorreram, er.ganhos, "ganhos em que o preço andou mais 1R depois da saída", "um trailing stop poderia ter carregado")}
          <div class="botoes finos"><button id="iaGestoes" data-dica="Abre, no painel Ao vivo, a mesma estratégia rodada com cada gestão (alvo fixo, parcial, condução e os dois trailing stops), lado a lado.">Comparar as gestões neste período</button></div>
          <div class="nota">Cada mudança tem o seu preço: o stop no 0x0 também tira operações que voltariam a andar, e o trailing devolve parte do ganho. Por isso a resposta vem de comparar, não de adivinhar.</div></div>`;
      }

      const P = d.pesos || [];
      if (P.length) {
        const max = Math.max(...P.map((x) => Math.abs(x.peso)));
        h += `<div class="card"><div class="rot">${ic('<path d="M12 4v16M5 8l7-4 7 4M5 8l-2 6a3 3 0 006 0zM19 8l-2 6a3 3 0 006 0z"/>')}O QUE MAIS PESA NA NOTA ${AX.q("As leituras com mais peso no modelo de agora. Barra para a direita: quanto maior a leitura, maior a chance de ganho estimada. Para a esquerda: quanto maior, menor a chance. Peso não é prova de causa.")}</div>
          <table class="tab ia-tab">${P.map((x) => `<tr><td>${AX.esc(x.rotulo)}</td><td class="n">${x.peso > 0 ? "+" : "−"}${AX.num(Math.abs(x.peso), 2)}</td><td class="ia-b">${barra(x.peso, max)}</td></tr>`).join("")}</table></div>`;
      }
    }

    const PE = Object.entries(d.porEst || {});
    if (PE.length) {
      h += `<div class="card"><div class="rot">${ic('<path d="M4 6h16M4 12h16M4 18h16"/>')}DE ONDE A IA APRENDE <span class="dir">cada estratégia sozinha, histórico inteiro</span></div>
        <table class="tab"><tr><th>Estratégia</th><th class="n">Ops</th><th class="n">Acerto</th><th class="n">Média</th></tr>
        ${PE.map(([c, x]) => `<tr class="clic" data-est="${AX.esc(c)}"><td class="nome">${AX.esc(c)} ${AX.esc(AX.nomeEst(c))}</td><td class="n">${x.n}</td><td class="n">${pct(x.acerto)}</td><td class="n ${AX.cls(x.mediaR)}">${R(x.mediaR)}</td></tr>`).join("")}</table>
        <div class="nota">Média por operação em múltiplos do risco, já com custos. Clique numa linha para ver a estratégia no gráfico.</div></div>`;
    }

    const Di = (d.diario || []).filter((x) => x.auc != null);
    if (Di.length) {
      const u = Di[Di.length - 1], a = Di[0];
      h += `<div class="card"><div class="rot">${ic('<path d="M4 19V5M4 19h16M7 15l4-4 3 3 5-6"/>')}DIÁRIO DE APRENDIZADO ${AX.q("A nota da IA (acerto de ordenação fora da amostra) a cada dia em que o robô foi aberto com este ativo. A linha reta é o acaso (50%). Com mais operações a nota fica mais confiável; ela pode subir ou cair.")}<span class="dir">${Di.length} dia${Di.length > 1 ? "s" : ""}</span></div>
        ${Di.length > 1 ? '<canvas class="spark" id="iaDiario"></canvas>' : ""}
        <div class="nota">${Di.length > 1 ? `Começou em ${pct(100 * a.auc, 1)} com ${a.n} operações; hoje está em ${pct(100 * u.auc, 1)} com ${u.n}.` : `Primeiro registro: ${pct(100 * u.auc, 1)} com ${u.n} operações. O robô guarda um ponto por dia para mostrar a evolução.`}</div></div>`;
    }

    h += `<details class="card"><summary style="margin-top:0">Como a IA funciona e o que ela não faz</summary>
      <ul class="regras"><li>No candle de cada sinal o robô tira um retrato do momento, só com candles já fechados: ela não olha o futuro.</li>
      <li>Um modelo estatístico simples (regressão logística) aprende quais retratos terminaram em ganho. A cada 10 minutos o robô confere se o mercado produziu operações novas e, se sim, refaz o modelo com elas: é assim que ela aprende com o tempo.</li>
      <li>A nota é sempre medida em operações que o modelo ainda não tinha visto. Só recebe o selo de aprovada se a vantagem for forte e aparecer nas duas metades do período de prova.</li>
      <li>Ela não envia ordens, não prevê o preço e não promete resultado. É uma leitura a mais, com a taxa de acerto dela à vista.</li></ul></details>`;
    el.innerHTML = h;

    el.querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => { AX.escolherEst(tr.dataset.est); AX.trocarAba("vivo"); }));
    const bg = $("iaGestoes"); if (bg) bg.onclick = () => AX.abrirGestoes();
    const ba = $("iaAjustar"); if (ba) ba.onclick = ajustar;
    const cv = $("iaDiario"); if (cv) curva(cv, Di);
  }

  async function ajustar() {
    const el = $("iaAjuste");
    el.innerHTML = '<div class="nota">testando as gestões e as proteções nas duas metades do histórico…</div>';
    let j;
    try { j = await AX.json("/api/ajuste?" + AX.parametros(), { tempo: 240000 }); }
    catch (e) { el.innerHTML = `<div class="nota ruim">${AX.esc(e.message)}</div>`; return; }
    if (!$("iaAjuste")) return;
    const D = { meta: { moeda: j.moeda } }, din = (v) => (v == null ? "—" : AX.dinheiro(v, D, true));
    const pr = (x) => (x.prot.length ? x.prot.map((k) => ({ corte: "corte antecipado", forca: "perdeu força", folga: "folga", tol: "tolerância" }[k] || k)).join(" + ") : "sem proteção");
    const lin = (x, rot) => `<tr><td>${rot}<br><small class="neutro">${AX.esc(x.nome)} · ${AX.esc(pr(x))}</small></td>
      <td class="n">${x.treino.n}<br><b class="${AX.cls(x.treino.media)}">${din(x.treino.media)}</b></td>
      <td class="n">${x.prova.n}<br><b class="${AX.cls(x.prova.media)}">${din(x.prova.media)}</b></td></tr>`;
    const top = j.melhores[0];
    $("iaAjuste").innerHTML = `<div class="ia-topo"><span class="selo ${j.aprovada ? "verde" : "amarelo"}">${j.aprovada ? "AJUSTE APROVADO NA PROVA" : "NENHUM AJUSTE PASSOU NA PROVA"}</span></div>
      <p class="ia-frase">${!top ? "Não há operações suficientes para comparar (mínimo de 15 em cada metade)." : j.aprovada
    ? `Na metade que não participou da escolha, <b>${AX.esc(top.nome)}</b> com ${AX.esc(pr(top))} rendeu ${din(top.prova.media)} por operação, contra ${din(j.atual.prova.media)} da configuração atual. É passado e amostra de um ativo só: teste antes no teste ao vivo.`
    : `A melhor combinação da primeira metade (<b>${AX.esc(top.nome)}</b>, ${AX.esc(pr(top))}) não se sustentou na segunda: ${din(top.prova.media)} por operação. Trocar a gestão aqui seria escolher pelo passado; a estratégia continua sem vantagem neste ativo e tempo.`}</p>
      <table class="tab ia-tab"><tr><th>Configuração</th><th class="n">1ª metade (escolha)<br>ops · média</th><th class="n">2ª metade (prova)<br>ops · média</th></tr>
      ${lin(j.atual, "<b>Atual</b>")}${j.melhores.map((x, k) => lin(x, (k + 1) + "ª na escolha")).join("")}</table>
      ${j.aprovada ? `<div class="botoes finos"><button id="iaUsar" class="primario">Usar ${AX.esc(top.nome)} com ${AX.esc(pr(top))}</button></div>` : ""}
      <div class="nota">${j.testadas} combinações testadas em ${AX.esc(j.nomeTf)}, de ${AX.dataTxt(j.dataIni)} a ${AX.dataTxt(j.dataFim)}; a prova começa em ${AX.dataTxt(j.dataMeio)}. Média por operação, já com custos.</div>`;
    const bu = $("iaUsar");
    if (bu) bu.onclick = () => { AX.pref.prot = top.prot.slice(); AX.salvarPref(); AX.escolherGestao(top.gestao); AX.emit("mudou", "plano"); AX.toast("Ajuste aplicado: " + top.nome + ", " + pr(top) + ".", "ok"); };
  }

  // linha da nota ao longo dos dias, com a reta do acaso (50%)
  function curva(cv, Di) {
    const w = cv.clientWidth, h = cv.clientHeight;
    if (!w || !h) return;
    const dpr = window.devicePixelRatio || 1;
    cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const vals = Di.map((x) => x.auc), mn = Math.min(0.46, ...vals), mx = Math.max(0.56, ...vals), ult = vals.length - 1;
    const X = (i) => 3 + (i * (w - 8)) / Math.max(1, ult), Y = (v) => 5 + ((mx - v) * (h - 10)) / (mx - mn);
    c.strokeStyle = "#3a475e"; c.lineWidth = 1; c.beginPath(); c.moveTo(0, Math.round(Y(0.5)) + 0.5); c.lineTo(w, Math.round(Y(0.5)) + 0.5); c.stroke();
    c.font = "10px Segoe UI, system-ui"; c.fillStyle = "#8491a5"; c.textBaseline = "bottom"; c.fillText("acaso 50%", 4, Y(0.5) - 2);
    c.beginPath(); vals.forEach((v, i) => (i ? c.lineTo(X(i), Y(v)) : c.moveTo(X(i), Y(v))));
    c.lineJoin = "round"; c.lineCap = "round"; c.strokeStyle = "#52a2ff"; c.lineWidth = 2; c.stroke();
    c.beginPath(); c.arc(X(ult), Y(vals[ult]), 4, 0, 7); c.fillStyle = "#52a2ff"; c.fill(); c.lineWidth = 2; c.strokeStyle = "#171e2a"; c.stroke();
    cv.onmousemove = (e) => {
      const r = cv.getBoundingClientRect(), i = Math.max(0, Math.min(ult, Math.round(((e.clientX - r.left - 3) * ult) / (w - 8)))), x = Di[i];
      cv.dataset.dica = `${AX.dataTxt(x.dia)}: acerto de ordenação ${pct(100 * x.auc, 1)} com ${x.n} operações${x.comprovada ? " (aprovada)" : ""}`;
    };
  }

  async function buscar(silencioso) {
    const ch = chaveIA(), seq = ++S.seq;
    clearTimeout(S.relogio);
    if (S.chave !== ch) { S.dados = null; S.chave = ch; }
    if (!silencioso || !S.dados) render();
    try {
      const r = await AX.json("/api/ia?" + consulta(), { tempo: 30000 });
      if (seq !== S.seq) return;
      S.dados = r; AX.erro("erroIa", null);
    } catch (e) {
      if (seq !== S.seq) return;
      AX.erro("erroIa", e);
    }
    render();
    const d = S.dados;                                       // enquanto a IA estuda, a tela pergunta de novo sozinha
    if (AX.aba === "ia" && (!d || d.treinando || d.estado === "treinando")) S.relogio = setTimeout(() => buscar(true), 2500);
  }

  AX.on("aba", (nome) => { if (nome === "ia") buscar(S.chave === chaveIA() && !!S.dados); else clearTimeout(S.relogio); });
  AX.on("mudou", () => { if (AX.aba === "ia") buscar(false); });
  AX.on("dadosVivo", (D) => {
    if (AX.aba !== "ia") return;
    if (D.meta.iaSel !== S.selo) { S.selo = D.meta.iaSel; buscar(true); }      // o modelo foi refeito: busca a nota nova
    else renderSinal();
  });
  window.addEventListener("resize", () => { if (AX.aba === "ia" && S.dados) { const cv = $("iaDiario"); if (cv) curva(cv, (S.dados.diario || []).filter((x) => x.auc != null)); } });
})();
