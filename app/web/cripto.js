/* ROBÔ KELLER — aba CRIPTO: radar de moedas em tempo real.
   Memes e Maiores: Binance. O servidor mede cada moeda (variação, volume da última hora contra o normal, pressão de
   compra, se está na máxima de 24 h) e o navegador recebe os preços direto da Binance, uma vez por segundo.
   Novas (DEX): tokens em alta nas corretoras descentralizadas (GeckoTerminal), com os sinais de risco e a checagem
   de golpe. Clicar numa moeda da Binance abre ela no gráfico, com as estratégias e a taxa da corretora nas contas. */
(() => {
  "use strict";
  const RK = window.RK, $ = RK.$;
  const C = { seg: "memes", painel: null, dex: null, ordem: "onda", desc: true, aberto: null, seguranca: {}, buscando: false,
    ws: {}, wsOk: {}, precos: {}, tentativas: {}, vistosRompendo: {}, ultPainel: 0, ultDex: 0 };
  const WS_URL = { BN: ["wss://stream.binance.com:9443/ws/!miniTicker@arr", "wss://data-stream.binance.vision/ws/!miniTicker@arr"],
    BF: ["wss://fstream.binance.com/market/ws/!miniTicker@arr"] };

  // ---------------------------------------------------------------- formatação
  const preco = (v) => (v == null ? "—" : v >= 1000 ? v.toLocaleString("pt-BR", { maximumFractionDigits: 2 })
    : v.toLocaleString("pt-BR", { minimumSignificantDigits: 3, maximumSignificantDigits: 5 }));
  const pct = (v, d = 1) => (v == null ? '<span class="neutro">—</span>'
    : `<span class="${v > 0 ? "bom" : v < 0 ? "ruim" : "neutro"}">${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(100 * v).toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })}%</span>`);
  const abrev = (v) => (v == null ? "—" : "US$ " + (v >= 1e9 ? RK.num(v / 1e9, 1) + " bi" : v >= 1e6 ? RK.num(v / 1e6, 1) + " mi" : v >= 1e3 ? RK.num(v / 1e3, 0) + " mil" : RK.num(v, 0)));
  const idade = (h) => (h == null ? "—" : h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} dias`);
  const hora = (t) => RK.horaBR(t, true);
  function spark(pts) {
    if (!pts || pts.length < 3) return "";
    const mn = Math.min(...pts), mx = Math.max(...pts), amp = mx - mn || 1, W = 62, H = 18;
    const d = pts.map((v, i) => `${((i * W) / (pts.length - 1)).toFixed(1)},${(1 + ((mx - v) * (H - 2)) / amp).toFixed(1)}`).join(" ");
    return `<svg class="spk" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}"><polyline points="${d}" fill="none" stroke="${pts[pts.length - 1] >= pts[0] ? "#22e39a" : "#ff5c6e"}" stroke-width="1.4"/></svg>`;
  }
  const CHIP = { rompendo: ["ROMPENDO", "Na máxima de 24 h com o volume da última hora pelo menos 3 vezes o normal"],
    esquentando: ["ESQUENTANDO", "Volume da última hora pelo menos 2 vezes o normal e alta de 2% ou mais na hora"],
    esticada: ["ESTICADA", "Já subiu 30% ou mais em 24 h: quem entra agora entra tarde; costuma devolver forte"],
    despencando: ["DESPENCANDO", "Caiu 20% ou mais em 24 h: nos últimos meses, quem despencou continuou caindo na maioria das vezes"] };
  const chip = (k) => (k ? `<span class="chip ${k}" title="${CHIP[k][1]}">${CHIP[k][0]}</span>` : "");

  // ---------------------------------------------------------------- servidor
  async function buscar(forcar = false, qual = C.seg === "dex" ? "dex" : "painel") {
    if (C.buscando) return;
    const dex = qual === "dex", agora = Date.now();
    if (!forcar && agora - (dex ? C.ultDex : C.ultPainel) < (dex ? 60000 : 4500)) return;
    C.buscando = true;
    try {
      if (dex) { C.dex = await RK.json("/api/cripto/dex"); C.ultDex = Date.now(); }
      else { C.painel = await RK.json("/api/cripto/painel"); C.ultPainel = Date.now(); avisarRompimentos(); }
      if (RK.aba === "cripto") { RK.erro("erroCripto", null); render(); }
    } catch (e) {
      if (RK.aba === "cripto") RK.erro("erroCripto", e);
    } finally { C.buscando = false; }
  }

  // moeda que acabou de entrar em "rompendo": contador na aba e, se o aviso estiver ligado, som e aviso
  function avisarRompimentos() {
    const p = C.painel; if (!p) return;
    const agora = Date.now(), romp = p.memes.filter((r) => r.estado === "rompendo");
    const bd = $("badgeCripto"); bd.textContent = romp.length; bd.classList.toggle("oculto", !romp.length);
    const novas = romp.filter((r) => !(agora - (C.vistosRompendo[r.chave] || 0) < 2 * 3600 * 1000));
    romp.forEach((r) => (C.vistosRompendo[r.chave] = agora));
    if (C.primeiraPassou && novas.length && RK.pref.criptoAviso) {
      const r = novas[0];
      RK.som("aviso");
      RK.toast(`${r.moeda} rompendo com volume: ${(100 * r.r60).toFixed(1).replace(".", ",")}% em 1 h, volume ${RK.num(r.volRel, 1)}× o normal${novas.length > 1 ? ` (+${novas.length - 1})` : ""}`, "aviso");
    }
    C.primeiraPassou = true;
  }

  // ---------------------------------------------------------------- preços em tempo real (direto da Binance)
  function precisa(mercado) {
    const noGrafico = RK.ehCripto(RK.pref.ativo) && RK.pref.ativo.startsWith(mercado + ":") && RK.vivo.D && RK.vivo.D.meta.aoVivo;
    const naLista = RK.aba === "cripto" && C.seg !== "dex" && !document.hidden && (mercado === "BN" || (C.painel && C.seg === "memes"));
    return !!(noGrafico || naLista);
  }
  function ligar(mercado) {
    if (C.ws[mercado] || !window.WebSocket) return;
    const urls = WS_URL[mercado], n = C.tentativas[mercado] || 0;
    if (n >= 6 && Date.now() - (C.ultTentativa || 0) < 60000) return;       // a rede não deixa: tenta só de minuto em minuto
    C.ultTentativa = Date.now();
    let ws;
    try { ws = new WebSocket(urls[n % urls.length]); } catch (e) { return; }
    C.ws[mercado] = ws;
    ws.onopen = () => { C.wsOk[mercado] = true; C.tentativas[mercado] = 0; status(); };
    ws.onmessage = (ev) => {
      let arr; try { arr = JSON.parse(ev.data); } catch (e) { return; }
      if (!Array.isArray(arr)) return;
      const noGrafico = RK.pref.ativo.startsWith(mercado + ":") ? RK.pref.ativo.slice(3) : null;
      for (const t of arr) {
        const c = +t.c;
        C.precos[mercado + ":" + t.s] = [c, +t.o];
        if (t.s === noGrafico) RK.tick(RK.pref.ativo, c);
      }
      if (RK.aba === "cripto" && C.seg !== "dex") pintarPrecos();
    };
    ws.onclose = ws.onerror = () => {
      if (C.ws[mercado] !== ws) return;
      C.ws[mercado] = null; C.wsOk[mercado] = false; C.tentativas[mercado] = n + 1; status();
    };
  }
  function desligar(mercado) {
    const ws = C.ws[mercado];
    if (!ws) return;
    C.ws[mercado] = null; C.wsOk[mercado] = false;
    try { ws.onclose = ws.onerror = null; ws.close(); } catch (e) { /* ok */ }
  }
  function cuidarWS() { for (const m of ["BN", "BF"]) { if (precisa(m)) ligar(m); else desligar(m); } }
  function pintarPrecos() {
    document.querySelectorAll("#crLista tr[data-c]").forEach((tr) => {
      const p = C.precos[tr.dataset.c]; if (!p) return;
      const cel = tr.querySelector(".cr-preco"), ant = +cel.dataset.v;
      if (ant !== p[0]) {
        cel.textContent = preco(p[0]); cel.dataset.v = p[0];
        if (ant) { cel.classList.remove("sobe", "desce"); void cel.offsetWidth; cel.classList.add(p[0] > ant ? "sobe" : "desce"); }
      }
      if (p[1] > 0) tr.querySelector(".cr-24").innerHTML = pct(p[0] / p[1] - 1);
    });
  }
  function status() {
    if (RK.aba !== "cripto") return;
    const el = $("crStatus");
    if (C.seg === "dex") el.innerHTML = C.dex ? `GeckoTerminal · atualizado ${hora(C.dex.t)}` : "buscando…";
    else el.innerHTML = (C.wsOk.BN ? '<i class="luz vivo"></i> preços em tempo real' : '<i class="luz hist"></i> preços a cada 12 s') + (C.painel ? ` · medidas de ${hora(C.painel.t)}` : "");
  }

  // ---------------------------------------------------------------- lista da Binance
  const COLS = [["moeda", "Moeda"], ["preco", "Preço"], ["r5", "5 min"], ["r60", "1 h"], ["r24", "24 h"], ["volRel", "Volume"], ["compra", "Compra"], ["onda", "Onda"]];
  function ordenar(lista) {
    if (C.ordem === "onda") return lista;
    const k = C.ordem, s = C.desc ? -1 : 1;
    return lista.slice().sort((a, b) => (k === "moeda" ? s * a.moeda.localeCompare(b.moeda) : s * ((a[k] == null ? -1e18 : a[k]) - (b[k] == null ? -1e18 : b[k]))));
  }
  function renderBinance() {
    const p = C.painel;
    if (!p) { $("crLista").innerHTML = `<div class="vazio-bloco">Medindo as moedas na Binance…</div>`; return; }
    const lista = ordenar(C.seg === "memes" ? p.memes : p.maiores);
    const th = COLS.map(([k, n]) => `<th class="${k === "moeda" || k === "onda" ? "" : "n"} ord ${C.ordem === k ? "on" : ""}" data-k="${k}" title="${k === "volRel" ? "Volume da última hora dividido pelo volume médio por hora das 72 horas anteriores" : k === "compra" ? "Quanto do volume da última hora foi de compra agressiva (a mercado)" : "ordenar"}">${n}${C.ordem === k && k !== "onda" ? (C.desc ? " ▾" : " ▴") : ""}</th>`).join("");
    const linhas = lista.map((r) => {
      const pr = C.precos[r.chave] ? C.precos[r.chave][0] : r.preco;
      const fin = r.funding != null && Math.abs(r.funding) >= 0.0005 ? `<span class="chip fin" title="Taxa de financiamento do futuro a cada 8 h. Alta = muita gente comprada com alavancagem: não é sinal de virada, mas as quedas costumam ser mais bruscas">fin. ${(100 * r.funding).toFixed(2).replace(".", ",")}%</span>` : "";
      return `<tr class="clic ${RK.pref.ativo === r.chave ? "sel" : ""}" data-c="${r.chave}" title="${RK.esc(r.nome)} · volume 24 h ${abrev(r.v24)} · clique para abrir no gráfico">
        <td><b>${RK.esc(r.moeda)}</b>${r.mercado === "futuro" ? ' <small class="neutro">fut.</small>' : ""}<br>${spark(r.spark)}</td>
        <td class="n cr-preco" data-v="${pr}">${preco(pr)}</td><td class="n">${pct(r.r5)}</td><td class="n">${pct(r.r60)}</td><td class="n cr-24">${pct(r.r24)}</td>
        <td class="n ${r.volRel >= 3 ? "vol3" : r.volRel >= 2 ? "vol2" : ""}">${r.volRel == null ? "—" : RK.num(r.volRel, 1) + "×"}</td>
        <td class="n ${r.compra >= 0.55 ? "bom" : r.compra != null && r.compra <= 0.45 ? "ruim" : ""}">${r.compra == null ? "—" : RK.pct(100 * r.compra, 0)}</td>
        <td>${chip(r.estado)}${chip(r.alerta)}${fin}</td></tr>`;
    }).join("");
    $("crLista").innerHTML = `<div class="card sem-borda"><table class="tab cr"><tr>${th}</tr>${linhas}</table></div>`;
    $("crLista").querySelectorAll("th.ord").forEach((h) => (h.onclick = () => {
      if (C.ordem === h.dataset.k) C.desc = !C.desc; else { C.ordem = h.dataset.k; C.desc = h.dataset.k !== "moeda"; }
      render();
    }));
    $("crLista").querySelectorAll("tr.clic").forEach((tr) => (tr.onclick = () => {
      const r = lista.find((x) => x.chave === tr.dataset.c); if (!r) return;
      RK.abrirCripto(r.chave, `${r.moeda}/USDT${r.mercado === "futuro" ? " (futuro)" : ""}`);
      $("crLista").querySelectorAll("tr.sel").forEach((x) => x.classList.remove("sel")); tr.classList.add("sel");
      RK.toast(`${r.moeda} no gráfico. As estratégias e a simulação dela estão nas abas Ao vivo e Simulação.`, "ok");
    }));
  }
  function renderEstudo() {
    const el = $("crEstudo"), p = C.painel;
    if (C.seg === "dex") {
      el.innerHTML = `<div class="aviso-custo"><b>Risco muito alto.</b> Nos estudos, 98,6% dos tokens lançados no pump.fun desabaram (<a href="https://www.soliduslabs.com/reports/solana-rug-pulls-pump-dumps-crypto-compliance" target="_blank" rel="noopener noreferrer">Solidus Labs, 2025</a>)
        e mais de 60% das carteiras que operaram lá perderam dinheiro; quem lança costuma comprar no mesmo instante e vender em minutos. A lista mostra o que está em alta <b>agora</b> nas corretoras descentralizadas, com os sinais de risco à vista. O robô não traça gráfico nem estratégia para elas.</div>`;
      return;
    }
    const lig = `<label class="chk" style="margin-top:8px"><input type="checkbox" id="crAviso" ${RK.pref.criptoAviso ? "checked" : ""}> avisar com som quando uma meme começar a romper com volume (mesmo com outra aba aberta)</label>`;
    if (C.seg !== "memes") { el.innerHTML = `<div class="nota">As ${p ? p.maiores.length : 15} moedas de maior volume na Binance (sem as de preço fixo). Clique numa para abrir no gráfico.</div>`; return; }
    const e = p && p.estudo;
    if (!e || !e.estados || !e.estados.rompendo || !e.estados.rompendo.subiu) { el.innerHTML = `<div class="nota">Calculando o estudo "o que veio depois" com os últimos ~125 dias de todas as memes (leva 1 a 2 minutos na primeira vez)…</div>${lig}`; ligarAviso(); return; }
    const b = e.estados.base, r = e.estados.rompendo, n0 = (v) => RK.pct(v, 0);
    const NOME = { base: "Num momento qualquer", rompendo: "ROMPENDO", esquentando: "ESQUENTANDO", esticada: "ESTICADA", despencando: "DESPENCANDO" };
    el.innerHTML = `<div class="nota"><b>O que veio depois</b> (${e.dias} dias, ${e.moedas} memes): depois de <b>ROMPENDO</b>, em 24 h a moeda fechou em alta em <b>${n0(r.subiu)}</b> das vezes; passou de +20% em <b>${n0(r.alta20)}</b> e caiu mais de 10% em <b>${n0(r.queda10)}</b>.
        Num momento qualquer: ${n0(b.subiu)}, ${n0(b.alta20)} e ${n0(b.queda10)}. O rompimento aumenta a chance de movimento grande <b>para os dois lados</b>; na maioria das vezes a moeda devolve.</div>
      <details><summary>ver o estudo completo</summary><table class="tab" style="margin-top:6px"><tr><th>Estado</th><th class="n">Vezes</th><th class="n" title="fechou acima do preço 24 h depois">Alta 24 h</th><th class="n" title="resultado do meio (mediana) 24 h depois">Meio</th><th class="n" title="chegou a subir 20% ou mais em algum momento das 24 h">+20%</th><th class="n">+50%</th><th class="n" title="chegou a cair 10% ou mais em algum momento das 24 h">−10%</th><th class="n">−20%</th></tr>` +
      Object.entries(e.estados).filter(([, x]) => x.subiu != null).map(([k, x]) => `<tr><td>${chip(k === "base" ? null : k) || NOME[k]}</td><td class="n">${x.n.toLocaleString("pt-BR")}</td><td class="n">${n0(x.subiu)}</td><td class="n ${RK.cls(x.mediana)}">${RK.num(x.mediana, 1)}%</td><td class="n">${n0(x.alta20)}</td><td class="n">${n0(x.alta50)}</td><td class="n">${n0(x.queda10)}</td><td class="n">${n0(x.queda20)}</td></tr>`).join("") +
      `</table><div class="nota">Medido de hora em hora nos candles de 1 h da Binance. Só entram as moedas que existem hoje (as que sumiram ficam de fora, então a realidade é um pouco pior). Passado não garante futuro.</div></details>${lig}`;
    ligarAviso();
  }
  function ligarAviso() { const c = $("crAviso"); if (c) c.onchange = () => { RK.pref.criptoAviso = c.checked; RK.salvarPref(); if (c.checked) RK.som("aviso", true); }; }

  // ---------------------------------------------------------------- tokens novos (DEX)
  const ICO = { perigo: "⛔", aviso: "⚠", ok: "✔", info: "·" };
  function renderDex() {
    const d = C.dex;
    if (!d) { $("crLista").innerHTML = `<div class="vazio-bloco">Buscando os tokens em alta nas DEX…</div>`; return; }
    if (!d.tokens.length) { $("crLista").innerHTML = `<div class="vazio-bloco">O GeckoTerminal não respondeu agora${d.erro ? " (" + RK.esc(d.erro) + ")" : ""}. Tento de novo em 1 minuto.</div>`; return; }
    $("crLista").innerHTML = d.tokens.map((r, j) => {
      const ab = C.aberto === r.id, seg = C.seguranca[r.id];
      return `<div class="dx ${ab ? "ab" : ""}" data-j="${j}">
        <div class="dx-l1"><b>${RK.esc(r.simbolo)}</b><span class="tag">${RK.esc(r.redeNome)}</span><span class="neutro dx-nome">${RK.esc(r.nome)}</span><span class="chip ${r.risco === "MUITO ALTO" ? "despencando" : "esticada"} dir">risco ${r.risco.toLowerCase()}</span></div>
        <div class="dx-l2">US$ ${preco(r.preco)} · 1 h ${pct(r.r60, 0)} · 24 h ${pct(r.r24, 0)} · liquidez ${abrev(r.liq)} · criado há ${idade(r.idadeH)}</div>
        ${ab ? `<div class="dx-det">
          <div>Volume 24 h ${abrev(r.vol24)} · valor de mercado ${abrev(r.fdv)} · última hora: ${r.compras1h} compras e ${r.vendas1h} vendas</div>
          ${r.sinais.length ? `<ul class="seg-lista">${r.sinais.map(([n, t]) => `<li class="${n}">${ICO[n]} ${RK.esc(t)}</li>`).join("")}</ul>` : `<div class="neutro">Nenhum sinal de risco só pelos números da pool (isso não quer dizer que é seguro).</div>`}
          <div class="botoes"><button class="primario" data-a="seg">${seg === "carregando" ? "Checando…" : "Checar golpe"}</button>
            <a class="bt" href="${RK.esc(r.gt)}" target="_blank" rel="noopener noreferrer">GeckoTerminal ↗</a><a class="bt" href="${RK.esc(r.ds)}" target="_blank" rel="noopener noreferrer">DexScreener ↗</a></div>
          ${seg && seg !== "carregando" ? (seg.erro ? `<div class="erro">⚠ ${RK.esc(seg.erro)}</div>` : `<div class="rot" style="margin-top:10px">CHECAGEM <span class="dir">${seg.perigos} perigo(s) · ${seg.avisos} aviso(s)</span></div>
            ${seg.itens.length ? `<ul class="seg-lista">${seg.itens.map((i) => `<li class="${i.nivel}">${ICO[i.nivel]} ${RK.esc(i.texto)}</li>`).join("")}</ul>` : `<div class="neutro">As fontes de checagem não responderam para este token.</div>`}
            <div class="nota">Fontes: ${seg.fontes.map(RK.esc).join(", ") || "nenhuma respondeu"}. Passar na checagem <b>não</b> quer dizer que é seguro: ela só pega os golpes mais comuns.</div>`) : ""}
        </div>` : ""}</div>`;
    }).join("");
    $("crLista").querySelectorAll(".dx").forEach((el) => {
      const r = d.tokens[+el.dataset.j];
      el.querySelector(".dx-l1").onclick = el.querySelector(".dx-l2").onclick = () => { C.aberto = C.aberto === r.id ? null : r.id; renderDex(); };
      const b = el.querySelector('[data-a="seg"]');
      if (b) b.onclick = async () => {
        if (C.seguranca[r.id] === "carregando") return;
        C.seguranca[r.id] = "carregando"; renderDex();
        try { C.seguranca[r.id] = await RK.json(`/api/cripto/seguranca?rede=${encodeURIComponent(r.rede)}&token=${encodeURIComponent(r.token)}`); }
        catch (e) { C.seguranca[r.id] = { erro: e.message }; }
        if (RK.aba === "cripto" && C.seg === "dex") renderDex();
      };
    });
  }

  function render() {
    document.querySelectorAll("#crSeg button").forEach((b) => b.classList.toggle("on", b.dataset.s === C.seg));
    renderEstudo();
    if (C.seg === "dex") renderDex(); else renderBinance();
    $("crRodape").innerHTML = C.seg === "dex" ? "Dados: GeckoTerminal (em alta na última hora, refeito a cada 3 min). Checagem: GeckoTerminal, RugCheck, honeypot.is e GoPlus."
      : "Dados: Binance. Clique numa moeda para abrir no gráfico: as estratégias rodam nela com a taxa da corretora (0,10% por lado à vista; 0,05% no futuro). Nos testes com 50 memes, <b>todas as estratégias perderam na média em 15 e 60 min depois das taxas</b>, inclusive um rompimento com volume: veja o resultado de cada moeda antes de acreditar numa onda.";
    status();
  }

  // ---------------------------------------------------------------- abrir qualquer moeda pela sigla
  async function abrirSigla(txt) {
    let s = String(txt || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!s) return;
    if (!/(USDT|USDC|FDUSD|BRL|BTC)$/.test(s) || s.length <= 4) s += "USDT";
    for (const mercado of ["BN", "BF"]) {
      try {
        const r = await RK.json("/api/cripto/info?chave=" + mercado + ":" + s);
        $("crBusca").value = "";
        RK.abrirCripto(r.chave, r.nome);
        RK.toast(`${r.nome} no gráfico.`, "ok");
        return;
      } catch (e) { /* tenta o outro mercado */ }
    }
    RK.toast(`Não achei "${s}" na Binance (à vista nem nos futuros).`, "aviso");
  }
  $("crBusca").addEventListener("keydown", (e) => { if (e.key === "Enter") abrirSigla($("crBusca").value); });
  document.querySelectorAll("#crSeg button").forEach((b) => (b.onclick = () => {
    C.seg = b.dataset.s; RK.pref.criptoSeg = C.seg; RK.salvarPref(); C.ordem = "onda"; render(); buscar(true); cuidarWS();
  }));

  RK.on("aba", (nome) => {
    if (nome !== "cripto") { cuidarWS(); return; }
    if (!["memes", "maiores", "dex"].includes(C.seg)) C.seg = "memes";
    render(); buscar(true); cuidarWS();
  });
  RK.on("config", () => { C.seg = ["memes", "maiores", "dex"].includes(RK.pref.criptoSeg) ? RK.pref.criptoSeg : "memes"; });
  RK.on("dadosVivo", cuidarWS);
  setInterval(() => {
    cuidarWS();
    if (RK.aba === "cripto" && !document.hidden) buscar();
    else if (RK.pref.criptoAviso && RK.cfg && Date.now() - C.ultPainel > 30000) buscar(true, "painel");     // aviso de rompimento em segundo plano
  }, 5000);
  document.addEventListener("visibilitychange", cuidarWS);
})();
