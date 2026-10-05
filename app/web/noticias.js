/* ROBÔ KELLER — aba NOTÍCIAS: o que saiu nas últimas horas e pode mexer no WIN e no WDO.
   Busca a cada 60 s mesmo com outra aba aberta; notícia nova de ALTO impacto acende o contador e toca um aviso. */
(() => {
  "use strict";
  const RK = window.RK, $ = RK.$;
  const N = { dados: null, vistos: new Set(), primeira: true, novos: 0, carregando: false };
  const PREF = "rk_news";
  try { const p = JSON.parse(localStorage.getItem(PREF) || "{}"); if (p.imp) $("newsImpacto").value = p.imp; if (p.at != null) $("newsAtivo").value = p.at; } catch (e) { /* ok */ }

  const chave = (it) => it.titulo.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
  const ha = (t) => {
    const s = Math.max(0, Date.now() / 1000 - t);
    if (s < 60) return "agora";
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    return `há ${Math.floor(s / 3600)} h ${Math.floor((s % 3600) / 60)} min`;
  };
  const hora = (t) => RK.horaBR(t);

  async function buscar() {
    if (N.carregando) return null;
    N.carregando = true;
    try {
      const d = await RK.json("/api/noticias");
      RK.erro("erroNews", null);
      let novosAltos = 0;
      for (const it of d.itens) {
        const k = chave(it);
        if (!N.vistos.has(k)) {
          it.novo = !N.primeira;
          if (!N.primeira && it.impacto === "ALTO") novosAltos++;
          N.vistos.add(k);
        } else {
          const antigo = N.dados && N.dados.itens.find((x) => chave(x) === k);
          it.novo = !!(antigo && antigo.novo);
        }
      }
      N.dados = d;
      N.primeira = false;
      if (novosAltos) {
        if (RK.aba !== "news") { N.novos += novosAltos; $("badgeNews").textContent = N.novos; $("badgeNews").classList.remove("oculto"); }
        RK.som("aviso");
        const top = d.itens.find((x) => x.novo && x.impacto === "ALTO");
        if (top) RK.toast("📰 " + top.titulo, "aviso");
      }
      if (RK.aba === "news") render();
      return d.itens.length;
    } catch (e) {
      RK.erro("erroNews", e);
      return null;
    } finally {
      N.carregando = false;
    }
  }

  function render() {
    const d = N.dados;
    if (!d) { $("newsLista").innerHTML = `<div class="vazio-bloco">Buscando notícias…</div>`; return; }
    const imp = $("newsImpacto").value, at = $("newsAtivo").value, busca = $("newsBusca").value.trim().toLowerCase();
    const lista = d.itens.filter((it) => (imp === "TODOS" || (imp === "ALTO" ? it.impacto === "ALTO" : it.impacto !== "BAIXO")) &&
      (!at || it.ativos.includes(at)) && (!busca || it.titulo.toLowerCase().includes(busca)));
    $("newsAtual").textContent = `atualizado ${hora(d.atualizado)} (Brasília) · ${lista.length} de ${d.itens.length}`;
    $("newsLista").innerHTML = (lista.length ? `<div class="news">` + lista.map((it) => {
      const cls = it.impacto === "MÉDIO" ? "MEDIO" : it.impacto;
      return `<div class="nitem ${cls} ${it.novo ? "novo" : ""}">
        <div class="meta"><span class="tag ${cls}">${it.impacto}</span>${it.ativos.map((a) => `<span class="tag at">${a}</span>`).join("")}
          <span>${hora(it.t)} · ${ha(it.t)}</span><span>· ${RK.esc(it.fonte)}</span>${it.novo ? `<span class="tag" style="color:var(--amar)">NOVA</span>` : ""}</div>
        <div class="tit">${it.link ? `<a href="${RK.esc(it.link)}" target="_blank" rel="noopener noreferrer">${RK.esc(it.titulo)}</a>` : RK.esc(it.titulo)}</div>
        ${it.motivos.length ? `<div class="meta">por: ${it.motivos.map(RK.esc).join(", ")}</div>` : ""}</div>`;
    }).join("") + `</div>` : `<div class="vazio-bloco">Nenhuma notícia com esse filtro.</div>`) +
      (d.erros.length ? `<div class="nota">Fontes fora do ar agora: ${d.erros.map(RK.esc).join(" · ")}</div>` : "");
  }

  // ---------------------------------------------------------------- agenda econômica (eventos com hora marcada)
  const A = { dados: null, tudo: false };
  const MOEDAS = { WIN: ["BRL", "USD"], WDO: ["BRL", "USD"], EURUSD: ["EUR", "USD"], GBPUSD: ["GBP", "USD"], USDJPY: ["JPY", "USD"],
    AUDUSD: ["AUD", "USD", "CNY"], USTEC: ["USD"], JP225: ["JPY", "USD"], BTCUSD: ["USD"] };
  const moedasDe = (ativo) => (RK.ehCripto(ativo) ? ["USD"] : MOEDAS[ativo] || ["USD", "All"]);
  async function buscarAgenda() {
    try { A.dados = await RK.json("/api/agenda"); if (RK.aba === "news") renderAgenda(); } catch (e) { /* fica com a anterior */ }
  }
  function diaTxt(t) {
    const dia = RK.diaBR(t), agora = Date.now() / 1000;
    if (dia === RK.diaBR(agora)) return "hoje";
    if (dia === RK.diaBR(agora + 86400)) return "amanhã";
    return new Date(t * 1000).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short" }).replace(".", "") + " " + dia;
  }
  function renderAgenda() {
    const el = $("agendaCard"), d = A.dados;
    if (!d || !d.eventos.length) { el.classList.add("oculto"); return; }
    const agora = Date.now() / 1000, meus = new Set(moedasDe(RK.pref.ativo).concat(["BRL", "USD"]));
    const lista = d.eventos.filter((e) => e.t >= agora - 3600 && (A.tudo || (meus.has(e.moeda) && (e.impacto === "ALTO" || e.t <= agora + 36 * 3600))));
    const mostra = A.tudo ? lista : lista.slice(0, 7);
    el.classList.remove("oculto");
    el.innerHTML = `<div class="rot">AGENDA ECONÔMICA <span class="dir">hora de Brasília</span></div>` +
      (mostra.length ? mostra.map((e) => `<div class="ag ${e.t < agora ? "passou" : ""}" title="${RK.esc(e.original)}">
          <span class="ag-h">${diaTxt(e.t)} ${hora(e.t)}</span><span class="tag ${e.impacto}">${e.impacto === "ALTO" ? "ALTO" : "MÉDIO"}</span>
          <span class="ag-t"><b>${RK.esc(e.pais)}</b> · ${RK.esc(e.titulo)}${e.previsao || e.anterior ? ` <small class="neutro">${e.previsao ? "previsão " + RK.esc(e.previsao) : ""}${e.previsao && e.anterior ? " · " : ""}${e.anterior ? "anterior " + RK.esc(e.anterior) : ""}</small>` : ""}</span></div>`).join("")
        : `<div class="nota">Nenhum evento forte para este ativo nas próximas horas.</div>`) +
      `<div class="nota">Eventos com hora marcada que costumam mexer no mercado (Brasil, EUA e as moedas do ativo do topo). Nos estudos o mercado anda <b>mais</b> nesses horários: saltos e spread maiores. <a href="#" id="agTudo">${A.tudo ? "ver só os principais" : "ver a semana inteira"}</a></div>`;
    $("agTudo").onclick = (ev) => { ev.preventDefault(); A.tudo = !A.tudo; renderAgenda(); };
  }
  // aviso no cartão "o que fazer agora": evento forte para o ativo nos próximos 30 min (ou que acabou de sair)
  RK.agendaAviso = (ativo) => {
    if (!A.dados) return "";
    const agora = Date.now() / 1000, m = moedasDe(ativo);
    const e = A.dados.eventos.find((x) => x.impacto === "ALTO" && m.includes(x.moeda) && x.t - agora <= 1800 && agora - x.t <= 600);
    if (!e) return "";
    const min = Math.round((e.t - agora) / 60);
    return `<div class="detalhe aviso-agenda">⏰ ${hora(e.t)} · <b>${RK.esc(e.titulo)}</b> (${RK.esc(e.pais)}) ${min > 0 ? "em " + min + " min" : min === 0 ? "agora" : "saiu há " + -min + " min"}. Nessa hora o mercado costuma saltar e o spread abre.</div>`;
  };
  RK.on("config", () => { buscarAgenda(); setInterval(buscarAgenda, 30 * 60000); });
  RK.on("mudou", (o) => { if (o === "ativo" && RK.aba === "news") renderAgenda(); });

  const salvar = () => { try { localStorage.setItem(PREF, JSON.stringify({ imp: $("newsImpacto").value, at: $("newsAtivo").value })); } catch (e) { /* ok */ } render(); };
  $("newsImpacto").onchange = salvar; $("newsAtivo").onchange = salvar; $("newsBusca").oninput = render;
  RK.on("aba", (nome) => {
    if (nome !== "news") return;
    N.novos = 0; $("badgeNews").classList.add("oculto");
    renderAgenda();
    render();
    buscar();
  });
  // a tela de abertura faz a 1a busca; depois, a cada 60 s (mesmo com outra aba aberta)
  RK.noticiasPrimeira = () => buscar();
  RK.on("config", () => setInterval(buscar, 60000));
  setInterval(() => { if (RK.aba === "news" && N.dados) render(); }, 30000);          // atualiza o "há X min"

  // status da base de 5 meses no rodapé
  async function base() {
    try {
      const b = await RK.json("/api/base");
      const falta = Object.entries(b.dias).filter(([, n]) => n < b.meta * 0.8);
      $("baseStatus").textContent = b.rodando ? `⬇ base de 5 meses: ${b.feitos}/${b.total} dias baixados (${b.atual || "…"})` :
        falta.length ? `base de 5 meses incompleta: ${falta.map(([c, n]) => c + " " + n + "d").join(", ")}` : "";
    } catch (e) { $("baseStatus").textContent = ""; }
  }
  RK.on("config", () => { base(); setInterval(base, 30000); });
})();
