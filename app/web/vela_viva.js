/* ROBÔ APEX: candle que "se forma" na tela no replay, como no mercado: abre, anda até um extremo, volta, vai ao outro
   e fecha. O caminho é sempre o mesmo para o mesmo candle (não muda a cada vez que se assiste) e respeita a máxima, a
   mínima e o fechamento reais: o que muda é só a animação de dentro do candle, nunca o candle.
   AX.formarCandle(D, i, ms, aoFim) -> função que cancela */
(() => {
  "use strict";
  const AX = window.AX;
  function sorteio(semente) {                       // número "aleatório" fixo para o mesmo candle
    let x = (semente ^ 0x9e3779b9) >>> 0;
    return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
  }
  // caminho do preço dentro do candle: lista de [fração do tempo, preço]
  function caminho(D, i) {
    const o = D.o[i], h = D.h[i], l = D.l[i], c = D.c[i], r = sorteio(D.t[i]);
    const sobe = c >= o;
    // quem vem primeiro: num candle de alta, normalmente a mínima; num de baixa, a máxima
    const ext = sobe ? [l, h] : [h, l];
    const pontos = [[0, o]];
    const marcos = [[0.22 + r() * 0.18, ext[0]], [0.58 + r() * 0.2, ext[1]], [1, c]];
    let t0 = 0, p0 = o;
    for (const [t1, p1] of marcos) {
      const n = 3 + Math.floor(r() * 3);
      for (let k = 1; k < n; k++) {             // vai e volta no meio do caminho, sem passar da máxima e da mínima
        const f = k / n, base = p0 + (p1 - p0) * f, amp = Math.abs(p1 - p0) * 0.28 + (h - l) * 0.04;
        pontos.push([t0 + (t1 - t0) * f, Math.max(l, Math.min(h, base + (r() - 0.5) * amp))]);
      }
      pontos.push([t1, p1]); t0 = t1; p0 = p1;
    }
    return pontos;
  }
  function formarCandle(D, i, ms, aoFim) {
    const pts = caminho(D, i), o = D.o[i], dec = D.meta.decimais, arred = (v) => +v.toFixed(dec + 1);
    let alto = o, baixo = o, ini = null, quadro = null, parado = false;
    const pintar = (preco) => {
      alto = Math.max(alto, preco); baixo = Math.min(baixo, preco);
      try { AX.S.candle.update({ time: D.t[i], open: o, high: arred(alto), low: arred(baixo), close: arred(preco) }); } catch (e) { /* gráfico trocado */ }
    };
    const passo = (agora) => {
      if (parado) return;
      if (ini == null) ini = agora;
      const f = Math.min(1, (agora - ini) / Math.max(1, ms));
      let k = 1; while (k < pts.length - 1 && pts[k][0] < f) k++;
      const [ta, pa] = pts[k - 1], [tb, pb] = pts[k];
      pintar(pa + (pb - pa) * ((f - ta) / Math.max(1e-6, tb - ta)));
      if (f >= 1) { parado = true; if (aoFim) aoFim(); return; }
      quadro = requestAnimationFrame(passo);
    };
    if (ms < 60) { if (aoFim) setTimeout(aoFim, 0); return () => {}; }
    quadro = requestAnimationFrame(passo);
    return () => { parado = true; cancelAnimationFrame(quadro); };
  }
  AX.formarCandle = formarCandle;
})();
