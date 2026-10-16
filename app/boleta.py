# -*- coding: utf-8 -*-
"""Boleta simulada (paper trading): o usuario compra e vende na hora, com contratos, stop e alvo, como numa corretora,
mas sem dinheiro. As ordens sao conferidas com os candles de 5 minutos do proprio robo.

Regras de execucao (do lado conservador, como no simulador):
  * a mercado: executa no ultimo preco +/- o escorregamento do ativo; so com o mercado aberto;
  * limitada: compra executa quando a minima chega no preco (pelo preco ou pela abertura, se abriu abaixo); venda, o espelho;
  * stop (entrada por rompimento): compra executa quando a maxima chega no preco (+ escorregamento);
  * stop e alvo da posicao: o stop e conferido antes do alvo; se o candle abriu alem, sai pela abertura;
  * no candle em que a ordem foi enviada ou a posicao aberta, so conta o preco de agora (as maximas e minimas daquele
    candle podem ter acontecido antes do clique);
  * custos: os mesmos do ativo no robo (corretagem por contrato e taxa em % do valor), na entrada e na saida.
Uma posicao por ativo (liquida): ordem no mesmo lado aumenta a posicao (preco medio); no lado contrario reduz, zera ou inverte."""
import json
import os
import threading
import time

TF = 5
MAX_HIST = 500
_travas = {}
_trava_geral = threading.Lock()


def _trava(uid):
    with _trava_geral:
        return _travas.setdefault(uid, threading.Lock())


def _arq(pasta):
    return os.path.join(pasta, "estado_boleta.json")


def _ler(pasta):
    try:
        with open(_arq(pasta), encoding="utf-8") as f:
            e = json.load(f)
    except (OSError, ValueError):
        e = {}
    if not isinstance(e, dict):
        e = {}
    e.setdefault("pos", {})
    e.setdefault("ordens", [])
    e.setdefault("hist", [])
    e.setdefault("visto", {})
    e.setdefault("seq", 0)
    return e


def _gravar(pasta, e):
    os.makedirs(pasta, exist_ok=True)
    tmp = _arq(pasta) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(e, f, ensure_ascii=False)
    os.replace(tmp, _arq(pasta))


