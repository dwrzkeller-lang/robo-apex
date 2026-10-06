# -*- coding: utf-8 -*-
"""
ROBO APEX - login: usuarios, senhas, sessoes e registro de acessos.

Tudo fica em arquivos na pasta de dados (nada sai do computador):
  usuarios.json   quem pode entrar (a senha nunca e guardada: so o resultado do PBKDF2-SHA256 com sal proprio)
  sessoes.json    sessoes "manter conectado" (guarda o SHA-256 do codigo da sessao, nunca o codigo)
  acessos.jsonl   registro: entradas, tentativas negadas, saidas, usuarios criados/alterados, acoes no robo

O administrador ja vem criado (ADMIN_EMAIL) SEM senha: quem abre o robo pela primeira vez define a senha dele.
Nao existe senha padrao. Usuario novo recebe uma senha provisoria sorteada e e obrigado a troca-la no 1o acesso.
Muitas senhas erradas seguidas bloqueiam aquele e-mail por alguns minutos.
"""
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time

ADMIN_ID, ADMIN_EMAIL = "admin", "admin@roboapex.local"
ITERACOES = 310000                 # PBKDF2-HMAC-SHA256
SESSAO_CURTA = 12 * 3600           # sem "manter conectado": vale 12 horas sem uso
SESSAO_LONGA = 30 * 86400          # "manter conectado neste computador": 30 dias
MAX_ERROS, JANELA_ERROS = 5, 600   # 5 senhas erradas em 10 minutos...
BLOQUEIO = 300                     # ...bloqueiam o e-mail por 5 minutos (dobra a cada bloqueio seguido, ate 1 hora)
LINHAS_REGISTRO = 5000
EMAIL_OK = re.compile(r"^[A-Za-z0-9._%+\-]{1,64}@[A-Za-z0-9.\-]{1,190}\.[A-Za-z]{2,24}$")
ID_OK = re.compile(r"^[a-z0-9]{1,24}$")


class Negado(Exception):
    """Pedido recusado por uma regra de acesso (a mensagem pode ser mostrada na tela)."""


def _hash(senha, sal, it=ITERACOES):
    return hashlib.pbkdf2_hmac("sha256", senha.encode("utf-8"), sal, it).hex()


def _resumo(token):
    return hashlib.sha256(token.encode("ascii")).hexdigest()


def senha_valida(senha, email=""):
    """Devolve a mensagem do problema, ou None se a senha serve."""
    if not isinstance(senha, str) or len(senha) < 8:
        return "A senha precisa ter pelo menos 8 caracteres."
    if len(senha) > 200:
        return "Senha longa demais (máximo 200 caracteres)."
    if len(set(senha)) < 4:
        return "Senha fraca: use caracteres variados."
    if email and senha.lower() in (email.lower(), email.lower().split("@")[0]):
        return "A senha não pode ser igual ao e-mail."
    if senha.lower() in ("12345678", "123456789", "1234567890", "password", "senha123", "senha1234", "qwertyui", "abcd1234", "roboapex"):
        return "Senha muito comum: escolha outra."
    return None


