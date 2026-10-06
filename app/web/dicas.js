/* ROBÔ APEX — dicas: o balãozinho que explica um botão ou um número. Qualquer elemento com o atributo data-dica ganha a
   explicação ao passar o mouse (ou ao receber o foco pelo teclado); os pontinhos "?" (<i class="q" data-dica="...">)
   abrem na hora e também com um clique/toque. O texto é lido do atributo a cada vez: quem muda o data-dica com o mouse
   em cima (a curvinha do resultado, por exemplo) vê o balão acompanhar. */
(() => {
  "use strict";
  const tip = document.createElement("div");
  tip.className = "dica"; tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  let alvo = null, relogio = null, visivel = false, texto = "", mx = 0, my = 0, fixo = false;
  const achar = (el) => (el && el.nodeType === 1 && el.closest ? el.closest("[data-dica]") : null);
  const M = 8;
  function posicionar() {
    const r = alvo.getBoundingClientRect(), tw = tip.offsetWidth, th = tip.offsetHeight;
    const segue = alvo.tagName === "CANVAS";                 // num gráfico o balão acompanha o mouse
    let x = (segue ? mx : r.left + r.width / 2) - tw / 2, y = (segue ? Math.min(my + 18, r.bottom + 6) : r.bottom + 7);
    if (y + th > window.innerHeight - M) y = (segue ? my - 14 : r.top - 7) - th;
    y = Math.max(M, Math.min(window.innerHeight - th - M, y));
    x = Math.max(M, Math.min(window.innerWidth - tw - M, x));
    tip.style.left = Math.round(x) + "px"; tip.style.top = Math.round(y) + "px";
  }
  function mostrar() {
    relogio = null;
    if (!alvo || !alvo.isConnected) return esconder();
    const t = alvo.getAttribute("data-dica");
    if (!t) return esconder();
    if (t !== texto) { texto = t; tip.textContent = t; }
    tip.classList.add("on"); visivel = true; posicionar();
  }
  function esconder() {
    clearTimeout(relogio); relogio = null; alvo = null; visivel = false; fixo = false; texto = "";
    tip.classList.remove("on");
  }
  document.addEventListener("mouseover", (e) => {
    const el = achar(e.target);
    if (el === alvo || fixo) return;
    esconder();
    if (!el) return;
    alvo = el; mx = e.clientX; my = e.clientY;
    relogio = setTimeout(mostrar, el.classList.contains("q") ? 90 : 420);     // o "?" responde na hora; um botão espera um pouco
  });
  document.addEventListener("mousemove", (e) => {
    if (!alvo) return;
    mx = e.clientX; my = e.clientY;
    if (visivel && (alvo.tagName === "CANVAS" || alvo.getAttribute("data-dica") !== texto)) mostrar();
  }, { passive: true });
  document.addEventListener("mouseout", (e) => { if (alvo && !fixo && achar(e.relatedTarget) !== alvo) esconder(); });
  // clique: no "?" abre e fecha (serve para toque); em qualquer outro lugar fecha o balão
  document.addEventListener("pointerdown", (e) => {
    const el = achar(e.target);
    if (el && el.classList.contains("q")) {
      if (fixo && alvo === el) return esconder();
      esconder(); alvo = el; fixo = true; mostrar();
      return;
    }
    esconder();
  }, true);
  document.addEventListener("click", (e) => { const el = achar(e.target); if (el && el.classList.contains("q")) { e.preventDefault(); e.stopPropagation(); } }, true);     // o "?" dentro de um rótulo não aciona o campo
  document.addEventListener("focusin", (e) => {
    const el = achar(e.target);
    let teclado = false;
    try { teclado = !!el && e.target.matches(":focus-visible") && !/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName); } catch (err) { teclado = false; }
    if (!teclado) return;
    esconder(); alvo = el; relogio = setTimeout(mostrar, 250);
  });
  document.addEventListener("focusout", () => { if (!fixo) esconder(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && (visivel || relogio)) esconder(); }, true);
  window.addEventListener("scroll", esconder, true);
  window.addEventListener("resize", esconder);
  window.addEventListener("blur", esconder);
  if (window.AX) window.AX.dicaFechar = esconder;
})();
