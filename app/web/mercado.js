/* ROBÔ APEX: o modo de cada mercado (Bolsa, Opções, Cripto).
   No modo Cripto a aba Agora ganha o painel "Mercado cripto" (as principais moedas em 24 h, da Binance) e as notícias
   passam a ser as do mercado cripto. Clicar numa moeda abre ela no gráfico com as mesmas estratégias e a mesma gestão. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const C = { dados: null, buscando: false, relogio: null };
  const abrev = (v) => (v >= 1e9 ? AX.num(v / 1e9, 1) + " bi" : v >= 1e6 ? AX.num(v / 1e6, 1) + " mi" : AX.num(v / 1e3, 0) + " mil");
  const precoTxt = (v) => AX.num(v, v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 8);

  async function buscar() {
    if (C.buscando || AX.pref.mercado !== "cripto") return;
    C.buscando = true;
    try { C.dados = await AX.json("/api/cripto/mercado", { tempo: 20000 }); if (C.dados.usdbrl) AX.usdbrl = C.dados.usdbrl; }
    catch (e) { C.erro = e.message; }
    finally { C.buscando = false; }
    render();
  }
  function render() {
    const el = $("cardCripto");
    if (!el) return;
    if (AX.pref.mercado !== "cripto") { el.classList.add("oculto"); return; }
    el.classList.remove("oculto");
    const d = C.dados;
    if (!d) { el.innerHTML = `<div class="rot">MERCADO CRIPTO · 24 HORAS</div><div class="nota">${C.erro ? "⚠ " + AX.esc(C.erro) : "Buscando as moedas na Binance…"}</div>`; return; }
    const alta = d.moedas.filter((m) => m.var > 0).length;
    el.innerHTML = `<div class="rot">MERCADO CRIPTO · 24 HORAS ${AX.q("As principais moedas da Binance (par com USDT), ordenadas pelo volume negociado nas últimas 24 horas. Clique numa delas para abrir no gráfico com as mesmas estratégias, gestão e testes.")}
        <span class="dir">${alta} de ${d.moedas.length} em alta${d.usdbrl ? " · dólar R$ " + AX.num(d.usdbrl, 2) : ""}</span></div>
      <div class="cr-lista">${d.moedas.map((m) => `<button class="cr-item ${m.chave === AX.pref.ativo ? "on" : ""}" data-c="${AX.esc(m.chave)}" data-dica="${AX.esc(m.nome)}: máxima de 24 h US$ ${precoTxt(m.alta)}, mínima US$ ${precoTxt(m.baixa)}, volume US$ ${abrev(m.volume)}.">
          <b>${AX.esc(m.moeda)}</b><span>US$ ${precoTxt(m.preco)}</span><em class="${AX.cls(m.var)}">${m.var > 0 ? "+" : m.var < 0 ? "−" : ""}${AX.num(Math.abs(m.var), 2)}%</em></button>`).join("")}</div>
      <div class="nota">Dados da Binance em tempo real. Cripto negocia 24 horas, inclusive no fim de semana; a taxa da corretora entra nas contas.</div>`;
    el.querySelectorAll(".cr-item").forEach((b) => (b.onclick = () => { if (b.dataset.c !== AX.pref.ativo) AX.escolherAtivo(b.dataset.c); }));
  }
  function ligar() {
    clearInterval(C.relogio);
    render();
    if (AX.pref.mercado === "cripto") { buscar(); C.relogio = setInterval(buscar, 20000); }
  }
  AX.on("config", ligar);
  AX.on("mercado", () => { ligar(); if (AX.noticiasPrimeira) AX.noticiasPrimeira(); });
  AX.on("mudou", (o) => { if (o === "ativo") render(); });
})();