class Boleta:
    """carregar(chave, tf) -> (B, fonte, cfg); sessao(cfg) -> custos e tick; formando(B, cfg, chave) -> mercado aberto?"""

    def __init__(self, carregar, sessao, formando, pasta_de):
        self.carregar, self.sessao, self.formando, self.pasta_de = carregar, sessao, formando, pasta_de

    # ------------------------------------------------------------------------------------------ contas
    @staticmethod
    def _custo(sc, preco, qtd):
        """Custo de UM lado (entrada ou saida) para qtd contratos/lotes."""
        return qtd * (sc["custo"] + sc.get("custo_pct", 0.0) * abs(preco) * sc["valor_ponto"])

    def _fechar(self, e, ativo, sc, cfg, qtd, preco, motivo, t):
        """Fecha qtd da posicao do ativo ao preco: realiza o resultado (ja com os custos de ida e volta da parte fechada)."""
        p = e["pos"][ativo]
        pts = p["lado"] * (preco - p["pm"])
        bruto = pts * sc["valor_ponto"] * qtd
        custo = self._custo(sc, p["pm"], qtd) + self._custo(sc, preco, qtd)
        e["hist"].append(dict(ativo=ativo, nome=cfg.get("curto") or cfg["nome"].split(" - ")[0], lado=p["lado"], qtd=qtd,
                              ent=p["pm"], sai=preco, pts=pts, res=round(bruto - custo, 2), custo=round(custo, 2),
                              moeda=cfg.get("moeda", "R$"), motivo=motivo, t_ent=p["desde"], t_sai=t, quando=time.time(),
                              dec=cfg["decimais"]))
        e["hist"] = e["hist"][-MAX_HIST:]
        p["qtd"] = round(p["qtd"] - qtd, 6)
        if p["qtd"] <= 1e-9:
            del e["pos"][ativo]

    def _executar(self, e, ativo, sc, cfg, lado, qtd, preco, stop, alvo, t, origem):
        """Uma execucao (ordem que andou): soma, reduz, zera ou inverte a posicao."""
        p = e["pos"].get(ativo)
        if p and p["lado"] != lado:
            fecha = min(qtd, p["qtd"])
            self._fechar(e, ativo, sc, cfg, fecha, preco, origem, t)
            qtd = round(qtd - fecha, 6)
            p = e["pos"].get(ativo)
        if qtd <= 1e-9:
            return
        if p:
            p["pm"] = (p["pm"] * p["qtd"] + preco * qtd) / (p["qtd"] + qtd)
            p["qtd"] = round(p["qtd"] + qtd, 6)
            if stop is not None:
                p["stop"] = stop
            if alvo is not None:
                p["alvo"] = alvo
        else:
            e["pos"][ativo] = dict(lado=lado, qtd=qtd, pm=preco, stop=stop, alvo=alvo, desde=t, t_abriu=t)

    # ------------------------------------------------------------------------------------------ candles
    def _processar(self, e, ativo):
        """Confere as ordens e a posicao do ativo com os candles novos. Devolve (B, cfg, sc) ou None."""
        if ativo not in e["pos"] and not any(o["ativo"] == ativo for o in e["ordens"]):
            return None
        B, _, cfg = self.carregar(ativo, TF)
        sc = self.sessao(cfg)
        t, o_, h_, l_, c_ = B["t"], B["o"], B["h"], B["l"], B["c"]
        n = len(t)
        if not n:
            return B, cfg, sc
        aberto = self.formando(B, cfg, ativo)
        ult_fechado = n - 2 if aberto else n - 1
        visto = e["visto"].get(ativo, 0)
        slip = sc["slip"]
        # so os candles depois do que ja foi conferido E a partir do candle em que a ordem/posicao mais antiga nasceu
        inicio = min([o.get("t_candle", 0) for o in e["ordens"] if o["ativo"] == ativo] +
                     ([e["pos"][ativo].get("t_abriu", 0)] if ativo in e["pos"] else []) or [0])
        k0 = next((k for k in range(n) if t[k] > visto and t[k] >= inicio), n)
        for k in range(k0, n):
            fechado = k <= ult_fechado
            for_criacao = lambda obj: obj.get("t_candle", 0) >= t[k]       # noqa: E731
            # ordens pendentes
            for od in list(e["ordens"]):
                if od["ativo"] != ativo:
                    continue
                if od.get("t_candle", 0) > t[k]:
                    continue
                o, h, l, c = o_[k], h_[k], l_[k], c_[k]
                criacao = for_criacao(od)
                if criacao:
                    o = h = l = c                                    # no candle do clique, so o preco de agora
                d, pr = od["lado"], od["preco"]
                preco = None
                if od["tipo"] == "limite":
                    if (d > 0 and l <= pr) or (d < 0 and h >= pr):
                        preco = pr if criacao else (min(o, pr) if d > 0 else max(o, pr))
                else:                                                # stop de entrada (rompimento)
                    if (d > 0 and h >= pr) or (d < 0 and l <= pr):
                        preco = (max(o, pr) + slip) if d > 0 else (min(o, pr) - slip)
                if preco is not None:
                    e["ordens"].remove(od)
                    self._executar(e, ativo, sc, cfg, d, od["qtd"], preco, od.get("stop"), od.get("alvo"), t[k],
                                   "ordem %s executada" % ("limitada" if od["tipo"] == "limite" else "stop"))
                    p = e["pos"].get(ativo)
                    if p and p.get("t_abriu", 0) < t[k]:
                        p["t_abriu"] = t[k]
            # stop e alvo da posicao
            p = e["pos"].get(ativo)
            if p and p.get("t_abriu", 0) <= t[k]:
                o, h, l, c = o_[k], h_[k], l_[k], c_[k]
                criacao = p.get("t_abriu", 0) >= t[k]
                if criacao:
                    o = h = l = c                                    # o candle em que abriu: so o preco de agora
                d = p["lado"]
                st, al = p.get("stop"), p.get("alvo")
                if st is not None and ((d > 0 and l <= st) or (d < 0 and h >= st)):
                    alem = not criacao and ((d > 0 and o < st) or (d < 0 and o > st))
                    sai = (o if alem else st) - d * slip
                    self._fechar(e, ativo, sc, cfg, p["qtd"], sai, "stop" + (" (abriu além)" if alem else ""), t[k])
                elif al is not None and ((d > 0 and h >= al) or (d < 0 and l <= al)):
                    alem = not criacao and ((d > 0 and o > al) or (d < 0 and o < al))
                    self._fechar(e, ativo, sc, cfg, p["qtd"], o if alem else al, "alvo" + (" (abriu além)" if alem else ""), t[k])
            p = e["pos"].get(ativo)
            if p and fechado and p.get("gestao") in ("be", "trail") and p.get("t_abriu", 0) < t[k]:
                self._gerir(p, B, k, sc, cfg)
            if fechado:
                e["visto"][ativo] = t[k]
        return B, cfg, sc

    @staticmethod
    def _gerir(p, B, k, sc, cfg):
        """Gestao automatica da posicao no fechamento do candle k: empate (stop no preco medio quando andou 1 vez o risco)
        ou trailing stop (stop a 1,5 ATR do fechamento, so andando a favor)."""
        d, pm, r = p["lado"], p["pm"], p.get("risco") or 0.0
        c = B["c"][k]
        tick = sc["tick"]
        arred = lambda v: round(round(v / tick) * tick, cfg["decimais"] + 2)       # noqa: E731
        if p["gestao"] == "be":
            if r > 0 and d * (c - pm) >= r and (p.get("stop") is None or d * (p["stop"] - pm) < 0):
                p["stop"] = arred(pm + d * tick)                 # empate: o stop vai para o preco medio (+1 tick)
        else:
            ini = max(1, k - 13)
            trs = [max(B["h"][i] - B["l"][i], abs(B["h"][i] - B["c"][i - 1]), abs(B["l"][i] - B["c"][i - 1])) for i in range(ini, k + 1)]
            atr = sum(trs) / len(trs) if trs else 0.0
            if atr > 0:
                novo = arred(c - d * 1.5 * atr)
                if p.get("stop") is None or d * (novo - p["stop"]) > 0:
                    p["stop"] = novo

    def _todos(self, e):
        ativos = set(e["pos"]) | {o["ativo"] for o in e["ordens"]}
        info = {}
        for a in ativos:
            try:
                r = self._processar(e, a)
                if r:
                    info[a] = r
            except Exception as ex:                                  # sem dados agora: tenta de novo no proximo pedido
                info[a] = ex
        return info

    # ------------------------------------------------------------------------------------------ o que a tela usa
    def estado(self, uid, ativo_tela=None):
        pasta = self.pasta_de(uid)
        with _trava(uid):
            e = _ler(pasta)
            antes = json.dumps([e["pos"], e["ordens"], len(e["hist"]), e["visto"]], sort_keys=True)
            info = self._todos(e)
            if json.dumps([e["pos"], e["ordens"], len(e["hist"]), e["visto"]], sort_keys=True) != antes:
                _gravar(pasta, e)
            return self._publico(e, info, ativo_tela)

    def _publico(self, e, info, ativo_tela):
        pos = []
        for a, p in e["pos"].items():
            r = info.get(a)
            agora = aberto_res = None
            dec, moeda, nome = 2, "R$", a
            if isinstance(r, tuple):
                B, cfg, sc = r
                agora = B["c"][-1]
                dec, moeda, nome = cfg["decimais"], cfg.get("moeda", "R$"), cfg.get("curto") or cfg["nome"].split(" - ")[0]
                aberto_res = round(p["lado"] * (agora - p["pm"]) * sc["valor_ponto"] * p["qtd"]
                                   - self._custo(sc, p["pm"], p["qtd"]) - self._custo(sc, agora, p["qtd"]), 2)
            pos.append(dict(ativo=a, nome=nome, lado=p["lado"], qtd=p["qtd"], pm=p["pm"], stop=p.get("stop"), alvo=p.get("alvo"),
                            gestao=p.get("gestao", ""), gestaoNome=p.get("gestaoNome", ""),
                            desde=p["desde"], agora=agora, res=aberto_res, dec=dec, moeda=moeda))
        hoje = time.strftime("%Y%m%d", time.gmtime(time.time() - 3 * 3600))
        dia = [x for x in e["hist"] if time.strftime("%Y%m%d", time.gmtime(x["quando"] - 3 * 3600)) == hoje]
        return dict(pos=pos, ordens=e["ordens"], hist=e["hist"][-60:][::-1], nHist=len(e["hist"]),
                    dia=dict(n=len(dia), por_moeda=_somar(dia)), total=dict(n=len(e["hist"]), por_moeda=_somar(e["hist"])))

    def acao(self, uid, p):
        """p = dict(acao=...). Acoes: ordem, cancelar, zerar, zerar_tudo, mover, gestao, limpar."""
        pasta = self.pasta_de(uid)
        acao = p.get("acao")
        with _trava(uid):
            e = _ler(pasta)
            info = self._todos(e)
            if acao == "ordem":
                self._ordem(e, p)
            elif acao == "cancelar":
                e["ordens"] = [o for o in e["ordens"] if str(o["id"]) != str(p.get("id"))]
            elif acao == "cancelar_tudo":
                ativo = p.get("ativo")
                e["ordens"] = [o for o in e["ordens"] if ativo and o["ativo"] != ativo]
            elif acao == "zerar":
                self._zerar(e, str(p.get("ativo", "")), "zerada na mão")
            elif acao == "inverter":
                a = str(p.get("ativo", ""))
                pos = e["pos"].get(a)
                if not pos:
                    raise ValueError("Não há posição neste ativo para inverter.")
                B, cfg, sc, preco, t = self._preco_agora(a)
                lado, qtd = -pos["lado"], pos["qtd"]
                self._executar(e, a, sc, cfg, lado, 2 * qtd, preco + lado * sc["slip"], None, None, t, "invertida na mão")
                if a in e["pos"]:
                    e["pos"][a].update(stop=None, alvo=None, t_abriu=t, gestao="", gestaoNome="")
            elif acao == "zerar_tudo":
                for a in list(e["pos"]):
                    self._zerar(e, a, "zerada na mão")
                e["ordens"] = []
            elif acao == "mover":
                self._mover(e, p)
            elif acao == "gestao":
                self._gestao(e, p)
            elif acao == "limpar":
                if e["pos"] or e["ordens"]:
                    raise ValueError("Zere as posições e cancele as ordens antes de limpar o histórico.")
                e["hist"] = []
            else:
                raise ValueError("ação desconhecida")
            _gravar(pasta, e)
            return self._publico(e, self._todos(e) if acao in ("ordem", "inverter") else info, p.get("ativo"))

    def _preco_agora(self, ativo):
        B, _, cfg = self.carregar(ativo, TF)
        if not B["t"]:
            raise ValueError("Sem preço para este ativo agora.")
        if not self.formando(B, cfg, ativo):
            raise ValueError("O mercado deste ativo está fechado agora: não há preço para executar a mercado.")
        return B, cfg, self.sessao(cfg), B["c"][-1], B["t"][-1]

    def _zerar(self, e, ativo, motivo):
        pos = e["pos"].get(ativo)
        if not pos:
            raise ValueError("Não há posição neste ativo.")
        B, cfg, sc, preco, t = self._preco_agora(ativo)
        self._fechar(e, ativo, sc, cfg, pos["qtd"], preco - pos["lado"] * sc["slip"], motivo, t)

    @staticmethod
    def _num(v):
        if v is None or v == "":
            return None
        x = float(str(v).replace(",", "."))
        if not (x > 0):
            raise ValueError("preço inválido")
        return x

    def _ordem(self, e, p):
        ativo = str(p.get("ativo", ""))
        lado = 1 if p.get("lado") in (1, "1", "compra") else -1 if p.get("lado") in (-1, "-1", "venda") else 0
        tipo = p.get("tipo") if p.get("tipo") in ("mercado", "limite", "stop") else None
        if not lado or not tipo:
            raise ValueError("ordem inválida")
        B, _, cfg = self.carregar(ativo, TF)
        sc = self.sessao(cfg)
        tick = sc["tick"]
        qtd = float(p.get("qtd") or 0)
        qtd = round(qtd, 2) if sc["fracionado"] else float(round(qtd))
        if not (qtd > 0) or qtd > 100000:
            raise ValueError("Quantidade inválida.")
        arred = lambda v: None if v is None else round(round(v / tick) * tick, cfg["decimais"] + 2)        # noqa: E731
        stop, alvo = arred(self._num(p.get("stop"))), arred(self._num(p.get("alvo")))
        if tipo == "mercado":
            B, cfg, sc, agora, t = self._preco_agora(ativo)
            ref = agora
        else:
            ref = arred(self._num(p.get("preco")))
            if ref is None:
                raise ValueError("Escreva o preço da ordem.")
            agora, t = B["c"][-1], B["t"][-1]
            if tipo == "limite" and ((lado > 0 and ref >= agora) or (lado < 0 and ref <= agora)):
                raise ValueError("Ordem limitada de %s precisa ficar %s do preço de agora (%s). Para executar já, use a mercado."
                                 % ("compra" if lado > 0 else "venda", "abaixo" if lado > 0 else "acima", agora))
            if tipo == "stop" and ((lado > 0 and ref <= agora) or (lado < 0 and ref >= agora)):
                raise ValueError("Ordem stop de %s precisa ficar %s do preço de agora (%s)."
                                 % ("compra" if lado > 0 else "venda", "acima" if lado > 0 else "abaixo", agora))
        if stop is not None and not (lado * (ref - stop) > 0):
            raise ValueError("O stop precisa ficar %s do preço de entrada." % ("abaixo" if lado > 0 else "acima"))
        if alvo is not None and not (lado * (alvo - ref) > 0):
            raise ValueError("O alvo precisa ficar %s do preço de entrada." % ("acima" if lado > 0 else "abaixo"))
        if tipo == "mercado":
            self._executar(e, ativo, sc, cfg, lado, qtd, agora + lado * sc["slip"], stop, alvo, t, "a mercado")
            if ativo in e["pos"]:
                e["pos"][ativo]["t_abriu"] = t
        else:
            if len([o for o in e["ordens"] if o["ativo"] == ativo]) >= 20:
                raise ValueError("Limite de 20 ordens pendentes por ativo.")
            e["seq"] += 1
            e["ordens"].append(dict(id=e["seq"], ativo=ativo, lado=lado, tipo=tipo, preco=ref, qtd=qtd, stop=stop, alvo=alvo,
                                    t_candle=t, quando=time.time(), dec=cfg["decimais"]))

    GESTOES = {"": "manual", "alvo2": "alvo 2:1", "alvo3": "alvo 3:1", "alvo4": "alvo 4:1", "be": "empate no 1:1", "trail": "trailing stop (1,5 ATR)"}

    def _gestao(self, e, p):
        """Gestao da posicao da boleta: alvo em N vezes o risco (precisa de stop), empate no 1R ou trailing stop."""
        ativo = str(p.get("ativo", ""))
        pos = e["pos"].get(ativo)
        if not pos:
            raise ValueError("Não há posição neste ativo.")
        g = str(p.get("gestao") or "")
        if g not in self.GESTOES:
            raise ValueError("gestão desconhecida")
        B, _, cfg = self.carregar(ativo, TF)
        sc = self.sessao(cfg)
        tick = sc["tick"]
        d, pm = pos["lado"], pos["pm"]
        if g in ("alvo2", "alvo3", "alvo4", "be"):
            if pos.get("stop") is None:
                raise ValueError("Coloque um stop antes: o alvo e o empate são medidos em vezes o risco (distância até o stop).")
            r = abs(pm - pos["stop"])
            pos["risco"] = r
            if g.startswith("alvo"):
                pos["alvo"] = round(round((pm + d * int(g[-1]) * r) / tick) * tick, cfg["decimais"] + 2)
        pos["gestao"] = g if g in ("be", "trail") else ""
        pos["gestaoNome"] = self.GESTOES[g]

    def _mover(self, e, p):
        ativo = str(p.get("ativo", ""))
        pos = e["pos"].get(ativo)
        if not pos:
            raise ValueError("Não há posição neste ativo.")
        B, _, cfg = self.carregar(ativo, TF)
        sc = self.sessao(cfg)
        agora, d, tick = B["c"][-1], pos["lado"], sc["tick"]
        for campo in ("stop", "alvo"):
            if campo not in p:
                continue
            v = self._num(p.get(campo))
            if v is not None:
                v = round(round(v / tick) * tick, cfg["decimais"] + 2)
                if campo == "stop" and not (d * (agora - v) > 0):
                    raise ValueError("O stop precisa ficar %s do preço de agora (%s)." % ("abaixo" if d > 0 else "acima", agora))
                if campo == "alvo" and not (d * (v - agora) > 0):
                    raise ValueError("O alvo precisa ficar %s do preço de agora (%s)." % ("acima" if d > 0 else "abaixo", agora))
            pos[campo] = v
        pos["t_abriu"] = max(pos.get("t_abriu", 0), B["t"][-1])     # stop/alvo novo: vale do preco de agora em diante


def _somar(lista):
    out = {}
    for x in lista:
        m = out.setdefault(x["moeda"], dict(res=0.0, n=0, ganhos=0))
        m["res"] = round(m["res"] + x["res"], 2)
        m["n"] += 1
        m["ganhos"] += x["res"] > 0
    return out
