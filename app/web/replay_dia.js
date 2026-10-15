/* ROBÔ APEX: botão REPLAY do topo. A pessoa escolhe um dia e assiste o pregão inteiro candle a candle, no ativo, no
   tempo gráfico e com a estratégia do topo: cada candle se forma devagar e as entradas e saídas aparecem na hora em que
   aconteceram, com o resultado do dia somando. Velocidade de 0,5x a 16x, pausa, um candle por vez e barra para pular. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const VEL = [0.5, 1, 2, 4, 8, 16];
  const P = { on: false, D: null, k: 0, ini: 0, fim: 0, vel: 1, pausa: false, relogio: null, cancelar: null, fala: "", dia: 0, seq: 0 };
  const pop = $("popReplay"), bt = $("btReplay");
  let barra = null;
  const din = (v) => AX.dinheiro(v, P.D, true);
  const velTxt = (v) => String(v).replace(".", ",") + "x";
  const hora = (t) => AX.quandoT(t).slice(-5);              // horário do candle (já vem no horário da bolsa)

  // ---------------------------------------------------------------- escolher o dia
  function abrirEscolha() {
    if (!pop.classList.contains("oculto")) return AX.fecharPopovers();
    AX.fecharPopovers();
    const D = AX.vivo.D;
    if (!D) return AX.toast("Espere o gráfico carregar.", "aviso");
    const max = AX.dataISO(D.meta.dataMax), min = AX.dataISO(D.meta.dataMin);
    const est = AX.pref.est === "TODAS" ? "minhas estratégias juntas" : AX.pref.est + " · " + AX.nomeEst(AX.pref.est);
    pop.innerHTML = `<div class="rot">REPLAY DO PREGÃO ${AX.q("Escolha o dia. O robô volta o gráfico para a abertura daquele dia e toca candle a candle até o fechamento, com a estratégia entrando e saindo na hora em que aconteceu. Ativo, tempo gráfico e estratégia são os do topo.")}</div>
      <label class="campo"><span>Dia</span><input type="date" id="rpdDia" min="${min}" max="${max}" value="${AX.esc(P.diaIso && P.diaIso >= min && P.diaIso <= max ? P.diaIso : max)}"></label>
      <div class="rpd-quem"><div><small>Ativo</small><b>${AX.esc(AX.rotAtivo(AX.pref.ativo))}</b></div><div><small>Tempo</small><b>${AX.esc(D.meta.nomeTf)}</b></div><div><small>Estratégia</small><b>${AX.esc(est)}</b></div></div>
      <div class="nota">Para trocar o ativo, o tempo ou a estratégia, use o topo e abra o replay de novo.</div>
      <div class="campo"><span>Velocidade</span><div class="seg mini" id="rpdVel">${VEL.map((v) => `<button data-v="${v}" class="${v === P.vel ? "on" : ""}">${velTxt(v)}</button>`).join("")}</div></div>
      <div class="botoes"><button id="rpdCancelar">Cancelar</button><button id="rpdIr" class="primario">▶ Assistir o dia</button></div>`;
    const r = bt.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 360, r.left - 120)) + "px";
    pop.style.top = r.bottom + 8 + "px";
    pop.classList.remove("oculto");
    pop.querySelectorAll("#rpdVel button").forEach((b) => (b.onclick = () => { P.vel = +b.dataset.v; pop.querySelectorAll("#rpdVel button").forEach((x) => x.classList.toggle("on", x === b)); }));
    $("rpdCancelar").onclick = AX.fecharPopovers;
    $("rpdIr").onclick = () => { const v = $("rpdDia").value; if (!v) return AX.toast("Escolha o dia.", "aviso"); P.diaIso = v; AX.fecharPopovers(); comecar(AX.isoInt(v)); };
  }
  bt.onclick = (e) => { e.stopPropagation(); abrirEscolha(); };

  // ---------------------------------------------------------------- tocar
  async function comecar(dia) {
    const seq = ++P.seq;
    parar(true);
    if (AX.replay && AX.replay.ativo()) AX.replay.fechar();
    if (AX.aba !== "vivo" && AX.trocarAba) AX.trocarAba("vivo");
    let D;
    try { D = await AX.json("/api/sim?" + AX.parametros({ per: "tudo", de: dia, ate: dia }), { tempo: 90000, carga: true }); }
    catch (err) { return AX.toast(err.message, "erro"); }
    if (seq !== P.seq) return;
    if (D.meta.dataIni !== dia) return AX.toast(`Sem pregão em ${AX.dataTxt(dia)} neste ativo e tempo gráfico. Escolha outro dia.`, "aviso");
    Object.assign(P, { on: true, D, dia, ini: D.meta.iIni, fim: D.meta.iFim, pausa: false, fala: "Abertura do pregão: o robô começa a observar." });
    P.k = P.ini - 1;
    AX.emReplay = true;
    AX.mostrar(D, P.k, { manterZoom: true });
    AX.autoPreco();
    AX.chart.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: false } });
    AX.chart.timeScale().setVisibleLogicalRange({ from: P.ini - 30, to: P.fim + 6 });
    montarBarra();
    pintarBarra();
    P.relogio = setTimeout(passo, 700);
  }
  // o que aconteceu no candle k (sinal, entrada, saída) vira a frase da barra
  function eventos(k) {
    const D = P.D, f = (v) => AX.fmt(v, D.meta.decimais), ev = [];
    for (const t of D.trades || []) {
      const lado = t.dir > 0 ? "COMPRA" : "VENDA";
      if (t.i_sinal === k && t.i_ent !== k) ev.push([1, `SINAL da ${t.est}: ${lado.toLowerCase()} armada em ${f(t.ent)}, stop ${f(t.stop_ini ?? t.stop)}${t.alvo != null ? ", alvo " + f(t.alvo) : ""}.`]);
      if (t.i_ent === k) ev.push([2, `${lado} executada a ${f(t.ent)} (${t.est}). Stop em ${f(t.stop_ini ?? t.stop)}${t.alvo != null ? ", alvo em " + f(t.alvo) : ""}.`, "entrada"]);
      if (t.i_sai === k) ev.push([3, `SAÍDA a ${f(t.sai)} (${t.motivo}): ${din(t.dinheiro)}.`, t.dinheiro > 0 ? "ganho" : "perda"]);
    }
    return ev.sort((a, b) => b[0] - a[0]);
  }
  function passo() {
    if (!P.on || P.pausa) return;
    if (P.k >= P.fim) { P.pausa = true; P.fala = "Fim do pregão. " + resumoTxt(); pintarBarra(); return; }
    const i = P.k + 1;
    P.cancelar = AX.formarCandle(P.D, i, P.vel >= 16 ? 0 : 2200 / P.vel, () => {
      if (!P.on || P.k !== i - 1) return;
      P.k = i; AX.avancar(i); AX.redesenhar();
      const ev = eventos(i);
      if (ev.length) { P.fala = hora(P.D.t[i]) + " · " + ev[0][1]; if (ev[0][2]) AX.som(ev[0][2]); }
      pintarBarra();
      P.relogio = setTimeout(passo, (ev.length ? 1800 : 380) / P.vel);
    });
  }
  function irPara(k) {                  // pular para um candle (barra de progresso, voltar ao começo)
    clearTimeout(P.relogio); if (P.cancelar) P.cancelar();
    P.k = Math.max(P.ini - 1, Math.min(P.fim, k));
    AX.mostrar(P.D, P.k, { manterZoom: true });
    const ev = eventos(P.k);
    P.fala = P.k < P.ini ? "Abertura do pregão: o robô começa a observar." : ev.length ? hora(P.D.t[P.k]) + " · " + ev[0][1] : "";
    pintarBarra();
  }
  function resumoTxt() {
    const fe = (P.D.trades || []).filter((t) => t.i_sai <= P.k && t.i_ent >= P.ini);
    const tot = fe.reduce((s, t) => s + t.dinheiro, 0);
    return fe.length ? `${fe.length} operaç${fe.length > 1 ? "ões" : "ão"} no dia: ${din(tot)}.` : "Nenhuma operação neste dia.";
  }
  function parar(silencioso) {
    clearTimeout(P.relogio); if (P.cancelar) P.cancelar();
    if (!P.on) return;
    P.on = false; AX.emReplay = false;
    AX.chart.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: true } });
    if (barra) barra.classList.add("oculto");
    const D = AX.vivo.D;
    if (D && silencioso !== true) AX.mostrar(D, D.meta.iFim);
  }

  // ---------------------------------------------------------------- barra de controle
  function montarBarra() {
    if (barra) { barra.classList.remove("oculto"); return; }
    barra = document.createElement("div");
    barra.className = "rpd";
    barra.innerHTML = `<div class="rpd-l1"><b class="rpd-tit"></b><span class="rpd-hora"></span><span class="rpd-res"></span>
        <button data-a="sair" class="rpd-sair" data-dica="Fechar o replay e voltar ao gráfico ao vivo">✕ Fechar</button></div>
      <input type="range" class="rpd-prog" min="0" max="1" value="0" aria-label="Posição no pregão">
      <div class="rpd-l2"><span class="rpd-ctl"><button data-a="zero" data-dica="Voltar à abertura">⏮</button><button data-a="pausa" class="rpd-play" data-dica="Pausar ou continuar">⏸</button><button data-a="um" data-dica="Avançar um candle">▶|</button></span>
        <span class="seg mini rpd-vel" data-dica="Velocidade: 1x = cada candle leva uns 2 segundos para se formar">${VEL.map((v) => `<button data-v="${v}">${velTxt(v)}</button>`).join("")}</span>
        <span class="rpd-fala"></span></div>`;
    $("areaGrafico").appendChild(barra);
    barra.addEventListener("click", (e) => {
      const b = e.target.closest("button"); if (!b) return;
      if (b.dataset.v) { P.vel = +b.dataset.v; return pintarBarra(); }
      const a = b.dataset.a;
      if (a === "sair") return parar();
      if (a === "zero") { irPara(P.ini - 1); P.pausa = false; pintarBarra(); P.relogio = setTimeout(passo, 500); return; }
      if (a === "um") { P.pausa = true; irPara(P.k + 1); return; }
      if (a === "pausa") {
        if (P.k >= P.fim) { irPara(P.ini - 1); P.pausa = false; pintarBarra(); P.relogio = setTimeout(passo, 500); return; }
        P.pausa = !P.pausa;
        if (P.pausa) irPara(P.k); else { pintarBarra(); passo(); }
      }
    });
    const prog = barra.querySelector(".rpd-prog");
    prog.addEventListener("input", () => { P.pausa = true; irPara(+prog.value); });
  }
  function pintarBarra() {
    if (!barra || !P.D) return;
    const D = P.D, k = Math.max(P.ini, Math.min(P.fim, P.k));
    const est = AX.pref.est === "TODAS" ? "minhas estratégias" : D.meta.est;
    barra.querySelector(".rpd-tit").textContent = `REPLAY · ${AX.dataTxt(P.dia)} · ${AX.rotAtivo(D.meta.ativo)} ${D.meta.nomeTf} · ${est}`;
    barra.querySelector(".rpd-hora").textContent = P.k < P.ini ? "antes da abertura" : hora(D.t[k]);
    const fe = (D.trades || []).filter((t) => t.i_sai <= P.k && t.i_ent >= P.ini), tot = fe.reduce((s, t) => s + t.dinheiro, 0);
    const aberta = (D.trades || []).find((t) => t.i_ent <= P.k && t.i_sai > P.k && t.i_ent >= P.ini);
    barra.querySelector(".rpd-res").innerHTML = `${fe.length} op${fe.length === 1 ? "" : "s"} · dia <b class="${AX.cls(tot)}">${din(tot)}</b>${aberta ? ` · <span class="alerta">${aberta.dir > 0 ? "comprado" : "vendido"}</span>` : ""}`;
    const prog = barra.querySelector(".rpd-prog");
    prog.min = P.ini - 1; prog.max = P.fim; prog.value = P.k;
    barra.querySelector(".rpd-play").textContent = P.pausa || P.k >= P.fim ? "▶" : "⏸";
    barra.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", +b.dataset.v === P.vel));
    barra.querySelector(".rpd-fala").textContent = P.fala || "";
  }
  AX.on("mudou", (o) => { if (P.on && o !== "contratos") parar(); });
  AX.replayDia = { comecar, parar, ativo: () => P.on };
})();
