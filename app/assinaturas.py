# -*- coding: utf-8 -*-
"""Robo Apex como servico na internet: cadastro com aceite dos termos, assinatura mensal pela Hotmart e o painel do
administrador (compras, assinantes, visitas da pagina).

Configuracao (dados/site.json, editada pelo administrador na tela):
  publico              o robo esta na internet (--publico): a pagina de vendas abre na raiz e o robo em /app
  cadastro_aberto      qualquer pessoa pode criar conta (com o aceite dos termos)
  exigir_assinatura    so entra no robo quem tem assinatura ativa (o administrador sempre entra)
  checkout_url         link do checkout da Hotmart (ou outro gateway); o e-mail da pessoa vai junto
  hottok               codigo de seguranca que a Hotmart manda no cabecalho X-HOTMART-HOTTOK de cada aviso (postback)
  preco                preco mostrado (so texto)
  dias_extra           dias de folga depois do vencimento antes de bloquear (atraso de cobranca)
  produto_id           (opcional) codigo do produto na Hotmart: aviso de outro produto fica so no registro

Avisos da Hotmart (webhook 2.0): PURCHASE_APPROVED / PURCHASE_COMPLETE de uma transacao NOVA liberam 31 dias (+ folga);
o mesmo aviso repetido (ou o COMPLETE que chega semanas depois) nao estende de novo, e nunca reativa uma transacao ja
cancelada. SUBSCRIPTION_CANCELLATION e PURCHASE_CANCELED encerram a assinatura, mas o acesso ja pago vale ate o fim
(`ate`); PURCHASE_REFUNDED, PURCHASE_CHARGEBACK e PURCHASE_PROTEST tiram o acesso na hora; os outros so ficam no
registro. A conta e achada pelo e-mail de entrada ou pelo e-mail da compra (guardado na conta no primeiro aviso). Compra
feita antes do cadastro fica guardada pelo e-mail e e aplicada quando a pessoa se cadastra."""
import hashlib
import hmac
import json
import os
import threading
import time
import urllib.parse

TERMOS_VERSAO = "2026-10-15"
TERMOS = """TERMOS DE USO E AVISO DE RISCO DO ROBÔ APEX

1. O QUE É O ROBÔ APEX
O Robô Apex é um software de estudo e análise de estratégias de day trade (ações da B3, mini contratos, opções e criptomoedas). Ele mostra onde estratégias conhecidas entrariam e sairiam, simula operações com dados passados e ao vivo, com custos, e permite testar ideias. Ele não é corretora, não é consultoria de investimentos, não é analista de valores mobiliários e não faz recomendação de compra ou venda de nenhum ativo.

2. SEM PROMESSA DE GANHO
Nenhum resultado é garantido. Resultados passados, simulações, testes e exemplos mostrados no site ou no robô não garantem resultados futuros. A maioria das pessoas que faz day trade perde dinheiro. Opere apenas com dinheiro que você pode perder.

3. AS DECISÕES SÃO SUAS
Toda decisão de comprar, vender, entrar ou sair de uma operação é exclusivamente sua, assim como a escolha da corretora, do valor e do risco. Se você conectar o robô à sua conta (aba Conectar), as ordens são enviadas pelo SEU MetaTrader, na SUA conta, por decisão SUA, depois de aceitar um termo próprio.

4. RESPONSABILIDADE
Os criadores e mantenedores do Robô Apex não se responsabilizam por perdas financeiras, lucros cessantes ou quaisquer danos, diretos ou indiretos, decorrentes do uso ou da impossibilidade de uso do software, das estratégias, dos dados, de falhas de internet, energia, corretora, provedores de dados ou do próprio software. Não obrigamos nem influenciamos ninguém a adquirir o robô ou a operar no mercado.

5. DADOS DE MERCADO
Os dados vêm de fontes públicas e gratuitas (com atraso de cerca de 15 minutos em alguns ativos da B3) ou da sua própria corretora. Podem conter falhas, atrasos e interrupções.

6. ASSINATURA
O acesso é por assinatura mensal, cobrada pelo meio de pagamento escolhido (por exemplo, Hotmart), que também cuida de cancelamentos, reembolsos e da garantia prevista em lei (7 dias para compras pela internet, artigo 49 do Código de Defesa do Consumidor). Sem pagamento ativo, o acesso é suspenso.

7. CONTA E SEGURANÇA
A conta é pessoal e intransferível. Não compartilhe a sua senha. Podemos suspender contas usadas de forma abusiva ou compartilhada.

8. PRIVACIDADE
Guardamos o seu nome, e-mail, registros de acesso (data, hora e IP) e as suas configurações e testes, para operar o serviço e por segurança, conforme a Lei Geral de Proteção de Dados (LGPD). Não vendemos os seus dados. Você pode pedir a exclusão da sua conta.

9. MAIORIDADE
O uso é permitido apenas para maiores de 18 anos.

10. ACEITE
Ao criar a conta você declara que leu, entendeu e aceita estes termos e o aviso de risco."""

