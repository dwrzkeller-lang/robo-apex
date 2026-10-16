/* ROBÔ APEX: RAIO-X DO PRICE ACTION. Lê o gráfico como um trader de price action e desenha por cima:
   - ESTRUTURA: topos e fundos confirmados (HH topo mais alto, HL fundo mais alto, LH topo mais baixo, LL fundo mais baixo)
     e os rompimentos de estrutura: BOS (rompeu a favor da tendência) e CHoCH (rompeu contra: possível virada).
   - ZONAS de demanda e de oferta: o último candle contrário antes do impulso que rompeu a estrutura (onde os grandes
     entraram). Valem até o preço fechar do outro lado.
   - FVG (desequilíbrio): buraco entre o candle de 2 atrás e o atual que o preço costuma voltar para preencher.
   - LIQUIDEZ: topos ou fundos iguais, onde ficam os stops de muita gente (o preço costuma ir buscar).
   Tudo é calculado só com os candles que já aparecem no gráfico: no replay, ele lê o mercado como estava naquela hora.
   O cartão "Raio-X agora" (aba Agora) resume: tendência, último rompimento, zonas mais perto, liquidez e a nota do sinal. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const K = 3, JANELA = 600;
  const COR = { dem: "34, 227, 154", ofe: "255, 92, 110", fvg: "167, 139, 250", liq: "255, 210, 63", bos: "125, 211, 252", choch: "251, 146, 60" };
  const CAMADAS = [["estrutura", "Estrutura (HH, HL, BOS, CHoCH)"], ["zonas", "Zonas de demanda e oferta"], ["fvg", "FVG (desequilíbrios)"], ["liquidez", "Liquidez (topos e fundos iguais)"]];
  const pref = () => {
    if (!AX.pref.raiox || typeof AX.pref.raiox !== "object") AX.pref.raiox = { on: true, estrutura: true, zonas: true, fvg: true, liquidez: true };
    return AX.pref.raiox;
  };
  let cache = { D: null, k: -1, r: null };

  // ---------------------------------------------------------------- análise
  function atrs(D, ini, k) {
    const out = new Array(k + 1).fill(null);
    let s = 0;
    for (let i = Math.max(1, ini - 14); i <= k; i++) {
      const tr = Math.max(D.h[i] - D.l[i], Math.abs(D.h[i] - D.c[i - 1]), Math.abs(D.l[i] - D.c[i - 1]));
      s = s === 0 ? tr : s + (tr - s) / 14;
      out[i] = s;
    }
    return out;
  }
  function analisar(D, k) {
    if (cache.D === D && cache.k === k) return cache.r;
    const ini = Math.max(K + 2, k - JANELA), h = D.h, l = D.l, c = D.c, o = D.o, atr = atrs(D, ini, k);
    const topos = [], fundos = [], eventos = [], zonas = [], fvgs = [];
    let tend = 0, ultTopo = null, ultFundo = null;
    for (let j = ini; j <= k; j++) {
      // topo/fundo em p = j - K fica confirmado agora (K candles de cada lado)
      const p = j - K;
      if (p - K >= ini - K) {
        let ehT = true, ehF = true;
        for (let m = 1; m <= K; m++) {
          if (!(h[p] > h[p - m]) || !(h[p] >= h[p + m])) ehT = false;
          if (!(l[p] < l[p - m]) || !(l[p] <= l[p + m])) ehF = false;
        }
        if (ehT) { const ant = topos[topos.length - 1]; const t = { i: p, p: h[p], rot: ant ? (h[p] > ant.p ? "HH" : "LH") : "", varrido: false }; topos.push(t); ultTopo = t; }
        if (ehF) { const ant = fundos[fundos.length - 1]; const f = { i: p, p: l[p], rot: ant ? (l[p] > ant.p ? "HL" : "LL") : "", varrido: false }; fundos.push(f); ultFundo = f; }
      }
      // rompimentos de estrutura (fechamento além do último topo/fundo ainda não rompido)
      if (ultTopo && !ultTopo.rompido && c[j] > ultTopo.p) {
        ultTopo.rompido = true;
        eventos.push({ tipo: tend === 1 ? "BOS" : "CHoCH", dir: 1, de: ultTopo.i, ate: j, p: ultTopo.p });
        tend = 1;
        for (let m = j - 1; m >= Math.max(ini, j - 25); m--) if (c[m] < o[m]) { zonas.push({ dir: 1, de: m, lo: l[m], hi: Math.max(o[m], c[m], h[m]), ate: null, toques: 0 }); break; }
      }
      if (ultFundo && !ultFundo.rompido && c[j] < ultFundo.p) {
        ultFundo.rompido = true;
        eventos.push({ tipo: tend === -1 ? "BOS" : "CHoCH", dir: -1, de: ultFundo.i, ate: j, p: ultFundo.p });
        tend = -1;
        for (let m = j - 1; m >= Math.max(ini, j - 25); m--) if (c[m] > o[m]) { zonas.push({ dir: -1, de: m, lo: Math.min(o[m], c[m], l[m]), hi: h[m], ate: null, toques: 0 }); break; }
      }
      // zonas: invalidadas quando o preço fecha do outro lado; contam os toques
      for (const z of zonas) {
        if (z.ate != null || j <= z.de + 1) continue;
        if (z.dir > 0 ? c[j] < z.lo : c[j] > z.hi) z.ate = j;
        else if (z.dir > 0 ? l[j] <= z.hi : h[j] >= z.lo) z.toques++;
      }
      // FVG
      if (j - 2 >= ini && atr[j]) {
        if (l[j] - h[j - 2] >= 0.25 * atr[j]) fvgs.push({ dir: 1, de: j - 1, lo: h[j - 2], hi: l[j], ate: null });
        if (l[j - 2] - h[j] >= 0.25 * atr[j]) fvgs.push({ dir: -1, de: j - 1, lo: h[j], hi: l[j - 2], ate: null });
      }
      for (const f of fvgs) if (f.ate == null && j > f.de + 1 && (f.dir > 0 ? l[j] <= f.lo : h[j] >= f.hi)) f.ate = j;
      for (const t of topos) if (!t.varrido && j > t.i + K && h[j] > t.p) t.varrido = true;
      for (const f of fundos) if (!f.varrido && j > f.i + K && l[j] < f.p) f.varrido = true;
    }
    // liquidez: topos (ou fundos) iguais ainda não varridos
    const a = atr[k] || (h[k] - l[k]) || 1, liq = [];
    const pares = (lista, dir) => {
      const vivos = lista.filter((x) => !x.varrido).slice(-12);
      for (let x = 0; x < vivos.length; x++) for (let y = x + 1; y < vivos.length; y++)
        if (Math.abs(vivos[x].p - vivos[y].p) <= 0.12 * a) liq.push({ dir, de: vivos[x].i, ate: vivos[y].i, p: dir > 0 ? Math.max(vivos[x].p, vivos[y].p) : Math.min(vivos[x].p, vivos[y].p) });
    };
    pares(topos, 1); pares(fundos, -1);
    const preco = c[k];
    const ativas = zonas.filter((z) => z.ate == null);
    const dem = ativas.filter((z) => z.dir > 0 && z.hi <= preco * 1.0000001 + a * 0.05).sort((x, y) => y.hi - x.hi)[0] || null;
    const ofe = ativas.filter((z) => z.dir < 0 && z.lo >= preco - a * 0.05).sort((x, y) => x.lo - y.lo)[0] || null;
    const liqAcima = liq.filter((x) => x.dir > 0 && x.p > preco).sort((x, y) => x.p - y.p)[0] || null;
    const liqAbaixo = liq.filter((x) => x.dir < 0 && x.p < preco).sort((x, y) => y.p - x.p)[0] || null;
    const r = { ini, k, topos, fundos, eventos, zonas, fvgs, liq, tend, atr: a, preco, dem, ofe, liqAcima, liqAbaixo,
      fvgAbertos: fvgs.filter((f) => f.ate == null).length };
    cache = { D, k, r };
    return r;
  }

  // ---------------------------------------------------------------- desenho
  function caixa(ctx, u, x0, x1, lo, hi, rgb, txt, forte) {
    const ya = u.y(hi), yb = u.y(lo);
    if (ya == null || yb == null || x0 == null) return;
    const xa = Math.max(0, x0), xb = Math.min(u.W, x1 == null ? u.W : x1);
    if (xb <= xa) return;
    ctx.fillStyle = `rgba(${rgb}, ${forte ? 0.16 : 0.09})`;
    ctx.fillRect(xa, ya, xb - xa, yb - ya);
    ctx.strokeStyle = `rgba(${rgb}, .55)`; ctx.lineWidth = 1;
    ctx.strokeRect(Math.round(xa) + 0.5, Math.round(ya) + 0.5, Math.round(xb - xa), Math.round(yb - ya));
    if (txt && yb - ya > 9) { ctx.fillStyle = `rgba(${rgb}, .95)`; ctx.font = "700 10px Segoe UI, system-ui"; ctx.textBaseline = "top"; ctx.textAlign = "left"; ctx.fillText(txt, xa + 4, ya + 2); }
  }
  AX.camadas.push((ctx, u) => {
    const P = pref(), D = AX.graficoMostra ? AX.graficoMostra() : null;
    if (!P.on || !D || !D.t || D.t.length < 30) return;
    const k = Math.min(AX.i, D.t.length - 1), r = analisar(D, k);
    const xEnd = u.x(k + 4), preco = r.preco, perto = 6 * r.atr;
    const dist = (lo, hi) => (preco < lo ? lo - preco : preco > hi ? preco - hi : 0);
    if (P.zonas) {
      // as 2 zonas ativas mais perto do preço de cada lado (o resto polui e já não importa)
      const ativas = r.zonas.filter((z) => z.ate == null && dist(z.lo, z.hi) <= perto * 2);
      const lado = (d) => ativas.filter((z) => z.dir === d).sort((a, b) => dist(a.lo, a.hi) - dist(b.lo, b.hi)).slice(0, 2);
      for (const z of lado(1).concat(lado(-1)))
        caixa(ctx, u, u.x(Math.max(z.de, k - 160)), xEnd, z.lo, z.hi, z.dir > 0 ? COR.dem : COR.ofe, (z.dir > 0 ? "DEMANDA" : "OFERTA") + (z.toques ? ` · ${z.toques}x` : ""), true);
    }
    if (P.fvg) {
      const abertos = r.fvgs.filter((f) => f.ate == null && dist(f.lo, f.hi) <= perto).sort((a, b) => dist(a.lo, a.hi) - dist(b.lo, b.hi)).slice(0, 4);
      for (const f of abertos) caixa(ctx, u, u.x(Math.max(f.de, k - 160)), xEnd, f.lo, f.hi, COR.fvg, "FVG", false);
    }
    if (P.liquidez) for (const q of r.liq.filter((q) => Math.abs(q.p - preco) <= perto * 2).slice(-4)) {
      const y = u.y(q.p), xa = u.x(q.de);
      if (y == null || xa == null) continue;
      ctx.strokeStyle = `rgba(${COR.liq}, .85)`; ctx.setLineDash([2, 3]); ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(xa, Math.round(y) + 0.5); ctx.lineTo(xEnd, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = `rgba(${COR.liq}, .95)`; ctx.font = "700 10px Segoe UI, system-ui"; ctx.textAlign = "right"; ctx.textBaseline = q.dir > 0 ? "bottom" : "top";
      ctx.fillText("$$$ liquidez", xEnd - 2, q.dir > 0 ? y - 2 : y + 2);
    }
    if (P.estrutura) {
      ctx.font = "700 10px Segoe UI, system-ui"; ctx.textAlign = "center";
      for (const t of r.topos.filter((t) => t.i >= k - 220).slice(-8)) { const x = u.x(t.i), y = u.y(t.p); if (x == null || y == null || !t.rot) continue; ctx.fillStyle = t.rot === "HH" ? `rgb(${COR.dem})` : `rgb(${COR.ofe})`; ctx.textBaseline = "bottom"; ctx.fillText(t.rot, x, y - 6); }
      for (const f of r.fundos.filter((f) => f.i >= k - 220).slice(-8)) { const x = u.x(f.i), y = u.y(f.p); if (x == null || y == null || !f.rot) continue; ctx.fillStyle = f.rot === "HL" ? `rgb(${COR.dem})` : `rgb(${COR.ofe})`; ctx.textBaseline = "top"; ctx.fillText(f.rot, x, y + 6); }
      for (const e of r.eventos.filter((e) => e.ate >= k - 220).slice(-4)) {
        const xa = u.x(e.de), xb = u.x(e.ate), y = u.y(e.p);
        if (xa == null || xb == null || y == null) continue;
        const rgb = e.tipo === "BOS" ? COR.bos : COR.choch;
        ctx.strokeStyle = `rgba(${rgb}, .9)`; ctx.lineWidth = 1.4; ctx.setLineDash([5, 3]);
        ctx.beginPath(); ctx.moveTo(xa, Math.round(y) + 0.5); ctx.lineTo(xb, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = `rgb(${rgb})`; ctx.textBaseline = e.dir > 0 ? "bottom" : "top"; ctx.fillText(e.tipo, (xa + xb) / 2, e.dir > 0 ? y - 3 : y + 3);
      }
    }
  });

  // ---------------------------------------------------------------- cartão "Raio-X agora"
  const pts = (v, D) => AX.fmt(v, D.meta.decimais);
  function distTxt(D, alvo, preco, z) {
    if (z && preco >= z.lo && preco <= z.hi) return `${pts(z.lo, D)} a ${pts(z.hi, D)} <span class="alerta">· o preço está dentro dela</span>`;
    const d = Math.abs(alvo - preco), vp = D.meta.valorPonto || 1;
    return `${pts(alvo, D)} <span class="neutro">(${AX.fmt(d, D.meta.decimais)} pts · ${AX.dinheiro(d * vp, D)} por ${D.meta.fracionado ? "lote" : "contrato"})</span>`;
  }
  function notaAtual(D) {
    const F = AX.fonteOps ? AX.fonteOps(D) : D;
    const ab = (F.abertas || [])[0], pend = (D.ordens || []).filter((o) => o.status === "pendente").slice(-1)[0];
    const x = ab || pend;
    if (x && x.qual) return { nota: x.qual, itens: x.qualItens || [], oque: ab ? "operação aberta" : "ordem armada" };
    const ult = (F.trades || []).slice(-1)[0];
    return ult && ult.qual ? { nota: ult.qual, itens: [], oque: "última operação" } : null;
  }
  const NOME_ITEM = { estrutura: "estrutura a favor", espaco: "espaço até a barreira ≥ 2x o risco", diario: "diário a favor", rejeicao: "rejeição no candle do sinal" };
  function render() {
    const el = $("cardRaiox"), D = AX.vivo && AX.vivo.D;
    if (!el) return;
    if (!D || !D.t || D.t.length < 30) { el.classList.add("oculto"); return; }
    el.classList.remove("oculto");
    const P = pref(), k = D.meta.iFim, r = analisar(D, k), preco = D.c[k];
    const ultEv = r.eventos[r.eventos.length - 1];
    const tendTxt = r.tend > 0 ? '<b class="bom">▲ ALTA</b> (topos e fundos subindo)' : r.tend < 0 ? '<b class="ruim">▼ BAIXA</b> (topos e fundos descendo)' : '<b class="neutro">LATERAL</b>';
    const nt = notaAtual(D);
    el.innerHTML = `<div class="rot"><i class="rx-ic"></i>RAIO-X DO PREÇO ${AX.q("Leitura de price action feita pelo robô com os candles do gráfico: estrutura (HH, HL, LH, LL), rompimentos de estrutura (BOS a favor, CHoCH contra), zonas de demanda e oferta, desequilíbrios (FVG) e liquidez (topos e fundos iguais, onde ficam muitos stops). Use para ver se a entrada tem espaço até a próxima barreira. É leitura, não recomendação.")}
        <label class="rx-liga"><input type="checkbox" id="rxOn"${P.on ? " checked" : ""}> no gráfico</label></div>
      <div class="rx-grade">
        <div><small>Tendência da estrutura</small><span>${tendTxt}</span></div>
        <div><small>Último rompimento</small><span>${ultEv ? `<b style="color:rgb(${ultEv.tipo === "BOS" ? COR.bos : COR.choch})">${ultEv.tipo}</b> ${ultEv.dir > 0 ? "para cima" : "para baixo"} às ${AX.quandoT(D.t[ultEv.ate]).slice(-5)}${ultEv.tipo === "CHoCH" ? " · possível virada" : ""}` : '<span class="neutro">nenhum ainda</span>'}</span></div>
        <div><small>Oferta acima</small><span>${r.ofe ? distTxt(D, r.ofe.lo, preco, r.ofe) : '<span class="neutro">nenhuma zona ativa</span>'}</span></div>
        <div><small>Demanda abaixo</small><span>${r.dem ? distTxt(D, r.dem.hi, preco, r.dem) : '<span class="neutro">nenhuma zona ativa</span>'}</span></div>
        <div><small>Liquidez acima</small><span>${r.liqAcima ? distTxt(D, r.liqAcima.p, preco) : '<span class="neutro">-</span>'}</span></div>
        <div><small>Liquidez abaixo</small><span>${r.liqAbaixo ? distTxt(D, r.liqAbaixo.p, preco) : '<span class="neutro">-</span>'}</span></div>
      </div>
      ${nt ? `<div class="rx-nota n-${nt.nota.replace("+", "p")}"><b>${nt.nota}</b><div><small>Nota da ${AX.esc(nt.oque)}</small><span>${nt.itens.length ? nt.itens.map((i) => NOME_ITEM[i] || i).join(" · ") : "veja os detalhes na lista de operações"}</span></div></div>` : ""}
      <div class="rx-camadas">${CAMADAS.map(([c, t]) => `<label class="chk"><input type="checkbox" data-rx="${c}"${P[c] ? " checked" : ""}> ${t}</label>`).join("")}</div>`;
    $("rxOn").onchange = (e) => { P.on = e.target.checked; AX.salvarPref(); marcarBotao(); AX.redesenhar(); };
    el.querySelectorAll("[data-rx]").forEach((x) => (x.onchange = () => { P[x.dataset.rx] = x.checked; AX.salvarPref(); AX.redesenhar(); }));
  }
  function marcarBotao() { const b = $("btRaiox"); if (b) b.classList.toggle("on", !!pref().on); }
  const bt = $("btRaiox");
  if (bt) bt.onclick = () => { const P = pref(); P.on = !P.on; AX.salvarPref(); marcarBotao(); render(); AX.redesenhar(); };
  AX.on("config", marcarBotao);
  AX.on("dadosVivo", render);
  AX.on("aba", (n) => { if (n === "vivo") render(); });
  AX.raiox = { analisar, render };
})();