class Acessos:
    def __init__(self, pasta):
        self.pasta = pasta
        self.arq_u = os.path.join(pasta, "usuarios.json")
        self.arq_s = os.path.join(pasta, "sessoes.json")
        self.arq_r = os.path.join(pasta, "acessos.jsonl")
        self.trava = threading.RLock()
        self.usuarios = self._ler(self.arq_u, {}).get("usuarios") or []
        if not any(u.get("id") == ADMIN_ID for u in self.usuarios):
            self.usuarios.insert(0, dict(id=ADMIN_ID, email=ADMIN_EMAIL, nome="Administrador", papel="admin", ativo=True,
                                         senha=None, provisoria=False, criado=time.time(), ultimo=None))
            self._gravar_usuarios()
        self.sessoes = {}                                      # resumo do codigo -> dict(uid, criado, visto, manter)
        agora = time.time()
        for k, v in (self._ler(self.arq_s, {}).get("sessoes") or {}).items():
            if isinstance(v, dict) and agora - v.get("visto", 0) < SESSAO_LONGA and self._por_id(v.get("uid")):
                self.sessoes[k] = v
        self.erros = {}                                        # e-mail -> dict(vezes=[horarios], ate=fim do bloqueio, nivel)
        self._falso = dict(sal=secrets.token_bytes(16).hex(), hash="0" * 64, it=ITERACOES)   # para gastar o mesmo tempo com e-mail inexistente
        try:
            with open(self.arq_r, encoding="utf-8") as f:
                self._linhas = sum(1 for _ in f)
        except OSError:
            self._linhas = 0

    # ------------------------------------------------------------------ arquivos
    @staticmethod
    def _ler(arq, padrao):
        try:
            with open(arq, encoding="utf-8") as f:
                v = json.load(f)
            return v if isinstance(v, dict) else padrao
        except (OSError, ValueError):
            return padrao

    @staticmethod
    def _gravar(arq, obj):
        tmp = arq + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, ensure_ascii=False, indent=1)
        os.replace(tmp, arq)

    def _gravar_usuarios(self):
        self._gravar(self.arq_u, dict(versao=1, usuarios=self.usuarios))

    def _gravar_sessoes(self):
        try:
            self._gravar(self.arq_s, dict(sessoes={k: v for k, v in self.sessoes.items() if v.get("manter")}))
        except OSError:
            pass

    def registrar(self, evento, quem="", detalhe="", ip=""):
        """Uma linha no registro de acessos. `quem` = e-mail (ou o que foi digitado, numa tentativa negada)."""
        linha = dict(t=round(time.time(), 1), evento=evento, quem=str(quem)[:120], detalhe=str(detalhe)[:300], ip=str(ip)[:45])
        with self.trava:
            try:
                with open(self.arq_r, "a", encoding="utf-8") as f:
                    f.write(json.dumps(linha, ensure_ascii=False) + "\n")
                if self._linhas is not None:
                    self._linhas += 1
                    if self._linhas > LINHAS_REGISTRO + 1000:    # arquivo crescendo: guarda so as ultimas linhas
                        with open(self.arq_r, encoding="utf-8") as f:
                            ult = f.readlines()[-LINHAS_REGISTRO:]
                        with open(self.arq_r + ".tmp", "w", encoding="utf-8") as f:
                            f.writelines(ult)
                        os.replace(self.arq_r + ".tmp", self.arq_r)
                        self._linhas = len(ult)
            except OSError:
                pass

    def registro(self, n=300, texto=""):
        """As n linhas mais recentes (a mais nova primeiro), filtradas por texto."""
        with self.trava:
            try:
                with open(self.arq_r, encoding="utf-8") as f:
                    linhas = f.readlines()
            except OSError:
                linhas = []
            self._linhas = len(linhas)
        out, texto = [], (texto or "").lower()
        for ln in reversed(linhas):
            try:
                x = json.loads(ln)
            except ValueError:
                continue
            if texto and texto not in (x.get("evento", "") + " " + x.get("quem", "") + " " + x.get("detalhe", "")).lower():
                continue
            out.append(x)
            if len(out) >= n:
                break
        return out

    # ------------------------------------------------------------------ usuarios
    def _por_id(self, uid):
        return next((u for u in self.usuarios if u["id"] == uid), None)

    def _por_email(self, email):
        e = (email or "").strip().lower()
        return next((u for u in self.usuarios if u["email"].lower() == e), None)

    @staticmethod
    def publico(u):
        return dict(id=u["id"], email=u["email"], nome=u.get("nome") or "", papel=u.get("papel", "usuario"), ativo=bool(u.get("ativo", True)),
                    provisoria=bool(u.get("provisoria")), semSenha=u.get("senha") is None, criado=u.get("criado"), ultimo=u.get("ultimo"))

    def estado(self):
        """O que a tela de entrada precisa saber antes do login."""
        with self.trava:
            adm = self._por_id(ADMIN_ID)
            return dict(primeiroAcesso=adm["senha"] is None, adminEmail=adm["email"])

    def _definir(self, u, senha, provisoria=False):
        sal = secrets.token_bytes(16)
        u["senha"] = dict(alg="pbkdf2-sha256", it=ITERACOES, sal=sal.hex(), hash=_hash(senha, sal))
        u["provisoria"] = bool(provisoria)

    def _confere(self, u, senha):
        s = (u or {}).get("senha") or self._falso
        calc = _hash(senha if isinstance(senha, str) else "", bytes.fromhex(s["sal"]), int(s.get("it", ITERACOES)))
        return hmac.compare_digest(calc, s["hash"]) and u is not None and u.get("senha") is not None

    def primeiro_acesso(self, senha, ip=""):
        """Define a senha do administrador. So funciona enquanto ele nao tem senha."""
        with self.trava:
            adm = self._por_id(ADMIN_ID)
            if adm["senha"] is not None:
                raise Negado("O administrador já tem senha. Entre com ela.")
            erro = senha_valida(senha, adm["email"])
            if erro:
                raise Negado(erro)
            self._definir(adm, senha)
            adm["ultimo"] = time.time()                        # criar a senha ja e a primeira entrada
            self._gravar_usuarios()
            self.registrar("primeiro_acesso", adm["email"], "senha do administrador criada", ip)
            return self._abrir_sessao(adm, False, ip)

    def _bloqueado(self, email, agora):
        e = self.erros.get(email)
        return max(0.0, e["ate"] - agora) if e and e.get("ate", 0) > agora else 0.0

    def _errou(self, email, agora):
        e = self.erros.setdefault(email, dict(vezes=[], ate=0.0, nivel=0))
        e["vezes"] = [t for t in e["vezes"] if agora - t < JANELA_ERROS] + [agora]
        if len(e["vezes"]) >= MAX_ERROS:
            e["nivel"] = min(e["nivel"] + 1, 5)
            e["ate"] = agora + min(3600, BLOQUEIO * 2 ** (e["nivel"] - 1))
            e["vezes"] = []
            return e["ate"] - agora
        return 0.0

    def entrar(self, email, senha, manter=False, ip=""):
        """Devolve (codigo da sessao, usuario). Levanta Negado com uma mensagem que nao revela se o e-mail existe."""
        email = (email or "").strip().lower()[:200]
        agora = time.time()
        with self.trava:
            falta = self._bloqueado(email, agora)
            if falta > 0:
                self.registrar("entrada_negada", email, "bloqueado por tentativas", ip)
                raise Negado("Muitas tentativas. Tente de novo em %d min." % max(1, round(falta / 60)))
            if len(self.erros) > 2000:
                self.erros = {k: v for k, v in self.erros.items() if v.get("ate", 0) > agora or v["vezes"]}
        u = self._por_email(email)
        ok = self._confere(u, senha)                           # fora da trava: a conta do hash leva ~0,2 s
        with self.trava:
            if not ok or not u.get("ativo", True):
                bloq = self._errou(email, agora)
                motivo = "e-mail não cadastrado" if u is None else ("usuário desativado" if ok else "senha errada")
                self.registrar("entrada_negada", email, motivo + (" · bloqueado por %d min" % round(bloq / 60) if bloq else ""), ip)
                if ok:
                    raise Negado("Este usuário está desativado. Fale com o administrador.")
                raise Negado("E-mail ou senha incorretos." + (" Muitas tentativas: aguarde %d min." % round(bloq / 60) if bloq else ""))
            self.erros.pop(email, None)
            u["ultimo"] = agora
            self._gravar_usuarios()
            self.registrar("entrada", u["email"], "manter conectado" if manter else "", ip)
            return self._abrir_sessao(u, manter, ip)

    def _abrir_sessao(self, u, manter, ip):
        token = secrets.token_urlsafe(32)
        agora = time.time()
        self.sessoes[_resumo(token)] = dict(uid=u["id"], criado=agora, visto=agora, manter=bool(manter), ip=ip)
        if manter:
            self._gravar_sessoes()
        return token, self.publico(u)

    def sessao(self, token):
        """Usuario da sessao (dict publico) ou None. Cada uso renova a validade."""
        if not token or len(token) > 200:
            return None
        k = _resumo(token) if token.isascii() else None
        with self.trava:
            s = self.sessoes.get(k)
            if not s:
                return None
            agora = time.time()
            u = self._por_id(s["uid"])
            if u is None or not u.get("ativo", True) or agora - s["visto"] > (SESSAO_LONGA if s.get("manter") else SESSAO_CURTA):
                self.sessoes.pop(k, None)
                if s.get("manter"):
                    self._gravar_sessoes()
                return None
            if s.get("manter") and agora - s["visto"] > 3600:  # renova no disco no maximo uma vez por hora
                s["visto"] = agora
                self._gravar_sessoes()
            s["visto"] = agora
            return self.publico(u)

    def sair(self, token, ip=""):
        with self.trava:
            s = self.sessoes.pop(_resumo(token), None) if token and token.isascii() else None
            if s:
                u = self._por_id(s["uid"])
                self.registrar("saida", u["email"] if u else s["uid"], "", ip)
                if s.get("manter"):
                    self._gravar_sessoes()

    def _encerrar_sessoes(self, uid, menos=None):
        antes = len(self.sessoes)
        self.sessoes = {k: v for k, v in self.sessoes.items() if v["uid"] != uid or k == menos}
        if len(self.sessoes) != antes:
            self._gravar_sessoes()

    def trocar_senha(self, uid, atual, nova, token=None, ip=""):
        u = self._por_id(uid)
        if u is None:
            raise Negado("Usuário não encontrado.")
        if not self._confere(u, atual):
            self.registrar("senha_negada", u["email"], "senha atual errada na troca", ip)
            raise Negado("A senha atual não confere.")
        erro = senha_valida(nova, u["email"])
        if erro:
            raise Negado(erro)
        if atual == nova:
            raise Negado("A senha nova precisa ser diferente da atual.")
        with self.trava:
            self._definir(u, nova)
            self._gravar_usuarios()
            self._encerrar_sessoes(uid, menos=_resumo(token) if token else None)     # as outras sessoes deste usuario caem
            self.registrar("senha_trocada", u["email"], "", ip)
        return self.publico(u)

    def alterar_conta(self, uid, nome=None, email=None, senha=None, ip=""):
        """O proprio usuario muda o nome ou o e-mail de entrada (o e-mail pede a senha atual)."""
        u = self._por_id(uid)
        if u is None:
            raise Negado("Usuário não encontrado.")
        with self.trava:
            if nome is not None:
                u["nome"] = str(nome).strip()[:60]
            if email is not None and email.strip().lower() != u["email"].lower():
                email = email.strip().lower()
                if not self._confere(u, senha):
                    raise Negado("Para mudar o e-mail, confirme a senha atual.")
                if not EMAIL_OK.match(email):
                    raise Negado("E-mail inválido.")
                if self._por_email(email):
                    raise Negado("Já existe um usuário com este e-mail.")
                self.registrar("email_trocado", u["email"], "novo: " + email, ip)
                u["email"] = email
            self._gravar_usuarios()
        return self.publico(u)

    # ------------------------------------------------------------------ administracao
    def listar(self):
        with self.trava:
            vivos = {}
            agora = time.time()
            for s in self.sessoes.values():
                if agora - s["visto"] < 300:
                    vivos[s["uid"]] = True
            return [dict(self.publico(u), online=bool(vivos.get(u["id"]))) for u in self.usuarios]

    def criar(self, admin, nome, email, papel="usuario", ip=""):
        """Cria o usuario com uma senha provisoria sorteada. Devolve (usuario, senha provisoria): ela so aparece agora."""
        email = (email or "").strip().lower()
        if not EMAIL_OK.match(email):
            raise Negado("E-mail inválido.")
        if papel not in ("admin", "usuario"):
            raise Negado("Papel inválido.")
        with self.trava:
            if self._por_email(email):
                raise Negado("Já existe um usuário com este e-mail.")
            if len(self.usuarios) >= 200:
                raise Negado("Limite de 200 usuários.")
            uid = secrets.token_hex(6)
            u = dict(id=uid, email=email, nome=str(nome or "").strip()[:60] or email.split("@")[0], papel=papel, ativo=True,
                     senha=None, provisoria=True, criado=time.time(), ultimo=None)
            prov = secrets.token_urlsafe(9)
            self._definir(u, prov, provisoria=True)
            self.usuarios.append(u)
            self._gravar_usuarios()
            self.registrar("usuario_criado", admin["email"], "%s (%s)" % (email, papel), ip)
            return self.publico(u), prov

    def _admins_ativos(self):
        return [u for u in self.usuarios if u.get("papel") == "admin" and u.get("ativo", True)]

    def alterar(self, admin, uid, dados, ip=""):
        """Administrador muda nome, papel ou ativa/desativa. Nunca deixa o robo sem nenhum administrador ativo."""
        with self.trava:
            u = self._por_id(uid)
            if u is None:
                raise Negado("Usuário não encontrado.")
            papel, ativo = dados.get("papel", u.get("papel")), bool(dados.get("ativo", u.get("ativo", True)))
            if papel not in ("admin", "usuario"):
                raise Negado("Papel inválido.")
            era_admin = u.get("papel") == "admin" and u.get("ativo", True)
            if era_admin and (papel != "admin" or not ativo) and len(self._admins_ativos()) <= 1:
                raise Negado("Este é o único administrador ativo: crie outro antes.")
            mud = []
            if "nome" in dados and str(dados["nome"]).strip()[:60] != u.get("nome"):
                u["nome"] = str(dados["nome"]).strip()[:60]
                mud.append("nome")
            if papel != u.get("papel"):
                u["papel"] = papel
                mud.append("papel=" + papel)
            if ativo != u.get("ativo", True):
                u["ativo"] = ativo
                mud.append("ativado" if ativo else "desativado")
                if not ativo:
                    self._encerrar_sessoes(uid)
            self._gravar_usuarios()
            if mud:
                self.registrar("usuario_alterado", admin["email"], "%s: %s" % (u["email"], ", ".join(mud)), ip)
            return self.publico(u)

    def redefinir(self, admin, uid, ip=""):
        """Sorteia outra senha provisoria (o usuario e obrigado a troca-la ao entrar) e encerra as sessoes dele."""
        with self.trava:
            u = self._por_id(uid)
            if u is None:
                raise Negado("Usuário não encontrado.")
            prov = secrets.token_urlsafe(9)
            self._definir(u, prov, provisoria=True)
            self._encerrar_sessoes(uid)
            self.erros.pop(u["email"].lower(), None)
            self._gravar_usuarios()
            self.registrar("senha_redefinida", admin["email"], u["email"], ip)
            return self.publico(u), prov

    def apagar(self, admin, uid, ip=""):
        with self.trava:
            u = self._por_id(uid)
            if u is None:
                raise Negado("Usuário não encontrado.")
            if uid == admin["id"]:
                raise Negado("Você não pode apagar o próprio usuário.")
            if uid == ADMIN_ID:
                raise Negado("O administrador principal não pode ser apagado (ele pode ser desativado se houver outro).")
            if u.get("papel") == "admin" and u.get("ativo", True) and len(self._admins_ativos()) <= 1:
                raise Negado("Este é o único administrador ativo.")
            self.usuarios = [x for x in self.usuarios if x["id"] != uid]
            self._encerrar_sessoes(uid)
            self._gravar_usuarios()
            self.registrar("usuario_apagado", admin["email"], u["email"], ip)

    def zerar_admin(self):
        """Recuperacao local (RoboApex.exe --redefinir-admin): tira a senha do administrador principal e encerra as sessoes."""
        with self.trava:
            adm = self._por_id(ADMIN_ID)
            adm.update(senha=None, provisoria=False, ativo=True, papel="admin")
            self.sessoes = {}
            self.erros = {}
            self._gravar_usuarios()
            self._gravar_sessoes()
            self.registrar("admin_zerado", adm["email"], "senha removida pela linha de comando", "local")