PADRAO = dict(publico=False, cadastro_aberto=False, exigir_assinatura=False, checkout_url="", hottok="", preco="R$ 49,99/mês",
              dias_extra=3, nome_produto="Robô Apex", produto_id="")
LIBERA = ("PURCHASE_APPROVED", "PURCHASE_COMPLETE")
BLOQUEIA = ("PURCHASE_CANCELED", "PURCHASE_REFUNDED", "PURCHASE_CHARGEBACK", "PURCHASE_PROTEST", "SUBSCRIPTION_CANCELLATION")
ENCERRA = ("PURCHASE_CANCELED", "SUBSCRIPTION_CANCELLATION")     # parou de pagar: vale ate o fim do periodo ja pago
DIAS = 31


def _decidir(ev, atual, transacao, agora):
    """(status, ate, encerradas) para a assinatura depois deste aviso, ou None se o aviso nao muda nada.
    atual = assinatura que a conta (ou a compra guardada) ja tem."""
    st, ate0, tr0 = atual.get("status"), float(atual.get("ate") or 0), atual.get("transacao") or ""
    encerradas = [str(x) for x in (atual.get("encerradas") or [])][-20:]
    if ev in LIBERA:
        if transacao and (transacao == tr0 or transacao in encerradas):
            return None                                        # aviso repetido ou atrasado da mesma compra: nao estende de novo
        return "ativa", max(agora, ate0 if st == "ativa" else 0.0) + DIAS * 86400, encerradas
    if ev in BLOQUEIA:
        fim = [x for x in (transacao, tr0) if x and x not in encerradas]
        if ev in ENCERRA:
            return "cancelada", (ate0 if st in ("ativa", "cancelada") else agora), encerradas + fim
        return "inativa", agora, encerradas + fim
    return None


