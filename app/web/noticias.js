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
  const hora = (t) => new Date(t * 1000).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  async function buscar() {
    if (N.carregando) return;
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
        if (RK.pref.som) { RK.bip(660); setTimeout(() => RK.bip(990), 220); }
        const top = d.itens.find((x) => x.novo && x.impacto === "ALTO");
        if (top) RK.toast("📰 " + top.titulo, "aviso");
      }
      if (RK.aba === "news") render();
    } catch (e) {
      RK.erro("erroNews", e);
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
    $("newsAtual").textContent = `atualizado ${hora(d.atualizado)} · ${lista.length} de ${d.itens.length}`;
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

  const salvar = () => { try { localStorage.setItem(PREF, JSON.stringify({ imp: $("newsImpacto").value, at: $("newsAtivo").value })); } catch (e) { /* ok */ } render(); };
  $("newsImpacto").onchange = salvar; $("newsAtivo").onchange = salvar; $("newsBusca").oninput = render;
  RK.on("aba", (nome) => {
    if (nome !== "news") return;
    N.novos = 0; $("badgeNews").classList.add("oculto");
    render();
    buscar();
  });
  RK.on("config", () => { buscar(); setInterval(buscar, 60000); });
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
