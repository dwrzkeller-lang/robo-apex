/* ROBÔ APEX: "Ao vivo" no topo e o pop-up de cada sinal.
   O botão do topo mostra como estão os testes ao vivo que o usuário ligou (só do mercado aberto: Bolsa, Opções ou
   Cripto). Sem teste ligado ele fica em espera ("standby"): nenhuma estratégia roda sozinha sem o usuário pedir.
   Quando um teste do mercado aberto arma uma ordem, entra ou sai, aparece um pop-up com o que aconteceu. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const bt = $("btAoVivo"), pop = $("popAoVivo");
  const din = (v, moeda) => AX.dinheiro(v, { meta: { moeda: moeda || "R$" } }, true);
  const tfTxt = (tf) => ((AX.cfg && AX.cfg.tempos.find((t) => +t.tf === +tf)) || {}).nome || tf + " min";
  const MERC = { b3: "Bolsa", opcoes: "Opções", cripto: "Cripto" };
  let lista = [];

  const ligados = () => lista.filter((x) => !x.ate && AX.doMercadoAtual(x.ativo));
  const outros = () => lista.filter((x) => !x.ate && !AX.doMercadoAtual(x.ativo)).length;
  function somaReais(xs, campo) {                  // soma em reais (testes em dólar convertidos pelo dólar do dia)
    let s = 0;
    for (const x of xs) {
      const r = x.res; if (!r) continue;
      const v = r[campo] || 0;
      s += r.moeda === "US$" && AX.usdbrl > 0 ? v * AX.usdbrl : v;
    }
    return s;
  }
  function pintarBotao() {
    if (!bt) return;
    const xs = ligados(), emOp = xs.filter((x) => x.res && x.res.estado === "operacao").length;
    if (!xs.length) {
      bt.className = "vivo-topo standby";
      bt.innerHTML = `<i class="vt-luz"></i><span class="vt-tit">standby</span><span class="vt-sub">nenhum teste ligado</span>`;
    } else {
      const hoje = somaReais(xs, "hoje"), total = somaReais(xs, "total");
      bt.className = "vivo-topo on" + (emOp ? " em-op" : "");
      bt.innerHTML = `<i class="vt-luz"></i><span class="vt-tit">${xs.length} ligado${xs.length > 1 ? "s" : ""}${emOp ? ` · ${emOp} em operação` : ""}</span>
        <span class="vt-sub">hoje <b class="${AX.cls(hoje)}">${din(hoje)}</b> · desde que ligou <b class="${AX.cls(total)}">${din(total)}</b></span>`;
    }
    if (!pop.classList.contains("oculto")) pintarPop();
  }
  function pintarPop() {
    const xs = ligados(), fora = outros();
    pop.innerHTML = `<div class="rot">TESTES AO VIVO · ${MERC[AX.pref.mercado] || ""} ${AX.q("Só as estratégias que você ligou rodam ao vivo (simulado, sem dinheiro). O resultado conta a partir do momento em que cada teste foi ligado. Os testes de outros mercados continuam rodando, mas só aparecem quando você abre aquele mercado no topo.")}</div>
      ${xs.length ? `<div class="vt-lista">${xs.map((x, i) => {
        const r = x.res || {};
        return `<div class="vt-item" data-i="${i}">
          <div class="vt-l1"><b>${AX.esc(AX.rotAtivo(x.ativo))}</b> · ${AX.esc(tfTxt(x.tf))} · ${AX.esc(x.est === "TODAS" ? "minhas estratégias" : x.est)}
            <span class="dir ${AX.cls(r.total)}">${r.n != null ? din(r.total, r.moeda) : "calculando…"}</span></div>
          <div class="vt-l2">${r.estado ? AX.testes.estadoTxt(r) : ""}<span class="dir">hoje: <b class="${AX.cls(r.hoje)}">${din(r.hoje || 0, r.moeda)}</b> (${r.nHoje || 0} op${r.nHoje === 1 ? "" : "s"}) · total ${r.n || 0} ops</span></div>
        </div>`;
      }).join("")}</div>`
        : `<div class="vt-vazio"><b>Standby.</b> Nenhuma estratégia está rodando ao vivo em ${MERC[AX.pref.mercado] || "este mercado"}. Para ligar, escolha a estratégia e o tempo no topo e use <b>▶ Ligar teste ao vivo</b> no painel Agora (ou no ▶ Testar).</div>`}
      ${fora ? `<div class="nota">${fora} teste${fora > 1 ? "s" : ""} ligado${fora > 1 ? "s" : ""} em outro mercado.</div>` : ""}
      <div class="botoes"><button id="vtFechar" class="primario">Fechar</button></div>`;
    pop.querySelectorAll(".vt-item").forEach((d) => (d.onclick = () => { const x = xs[+d.dataset.i]; fecharPop(); AX.testes.abrir({ ativo: x.ativo, tf: x.tf, est: x.est }); }));
    $("vtFechar").onclick = fecharPop;
  }
  function fecharPop() { pop.classList.add("oculto"); }
  if (bt) bt.onclick = (e) => {
    e.stopPropagation();
    if (!pop.classList.contains("oculto")) return fecharPop();
    const r = bt.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 400, r.right - 390)) + "px";
    pop.style.top = r.bottom + 8 + "px";
    pop.classList.remove("oculto");
    pintarPop();
  };
  document.addEventListener("pointerdown", (e) => { if (!pop.classList.contains("oculto") && !pop.contains(e.target) && e.target !== bt && !bt.contains(e.target)) fecharPop(); });
  AX.on("testesLista", (l) => { lista = l || []; pintarBotao(); });
  AX.on("mercado", () => { pintarBotao(); if (AX.testesRecarregar) AX.testesRecarregar(); });
  AX.on("tecla", (e) => { if (e.key === "Escape") fecharPop(); });

  // ---------------------------------------------------------------- pop-up do sinal
  const caixa = document.createElement("div");
  caixa.className = "pop-sinais";
  document.body.appendChild(caixa);
  const LADO = (ev) => (ev.dir > 0 ? "COMPRA" : "VENDA");
  function textoPop(ev) {
    const f = (v) => AX.fmt(v, ev.dec);
    const sl = ev.stop != null ? `<span>stop <b>${f(ev.stop)}</b></span>` : "", al = ev.alvo != null ? `<span>alvo <b>${f(ev.alvo)}</b></span>` : "";
    if (ev.tipo === "ordem") return { tit: `${LADO(ev)} armada`, cls: ev.dir > 0 ? "cmp" : "vnd",
      det: `<span>${ev.gatilho == null ? "a mercado no próximo candle" : (ev.ordem === "limite" ? "limitada em " : ev.dir > 0 ? "acima de " : "abaixo de ") + "<b>" + f(ev.gatilho) + "</b>"}</span>${sl}${al}` };
    if (ev.tipo === "entrada") return { tit: `${LADO(ev)} executada`, cls: ev.dir > 0 ? "cmp" : "vnd", det: `<span>entrada <b>${f(ev.ent)}</b></span>${sl}${al}` };
    return { tit: `Saiu: ${AX.esc(ev.motivo || "")}`, cls: ev.ganho ? "ganho" : "perda",
      det: `<span>saída <b>${f(ev.sai)}</b></span><span class="vt-res ${AX.cls(ev.dinheiro)}">${AX.res2(ev.R, ev.dinheiro, { meta: { moeda: ev.moeda } })}</span>` };
  }
  function popupSinal(novos) {
    for (const ev of novos.slice(-3)) {
      const t = textoPop(ev), el = document.createElement("div");
      el.className = "pop-sinal " + t.cls;
      el.innerHTML = `<div class="ps-cab"><small>${AX.horaBR(ev.quando)} · TESTE AO VIVO · simulado</small><button class="ps-x" aria-label="Fechar">✕</button></div>
        <div class="ps-tit">${t.tit}</div>
        <div class="ps-quem"><b>${AX.esc(AX.rotAtivo(ev.ativo))}</b> · ${AX.esc(ev.nomeTf)} · ${AX.esc(ev.est)} ${AX.esc(AX.nomeEst(ev.est) || "")}</div>
        <div class="ps-det">${t.det}</div>
        <div class="ps-bts"><button class="primario ps-ver">Ver no gráfico</button><button class="ps-ok">Ok</button></div>`;
      const sair = () => { el.classList.add("saindo"); setTimeout(() => el.remove(), 250); };
      el.querySelector(".ps-x").onclick = sair; el.querySelector(".ps-ok").onclick = sair;
      el.querySelector(".ps-ver").onclick = () => { sair(); const x = lista.find((y) => y.id === ev.teste); AX.testes.abrir({ ativo: ev.ativo, tf: ev.tf, est: x ? x.est : ev.est }); };
      caixa.appendChild(el);
      setTimeout(() => { if (el.isConnected) sair(); }, ev.tipo === "ordem" ? 20000 : 40000);
    }
    while (caixa.children.length > 3) caixa.firstElementChild.remove();
  }
  AX.popupSinal = popupSinal;
})();
