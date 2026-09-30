/* ROBÔ KELLER — ferramentas de desenho estilo Profit: tendência, horizontal, vertical, Fibonacci, retângulo,
   régua, pincel, texto, borracha, ímã. Cada ponto é guardado como (horário, preço), então o desenho acompanha
   zoom e rolagem. Salvo por ativo em dados/estado_desenhos_<ativo>.json. */
(() => {
  "use strict";
  const RK = window.RK, $ = (id) => document.getElementById(id);
  const cv = $("desenho"), area = $("areaGrafico"), ctx = cv.getContext("2d");
  const DOIS_PONTOS = new Set(["tendencia", "fibo", "retangulo", "regua"]);
  const FIBO = [[0, "0%"], [0.236, "23,6%"], [0.382, "38,2%"], [0.5, "50%"], [0.618, "61,8%"], [0.786, "78,6%"], [1, "100%"],
    [-0.272, "127,2%"], [-0.618, "161,8%"]];
  const COR_FIBO = { 0: "#9aa5b5", 0.236: "#8bc34a", 0.382: "#ffaa3c", 0.5: "#ff8c00", 0.618: "#ffd700", 0.786: "#c87828", 1: "#9aa5b5", "-0.272": "#22d3ee", "-0.618": "#3b9cff" };
  let desenhos = [], ferramenta = "cursor", inicio = null, preview = null, pincel = null, chave = null, sujo = 0, arrasto = null, assinatura = "";

  // ---------------------------------------------------------------- coordenadas
  const barraSeg = () => (RK.D ? RK.D.meta.tf * 60 : 300);
  function idxDoTempo(t) {
    const T = RK.D.t, n = T.length;
    if (t <= T[0]) return (t - T[0]) / barraSeg();
    if (t >= T[n - 1]) return n - 1 + (t - T[n - 1]) / barraSeg();
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m] <= t) lo = m; else hi = m; }
    return lo + (t - T[lo]) / Math.max(1, T[hi] - T[lo]);
  }
  function tempoDoIdx(idx) {
    const T = RK.D.t, n = T.length, r = Math.round(idx);
    if (r >= 0 && r < n) return T[r];
    return r < 0 ? T[0] + r * barraSeg() : T[n - 1] + (r - (n - 1)) * barraSeg();
  }
  const xDe = (t) => RK.chart.timeScale().logicalToCoordinate(idxDoTempo(t));
  const yDe = (p) => RK.S.candle.priceToCoordinate(p);
  function pontoDoEvento(e) {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    const idx = RK.chart.timeScale().coordinateToLogical(x);
    if (idx == null) return null;
    let p = RK.S.candle.coordinateToPrice(y);
    const t = tempoDoIdx(idx);
    if ($("ima").classList.contains("on")) {              // ímã: gruda no OHLC do candle
      const k = Math.round(idx), D = RK.D;
      if (k >= 0 && k <= RK.i) {
        let melhor = null, dist = 16;
        for (const v of [D.o[k], D.h[k], D.l[k], D.c[k]]) { const d = Math.abs(yDe(v) - y); if (d < dist) { dist = d; melhor = v; } }
        if (melhor != null) p = melhor;
      }
    }
    return { t, p };
  }

  // ---------------------------------------------------------------- persistência
  const nomeChave = () => "desenhos_" + String(RK.ativo).replace(/[^A-Za-z0-9_\-.]/g, "_");
  async function carregar() {
    const k = nomeChave(); if (k === chave) return;
    chave = k; desenhos = (await RK.api.get(k).catch(() => null)) || []; sujo++;
  }
  let salvarT = null;
  function salvar() { sujo++; clearTimeout(salvarT); const k = chave, lista = desenhos.slice(); salvarT = setTimeout(() => RK.api.set(k, lista).catch(() => RK.toast("Não consegui salvar os desenhos", "erro")), 400); }

  // ---------------------------------------------------------------- ferramenta ativa
  function usar(f) {
    ferramenta = f; inicio = null; preview = null; pincel = null;
    document.querySelectorAll("#ferramentas button[data-f]").forEach((b) => b.classList.toggle("on", b.dataset.f === f));
    cv.classList.toggle("ativo", f !== "cursor");
    cv.style.cursor = f === "borracha" ? "not-allowed" : "crosshair";
    sujo++;
  }
  document.querySelectorAll("#ferramentas button[data-f]").forEach((b) => (b.onclick = () => usar(b.dataset.f)));
  $("ima").onclick = () => $("ima").classList.toggle("on");
  $("desfazer").onclick = () => { if (desenhos.length) { desenhos.pop(); salvar(); } };
  $("limparDesenhos").onclick = () => { if (desenhos.length && confirm(`Apagar os ${desenhos.length} desenhos deste ativo?`)) { desenhos = []; salvar(); } };
  RK.on("tecla", (e) => {
    if (e.key === "Escape") usar("cursor");
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); $("desfazer").click(); }
  });
  const estilo = () => ({ cor: $("corDesenho").value, esp: +$("espDesenho").value });
  const novo = (tipo, pts, extra) => { desenhos.push(Object.assign({ id: Date.now() + Math.random(), tipo, pts }, estilo(), extra || {})); salvar(); };

  cv.addEventListener("pointerdown", (e) => {
    if (!RK.D || ferramenta === "cursor") return;
    const p = pontoDoEvento(e); if (!p) return;
    cv.setPointerCapture(e.pointerId);
    if (ferramenta === "borracha") { const k = acertar(e); if (k >= 0) { desenhos.splice(k, 1); salvar(); } return; }
    if (ferramenta === "horizontal" || ferramenta === "vertical") { novo(ferramenta, [p]); usar("cursor"); return; }
    if (ferramenta === "texto") {
      const txt = prompt("Texto da anotação:"); if (txt) novo("texto", [p], { texto: txt.slice(0, 120) }); usar("cursor"); return;
    }
    if (ferramenta === "pincel") { pincel = [p]; return; }
    if (DOIS_PONTOS.has(ferramenta)) {
      if (!inicio) { inicio = { p, x: e.clientX, y: e.clientY }; preview = [p, p]; }
      else { finalizar(p); }
    }
  });
  cv.addEventListener("pointermove", (e) => {
    if (!RK.D) return;
    const p = pontoDoEvento(e); if (!p) return;
    if (pincel) { const u = pincel[pincel.length - 1]; if (Math.abs(xDe(u.t) - xDe(p.t)) + Math.abs(yDe(u.p) - yDe(p.p)) > 2) pincel.push(p); sujo++; }
    else if (inicio) { preview = [inicio.p, p]; sujo++; }
  });
  cv.addEventListener("pointerup", (e) => {
    if (pincel) { if (pincel.length > 1) novo("pincel", pincel); pincel = null; return; }
    if (inicio && Math.hypot(e.clientX - inicio.x, e.clientY - inicio.y) > 5) { const p = pontoDoEvento(e); if (p) finalizar(p); }
  });
  function finalizar(p2) { novo(ferramenta, [inicio.p, p2]); inicio = null; preview = null; usar("cursor"); }

  // arrastar pontas no modo cursor (sem atrapalhar o arrasto do gráfico)
  function pontaPerto(e) {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    for (let k = desenhos.length - 1; k >= 0; k--) {
      const d = desenhos[k]; if (d.tipo === "pincel") continue;
      for (let j = 0; j < d.pts.length; j++) {
        const px = xDe(d.pts[j].t), py = yDe(d.pts[j].p);
        if (px != null && py != null && Math.hypot(px - x, py - y) <= 7) return { k, j };
      }
    }
    return null;
  }
  area.addEventListener("pointerdown", (e) => {
    if (ferramenta !== "cursor" || !RK.D) return;
    const alvo = pontaPerto(e); if (!alvo) return;
    e.stopPropagation(); e.preventDefault(); arrasto = alvo; area.setPointerCapture(e.pointerId);
  }, true);
  area.addEventListener("pointermove", (e) => {
    if (ferramenta !== "cursor" || !RK.D) return;
    if (arrasto) { const p = pontoDoEvento(e); if (p) { desenhos[arrasto.k].pts[arrasto.j] = p; sujo++; } e.stopPropagation(); return; }
    area.style.cursor = pontaPerto(e) ? "move" : "";
  }, true);
  area.addEventListener("pointerup", (e) => { if (arrasto) { arrasto = null; salvar(); e.stopPropagation(); } }, true);

  // ---------------------------------------------------------------- borracha (acerto)
  function distSeg(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    const u = L ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / L)) : 0;
    return Math.hypot(px - (x1 + u * dx), py - (y1 + u * dy));
  }
  function acertar(e) {
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top, W = cv.clientWidth;
    let melhor = -1, dmin = 9;
    desenhos.forEach((d, k) => {
      const P = d.pts.map((q) => [xDe(q.t), yDe(q.p)]);
      if (P.some(([a, b]) => a == null || b == null)) return;
      let dist = 99;
      if (d.tipo === "horizontal") dist = Math.abs(y - P[0][1]);
      else if (d.tipo === "vertical") dist = Math.abs(x - P[0][0]);
      else if (d.tipo === "texto") dist = Math.hypot(x - P[0][0], y - P[0][1]) < 30 ? 0 : 99;
      else if (d.tipo === "pincel") for (let j = 1; j < P.length; j++) dist = Math.min(dist, distSeg(x, y, ...P[j - 1], ...P[j]));
      else if (d.tipo === "fibo") {
        const x0 = Math.min(P[0][0], P[1][0]);
        if (x >= x0 - 4) for (const [r2] of FIBO) { const yy = yDe(d.pts[1].p - r2 * (d.pts[1].p - d.pts[0].p)); if (yy != null) dist = Math.min(dist, Math.abs(y - yy)); }
      } else if (d.tipo === "retangulo" || d.tipo === "regua") {
        const [x1, y1] = P[0], [x2, y2] = P[1];
        const dentro = x >= Math.min(x1, x2) && x <= Math.max(x1, x2) && y >= Math.min(y1, y2) && y <= Math.max(y1, y2);
        dist = dentro ? 0 : 99;
      } else dist = distSeg(x, y, ...P[0], ...P[1]);
      if (dist < dmin) { dmin = dist; melhor = k; }
    });
    return melhor;
  }

  // ---------------------------------------------------------------- desenho no canvas
  function ajustarTamanho() {
    const dpr = window.devicePixelRatio || 1, w = area.clientWidth, h = area.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); cv.style.width = w + "px"; cv.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); sujo++;
    }
  }
  const txtPreco = (p) => RK.fmt(p);
  function rotulo(txt, x, y, cor, alinhar = "left") {
    ctx.font = "11px Segoe UI, system-ui"; ctx.textAlign = alinhar; ctx.textBaseline = "bottom";
    const w = ctx.measureText(txt).width, x0 = alinhar === "right" ? x - w : x;
    ctx.fillStyle = "rgba(13,16,22,.75)"; ctx.fillRect(x0 - 3, y - 14, w + 6, 14);
    ctx.fillStyle = cor; ctx.fillText(txt, x, y - 1);
  }
  function desenharUm(d, temp) {
    const P = d.pts.map((q) => [xDe(q.t), yDe(q.p)]);
    if (P.some(([a, b]) => a == null || b == null)) return;
    const Wp = RK.chart.timeScale().width();
    ctx.strokeStyle = d.cor; ctx.fillStyle = d.cor; ctx.lineWidth = d.esp; ctx.setLineDash(temp ? [5, 4] : []);
    ctx.beginPath();
    switch (d.tipo) {
      case "tendencia": ctx.moveTo(...P[0]); ctx.lineTo(...P[1]); ctx.stroke(); break;
      case "horizontal": ctx.moveTo(0, P[0][1]); ctx.lineTo(Wp, P[0][1]); ctx.stroke(); rotulo(txtPreco(d.pts[0].p), Wp - 4, P[0][1], d.cor, "right"); break;
      case "vertical": ctx.moveTo(P[0][0], 0); ctx.lineTo(P[0][0], cv.clientHeight); ctx.stroke(); break;
      case "retangulo": {
        const x = Math.min(P[0][0], P[1][0]), y = Math.min(P[0][1], P[1][1]), w = Math.abs(P[1][0] - P[0][0]), h = Math.abs(P[1][1] - P[0][1]);
        ctx.globalAlpha = 0.12; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1; ctx.strokeRect(x, y, w, h); break;
      }
      case "pincel": ctx.lineJoin = "round"; ctx.lineCap = "round"; P.forEach((q, j) => (j ? ctx.lineTo(...q) : ctx.moveTo(...q))); ctx.stroke(); break;
      case "texto": ctx.font = `${10 + d.esp * 2}px Segoe UI, system-ui`; ctx.textAlign = "left"; ctx.textBaseline = "middle"; ctx.fillText(d.texto || "", P[0][0] + 4, P[0][1]); break;
      case "fibo": {
        const a = d.pts[0].p, b = d.pts[1].p, x0 = Math.min(P[0][0], P[1][0]);
        const y50 = yDe(b - 0.5 * (b - a)), y618 = yDe(b - 0.618 * (b - a));
        if (y50 != null && y618 != null) { ctx.fillStyle = "rgba(255,215,0,.08)"; ctx.fillRect(x0, Math.min(y50, y618), Wp - x0, Math.abs(y618 - y50)); }
        ctx.setLineDash([]);
        ctx.strokeStyle = "rgba(154,165,181,.5)"; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(...P[0]); ctx.lineTo(...P[1]); ctx.stroke();
        for (const [r, nome] of FIBO) {
          const pr = b - r * (b - a), y = yDe(pr); if (y == null) continue;
          const cor = COR_FIBO[String(r)] || d.cor;
          ctx.strokeStyle = cor; ctx.lineWidth = r === 0.618 || r === 0.5 ? 2 : 1; ctx.setLineDash(r < 0 ? [4, 3] : []);
          ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(Wp, y); ctx.stroke();
          rotulo(`${nome}  ${txtPreco(pr)}`, x0 + 2, y, cor);
        }
        break;
      }
      case "regua": {
        const [x1, y1] = P[0], [x2, y2] = P[1], dp = d.pts[1].p - d.pts[0].p, sobe = dp >= 0;
        ctx.globalAlpha = 0.15; ctx.fillStyle = sobe ? "#00e676" : "#ff3b4e";
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1)); ctx.globalAlpha = 1;
        ctx.strokeStyle = sobe ? "#00e676" : "#ff3b4e"; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        const barras = Math.round(idxDoTempo(d.pts[1].t) - idxDoTempo(d.pts[0].t));
        const pct = (dp / d.pts[0].p) * 100, vpr = RK.valorPontoR();
        const txt = `${dp >= 0 ? "+" : ""}${RK.fmt(dp)} pts · ${pct >= 0 ? "+" : ""}${pct.toFixed(2).replace(".", ",")}% · ${barras} candles · ${RK.reais(Math.abs(dp) * vpr)}/contr.`;
        rotulo(txt, Math.max(x1, x2) + 6, Math.min(y1, y2) + 16, sobe ? "#00e676" : "#ff3b4e");
        break;
      }
    }
    ctx.setLineDash([]);
    if (ferramenta === "cursor" && !temp && d.tipo !== "pincel" && d.tipo !== "texto")
      for (const q of P) { ctx.fillStyle = "#0d1016"; ctx.strokeStyle = d.cor; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(q[0], q[1], 3, 0, 7); ctx.fill(); ctx.stroke(); }
  }
  function redesenhar() {
    ctx.clearRect(0, 0, cv.clientWidth, cv.clientHeight);
    if (!RK.D) return;
    const Wp = RK.chart.timeScale().width(), Hp = cv.clientHeight - RK.chart.timeScale().height();
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, Wp, Hp); ctx.clip();
    for (const d of desenhos) desenharUm(d, false);
    if (preview) desenharUm(Object.assign({ tipo: ferramenta, pts: preview }, estilo()), true);
    if (pincel && pincel.length > 1) desenharUm(Object.assign({ tipo: "pincel", pts: pincel }, estilo()), true);
    ctx.restore();
  }
  // redesenha só quando algo mudou (zoom, rolagem, escala, tamanho ou os próprios desenhos)
  function laco() {
    ajustarTamanho();
    if (RK.D) {
      const f = RK.chart.timeScale().getVisibleLogicalRange(), ref = RK.D.c[RK.i];
      const sig = [f && f.from, f && f.to, yDe(ref), yDe(ref * 1.01), cv.width, cv.height, sujo, RK.i].join("|");
      if (sig !== assinatura) { assinatura = sig; redesenhar(); }
    }
    requestAnimationFrame(laco);
  }
  RK.on("carregado", carregar);
  requestAnimationFrame(laco);
})();
