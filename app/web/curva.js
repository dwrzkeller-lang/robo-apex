/* ROBÔ APEX: curva do resultado acumulado, no estilo do Profit: acima do zero fica verde, abaixo do zero fica vermelho.
   AX.curvaPL(canvas, pontos, opcoes)
     pontos: [{ x: rótulo do eixo, v: acumulado, d: resultado daquele ponto, n: operações, dica: texto extra }]
     opcoes: { moeda, rotulo: "dia" | "operação" }
   Passar o mouse mostra a linha vertical, o dia, o resultado do dia e o acumulado. */
(() => {
  "use strict";
  const AX = window.AX;
  const VERDE = "#22e39a", VERM = "#ff5c6e", GRADE = "rgba(148, 163, 184, .10)", ZERO = "rgba(148, 163, 184, .45)", TXT = "#8b9bb4";

  function curvaPL(cv, pontos, op = {}) {
    if (!cv) return;
    const din = (v) => AX.dinheiro(v, { meta: { moeda: op.moeda || "R$" } }, true);
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W || !H) return;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
    const c = cv.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.clearRect(0, 0, W, H);
    const pts = [{ x: "início", v: 0, d: 0, n: 0 }].concat(pontos || []);
    const esq = 78, dir = 12, cima = 10, baixo = 22, w = W - esq - dir, h = H - cima - baixo;
    if (pts.length < 2 || w < 40) {
      c.fillStyle = TXT; c.font = "12px system-ui, sans-serif"; c.textAlign = "center";
      c.fillText("sem operações no período", W / 2, H / 2);
      cv.onmousemove = null; return;
    }
    let mn = Math.min(0, ...pts.map((p) => p.v)), mx = Math.max(0, ...pts.map((p) => p.v));
    const folga = (mx - mn || 1) * 0.08; mn -= mn < 0 ? folga : 0; mx += folga;
    const X = (i) => esq + (i * w) / (pts.length - 1), Y = (v) => cima + ((mx - v) * h) / (mx - mn), y0 = Y(0);

    // grade e valores do eixo
    c.font = "11px system-ui, sans-serif"; c.textAlign = "right"; c.textBaseline = "middle";
    const marcas = [mx - folga, (mx - folga + mn) / 2, mn].filter((v, i, a) => a.findIndex((z) => Math.abs(z - v) < (mx - mn) * 0.12) === i);
    for (const v of marcas) {
      if (Math.abs(Y(v) - y0) < 12) continue;
      c.strokeStyle = GRADE; c.lineWidth = 1; c.beginPath(); c.moveTo(esq, Math.round(Y(v)) + 0.5); c.lineTo(W - dir, Math.round(Y(v)) + 0.5); c.stroke();
      c.fillStyle = TXT; c.fillText(din(v), esq - 8, Y(v));
    }
    c.fillStyle = "#c7d2e3"; c.fillText(din(0).replace(/^[+−-]/, ""), esq - 8, y0);

    // área: o mesmo desenho recortado acima (verde) e abaixo (vermelho) do zero
    const caminho = () => { c.beginPath(); pts.forEach((p, i) => (i ? c.lineTo(X(i), Y(p.v)) : c.moveTo(X(i), Y(p.v)))); };
    for (const [cor, de, ate] of [[VERDE, cima - 2, y0], [VERM, y0, cima + h + 2]]) {
      c.save(); c.beginPath(); c.rect(esq, de, w + 1, ate - de); c.clip();
      const g = c.createLinearGradient(0, cor === VERDE ? cima : y0, 0, cor === VERDE ? y0 : cima + h);
      g.addColorStop(0, cor === VERDE ? "rgba(34, 227, 154, .34)" : "rgba(255, 92, 110, .06)");
      g.addColorStop(1, cor === VERDE ? "rgba(34, 227, 154, .04)" : "rgba(255, 92, 110, .34)");
      caminho(); c.lineTo(X(pts.length - 1), y0); c.lineTo(X(0), y0); c.closePath(); c.fillStyle = g; c.fill();
      caminho(); c.lineJoin = "round"; c.lineCap = "round"; c.lineWidth = 2.2; c.strokeStyle = cor; c.stroke();
      c.restore();
    }
    // linha do zero
    c.strokeStyle = ZERO; c.lineWidth = 1; c.setLineDash([4, 4]);
    c.beginPath(); c.moveTo(esq, Math.round(y0) + 0.5); c.lineTo(W - dir, Math.round(y0) + 0.5); c.stroke(); c.setLineDash([]);

    // datas embaixo (no máximo 7)
    c.textAlign = "center"; c.textBaseline = "alphabetic"; c.fillStyle = TXT;
    const nRot = Math.min(7, pts.length - 1), usados = new Set();
    for (let k = 0; k <= nRot; k++) {
      const i = Math.round(1 + (k * (pts.length - 2)) / Math.max(1, nRot));
      if (i < 1 || i >= pts.length || usados.has(pts[i].x)) continue;
      usados.add(pts[i].x);
      c.fillText(pts[i].x, Math.max(esq + 16, Math.min(W - dir - 16, X(i))), H - 6);
    }
    // ponto final
    const ult = pts.length - 1, corFim = pts[ult].v >= 0 ? VERDE : VERM;
    c.beginPath(); c.arc(X(ult), Y(pts[ult].v), 4.5, 0, 7); c.fillStyle = corFim; c.fill(); c.lineWidth = 2; c.strokeStyle = "#0b111c"; c.stroke();

    // passar o mouse: linha vertical + dica
    const base = c.getImageData(0, 0, cv.width, cv.height);
    cv.onmouseleave = () => { c.putImageData(base, 0, 0); };
    cv.onmousemove = (e) => {
      const r = cv.getBoundingClientRect(), i = Math.max(1, Math.min(ult, Math.round(((e.clientX - r.left - esq) * ult) / w)));
      c.putImageData(base, 0, 0);
      c.strokeStyle = "rgba(226, 232, 240, .35)"; c.lineWidth = 1;
      c.beginPath(); c.moveTo(Math.round(X(i)) + 0.5, cima); c.lineTo(Math.round(X(i)) + 0.5, cima + h); c.stroke();
      c.beginPath(); c.arc(X(i), Y(pts[i].v), 4, 0, 7); c.fillStyle = pts[i].v >= 0 ? VERDE : VERM; c.fill();
      const p = pts[i];
      cv.dataset.dica = `${p.x}${p.dica ? " · " + p.dica : ""}: ${op.rotulo === "operação" ? "operação" : "no dia"} ${din(p.d)}${p.n ? ` (${p.n} op${p.n > 1 ? "s" : ""})` : ""} · acumulado ${din(p.v)}`;
    };
  }
  AX.curvaPL = curvaPL;
})();
