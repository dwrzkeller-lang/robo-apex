# -*- coding: utf-8 -*-
"""Conexao com a corretora pelo MetaTrader 5 (aba Conectar).

Como funciona (e por que a responsabilidade fica com quem opera):
  1. O usuario abre a conta na corretora dele e entra no MetaTrader 5 DELE. O robo nunca ve login nem senha da corretora.
  2. Ele instala o EA "RoboApex" (arquivo .mq5) no MetaTrader, cola o codigo de conexao desta aba e liga o "Algo Trading".
  3. O EA manda para o robo os candles de 1 minuto da propria corretora (tempo real) e o estado da conta (demo ou real,
     saldo, posicoes). Com esses candles o robo cria o ativo "MT5:<simbolo>", e o usuario liga um teste ao vivo nele.
  4. O EA pergunta ao robo, a cada 2 s, o que o teste escolhido quer: ordem armada (stop/limitada/a mercado), posicao com
     stop e alvo, ou nenhuma posicao. E ele, dentro do MetaTrader, quem envia, muda e cancela as ordens.
  5. Travas: o EA vem preso a conta DEMO; conta real so com a opcao ligada no EA E aqui (com confirmacao escrita).
     Lote maximo, perda maxima no dia e o botao LIGADO/DESLIGADO (desliga cancela as ordens pendentes na hora).
  6. PILOTO AUTOMATICO (3.1): um botao so liga o teste ao vivo no ativo da corretora com a estrategia, o tempo, a gestao e
     o filtro de qualidade escolhidos e manda o EA seguir. O servidor tem travas proprias, alem das do EA: horario de
     operacao, maximo de operacoes no dia e perda maxima do dia (nenhuma ordem NOVA sai depois disso; a posicao aberta
     continua com o stop e o alvo). O botao de EMERGENCIA desliga tudo e manda o EA zerar a posicao e cancelar as ordens.
Tudo fica registrado (aceite do termo com data e IP, cada mudanca de configuracao e o que o EA informou)."""
import hashlib
import json
import os
import secrets
import threading
import time
from datetime import datetime, timedelta, timezone

BRT = timezone(timedelta(hours=-3))

TERMO_VERSAO = "2026-10-15"
TERMO = (
    "TERMO DE USO DA CONEXÃO COM A CORRETORA\n\n"
    "1. O Robô Apex é uma ferramenta de estudo e análise de estratégias. Ele não é corretora, não é consultoria, não faz "
    "recomendação de investimento e não administra o seu dinheiro.\n"
    "2. A conta na corretora é sua. Você abre, deposita, entra no MetaTrader com os seus dados e decide ligar ou desligar o "
    "envio de ordens. O robô nunca recebe a sua senha da corretora.\n"
    "3. Quando você liga o EA, as ordens são enviadas pelo SEU MetaTrader, na SUA conta, por decisão SUA. Você é o único "
    "responsável por elas, pelos resultados (ganhos e perdas), pelos custos e pelos impostos.\n"
    "4. Operações em bolsa e cripto têm risco de perda, inclusive maior que o valor investido em alguns produtos. "
    "Resultados passados e simulações não garantem resultados futuros.\n"
    "5. Falhas de internet, de energia, da corretora, do MetaTrader, dos dados ou do próprio robô podem fazer uma ordem não "
    "ser enviada, ser enviada com atraso, em outro preço ou mais de uma vez. Acompanhe a sua conta sempre que o EA estiver "
    "ligado e use os limites (lote máximo e perda máxima no dia).\n"
    "6. Recomendamos usar primeiro uma conta DEMO. O uso em conta real exige a sua confirmação escrita.\n"
    "7. Os criadores do Robô Apex não se responsabilizam por perdas, lucros cessantes ou qualquer dano decorrente do uso da "
    "ferramenta, das estratégias ou da conexão com a corretora.\n"
    "8. Você pode desligar a conexão a qualquer momento nesta aba ou removendo o EA do gráfico no MetaTrader."
)
MAX_LOG = 300
FRESCO = 90.0                 # segundos: resultado do teste mais velho que isso nao vira ordem (o EA espera)


def _agora():
    return time.time()


