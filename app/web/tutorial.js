/* ROBÔ APEX: mini tutorial. Abre sozinho na primeira vez de cada usuário (depois, no botão "?" do topo).
   Enquanto ele está aberto, a tela de trás fica parada e embaçada (nenhum clique passa) até a pessoa seguir ou pular.
   Cada passo acende uma parte da tela, que fica nítida, e explica em poucas frases. */
(() => {
  "use strict";
  const AX = window.AX;
  const PASSOS = [
    { sel: null, tit: "Bem-vindo ao Robô Apex", txt: "Um robô de <b>estratégias de day trade</b> para ações da B3, opções e cripto. Ele mostra onde cada estratégia entraria e sairia, testa no passado com custos reais e roda testes ao vivo. As decisões são sempre suas. Leva 2 minutos." },
    { sel: "#mercado", tit: "Escolha o mercado", txt: "<b>Bolsa</b> (mini índice, mini dólar e ações da B3), <b>Opções</b> da B3 ou <b>Cripto</b> (Binance, em tempo real). Cada mercado tem a sua lista de ativos, as suas notícias e os seus avisos." },
    { sel: "#ativo", tit: "O ativo", txt: "O que analisar: WIN, WDO, ações como PETR4 e VALE3, índices de fora, ouro ou uma criptomoeda." },
    { sel: "#tf", tit: "O tempo gráfico", txt: "Quanto tempo dura cada candle. <b>2 e 5 minutos</b>: muitas operações no dia, movimentos curtos e o custo pesa mais. <b>15 e 30 minutos</b>: menos operações, sinais mais limpos. <b>60 minutos</b>: poucas operações, stops e alvos maiores. <b>Diário</b>: um candle por dia, para ver a tendência. A mesma estratégia muda bastante de um tempo para outro: compare no ▶ Testar." },
    { sel: "#est", tit: "A estratégia", txt: "A regra que procura as entradas. Ela é seguida à risca: entrada, stop e alvo saem da regra, sem palpite. <b>⟳ Rodízio automático</b> deixa o robô escolher, a cada dia, as 3 estratégias que mais ganharam nos 20 pregões anteriores. As marcadas com ★ são as suas favoritas. No painel, <b>Como funciona</b> mostra o desenho e o passo a passo de cada uma." },
    { sel: "#periodo", tit: "O período", txt: "Quais dias o robô mostra e conta: hoje, 5 dias, 1 mês, 3 meses, tudo, ou datas escolhidas no 📅. Todos os números da tela são deste período." },
    { sel: ".acoes-topo", tit: "Testar, Minhas e Replay", txt: "<b>▶ Testar</b> roda a estratégia escolhida em 5, 15 e 60 minutos e mostra a curva do resultado dia a dia, mês a mês e semana a semana. <b>★ Minhas</b> compara as suas favoritas de uma vez. <b>⏪ Replay</b> escolhe um dia e toca o pregão inteiro candle a candle, com a estratégia entrando e saindo na hora, na velocidade que você quiser." },
    { sel: "#btTempoReal", tit: "AO VIVO", txt: "Saiu do tempo real (replay, data antiga, gráfico arrastado)? O botão <b>● AO VIVO</b> volta na hora para o candle de agora, com o preço atualizando sozinho." },
    { sel: "#btAoVivo", tit: "Robôs ligados", txt: "Mostra os testes ao vivo que você ligou neste mercado: quanto fizeram hoje e desde que foram ligados. Sem teste ligado, fica em <b>standby</b>: nenhuma estratégia roda sozinha. Quando um teste entra ou sai, aparece um aviso na tela." },
    { sel: "#areaGrafico", tit: "O gráfico", txt: "Cada operação aparece com o sinal, a entrada, o stop, o alvo e a saída, em reais. Arraste para os lados para andar no tempo, use a rodinha do mouse para dar zoom e <b>⌖ Centralizar</b> para voltar ao último candle. Clique numa operação da lista para ver o <b>replay</b> dela." },
    { sel: "#ferramentas", tit: "Desenhos", txt: "A barra da esquerda tem as ferramentas de desenho: <b>linhas</b> de tendência e horizontais, <b>Fibonacci</b>, <b>retângulos</b>, <b>texto</b>, <b>régua</b> para medir pontos e reais, o <b>ímã</b> que gruda o desenho no preço do candle, esconder desenhos, a <b>cor</b>, desfazer e apagar. Botão direito em cima de um desenho muda cor, espessura ou apaga só ele. Os desenhos ficam salvos por ativo." },
    { sel: ".graf-botoes", tit: "Edições no gráfico e nos candles", txt: "<b>Candles</b>: cores de alta e de baixa, candle cheio ou vazado. <b>Indicadores</b>: médias, VWAP, Bollinger, volume, IFR. <b>Volume por preço</b>: onde houve mais negócio. Botão direito no gráfico muda o fundo, a grade e as linhas. Numa operação, dá para <b>arrastar o stop e o alvo</b> no editor <b>E se…</b> e ver o que teria acontecido; se gostar, vira a sua regra." },
    { sel: "#cardBoleta", aba: "vivo", tit: "Boleta simulada", txt: "Compre e venda na hora, com contratos, stop e alvo, sem dinheiro. O robô executa com os preços de agora e mostra o resultado em reais." },
    { sel: ".abas", tit: "As abas do painel", txt: "<b>Agora</b>: o que está acontecendo. <b>Resultado</b>: o período, gestão e stops, dia a dia. <b>Plano</b>: quanto arriscar. <b>Aprender</b>: o que a IA e você aprenderam. <b>Notícias</b>. <b>Conectar</b>: a sua corretora." },
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
  // quatro vidros embaçados em volta do buraco: o que está aceso fica nítido, o resto fica embaçado e escuro
  function veus(r) {
    const W = window.innerWidth, H = window.innerHeight, v = el.querySelectorAll(".tut-veu");
    const pos = r ? [[0, 0, W, Math.max(0, r.y)], [0, r.y + r.h, W, Math.max(0, H - r.y - r.h)], [0, r.y, Math.max(0, r.x), r.h], [r.x + r.w, r.y, Math.max(0, W - r.x - r.w), r.h]]
      : [[0, 0, W, H], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
    pos.forEach((p, i) => Object.assign(v[i].style, { left: p[0] + "px", top: p[1] + "px", width: p[2] + "px", height: p[3] + "px" }));
  }
  function pintar() {
    if (!el) return;
    const p = PASSOS[k];
    if (p.aba && AX.aba !== p.aba && AX.trocarAba) AX.trocarAba(p.aba);
    const r0 = p.sel ? caixa(p.sel) : null, m = 6;
    const r = r0 ? { x: r0.x - m, y: r0.y - m, w: r0.w + 2 * m, h: r0.h + 2 * m } : null;
    const luz = el.querySelector(".tut-luz"), bal = el.querySelector(".tut-balao");
    veus(r);
    if (r) Object.assign(luz.style, { display: "block", left: r.x + "px", top: r.y + "px", width: r.w + "px", height: r.h + "px" });
    else luz.style.display = "none";
    bal.innerHTML = `<small>${k + 1} de ${PASSOS.length}</small><h3>${p.tit}</h3><p>${p.txt}</p>
      <div class="tut-pontos">${PASSOS.map((_, i) => `<i class="${i === k ? "on" : i < k ? "foi" : ""}"></i>`).join("")}</div>
      <div class="tut-bts"><button id="tutPular" class="mini-btn">${k === PASSOS.length - 1 ? "" : "pular tutorial"}</button>
        <span>${k ? '<button id="tutVolta">← voltar</button>' : ""}<button id="tutVai" class="primario">${k === 0 ? "Começar o tutorial" : k === PASSOS.length - 1 ? "Começar a usar" : "Próximo →"}</button></span></div>`;
    const W = window.innerWidth, H = window.innerHeight, bw = Math.min(400, W - 24);
    bal.style.width = bw + "px";
    const bh = bal.offsetHeight || 200;
    let x = W / 2 - bw / 2, y = H / 2 - bh / 2;
    if (r) {
      x = Math.max(12, Math.min(W - bw - 12, r.x + r.w / 2 - bw / 2));
      y = r.y + r.h + 16 + bh < H ? r.y + r.h + 16 : r.y - bh - 16 > 0 ? r.y - bh - 16 : Math.max(12, H / 2 - bh / 2);
      if (r.h > H * 0.6) {             // área grande (gráfico, barra de desenho): o balão vai para dentro dela, longe da borda acesa
        y = Math.max(12, Math.min(H - bh - 12, r.y + 40));
        x = r.w > bw + 120 ? Math.min(W - bw - 12, r.x + r.w - bw - 40) : Math.min(W - bw - 12, r.x + r.w + 16);
      }
    }
    bal.style.left = x + "px"; bal.style.top = y + "px";
    const b = (id, fn) => { const z = el.querySelector("#" + id); if (z) z.onclick = fn; };
    b("tutVai", () => (k === PASSOS.length - 1 ? fechar() : (k++, pintar())));
    b("tutVolta", () => { k--; pintar(); });
    b("tutPular", fechar);
    setTimeout(() => { const z = el && el.querySelector("#tutVai"); if (z) z.focus({ preventScroll: true }); }, 30);
  }
  const parar = (e) => { if (el && !el.querySelector(".tut-balao").contains(e.target)) { e.preventDefault(); e.stopPropagation(); } };
  function abrir() {
    fechar(true);
    k = 0;
    el = document.createElement("div");
    el.className = "tutorial";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-label", "Tutorial do Robô Apex");
    el.innerHTML = '<div class="tut-veu"></div><div class="tut-veu"></div><div class="tut-veu"></div><div class="tut-veu"></div><div class="tut-luz"></div><div class="tut-balao"></div>';
    document.body.appendChild(el);
    document.body.classList.add("tut-aberto");
    // tela congelada: nenhum clique, rolagem ou tecla chega na tela de trás
    for (const ev of ["wheel", "pointerdown", "mousedown", "click", "dblclick", "contextmenu", "touchstart"]) window.addEventListener(ev, parar, { capture: true, passive: false });
    pintar();
    window.addEventListener("resize", pintar);
  }
  function fechar(silencioso) {
    if (!el) return;
    el.remove(); el = null;
    document.body.classList.remove("tut-aberto");
    for (const ev of ["wheel", "pointerdown", "mousedown", "click", "dblclick", "contextmenu", "touchstart"]) window.removeEventListener(ev, parar, { capture: true });
    window.removeEventListener("resize", pintar);
    if (silencioso !== true) { AX.pref.tutorialVisto = true; AX.salvarPref(); }
  }
  AX.on("tecla", (e) => {
    if (!el) return;
    if (e.key === "Escape") fechar();
    else if (e.key === "ArrowRight") { if (k < PASSOS.length - 1) { k++; pintar(); } }
    else if (e.key === "ArrowLeft") { if (k > 0) { k--; pintar(); } }
  });
  // primeira vez: depois que a tela de abertura sai
  AX.on("config", () => {
    if (AX.pref.tutorialVisto || /[?&](acao|aba|pop|op|conta|tutorial)=/.test(location.search)) return;
    const esperar = () => (document.getElementById("splash") ? setTimeout(esperar, 400) : setTimeout(abrir, 700));
    setTimeout(esperar, 800);
  });
  AX.tutorial = { abrir, fechar, aberto: () => !!el };
})();
