/* ROBÔ APEX: mini tutorial. Abre sozinho na primeira vez de cada usuário (depois, no botão "?" do topo).
   Cada passo acende uma parte da tela e explica em uma ou duas frases. */
(() => {
  "use strict";
  const AX = window.AX, $ = AX.$;
  const PASSOS = [
    { sel: null, tit: "Bem-vindo ao Robô Apex", txt: "Um robô de <b>estratégias de day trade</b> para ações da B3, opções e cripto. Ele mostra onde cada estratégia entraria e sairia, testa no passado com custos reais e roda testes ao vivo. As decisões são sempre suas. Leva 1 minuto." },
    { sel: "#mercado", tit: "1. Escolha o mercado", txt: "<b>Bolsa</b> (mini índice, mini dólar e ações da B3), <b>Opções</b> da B3 ou <b>Cripto</b> (Binance, em tempo real). Cada mercado tem a sua lista de ativos e as suas notícias." },
    { sel: ["#ativo", "#tf"], tit: "2. Ativo e tempo gráfico", txt: "O que analisar e quanto dura cada candle. Para começar, 5 minutos no WIN é um bom ponto de partida." },
    { sel: "#est", tit: "3. A estratégia", txt: "A regra que procura as entradas. As marcadas com ★ são as suas favoritas. No painel, o botão <b>Como funciona</b> mostra o desenho e o passo a passo de cada uma." },
    { sel: ".acoes-topo", tit: "4. Testar estratégia e Minhas estratégias", txt: "<b>▶ Testar estratégia</b> roda a escolhida em 5, 15 e 60 minutos e mostra quanto ganhou e perdeu, mês a mês e semana a semana. <b>★ Minhas estratégias</b> compara as suas favoritas de uma vez." },
    { sel: "#areaGrafico", tit: "5. O gráfico", txt: "Cada operação aparece com a entrada, o stop, o alvo e a saída, em reais. Clique numa operação da lista para ver o <b>replay</b> e para <b>editar</b> o stop e o alvo arrastando as linhas. Botão direito muda o fundo e as linhas." },
    { sel: "#cardBoleta", aba: "vivo", tit: "6. Boleta simulada", txt: "Compre e venda na hora, com contratos, stop e alvo, sem dinheiro. O robô executa com os preços de agora e mostra o resultado em reais." },
    { sel: ".abas", tit: "7. As abas do painel", txt: "<b>Agora</b>: o que está acontecendo. <b>Resultado</b>: o período, gestão e stops, dia a dia. <b>Plano</b>: quanto arriscar. <b>Aprender</b>: o que a IA e você aprenderam. <b>Notícias</b>. <b>Conectar</b>: a sua corretora." },
    { sel: "#btTutorial", tit: "Pronto!", txt: "Para ver este passeio de novo, use o <b>?</b> do topo. Lembre: é uma ferramenta de estudo; resultado passado não garante resultado futuro e as ordens são sempre decisão sua." },
  ];
  let k = 0, el = null;
  function caixa(sel) {
    const lista = (Array.isArray(sel) ? sel : [sel]).map((s) => document.querySelector(s)).filter((x) => x && x.offsetParent !== null);
    if (!lista.length) return null;
    const rs = lista.map((x) => x.getBoundingClientRect());
    return { x: Math.min(...rs.map((r) => r.left)), y: Math.min(...rs.map((r) => r.top)), w: Math.max(...rs.map((r) => r.right)) - Math.min(...rs.map((r) => r.left)),
      h: Math.max(...rs.map((r) => r.bottom)) - Math.min(...rs.map((r) => r.top)) };
  }
  function pintar() {
    const p = PASSOS[k];
    if (p.aba && AX.aba !== p.aba && AX.trocarAba) AX.trocarAba(p.aba);
    const r = p.sel ? caixa(p.sel) : null;
    const luz = el.querySelector(".tut-luz"), bal = el.querySelector(".tut-balao");
    if (r) {
      const m = 6;
      Object.assign(luz.style, { display: "block", left: r.x - m + "px", top: r.y - m + "px", width: r.w + 2 * m + "px", height: r.h + 2 * m + "px" });
    } else luz.style.display = "none";
    bal.innerHTML = `<small>${k + 1} de ${PASSOS.length}</small><h3>${p.tit}</h3><p>${p.txt}</p>
      <div class="tut-bts"><button id="tutPular" class="mini-btn">${k === PASSOS.length - 1 ? "" : "pular tutorial"}</button>
        <span>${k ? '<button id="tutVolta">← voltar</button>' : ""}<button id="tutVai" class="primario">${k === PASSOS.length - 1 ? "Começar" : "Próximo →"}</button></span></div>`;
    const W = window.innerWidth, H = window.innerHeight, bw = Math.min(360, W - 24);
    bal.style.width = bw + "px";
    const bh = bal.offsetHeight || 180;
    let x = W / 2 - bw / 2, y = H / 2 - bh / 2;
    if (r) {
      x = Math.max(12, Math.min(W - bw - 12, r.x + r.w / 2 - bw / 2));
      y = r.y + r.h + 16 + bh < H ? r.y + r.h + 16 : r.y - bh - 16 > 0 ? r.y - bh - 16 : Math.max(12, H / 2 - bh / 2);
      if (r.h > H * 0.6) { y = Math.max(12, Math.min(H - bh - 12, r.y + 24)); x = r.x + r.w - bw - 24 > 12 ? r.x + r.w - bw - 24 : x; }
    }
    bal.style.left = x + "px"; bal.style.top = y + "px";
    const b = (id, fn) => { const z = el.querySelector("#" + id); if (z) z.onclick = fn; };
    b("tutVai", () => (k === PASSOS.length - 1 ? fechar() : (k++, pintar())));
    b("tutVolta", () => { k--; pintar(); });
    b("tutPular", fechar);
  }
  function abrir() {
    fechar(true);
    k = 0;
    el = document.createElement("div");
    el.className = "tutorial";
    el.innerHTML = '<div class="tut-luz"></div><div class="tut-balao"></div>';
    document.body.appendChild(el);
    pintar();
    window.addEventListener("resize", pintar);
  }
  function fechar(silencioso) {
    if (!el) return;
    el.remove(); el = null;
    window.removeEventListener("resize", pintar);
    if (silencioso !== true) { AX.pref.tutorialVisto = true; AX.salvarPref(); }
  }
  AX.on("tecla", (e) => { if (el && e.key === "Escape") fechar(); });
  // primeira vez: depois que a tela de abertura sai
  AX.on("config", () => {
    if (AX.pref.tutorialVisto || /[?&](acao|aba|pop|op|conta|tutorial)=/.test(location.search)) return;
    const esperar = () => (document.getElementById("splash") ? setTimeout(esperar, 400) : setTimeout(abrir, 700));
    setTimeout(esperar, 800);
  });
  AX.tutorial = { abrir, fechar };
})();
