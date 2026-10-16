/* ROBÔ APEX: lista de cotações no estilo do TradingView (topo da aba Agora). Mostra o ativo escolhido em destaque
   (preço, variação do dia, mercado aberto ou fechado) e a lista do mercado aberto no topo (Bolsa, Opções ou Cripto)
   com último preço, variação e variação %. Clique numa linha para abrir o ativo no gráfico. Atualiza a cada 10 s. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const L = { itens: [], seq: 0, aberta: true };
  const el = () => $("cardLista");
  const fmt = (v, dec) => (v == null ? "-" : AX.fmt(v, dec == null ? (v >= 1000 ? 2 : v >= 1 ? 4 : 6) : dec));
  async function buscar() {
    if (!AX.cfg || document.hidden || AX.aba !== "vivo") return;
    const seq = ++L.seq;
    try {
      const d = await AX.json("/api/lista?mercado=" + AX.pref.mercado, { tempo: 25000, carga: false });
      if (seq !== L.seq) return;
      L.itens = d.itens || [];
      render();
    } catch (e) { /* fica com a última lista */ }
  }
  function render() {
    const c = el(); if (!c) return;
    const atual = AX.pref.ativo, D = AX.vivo && AX.vivo.D;
    const meu = L.itens.find((x) => x.chave === atual);
    const preco = D && D.meta.ativo === atual ? D.c[D.meta.iFim] : meu ? meu.preco : null;
    const dec = D && D.meta.ativo === atual ? D.meta.decimais : meu ? meu.dec : null;
    const nome = (AX.infoAtivo(atual) || {}).nome || atual;
    const aberto = meu ? meu.aberto : D && D.meta.ativo === atual ? D.meta.formando : false;     // a lista sabe se negociou há pouco (fonte com atraso também)
    const var_ = meu ? meu.var : null, varPct = meu ? meu.varPct : null;
    c.innerHTML = `<div class="ls-det">
        <div class="ls-nome"><b>${AX.esc(AX.rotAtivo(atual))}</b><span>${AX.esc(String(nome).split(" - ").slice(-1)[0])}</span></div>
        <div class="ls-preco"><b>${fmt(preco, dec)}</b>${varPct != null ? `<span class="${var_ >= 0 ? "lg-alta" : "lg-baixa"}">${var_ >= 0 ? "+" : "−"}${fmt(Math.abs(var_), dec)} ${var_ >= 0 ? "+" : "−"}${AX.num(Math.abs(varPct), 2)}%</span>` : ""}</div>
        <div class="ls-status ${aberto ? "on" : ""}"><i></i>${aberto ? "Mercado aberto" : "Mercado fechado"}${D && D.meta.fonte && /atraso/.test(D.meta.fonte) ? ` · ${AX.esc((D.meta.fonte.match(/atraso[^),·]*/) || [""])[0])} · <a href="#" class="ls-tr" data-dica="As fontes gratuitas da B3 e dos índices americanos chegam atrasadas (a própria bolsa cobra pelo dado ao vivo). Para ver e operar em tempo real, conecte o MetaTrader 5 da sua corretora na aba Conectar: os candles da corretora entram no robô como o ativo MT5:símbolo, ao vivo.">tempo real pela sua corretora ›</a>` : ""}</div>
      </div>
      <details class="ls-lista"${L.aberta ? " open" : ""}><summary>Lista · ${AX.esc({ b3: "Bolsa e mundo", opcoes: "Opções (ações)", cripto: "Cripto" }[AX.pref.mercado] || "")}<span>Último</span><span>Var</span><span>Var%</span></summary>
        <div class="ls-linhas">${L.itens.length ? L.itens.map((x) => `<div class="ls-l${x.chave === atual ? " on" : ""}" data-c="${AX.esc(x.chave)}">
          <span class="ls-s"><i class="${x.aberto ? "on" : ""}"></i>${AX.esc(AX.rotAtivo(x.chave))}</span><span>${fmt(x.preco, x.dec)}</span>
          <span class="${x.var >= 0 ? "lg-alta" : "lg-baixa"}">${x.var >= 0 ? "+" : "−"}${fmt(Math.abs(x.var), x.dec)}</span>
          <span class="${x.varPct >= 0 ? "lg-alta" : "lg-baixa"}">${x.varPct >= 0 ? "+" : "−"}${AX.num(Math.abs(x.varPct), 2)}%</span></div>`).join("") : '<div class="nota">Buscando cotações…</div>'}</div></details>`;
    const tr = c.querySelector(".ls-tr");
    if (tr) tr.onclick = (e) => { e.preventDefault(); AX.trocarAba("conectar"); };
    const det = c.querySelector(".ls-lista");
    det.ontoggle = () => { L.aberta = det.open; };
    c.querySelectorAll(".ls-l").forEach((r) => (r.onclick = () => {
      const ch = r.dataset.c;
      if (ch === AX.pref.ativo) return;
      if (AX.ehCripto(ch) && AX.abrirCripto) AX.abrirCripto(ch); else AX.escolherAtivo(ch);
    }));
  }
  AX.on("config", () => { render(); buscar(); });
  AX.on("dadosVivo", render);
  AX.on("mercado", () => { L.itens = []; render(); buscar(); });
  AX.on("aba", (n) => { if (n === "vivo") buscar(); });
  setInterval(buscar, 10000);
  AX.lista = { buscar };
})();
