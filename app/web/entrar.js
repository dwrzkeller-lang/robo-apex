/* ROBÔ APEX — tela de entrada (entrar.html). O servidor entrega esta página em "/" enquanto não há sessão válida, ou
   enquanto a senha ainda é a provisória. Aqui só se escolhe qual formulário mostrar (pela resposta de
   /api/acesso/estado) e se enviam os pedidos: quem confere a senha e guarda a sessão é o servidor, num cookie que o
   JavaScript não enxerga. Senha nenhuma vai para localStorage, sessionStorage ou para o console, e todo texto que vem
   do servidor entra na página por textContent/value, nunca como HTML. */
(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const telas = [...document.querySelectorAll("[data-tela]")];
  const forms = [...document.querySelectorAll("form")];
  let provisoria = "";              // senha provisória recém-digitada: é a "atual" na troca; só existe nesta variável

  // ---------------------------------------------------------------- servidor
  // Os erros chegam com status fora de 2xx e {"erro": "mensagem"}: é essa mensagem que vai para a tela.
  async function pedir(url, corpo) {
    const ctl = new AbortController(), relogio = setTimeout(() => ctl.abort(), 20000);     // pedido que nunca volta não trava a tela
    let r, j = null;
    try {
      r = await fetch(url, Object.assign({ signal: ctl.signal, credentials: "same-origin" },
        corpo === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) }));
      j = await r.json();
    } catch (e) {
      if (!r || e.name === "AbortError") throw Object.assign(new Error("O robô não respondeu. Ele ainda está aberto?"), { status: 0 });
    } finally { clearTimeout(relogio); }
    if (!r.ok || !j || j.erro) throw Object.assign(new Error((j && j.erro) || `Resposta inválida do robô (HTTP ${r.status}).`), { status: r.status });
    return j;
  }

  // ---------------------------------------------------------------- formulários
  function erro(form, msg) {
    const cx = form.querySelector("[data-erro]");
    cx.textContent = msg ? "⚠ " + msg : "";
    cx.classList.toggle("oculto", !msg);
  }
  function ocupar(form, sim) {      // botão travado e com o texto "Entrando…" enquanto o pedido roda
    const bt = form.querySelector('button[type="submit"]');
    bt.dataset.rotulo = bt.dataset.rotulo || bt.textContent;
    bt.disabled = sim;
    bt.textContent = sim ? bt.dataset.ocupado : bt.dataset.rotulo;
  }
  function mostrarSenhas(form, sim) {
    form.querySelector("[data-mostrar]").checked = sim;
    for (const c of form.querySelectorAll("[data-senha]")) c.type = sim ? "text" : "password";
  }
  // Lista "pelo menos 8 caracteres / as duas iguais", conferida a cada tecla. Devolve o que falta ("" = tudo certo).
  // As outras regras (senha comum, igual ao e-mail…) são do servidor, que responde com a mensagem pronta.
  function conferir(form) {
    const el = form.elements;
    if (!el.nova) return "";
    const tam = el.nova.value.length >= 8, iguais = !!el.nova.value && el.nova.value === el.repetir.value;
    form.querySelector('[data-regra="tamanho"]').classList.toggle("en-ok", tam);
    form.querySelector('[data-regra="iguais"]').classList.toggle("en-ok", iguais);
    return !tam ? "A senha precisa ter pelo menos 8 caracteres." : !iguais ? "As duas senhas não são iguais." : "";
  }
  // Nada de senha esquecida na página: nem nos campos, nem na memória.
  function limpar() {
    provisoria = "";
    for (const f of forms) { f.reset(); mostrarSenhas(f, false); }
  }

  // ---------------------------------------------------------------- telas
  function mostrar(nome, msg = "") {
    for (const t of telas) t.classList.toggle("oculto", t.dataset.tela !== nome);
    const tela = telas.find((t) => t.dataset.tela === nome), form = tela.querySelector("form");
    if (form) { ocupar(form, false); erro(form, msg); conferir(form); }
    // O atributo autofocus só vale no carregamento, e nessa hora os formulários ainda estão escondidos: o foco é posto
    // aqui, no primeiro campo vazio (ou no botão, quando não há campo).
    const visiveis = [...tela.querySelectorAll("input:not([readonly]):not([type=checkbox]), button")].filter((c) => c.getClientRects().length);
    const foco = visiveis.find((c) => c.tagName === "INPUT" && !c.value) || visiveis.find((c) => c.tagName === "BUTTON");
    if (foco) foco.focus();
  }
  function falha(msg) {
    $("enFalha").textContent = msg;
    mostrar("falha");
  }
  function abrirCriar(usuario, msg) {
    $("enCriEmail").value = usuario.email || "";
    $("enCriAtualBox").classList.toggle("oculto", !!provisoria);      // só pede a provisória de novo se ela não está na memória
    mostrar("criar", msg);
  }

  // Ida para o robô: com a sessão valendo, o servidor entrega a tela principal no mesmo endereço "/". A marca guarda só
  // o horário da ida (nunca senha): se esta tela reabrir segundos depois, o servidor não reconheceu a sessão, e mandar
  // de novo sozinho viraria um vaivém sem fim. Nesse caso mostra um botão em vez de insistir.
  const MARCA = "apex_ida";
  function irParaRobo() {
    limpar();
    try { sessionStorage.setItem(MARCA, String(Date.now())); } catch (e) { /* sem armazenamento: segue sem a trava */ }
    location.replace("/");
  }
  function acabouDeIr() {
    try {
      const t = Number(sessionStorage.getItem(MARCA));
      sessionStorage.removeItem(MARCA);
      return Date.now() - t < 10000;
    } catch (e) { return false; }
  }
  // Com os cookies bloqueados o servidor aceita a senha, mas o navegador não guarda a sessão e esta tela reabriria sem
  // explicar nada. Por isso, logo depois de entrar, pergunta se a sessão ficou valendo.
  async function sessaoGuardada() {
    let est;
    try { est = await pedir("/api/acesso/estado"); } catch (e) { return; }      // sem resposta agora: segue, o servidor decide
    if (!est.logado) throw new Error("O navegador não guardou a sua entrada. Veja se os cookies estão liberados para este endereço e tente de novo.");
  }

  async function iniciar(msg) {
    const voltou = acabouDeIr();
    mostrar("espera");
    let est;
    try { est = await pedir("/api/acesso/estado"); } catch (e) { return falha(e.message); }
    $("enVersao").textContent = est.versao ? "Versão " + est.versao + "." : "";
    const usuario = est.logado ? est.usuario : null;
    if (usuario && !usuario.provisoria)
      return voltou ? falha("Você já entrou, mas a tela do robô não abriu. Tente de novo; se continuar assim, feche o robô e abra-o outra vez.") : irParaRobo();
    if (usuario) return abrirCriar(usuario, msg);                   // senha provisória pendente (página recarregada no meio do caminho)
    provisoria = "";
    if (!est.primeiroAcesso) return mostrar("entrar", msg);
    $("enAdmEmail").value = est.adminEmail || "";
    mostrar("primeiro", msg);
  }

  // ---------------------------------------------------------------- envio
  async function enviar(form, fn) {
    if (form.querySelector('button[type="submit"]').disabled) return;           // já existe um pedido deste formulário a caminho
    erro(form, "");
    mostrarSenhas(form, false);     // a senha volta a ficar escondida enquanto o robô confere
    ocupar(form, true);
    try { await fn(); }             // deu certo: o botão continua travado até a próxima tela aparecer
    catch (e) {
      ocupar(form, false);
      // a sessão terminou no meio do caminho (401) ou a situação mudou no servidor: recomeça pela tela certa
      if (e.status === 401 || e.recomecar) { limpar(); return iniciar(e.message); }
      erro(form, e.message);
      const campo = [...form.querySelectorAll("[data-senha]")].find((c) => c.getClientRects().length);
      if (campo) { campo.focus(); campo.select(); }
    }
  }

  $("enEntrar").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget, el = f.elements, email = el.email.value.trim(), senha = el.senha.value;
    if (!email || !senha) return erro(f, "Digite o e-mail e a senha.");
    enviar(f, async () => {
      const r = await pedir("/api/acesso/entrar", { email, senha, manter: el.manter.checked });
      await sessaoGuardada();
      if (!r.usuario || !r.usuario.provisoria) return irParaRobo();
      limpar();
      provisoria = senha;           // a provisória digitada agora é a "senha atual" da troca obrigatória
      abrirCriar(r.usuario);
    });
  });

  $("enPrimeiro").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget, falta = conferir(f);
    if (falta) return erro(f, falta);
    enviar(f, async () => {
      try { await pedir("/api/acesso/primeiro", { senha: f.elements.nova.value }); }
      catch (e) {
        // Se alguém criou a senha do administrador enquanto esta tela estava aberta, o primeiro acesso acabou:
        // daqui em diante vale a tela de entrar (com a mensagem do servidor).
        const est = await pedir("/api/acesso/estado").catch(() => null);
        throw Object.assign(e, { recomecar: !!est && !est.primeiroAcesso });
      }
      await sessaoGuardada();
      irParaRobo();
    });
  });

  $("enCriar").addEventListener("submit", (ev) => {
    ev.preventDefault();
    const f = ev.currentTarget, el = f.elements, atual = provisoria || el.atual.value;
    const falta = atual ? conferir(f) : "Digite a senha provisória que você recebeu.";
    if (falta) return erro(f, falta);
    enviar(f, async () => {
      await pedir("/api/conta/senha", { atual, nova: el.nova.value });
      irParaRobo();
    });
  });

  // Quem está preso na troca obrigatória (por exemplo, sem a senha provisória em mãos) precisa de uma saída.
  $("enOutro").addEventListener("click", async () => {
    try { await pedir("/api/acesso/sair", {}); } catch (e) { /* sem resposta: o recomeço abaixo mostra o aviso */ }
    limpar();
    iniciar();
  });
  $("enDeNovo").addEventListener("click", () => iniciar());

  for (const f of forms) {
    f.querySelector("[data-mostrar]").addEventListener("change", (ev) => mostrarSenhas(f, ev.target.checked));
    f.addEventListener("input", (ev) => {
      conferir(f);
      if (ev.target.type !== "checkbox") erro(f, "");               // voltou a digitar: o aviso anterior já foi lido
    });
  }

  iniciar();
})();
