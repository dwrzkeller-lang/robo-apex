/* ROBÔ APEX — VOLUME POR PREÇO: a "escadinha" de preços estilo Profit, por cima do lado direito do gráfico.
   Para cada faixa de preço mostra o volume negociado ali, a divisão estimada entre compra e venda, e quantas entradas
   das estratégias aconteceram naquela faixa (com o resultado). Destaca o POC (preço com mais volume), a área de valor
   de 70% (VAH/VAL) e os principais nós de volume abaixo (pontos de compra) e acima (pontos de venda) do preço atual.

   HONESTIDADE: tudo aqui é calculado a partir dos CANDLES. O volume de cada candle é espalhado por igual entre a mínima
   e a máxima dele; "compra" é o volume dos candles que fecharam em alta e "venda" o dos que fecharam em baixa. Isso é
   uma ESTIMATIVA: não é o livro de ofertas nem o times & trades (esses só com a conexão do Profit). Sem volume real no
   ativo, a conta vira "tempo no preço": quantos candles tocaram cada faixa.

   As contas ficam em AX.perfilCalc (funções puras, testáveis sem navegador); a tela vem depois. */
(() => {
  "use strict";
  const W = typeof window !== "undefined" ? window : globalThis;
  const AX = W.AX || (W.AX = {});
  const fin = Number.isFinite, EPS = 1e-9;

  // ================================================================ contas (puras)
  // menor múltiplo "redondo" do tick que é >= m: 1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50...
  const BASES = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8];
  function multBom(m) {
    m = Math.max(1, Math.ceil(m - EPS));
    for (let e = 1; e < 1e15; e *= 10) for (const b of BASES) { const x = b * e; if (x >= m && Number.isInteger(x)) return x; }
    return m;
  }
  // Faixas de preço para cobrir de lo a hi. Cada faixa é CENTRADA num múltiplo do passo (o rótulo da linha é o centro):
  // a faixa j vai de (base + j − ½) × passo até (base + j + ½) × passo. O passo é um múltiplo redondo do tick, escolhido
  // para dar perto de `alvo` linhas (padrão 36, o que resulta em ~24 a 40), nunca menor que `passoMin` nem mais que `max` linhas.
  function bins(lo, hi, tick, opt) {
    opt = opt || {};
    if (!fin(lo) || !fin(hi)) return null;
    if (hi < lo) { const x = lo; lo = hi; hi = x; }
    if (!(tick > 0) || !fin(tick)) tick = 0.01;
    const alvo = opt.alvo > 0 ? opt.alvo : 36, max = opt.max > 0 ? opt.max : 80;
    let m = multBom(Math.max((hi - lo) / tick / alvo, (opt.passoMin > 0 ? opt.passoMin : 0) / tick, 1));
    let passo, base, n;
    for (;;) {
      passo = m * tick; base = Math.round(lo / passo); n = Math.round(hi / passo) - base + 1;
      if (n <= max) break;
      m = multBom(m + 1);
    }
    return { passo, base, n, mult: m, tick, p0: base * passo };
  }
  const idx = (B, p) => Math.round(p / B.passo) - B.base;            // faixa em que o preço p cai (pode sair de 0..n−1)
  const centro = (B, j) => (B.base + j) * B.passo;                   // preço do meio da faixa j
  const limita = (v, a, b) => (v < a ? a : v > b ? b : v);

  // Perfil dos candles i0..i1 de D. modo "volume": o volume de cada candle é repartido por igual entre a mínima e a
  // máxima (a soma das faixas é exatamente o volume total). modo "tempo": cada candle soma 1 em cada faixa que tocou.
  // Compra/venda: o candle inteiro vai para "compra" se fechou em alta (fechamento >= abertura), senão para "venda".
  function perfil(D, i0, i1, opt) {
    opt = opt || {};
    if (!D || !D.h || !D.l || !D.h.length) return null;
    i0 = Math.max(0, Math.floor(i0)); i1 = Math.min(D.h.length - 1, Math.floor(i1));
    if (!(i1 >= i0)) return null;
    const meta = D.meta || {}, temV = !!meta.temVolume && !!D.v;
    let lo = Infinity, hi = -Infinity, somaV = 0;
    for (let i = i0; i <= i1; i++) {
      const h = D.h[i], l = D.l[i];
      if (!fin(h) || !fin(l)) continue;
      if (l < lo) lo = l; if (h < lo) lo = h; if (h > hi) hi = h; if (l > hi) hi = l;
      if (temV && D.v[i] > 0) somaV += D.v[i];
    }
    if (!fin(lo) || !fin(hi)) return null;
    const modo = opt.modo === "volume" || opt.modo === "tempo" ? opt.modo : (temV && somaV > 0 ? "volume" : "tempo");
    const tick = opt.tick > 0 ? opt.tick : meta.tick > 0 ? meta.tick : Math.pow(10, -(meta.decimais >= 0 ? meta.decimais : 2));
    const B = bins(lo, hi, tick, opt);
    if (!B) return null;
    const n = B.n, vol = new Float64Array(n), compra = new Float64Array(n), venda = new Float64Array(n), toques = new Int32Array(n);
    let total = 0, candles = 0;
    for (let i = i0; i <= i1; i++) {
      let h = D.h[i], l = D.l[i];
      if (!fin(h) || !fin(l)) continue;
      if (h < l) { const x = h; h = l; l = x; }
      const w = modo === "volume" ? (D.v[i] > 0 ? D.v[i] : 0) : 1;
      const lado = D.c[i] >= D.o[i] ? compra : venda;
      const a = limita(idx(B, l), 0, n - 1);
      let b = limita(idx(B, h), 0, n - 1);
      if (b > a && h - (B.base + b - 0.5) * B.passo <= EPS * B.passo) b--;       // a máxima só encosta na borda de baixo da faixa: não conta
      candles++;
      for (let j = a; j <= b; j++) toques[j]++;
      if (modo === "tempo") { for (let j = a; j <= b; j++) { vol[j] += 1; lado[j] += 1; } total += b - a + 1; continue; }
      if (!w) continue;
      total += w;
      if (a === b || !(h > l)) { vol[a] += w; lado[a] += w; continue; }
      let dado = 0;
      for (let j = a; j < b; j++) {
        const e0 = (B.base + j - 0.5) * B.passo, parte = Math.max(0, Math.min(h, e0 + B.passo) - Math.max(l, e0)) / (h - l) * w;
        vol[j] += parte; lado[j] += parte; dado += parte;
      }
      const resto = Math.max(0, w - dado);                                       // a última faixa leva o que sobrou: nada se perde no arredondamento
      vol[b] += resto; lado[b] += resto;
    }
    let max = 0;
    for (let j = 0; j < n; j++) if (vol[j] > max) max = vol[j];
    return { passo: B.passo, base: B.base, n, mult: B.mult, tick: B.tick, p0: B.p0, vol, compra, venda, toques, total, max, modo, lo, hi, i0, i1, candles };
  }

  // POC (faixa com mais volume) e área de valor: a partir do POC, vai juntando a faixa vizinha mais forte (de cima ou
  // de baixo) até reunir pelo menos `frac` (70%) do total. Devolve os ÍNDICES: { poc, val, vah, dentro, total, frac }.
  function areaDeValor(vals, frac) {
    const n = vals ? vals.length : 0;
    if (!n) return null;
    frac = frac > 0 && frac <= 1 ? frac : 0.7;
    let total = 0, poc = 0;
    const meio = (n - 1) / 2;
    for (let j = 0; j < n; j++) {
      total += vals[j];
      if (vals[j] > vals[poc] || (vals[j] === vals[poc] && Math.abs(j - meio) < Math.abs(poc - meio))) poc = j;       // empate: o mais perto do meio
    }
    if (!(total > 0)) return null;
    let a = poc, b = poc, dentro = vals[poc];
    const meta = frac * total;
    while (dentro < meta - EPS * total && (a > 0 || b < n - 1)) {
      const cima = b < n - 1 ? vals[b + 1] : -1, baixo = a > 0 ? vals[a - 1] : -1;
      if (cima >= baixo) { b++; dentro += cima; } else { a--; dentro += baixo; }
    }
    return { poc, val: a, vah: b, dentro, total, frac: dentro / total };
  }

  // Nós de volume: picos locais (maior que as `raio` faixas de cada lado) com pelo menos `min` × o maior valor.
  // Devolve [{ i, v }] do mais forte para o mais fraco.
  function nos(vals, opt) {
    opt = opt || {};
    const n = vals ? vals.length : 0, raio = opt.raio > 0 ? opt.raio : 2, min = opt.min >= 0 ? opt.min : 0.2, lim = opt.max > 0 ? opt.max : 12;
    let max = 0;
    for (let j = 0; j < n; j++) if (vals[j] > max) max = vals[j];
    const r = [];
    if (!(max > 0)) return r;
    for (let j = 0; j < n; j++) {
      const v = vals[j];
      if (!(v > 0) || v < min * max) continue;
      let pico = true;
      for (let d = 1; d <= raio && pico; d++) {
        if (j - d >= 0 && vals[j - d] >= v) pico = false;          // num platô vale só a primeira faixa
        if (j + d < n && vals[j + d] > v) pico = false;
      }
      if (pico) r.push({ i: j, v });
    }
    r.sort((x, y) => y.v - x.v || x.i - y.i);
    return r.slice(0, lim);
  }

  // Principais pontos em relação ao preço atual: nós ABAIXO = candidatos a suporte ("compra"); ACIMA = candidatos a
  // resistência ("venda"). Até `quantos` de cada, com a distância em pontos e em %.
  function pontos(P, preco, quantos) {
    const r = { compra: [], venda: [], iAtual: null };
    if (!P || !fin(preco)) return r;
    quantos = quantos > 0 ? quantos : 3;
    r.iAtual = idx(P, preco);
    for (const no of nos(P.vol)) {
      const lista = no.i < r.iAtual ? r.compra : no.i > r.iAtual ? r.venda : null;
      if (!lista || lista.length >= quantos) continue;
      const p = centro(P, no.i);
      lista.push({ i: no.i, v: no.v, p, dist: p - preco, pct: preco ? ((p - preco) / preco) * 100 : null });
    }
    return r;
  }

  // Entradas das estratégias por faixa: operações com entrada entre os candles i0 e i1 (e as abertas). `k` = último
  // candle mostrado: operação que ainda não saiu até k conta como aberta (no replay o resultado ainda não é conhecido).
  // por[j] = null ou { c, v, g, p, z, ab, R } (compras, vendas, ganhos, perdas, zero a zero, abertas, soma de R).
  function entradas(trades, abertas, B, i0, i1, k) {
    const r = { por: new Array(B ? B.n : 0).fill(null), total: 0, fora: 0 };
    if (!B) return r;
    if (k == null) k = Infinity;
    const soma = (t, aberta) => {
      if (!t || !fin(t.ent) || !(t.i_ent >= i0 && t.i_ent <= i1) || t.i_ent > k) return;
      const j = idx(B, t.ent);
      if (j < 0 || j >= B.n) { r.fora++; return; }
      const e = r.por[j] || (r.por[j] = { c: 0, v: 0, g: 0, p: 0, z: 0, ab: 0, R: 0 });
      if (t.dir > 0) e.c++; else e.v++;
      r.total++;
      if (aberta || !(t.i_sai <= k) || !fin(t.R)) { e.ab++; return; }
      e.R += t.R;
      if (t.R > 0) e.g++; else if (t.R < 0) e.p++; else e.z++;
    };
    for (const t of trades || []) soma(t, false);
    for (const a of abertas || []) soma(a, true);
    return r;
  }

  AX.perfilCalc = { bins, perfil, areaDeValor, nos, pontos, entradas, idx, centro, multBom };

  // ================================================================ tela
  if (typeof document === "undefined") return;
  const $ = (id) => document.getElementById(id);
  const esc = AX.esc || ((s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])));
  const q = (t) => (AX.q ? AX.q(t) : `<i class="q" data-dica="${esc(t)}"></i>`);
  const fmt = (v, d) => (AX.fmt ? AX.fmt(v, d) : String(v));
  const num = (v, d) => (AX.num ? AX.num(v, d) : String(v));
  const MODOS = { tela: "tela", periodo: "período", hoje: "hoje" };
  const ALT_MIN = 18;                 // altura mínima (px) de uma linha alinhada ao gráfico: abaixo disso o texto não cabe
  const ALT_TEXTO = 15;
  const COR_POC = "#ffd23f", COR_VA = "#7cc0ff";
  const DICA_BOTAO = "Volume por preço: abre a escadinha de preços com o volume negociado em cada faixa, a estimativa de compra e venda, o POC, a área de valor e quantas entradas das estratégias aconteceram em cada preço.";

  let el = null, corpo = null, bt = null, pronto = false, rodando = false;
  let R = null;                       // último resultado: { D, P, A, pts, ent, k, preco, modo, dec }
  let sigTela = "", sigConta = "", versao = 0, sujo = 0, ultD = null, ultErro = "", lista = false, linhas = [];
  let dirPx = -1, basePx = -1, largPx = 244;

  let prefOk = null;
  function prefs() {
    if (!AX.pref) AX.pref = {};
    if (prefOk && AX.pref.perfil === prefOk) return prefOk;          // valida uma vez só; depois é o mesmo objeto
    const p = AX.pref.perfil && typeof AX.pref.perfil === "object" ? AX.pref.perfil : {};
    AX.pref.perfil = { aberto: !!p.aberto, modo: p.modo in MODOS ? p.modo : "tela", resumo: p.resumo !== false };
    return (prefOk = AX.pref.perfil);
  }
  const salvar = () => { if (AX.salvarPref) AX.salvarPref(); };
  const dados = () => { const D = (AX.graficoMostra && AX.graficoMostra()) || AX.D; return D && D.t && D.t.length && D.meta ? D : null; };

  // números curtos para a coluna: 12,4k · 1,2M · 3,4B (o valor inteiro vai na dica da linha)
  function curto(v, modo) {
    if (!fin(v)) return "—";
    if (modo === "tempo") return num(v, 0);
    const a = Math.abs(v);
    if (a >= 1e9) return num(v / 1e9, 1) + "B";
    if (a >= 1e6) return num(v / 1e6, 1) + "M";
    if (a >= 1e4) return num(v / 1e3, a < 1e5 ? 1 : 0) + "k";
    return num(v, a < 10 && a % 1 ? 2 : 0);
  }
  const inteiro = (v, modo) => (modo === "tempo" ? num(v, 0) : num(v, Math.abs(v) < 10 && v % 1 ? 2 : 0));
  const sinal = (v, txt) => (v > 0 ? "+" : v < 0 ? "−" : "") + txt;
  const Rtxt = (v) => (AX.R ? AX.R(v, 1) : sinal(v, num(Math.abs(v), 1) + "R"));

  // ---------------------------------------------------------------- trecho de candles conforme o modo
  function diaDe(D, i) { return D.d ? D.d[i] : Math.floor(D.t[i] / 86400); }
  function trecho(D, k, modo) {
    if (modo === "periodo") {
      const a = D.meta.iIni >= 0 ? D.meta.iIni : 0, b = D.meta.iFim >= 0 ? Math.min(D.meta.iFim, k) : k;
      return b >= a ? [a, b] : [0, k];
    }
    if (modo === "hoje") {
      const dia = diaDe(D, k);
      let a = k; while (a > 0 && diaDe(D, a - 1) === dia) a--;
      return [a, k];
    }
    const f = AX.chart.timeScale().getVisibleLogicalRange();
    if (!f) return null;
    const a = Math.max(0, Math.ceil(f.from)), b = Math.min(k, Math.floor(f.to));
    return b >= a ? [a, b] : null;
  }
  const modoValido = (D) => { const m = prefs().modo; return m === "hoje" && !D.meta.intraday ? "tela" : m; };

  // ---------------------------------------------------------------- montar a estrutura (uma vez)
  function montar() {
    if (pronto) return true;
    const area = $("areaGrafico");
    el = $("perfil");
    if (!el) { if (!area) return false; el = document.createElement("div"); el.id = "perfil"; el.className = "perfil oculto"; area.appendChild(el); }
    el.classList.add("perfil");
    el.setAttribute("role", "complementary"); el.setAttribute("aria-label", "Volume por preço");
    el.innerHTML = `
      <div class="pf-cab">
        <div class="pf-tit"><b>VOLUME POR PREÇO</b>${q("Mostra QUANTO foi negociado em cada faixa de preço do trecho escolhido. Barra comprida = muito negócio ali (o preço costuma respeitar essas regiões); barra curta = o preço passou rápido. POC é a faixa com mais volume. Área de valor é o miolo que concentra 70% do volume (VAH = topo, VAL = fundo). IMPORTANTE: é uma estimativa feita com os candles: o volume de cada candle é espalhado por igual entre a mínima e a máxima dele, e conta como compra se o candle fechou em alta e como venda se fechou em baixa. Não é o livro de ofertas nem o times & trades; esses só existem com a conexão do Profit.")}
          <button type="button" class="pf-x" id="pfFechar" aria-label="Fechar o volume por preço" data-dica="Fechar. O botão Volume por preço, no alto do gráfico, abre de novo.">×</button></div>
        <div class="pf-op">
          <div class="seg mini" id="pfModo" role="group" aria-label="Trecho usado na conta">
            <button type="button" data-m="tela" data-dica="Tela: usa só os candles que estão aparecendo no gráfico agora. Muda quando você rola ou dá zoom.">tela</button>
            <button type="button" data-m="periodo" data-dica="Período: usa todos os candles do período escolhido no topo da tela.">período</button>
            <button type="button" data-m="hoje" data-dica="Hoje: usa só os candles do dia do último candle mostrado.">hoje</button>
          </div>
          <button type="button" class="pf-mini" id="pfResumo" aria-expanded="true" data-dica="Mostra ou esconde o resumo com o POC, a área de valor e os principais pontos de compra e de venda. Escondido, sobra mais espaço para as linhas de preço.">resumo</button>
        </div>
        <div class="pf-sub" id="pfSub"></div>
      </div>
      <div class="pf-resumo" id="pfRes"></div>
      <div class="pf-colunas" aria-hidden="true"><span></span><span>preço</span><span></span><span>vol.</span><span>C/V</span><span>entr.</span></div>
      <div class="pf-corpo" id="pfCorpo"></div>
      <div class="pf-pe">
        <div class="pf-leg">
          <span data-dica="C = compra estimada: volume dos candles que fecharam em alta (fechamento maior ou igual à abertura)."><i class="pf-c"></i>C compra</span>
          <span data-dica="V = venda estimada: volume dos candles que fecharam em baixa."><i class="pf-v"></i>V venda</span>
          <span data-dica="POC: a faixa de preço com mais volume do trecho. A linha amarela no gráfico marca o mesmo preço."><i class="pf-poc"></i>POC</span>
          <span data-dica="Área de valor: as faixas em volta do POC que juntas concentram 70% do volume. VAH é o topo e VAL o fundo dela (linhas azuis tracejadas no gráfico)."><i class="pf-va"></i>área 70%</span>
        </div>
        <div class="pf-nota">Estimativa pelos candles. Não é o livro de ofertas nem o times &amp; trades.</div>
      </div>`;
    corpo = $("pfCorpo");
    $("pfFechar").onclick = () => abrir(false);
    $("pfModo").addEventListener("click", (e) => {
      const b = e.target.closest ? e.target.closest("button[data-m]") : null;
      if (!b || b.disabled) return;
      prefs().modo = b.dataset.m; salvar(); sujo++;
    });
    $("pfResumo").onclick = () => { const p = prefs(); p.resumo = !p.resumo; salvar(); sigConta = ""; sujo++; };
    if (W.ResizeObserver) new W.ResizeObserver(() => { sujo++; }).observe(corpo);
    pronto = true;
    return true;
  }

  function abrir(sim) {
    if (!montar()) return;
    const p = prefs();
    p.aberto = sim == null ? !p.aberto : !!sim; salvar();
    el.classList.toggle("oculto", !p.aberto);
    if (bt) { bt.classList.toggle("on", p.aberto); bt.setAttribute("aria-pressed", String(p.aberto)); }
    sigTela = ""; sigConta = "";
    if (p.aberto && !rodando) { rodando = true; requestAnimationFrame(laco); }
    if (!p.aberto) R = null;
    if (AX.redesenhar) AX.redesenhar();              // as linhas de POC/VAH/VAL aparecem e somem junto com o painel
  }

  // ---------------------------------------------------------------- textos
  function vazio(msg) {
    R = null; linhas = []; lista = false;
    corpo.classList.remove("pf-lista");
    corpo.innerHTML = `<div class="pf-vazio">${esc(msg)}</div>`;
    $("pfRes").innerHTML = ""; $("pfSub").textContent = "";
    if (AX.redesenhar) AX.redesenhar();
  }
  function dicaLinha(r, j) {
    const P = r.P, A = r.A, d = r.dec, c = centro(P, j), v = P.vol[j], e = r.ent.por[j];
    const t = [];
    t.push(P.mult > 1 || P.passo > P.tick * 1.5 ? `Faixa de ${fmt(c - P.passo / 2, d)} a ${fmt(c + P.passo / 2, d)} (meio ${fmt(c, d)}).` : `Preço ${fmt(c, d)}.`);
    if (P.modo === "volume") t.push(`Volume estimado: ${inteiro(v, "volume")} (${num(P.total ? (v / P.total) * 100 : 0, 1)}% do trecho), em ${P.toques[j]} candle${P.toques[j] === 1 ? "" : "s"}.`);
    else t.push(`Tempo no preço: ${P.toques[j]} candle${P.toques[j] === 1 ? "" : "s"} tocaram esta faixa (este ativo não tem volume real).`);
    if (v > 0) t.push(`Estimativa pelos candles: C compra ${num((P.compra[j] / v) * 100, 0)}% · V venda ${num((P.venda[j] / v) * 100, 0)}%.`);
    if (e) {
      const n = e.c + e.v, fech = e.g + e.p + e.z;
      let s = `Entradas das estratégias nesta faixa: ${n} (${e.c} de compra, ${e.v} de venda)`;
      if (fech) s += `; resultado: ${e.g} ganho${e.g === 1 ? "" : "s"}, ${e.p} perda${e.p === 1 ? "" : "s"}${e.z ? `, ${e.z} no zero` : ""}, soma ${Rtxt(e.R)}`;
      if (e.ab) s += `; ${e.ab} ainda aberta${e.ab === 1 ? "" : "s"}`;
      t.push(s + ".");
    } else t.push("Nenhuma entrada das estratégias nesta faixa.");
    if (j === A.poc) t.push("POC: a faixa com mais volume do trecho.");
    else if (j === A.vah) t.push("VAH: topo da área de valor (70% do volume).");
    else if (j === A.val) t.push("VAL: fundo da área de valor (70% do volume).");
    else if (j > A.val && j < A.vah) t.push("Dentro da área de valor.");
    const pc = r.pts.compra.findIndex((x) => x.i === j), pv = r.pts.venda.findIndex((x) => x.i === j);
    if (pc >= 0) t.push(`${pc + 1}º ponto de compra: nó de volume abaixo do preço, candidato a suporte (não é garantia).`);
    if (pv >= 0) t.push(`${pv + 1}º ponto de venda: nó de volume acima do preço, candidato a resistência (não é garantia).`);
    if (j === r.pts.iAtual) t.push(`O preço atual (${fmt(r.preco, d)}) está nesta faixa.`);
    return t.join(" ");
  }
  function htmlLinhas(r) {
    const P = r.P, A = r.A, d = r.dec, h = [];
    const tagC = new Map(r.pts.compra.map((x, i) => [x.i, i + 1])), tagV = new Map(r.pts.venda.map((x, i) => [x.i, i + 1]));
    for (let j = P.n - 1; j >= 0; j--) {
      const v = P.vol[j], e = r.ent.por[j], atual = j === r.pts.iAtual;
      const cls = ["pf-l"];
      if (j >= A.val && j <= A.vah) cls.push("pf-dentro");
      if (j === A.poc) cls.push("pf-epoc");
      if (atual) cls.push("pf-atual");
      let tag = "";
      if (atual) tag = '<span class="pf-tag pf-t-atual">agora</span>';
      else if (j === A.poc) tag = '<span class="pf-tag pf-t-poc">POC</span>';
      else if (j === A.vah) tag = '<span class="pf-tag pf-t-va">VAH</span>';
      else if (j === A.val) tag = '<span class="pf-tag pf-t-va">VAL</span>';
      else if (tagC.has(j)) tag = `<span class="pf-tag pf-t-c">C${tagC.get(j)}</span>`;
      else if (tagV.has(j)) tag = `<span class="pf-tag pf-t-v">V${tagV.get(j)}</span>`;
      else tag = '<span class="pf-tag"></span>';
      const lc = P.max > 0 ? (P.compra[j] / P.max) * 100 : 0, lv = P.max > 0 ? (P.venda[j] / P.max) * 100 : 0;
      let dom = "";
      if (v > 0) { const pc = (P.compra[j] / v) * 100; dom = pc >= 50 ? `<span class="pf-dom pf-tc">C${Math.round(pc)}</span>` : `<span class="pf-dom pf-tv">V${Math.round(100 - pc)}</span>`; }
      else dom = '<span class="pf-dom"></span>';
      let ent = "";
      if (e) {
        const fech = e.g + e.p + e.z, res = !fech ? "ab" : e.R > 0 ? "g" : e.R < 0 ? "p" : "z";
        ent = (e.c ? `<b class="pf-ec">${e.c}C</b>` : "") + (e.v ? `<b class="pf-ev">${e.v}V</b>` : "") + `<i class="pf-pt pf-r-${res}"></i>`;
      }
      h.push(`<div class="${cls.join(" ")}" data-j="${j}" data-dica="${esc(dicaLinha(r, j))}">${tag}<span class="pf-pr">${esc(fmt(centro(P, j), d))}</span>` +
        `<span class="pf-esp"></span><span class="pf-bar">${lc > 0 ? `<i class="pf-c" style="width:${lc.toFixed(2)}%"></i>` : ""}${lv > 0 ? `<i class="pf-v" style="width:${lv.toFixed(2)}%"></i>` : ""}</span>` +
        `<span class="pf-vol">${v > 0 ? esc(curto(v, P.modo)) : ""}</span>${dom}<span class="pf-ent">${ent}</span></div>`);
    }
    return h.join("");
  }
  function htmlResumo(r) {
    const P = r.P, A = r.A, d = r.dec;
    const nivel = (rot, j, cls, dica) => `<span class="${cls}" data-dica="${esc(dica)}"><em>${rot}</em> ${esc(fmt(centro(P, j), d))}</span>`;
    const o = [`<div class="pf-niveis">` +
      nivel("VAH", A.vah, "pf-n-va", "VAH: topo da área de valor. Acima dele o preço está 'caro' em relação a onde houve mais negócio neste trecho.") +
      nivel("POC", A.poc, "pf-n-poc", `POC: a faixa de preço com mais volume do trecho (${num(P.total ? (P.vol[A.poc] / P.total) * 100 : 0, 1)}% do total). Costuma funcionar como ímã do preço.`) +
      nivel("VAL", A.val, "pf-n-va", `VAL: fundo da área de valor. Entre VAL e VAH ficou ${num(A.frac * 100, 0)}% do volume do trecho.`) + `</div>`];
    const ponto = (x, i, letra, cls) => `<div class="pf-p" data-dica="${esc(`${i + 1}º ponto de ${letra === "C" ? "compra" : "venda"}: nó de volume em ${fmt(x.p, d)} (${curto(x.v, P.modo)} ${P.modo === "volume" ? "de volume" : "candles"}), ${letra === "C" ? "abaixo" : "acima"} do preço atual. Distância: ${fmt(Math.abs(x.dist), d)} pontos (${num(Math.abs(x.pct), 2)}%).`)}">` +
      `<span class="pf-tag ${cls}">${letra}${i + 1}</span><span class="pf-pr">${esc(fmt(x.p, d))}</span>` +
      `<span class="pf-dist">${esc(sinal(x.dist, fmt(Math.abs(x.dist), d)))} pts</span><span class="pf-pct">${esc(sinal(x.pct, num(Math.abs(x.pct), 2)))}%</span></div>`;
    o.push(`<div class="pf-rot">PONTOS DE VENDA <small>acima do preço</small>${q("Principais pontos de venda: as três faixas com mais volume ACIMA do preço atual. São candidatas a resistência, porque muita gente negociou ali. É um candidato, não uma ordem: o preço pode atravessar. Use junto com a estratégia, nunca sozinho.")}</div>`);
    o.push(r.pts.venda.length ? r.pts.venda.map((x, i) => ponto(x, i, "V", "pf-t-v")).join("") : '<div class="pf-nada">nenhum nó de volume acima do preço neste trecho</div>');
    o.push(`<div class="pf-agora" data-dica="Preço atual: o fechamento do último candle mostrado no gráfico."><span class="pf-tag pf-t-atual">agora</span><span class="pf-pr">${esc(fmt(r.preco, d))}</span><span class="pf-dist">preço atual</span></div>`);
    o.push(`<div class="pf-rot">PONTOS DE COMPRA <small>abaixo do preço</small>${q("Principais pontos de compra: as três faixas com mais volume ABAIXO do preço atual. São candidatas a suporte, porque muita gente negociou ali. É um candidato, não uma ordem: o preço pode atravessar. Use junto com a estratégia, nunca sozinho.")}</div>`);
    o.push(r.pts.compra.length ? r.pts.compra.map((x, i) => ponto(x, i, "C", "pf-t-c")).join("") : '<div class="pf-nada">nenhum nó de volume abaixo do preço neste trecho</div>');
    return o.join("");
  }
  function textoSub(r, D) {
    const P = r.P, n = P.i1 - P.i0 + 1;
    const onde = r.modo === "tela" ? "na tela" : r.modo === "periodo" ? "no período" : "hoje";
    const quando = AX.quando ? ` · ${AX.quando(D, P.i0)} a ${AX.quando(D, P.i1)}` : "";
    const base = `${num(n, 0)} candle${n === 1 ? "" : "s"} ${onde}${quando}`;
    const entr = r.ent.total ? ` · ${r.ent.total} entrada${r.ent.total === 1 ? "" : "s"}` : " · sem entradas";
    return (P.modo === "tempo" ? "SEM VOLUME REAL neste ativo: mostrando tempo no preço (candles que tocaram cada faixa). " : "") + base + entr;
  }

  // ---------------------------------------------------------------- conta + desenho das linhas
  function calcular(D, k, modo, t, passoMin) {
    const P = perfil(D, t[0], t[1], { passoMin });
    const A = P ? areaDeValor(P.vol, 0.7) : null;
    if (!P || !A) return null;
    const F = (AX.fonteOps ? AX.fonteOps(D) : D) || D;
    const abertas = k === D.meta.iFim ? F.abertas : [];                    // as abertas só existem no último candle do período (igual ao gráfico)
    const preco = D.c[k];
    return { D, P, A, k, preco, modo, dec: D.meta.decimais >= 0 ? D.meta.decimais : 2,
      pts: pontos(P, preco, 3), ent: entradas(F.trades, abertas, P, t[0], t[1], k) };
  }
  function pintar(r, D) {
    R = r;
    corpo.innerHTML = htmlLinhas(r);
    linhas = Array.prototype.slice.call(corpo.children);
    const p = prefs(), res = $("pfRes");
    res.classList.toggle("oculto", !p.resumo);
    res.innerHTML = p.resumo ? htmlResumo(r) : "";
    $("pfResumo").classList.toggle("on", p.resumo); $("pfResumo").setAttribute("aria-expanded", String(p.resumo));
    $("pfSub").textContent = textoSub(r, D);
    $("pfSub").classList.toggle("pf-aviso", r.P.modo === "tempo");
    el.classList.toggle("pf-tempo", r.P.modo === "tempo");
    if (AX.redesenhar) AX.redesenhar();
  }
  // põe cada linha na altura do preço dela no gráfico; se a escala não souber converter, vira uma lista com rolagem
  function alinhar(r) {
    const P = r.P, y = (p) => AX.S.candle.priceToCoordinate(p);
    const bordas = new Array(P.n + 1);
    let ok = true;
    for (let j = 0; j <= P.n; j++) { const v = y((P.base + j - 0.5) * P.passo); if (v == null || !fin(v)) { ok = false; break; } bordas[j] = v; }
    if (!ok) {
      if (!lista) { lista = true; corpo.classList.add("pf-lista"); for (const l of linhas) { l.style.top = ""; l.style.height = ""; l.style.display = ""; l.classList.remove("pf-fina"); } }
      return;
    }
    if (lista) { lista = false; corpo.classList.remove("pf-lista"); corpo.scrollTop = 0; }
    const chartEl = $("chart") || el.parentNode;
    const desl = corpo.getBoundingClientRect().top - chartEl.getBoundingClientRect().top, alt = corpo.clientHeight;
    largPx = el.offsetWidth || largPx;
    for (const l of linhas) {
      const j = +l.dataset.j, topo = Math.round(bordas[j + 1] - desl), base = Math.round(bordas[j] - desl), h = Math.max(1, base - topo);
      if (base < 0 || topo > alt) { if (l.style.display !== "none") l.style.display = "none"; continue; }
      l.style.display = ""; l.style.top = topo + "px"; l.style.height = h + "px";
      l.classList.toggle("pf-fina", h < ALT_TEXTO);
    }
  }
  function marcarModo(D) {
    const m = modoValido(D);
    for (const b of $("pfModo").children) {
      const on = b.dataset.m === m;
      if (b.classList.contains("on") !== on) b.classList.toggle("on", on);
      if (b.dataset.m === "hoje") b.disabled = !D.meta.intraday;
    }
    return m;
  }
  function bordasDoGrafico() {        // o painel fica colado na escala de preço e acima da escala de tempo
    let d = 62, b = 26;
    try { d = AX.chart.priceScale("right").width(); b = AX.chart.timeScale().height(); } catch (e) { /* gráfico ainda sem medida */ }
    if (d !== dirPx) { dirPx = d; el.style.right = d + "px"; }
    if (b !== basePx) { basePx = b; el.style.bottom = b + "px"; }
  }

  function quadro() {
    const D = dados();
    if (!D || !AX.chart || !AX.S || !AX.S.candle) { if (sigTela !== "-") { sigTela = "-"; sigConta = ""; vazio("Sem dados no gráfico."); } return; }
    if (D !== ultD) { ultD = D; versao++; }
    const k = Math.min(AX.i | 0, D.t.length - 1), ref = D.c[k];
    const f = AX.chart.timeScale().getVisibleLogicalRange(), ya = AX.S.candle.priceToCoordinate(ref), yb = AX.S.candle.priceToCoordinate(ref * 1.01);
    const p = prefs();
    const sig = (f ? f.from + "|" + f.to : "") + "|" + ya + "|" + yb + "|" + k + "|" + ref + "|" + versao + "|" + sujo + "|" + p.modo;
    if (sig === sigTela) return;
    sigTela = sig;
    bordasDoGrafico();
    const modo = marcarModo(D), t = trecho(D, k, modo);
    if (!t) { sigConta = ""; vazio(modo === "tela" ? "Nenhum candle na tela. Use ⌖ Centralizar." : "Sem candles neste trecho."); return; }
    // linhas com pelo menos ALT_MIN px: o passo mínimo vem da escala de preço atual, em degraus (múltiplos redondos do
    // tick), para a conta não ser refeita a cada quadro de um zoom vertical
    const tick = D.meta.tick > 0 ? D.meta.tick : Math.pow(10, -(D.meta.decimais >= 0 ? D.meta.decimais : 2));
    const pxp = ya != null && yb != null && ref ? Math.abs(yb - ya) / Math.abs(ref * 0.01) : 0;
    const multMin = pxp > 0 && fin(pxp) ? multBom(ALT_MIN / pxp / tick) : 1;
    const F = (AX.fonteOps ? AX.fonteOps(D) : D) || D, nt = F.trades ? F.trades.length : 0, ult = nt ? F.trades[nt - 1] : null;
    const sc = versao + "|" + modo + "|" + t[0] + "|" + t[1] + "|" + k + "|" + D.h[k] + "|" + D.l[k] + "|" + ref + "|" + (D.v ? D.v[k] : "") + "|" + multMin +
      "|" + nt + "|" + (ult ? ult.i_ent + ":" + ult.i_sai + ":" + ult.R : "") + "|" + (F.abertas ? F.abertas.length : 0) + "|" + p.resumo;
    if (sc !== sigConta) {
      sigConta = sc;
      const r = calcular(D, k, modo, t, multMin * tick);
      if (!r) { vazio("Sem dados suficientes neste trecho."); return; }
      pintar(r, D);
    }
    if (R) alinhar(R);
  }
  function laco() {
    if (!prefs().aberto || !el || el.classList.contains("oculto")) { rodando = false; return; }
    requestAnimationFrame(laco);                     // agenda antes: um erro num quadro não pode parar os seguintes
    try { quadro(); } catch (e) { const m = String((e && e.message) || e); if (m !== ultErro) { ultErro = m; console.error(e); } }
  }

  // ---------------------------------------------------------------- linhas de POC / VAH / VAL no gráfico
  if (AX.camadas) AX.camadas.push((ctx, u) => {
    const r = R;
    if (!r || !el || el.classList.contains("oculto") || r.D !== dados()) return;
    const P = r.P, A = r.A, fim = Math.max(40, u.W - largPx), ini = Math.max(0, Math.min(fim - 40, u.x(P.i0) ?? 0));
    const ocupados = [];
    const linha = (j, cor, traco, nome) => {
      const pr = centro(P, j), y = u.y(pr);
      if (y == null || y < 14 || y > u.H - 4) return;
      ctx.strokeStyle = cor; ctx.lineWidth = 1; ctx.setLineDash(traco);
      ctx.beginPath(); ctx.moveTo(ini, Math.round(y) + 0.5); ctx.lineTo(fim, Math.round(y) + 0.5); ctx.stroke(); ctx.setLineDash([]);
      if (ocupados.some((o) => Math.abs(o - y) < 12)) return;          // rótulo em cima de outro: fica só a linha
      ocupados.push(y);
      const txt = `${nome} ${fmt(pr, r.dec)}`;
      ctx.font = "10px Segoe UI, system-ui"; ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      const w = ctx.measureText(txt).width;
      ctx.fillStyle = "rgba(11,14,20,.8)"; ctx.fillRect(fim - w - 9, y - 13, w + 6, 12);
      ctx.fillStyle = cor; ctx.fillText(txt, fim - 6, y - 2);
    };
    linha(A.poc, COR_POC, [], "POC");
    if (A.vah !== A.poc) linha(A.vah, COR_VA, [5, 4], "VAH");
    if (A.val !== A.poc) linha(A.val, COR_VA, [5, 4], "VAL");
  });

  // ---------------------------------------------------------------- ligação com o resto da tela
  function iniciar() {
    bt = $("btPerfil");
    if (!montar()) return;
    if (bt) {
      if (!bt.getAttribute("data-dica")) bt.setAttribute("data-dica", DICA_BOTAO);
      bt.setAttribute("aria-pressed", "false");
      bt.addEventListener("click", () => abrir());
    }
    if (AX.on) for (const ev of ["dadosVivo", "carregado", "mudou", "aba"]) AX.on(ev, () => { versao++; });
    if (prefs().aberto) abrir(true);
  }
  AX.perfil = { abrir: () => abrir(true), fechar: () => abrir(false), alternar: () => abrir(), aberto: () => !!prefs().aberto,
    atualizar: () => { versao++; }, resultado: () => R };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", iniciar); else iniciar();
})();
