/* ROBÔ APEX: modo vitrine (?vitrine=1). Borra o nome das estratégias em qualquer texto da tela, para prints de divulgação. */
(() => {
  "use strict";
  if (!/[?&]vitrine=1/.test(location.search)) return;
  const AX = window.AX;
  document.body.classList.add("vitrine");
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let fonte = "";
  function borrar(raiz) {
    if (!fonte) return;
    const teste = new RegExp(fonte);
    const w = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && !n.parentElement.closest(".borrado, script, style, select, option") && teste.test(n.nodeValue) ? 1 : 2),
    });
    const lista = [];
    while (w.nextNode()) lista.push(w.currentNode);
    for (const n of lista) {
      const frag = document.createDocumentFragment(), txt = n.nodeValue, g = new RegExp(fonte, "g");
      let i = 0, m;
      while ((m = g.exec(txt))) {
        if (m.index > i) frag.appendChild(document.createTextNode(txt.slice(i, m.index)));
        const sp = document.createElement("span");
        sp.className = "borrado";
        sp.textContent = m[0];
        frag.appendChild(sp);
        i = m.index + m[0].length;
      }
      if (i < txt.length) frag.appendChild(document.createTextNode(txt.slice(i)));
      n.parentNode.replaceChild(frag, n);
    }
  }
  AX.on("config", (cfg) => {
    const nomes = cfg.estrategias.map((e) => e.nome).filter((x) => x && x.length > 3).sort((a, b) => b.length - a.length);
    fonte = nomes.map(escRe).join("|");
    borrar(document.body);
    new MutationObserver((ms) => {
      for (const m of ms) for (const n of m.addedNodes) {
        if (n.nodeType === 1) borrar(n);
        else if (n.nodeType === 3 && n.parentElement) borrar(n.parentElement);
      }
    }).observe(document.body, { childList: true, subtree: true });
  });
})();