class Conexao:
    def __init__(self, base_dados, pasta_de, ler_json, gravar_json):
        self.base = base_dados
        self.pasta_de, self.ler_json, self.gravar_json = pasta_de, ler_json, gravar_json
        self.trava = threading.RLock()
        self.mem = {}                                   # uid -> estado
        self.velas = {}                                 # simbolo -> dict(minutos=[...], offset, quando, uid)
        self._tokens = None

    # ------------------------------------------------------------------------------------------ estado por usuario
    def _arq(self, uid):
        return os.path.join(self.pasta_de(uid), "estado_conexao.json")

    def _est(self, uid):
        e = self.mem.get(uid)
        if e is None:
            e = self.ler_json(self._arq(uid), {}) or {}
            e.setdefault("cfg", dict(simbolo="", ativo="WIN", teste=None, mult=1.0, max_lote=1.0, perda_dia=0.0, ligado=False, real=False))
            for k, v in (("max_ops", 0), ("hora_ini", 0), ("hora_fim", 0), ("zerar", False)):
                e["cfg"].setdefault(k, v)
            e.setdefault("log", [])
            self.mem[uid] = e
        return e

    def _gravar(self, uid):
        self.gravar_json(self._arq(uid), self.mem[uid])

    def _log(self, e, tipo, detalhe):
        e["log"].append(dict(t=round(_agora(), 1), tipo=tipo, detalhe=str(detalhe)[:300]))
        e["log"] = e["log"][-MAX_LOG:]

    def _mapa_tokens(self):
        if self._tokens is None:
            self._tokens = self.ler_json(os.path.join(self.base, "conexao_tokens.json"), {}) or {}
        return self._tokens

    @staticmethod
    def _hash(tok):
        return hashlib.sha256(tok.encode("utf-8")).hexdigest()

    def uid_do_token(self, tok):
        if not tok or len(tok) < 20:
            return None
        with self.trava:
            return self._mapa_tokens().get(self._hash(tok))

    # ------------------------------------------------------------------------------------------ o que a tela usa
    def publico(self, uid, porta=None):
        with self.trava:
            e = self._est(uid)
            st = e.get("ea") or {}
            online = bool(st) and _agora() - st.get("quando", 0) < 20
            return dict(termo=TERMO, termoVersao=TERMO_VERSAO, aceite=e.get("aceite"), temToken=bool(e.get("token_fim")),
                        tokenFim=e.get("token_fim"), cfg=e["cfg"], ea=st, eaOnline=online, log=e["log"][-60:][::-1],
                        simbolos=sorted(k for k, v in self.velas.items() if v.get("uid") == uid), porta=porta,
                        piloto=e.get("piloto") or {})

    def acao(self, uid, p, ip=""):
        acao = p.get("acao")
        with self.trava:
            e = self._est(uid)
            if acao == "aceitar":
                if str(p.get("confirmo", "")).strip().upper() != "ACEITO":
                    raise ValueError("Para aceitar, escreva ACEITO no campo de confirmação.")
                e["aceite"] = dict(versao=TERMO_VERSAO, quando=int(_agora()), ip=ip)
                self._log(e, "termo", "termo aceito (versão %s) a partir do IP %s" % (TERMO_VERSAO, ip))
            elif not e.get("aceite") or e["aceite"].get("versao") != TERMO_VERSAO:
                raise ValueError("Leia e aceite o termo de uso da conexão antes.")
            elif acao == "token":
                tok = secrets.token_urlsafe(24)
                mapa = self._mapa_tokens()
                for h in [h for h, u in mapa.items() if u == uid]:
                    del mapa[h]
                mapa[self._hash(tok)] = uid
                self.gravar_json(os.path.join(self.base, "conexao_tokens.json"), mapa)
                e["token_fim"] = tok[-4:]
                self._log(e, "token", "código de conexão novo gerado (o anterior deixou de valer)")
                self._gravar(uid)
                return dict(self.publico(uid), token=tok)
            elif acao == "config":
                c = e["cfg"]
                sim = str(p.get("simbolo", c["simbolo"]) or "").strip().upper()[:24]
                if sim and not all(ch.isalnum() or ch in "$._-" for ch in sim):
                    raise ValueError("Símbolo inválido.")
                c.update(simbolo=sim, ativo=str(p.get("ativo", c["ativo"]))[:20],
                         teste=p.get("teste", c.get("teste")),
                         mult=max(0.01, min(100.0, float(p.get("mult", c["mult"]) or 1))),
                         max_lote=max(0.01, min(1000.0, float(p.get("max_lote", c["max_lote"]) or 1))),
                         perda_dia=max(0.0, float(p.get("perda_dia", c["perda_dia"]) or 0)),
                         max_ops=max(0, min(100, int(p.get("max_ops", c.get("max_ops", 0)) or 0))),
                         hora_ini=_hhmm(p.get("hora_ini", c.get("hora_ini", 0))), hora_fim=_hhmm(p.get("hora_fim", c.get("hora_fim", 0))))
                self._log(e, "config", "símbolo %s, teste %s, multiplicador %g, lote máximo %g, perda máxima no dia %g"
                          % (c["simbolo"] or "-", c["teste"] or "-", c["mult"], c["max_lote"], c["perda_dia"]))
            elif acao == "ligar":
                quer = bool(p.get("ligado"))
                if quer and not e["cfg"].get("teste"):
                    raise ValueError("Escolha o teste ao vivo que o EA vai seguir.")
                e["cfg"]["ligado"] = quer
                if quer:
                    e["cfg"]["zerar"] = False
                self._log(e, "ligar", "envio de ordens LIGADO" if quer else "envio de ordens DESLIGADO (o EA cancela as ordens pendentes)")
            elif acao == "emergencia":
                e["cfg"].update(ligado=False, zerar=True)
                self._log(e, "emergencia", "BOTÃO DE EMERGÊNCIA: envio desligado; o EA zera a posição e cancela as ordens")
            elif acao == "real":
                quer = bool(p.get("real"))
                if quer and str(p.get("confirmo", "")).strip().upper() != "CONTA REAL":
                    raise ValueError("Para permitir conta real, escreva CONTA REAL no campo de confirmação.")
                e["cfg"]["real"] = quer
                self._log(e, "real", "conta REAL permitida pelo usuário (IP %s)" % ip if quer else "conta real bloqueada (só demo)")
            else:
                raise ValueError("ação desconhecida")
            self._gravar(uid)
            return self.publico(uid)

    # ------------------------------------------------------------------------------------------ o que o EA usa
    def receber_estado(self, uid, d):
        """Batida do EA: conta, tipo (DEMO/REAL), saldo, posicoes e os eventos desde a ultima batida."""
        with self.trava:
            e = self._est(uid)
            antes = e.get("ea") or {}
            st = dict(conta=str(d.get("conta", ""))[:30], tipo=str(d.get("tipo", ""))[:10].upper(), corretora=str(d.get("corretora", ""))[:60],
                      servidor=str(d.get("servidor", ""))[:60], saldo=d.get("saldo"), patrimonio=d.get("patrimonio"),
                      moeda=str(d.get("moeda", ""))[:8], simbolo=str(d.get("simbolo", ""))[:24], versao=str(d.get("versao", ""))[:10],
                      posicoes=d.get("posicoes") if isinstance(d.get("posicoes"), list) else [], resultadoDia=d.get("resultadoDia"),
                      quando=_agora())
            e["ea"] = st
            if e["cfg"].get("zerar") and not st["posicoes"]:
                e["cfg"]["zerar"] = False
                self._log(e, "emergencia", "o EA confirmou: sem posição aberta")
            if antes.get("tipo") != st["tipo"] or antes.get("conta") != st["conta"]:
                self._log(e, "ea", "EA conectado: conta %s (%s) na %s" % (st["conta"], st["tipo"] or "?", st["corretora"] or "corretora"))
            for ev in (d.get("eventos") or [])[:30]:
                if isinstance(ev, dict):
                    self._log(e, "ea_" + str(ev.get("tipo", "evento"))[:20], ev.get("detalhe", ""))
            if d.get("eventos"):
                self._gravar(uid)
            c = e["cfg"]
            return "OK=1\nLIGADO=%d\nREAL=%d\n%s" % (1 if c.get("ligado") else 0, 1 if c.get("real") else 0, "ZERAR=1\n" if c.get("zerar") else "")

    def receber_candles(self, uid, d):
        """Candles de 1 minuto da corretora: [[t (hora do servidor da corretora), o, h, l, c, v], ...] e o fuso do servidor."""
        sim = str(d.get("simbolo", "")).strip().upper()[:24]
        if not sim or not all(ch.isalnum() or ch in "$._-" for ch in sim):
            raise ValueError("símbolo inválido")
        off = int(d.get("offset", 0))
        novas = []
        for b in (d.get("barras") or [])[:20000]:
            try:
                t, o, h, l, c, v = int(b[0]) - off, float(b[1]), float(b[2]), float(b[3]), float(b[4]), float(b[5] if len(b) > 5 else 0)
            except (TypeError, ValueError, IndexError):
                continue
            if h >= max(o, c) and l <= min(o, c) and l > 0:
                novas.append((t - t % 60, o, h, l, c, v))
        with self.trava:
            x = self.velas.get(sim)
            if x is None:
                arq = os.path.join(self.base, "mt5", sim + ".json")
                antigas = self.ler_json(arq, []) or []
                x = self.velas[sim] = dict(minutos={int(m[0]): tuple(m) for m in antigas if isinstance(m, list) and len(m) == 6}, uid=uid, gravado=0)
            for m in novas:
                x["minutos"][m[0]] = m
            if len(x["minutos"]) > 60000:                        # ~2 meses de pregao de 1 minuto
                for k in sorted(x["minutos"])[:-60000]:
                    del x["minutos"][k]
            x.update(uid=uid, quando=_agora(), offset=off, versao=x.get("versao", 0) + 1, ativo=self._est(uid)["cfg"].get("ativo") or "WIN")
            if _agora() - x["gravado"] > 120:
                os.makedirs(os.path.join(self.base, "mt5"), exist_ok=True)
                self.gravar_json(os.path.join(self.base, "mt5", sim + ".json"), [list(m) for _, m in sorted(x["minutos"].items())])
                x["gravado"] = _agora()
            return len(novas)

    def simbolos_de(self, uid):
        with self.trava:
            e = self._est(uid)
            sims = {k for k, v in self.velas.items() if v.get("uid") == uid}
            if e["cfg"].get("simbolo"):
                sims.add(e["cfg"]["simbolo"])
            return sorted(s for s in sims if self.minutos(s)[0])

    def ativo_de(self, sim):
        """Ativo do robo (custos, horario, valor do ponto) escolhido para o simbolo na aba Conectar."""
        with self.trava:
            x = self.velas.get(sim) or {}
            if x.get("ativo"):
                return x["ativo"]
            for e in self.mem.values():
                if e["cfg"].get("simbolo") == sim:
                    return e["cfg"].get("ativo") or "WIN"
            return "WIN"

    def minutos(self, sim):
        """[(t_utc, o, h, l, c, v)] do simbolo, em ordem, e a versao (muda a cada lote novo)."""
        with self.trava:
            x = self.velas.get(sim)
            if x is None:
                arq = os.path.join(self.base, "mt5", sim + ".json")
                antigas = self.ler_json(arq, None)
                if not antigas:
                    return None, 0
                x = self.velas[sim] = dict(minutos={int(m[0]): tuple(m) for m in antigas if isinstance(m, list) and len(m) == 6}, uid=None, gravado=_agora())
            return [m for _, m in sorted(x["minutos"].items())], x.get("versao", 0)

    def _piloto(self, uid, estado, motivo, **extra):
        with self.trava:
            e = self._est(uid)
            antes = (e.get("piloto") or {}).get("estado")
            e["piloto"] = dict(estado=estado, motivo=motivo, quando=round(_agora(), 1), **extra)
            if antes != estado and estado in ("pausado", "operando"):
                self._log(e, "piloto", motivo)

    def _travas(self, uid, c, r):
        """Travas do servidor (alem das do EA). Devolve o motivo da pausa ou "" se pode mandar ordens novas."""
        agora = datetime.now(BRT)
        hoje = agora.strftime("%Y%m%d")
        # os horarios do teste sao o relogio da bolsa "vestido" de UTC: para o dia, basta a data em UTC
        dia_c = lambda t: datetime.fromtimestamp(t, timezone.utc).strftime("%Y%m%d")      # noqa: E731
        trades = [t for t in (r.get("trades") or []) if dia_c(t.get("t_ent", 0)) == hoje]
        abertas = [a for a in (r.get("abertas") or []) if dia_c(a.get("t_ent", 0)) == hoje]
        ops = len(trades) + len(abertas)
        res = round(sum(t.get("dinheiro", 0.0) for t in trades), 2)
        hm = agora.hour * 100 + agora.minute
        motivo = ""
        ini, fim = c.get("hora_ini") or 0, c.get("hora_fim") or 0
        dentro = (ini <= hm <= fim) if ini <= fim else (hm >= ini or hm <= fim)      # janela que passa da meia-noite
        if (ini or fim) and not dentro:
            motivo = "fora do horário de operação (%02d:%02d às %02d:%02d)" % (c["hora_ini"] // 100, c["hora_ini"] % 100, c["hora_fim"] // 100, c["hora_fim"] % 100)
        elif c.get("max_ops") and ops >= c["max_ops"]:
            motivo = "limite de %d operações no dia atingido" % c["max_ops"]
        elif c.get("perda_dia") and res <= -c["perda_dia"]:
            motivo = "perda máxima do dia atingida (%s)" % res
        self._piloto(uid, "pausado" if motivo else "operando", motivo or "operando: seguindo a estratégia", opsHoje=ops, resultadoHoje=res)
        return motivo

    def sinal(self, uid, resultado_do_teste):
        """Texto para o EA: o que o teste escolhido quer agora. resultado_do_teste(uid, id) -> (x, r, quando) ou None."""
        with self.trava:
            e = self._est(uid)
            c = dict(e["cfg"])
        linhas = ["LIGADO=%d" % (1 if c.get("ligado") else 0), "REAL=%d" % (1 if c.get("real") else 0), "SIMBOLO=%s" % c["simbolo"],
                  "MULT=%g" % c["mult"], "MAXLOTE=%g" % c["max_lote"], "PERDADIA=%g" % c["perda_dia"]]
        if c.get("zerar"):
            linhas.append("ZERAR=1")
            self._piloto(uid, "emergencia", "botão de emergência: zerando a posição")
            return "OK=1\n" + "\n".join(linhas) + "\n"
        if not c.get("ligado") or not c.get("teste"):
            self._piloto(uid, "desligado", "piloto desligado")
            return "OK=1\n" + "\n".join(linhas) + "\n"
        rt = resultado_do_teste(uid, c["teste"])
        if not rt:
            return "OK=0\nMOTIVO=o teste escolhido não está ligado\n"
        x, r, quando = rt
        if x.get("ate"):
            return "OK=0\nMOTIVO=o teste escolhido foi encerrado\n"
        if _agora() - quando > FRESCO:
            return "OK=0\nMOTIVO=o teste está sem dados novos há mais de %d s\n" % FRESCO
        if not str(x.get("ativo", "")).upper() == "MT5:" + c["simbolo"]:
            return "OK=0\nMOTIVO=o teste precisa ser no ativo MT5:%s (dados da sua corretora)\n" % c["simbolo"]
        pausa = self._travas(uid, c, r)
        q0 = float(x.get("contratos") or 1)
        qtd = lambda q: min(c["max_lote"], round((q or q0) * c["mult"], 2))        # noqa: E731
        for a in r.get("abertas") or []:
            linhas.append("POS=P|%s|%d;%d;%g;%s;%s" % (a["est"], int(a["t_ent"]), a["dir"], qtd(a.get("q")),
                                                       _num(a.get("stop")), _num(a.get("alvo"))))
        if pausa:
            linhas.append("PAUSA=%s" % pausa)                # nenhuma ordem NOVA; a posicao aberta segue com o stop e o alvo dela
        for o in [] if pausa else (r.get("pend") or []):
            tipo = "mercado" if o.get("tipo") == "abertura" else ("limite" if o.get("tipo") == "limite" else "stop")
            linhas.append("ORD=O|%s|%d|%d;%d;%s;%s;%g;%s;%s" % (o["est"], int(o["t_sinal"]), o["dir"], o["dir"], tipo, _num(o.get("gatilho")),
                                                                qtd(o.get("q")), _num(o.get("stop")), _num(o.get("alvo"))))
        return "OK=1\n" + "\n".join(linhas) + "\n"


def _hhmm(v):
    """'9:05', '0905' ou 905 -> 905 (0 = sem limite)."""
    try:
        t = str(v or "0").replace(":", "").strip()
        n = int(t) if t else 0
    except ValueError:
        return 0
    return n if 0 <= n <= 2359 and n % 100 < 60 else 0


def _num(v):
    return "" if v is None else ("%.10g" % v)
