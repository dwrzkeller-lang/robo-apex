/* ROBÔ APEX: replay da entrada e "e se…".
   (1) REPLAY DA ENTRADA: toca uma operação da lista candle a candle, de antes do sinal até depois da saída, com as
       etapas escritas (antes do sinal, sinal, ordem armada, entrada, em andamento, saída) e velocidade de 0,5x a 16x.
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
    if (R.aberta || k < R.ix) return ["5 de 6", `Em andamento: ${AX.res((t.dir * (R.D.c[k] - t.ent)) / t.risco, AX.dinDeR(t, R.D.meta, (t.dir * (R.D.c[k] - t.ent)) / t.risco), R.D)} agora.`];
    return ["6 de 6", `SAÍDA a ${AX.fmt(t.sai)} (${t.motivo}): ${AX.res2(t.R, t.dinheiro, R.D)}.`];
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
    const i = R.k + 1, D = R.D;
    // o candle se forma devagar (abre, anda até os extremos e fecha); nos candles do sinal, da entrada e da saída segura mais
    const chave = i === R.is || i === R.ie || i === R.ix;
    R.cancelar = AX.formarCandle(D, i, R.vel >= 16 ? 0 : 2200 / R.vel, () => {
      if (!R.on || R.k !== i - 1) return;
      R.k = i; AX.avancar(i); AX.redesenhar(); pintarBarra();
      R.relogio = setTimeout(passo, (chave ? 1700 : 420) / R.vel);
    });
  }
  // um candle inteiro de uma vez (botão ▶| e pausa no meio da formação)
  function inteiro() { if (R.k < R.fim) { R.k++; AX.avancar(R.k); AX.redesenhar(); } }
  function comecar() {
    clearTimeout(R.relogio); if (R.cancelar) R.cancelar();
    const de = Math.max(0, R.is - 25);
    R.k = de; R.pausa = false;
    AX.mostrar(R.D, de, { manterZoom: true });
    AX.autoPreco();
    // a câmera é enquadrada só aqui; depois é do usuário (arrastar, zoom, desenhar) e o replay não puxa de volta
    AX.chart.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: false } });
    AX.chart.timeScale().setVisibleLogicalRange({ from: de - 8, to: R.fim + 12 });
    pintarBarra();
    R.relogio = setTimeout(passo, 900);
  }
  function fechar() {
    if (!R.on) return;
    clearTimeout(R.relogio); if (R.cancelar) R.cancelar(); R.on = false; AX.emReplay = false;
    AX.chart.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: true } });
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
        <span class="seg mini" data-dica="Velocidade: 1x = cada candle leva uns 2 segundos para se formar">${[0.5, 1, 2, 4, 8, 16].map((v) => `<button data-v="${v}">${String(v).replace(".", ",")}x</button>`).join("")}</span><button data-a="sair" data-dica="Fechar o replay e voltar ao vivo">✕ Fechar</button></span>`;
      $("areaGrafico").appendChild(barra);
      barra.addEventListener("click", (e) => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.v) { R.vel = +b.dataset.v; pintarBarra(); return; }
        const a = b.dataset.a;
        if (a === "sair") return fechar();
        if (a === "zero") return comecar();
        if (a === "um") { R.pausa = true; clearTimeout(R.relogio); if (R.cancelar) R.cancelar(); inteiro(); return pintarBarra(); }
        if (a === "pausa") {
          if (R.k >= R.fim) return comecar();
          R.pausa = !R.pausa; clearTimeout(R.relogio); if (R.pausa && R.cancelar) R.cancelar(); if (R.pausa && AX.i === R.k && AX.S.candle.data && AX.S.candle.data().length > R.k + 1) inteiro(); pintarBarra(); if (!R.pausa) passo();
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
  // As edições ficam guardadas por usuário (arquivo "edicoes" da conta). Quem aplica é o SERVIDOR: ele refaz a operação
  // com o stop e o alvo editados desde o candle do sinal, e o resultado vale em tudo (lista, gráfico, total do período,
  // dia a dia, testes ao vivo). Cada edição guarda também o que o robô tinha feito ("orig"), para comparar.
  const ED = { mapa: null };
  const chaveEd = (tr, meta) => [meta.ativo, +meta.tf, tr.est, tr.t_ent, tr.dir].join("|");
  const edDe = (t, meta) => (ED.mapa && meta && ED.mapa[chaveEd(t, meta)]) || null;
  const O = (t, meta) => { const e = edDe(t, meta); return e && e.orig ? Object.assign({}, t, e.orig) : t; };      // como o robô fez
  async function carregarEd() {
    if (ED.mapa) return completarEd();
    try { const v = await AX.api.get("edicoes"); ED.mapa = v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch (e) { ED.mapa = {}; }
    completarEd();
  }
  // edições feitas antes da 3.0 não guardavam o horário do sinal (o servidor precisa dele): completa com a tela
  function completarEd() {
    const D = AX.vivo.D;
    if (!D || !ED.mapa) return;
    let mudou = false;
    for (const t of (D.trades || []).concat(D.abertas || [])) {
      const e = ED.mapa[chaveEd(t, D.meta)];
      if (e && !e.t_sinal && t.t_sinal) { e.t_sinal = t.t_sinal; mudou = true; }
    }
    if (mudou) gravarEd().then(recarregar).catch(() => {});
  }
  async function gravarEd() {
    const ks = Object.keys(ED.mapa || {});
    if (ks.length > 300) for (const k of ks.sort((a, b) => ED.mapa[a].q - ED.mapa[b].q).slice(0, ks.length - 300)) delete ED.mapa[k];
    await AX.api.set("edicoes", ED.mapa);
    AX.edv = Date.now();                       // muda o pedido ao servidor: ele refaz o período com as edições
  }
  function recarregar() {
    AX.vivo.velho = true;
    AX.carregarVivo();
    if (AX.ops && AX.ops.recarregarTestes) AX.ops.recarregarTestes();
  }
  // aplica o ajuste de uma lição (stop a "fs" vezes a distância original; alvo a "ra" vezes o risco novo) a todas as operações da estratégia
  function generalizar(D, est, fs, ra, lista) {
    let n = 0, antes = 0, depois = 0, viraram = 0, pioraram = 0;
    for (const t0 of lista || D.trades) {
      if (t0.est !== est) continue;
      const t = O(t0, D.meta), s0 = t.stop_ini ?? t.stop, risco0 = Math.abs(t.ent - s0);
      const stop = t.ent - t.dir * risco0 * fs, alvo = ra > 0 ? t.ent + t.dir * risco0 * fs * ra : null;
      const base = refazer(D, t, s0, t.alvo), novo = refazer(D, t, stop, alvo);
      if (!base || !novo) continue;
      n++; antes += base.dinheiro; depois += novo.dinheiro;
      if (base.dinheiro <= 0 && novo.dinheiro > 0) viraram++;
      if (base.dinheiro > 0 && novo.dinheiro <= 0) pioraram++;
    }
    return { n, antes, depois, viraram, pioraram };
  }
  // Cada edição vira também uma lição automática (aba Aprender, "Suas lições"): é assim que o robô aprende com o que você muda.
  const mesmaOp = (x, tr, meta) => x.auto && x.ativo === meta.ativo && +x.tf === +meta.tf && x.est === tr.est && x.t_ent === tr.t_ent;
  async function licaoAuto(tr, meta, item) {
    const lista = (await licoes()).filter((x) => !mesmaOp(x, tr, meta));
    if (item) lista.push(item);
    L.lista = lista.slice(-200);
    try { await AX.api.set("licoes", L.lista); } catch (e) { /* a edição já foi salva; a lição tenta de novo na próxima */ }
    if (AX.aba === "ia") renderLicoes();
  }
  // Hipótese em edição: a operação com o stop e o alvo que o usuário escolheu (arrastando no gráfico ou digitando).
  const E = { tr: null, meta: null, stop: null, alvo: null, res: null, hip: null, box: null, drag: null, sujo: false };
  function montarHip() {
    const D = AX.vivo.D, t = E.tr;
    E.res = D ? refazer(D, t, E.stop, E.alvo) : null;
    if (!E.res) { E.hip = null; return; }
    const r = E.res;
    E.hip = Object.assign({}, t, { stop: E.stop, stop_ini: E.stop, alvo: E.alvo, alvo1: null, alvo2: null, risco: r.risco, sai: r.sai, R: r.R, dinheiro: r.dinheiro,
      motivo: r.motivo + " (e se)", i_ent: AX.idxT(D, t.t_ent), i_sinal: AX.idxT(D, t.t_sinal), i_sai: r.motivo === "ainda aberta" ? null : r.i_sai,
      t_sai: r.motivo === "ainda aberta" ? null : D.t[r.i_sai] });
    if (E.hip.i_sai == null) delete E.hip.t_sai;
  }
  function situacao() {
    const el = $("eseSituacao"); if (!el || !E.tr) return;
    const ed = edDe(E.tr, E.meta), rg = (AX.pref.regras || {})[E.tr.est];
    el.innerHTML = (E.sujo ? '<span class="alerta">● Mudança ainda não salva.</span> ' : ed ? '<span class="bom">✓ Edição salva nesta operação.</span> ' : "") +
      (rg ? `Regra ativa na ${AX.esc(E.tr.est)}: stop a ${AX.num(rg[0], 2)}× ${rg[1] ? "e alvo a " + AX.num(rg[1], 1) + " : 1" : "(alvo da gestão)"} <a href="#" id="eseTiraRegra">tirar a regra</a>` : "");
    const tr2 = $("eseTiraRegra");
    if (tr2) tr2.onclick = (e) => { e.preventDefault(); const r2 = Object.assign({}, AX.pref.regras); delete r2[E.tr.est]; AX.pref.regras = r2; fecharEse(); AX.salvarRegras(); AX.toast("Regra tirada: a estratégia volta ao stop e ao alvo dela.", "ok"); };
  }
  function pintarEse() {
    const el = E.box && $("eseRes"); if (!el) return;
    const D = AX.vivo.D, t = E.tr, dec = E.meta.decimais, f = (v) => (v == null ? "" : (+v).toFixed(dec).replace(".", ","));
    if (document.activeElement !== $("eseStop")) $("eseStop").value = f(E.stop);
    if (document.activeElement !== $("eseAlvo")) $("eseAlvo").value = f(E.alvo);
    const r = E.res;
    situacao();
    if (!r) { el.innerHTML = '<span class="ruim">O stop tem de ficar do lado da perda e o alvo do lado do ganho.</span>'; AX.redesenhar(); return; }
    const o = O(t, E.meta), s0 = o.stop_ini ?? o.stop, fs = r.risco / Math.abs(t.ent - s0), ra = E.alvo != null ? Math.abs(E.alvo - t.ent) / r.risco : 0;
    const g = generalizar(D, t.est, fs, ra, E.lista);
    E.fs = fs; E.ra = ra; E.g = g;
    const aberta = r.motivo === "ainda aberta";
    el.innerHTML = `<div class="ese-res"><div><small>O robô sozinho</small><b class="${AX.cls(o.R)}">${o.dinheiro != null ? AX.res(o.R, o.dinheiro, D) : AX.R(o.R)}</b><em>${AX.esc(o.motivo || "aberta")}</em></div>
        <div><small>Com o seu ajuste</small><b class="${AX.cls(r.R)}">${AX.res(r.R, r.dinheiro, D)}</b><em>${aberta ? "ainda aberta agora" : AX.esc(r.motivo) + " às " + AX.quando(D, r.i_sai).slice(-5)}</em></div>
        <div><small>Como regra nas ${g.n} operações da ${AX.esc(t.est)}</small><b class="${AX.cls(g.depois - g.antes)}">${AX.dinheiro(g.depois - g.antes, D, true)}</b><em>de ${AX.dinheiro(g.antes, D, true)} para ${AX.dinheiro(g.depois, D, true)}</em></div></div>
      <div class="nota">Stop a ${AX.num(fs, 2)}× a distância do robô${ra ? " · alvo a " + AX.num(ra, 1) + " : 1" : " · sem alvo"}. Como regra: ${g.viraram} perda(s) viram ganho e ${g.pioraram} ganho(s) viram perda.
        <span class="${g.depois > g.antes ? "bom" : "alerta"}">${g.depois > g.antes ? "No conjunto melhorou: vale testar como regra." : "No conjunto não melhorou: a correção só funciona nesta operação, olhando depois que ela aconteceu."}</span></div>`;
    $("eseRegra").textContent = `📐 Usar como regra da ${t.est}`;
    AX.redesenhar();
  }
  // A escala de preço do gráfico inclui o stop e o alvo em edição: sem isso a linha podia ficar fora da tela, sem como pegar.
  // A faixa só muda ao abrir o editor e ao soltar a linha (nunca durante o arrasto, para o gráfico não fugir do mouse).
  function enquadrarEse() {
    E.faixa = E.tr && E.box ? [Math.min(E.stop, E.alvo ?? E.stop, E.tr.ent), Math.max(E.stop, E.alvo ?? E.stop, E.tr.ent)] : null;
    AX.S.candle.applyOptions({ autoscaleInfoProvider: !E.faixa ? undefined : (orig) => {
      const r = orig(); if (!r || !r.priceRange || !E.faixa) return r;
      const m = (E.faixa[1] - E.faixa[0]) * 0.08;
      return { priceRange: { minValue: Math.min(r.priceRange.minValue, E.faixa[0] - m), maxValue: Math.max(r.priceRange.maxValue, E.faixa[1] + m) }, margins: r.margins };
    } });
  }
  function fecharEse() {
    if (R.on) fechar();
    E.tr = null; E.hip = null; E.res = null; E.sujo = false; enquadrarEse();
    if (E.box) E.box.innerHTML = "";
    E.box = null;
    $("areaGrafico").style.cursor = "";
    AX.redesenhar();
    if (AX.ops && AX.ops.atualizar) AX.ops.atualizar();
  }
  async function salvarEd() {
    if (!E.tr || !E.res || !ED.mapa) return AX.toast("Ajuste o stop e o alvo primeiro.", "aviso");
    if (!E.tr.t_sinal) return AX.toast("Esta operação não tem o horário do sinal; não dá para salvar.", "aviso");
    const tr = E.tr, meta = E.meta, r = E.res, k = chaveEd(tr, meta), antigo = ED.mapa[k], o = O(tr, meta);
    ED.mapa[k] = { stop: E.stop, alvo: E.alvo, t_sinal: tr.t_sinal, R: +r.R.toFixed(2), din: +r.dinheiro.toFixed(2), q: Date.now(),
      orig: (antigo && antigo.orig) || { stop: o.stop_ini ?? o.stop, stop_ini: o.stop_ini ?? o.stop, alvo: o.alvo, R: o.R, dinheiro: o.dinheiro, motivo: o.motivo } };
    try { await gravarEd(); }
    catch (e) { delete ED.mapa[k]; if (antigo) ED.mapa[k] = antigo; return AX.toast("Não consegui salvar a edição: " + e.message, "erro"); }
    if (E.g) licaoAuto(tr, meta, { quando: Date.now(), auto: true, ativo: meta.ativo, tf: +meta.tf, est: tr.est, dir: tr.dir, t_ent: tr.t_ent, fs: +E.fs.toFixed(3), ra: +E.ra.toFixed(2),
      antes: +(+o.R).toFixed(2), depois: +r.R.toFixed(2), nota: "", geral: { n: E.g.n, antes: Math.round(E.g.antes), depois: Math.round(E.g.depois) } });
    const igual = o.dinheiro != null && Math.abs(r.dinheiro - o.dinheiro) < 0.005;
    AX.toast(igual ? `Edição salva. O resultado ficou igual ao do robô (${AX.dinheiro(r.dinheiro, AX.vivo.D, true)}): o preço não chegou no stop nem no alvo novos antes da saída.`
      : `Edição salva: esta operação passa a ${AX.dinheiro(r.dinheiro, AX.vivo.D, true)} (o robô fez ${AX.dinheiro(o.dinheiro, AX.vivo.D, true)}). A lista, o gráfico e o total do período já contam com ela.`, "ok");
    fecharEse();
    recarregar();
  }
  async function voltarOriginal(tr, meta) {
    const k = chaveEd(tr, meta);
    if (!ED.mapa || !ED.mapa[k]) { fecharEse(); return; }
    const antigo = ED.mapa[k];
    delete ED.mapa[k];
    try { await gravarEd(); } catch (e) { ED.mapa[k] = antigo; return AX.toast("Não consegui desfazer: " + e.message, "erro"); }
    licaoAuto(tr, meta, null);
    AX.toast("Edição desfeita: a operação volta a ser como o robô fez.", "ok");
    fecharEse();
    recarregar();
  }
  function usarRegra() {
    if (!E.tr || !E.res || !(E.fs > 0)) return AX.toast("Ajuste o stop e o alvo primeiro.", "aviso");
    const est = E.tr.est, fs = +E.fs.toFixed(3), ra = +E.ra.toFixed(2);
    if (fs < 0.2 || fs > 5) return AX.toast("Esse stop ficou longe demais do original para virar regra (de 0,2× a 5× a distância do robô).", "aviso");
    AX.pref.regras = Object.assign({}, AX.pref.regras, { [est]: [fs, ra] });
    AX.toast(`Regra ligada na ${est}: stop a ${AX.num(fs, 2)}× a distância do robô${ra ? " e alvo a " + AX.num(ra, 1) + " : 1" : ""}, em todas as operações (passadas, a aberta e as próximas). Para tirar: aba Plano.`, "ok");
    fecharEse();
    AX.salvarRegras();
  }
  function painelEse(tr, meta, alvoEl, lista) {
    const D = AX.vivo.D;
    if (!D || D.meta.ativo !== meta.ativo || +D.meta.tf !== +meta.tf || AX.idxT(D, tr.t_ent) < 0) return AX.toast("Abra este ativo e este tempo gráfico para editar a operação.", "aviso");
    if (R.on) fechar();
    const o = O(tr, meta), s0 = o.stop_ini ?? o.stop, risco0 = Math.abs(tr.ent - s0);
    Object.assign(E, { tr, meta, stop: s0, alvo: o.alvo != null ? o.alvo : tr.ent + tr.dir * 2 * risco0, box: alvoEl, lista: lista || null, sujo: false });
    const ed = edDe(tr, meta);                                  // a edição salva desta operação volta como foi deixada
    if (ed && ed.stop > 0 && tr.dir * (tr.ent - ed.stop) > 0 && (ed.alvo == null || tr.dir * (ed.alvo - tr.ent) > 0)) { E.stop = ed.stop; E.alvo = ed.alvo; }
    alvoEl.innerHTML = `<div class="ese"><div class="manual-tit">EDITAR ESTA OPERAÇÃO ${AX.q("Mude o stop e o alvo desta operação e veja o que teria acontecido nos candles reais, com os mesmos custos. Salvar nesta operação: ela passa a contar com a sua edição em tudo (lista, gráfico, total, dia a dia e testes ao vivo). Usar como regra: o mesmo ajuste (proporcional) vale para todas as operações da estratégia, inclusive a aberta e as próximas.")}
        <span class="dir"><button id="eseFechar" class="mini-btn">✕ fechar</button></span></div>
      <ol class="ese-passos"><li><b>Arraste no gráfico</b> as linhas ⇕ STOP e ⇕ ALVO (ou digite os preços).</li><li>Veja o resultado mudar na hora.</li>
        <li><b>Salve</b> só nesta operação ou use como <b>regra</b> da estratégia.</li></ol>
      <div class="ese-campos"><label class="campo"><span>Stop</span><input type="text" inputmode="decimal" id="eseStop" autocomplete="off"></label>
        <label class="campo"><span>Alvo</span><input type="text" inputmode="decimal" id="eseAlvo" autocomplete="off" placeholder="vazio = sem alvo"></label></div>
      <div id="eseRes"></div>
      <div class="ese-acoes"><button id="eseGravar" class="primario">💾 Salvar nesta operação</button><button id="eseRegra" class="secundario">📐 Usar como regra</button></div>
      <div class="botoes finos"><button id="eseReplay">▶ Replay com este ajuste</button><button id="eseOrig">↺ Voltar ao original</button></div>
      <div class="nota" id="eseSituacao"></div>
      <details class="ese-licao"><summary>Anotar uma lição sobre esta entrada</summary>
        <label class="campo"><span>O que você aprendeu (opcional)</span><input type="text" id="eseNota" maxlength="200" placeholder="ex.: stop curto demais para esse horário"></label>
        <div class="botoes finos"><button id="eseSalvar">Salvar como lição</button></div></details></div>`;
    const num = (id) => { const x = $(id).value.trim().replace(/\s/g, ""); if (!x) return null; const a = parseFloat(x.replace(/\./g, "").replace(",", ".")), b = parseFloat(x.replace(",", ".")); const ok = [a, b].filter((v) => v > 0); return ok.length ? ok.sort((p, q) => Math.abs(Math.log(p / tr.ent)) - Math.abs(Math.log(q / tr.ent)))[0] : NaN; };
    const digitou = () => { const st = num("eseStop"), al = num("eseAlvo"); if (!(st > 0) || Number.isNaN(al)) return AX.toast("Não entendi o preço.", "aviso"); E.stop = st; E.alvo = al; E.sujo = true; montarHip(); pintarEse(); enquadrarEse(); };
    for (const id of ["eseStop", "eseAlvo"]) { $(id).onchange = digitou; $(id).onkeydown = (e) => { e.stopPropagation(); if (e.key === "Enter") { e.preventDefault(); $(id).blur(); } }; }
    $("eseFechar").onclick = (e) => { e.stopPropagation(); if (E.sujo && !confirm("A mudança ainda não foi salva. Fechar mesmo assim?")) return; fecharEse(); };
    $("eseGravar").onclick = salvarEd;
    $("eseRegra").onclick = usarRegra;
    $("eseOrig").onclick = () => voltarOriginal(tr, meta);
    $("eseReplay").onclick = () => { if (!E.hip) return AX.toast("Ajuste o stop e o alvo primeiro.", "aviso"); tocar(E.hip, meta); };
    $("eseSalvar").onclick = async () => {
      if (!E.res) return;
      const lista2 = await licoes(), r = E.res;
      lista2.push({ quando: Date.now(), ativo: meta.ativo, tf: +meta.tf, est: tr.est, dir: tr.dir, t_ent: tr.t_ent, fs: +E.fs.toFixed(3), ra: +E.ra.toFixed(2), antes: +(+o.R).toFixed(2), depois: +r.R.toFixed(2),
        nota: String($("eseNota").value || "").slice(0, 200), geral: { n: E.g.n, antes: Math.round(E.g.antes), depois: Math.round(E.g.depois) } });
      L.lista = lista2.slice(-200);
      try { await AX.api.set("licoes", L.lista); AX.toast("Lição salva. Ela aparece na aba Aprender, em Suas lições.", "ok"); renderLicoes(); }
      catch (e) { AX.toast("Não consegui salvar a lição: " + e.message, "erro"); }
    };
    montarHip(); pintarEse(); enquadrarEse();
    AX.focar(AX.idxT(D, tr.t_ent), E.res ? E.res.i_sai : AX.idxT(D, tr.t_ent));
  }
  // ---- linhas ⇕ STOP e ⇕ ALVO da hipótese: desenhadas e arrastáveis no gráfico
  const linhasEse = () => (E.tr && E.box ? [["stop", E.stop, COR.perda, "⇕ STOP (e se) "], ["alvo", E.alvo, COR.ganho, "⇕ ALVO (e se) "]].filter((l) => l[1] != null) : []);
  AX.camadas.push((ctx, u) => {
    const D = AX.graficoMostra();
    if (!E.tr || !E.box || !D || D.meta.ativo !== E.meta.ativo) return;
    const xe = u.x(AX.idxT(D, E.tr.t_ent)); if (xe == null) return;
    for (const [tipo, preco, cor, nome] of linhasEse()) {
      const y = u.y(preco); if (y == null) continue;
      const meu = E.drag === tipo;
      ctx.strokeStyle = cor; ctx.lineWidth = meu ? 3 : 2; ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(Math.max(0, xe - 30), y); ctx.lineTo(u.W, y); ctx.stroke();
      ctx.font = "700 12px Segoe UI, system-ui"; const txt = nome + AX.fmt(preco), w = ctx.measureText(txt).width + 14, x0 = u.W - w - 8;
      ctx.fillStyle = cor; ctx.beginPath(); if (ctx.roundRect) ctx.roundRect(x0, y - 11, w, 22, 5); else ctx.rect(x0, y - 11, w, 22); ctx.fill();
      ctx.fillStyle = "#06101c"; ctx.textBaseline = "middle"; ctx.textAlign = "left"; ctx.fillText(txt, x0 + 7, y + 0.5);
    }
  });
  const areaG = $("areaGrafico"), grafEl = $("chart");
  function linhaSob(e) {
    if (!E.tr || !E.box || !grafEl.contains(e.target) || (AX.desenho && AX.desenho.ferramenta() !== "cursor")) return null;
    const r = grafEl.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
    if (x < 0 || x > AX.chart.timeScale().width()) return null;
    let melhor = null, dmin = 8;
    for (const [tipo, preco] of linhasEse()) { const yy = AX.S.candle.priceToCoordinate(preco); if (yy != null && Math.abs(yy - y) < dmin) { dmin = Math.abs(yy - y); melhor = tipo; } }
    return melhor;
  }
  areaG.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || E.drag) return;
    const tipo = linhaSob(e); if (!tipo) return;
    e.preventDefault(); e.stopImmediatePropagation();
    E.drag = tipo; E.antes = [E.stop, E.alvo];
    try { areaG.setPointerCapture(e.pointerId); } catch (err) { /* ok */ }
    areaG.style.cursor = "ns-resize";
  }, true);
  areaG.addEventListener("pointermove", (e) => {
    if (!E.drag) { if (!e.buttons && linhaSob(e)) areaG.style.cursor = "ns-resize"; return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (!e.buttons) { soltarEse(e); return; }
    const r = grafEl.getBoundingClientRect(), p = AX.S.candle.coordinateToPrice(e.clientY - r.top);
    if (p == null || !(p > 0)) return;
    const tk = (AX.vivo.D && AX.vivo.D.meta.tick) || Math.pow(10, -E.meta.decimais), v = +(Math.round(p / tk) * tk).toFixed(E.meta.decimais + 2), t = E.tr;
    // o stop não atravessa a entrada para o lado do ganho, e o alvo não atravessa para o lado da perda
    if (E.drag === "stop") { if (t.dir * (t.ent - v) > tk / 2) E.stop = v; } else if (t.dir * (v - t.ent) > tk / 2) E.alvo = v;
    E.sujo = true;
    montarHip(); pintarEse();
  }, true);
  function soltarEse(e) {
    if (!E.drag) return;
    if (e) e.stopImmediatePropagation();
    E.drag = null; E.sujo = true; areaG.style.cursor = ""; enquadrarEse(); situacao();
    if (R.on && E.hip) tocar(E.hip, E.meta);
    AX.redesenhar();
  }
  areaG.addEventListener("pointerup", soltarEse, true);
  areaG.addEventListener("pointercancel", soltarEse, true);
  areaG.addEventListener("click", (e) => { if (E.drag) e.stopImmediatePropagation(); }, true);
  areaG.addEventListener("touchmove", (e) => { if (E.drag) { if (e.cancelable) e.preventDefault(); e.stopImmediatePropagation(); } }, { capture: true, passive: false });

  // ================================================================ 3. suas lições (aba IA)
  async function renderLicoes() {
    const el = $("iaLicoes"); if (!el) return;
    const lista = await licoes(), D = AX.vivo.D;
    if (!lista.length) {
      el.innerHTML = `<div class="card"><div class="rot">SUAS LIÇÕES</div><div class="nota">Nenhuma ainda. Na aba Agora, clique numa operação da lista e use <b>E se…</b> para corrigir o stop e o alvo; salve como lição e ela aparece aqui, com o teste do ajuste em todas as operações da estratégia.</div></div>`;
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
    h += `<div class="nota">Para o robô passar a operar com um ajuste, abra uma operação da estratégia, faça o ajuste no E se… e use <b>📐 Usar como regra</b>: ele vale nas operações passadas, na aberta e nas próximas, inclusive nos testes ao vivo.</div>
      <div class="botoes finos"><button id="licLimpar">Apagar as lições</button></div></div>`;
    el.innerHTML = h;
    $("licLimpar").onclick = async () => { if (!confirm("Apagar todas as suas lições?")) return; L.lista = []; try { await AX.api.set("licoes", []); } catch (e) { /* ok */ } renderLicoes(); };
  }

  AX.replay = { tocar, fechar, ativo: () => R.on, painelEse, refazer, generalizar, hipotese: () => (E.tr && E.box ? E.hip : null), editando: () => !!(E.tr && E.box), fecharEse,
    edicao: (tr, meta) => edDe(tr, meta) };
  AX.on("carregado", carregarEd);
  AX.on("dadosVivo", () => { if (ED.mapa) completarEd(); else carregarEd(); });
  AX.on("aba", (n) => {
    if (n !== "vivo") fecharEse();
    // o replay fecha sem repintar o gráfico ao vivo quando a aba nova é a Simulação (ela mostra os candles dela)
    if (R.on && n !== "vivo") { if (n === "sim") { clearTimeout(R.relogio); R.on = false; AX.emReplay = false; AX.chart.applyOptions({ timeScale: { shiftVisibleRangeOnNewBar: true } }); if (barra) barra.classList.add("oculto"); } else fechar(); }
    if (n === "ia") renderLicoes();
  });
  AX.on("mudou", () => { fecharEse(); fechar(); if (AX.aba === "ia") setTimeout(renderLicoes, 1500); });
  AX.on("dadosVivo", () => { if (AX.aba === "ia") renderLicoes(); });
  AX.on("tecla", (e) => { if (R.on && e.key === "Escape") fechar(); if (R.on && e.key === " ") { e.preventDefault(); barra.querySelector("[data-a=pausa]").click(); } });
})();