class Site:
    def __init__(self, pasta):
        self.pasta = pasta
        self.arq_cfg = os.path.join(pasta, "site.json")
        self.arq_compras = os.path.join(pasta, "compras.jsonl")
        self.arq_visitas = os.path.join(pasta, "visitas.jsonl")
        self.trava = threading.RLock()
        self.cfg = dict(PADRAO)
        try:
            with open(self.arq_cfg, encoding="utf-8") as f:
                v = json.load(f)
            if isinstance(v, dict):
                self.cfg.update({k: v[k] for k in PADRAO if k in v})
        except (OSError, ValueError):
            pass
        self.pendentes = {}                                     # e-mail -> assinatura: compra feita antes do cadastro
        for c in self.compras(5000):
            if c.get("email") and c.get("aplicada") is False and c.get("status"):
                self.pendentes[c["email"]] = dict(status=c.get("status"), ate=c.get("ate"), transacao=c.get("transacao") or "",
                                                  encerradas=c.get("encerradas") or [])

    # ------------------------------------------------------------------------------------------ configuracao
    def publico_cfg(self):
        """O que a tela de entrada e a pagina de vendas podem saber (sem o hottok)."""
        c = self.cfg
        return dict(cadastroAberto=bool(c["cadastro_aberto"]), exigirAssinatura=bool(c["exigir_assinatura"]), checkout=c["checkout_url"],
                    preco=c["preco"], produto=c["nome_produto"], termosVersao=TERMOS_VERSAO)

    def admin_cfg(self):
        c = dict(self.cfg)
        c["hottok"] = ("…" + c["hottok"][-4:]) if c.get("hottok") else ""
        return c

    def salvar(self, novo):
        with self.trava:
            for k in ("cadastro_aberto", "exigir_assinatura"):
                if k in novo:
                    self.cfg[k] = bool(novo[k])
            if "checkout_url" in novo:
                u = str(novo["checkout_url"] or "").strip()
                if u and not u.lower().startswith("https://"):
                    raise ValueError("O link do checkout precisa começar com https://")
                self.cfg["checkout_url"] = u[:500]
            if novo.get("hottok"):
                self.cfg["hottok"] = str(novo["hottok"]).strip()[:200]
            for k in ("preco", "nome_produto"):
                if k in novo:
                    self.cfg[k] = str(novo[k] or "").strip()[:60]
            if "dias_extra" in novo:
                self.cfg["dias_extra"] = max(0, min(30, int(novo["dias_extra"] or 0)))
            if "produto_id" in novo:
                self.cfg["produto_id"] = str(novo["produto_id"] or "").strip()[:40]
            tmp = self.arq_cfg + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(self.cfg, f, ensure_ascii=False, indent=1)
            os.replace(tmp, self.arq_cfg)
        return self.admin_cfg()

    def checkout_para(self, email="", nome=""):
        u = self.cfg["checkout_url"]
        if not u:
            return ""
        q = {k: v for k, v in (("email", email), ("name", nome)) if v}
        return u + ("&" if "?" in u else "?") + urllib.parse.urlencode(q) if q else u

    # ------------------------------------------------------------------------------------------ assinatura
    def ativa(self, u):
        """True se o usuario pode usar o robo agora."""
        if not self.cfg["exigir_assinatura"] or (u or {}).get("papel") == "admin":
            return True
        a = (u or {}).get("assinatura") or {}
        if a.get("status") == "cancelada":                      # cancelou: usa ate o fim do que ja pagou (sem folga)
            return float(a.get("ate") or 0) > time.time()
        return a.get("status") == "ativa" and float(a.get("ate") or 0) + 86400 * self.cfg["dias_extra"] > time.time()

    def hotmart(self, cabecalhos, corpo, acessos):
        """Aviso (postback) da Hotmart. acessos = auth.Acessos (para ligar/desligar a assinatura do usuario)."""
        tok = cabecalhos.get("X-HOTMART-HOTTOK") or cabecalhos.get("X-Hotmart-Hottok") or ""
        if not self.cfg["hottok"] or not hmac.compare_digest(tok.encode(), self.cfg["hottok"].encode()):
            raise PermissionError("hottok inválido")
        if not isinstance(corpo, dict):
            raise ValueError("aviso inválido")
        _d = lambda v: v if isinstance(v, dict) else {}       # noqa: E731
        ev = str(corpo.get("event") or "").upper()
        d = _d(corpo.get("data"))
        comprador = _d(d.get("buyer"))
        email = str(comprador.get("email") or "").strip().lower()[:200]
        nome = str(comprador.get("name") or "").strip()[:60]
        compra = _d(d.get("purchase"))
        preco = _d(compra.get("price"))
        transacao = str(compra.get("transaction") or "")[:60]
        produto = str(_d(d.get("product")).get("id") or "")[:40]
        agora = time.time()
        status, ate, aplicada, encerradas = None, None, None, []
        outro = bool(self.cfg.get("produto_id")) and produto != str(self.cfg["produto_id"])
        if email and not outro and (ev in LIBERA or ev in BLOQUEIA):
            with self.trava:                                    # um aviso por vez: dois avisos juntos nao se atropelam
                atual = acessos.assinatura_de(email)
                tem_conta = atual is not None
                if not tem_conta:
                    atual = dict(self.pendentes.get(email) or {})
                dec = _decidir(ev, atual, transacao, agora)
                if dec:
                    status, ate, encerradas = dec
                    tr = transacao or atual.get("transacao") or ""
                    aplicada = tem_conta and acessos.definir_assinatura(email, status, ate, "hotmart", tr, compra=True,
                                                                         encerradas=encerradas)
                    if not aplicada:
                        self.pendentes[email] = dict(status=status, ate=ate, transacao=tr, encerradas=encerradas)
        reg = dict(quando=agora, evento=ev, email=email, nome=nome, transacao=transacao, valor=preco.get("value"),
                   moeda=preco.get("currency_value") or preco.get("currency_code"), produto=produto,
                   status=status, ate=ate, aplicada=aplicada if status else None, encerradas=encerradas if status else None,
                   ignorado="outro produto" if outro else None)
        with self.trava:
            with open(self.arq_compras, "a", encoding="utf-8") as f:
                f.write(json.dumps(reg, ensure_ascii=False) + "\n")
        return reg

    def pendente(self, email):
        """Compra guardada para este e-mail (sem tirar da lista: so sai depois que o cadastro deu certo)."""
        e = (email if isinstance(email, str) else "").strip().lower()
        with self.trava:
            p = self.pendentes.get(e)
            return dict(p) if p else None

    def pendente_usada(self, email):
        """O cadastro deu certo: a compra guardada ja esta na conta."""
        e = (email if isinstance(email, str) else "").strip().lower()
        with self.trava:
            self.pendentes.pop(e, None)

    def compras(self, n=200):
        try:
            with open(self.arq_compras, encoding="utf-8") as f:
                linhas = f.readlines()[-n:]
        except OSError:
            return []
        out = []
        for l in linhas:
            try:
                out.append(json.loads(l))
            except ValueError:
                pass
        return out

    # ------------------------------------------------------------------------------------------ visitas da pagina
    def visita(self, caminho, ip, ref, ua, utm):
        dia = time.strftime("%Y-%m-%d", time.gmtime(time.time() - 3 * 3600))
        reg = dict(quando=round(time.time(), 1), dia=dia, pagina=caminho[:80], quem=hashlib.sha256(("apex|" + ip).encode()).hexdigest()[:12],
                   ref=(ref or "")[:200], celular=bool(ua and ("Mobile" in ua or "Android" in ua)), utm=utm[:120])
        with self.trava:
            with open(self.arq_visitas, "a", encoding="utf-8") as f:
                f.write(json.dumps(reg, ensure_ascii=False) + "\n")

    def resumo_visitas(self, dias=30):
        try:
            with open(self.arq_visitas, encoding="utf-8") as f:
                linhas = f.readlines()[-200000:]
        except OSError:
            linhas = []
        limite = time.time() - dias * 86400
        por_dia, refs, quem_dia = {}, {}, {}
        for l in linhas:
            try:
                v = json.loads(l)
            except ValueError:
                continue
            if v.get("quando", 0) < limite:
                continue
            d = por_dia.setdefault(v["dia"], dict(visitas=0, pessoas=0))
            d["visitas"] += 1
            qs = quem_dia.setdefault(v["dia"], set())
            if v["quem"] not in qs:
                qs.add(v["quem"])
                d["pessoas"] += 1
            r = urllib.parse.urlparse(v.get("ref") or "").netloc or (v.get("utm") or "direto")
            refs[r] = refs.get(r, 0) + 1
        return dict(porDia=sorted(por_dia.items()), origens=sorted(refs.items(), key=lambda x: -x[1])[:12])
