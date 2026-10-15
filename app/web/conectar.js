/* ROBÔ APEX: aba Conectar. Liga o robô à conta da corretora pelo MetaTrader 5 (EA "RoboApex"), sempre por decisão do
   usuário: ele entra na corretora pelo MetaTrader dele, instala o EA, aceita o termo e liga o envio de ordens. O EA vem
   travado em conta demo. O Profit fica com os scripts NTSL das estratégias (automação dentro do próprio Profit). */
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

  function render() {
    const c = el(); if (!c || !C.d) return;
    const d = C.d, cfg = d.cfg, ea = d.ea || {}, aceito = d.aceite && d.aceite.versao === d.termoVersao;
    const testes = (AX.testes && AX.testes.lista ? AX.testes.lista() : []).filter((x) => !x.ate);
    const enderecoRobo = `http://127.0.0.1:${d.porta || location.port || 8765}`;
    let h = `<div class="card con-intro"><div class="rot">CONECTAR À SUA CORRETORA ${AX.q("O robô não entra na sua conta e nunca vê a sua senha da corretora. Quem envia as ordens é o seu MetaTrader 5, com o EA do Robô Apex instalado e ligado por você.")}</div>
      <ol class="con-passos">
        <li><b>Abra a sua conta</b> numa corretora que ofereça MetaTrader 5 (comece pela conta <b>demo</b>) e entre no MetaTrader com os seus dados.</li>
        <li><b>Instale o EA</b>: <a href="RoboApex.mq5" download>baixe o arquivo RoboApex.mq5</a>, abra no MetaTrader em <i>Arquivo › Abrir pasta de dados › MQL5 › Experts</i>, copie para lá e compile (F7 no MetaEditor).</li>
        <li><b>Permita o robô</b>: <i>Ferramentas › Opções › Expert Advisors</i>, marque <i>Permitir WebRequest</i> e adicione <code>${AX.esc(enderecoRobo)}</code>.</li>
        <li><b>Arraste o EA</b> para o gráfico do ativo (ex.: WIN do mês) e cole o <b>código de conexão</b> abaixo. Ligue o <i>Algo Trading</i>.</li>
        <li>O EA manda os candles da corretora: o ativo <b>MT5:símbolo</b> aparece na lista. <b>Ligue um teste ao vivo</b> nele e escolha esse teste aqui.</li>
        <li><b>Ligue o envio de ordens</b>. O EA segue o teste: arma, entra, move o stop e o alvo e sai junto com ele.</li>
      </ol></div>`;
    if (!aceito) {
      h += `<div class="card con-termo"><div class="rot">TERMO DE USO DA CONEXÃO</div>
        <pre class="termo">${AX.esc(d.termo)}</pre>
        <label class="campo"><span>Para aceitar, escreva ACEITO</span><input id="conAceito" autocomplete="off" placeholder="ACEITO"></label>
        <div class="botoes"><button class="primario" id="conAceitar">Li e aceito o termo</button></div></div>`;
      c.innerHTML = h;
      $("conAceitar").onclick = () => enviar({ acao: "aceitar", confirmo: $("conAceito").value }, "Termo aceito.");
      return;
    }
    const online = d.eaOnline;
    h += `<div class="card con-estado ${online ? "on" : ""}"><div class="rot"><i class="luz ${online ? "vivo" : ""}"></i>${online ? "EA CONECTADO" : "EA DESCONECTADO"}
        <span class="dir">${ea.quando ? "última notícia " + quando(ea.quando) : "nenhuma notícia ainda"}</span></div>
      ${ea.conta ? `<div class="con-conta"><span>Conta <b>${AX.esc(ea.conta)}</b> · ${AX.esc(ea.corretora || "")}</span>
        <span class="selo ${ea.tipo === "DEMO" ? "verde" : "vermelho"}">${AX.esc(ea.tipo || "?")}</span>
        <span>Saldo <b>${ea.saldo != null ? AX.num(ea.saldo, 2) + " " + AX.esc(ea.moeda || "") : "-"}</b> · hoje <b class="${AX.cls(ea.resultadoDia)}">${ea.resultadoDia != null ? AX.num(ea.resultadoDia, 2) : "-"}</b></span>
        <span>Gráfico do EA: <b>${AX.esc(ea.simbolo || "-")}</b>${(ea.posicoes || []).length ? " · " + ea.posicoes.map((p) => `${p.lado > 0 ? "comprado" : "vendido"} ${p.volume} a ${p.preco}`).join(", ") : " · sem posição"}</span></div>` : ""}
      <div class="con-liga">
        <button class="${cfg.ligado ? "perigo" : "primario"} largo" id="conLigar">${cfg.ligado ? "■ Desligar o envio de ordens" : "▶ Ligar o envio de ordens"}</button>
        <div class="nota">${cfg.ligado ? "<b>Ligado:</b> o EA segue o teste escolhido. Desligar cancela as ordens pendentes na hora (a posição aberta fica com o stop e o alvo dela)." : "Desligado: o EA só manda candles e o estado da conta; não envia ordens."}</div></div></div>`;
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
    c.innerHTML = h;
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
