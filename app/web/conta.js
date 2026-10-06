/* ROBÔ APEX — conta: o botão do usuário no topo, o menu dele e a janela com "Minha conta", "Avisos no celular" e, só
   para o administrador, "Usuários" e "Registro de acessos". Quem pode o quê é decidido no servidor (auth.py): a tela
   apenas deixa de mostrar o que seria recusado. Todo texto que vem do servidor ou do teclado passa por AX.esc antes
   de virar HTML: o registro guarda até o que um estranho digitou no campo de e-mail da tela de entrada. */
(() => {
  "use strict";
  const AX = window.AX, esc = AX.esc;
  const $ = (id) => document.getElementById(id);
  const eu = () => (AX.cfg && AX.cfg.usuario) || null;
  const papelTxt = (p) => (p === "admin" ? "Administrador" : "Usuário");
  const nomeDe = (u) => String(u.nome || "").trim() || String(u.email || "").split("@")[0] || "Conta";
  const ADMIN_PRINCIPAL = "admin";           // id do administrador que já vem criado (auth.py): o servidor não deixa apagá-lo
  const SECOES = [["conta", "Minha conta"], ["avisos", "Avisos no celular"], ["usuarios", "Usuários", true], ["registro", "Registro de acessos", true]];
  const permitidas = () => SECOES.filter((s) => !s[2] || (eu() && eu().papel === "admin"));       // s[2] = só administrador
  const J = { fundo: null, janela: null, abas: null, corpo: null, vivo: null, email: null, secao: "", vez: 0, antes: null };      // a janela
  const U = { lista: [], prov: null };       // usuários; prov = senha provisória recém-sorteada (aparece uma única vez)
  const R = { seq: 0, relogio: null };       // registro: número do último pedido e o relógio da busca

  // ---------------------------------------------------------------- servidor
  // Feito aqui, e não por AX.json, porque o status da resposta importa: 401 quer dizer que a sessão terminou e 403 com
  // "trocar", que a senha é provisória. Nos dois casos quem resolve é a tela de entrada: a página volta para "/".
  async function pedir(url, corpo) {
    const ctl = new AbortController(), relogio = setTimeout(() => ctl.abort(), 60000);     // pedido que nunca volta não trava a janela
    let r, j = null;
    try {
      r = await fetch(url, Object.assign({ signal: ctl.signal, credentials: "same-origin" },
        corpo === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
      j = await r.json();
    } catch (e) {
      if (e.name === "AbortError") throw new Error("O robô demorou demais para responder.");
      if (!r) throw new Error("O robô não respondeu. Ele ainda está aberto?");
    } finally { clearTimeout(relogio); }
    if (r.status === 401 || (r.status === 403 && j && j.trocar)) { location.replace("/"); return new Promise(() => {}); }      // nada mais a fazer nesta página
    if (!r.ok || !j || j.erro) throw new Error((j && j.erro) || `Resposta inválida do robô (HTTP ${r.status}).`);
    return j;
  }

  // dd/mm hh:mm no horário de Brasília; com o ano quando faz muito tempo (um "último acesso" antigo não pode parecer recente)
  function quando(t, seg = false) {
    if (!(t > 0)) return "—";
    const ano = Date.now() / 1000 - t > 300 * 86400 ? "/" + new Date(t * 1000).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo", year: "numeric" }) : "";
    return `${AX.diaBR(t)}${ano} ${AX.horaBR(t, seg)}`;
  }

  // ================================================================ 1. botão do topo e menu do usuário
  const bt = $("btConta");
  let menu = null, dica = null;
  const menuAberto = () => !!menu && !menu.classList.contains("oculto");

  function pintarBotao() {
    const u = eu();
    if (!u) return;
    if (J.email) J.email.textContent = u.email;
    if (!bt) return;
    const nome = nomeDe(u);
    bt.classList.add("ct-botao");
    bt.innerHTML = `<span class="ct-inicial" aria-hidden="true">${esc(Array.from(nome)[0].toUpperCase())}</span><span class="ct-primeiro">${esc(nome.split(/\s+/)[0])}</span>`;
    bt.setAttribute("aria-label", "Conta de " + nome);
    bt.setAttribute("aria-haspopup", "menu");
    bt.setAttribute("aria-expanded", String(menuAberto()));
  }
  function atualizarEu(u) {                  // o servidor devolveu os meus dados depois de uma mudança
    if (!u || !AX.cfg) return;
    AX.cfg.usuario = Object.assign({}, AX.cfg.usuario, u);
    pintarBotao();
  }

  function abrirMenu() {
    const u = eu();
    if (!u || !bt) return;
    if (!menu) {
      menu = document.createElement("div");
      menu.className = "ct-menu oculto";
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Conta");
      document.body.appendChild(menu);
      menu.addEventListener("click", (e) => {
        const b = e.target.closest("button[data-item]");
        if (!b) return;
        fecharMenu();
        if (b.dataset.item === "sair") sair(); else abrir(b.dataset.item);
      });
      menu.addEventListener("keydown", teclasDoMenu);
    }
    if (AX.fecharPopovers) AX.fecharPopovers();
    menu.innerHTML = `<div class="ct-quem" role="none"><b>${esc(nomeDe(u))}</b><span>${esc(u.email)}</span><small>${papelTxt(u.papel)}</small></div>` +
      permitidas().map(([id, nome]) => `<button type="button" role="menuitem" data-item="${id}">${nome}</button>`).join("") +
      `<div class="ct-sep" role="separator"></div><button type="button" role="menuitem" class="ct-sair" data-item="sair">Sair</button>`;
    menu.classList.remove("oculto");
    // fixo na janela (não rola com a página): logo abaixo do botão, alinhado à direita dele e sem sair da tela
    const r = bt.getBoundingClientRect(), w = menu.offsetWidth, W = document.documentElement.clientWidth;
    menu.style.top = Math.round(r.bottom + 6) + "px";
    menu.style.left = Math.round(Math.max(8, Math.min(r.right - w, W - w - 8))) + "px";
    menu.style.maxHeight = Math.max(140, window.innerHeight - r.bottom - 14) + "px";
    // o balão de explicação do botão (dicas.js lê o data-dica a cada vez) abriria bem em cima do menu: fica guardado
    if (bt.hasAttribute("data-dica")) { dica = bt.getAttribute("data-dica"); bt.removeAttribute("data-dica"); }
    bt.setAttribute("aria-expanded", "true");
    menu.querySelector("button").focus();
  }
  function fecharMenu(devolverFoco) {
    if (!menuAberto()) return;
    menu.classList.add("oculto");
    if (dica) bt.setAttribute("data-dica", dica);
    bt.setAttribute("aria-expanded", "false");
    if (devolverFoco) bt.focus();
  }
  function teclasDoMenu(e) {
    // Com o menu aberto as teclas são dele: lá fora as setas movem o desenho selecionado e o espaço toca o replay.
    e.stopPropagation();
    const itens = [...menu.querySelectorAll("button")], i = itens.indexOf(document.activeElement);
    const ir = (j) => { e.preventDefault(); itens[(j + itens.length) % itens.length].focus(); };
    if (e.key === "Escape") { e.preventDefault(); fecharMenu(true); }
    else if (e.key === "Tab") fecharMenu(true);        // o Tab segue o caminho normal a partir do botão
    else if (e.key === "ArrowDown") ir(i + 1);
    else if (e.key === "ArrowUp") ir(i - 1);
    else if (e.key === "Home") ir(0);
    else if (e.key === "End") ir(-1);
  }
  async function sair() {
    try { await pedir("/api/acesso/sair", {}); location.replace("/"); }
    catch (e) { AX.toast("Não consegui sair: " + e.message, "erro"); }
  }

  // ================================================================ 2. a janela (uma só, com abas)
  const aberta = () => !!J.fundo && !J.fundo.classList.contains("oculto");
  const FOCAVEIS = "a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary";

  function criarJanela() {
    const f = (J.fundo = document.createElement("div"));
    f.className = "ct-fundo oculto";
    f.innerHTML = `<div class="ct-janela" role="dialog" aria-modal="true" aria-labelledby="ctTitulo" tabindex="-1">
        <div class="ct-cab">
          <h2 class="ct-titulo" id="ctTitulo">Conta <small id="ctEmail"></small></h2>
          <button type="button" class="ct-fechar" id="ctFechar" data-dica="Fechar (Esc)" aria-label="Fechar">✕</button>
          <div class="ct-abas" id="ctAbas" role="tablist" aria-label="Seções da conta"></div>
        </div>
        <div class="ct-corpo" id="ctCorpo" role="tabpanel"></div>
        <div class="ct-sr" id="ctVivo" role="status"></div>
      </div>`;
    document.body.appendChild(f);
    J.janela = f.firstElementChild; J.abas = $("ctAbas"); J.corpo = $("ctCorpo"); J.vivo = $("ctVivo"); J.email = $("ctEmail");
    // fecha só se o clique COMEÇA no fundo: arrastar uma seleção de texto para fora da janela não pode fechá-la
    f.addEventListener("pointerdown", (e) => { if (e.target === f) fechar(); });
    $("ctFechar").addEventListener("click", fechar);
    J.abas.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-secao]");
      if (b && b.dataset.secao !== J.secao) mostrar(b.dataset.secao);
    });
    J.abas.addEventListener("keydown", (e) => {        // setas trocam de aba, como em qualquer conjunto de abas
      const passo = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0, ids = permitidas().map((s) => s[0]);
      if (!passo) return;
      e.preventDefault();
      mostrar(ids[(ids.indexOf(J.secao) + passo + ids.length) % ids.length], true);
    });
    J.janela.addEventListener("keydown", (e) => {
      // A janela é modal: o que se digita nela não pode chegar aos atalhos da tela de trás (Delete apaga o desenho
      // selecionado, as setas o movem, o espaço toca o replay). E o Esc fecha mesmo com o foco dentro de um campo,
      // caso em que o app.js nem repassa a tecla.
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); fechar(); return; }
      if (e.key !== "Tab") return;
      // o Tab dá a volta dentro da janela em vez de escapar para a tela de trás
      const itens = [...J.janela.querySelectorAll(FOCAVEIS)].filter((el) => el.tabIndex >= 0 && el.getClientRects().length);
      const a = document.activeElement, ult = itens[itens.length - 1];
      if (!itens.length) e.preventDefault();
      else if (e.shiftKey && (a === itens[0] || a === J.janela)) { e.preventDefault(); ult.focus(); }
      else if (!e.shiftKey && a === ult) { e.preventDefault(); itens[0].focus(); }
    });
  }

  function abrir(secao) {
    if (!eu()) return;                       // o servidor ainda não disse quem entrou
    if (!J.fundo) criarJanela();
    fecharMenu();
    if (!aberta()) {
      const a = document.activeElement;
      J.antes = a && a !== document.body && !(menu && menu.contains(a)) ? a : bt;      // para onde o foco volta ao fechar
      J.fundo.classList.remove("oculto");
      document.body.classList.add("ct-aberta");
    }
    const ids = permitidas().map((s) => s[0]);
    J.abas.innerHTML = permitidas().map(([id, nome]) =>
      `<button type="button" role="tab" id="ctAba-${id}" data-secao="${id}" aria-controls="ctCorpo" aria-selected="false" tabindex="-1">${nome}</button>`).join("");
    J.email.textContent = eu().email;
    mostrar(ids.includes(secao) ? secao : "conta", true);
  }
  function mostrar(secao, focarAba) {
    J.vez++;                                 // o que o servidor ainda responder para a seção anterior é descartado
    largarSecao();
    J.secao = secao;
    for (const b of J.abas.children) {
      const on = b.dataset.secao === secao;
      b.setAttribute("aria-selected", String(on));
      b.tabIndex = on ? 0 : -1;              // só a aba atual entra no caminho do Tab; as outras, pelas setas
      if (on && focarAba) b.focus();
    }
    J.corpo.setAttribute("aria-labelledby", "ctAba-" + secao);
    J.corpo.scrollTop = 0;
    DESENHAR[secao]();
  }
  function fechar() {
    if (!aberta()) return;
    J.vez++;
    largarSecao();
    J.corpo.innerHTML = "";
    J.fundo.classList.add("oculto");
    document.body.classList.remove("ct-aberta");
    const a = J.antes;
    J.antes = null;
    if (a && a.isConnected && a.getClientRects().length) a.focus();
  }
  // Ao sair de uma seção (outra aba ou janela fechada): senha digitada, código do Telegram e senha provisória não
  // ficam na página nem na memória, e a busca do registro que ainda esperava a pessoa parar de digitar é cancelada.
  function largarSecao() {
    U.prov = null;
    clearTimeout(R.relogio);
    if (J.corpo) for (const c of J.corpo.querySelectorAll("[data-segredo]")) c.value = "";
  }

  // ---------------------------------------------------------------- miudezas dos formulários
  const dizer = (msg, tipo = "ok") => { AX.toast(msg, tipo); if (J.vivo) J.vivo.textContent = msg; };      // o toast não é lido por leitor de tela
  function falha(cx, msg) {
    cx.textContent = msg ? "⚠ " + msg : "";
    cx.classList.toggle("oculto", !msg);
    if (msg) cx.scrollIntoView({ block: "nearest" });
  }
  const erroHtml = (e) => `<div class="erro" role="alert">⚠ ${esc(e.message)}</div>`;
  // Roda um pedido com o botão travado (mostra que o robô está trabalhando e evita o segundo clique). O erro do
  // servidor vai para a caixa `cx`; se a pessoa já saiu da seção, vai para o aviso do robô, para não se perder.
  async function rodar(b, cx, texto, fn) {
    const vez = J.vez, antes = b.textContent, focado = document.activeElement === b;
    falha(cx, "");
    b.disabled = true;
    b.textContent = texto;
    try { await fn(); }
    catch (e) { if (vez === J.vez && cx.isConnected) falha(cx, e.message); else AX.toast(e.message, "erro"); }
    finally {
      if (b.isConnected) { b.disabled = false; b.textContent = antes; }
      // O navegador tira o foco de um botão travado. Sem devolvê-lo, o teclado cairia na tela de trás.
      if (focado && aberta() && document.activeElement === document.body) (b.getClientRects().length ? b : J.janela).focus();
    }
  }
  const enviar = (form, texto, fn) => rodar(form.querySelector('button[type="submit"]'), form.querySelector(".erro"), texto, fn);
  // Lista "pelo menos 8 caracteres / as duas iguais" conferida a cada tecla, a mesma da tela de entrada. Devolve o que
  // falta ("" = tudo certo); as outras regras são do servidor, que responde com a mensagem pronta.
  function conferir(form) {
    const el = form.elements, tam = el.nova.value.length >= 8, iguais = !!el.nova.value && el.nova.value === el.repetir.value;
    form.querySelector('[data-regra="tamanho"]').classList.toggle("ct-ok", tam);
    form.querySelector('[data-regra="iguais"]').classList.toggle("ct-ok", iguais);
    return !tam ? "A senha precisa ter pelo menos 8 caracteres." : !iguais ? "As duas senhas não são iguais." : "";
  }

  // ================================================================ 3. minha conta
  function secConta() {
    const u = eu();
    J.corpo.innerHTML = `
      <form class="card" id="ctfNome" novalidate>
        <div class="rot">MEUS DADOS <span class="dir">${papelTxt(u.papel)}</span></div>
        <div class="ct-linha">
          <label class="campo"><span>Nome</span><input type="text" name="nome" maxlength="60" autocomplete="name" value="${esc(u.nome)}"></label>
          <button type="submit" class="primario">Salvar</button>
        </div>
        <div class="erro oculto" role="alert"></div>
      </form>
      <form class="card" id="ctfEmail" novalidate>
        <div class="rot">E-MAIL DE ENTRADA</div>
        <div class="ct-grade">
          <label class="campo"><span>E-mail</span><input type="email" name="email" maxlength="200" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(u.email)}"></label>
          <label class="campo oculto" data-confirma><span>Senha atual (para confirmar)</span><input type="password" name="senha" maxlength="200" autocomplete="current-password" data-segredo></label>
        </div>
        <div class="nota">É com este e-mail que você entra no robô. Para mudá-lo, o robô pede a senha atual.</div>
        <div class="erro oculto" role="alert"></div>
        <div class="ct-botoes oculto" data-confirma><button type="submit" class="primario">Salvar o e-mail</button></div>
      </form>
      <form class="card" id="ctfSenha" novalidate>
        <div class="rot">TROCAR A SENHA</div>
        <input class="ct-sr" type="text" name="usuario" autocomplete="username" value="${esc(u.email)}" readonly tabindex="-1" aria-hidden="true">
        <div class="ct-grade">
          <label class="campo"><span>Senha atual</span><input type="password" name="atual" maxlength="200" autocomplete="current-password" data-segredo></label>
          <label class="campo"><span>Senha nova</span><input type="password" name="nova" maxlength="200" autocomplete="new-password" aria-describedby="ctRegras" data-segredo></label>
          <label class="campo"><span>Repita a senha nova</span><input type="password" name="repetir" maxlength="200" autocomplete="new-password" data-segredo></label>
        </div>
        <ul class="ct-regras" id="ctRegras"><li data-regra="tamanho">pelo menos 8 caracteres</li><li data-regra="iguais">as duas iguais</li></ul>
        <label class="chk"><input type="checkbox" name="mostrar"> mostrar as senhas</label>
        <div class="nota">Depois da troca, as outras sessões deste usuário (em outro navegador ou computador) são encerradas.</div>
        <div class="erro oculto" role="alert"></div>
        <div class="ct-botoes"><button type="submit" class="primario">Trocar a senha</button></div>
      </form>`;
    const fN = $("ctfNome"), fE = $("ctfEmail"), fS = $("ctfSenha");

    fN.addEventListener("submit", (e) => {
      e.preventDefault();
      enviar(fN, "Salvando…", async () => {
        const r = await pedir("/api/conta", { nome: fN.elements.nome.value.trim() });
        atualizarEu(r.usuario);
        fN.elements.nome.value = r.usuario.nome || "";
        dizer("Nome salvo.");
      });
    });

    // a senha atual e o botão só aparecem quando o e-mail digitado é diferente do que está valendo
    const mudou = () => fE.elements.email.value.trim().toLowerCase() !== String(eu().email).toLowerCase();
    const confirma = () => { for (const c of fE.querySelectorAll("[data-confirma]")) c.classList.toggle("oculto", !mudou()); };
    fE.addEventListener("input", confirma);
    fE.addEventListener("submit", (e) => {
      e.preventDefault();
      const el = fE.elements;
      if (!mudou()) return;
      if (!el.senha.value) { falha(fE.querySelector(".erro"), "Digite a senha atual para confirmar a mudança do e-mail."); el.senha.focus(); return; }
      enviar(fE, "Salvando…", async () => {
        const r = await pedir("/api/conta", { email: el.email.value.trim(), senha: el.senha.value });
        atualizarEu(r.usuario);
        el.email.value = fS.elements.usuario.value = r.usuario.email;
        el.senha.value = "";
        confirma();
        el.email.focus();                    // o botão e a senha somem de novo: o foco fica no campo do e-mail
        dizer("E-mail de entrada alterado. Na próxima vez, entre com o novo.");
      });
    });

    const verSenhas = (sim) => { for (const c of fS.querySelectorAll("[data-segredo]")) c.type = sim ? "text" : "password"; };
    fS.addEventListener("input", () => conferir(fS));
    fS.elements.mostrar.addEventListener("change", (e) => verSenhas(e.target.checked));
    fS.addEventListener("submit", (e) => {
      e.preventDefault();
      const el = fS.elements, falta = el.atual.value ? conferir(fS) : "Digite a senha atual.";
      if (falta) return falha(fS.querySelector(".erro"), falta);
      enviar(fS, "Trocando…", async () => {
        const r = await pedir("/api/conta/senha", { atual: el.atual.value, nova: el.nova.value });
        atualizarEu(r.usuario);
        el.atual.value = el.nova.value = el.repetir.value = "";
        el.mostrar.checked = false;
        verSenhas(false);
        conferir(fS);
        dizer("Senha trocada. As outras sessões deste usuário foram encerradas.");
      });
    });
  }

  // ================================================================ 4. avisos no celular (Telegram) e avisos do Windows
  const TIPOS = [["ordem", "ordem armada"], ["entrada", "entrada executada"], ["saida", "saída"]];

  async function secAvisos() {
    const vez = J.vez;
    J.corpo.innerHTML = `<div class="nota">Carregando…</div>`;
    let av;
    try { av = (await pedir("/api/avisos")).avisos; }
    catch (e) { if (vez === J.vez) J.corpo.innerHTML = erroHtml(e); return; }
    if (vez !== J.vez) return;
    // O código do Telegram é um segredo, mas não é a senha de entrada. autocomplete="one-time-code" tira o campo do
    // gerenciador de senhas do navegador: com "off" (que os navegadores costumam ignorar em campo de senha) ele pode
    // preencher aqui a senha do robô e, ao salvar, oferecer guardar o código como se fosse a senha deste endereço.
    J.corpo.innerHTML = `
      <form class="card" id="ctfAvisos" novalidate>
        <div class="rot">AVISOS NO CELULAR (TELEGRAM) <span class="dir" id="ctTgEstado"></span></div>
        <div class="nota">Quando um teste ao vivo arma uma ordem, entra ou sai, o robô manda uma mensagem para o seu Telegram. Ele precisa de dois valores:</div>
        <ol class="ct-passos">
          <li>No Telegram, fale com <code>@BotFather</code>, envie <code>/newbot</code> e siga as perguntas: ele devolve o <b>código do robô</b> (formato <code>123456789:AA…</code>).</li>
          <li>Abra a conversa com o robô que você criou e mande qualquer mensagem (um “oi”).</li>
          <li>Fale com <code>@userinfobot</code>: ele responde o <b>seu número</b> (Id).</li>
          <li>Cole os dois aqui, salve e use “Enviar aviso de teste”.</li>
        </ol>
        <div class="ct-grade">
          <label class="campo"><span>Código do robô</span><input type="password" name="token" maxlength="80" autocomplete="one-time-code" spellcheck="false" data-segredo></label>
          <label class="campo"><span>Número da conversa</span><input type="text" name="chat" maxlength="41" autocomplete="off" spellcheck="false" placeholder="ex.: 123456789"></label>
        </div>
        <label class="chk"><input type="checkbox" name="ligado"> ligado (mandar os avisos para o Telegram)</label>
        <fieldset class="ct-tipos"><legend>O que avisar</legend>
          ${TIPOS.map(([t, nome]) => `<label class="chk"><input type="checkbox" name="${t}"> ${nome}</label>`).join("")}
        </fieldset>
        <div class="erro oculto" role="alert"></div>
        <div class="ct-botoes">
          <button type="submit" class="primario">Salvar</button>
          <button type="button" data-acao="teste">Enviar aviso de teste</button>
          <button type="button" data-acao="apagar">Apagar o código</button>
        </div>
        <div class="nota">O código fica só na pasta de dados deste computador e só é usado para falar com o Telegram. Os avisos são de testes simulados: informativos, não são recomendação.</div>
      </form>
      <div class="card">
        <div class="rot">AVISOS DO WINDOWS</div>
        <label class="chk"><input type="checkbox" id="ctNotificar"> <span>mostrar também um aviso do Windows quando a janela do robô não está na frente</span></label>
        <div class="nota" id="ctNotifEstado" role="status"></div>
      </div>`;
    const f = $("ctfAvisos"), el = f.elements, cx = f.querySelector(".erro"), btApagar = f.querySelector('[data-acao="apagar"]'), estado = $("ctTgEstado");
    let sujo = false;                        // há mudança na tela que ainda não foi salva
    // Depois de salvar, os campos são atualizados no lugar (o formulário não é refeito) e o código digitado some:
    // o servidor só devolve se existe um guardado e os quatro últimos caracteres dele.
    const pintar = (a) => {
      const tg = (a && a.telegram) || {}, tipos = (a && a.tipos) || {};
      el.token.value = "";
      el.token.placeholder = tg.temToken ? `guardado (termina em …${tg.fim})` : "123456789:AA…";
      el.chat.value = tg.chat || "";
      el.ligado.checked = !!tg.ligado;
      for (const [t] of TIPOS) el[t].checked = tipos[t] !== false;
      btApagar.classList.toggle("oculto", !tg.temToken);
      estado.textContent = tg.ligado ? "ligado" : tg.temToken ? "desligado" : "não configurado";
      sujo = false;
    };
    const daTela = () => ({ telegram: { ligado: el.ligado.checked, token: el.token.value.trim(), chat: el.chat.value.trim() },
      tipos: Object.fromEntries(TIPOS.map(([t]) => [t, el[t].checked])) });
    pintar(av);
    f.addEventListener("input", () => { sujo = true; });
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      enviar(f, "Salvando…", async () => {
        const r = await pedir("/api/avisos", daTela());      // código vazio = o servidor mantém o que já estava guardado
        pintar(r.avisos);
        dizer(r.avisos.telegram.ligado ? "Avisos salvos: o Telegram está ligado." : "Avisos salvos. O Telegram está desligado.");
      });
    });
    f.querySelector('[data-acao="teste"]').addEventListener("click", (e) => {
      // o teste usa o que está gravado no servidor: com mudança por salvar ele testaria outra coisa que não a da tela
      if (sujo) return falha(cx, "Salve antes de enviar o aviso de teste: o teste usa o que está gravado.");
      rodar(e.currentTarget, cx, "Enviando…", async () => {
        await pedir("/api/avisos/teste", {});
        dizer("Aviso de teste enviado. Confira o seu Telegram.");
      });
    });
    btApagar.addEventListener("click", () => {
      if (!confirm("Apagar o código do robô e o número da conversa guardados?\n\nOs avisos no Telegram deixam de ser enviados.")) return;
      rodar(btApagar, cx, "Apagando…", async () => {
        const r = await pedir("/api/avisos", Object.assign(daTela(), { telegram: { ligado: false, token: "", chat: "", apagar: true } }));
        pintar(r.avisos);
        el.token.focus();                    // o botão "Apagar" some junto com o código: o foco não pode ficar nele
        dizer("Código apagado. Os avisos no Telegram estão desligados.");
      });
    });

    // ---- avisos do Windows: é uma preferência deste navegador (AX.pref), não vai para o servidor
    const chk = $("ctNotificar"), est = $("ctNotifEstado"), tem = "Notification" in window;
    const situacao = () => {
      est.textContent = "Neste navegador: " + (!tem ? "este navegador não tem avisos"
        : { granted: "permitido", denied: "bloqueado nas configurações do navegador" }[Notification.permission] || "ainda não permitido (ao ligar, o navegador pergunta)") + ".";
    };
    chk.checked = tem && !!AX.pref.notificar;
    chk.disabled = !tem;
    chk.addEventListener("change", async () => {
      AX.pref.notificar = chk.checked;
      AX.salvarPref();
      // requestPermission devolve uma promessa nos navegadores atuais e chama uma função nos antigos: atende aos dois
      if (chk.checked) await new Promise((ok) => {
        try { const p = Notification.requestPermission(ok); if (p && p.then) p.then(ok, ok); } catch (e) { ok(); }
      });
      if (est.isConnected) situacao();
    });
    situacao();
  }

  // ================================================================ 5. usuários (administrador)
  async function secUsuarios() {
    const vez = J.vez;
    J.corpo.innerHTML = `<div class="nota">Carregando…</div>`;
    try { U.lista = (await pedir("/api/admin/usuarios")).usuarios || []; }
    catch (e) { if (vez === J.vez) J.corpo.innerHTML = erroHtml(e); return; }
    if (vez !== J.vez) return;
    J.corpo.innerHTML = `
      <div id="ctuProv"></div>
      <div class="card">
        <div class="rot">USUÁRIOS <span class="dir" id="ctuTotal"></span></div>
        <div class="erro oculto" role="alert" id="ctuErro"></div>
        <div id="ctuTabela"></div>
      </div>
      <form class="card" id="ctfNovo" novalidate>
        <div class="rot">NOVO USUÁRIO</div>
        <div class="ct-grade">
          <label class="campo"><span>Nome</span><input type="text" name="nome" maxlength="60" autocomplete="off"></label>
          <label class="campo"><span>E-mail</span><input type="email" name="email" maxlength="200" autocomplete="off" autocapitalize="none" spellcheck="false"></label>
          <label class="campo"><span>Papel</span><select name="papel"><option value="usuario">Usuário</option><option value="admin">Administrador</option></select></label>
        </div>
        <div class="nota">O robô sorteia uma senha provisória e a mostra aqui uma única vez. O administrador também cria usuários e vê o registro de acessos.</div>
        <div class="erro oculto" role="alert"></div>
        <div class="ct-botoes"><button type="submit" class="primario">Criar usuário</button></div>
      </form>`;
    const fN = $("ctfNovo");
    fN.addEventListener("submit", (e) => {
      e.preventDefault();
      const el = fN.elements;
      enviar(fN, "Criando…", async () => {
        const r = await pedir("/api/admin/usuarios", { acao: "criar", nome: el.nome.value.trim(), email: el.email.value.trim(), papel: el.papel.value });
        receberUsuarios(r, vez);
        if (vez !== J.vez) return;
        fN.reset();
        pintarUsuarios();
        dizer("Usuário criado. Passe a senha provisória a ele.");
      });
    });
    $("ctuTabela").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-acao]"), tr = b && b.closest("tr");
      const u = tr && U.lista.find((x) => x.id === tr.dataset.id);
      if (u) acaoUsuario(b, u, vez);
    });
    pintarUsuarios();
  }

  // Guarda a lista que o servidor devolve depois de cada ação e, se veio uma senha provisória, deixa-a pronta para
  // aparecer. Ela só existe nesta resposta: se a pessoa já saiu da seção, o aviso diz como conseguir outra.
  function receberUsuarios(r, vez) {
    U.lista = r.usuarios || U.lista;
    if (!r.provisoria) return;
    if (vez === J.vez) U.prov = { senha: r.provisoria, email: (r.usuario && r.usuario.email) || "" };
    else AX.toast("A senha provisória foi sorteada, mas a janela mudou antes de ela aparecer: use “redefinir senha” para gerar outra.", "aviso");
  }

  function pintarUsuarios(focoId, focoAcao) {
    const meu = eu().id, ativos = U.lista.filter((x) => x.papel === "admin" && x.ativo).length;
    const botao = (acao, txt, cls = "") => `<button type="button" class="mini-btn${cls}" data-acao="${acao}">${txt}</button>`;
    const linha = (u) => {
      // O servidor nunca deixa o robô sem administrador ativo, nem apagar o principal ou a si mesmo: essas ações nem
      // aparecem. Redefinir a própria senha derrubaria esta sessão: para isso existe "Trocar a senha" em Minha conta.
      const proprio = u.id === meu, unico = u.papel === "admin" && u.ativo && ativos <= 1;
      const sit = !u.ativo ? ["desativado", "ruim"] : u.semSenha ? ["sem senha (aguardando o primeiro acesso)", "alerta"]
        : u.provisoria ? ["senha provisória pendente", "alerta"] : ["ativo", "bom"];
      const acoes = (unico ? "" : botao("papel", u.papel === "admin" ? "tornar usuário" : "tornar administrador") + botao("ativo", u.ativo ? "desativar" : "ativar")) +
        (proprio ? "" : botao("redefinir", "redefinir senha")) +
        (proprio || u.id === ADMIN_PRINCIPAL ? "" : botao("apagar", "apagar", " ct-perigo"));
      const ponto = u.online ? '<i class="ct-ponto ct-on" role="img" aria-label="conectado agora" data-dica="Conectado agora"></i>' : '<i class="ct-ponto" aria-hidden="true"></i>';
      return `<tr class="ct-u">
          <td data-rot="Nome" class="ct-quebra"${u.criado ? ` data-dica="Usuário criado em ${esc(quando(u.criado))}"` : ""}>${ponto}${esc(u.nome) || "—"}${proprio ? ' <small class="neutro">(você)</small>' : ""}</td>
          <td data-rot="E-mail" class="ct-quebra">${esc(u.email)}</td><td data-rot="Papel" class="ct-junto">${papelTxt(u.papel)}</td>
          <td data-rot="Situação" class="${sit[1]}">${sit[0]}</td>
          <td data-rot="Último acesso" class="ct-junto">${u.ultimo ? esc(quando(u.ultimo)) : "nunca entrou"}</td></tr>
        <tr class="ct-acoes" data-id="${esc(u.id)}"><td colspan="5"><div>${acoes ||
          '<span class="nota">Único administrador ativo: crie outro antes de mudar este. A sua senha você troca em Minha conta.</span>'}</div></td></tr>`;
    };
    $("ctuTotal").textContent = `${U.lista.length} usuário${U.lista.length === 1 ? "" : "s"}`;
    $("ctuTabela").innerHTML = `<table class="tab ct-tab ct-usuarios">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Papel</th><th>Situação</th><th>Último acesso</th></tr></thead>
        <tbody>${U.lista.map(linha).join("")}</tbody></table>`;
    if (caixaProv() || !focoId) return;
    // a tabela foi refeita: o foco volta para o mesmo botão da mesma pessoa (ou para a janela, se o botão sumiu)
    const tr = [...$("ctuTabela").querySelectorAll("tr.ct-acoes")].find((x) => x.dataset.id === focoId);
    ((tr && [...tr.querySelectorAll("button")].find((x) => x.dataset.acao === focoAcao)) || J.janela).focus();
  }

  // A senha provisória aparece uma única vez, numa caixa em destaque. Devolve true quando acabou de pôr uma senha nova
  // na tela (e levou o foco para o "Copiar"); a tabela pode ser refeita depois sem mexer na caixa que já está lá.
  function caixaProv() {
    const cx = $("ctuProv"), p = U.prov;
    if (!p) { cx.innerHTML = ""; return false; }
    if (p.naTela) return false;
    p.naTela = true;
    cx.innerHTML = `<div class="ct-prov" role="status">
        <div class="rot">SENHA PROVISÓRIA <span class="dir">${esc(p.email)}</span></div>
        <div class="ct-prov-linha">
          <input type="text" id="ctuSenha" readonly value="${esc(p.senha)}" aria-label="Senha provisória" aria-describedby="ctuNota" autocomplete="off" spellcheck="false" data-segredo>
          <button type="button" class="primario" id="ctuCopiar" aria-describedby="ctuNota">Copiar</button>
          <button type="button" id="ctuVisto">Já anotei</button>
        </div>
        <div class="nota" id="ctuNota">Passe esta senha ao usuário: no primeiro acesso ele será obrigado a criar a própria. Ela não aparece de novo.</div>
      </div>`;
    const campo = $("ctuSenha");
    $("ctuCopiar").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(campo.value); dizer("Senha provisória copiada."); }
      catch (e) {                            // o navegador não deixou copiar (sem permissão, janela sem foco): fica selecionada
        campo.focus();
        campo.select();
        dizer("Não consegui copiar sozinho: a senha está selecionada, aperte Ctrl+C.", "aviso");
      }
    });
    $("ctuVisto").addEventListener("click", () => { U.prov = null; caixaProv(); J.janela.focus(); });
    cx.scrollIntoView({ block: "nearest" });
    $("ctuCopiar").focus();
    return true;
  }

  async function acaoUsuario(b, u, vez) {
    const a = b.dataset.acao, proprio = u.id === eu().id, quem = u.email;
    let corpo, feito;
    if (a === "papel") {
      if (proprio && !confirm("Você vai deixar de ser administrador e perde o acesso a Usuários e ao Registro de acessos.\n\nContinuar?")) return;
      corpo = { papel: u.papel === "admin" ? "usuario" : "admin" };
      feito = corpo.papel === "admin" ? `${quem} agora é administrador.` : `${quem} agora é usuário comum.`;
    } else if (a === "ativo") {
      if (proprio && !confirm("Você vai desativar o seu próprio usuário e sair do robô agora.\n\nContinuar?")) return;
      corpo = { ativo: !u.ativo };
      feito = u.ativo ? `${quem} foi desativado e as sessões dele foram encerradas.` : `${quem} foi ativado.`;
    } else if (a === "redefinir") {
      if (!confirm(`Redefinir a senha de ${quem}?\n\nA senha atual deixa de valer, as sessões dele são encerradas e o robô sorteia uma senha provisória.`)) return;
      feito = `Senha de ${quem} redefinida. Passe a provisória a ele.`;
    } else if (a === "apagar") {
      if (!confirm(`Apagar o usuário ${quem}?\n\nEle não entra mais no robô. Isto não pode ser desfeito.`)) return;
      feito = `${quem} foi apagado.`;
    } else return;
    await rodar(b, $("ctuErro"), "…", async () => {
      const r = await pedir("/api/admin/usuarios", Object.assign({ acao: corpo ? "alterar" : a, id: u.id }, corpo));
      receberUsuarios(r, vez);
      const agora = U.lista.find((x) => x.id === eu().id);
      if (proprio && agora && !agora.ativo) { location.replace("/"); return; }      // desativou a si mesmo: a sessão já caiu no servidor
      if (agora) atualizarEu({ nome: agora.nome, email: agora.email, papel: agora.papel });
      if (vez !== J.vez) return;
      if (eu().papel !== "admin") { abrir("conta"); dizer("Você agora é um usuário comum."); return; }       // as abas do administrador somem
      pintarUsuarios(u.id, a);
      dizer(feito);
    });
  }

  // ================================================================ 6. registro de acessos (administrador)
  const EVENTOS = { primeiro_acesso: "Primeiro acesso", entrada: "Entrada", entrada_negada: "Entrada negada", saida: "Saída",
    senha_trocada: "Senha trocada", senha_negada: "Troca de senha negada", email_trocado: "E-mail trocado",
    usuario_criado: "Usuário criado", usuario_alterado: "Usuário alterado", usuario_apagado: "Usuário apagado",
    senha_redefinida: "Senha redefinida", admin_negado: "Acesso de administrador negado", admin_zerado: "Senha do administrador zerada",
    teste_ligado: "Teste ao vivo ligado", teste_parado: "Teste ao vivo parado", teste_apagado: "Teste ao vivo apagado",
    ajuste_manual: "Ajuste manual", avisos_configurados: "Avisos configurados" };
  const nomeEvento = (c) => (Object.hasOwn(EVENTOS, c) ? EVENTOS[c] : String(c || "—").replace(/_/g, " "));
  const semAcento = (s) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const LIMITE = 300;

  function secRegistro() {
    J.corpo.innerHTML = `
      <div class="card">
        <div class="rot">REGISTRO DE ACESSOS <span class="dir" id="ctrTotal"></span></div>
        <div class="ct-linha">
          <label class="campo"><span>Buscar</span><input type="text" id="ctrBusca" maxlength="80" autocomplete="off" spellcheck="false" placeholder="e-mail, evento ou texto: negada, saída, senha…"></label>
          <button type="button" id="ctrAtualizar">Atualizar</button>
        </div>
        <div class="erro oculto" role="alert" id="ctrErro"></div>
        <div id="ctrTabela"><div class="nota">Carregando…</div></div>
        <div class="nota">O registro guarda as últimas 5.000 linhas, só neste computador.</div>
      </div>`;
    const busca = $("ctrBusca");
    busca.addEventListener("input", () => { clearTimeout(R.relogio); R.relogio = setTimeout(lerRegistro, 300); });       // espera a pessoa parar de digitar
    busca.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); clearTimeout(R.relogio); lerRegistro(); } });
    $("ctrAtualizar").addEventListener("click", () => { clearTimeout(R.relogio); lerRegistro(); });
    lerRegistro();
  }

  async function lerRegistro() {
    const busca = $("ctrBusca");
    if (J.secao !== "registro" || !busca) return;       // o relógio da busca disparou com a pessoa já em outra seção
    const vez = J.vez, seq = ++R.seq, q = busca.value.trim(), cru = q.toLowerCase(), n = semAcento(q);
    // O servidor procura pelo nome interno do evento ("saida", "entrada_negada"), sem acento e com "_": quem digita o
    // que vê na tabela ("saída", "entrada negada") não acharia nada. Por isso pede também os eventos cujo nome mostrado
    // combina com o texto (menos os que o próprio texto já acha) e junta tudo.
    const extras = n.length < 3 ? [] : Object.keys(EVENTOS).filter((c) => semAcento(EVENTOS[c]).includes(n) && !c.includes(cru)).slice(0, 4);
    const url = (texto) => "/api/admin/registro?" + new URLSearchParams({ n: LIMITE, q: texto });
    try {
      const [base, ...mais] = await Promise.all([q, ...extras].map((texto) => pedir(url(texto))));
      if (vez !== J.vez || seq !== R.seq) return;           // a pessoa já saiu da seção ou digitou outra busca
      let linhas = base.linhas || [];
      if (mais.length) {
        const visto = new Set(), chave = (x) => [x.t, x.evento, x.quem, x.detalhe].join("|");
        linhas = linhas.concat(...mais.map((m, i) => (m.linhas || []).filter((x) => x.evento === extras[i])))
          .filter((x) => !visto.has(chave(x)) && visto.add(chave(x))).sort((x, y) => y.t - x.t).slice(0, LIMITE);
      }
      falha($("ctrErro"), "");
      $("ctrTotal").textContent = linhas.length >= LIMITE ? `as ${LIMITE} linhas mais recentes` : `${linhas.length} linha${linhas.length === 1 ? "" : "s"}`;
      $("ctrTabela").innerHTML = !linhas.length ? `<div class="nota">${q ? `Nada no registro com “${esc(q)}”.` : "O registro ainda está vazio."}</div>`
        : `<table class="tab ct-tab ct-registro"><thead><tr><th>Quando</th><th>Evento</th><th>Quem</th><th>Detalhe</th></tr></thead><tbody>${linhas.map((x) => `
            <tr><td data-rot="Quando" class="ct-junto">${esc(quando(x.t, true))}</td>
              <td data-rot="Evento"><span class="ct-tag${/_negad[ao]$/.test(x.evento) ? " ct-negado" : ""}">${esc(nomeEvento(x.evento))}</span></td>
              <td data-rot="Quem" class="ct-quebra">${esc(x.quem) || "—"}</td><td data-rot="Detalhe" class="ct-quebra">${esc(x.detalhe)}</td></tr>`).join("")}</tbody></table>`;
    } catch (e) {
      if (vez === J.vez && seq === R.seq) falha($("ctrErro"), e.message);
    }
  }

  // ================================================================ ligações
  const DESENHAR = { conta: secConta, avisos: secAvisos, usuarios: secUsuarios, registro: secRegistro };
  if (bt) bt.addEventListener("click", () => (menuAberto() ? fecharMenu() : abrirMenu()));
  document.addEventListener("pointerdown", (e) => {
    if (menuAberto() && !menu.contains(e.target) && !bt.contains(e.target)) fecharMenu();
  }, true);
  window.addEventListener("resize", () => fecharMenu());
  // a página rolou (tela estreita): o menu é fixo e ficaria longe do botão
  window.addEventListener("scroll", (e) => { if (e.target === document) fecharMenu(); }, true);
  // Com o foco no fundo da página (fora do menu e da janela), o Esc e o Tab chegam pelo evento "tecla" do app.js.
  AX.on("tecla", (e) => {
    if (e.key === "Escape") { if (menuAberto()) fecharMenu(true); else fechar(); }
    else if (e.key === "Tab" && aberta() && !J.janela.contains(e.target)) { e.preventDefault(); J.janela.focus(); }
  });
  AX.on("config", pintarBotao);
  if (AX.cfg) pintarBotao();
  AX.conta = { abrir };
})();
