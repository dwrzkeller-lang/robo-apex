/* ROBÔ APEX: aba Conectar. Liga o robô à conta da corretora pelo MetaTrader 5 (EA "RoboApex"), sempre por decisão do
   usuário: ele entra na corretora pelo MetaTrader dele, instala o EA, aceita o termo e liga o envio de ordens. O EA vem
   travado em conta demo. O Profit fica com os scripts NTSL das estratégias (automação dentro do próprio Profit).
   O guia "Plataformas e corretoras" diz onde o robô já opera, onde dá para usar junto e os cuidados legais. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const C = { d: null, token: null, relogio: null };
  const el = () => $("conConteudo");
  async function carregar() {
    try { C.d = await AX.json("/api/conexao"); } catch (e) { if (el()) el().innerHTML = `<div class="erro">⚠ ${AX.esc(e.message)}</div>`; return; }
    render();
  }
  async function enviar(p, ok) {
    try {
      const r = await AX.post("/api/conexao", p);
      if (r.token) C.token = r.token;
      C.d = r; if (ok) AX.toast(ok, "ok"); render();
    } catch (e) { AX.toast(e.message, "erro"); }
  }
  const quando = (t) => (t ? AX.horaBR(t) + (AX.diaBR(t) === AX.diaBR(Date.now() / 1000) ? "" : " de " + AX.diaBR(t)) : "-");

  // guia das plataformas: o que já funciona com o robô, o que é grátis e o que evitar (fica igual a cada atualização da aba)
  const PLAT = [
    ["MetaTrader 5", "pronto", "Pronto no robô",
      "O EA do Robô Apex segue o seu teste ao vivo e envia as ordens pela sua conta. O MetaTrader 5 é grátis e várias corretoras da B3 oferecem (por exemplo XP, Genial e Modal; confira na sua corretora se há custo e quais ativos ela libera: mini índice, mini dólar, ações). Comece pela conta demo."],
    ["Profit (Nelogica)", "parcial", "Scripts prontos",
      "As estratégias têm script NTSL pronto (pasta ntsl). A automação de ordens roda dentro do próprio Profit e, em geral, exige uma versão paga (como Pro ou Ultra) liberada pela corretora; o Profit One grátis serve para ver o gráfico. A ponte do Robô Apex com o Profit é só simulador."],
    ["TradingView", "parcial", "Gráfico e conferência",
      "O plano grátis serve para ver o gráfico e conferir os sinais. Os alertas por webhook (que poderiam acionar um robô) só existem nos planos pagos, e poucas corretoras da B3 deixam negociar por dentro do TradingView: confira a lista de corretoras no próprio site. Hoje o robô não envia ordens por lá."],
    ["Binance (cripto)", "proximo", "Próximo passo",
      "Os preços de cripto do robô já vêm da Binance em tempo real. A conta é grátis e a Binance tem API oficial para robô na própria conta, com um ambiente de teste grátis (Spot Testnet, dinheiro de mentira). A ligação de ordens do Apex com a Binance ainda não está pronta."],
    ["Bybit, OKX e outras de cripto", "proximo", "Possível depois",
      "Também têm API para robô na própria conta. São corretoras de fora do Brasil: veja a obrigação de informar à Receita (Instrução Normativa 1.888) e prefira as que têm operação regular no país."],
  ];
  const COR_PLAT = { pronto: "verde", parcial: "amarelo", proximo: "neutro" };
  function guia() {
    return `<details class="card con-guia" id="conGuia"${C.guiaAberto ? " open" : ""}><summary><span class="rot">PLATAFORMAS E CORRETORAS ${AX.q("Onde o Robô Apex já opera, onde dá para usar junto e o cuidado legal de cada uma. As ordens são sempre suas, na sua conta.")}</span><span class="dir">ver</span></summary>
      <div class="con-plats">${PLAT.map(([n, st, rot, txt]) => `<div class="con-plat"><div><b>${n}</b><span class="selo ${COR_PLAT[st]}">${rot}</span></div><p>${txt}</p></div>`).join("")}</div>
      <div class="rot" style="margin-top:12px">PARA NÃO TER PROBLEMA</div>
      <ul class="con-legal">
        <li><b>Use corretora autorizada.</b> Confira se ela é autorizada pela CVM e participante da B3 (consulta grátis nos sites da CVM e da B3). Não opere B3 por corretora estrangeira.</li>
        <li><b>Robô na sua própria conta é permitido.</b> O que não pode é operar a conta de outra pessoa, pegar a senha de alguém ou prometer ganho.</li>
        <li><b>Evite forex/CFD de corretoras de fora sem autorização da CVM e opções binárias</b>: a CVM já mandou suspender várias dessas ofertas no Brasil.</li>
        <li><b>Imposto do day trade:</b> 20% sobre o lucro do mês, pago por DARF até o último dia útil do mês seguinte (a corretora já retém 1% na fonte, que você desconta).</li>
        <li><b>Se for vender sinais ou operar por clientes</b>, pode precisar de registro na CVM (analista ou consultor). O Robô Apex é uma ferramenta: cada pessoa liga e decide na própria conta. Na dúvida, fale com um advogado.</li>
        <li><b>Comece no demo</b> e só passe para a conta real com lote pequeno, limite de perda no dia e o envio de ordens desligado quando não estiver olhando.</li>
      </ul></details>`;
  }
  function ligarGuia() { const g = $("conGuia"); if (g) g.ontoggle = () => { C.guiaAberto = g.open; }; }

  // ---------------------------------------------------------------- piloto automático (um botão)
  const EST_PIL = { operando: ["OPERANDO", "bom"], pausado: ["PAUSADO", "alerta"], emergencia: ["EMERGÊNCIA", "ruim"], desligado: ["DESLIGADO", "neutro"] };
  const hhmm = (n) => (n ? String(Math.floor(n / 100)).padStart(2, "0") + ":" + String(n % 100).padStart(2, "0") : "");
  function cartaoPiloto(d) {
    const cfg = d.cfg, pl = d.piloto || {}, online = d.eaOnline, P = C.pil || {};
    const estado = !cfg.ligado ? (cfg.zerar ? "emergencia" : "desligado") : (pl.estado === "pausado" ? "pausado" : "operando");
    const [rot, cls] = EST_PIL[estado];
    const teste = (AX.testes && AX.testes.lista ? AX.testes.lista() : []).find((x) => String(x.id) === String(cfg.teste) && !x.ate);
    const sims = d.simbolos || [];
    const v = (k, pad) => (P[k] != null ? P[k] : pad);
    const ests = AX.cfg.estrategias.map((e) => `<option value="${e.cod}"${v("est", teste ? teste.est : AX.pref.est !== "TODAS" ? AX.pref.est : "E2") === e.cod ? " selected" : ""}>${e.cod} · ${AX.esc(e.nome)}</option>`).join("");
    const gests = Object.entries(AX.cfg.gestoes).map(([k, n]) => `<option value="${k}"${v("gestao", teste ? teste.gestao : "padrao") === k ? " selected" : ""}>${AX.esc(n)}</option>`).join("");
    const tfSel = +v("tf", teste ? teste.tf : 5), qual = v("qual", teste ? teste.qual || "" : "A");
    return `<div class="card piloto ${cls}"><div class="rot"><i class="pil-ic"></i>PILOTO AUTOMÁTICO ${AX.q("Um botão liga a estratégia na sua conta: o robô acompanha o mercado com os candles da SUA corretora (enviados pelo EA) e, a cada sinal, o EA envia, move e cancela as ordens no seu MetaTrader. As travas do robô (horário, máximo de operações e perda do dia) param as ordens novas; a posição aberta segue com o stop e o alvo. O botão de emergência zera tudo.")}
        <span class="pil-estado ${cls}">● ${rot}</span></div>
      <div class="pil-status">
        <div><small>EA</small><b class="${online ? "bom" : "ruim"}">${online ? "conectado" : "desconectado"}</b><em>${d.ea && d.ea.tipo ? AX.esc(d.ea.tipo) + " · " + AX.esc(d.ea.corretora || "") : "abra o MetaTrader com o EA"}</em></div>
        <div><small>Operações hoje</small><b>${pl.opsHoje != null ? pl.opsHoje : "-"}</b><em>${cfg.max_ops ? "máximo " + cfg.max_ops : "sem máximo"}</em></div>
        <div><small>Resultado hoje</small><b class="${AX.cls(pl.resultadoHoje)}">${pl.resultadoHoje != null ? AX.dinheiro(pl.resultadoHoje, { meta: { moeda: "R$" } }, true) : "-"}</b><em>${cfg.perda_dia ? "para em −" + AX.num(cfg.perda_dia, 0) : "sem limite"}</em></div>
        <div><small>Seguindo</small><b>${teste ? AX.esc(teste.est) + " · " + teste.tf + " min" : "-"}</b><em>${teste ? "nota " + (teste.qual ? ({ "A+": "só A+", A: "só A", B: "B para cima" }[teste.qual]) : "todas") : "nenhum teste"}</em></div>
      </div>
      ${pl.motivo && estado !== "desligado" ? `<div class="nota pil-motivo ${cls}">${AX.esc(pl.motivo)}</div>` : ""}
      <div class="pil-form">
        <label class="campo"><span>Símbolo no MetaTrader</span>${sims.length ? `<select id="pilSim">${sims.map((x) => `<option${(v("simbolo", cfg.simbolo) || sims[0]) === x ? " selected" : ""}>${AX.esc(x)}</option>`).join("")}</select>` : `<input id="pilSim" placeholder="ex.: WINZ25" value="${AX.esc(v("simbolo", cfg.simbolo || ""))}">`}</label>
        <label class="campo"><span>Estratégia</span><select id="pilEst">${ests}</select></label>
        <label class="campo"><span>Tempo</span><select id="pilTf">${[2, 5, 15, 30, 60].map((t) => `<option value="${t}"${tfSel === t ? " selected" : ""}>${t} min</option>`).join("")}</select></label>
        <label class="campo"><span>Gestão</span><select id="pilGest">${gests}</select></label>
        <label class="campo"><span>Qualidade da entrada ${AX.q("Nota de cada sinal (price action): A+ e A = estrutura, espaço até a barreira, diário e rejeição a favor; B = metade disso. “Só A” opera menos e só as entradas mais limpas. Veja na aba Resultado como cada nota se saiu no seu ativo antes de escolher.")}</span>
          <select id="pilQual"><option value="A+"${qual === "A+" ? " selected" : ""}>Só A+</option><option value="A"${qual === "A" ? " selected" : ""}>Só A e A+</option><option value="B"${qual === "B" ? " selected" : ""}>B para cima</option><option value=""${!qual ? " selected" : ""}>Todas</option></select></label>
        <label class="campo"><span>Contratos por operação</span><input id="pilQ" inputmode="decimal" value="${AX.esc(String(v("contratos", teste ? teste.contratos : 1)))}"></label>
        <label class="campo"><span>Lote máximo</span><input id="pilMax" inputmode="decimal" value="${AX.esc(String(v("max_lote", cfg.max_lote)))}"></label>
        <label class="campo"><span>Perda máxima no dia (R$)</span><input id="pilPerda" inputmode="decimal" value="${AX.esc(String(v("perda_dia", cfg.perda_dia || "")))}" placeholder="0 = sem"></label>
        <label class="campo"><span>Máx. de operações no dia</span><input id="pilOps" inputmode="numeric" value="${AX.esc(String(v("max_ops", cfg.max_ops || "")))}" placeholder="0 = sem"></label>
        <label class="campo"><span>Operar das</span><input id="pilIni" type="time" value="${hhmm(v("hora_ini", cfg.hora_ini))}"></label>
        <label class="campo"><span>até</span><input id="pilFim" type="time" value="${hhmm(v("hora_fim", cfg.hora_fim))}"></label>
        <label class="campo"><span>Ativo do robô (custos)</span><select id="pilAtivo">${AX.cfg.ativos.filter((a) => a.mercado !== "cripto" && !String(a.chave).startsWith("MT5:")).map((a) => `<option value="${AX.esc(a.chave)}"${v("ativo", cfg.ativo) === a.chave ? " selected" : ""}>${AX.esc(a.chave)}</option>`).join("")}</select></label>
      </div>
      <div class="pil-bts">
        <button class="primario largo" id="pilLigar">${cfg.ligado ? "↻ Aplicar as mudanças" : "▶ Ligar o piloto automático"}</button>
        ${cfg.ligado ? '<button id="pilPausar">■ Desligar</button>' : ""}
        <button class="perigo" id="pilEmerg" data-dica="Desliga o envio de ordens e manda o EA zerar a posição e cancelar as ordens na hora.">⛔ Emergência: zerar tudo</button>
      </div>
      <div class="nota">Horário de Brasília. Comece na conta demo. As ordens são enviadas pelo seu MetaTrader, na sua conta, por decisão sua.</div></div>`;
  }
  function lerPiloto() {
    const n = (id) => parseFloat(String($(id).value || "0").replace(",", ".")) || 0;
    const hm = (id) => { const x = $(id).value; return x ? +x.replace(":", "") : 0; };
    return { simbolo: String($("pilSim").value || "").trim().toUpperCase(), est: $("pilEst").value, tf: +$("pilTf").value, gestao: $("pilGest").value,
      qual: $("pilQual").value, contratos: n("pilQ") || 1, max_lote: n("pilMax") || 1, perda_dia: n("pilPerda"), max_ops: Math.round(n("pilOps")),
      hora_ini: hm("pilIni"), hora_fim: hm("pilFim"), ativo: $("pilAtivo").value };
  }
  function ligarPiloto(d) {
    const guardar = () => { if ($("pilEst")) C.pil = lerPiloto(); };
    document.querySelectorAll(".piloto input, .piloto select").forEach((x) => (x.onchange = guardar));
    const b = (id, fn) => { const z = $(id); if (z) z.onclick = fn; };
    b("pilLigar", () => {
      const p = lerPiloto();
      if (!p.simbolo) return AX.toast("Escreva o símbolo do MetaTrader.", "aviso");
      if ((p.hora_ini && !p.hora_fim) || (!p.hora_ini && p.hora_fim)) return AX.toast("Preencha os dois horários (ou nenhum).", "aviso");
      if (!d.cfg.ligado && !confirm(`Ligar o piloto automático?\n\n${p.est} em ${p.simbolo}, ${p.tf} min, ${p.contratos} contrato(s), nota ${p.qual || "todas"}.\nConta: ${(d.ea && d.ea.tipo) || "?"}. As ordens saem pelo seu MetaTrader.`)) return;
      C.pil = null;
      enviar(Object.assign({ acao: "piloto", capital: AX.pref.capital, maxstops: AX.pref.maxstops, brl: AX.pref.emReais !== false ? 1 : 0, regra: AX.regraTxt() }, p),
        d.cfg.ligado ? "Piloto atualizado." : "Piloto automático ligado.").then(() => AX.testesRecarregar && AX.testesRecarregar());
    });
    b("pilPausar", () => enviar({ acao: "ligar", ligado: false }, "Piloto desligado: nenhuma ordem nova. A posição aberta segue com o stop e o alvo."));
    b("pilEmerg", () => { if (confirm("EMERGÊNCIA: desligar o piloto e zerar a posição agora?")) enviar({ acao: "emergencia" }, "Emergência enviada: o EA zera a posição e cancela as ordens."); });
  }

  function render() {
    const c = el(); if (!c || !C.d) return;
    const d = C.d, cfg = d.cfg, ea = d.ea || {}, aceito = d.aceite && d.aceite.versao === d.termoVersao;
    const testes = (AX.testes && AX.testes.lista ? AX.testes.lista() : []).filter((x) => !x.ate);
    const enderecoRobo = `http://127.0.0.1:${d.porta || location.port || 8765}`;
    let h = `<details class="card con-intro" id="conIntro"${(C.introAberta ?? !(d.ea && d.ea.conta)) ? " open" : ""}><summary class="rot">COMO CONECTAR O METATRADER (6 PASSOS) ${AX.q("O robô não entra na sua conta e nunca vê a sua senha da corretora. Quem envia as ordens é o seu MetaTrader 5, com o EA do Robô Apex instalado e ligado por você.")}</summary>
      <ol class="con-passos">
        <li><b>Abra a sua conta</b> numa corretora que ofereça MetaTrader 5 (comece pela conta <b>demo</b>) e entre no MetaTrader com os seus dados.</li>
        <li><b>Instale o EA</b>: <a href="RoboApex.mq5" download>baixe o arquivo RoboApex.mq5</a>, abra no MetaTrader em <i>Arquivo › Abrir pasta de dados › MQL5 › Experts</i>, copie para lá e compile (F7 no MetaEditor).</li>
        <li><b>Permita o robô</b>: <i>Ferramentas › Opções › Expert Advisors</i>, marque <i>Permitir WebRequest</i> e adicione <code>${AX.esc(enderecoRobo)}</code>.</li>
        <li><b>Arraste o EA</b> para o gráfico do ativo (ex.: WIN do mês) e cole o <b>código de conexão</b> abaixo. Ligue o <i>Algo Trading</i>.</li>
        <li>O EA manda os candles da corretora: o ativo <b>MT5:símbolo</b> aparece na lista. <b>Ligue um teste ao vivo</b> nele e escolha esse teste aqui.</li>
        <li><b>Ligue o envio de ordens</b>. O EA segue o teste: arma, entra, move o stop e o alvo e sai junto com ele.</li>
      </ol></details>`;
    if (!aceito) {
      h += `<div class="card con-termo"><div class="rot">TERMO DE USO DA CONEXÃO</div>
        <pre class="termo">${AX.esc(d.termo)}</pre>
        <label class="campo"><span>Para aceitar, escreva ACEITO</span><input id="conAceito" autocomplete="off" placeholder="ACEITO"></label>
        <div class="botoes"><button class="primario" id="conAceitar">Li e aceito o termo</button></div></div>`;
      c.innerHTML = h + guia();
      ligarGuia();
      $("conAceitar").onclick = () => enviar({ acao: "aceitar", confirmo: $("conAceito").value }, "Termo aceito.");
      return;
    }
    const online = d.eaOnline;
    h += cartaoPiloto(d);
    h += `<div class="card con-estado ${online ? "on" : ""}"><div class="rot"><i class="luz ${online ? "vivo" : ""}"></i>${online ? "EA CONECTADO" : "EA DESCONECTADO"}
        <span class="dir">${ea.quando ? "última notícia " + quando(ea.quando) : "nenhuma notícia ainda"}</span></div>
      ${ea.conta ? `<div class="con-conta"><span>Conta <b>${AX.esc(ea.conta)}</b> · ${AX.esc(ea.corretora || "")}</span>
        <span class="selo ${ea.tipo === "DEMO" ? "verde" : "vermelho"}">${AX.esc(ea.tipo || "?")}</span>
        <span>Saldo <b>${ea.saldo != null ? AX.num(ea.saldo, 2) + " " + AX.esc(ea.moeda || "") : "-"}</b> · hoje <b class="${AX.cls(ea.resultadoDia)}">${ea.resultadoDia != null ? AX.num(ea.resultadoDia, 2) : "-"}</b></span>
        <span>Gráfico do EA: <b>${AX.esc(ea.simbolo || "-")}</b>${(ea.posicoes || []).length ? " · " + ea.posicoes.map((p) => `${p.lado > 0 ? "comprado" : "vendido"} ${p.volume} a ${p.preco}`).join(", ") : " · sem posição"}</span></div>` : ""}
      <div class="nota">${cfg.ligado ? "<b>Envio de ordens ligado</b> pelo piloto automático." : "Envio de ordens desligado: o EA só manda candles e o estado da conta."}</div></div>`;
    h += `<div class="card"><div class="rot">CÓDIGO DE CONEXÃO ${AX.q("É o que liga o EA à sua conta do robô. Quem tem o código consegue receber os sinais dos seus testes; não mostre a ninguém. Gerar um novo invalida o anterior.")}</div>
      ${C.token ? `<div class="con-token"><code id="conTok">${AX.esc(C.token)}</code><button class="mini-btn" id="conCopiar">copiar</button></div><div class="nota alerta">Copie agora: por segurança ele não aparece de novo (só o final).</div>`
        : `<div class="nota">${d.temToken ? `Código atual termina em <b>…${AX.esc(d.tokenFim)}</b>.` : "Nenhum código ainda."}</div>`}
      <div class="botoes finos"><button id="conToken">${d.temToken ? "Gerar um código novo" : "Gerar o código"}</button></div></div>`;
    const ativosBase = AX.cfg.ativos.filter((a) => a.mercado !== "cripto" && !String(a.chave).startsWith("MT5:"));
    h += `<div class="card"><div class="rot">O QUE O EA VAI FAZER</div>
      <div class="grade2">
        <label class="campo"><span>Símbolo no MetaTrader</span><input id="conSim" value="${AX.esc(cfg.simbolo || "")}" placeholder="ex.: WINZ25"></label>
        <label class="campo"><span>Ativo do robô (custos e horários)</span><select id="conAtivo">${ativosBase.map((a) => `<option value="${AX.esc(a.chave)}"${a.chave === cfg.ativo ? " selected" : ""}>${AX.esc(a.chave)}</option>`).join("")}</select></label>
      </div>
      <label class="campo"><span>Teste ao vivo que o EA segue</span><select id="conTeste"><option value="">escolha um teste ligado</option>${testes.map((x) => `<option value="${x.id}"${String(x.id) === String(cfg.teste) ? " selected" : ""}>${AX.esc(AX.rotAtivo(x.ativo))} · ${x.tf >= 1440 ? "diário" : x.tf + " min"} · ${AX.esc(x.est)}${String(x.ativo).startsWith("MT5:") ? "" : " (precisa ser num ativo MT5:)"}</option>`).join("")}</select></label>
      <div class="grade3">
        <label class="campo"><span>Multiplicador</span><input id="conMult" inputmode="decimal" value="${cfg.mult}"></label>
        <label class="campo"><span>Lote máximo</span><input id="conMax" inputmode="decimal" value="${cfg.max_lote}"></label>
        <label class="campo"><span>Perda máxima no dia</span><input id="conPerda" inputmode="decimal" value="${cfg.perda_dia || ""}" placeholder="0 = sem limite"></label>
      </div>
      <div class="nota">Multiplicador: contratos na corretora para cada contrato do teste. O EA nunca passa do lote máximo, e para o dia quando a perda do dia chega no limite (vale o menor entre este e o do EA).</div>
      <div class="botoes"><button class="primario" id="conSalvar">Salvar</button></div>
      <details class="con-real"><summary>Conta real</summary>
        <div class="nota">O EA vem travado em conta DEMO. Para usar em conta real, mude a opção <i>SomenteDemo</i> no EA <b>e</b> confirme aqui. A responsabilidade pelas ordens é sua.</div>
        ${cfg.real ? '<div class="botoes"><button id="conRealOff">Voltar a permitir só DEMO</button></div>'
          : '<label class="campo"><span>Escreva CONTA REAL para permitir</span><input id="conRealTxt" autocomplete="off"></label><div class="botoes"><button class="perigo" id="conRealOn">Permitir conta real</button></div>'}</details></div>`;
    h += `<div class="card"><div class="rot">PROFIT (NELOGICA)</div>
      <div class="nota">No Profit, a automação é feita dentro do próprio Profit: as estratégias E1 a E10 têm script NTSL pronto (pasta <b>ntsl</b> do robô). Abra no Profit em <i>Estratégias › Editor de estratégias</i>, cole o script e use a <b>Automação de estratégias</b> do Profit, primeiro no simulador dele. A ligação direta com o Profit (DLL) depende do pacote da Nelogica.</div></div>`;
    h += `<div class="card"><div class="rot">REGISTRO</div>${d.log.length ? `<div class="con-log">${d.log.map((x) => `<div><span>${quando(x.t)}</span><b>${AX.esc(x.tipo)}</b><em>${AX.esc(x.detalhe)}</em></div>`).join("")}</div>` : '<div class="nota">Nada ainda.</div>'}</div>`;
    // não redesenha enquanto a pessoa digita no piloto (a aba se atualiza a cada 5 s)
    const foco = document.activeElement;
    if (foco && foco.closest && foco.closest(".piloto") && c.contains(foco)) return;
    c.innerHTML = h + guia();
    ligarGuia();
    ligarPiloto(d);
    const intro = $("conIntro"); if (intro) intro.ontoggle = () => { C.introAberta = intro.open; };
    const bt = (id, fn) => { const b = $(id); if (b) b.onclick = fn; };
    bt("conLigar", () => {
      if (!cfg.ligado && !confirm("Ligar o envio de ordens? O EA vai seguir o teste escolhido na conta conectada (" + (ea.tipo || "?") + ").")) return;
      enviar({ acao: "ligar", ligado: !cfg.ligado }, cfg.ligado ? "Envio de ordens desligado." : "Envio de ordens ligado.");
    });
    bt("conToken", () => { if (d.temToken && !confirm("Gerar um código novo? O EA com o código antigo para de funcionar.")) return; enviar({ acao: "token" }, "Código gerado."); });
    bt("conCopiar", async () => { try { await navigator.clipboard.writeText(C.token); AX.toast("Código copiado.", "ok"); } catch (e) { AX.toast("Selecione o código e copie com Ctrl+C.", "aviso"); } });
    bt("conSalvar", () => enviar({ acao: "config", simbolo: $("conSim").value, ativo: $("conAtivo").value, teste: $("conTeste").value || null,
      mult: parseFloat(String($("conMult").value).replace(",", ".")) || 1, max_lote: parseFloat(String($("conMax").value).replace(",", ".")) || 1,
      perda_dia: parseFloat(String($("conPerda").value).replace(",", ".")) || 0 }, "Configuração salva."));
    bt("conRealOn", () => enviar({ acao: "real", real: true, confirmo: $("conRealTxt").value }, "Conta real permitida."));
    bt("conRealOff", () => enviar({ acao: "real", real: false }, "Só conta demo."));
  }
  AX.on("aba", (n) => {
    clearInterval(C.relogio);
    if (n === "conectar") { carregar(); C.relogio = setInterval(carregar, 5000); }
  });
})();
