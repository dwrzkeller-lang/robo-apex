/* ROBÔ APEX — replay da entrada e "e se…".
   (1) REPLAY DA ENTRADA: toca uma operação da lista candle a candle, de antes do sinal até depois da saída, com as
       etapas escritas (antes do sinal, sinal, ordem armada, entrada, em andamento, saída) e velocidade 1x a 10x.
   (2) E SE…: refaz a mesma entrada com outro stop e outro alvo e mostra o que teria acontecido nos candles reais.
   (3) LIÇÕES: o ajuste pode ser salvo com uma anotação. O robô então aplica o mesmo ajuste a TODAS as operações daquela
       estratégia no período e mostra se ele melhora o conjunto ou só aquela operação (é assim que ele "aprende" sem
       se enganar: uma correção só vira regra se funcionar no geral). */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$, COR = AX.COR;
  const R = { on: false, tr: null, D: null, k: 0, fim: 0, is: 0, ie: 0, ix: 0, vel: 1, pausa: false, relogio: null };
  let barra = null;

  // ================================================================ 1. replay da entrada
  function etapa() {
    const t = R.tr, k = R.k, lado = t.dir > 0 ? "compra" : "venda";
    if (k < R.is) return ["1 de 6", "Antes do sinal: o robô só observa. Faltam " + (R.is - k) + " candle(s) para o sinal."];
    if (k === R.is) return ["2 de 6", `SINAL: este candle fechou e a ${t.est} armou a ${lado}.`];
    if (k < R.ie) return ["3 de 6", `Ordem armada: ${lado} em ${AX.fmt(t.ent)}, stop em ${AX.fmt(t.stop_ini ?? t.stop)}${t.alvo != null ? ", alvo em " + AX.fmt(t.alvo) : ""}. Esperando o preço chegar.`];
    if (k === R.ie) return ["4 de 6", `ENTRADA executada a ${AX.fmt(t.ent)}. O stop já está colocado em ${AX.fmt(t.stop_ini ?? t.stop)}.`];
    if (R.aberta || k < R.ix) return ["5 de 6", `Em andamento: ${AX.R((t.dir * (R.D.c[k] - t.ent)) / t.risco)} agora.`];
    return ["6 de 6", `SAÍDA a ${AX.fmt(t.sai)} (${t.motivo}): ${AX.R(t.R)}${t.dinheiro != null ? " = " + AX.dinheiro(t.dinheiro, R.D, true) : ""}.`];
  }
  function pintarBarra() {
    if (!barra) return;
    const [n, txt] = etapa();
    barra.querySelector(".rp-etapa").textContent = "Etapa " + n;
    barra.querySelector(".rp-fala").textContent = txt;
    barra.querySelector("[data-a=pausa]").textContent = R.pausa || R.k >= R.fim ? "▶" : "⏸";
    barra.querySelectorAll("[data-v]").forEach((b) => b.classList.toggle("on", +b.dataset.v === R.vel));
  }
  function passo() {
    if (!R.on || R.pausa) return;
    if (R.k >= R.fim) { R.pausa = true; pintarBarra(); return; }
    R.k++; AX.avancar(R.k); AX.redesenhar(); pintarBarra();
    // nos candles importantes (sinal, entrada, saída) o replay segura um pouco mais
    const chave = R.k === R.is || R.k === R.ie || R.k === R.ix;
    R.relogio = setTimeout(passo, (chave ? 1500 : 650) / R.vel);
  }
  function comecar() {
    clearTimeout(R.relogio);
    const de = Math.max(0, R.is - 25);
    R.k = de; R.pausa = false;
    AX.mostrar(R.D, de, { manterZoom: true });
    AX.autoPreco();
    AX.chart.timeScale().setVisibleLogicalRange({ from: de - 8, to: R.fim + 12 });
    pintarBarra();
    R.relogio = setTimeout(passo, 900);
  }
  function fechar() {
    if (!R.on) return;
    clearTimeout(R.relogio); R.on = false; AX.emReplay = false;
    if (barra) barra.classList.add("oculto");
    const D = AX.vivo.D;
    if (D) AX.mostrar(D, D.meta.iFim);
  }
  function tocar(tr, meta) {
    const D = AX.vivo.D;
    if (!D || D.meta.ativo !== meta.ativo || +D.meta.tf !== +meta.tf) return AX.toast("Abra este ativo e este tempo gráfico para ver o replay.", "aviso");
    const ie = AX.idxT(D, tr.t_ent), is = AX.idxT(D, tr.t_sinal);
    if (ie < 0) return AX.toast("Esta operação está fora dos candles carregados.", "aviso");
    const aberta = tr.t_sai == null, ix = aberta ? D.meta.iFim : AX.idxT(D, tr.t_sai);
    Object.assign(R, { on: true, tr, D, is: is >= 0 ? is : ie - 1, ie, ix: ix >= 0 ? ix : D.meta.iFim, aberta });
    R.fim = Math.min(D.t.length - 1, D.meta.iFim, R.ix + (aberta ? 0 : 6));
    AX.emReplay = true;
    if (!barra) {
      barra = document.createElement("div");
      barra.className = "rp-op";
      barra.innerHTML = `<b class="rp-etapa"></b><span class="rp-fala"></span>
        <span class="rp-ctl"><button data-a="pausa" data-dica="Pausar ou continuar (se já terminou, toca de novo)">⏸</button><button data-a="um" data-dica="Avançar um candle">▶|</button><button data-a="zero" data-dica="Voltar ao começo">⏮</button>
        <span class="seg mini">${[1, 2, 3, 5, 10].map((v) => `<button data-v="${v}">${v}x</button>`).join("")}</span><button data-a="sair" data-dica="Fechar o replay e voltar ao vivo">✕ Fechar</button></span>`;
      $("areaGrafico").appendChild(barra);
      barra.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.v) { R.vel = +b.dataset.v; pintarBarra(); return; }
        const a = b.dataset.a;
        if (a === "sair") return fechar();
        if (a === "zero") return comecar();
        if (a === "um") { R.pausa = true; clearTimeout(R.relogio); if (R.k < R.fim) { R.k++; AX.avancar(R.k); AX.redesenhar(); } return pintarBarra(); }
        if (a === "pausa") {
          if (R.k >= R.fim) return comecar();
          R.pausa = !R.pausa; clearTimeout(R.relogio); pintarBarra(); if (!R.pausa) passo();
        }
      });
    }
    barra.classList.remove("oculto");
    comecar();
  }
  // enquanto a ordem está armada (entre o sinal e a entrada) o gráfico mostra onde ela vai entrar, o stop e o alvo
  AX.camadas.push((ctx, u) => {
    if (!R.on || AX.graficoMostra() !== R.D) return;
    const t = R.tr, k = AX.i;
    if (k < R.is || k >= R.ie) return;
    const xa = u.x(R.is), xb = u.x(R.ie + 1);
    if (xa == null || xb == null) return;
    for (const [p, cor, nome] of [[t.ent, t.dir > 0 ? COR.compra : COR.venda, (t.dir > 0 ? "COMPRA ARMADA " : "VENDA ARMADA ")], [t.stop_ini ?? t.stop, COR.perda, "STOP "], [t.alvo, COR.ganho, "ALVO "]]) {
      const y = p == null ? null : u.y(p); if (y == null) continue;
      ctx.strokeStyle = cor; ctx.lineWidth = 2; ctx.setLineDash([6, 4]); ctx.beginPath(); ctx.moveTo(xa, y); ctx.lineTo(xb, y); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = "700 12px Segoe UI, system-ui"; const txt = nome + AX.fmt(p), w = ctx.measureText(txt).width + 12;
      ctx.fillStyle = cor; ctx.fillRect(xa - w - 6, y - 10, w, 20); ctx.fillStyle = "#06101c"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(txt, xa - w, y + 0.5);
    }
  });

  // ================================================================ 2. "e se…": a mesma entrada com outro stop e outro alvo
  // Regras iguais às do simulador, do lado conservador: candle que toca o stop e o alvo conta como stop; no intraday a
  // operação é encerrada no último candle do dia. Custos: os mesmos da operação original (ida e volta).
  function refazer(D, t, stop, alvo) {
    const ie = AX.idxT(D, t.t_ent); if (ie < 0) return null;
    const d = t.dir, risco = d * (t.ent - stop);
    if (!(risco > 0) || (alvo != null && !(d * (alvo - t.ent) > 0))) return null;
    const m = D.meta, custo = 2 * (m.slip || 0) + (2 * (m.custo || 0)) / (m.valorPonto || 1) + 2 * (m.custoPct || 0) * Math.abs(t.ent);
    let sai = null, motivo = "", i = ie;
    for (; i < D.t.length; i++) {
      const lo = D.l[i], hi = D.h[i];
      if (d > 0 ? lo <= stop : hi >= stop) { sai = stop; motivo = "stop"; break; }
      if (alvo != null && (d > 0 ? hi >= alvo : lo <= alvo)) { sai = alvo; motivo = "alvo"; break; }
      if (m.intraday && i + 1 < D.t.length && D.d[i + 1] !== D.d[i]) { sai = D.c[i]; motivo = "fim do dia"; break; }
    }
    if (sai == null) { i = D.t.length - 1; sai = D.c[i]; motivo = "ainda aberta"; }
    const pts = d * (sai - t.ent) - custo;
    return { R: pts / risco, pts, motivo, i_sai: i, sai, risco, dinheiro: pts * (m.valorPonto || 1) * (t.q != null ? t.q : m.contratos || 1) };
  }
  const L = { lista: null };
  async function licoes() {
    if (L.lista) return L.lista;
    try { const v = await AX.api.get("licoes"); L.lista = Array.isArray(v) ? v : []; } catch (e) { L.lista = []; }
    return L.lista;
  }
  // aplica o ajuste de uma lição (stop a "fs" vezes a distância original; alvo a "ra" vezes o risco novo) a todas as operações da estratégia
  function generalizar(D, est, fs, ra) {
    let n = 0, antes = 0, depois = 0, viraram = 0, pioraram = 0;
    for (const t of D.trades) {
      if (t.est !== est) continue;
      const s0 = t.stop_ini ?? t.stop, risco0 = Math.abs(t.ent - s0);
      const stop = t.ent - t.dir * risco0 * fs, alvo = ra > 0 ? t.ent + t.dir * risco0 * fs * ra : null;
      const base = refazer(D, t, s0, t.alvo), novo = refazer(D, t, stop, alvo);
      if (!base || !novo) continue;
      n++; antes += base.dinheiro; depois += novo.dinheiro;
      if (base.dinheiro <= 0 && novo.dinheiro > 0) viraram++;
      if (base.dinheiro > 0 && novo.dinheiro <= 0) pioraram++;
    }
    return { n, antes, depois, viraram, pioraram };
  }
  function painelEse(tr, meta, alvoEl) {
    const D = AX.vivo.D, dec = meta.decimais, f = (v) => (v == null ? "" : (+v).toFixed(dec).replace(".", ","));
    const s0 = tr.stop_ini ?? tr.stop;
    alvoEl.innerHTML = `<div class="ese"><div class="manual-tit">E SE… ${AX.q("Mude o stop e o alvo desta entrada e veja o que teria acontecido nos candles reais, com os mesmos custos. Depois salve como lição: o robô testa o mesmo ajuste em todas as operações desta estratégia no período, para mostrar se a correção vale no geral ou só nesta operação.")}</div>
      <div class="manual-campos"><label class="campo"><span>Stop</span><input type="text" inputmode="decimal" id="eseStop" value="${f(s0)}"></label>
        <label class="campo"><span>Alvo (vazio = sem alvo)</span><input type="text" inputmode="decimal" id="eseAlvo" value="${f(tr.alvo)}"></label><button id="eseVer">Refazer</button></div>
      <div id="eseRes" class="nota">Original: <b class="${AX.cls(tr.R)}">${AX.R(tr.R)}</b> (${AX.esc(tr.motivo || "aberta")}). Mude os preços e clique em Refazer.</div></div>`;
    const num = (id) => { const s = $(id).value.trim().replace(/\s/g, ""); if (!s) return null; const a = parseFloat(s.replace(/\./g, "").replace(",", ".")), b = parseFloat(s.replace(",", ".")); const ok = [a, b].filter((v) => v > 0); return ok.length ? ok.sort((p, q) => Math.abs(Math.log(p / tr.ent)) - Math.abs(Math.log(q / tr.ent)))[0] : NaN; };
    $("eseVer").onclick = () => {
      const stop = num("eseStop"), alvo = num("eseAlvo"), el = $("eseRes");
      if (!(stop > 0) || Number.isNaN(alvo)) { el.innerHTML = '<span class="ruim">Não entendi os preços.</span>'; return; }
      const r = D ? refazer(D, tr, stop, alvo) : null;
      if (!r) { el.innerHTML = '<span class="ruim">O stop tem de ficar do lado da perda e o alvo do lado do ganho.</span>'; return; }
      const fs = r.risco / Math.abs(tr.ent - s0), ra = alvo != null ? Math.abs(alvo - tr.ent) / r.risco : 0;
      const g = generalizar(D, tr.est, fs, ra);
      el.innerHTML = `Com esse ajuste: <b class="${AX.cls(r.R)}">${AX.R(r.R)} = ${AX.dinheiro(r.dinheiro, D, true)}</b> (${r.motivo} em ${AX.quando(D, r.i_sai)}), em vez de <b class="${AX.cls(tr.R)}">${AX.R(tr.R)}</b>.
        <br>Stop a ${AX.num(fs, 2)}× a distância original${ra ? " e alvo a " + AX.num(ra, 1) + " : 1" : ", sem alvo"}.
        <br><b>O mesmo ajuste nas ${g.n} operações da ${AX.esc(tr.est)} neste período:</b> de <b class="${AX.cls(g.antes)}">${AX.dinheiro(g.antes, D, true)}</b> para <b class="${AX.cls(g.depois)}">${AX.dinheiro(g.depois, D, true)}</b> · ${g.viraram} perda(s) viraram ganho, ${g.pioraram} ganho(s) viraram perda.
        <span class="${g.depois > g.antes ? "bom" : "alerta"}">${g.depois > g.antes ? "Melhorou o conjunto: vale testar como regra." : "No conjunto não melhorou: a correção só funciona olhando esta operação depois que ela aconteceu."}</span>
        <label class="campo" style="margin-top:6px"><span>O que você aprendeu nesta entrada (opcional)</span><input type="text" id="eseNota" maxlength="200" placeholder="ex.: stop curto demais para esse horário"></label>
        <div class="botoes finos"><button id="eseSalvar" class="primario">Salvar como lição</button></div>`;
      $("eseSalvar").onclick = async () => {
        const lista = await licoes();
        lista.push({ quando: Date.now(), ativo: meta.ativo, tf: +meta.tf, est: tr.est, dir: tr.dir, t_ent: tr.t_ent, fs: +fs.toFixed(3), ra: +ra.toFixed(2), antes: +(+tr.R).toFixed(2), depois: +r.R.toFixed(2),
          nota: String($("eseNota").value || "").slice(0, 200), geral: { n: g.n, antes: Math.round(g.antes), depois: Math.round(g.depois) } });
        L.lista = lista.slice(-200);
        try { await AX.api.set("licoes", L.lista); AX.toast("Lição salva. Ela aparece na aba IA, em Suas lições.", "ok"); renderLicoes(); }
        catch (e) { AX.toast("Não consegui salvar a lição: " + e.message, "erro"); }
      };
    };
  }

  // ================================================================ 3. suas lições (aba IA)
  async function renderLicoes() {
    const el = $("iaLicoes"); if (!el) return;
    const lista = await licoes(), D = AX.vivo.D;
    if (!lista.length) {
      el.innerHTML = `<div class="card"><div class="rot">SUAS LIÇÕES</div><div class="nota">Nenhuma ainda. Na aba Ao vivo, clique numa operação da lista e use <b>E se…</b> para corrigir o stop e o alvo; salve como lição e ela aparece aqui, com o teste do ajuste em todas as operações da estratégia.</div></div>`;
      return;
    }
    const porEst = {};
    for (const x of lista) (porEst[x.est] = porEst[x.est] || []).push(x);
    let h = `<div class="card"><div class="rot">SUAS LIÇÕES ${AX.q("Cada lição é um ajuste de stop e alvo que você fez numa operação. Para cada estratégia o robô tira a média dos seus ajustes e aplica em todas as operações dela no período do topo. Só vale virar regra o ajuste que melhora o conjunto: corrigir uma operação depois que ela aconteceu é sempre possível, e é por isso que o robô confere.")}<span class="dir">${lista.length} salva(s)</span></div>`;
    for (const [est, ls] of Object.entries(porEst)) {
      const fs = ls.reduce((a, x) => a + x.fs, 0) / ls.length, comAlvo = ls.filter((x) => x.ra > 0), ra = comAlvo.length ? comAlvo.reduce((a, x) => a + x.ra, 0) / comAlvo.length : 0;
      const g = D ? generalizar(D, est, fs, ra) : null;
      h += `<div class="licao ${g && g.depois > g.antes ? "boa" : "ma"}"><i>${g && g.depois > g.antes ? "▲" : "▼"}</i><div><b>${AX.esc(est)} · ${AX.esc(AX.nomeEst(est))}: ${ls.length} lição(ões)</b>
        <span>Seu ajuste médio: stop a ${AX.num(fs, 2)}× a distância original${ra ? ", alvo a " + AX.num(ra, 1) + " : 1" : ", sem alvo"}.
        ${g && g.n ? ` Aplicado às ${g.n} operações deste ativo e período: de <b class="${AX.cls(g.antes)}">${AX.dinheiro(g.antes, D, true)}</b> para <b class="${AX.cls(g.depois)}">${AX.dinheiro(g.depois, D, true)}</b> (${g.viraram} perdas viraram ganho, ${g.pioraram} ganhos viraram perda).` : " Sem operações desta estratégia no ativo e período de agora."}
        ${ls.filter((x) => x.nota).slice(-3).map((x) => `<br>“${AX.esc(x.nota)}”`).join("")}</span></div></div>`;
    }
    h += `<div class="nota">O ajuste ainda não entra sozinho nos sinais ao vivo: quando um deles melhorar o conjunto em mais de um ativo e período, use os botões de gestão e as proteções do stop (aba Plano) que mais se aproximam dele.</div>
      <div class="botoes finos"><button id="licLimpar">Apagar as lições</button></div></div>`;
    el.innerHTML = h;
    $("licLimpar").onclick = async () => { if (!confirm("Apagar todas as suas lições?")) return; L.lista = []; try { await AX.api.set("licoes", []); } catch (e) { /* ok */ } renderLicoes(); };
  }

  AX.replay = { tocar, fechar, ativo: () => R.on, painelEse, refazer, generalizar };
  AX.on("aba", (n) => { if (R.on && n !== "vivo") fechar(); if (n === "ia") renderLicoes(); });
  AX.on("mudou", () => { fechar(); if (AX.aba === "ia") setTimeout(renderLicoes, 1500); });
  AX.on("dadosVivo", () => { if (AX.aba === "ia") renderLicoes(); });
  AX.on("tecla", (e) => { if (R.on && e.key === "Escape") fechar(); if (R.on && e.key === " ") { e.preventDefault(); barra.querySelector("[data-a=pausa]").click(); } });
})();
