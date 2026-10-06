# -*- coding: utf-8 -*-
"""
ROBO APEX - indicadores e as estrategias.

Regra de ouro: cada estrategia olha SO candles ja fechados (ate o candle i) e, se o setup estiver pronto,
devolve uma ORDEM para os candles seguintes (compra/venda stop acima/abaixo do candle de sinal, ou a
mercado na abertura seguinte). Quem executa, aplica stop, alvo, custos e escorregamento e o simulador.

As regras de compra sao escritas uma unica vez. A venda e o espelho exato: o robo inverte o grafico
(preco -> -preco) e roda a mesma regra de compra. Assim compra e venda nunca ficam diferentes por erro.

  E1  Halt na MM20 ............ Mario Pisani (halt) + Oliver Velez (MM20 inclinada, pullback 3-5-8)
  E2  Gatilho de Fibonacci .... Mario Pisani (correcao de 38,2% a 61,8% do impulso + candle de confirmacao)
  E3  Pullback na VWAP ........ Mario Pisani / Oliver Velez (dia de tendencia acima/abaixo da VWAP)
  E4  Rompimento de base ...... Oliver Velez (power breakout: base estreita no topo, apoiada na MM20)
  E5  Combinacao perfeita + Gift na MM9 ... Velez/Pisani (MM9 > MM20 > MM200, correcao rasa de 1 a 3 candles)
  E6  RSI(2) de Larry Connors . a estrategia de alta taxa de acerto mais testada nos foruns
                                (compra a queda curta acima da MM200, sai quando fecha acima da MM5)
  E7  Rompimento do 1o candle (ORB) ... Zarattini & Aziz (2023), "Can Day Trading Really Be Profitable?"
  E8  Fechamento de gap ....... gaps pequenos dentro da faixa do dia anterior fecham na maioria das vezes
  E9  OGRO: pivo + Fibonacci .. rompimento do pivo com retracao de no maximo 50% e alvos na projecao de
                                Fibonacci, medias simples alinhadas (estilo Andre Machado, "Ogro de Wall Street")
  E10 XTRADERS: Keltner lateral  setup do Adriano Mendes (XTraders) para dias sem direcao: canais de Keltner
                                2,0/2,5 na MME20, IFR(9), alvo na media de 20
  E11 Momentum do dia (faixa de ruido) ... Zarattini, Aziz & Barbon (2024), "Beat the Market": o preco sai da faixa
                                de movimento normal desde a abertura -> segue a direcao, com a VWAP de stop movel
  E12 Fibo ABC: 3 alvos ....... pernada A-B, correcao ate C entre 38,2% e 50%, candle de reversao; stop abaixo de A e
                                tres alvos nas projecoes de Fibonacci da pernada medidas a partir de C (61,8/100/161,8%)
  E13 Fibo 50: ordem limitada . compra limitada nos 50% da pernada (sem esperar confirmacao), stop abaixo de A e alvos
                                ancorados na pernada: o topo B, 127,2% e 161,8% (familia Golden Pocket / OTE)
"""
import math

AQUECIMENTO = 230          # candles necessarios antes do 1o sinal (MM200 + folga)


# ------------------------------------------------------------------------------------------ indicadores
def sma(x, p):
    out, s = [None] * len(x), 0.0
    for i, v in enumerate(x):
        s += v
        if i >= p:
            s -= x[i - p]
        if i >= p - 1:
            out[i] = s / p
    return out


def ema(x, p):
    """Media movel exponencial (a mesma do Profit: alfa = 2 / (p + 1), comeca no 1o preco)."""
    out = [None] * len(x)
    if not x:
        return out
    k = 2.0 / (p + 1)
    e = x[0]
    for i, v in enumerate(x):
        e = v if i == 0 else e + (v - e) * k
        out[i] = e
    return out


def atr(h, l, c, p=14):
    tr = [h[0] - l[0]] + [max(h[i] - l[i], abs(h[i] - c[i - 1]), abs(l[i] - c[i - 1])) for i in range(1, len(c))]
    return sma(tr, p)


def rsi(c, p=2):
    """RSI de Wilder (o mesmo do Profit e do TradingView)."""
    out = [None] * len(c)
    if len(c) <= p:
        return out
    ganhos = perdas = 0.0
    for i in range(1, p + 1):
        d = c[i] - c[i - 1]
        ganhos += max(d, 0.0)
        perdas += max(-d, 0.0)
    mg, mp = ganhos / p, perdas / p
    out[p] = 100.0 if mp == 0 else 100.0 - 100.0 / (1.0 + mg / mp)
    for i in range(p + 1, len(c)):
        d = c[i] - c[i - 1]
        mg = (mg * (p - 1) + max(d, 0.0)) / p
        mp = (mp * (p - 1) + max(-d, 0.0)) / p
        out[i] = 100.0 if mp == 0 else 100.0 - 100.0 / (1.0 + mg / mp)
    return out


def vwap_dia(h, l, c, v, d):
    """VWAP que reinicia a cada dia. Sem volume na fonte (forex no Yahoo), vira a media do preco tipico do dia."""
    out = [None] * len(c)
    i, n = 0, len(c)
    while i < n:
        j = i
        while j < n and d[j] == d[i]:
            j += 1
        usa_vol = any(v[k] for k in range(i, j))
        sp = sv = 0.0
        for k in range(i, j):
            peso = v[k] if usa_vol else 1.0
            sp += (h[k] + l[k] + c[k]) / 3.0 * peso
            sv += peso
            out[k] = sp / sv if sv > 0 else c[k]
        i = j
    return out


def inicio_do_dia(d):
    out, ini = [0] * len(d), 0
    for i in range(len(d)):
        if i and d[i] != d[i - 1]:
            ini = i
        out[i] = ini
    return out


class Grafico:
    """Candles + indicadores. espelho=True devolve o grafico invertido (preco -> -preco) para as vendas."""

    def __init__(self, B, tick, tf, espelho=False):
        s = -1.0 if espelho else 1.0
        self.sinal = s
        self.tick, self.tf, self.intraday = tick, tf, tf < 1440
        if espelho:
            self.o = [-x for x in B["o"]]
            self.h = [-x for x in B["l"]]
            self.l = [-x for x in B["h"]]
            self.c = [-x for x in B["c"]]
        else:
            self.o, self.h, self.l, self.c = list(B["o"]), list(B["h"]), list(B["l"]), list(B["c"])
        self.d, self.hm = B["d"], B["hm"]
        self.v = list(B["v"])                                            # volume (igual nos dois lados)
        self.n = len(self.c)
        self.atr = atr(B["h"], B["l"], B["c"], 14)                       # igual nos dois lados
        neg = (lambda a: [None if x is None else -x for x in a]) if espelho else (lambda a: a)
        self.mm5 = neg(sma(B["c"], 5))
        self.mm9 = neg(sma(B["c"], 9))
        self.mm20 = neg(sma(B["c"], 20))
        self.mm200 = neg(sma(B["c"], 200))
        r2 = rsi(B["c"], 2)
        self.rsi2 = [None if x is None else 100.0 - x for x in r2] if espelho else r2
        r9 = rsi(B["c"], 9)
        self.rsi9 = [None if x is None else 100.0 - x for x in r9] if espelho else r9
        self.me20 = neg(ema(B["c"], 20))
        self.me200 = neg(ema(B["c"], 200))
        self.me500 = neg(ema(B["c"], 500))
        self.vw = neg(vwap_dia(B["h"], B["l"], B["c"], B["v"], B["d"])) if self.intraday else None
        self.ini_dia = inicio_do_dia(B["d"])
        self.gap_real = bool(B.get("gap_real"))    # a fonte tem gap de abertura de verdade (futuro/CFD, nao indice a vista)

    def atualizar_ultimo(self, B):
        """So o ULTIMO candle mudou (ele ainda esta aberto): refaz os valores dele sem recalcular a serie inteira.
        Nenhuma decisao de estrategia usa o candle aberto (sinal so sai no fechamento); estes valores servem para a tela e
        para o aviso de "atencao". Quando o candle fecha, a serie inteira e recalculada do jeito normal."""
        i, s = self.n - 1, self.sinal
        o, h, l, c = B["o"][i], B["h"][i], B["l"][i], B["c"][i]
        if s > 0:
            self.o[i], self.h[i], self.l[i], self.c[i] = o, h, l, c
        else:
            self.o[i], self.h[i], self.l[i], self.c[i] = -o, -l, -h, -c
        self.v[i] = B["v"][i]
        cs, hs, ls = B["c"], B["h"], B["l"]
        for nome, per in (("mm5", 5), ("mm9", 9), ("mm20", 20), ("mm200", 200)):
            getattr(self, nome)[i] = s * (sum(cs[i - per + 1:i + 1]) / per) if i >= per - 1 else None
        for nome, per in (("me20", 20), ("me200", 200), ("me500", 500)):
            arr = getattr(self, nome)
            ant = s * arr[i - 1]
            arr[i] = s * (ant + (c - ant) * (2.0 / (per + 1)))
        if i >= 14:
            self.atr[i] = sum(max(hs[k] - ls[k], abs(hs[k] - cs[k - 1]), abs(ls[k] - cs[k - 1])) for k in range(i - 13, i + 1)) / 14.0
        j = max(0, i - 400)                                    # o RSI de Wilder esquece o passado: 400 candles bastam
        for nome, per in (("rsi2", 2), ("rsi9", 9)):
            v = rsi(cs[j:i + 1], per)[-1]
            getattr(self, nome)[i] = None if v is None else (v if s > 0 else 100.0 - v)
        if self.vw is not None:
            j = self.ini_dia[i]
            vd = vwap_dia(hs[j:i + 1], ls[j:i + 1], cs[j:i + 1], B["v"][j:i + 1], B["d"][j:i + 1])
            for k, x in enumerate(vd):
                self.vw[j + k] = None if x is None else s * x

    def acima(self, x):      # arredonda para cima no tick (gatilho de compra)
        t = self.tick
        return math.ceil(x / t - 1e-7) * t

    def abaixo(self, x):     # arredonda para baixo no tick (stop de compra)
        t = self.tick
        return math.floor(x / t + 1e-7) * t


# ------------------------------------------------------------------------------------------ contexto
ER_PERIODO, ER_MIN, DIAS_TENDENCIA = 30, 0.35, 20


def tendencia_diaria(B):
    """+1 / -1 / 0 para cada candle: o fechamento de ONTEM esta acima / abaixo da media dos fechamentos dos 20 dias
    anteriores (0 = menos de 10 dias de historico ou empate). So usa dias ja encerrados: nao olha o futuro."""
    d, c = B["d"], B["c"]
    fech = {}
    for i in range(len(c)):
        fech[d[i]] = c[i]
    dias = sorted(fech)
    td = {}
    for q, x in enumerate(dias):
        ant = [fech[y] for y in dias[max(0, q - DIAS_TENDENCIA):q]]
        if len(ant) < 10:
            td[x] = 0
        else:
            media = sum(ant) / len(ant)
            td[x] = 1 if ant[-1] > media else (-1 if ant[-1] < media else 0)
    return [td[x] for x in d]


def eficiencia_em(c, i, p=ER_PERIODO):
    """A eficiencia de Kaufman so no candle i (para atualizar o candle aberto)."""
    if i < p:
        return 0.0
    soma = sum(abs(c[k] - c[k - 1]) for k in range(i - p + 1, i + 1))
    return abs(c[i] - c[i - p]) / soma if soma > 0 else 0.0


def eficiencia(c, p=ER_PERIODO):
    """Eficiencia de Kaufman: |variacao em p candles| / soma das variacoes candle a candle (1 = linha reta, 0 = serrote)."""
    n = len(c)
    out = [0.0] * n
    soma = 0.0
    for i in range(1, n):
        soma += abs(c[i] - c[i - 1])
        if i > p:
            soma -= abs(c[i - p] - c[i - p - 1])
        if i >= p:
            out[i] = abs(c[i] - c[i - p]) / soma if soma > 0 else 0.0
    return out


# Modo seletivo (opcional): menos operacoes, so no contexto que se saiu melhor nos testes com 41 mil operacoes em 12 ativos
SELETIVO_TENDENCIA = ("E1", "E2", "E3", "E4", "E5", "E9", "E12", "E13")   # correcao/rompimento: a favor do diario E tendencia limpa
SELETIVO_DIRECAO = ("E7", "E11")                              # momentum do dia: so a favor do diario


def passa_seletivo(G, cod, i, direcao):
    """G = grafico normal (compra). direcao = +1 compra, -1 venda."""
    td = G.tend_d[i] * direcao
    if cod in SELETIVO_TENDENCIA:
        return td >= 0 and G.er[i] >= ER_MIN
    if cod in SELETIVO_DIRECAO:
        return td >= 0
    return True


def _topo(G, i, janela):
    """Indice do maior topo nos `janela` candles ANTES do candle i (o mais recente, se empatar)."""
    ini = max(0, i - janela)
    j = ini
    for k in range(ini, i):
        if G.h[k] >= G.h[j]:
            j = k
    return j


def _risco_ok(G, i, ent, stop, rmin=0.3, rmax=2.5):
    r = ent - stop
    return r > 0 and rmin * G.atr[i] <= r <= rmax * G.atr[i]


def _br(v, casas=1, sinal=False):
    """Numero com virgula decimal para os textos mostrados na tela."""
    return (("%+.*f" if sinal else "%.*f") % (casas, v)).replace(".", ",").replace("-", "−")


def _lado(G, compra, venda):
    """Texto conforme o lado real da operacao: nas vendas o grafico esta invertido, entao "acima" vira "abaixo"."""
    return compra if G.sinal > 0 else venda


def _ordem_stop(G, i, stop_preco, validade=2, info=""):
    """Compra stop 1 tick acima da maxima do candle de sinal; stop 1 tick abaixo do fundo da correcao."""
    ent = G.acima(G.h[i] + G.tick)
    stop = G.abaixo(stop_preco - G.tick)
    if not _risco_ok(G, i, ent, stop):
        return None
    return dict(tipo="stop", gatilho=ent, stop=stop, validade=validade, info=info)


# ------------------------------------------------------------------------------------------ E1
def e1_halt_mm20(G, i):
    a = G.atr[i]
    if G.mm20[i] - G.mm20[i - 5] < 0.2 * a or G.c[i] <= G.mm200[i]:
        return None                                            # MM20 inclinada a favor, acima da MM200
    j = _topo(G, i, 12)
    npb = i - 1 - j                                            # candles de correcao antes do sinal
    if not 1 <= npb <= 8 or G.h[j] < G.mm20[j] + 0.5 * a:
        return None
    pb = range(j + 1, i + 1)
    if not any(G.l[k] <= G.mm20[k] + 0.15 * a for k in pb):
        return None                                            # a correcao precisa encostar na MM20 (halt)
    if any(G.c[k] < G.mm20[k] - 0.05 * a for k in pb):
        return None                                            # fechou alem da MM20: halt invalido (Pisani)
    if any(G.c[k] < G.o[k] and G.h[k] - G.l[k] >= 2.0 * G.atr[k] for k in range(j + 1, i)):
        return None                                            # regressao aguda (barra elefante contra)
    if not (G.c[i] > G.o[i] and G.c[i] >= (G.h[i] + G.l[i]) / 2 and G.c[i] > G.mm20[i]):
        return None                                            # candle de confirmacao
    if npb == 1 and G.c[i] <= G.h[i - 1]:
        return None                                            # pullback de 1 candle: so o Gift (apaga 100%)
    return _ordem_stop(G, i, min(G.l[k] for k in pb), info="%d candles de correção" % npb)


def e1_atencao(G, i):
    a = G.atr[i]
    if G.mm20[i] - G.mm20[i - 5] < 0.2 * a or G.c[i] <= G.mm200[i]:
        return False
    j = _topo(G, i + 1, 8)
    return j < i and G.l[i] <= G.mm20[i] + 0.6 * a and G.c[i] >= G.mm20[i] - 0.05 * a


# ------------------------------------------------------------------------------------------ E2
def e2_fibonacci(G, i):
    a = G.atr[i]
    if G.mm20[i] <= G.mm20[i - 5] or G.c[i] <= G.mm200[i]:
        return None
    j = _topo(G, i, 15)                                        # topo do impulso
    npb = i - 1 - j
    if not 1 <= npb <= 12:
        return None
    m = j - 1
    for k in range(max(0, j - 30), j):                         # fundo do impulso (antes do topo)
        if G.l[k] <= G.l[m]:
            m = k
    perna = G.h[j] - G.l[m]
    if perna < 2.0 * a or j - m < 2:
        return None
    fundo_pb = min(G.l[k] for k in range(j + 1, i + 1))
    ret = (G.h[j] - fundo_pb) / perna
    if not 0.35 <= ret <= 0.66:
        return None                                            # correcao dentro da zona 38,2% - 61,8%
    n618 = G.h[j] - 0.618 * perna
    if not (G.c[i] > G.o[i] and G.c[i] >= (G.h[i] + G.l[i]) / 2 and G.c[i] > G.c[i - 1] and G.c[i] > n618):
        return None                                            # candle de confirmacao dentro/acima da zona
    od = _ordem_stop(G, i, fundo_pb, info="retração de %s%%" % _br(100 * ret))
    if od:
        od["ret"] = round(ret, 4)                              # profundidade da correcao (a IA usa)
    return od


def e2_atencao(G, i):
    a = G.atr[i]
    if G.mm20[i] <= G.mm20[i - 5] or G.c[i] <= G.mm200[i]:
        return False
    j = _topo(G, i + 1, 15)
    if j >= i:
        return False
    m = j - 1
    for k in range(max(0, j - 30), j):
        if G.l[k] <= G.l[m]:
            m = k
    perna = G.h[j] - G.l[m]
    if perna < 2.0 * a:
        return False
    ret = (G.h[j] - min(G.l[k] for k in range(j + 1, i + 1))) / perna
    return 0.236 <= ret <= 0.66


# ------------------------------------------------------------------------------------------ E3
def e3_vwap(G, i):
    if not G.intraday:
        return None
    a, s = G.atr[i], G.ini_dia[i]
    nb = i - s + 1
    if nb < max(4, 30 // G.tf) or i - 3 < s:
        return None
    vw = G.vw
    if G.c[i] <= vw[i] or vw[i] <= vw[i - 3]:
        return None                                            # VWAP subindo e preco acima dela
    if sum(1 for k in range(s, i + 1) if G.c[k] > vw[k]) < 0.7 * nb:
        return None                                            # dia de tendencia: 70% dos fechamentos acima
    if max(G.h[s:i + 1]) < vw[i] + 1.0 * a:
        return None                                            # houve movimento para longe da VWAP
    ult = range(i - 2, i + 1)
    if not any(G.l[k] <= vw[k] + 0.15 * a for k in ult):
        return None                                            # voltou para testar a VWAP
    if any(G.c[k] < vw[k] - 0.05 * a for k in ult):
        return None                                            # e segurou (nenhum fechamento abaixo)
    if not (G.c[i] > G.o[i] and G.c[i] >= (G.h[i] + G.l[i]) / 2):
        return None
    return _ordem_stop(G, i, min(G.l[k] for k in ult), info="teste da VWAP")


def e3_atencao(G, i):
    if not G.intraday:
        return False
    a, s = G.atr[i], G.ini_dia[i]
    nb = i - s + 1
    if nb < max(4, 30 // G.tf) or i - 3 < s:
        return False
    vw = G.vw
    return (G.c[i] > vw[i] and vw[i] > vw[i - 3] and sum(1 for k in range(s, i + 1) if G.c[k] > vw[k]) >= 0.7 * nb
            and max(G.h[s:i + 1]) >= vw[i] + 1.0 * a and G.l[i] <= vw[i] + 0.6 * a)


# ------------------------------------------------------------------------------------------ E4
BASE = 4


def _base(G, i, nbarras):
    """Base estreita (candles i-nbarras+1 .. i) no topo do movimento e apoiada na MM20 inclinada."""
    a = G.atr[i]
    if G.mm20[i] - G.mm20[i - 5] < 0.2 * a or G.c[i] <= G.mm200[i]:
        return None
    ks = range(i - nbarras + 1, i + 1)
    bh, bl = max(G.h[k] for k in ks), min(G.l[k] for k in ks)
    if bh - bl > 1.2 * a:
        return None                                            # base estreita
    if bh < max(G.h[i - 20:i + 1]) - 0.3 * a:
        return None                                            # no topo do movimento
    if bl < G.mm20[i] - 0.2 * a:
        return None                                            # apoiada na MM20
    return bh, bl


def e4_rompimento(G, i):
    b = _base(G, i, BASE)
    if not b:
        return None
    bh, bl = b
    ent = G.acima(bh + G.tick)
    if G.c[i] >= ent:
        return None
    stop = G.abaixo(bl - G.tick)
    if not _risco_ok(G, i, ent, stop):
        return None
    return dict(tipo="stop", gatilho=ent, stop=stop, validade=2, info="base de %d candles" % BASE)


def e4_atencao(G, i):
    return _base(G, i, BASE - 1) is not None


# ------------------------------------------------------------------------------------------ E5
def e5_mm9_gift(G, i):
    a = G.atr[i]
    if not (G.mm9[i] > G.mm20[i] > G.mm200[i]):
        return None                                            # combinacao perfeita das medias
    if G.mm9[i] <= G.mm9[i - 3] or G.mm20[i] - G.mm20[i - 5] < 0.3 * a:
        return None
    j = _topo(G, i, 6)
    npb = i - 1 - j
    if not 1 <= npb <= 3:
        return None                                            # correcao rasa (1 a 3 candles)
    pb = range(j + 1, i + 1)
    if not any(G.l[k] <= G.mm9[k] + 0.1 * a for k in pb):
        return None                                            # encostou na MM9
    if any(G.c[k] < G.mm20[k] for k in pb):
        return None                                            # sem fechar abaixo da MM20
    if not (G.c[i] > G.o[i] and G.c[i] > G.h[i - 1]):
        return None                                            # Gift: apaga 100% do candle anterior
    return _ordem_stop(G, i, min(G.l[k] for k in pb), info="correção de %d candle(s)" % npb)


def e5_atencao(G, i):
    a = G.atr[i]
    return (G.mm9[i] > G.mm20[i] > G.mm200[i] and G.mm20[i] - G.mm20[i - 5] >= 0.3 * a
            and G.c[i] < G.c[i - 1] and G.l[i] <= G.mm9[i] + 0.4 * a and G.c[i] >= G.mm20[i])


# ------------------------------------------------------------------------------------------ E6
RSI_ENTRADA, RSI_STOP_ATR, RSI_MAX_CANDLES = 10.0, 3.0, 10


def e6_rsi2(G, i):
    if G.c[i] <= G.mm200[i] or G.rsi2[i] is None or G.rsi2[i] >= RSI_ENTRADA:
        return None
    return dict(tipo="abertura", gatilho=None, stop=G.abaixo(G.c[i] - RSI_STOP_ATR * G.atr[i]), validade=1,
                info="RSI(2) = %s" % _br(_lado(G, G.rsi2[i], 100.0 - G.rsi2[i])))


def e6_saida(G, i, pos):
    if G.c[i] > G.mm5[i]:
        return "fechou do outro lado da MM5"
    if i - pos["i_ent"] + 1 >= RSI_MAX_CANDLES:
        return "limite de %d candles" % RSI_MAX_CANDLES
    return None


def e6_atencao(G, i):
    return G.c[i] > G.mm200[i] and G.rsi2[i] is not None and G.rsi2[i] < 25


# ------------------------------------------------------------------------------------------ E7
def e7_orb(G, i):
    """Zarattini & Aziz: o 1o candle do pregao da a direcao; entra na abertura do 2o, stop no extremo do 1o."""
    if not G.intraday or G.ini_dia[i] != i or i == 0:
        return None
    if not G.c[i] > G.o[i]:
        return None                                            # candle de abertura de alta (doji nao opera)
    stop = G.abaixo(G.l[i] - G.tick)
    if G.c[i] - stop < 0.1 * G.atr[i] or G.c[i] - stop > 4.0 * G.atr[i]:
        return None
    return dict(tipo="abertura", gatilho=None, stop=stop, validade=1, info="1º candle do pregão de " + _lado(G, "alta", "baixa"))


def e7_atencao(G, i):
    return False


# ------------------------------------------------------------------------------------------ E8
GAP_MIN, GAP_MAX, GAP_MINUTOS = 0.0005, 0.0040, 15


def _dia_anterior(G, s):
    """Fechamento, maxima e minima do dia anterior ao candle s (1o candle do dia)."""
    if s == 0:
        return None
    s0 = G.ini_dia[s - 1]
    return G.c[s - 1], max(G.h[s0:s]), min(G.l[s0:s])


def e8_gap(G, i):
    """Gap de baixa pequeno, aberto dentro da faixa de ontem, e os primeiros 15 min ja reagindo -> compra
    buscando o fechamento de ontem (o gap fecha)."""
    if not G.intraday or not G.gap_real:
        return None
    s = G.ini_dia[i]
    n = max(1, GAP_MINUTOS // G.tf)
    if i != s + n - 1:
        return None                                            # decide no fim dos primeiros 15 minutos
    ant = _dia_anterior(G, s)
    if not ant:
        return None
    pc, ph, pl = ant
    gap = (G.o[s] - pc) / abs(pc)
    if not (-GAP_MAX <= gap <= -GAP_MIN) or G.o[s] < pl:
        return None                                            # gap de baixa pequeno e dentro da faixa de ontem
    if max(G.h[s:i + 1]) >= pc:
        return None                                            # o gap ja fechou nos 15 min iniciais
    # stop largo (a estatistica e de "fecha ate o fim do dia"): alem da minima dos 15 min e a 2 gaps da abertura
    stop = G.abaixo(min(min(G.l[s:i + 1]), G.o[s] - 2 * (pc - G.o[s])) - G.tick)
    risco, premio = G.c[i] - stop, pc - G.c[i]
    if risco <= 0 or risco > 6.0 * G.atr[i] or premio < 0.2 * risco:
        return None
    return dict(tipo="abertura", gatilho=None, stop=stop, validade=1, alvos=(None, pc),
                info="gap de %s%%" % _br(100 * gap * G.sinal, 2, True))


def e8_atencao(G, i):
    if not G.intraday or not G.gap_real:
        return False
    s = G.ini_dia[i]
    if i >= s + max(1, GAP_MINUTOS // G.tf) - 1:
        return False
    ant = _dia_anterior(G, s)
    if not ant:
        return False
    pc, ph, pl = ant
    gap = (G.o[s] - pc) / abs(pc)
    return -GAP_MAX <= gap <= -GAP_MIN and G.o[s] >= pl


# ------------------------------------------------------------------------------------------ E9
def _ogro(G, i):
    """Pernada A->B, correcao ate C (23,6% a 50% de AB) com medias simples alinhadas. Devolve (B, C, AB) ou None."""
    a = G.atr[i]
    if not (G.mm9[i] > G.mm20[i] > G.mm200[i]) or G.mm20[i] <= G.mm20[i - 5]:
        return None                                            # medias simples alinhadas e MM20 subindo
    j = _topo(G, i, 30)                                        # B = pivo de topo da pernada
    if j > i - 2 or G.h[i] >= G.h[j]:
        return None
    m = j + 1                                                  # C = fundo da correcao
    for k in range(j + 1, i + 1):
        if G.l[k] <= G.l[m]:
            m = k
    if m >= i or G.l[i] <= G.l[m]:
        return None                                            # o fundo C precisa estar formado (pivo de fundo)
    a0 = j - 1                                                 # A = inicio da pernada
    for k in range(max(0, j - 40), j):
        if G.l[k] <= G.l[a0]:
            a0 = k
    ab = G.h[j] - G.l[a0]
    if ab < 2.0 * a or j - a0 < 3:
        return None
    ret = (G.h[j] - G.l[m]) / ab
    if not 0.236 <= ret <= 0.50:
        return None                                            # retracao de no maximo 50% da pernada
    return j, m, ab, ret


def e9_ogro(G, i):
    r = _ogro(G, i)
    if not r:
        return None
    j, m, ab, ret = r
    ent = G.acima(G.h[j] + G.tick)                             # compra no rompimento do pivo (topo B)
    stop = G.abaixo(G.l[m] - G.tick)                           # stop abaixo do fundo C
    if not _risco_ok(G, i, ent, stop):
        return None
    return dict(tipo="stop", gatilho=ent, stop=stop, validade=1,
                alvos=(G.l[m] + ab, G.l[m] + 1.618 * ab),      # projecao de Fibonacci 100% e 161,8% a partir de C
                ret=round(ret, 4), info="retração de %.0f%% da pernada" % (100 * ret))


def e9_atencao(G, i):
    return _ogro(G, i) is not None and e9_ogro(G, i) is None


# ------------------------------------------------------------------------------------------ E10
KELT_DENTRO, KELT_FORA, KELT_STOP_ATR, KELT_IFR = 2.0, 2.5, 0.25, 35.0


def _lateral(G, i):
    """Dia lateral (Adriano Mendes): MME200 e MME500 cortando os precos do dia, VWAP plana e preco dentro do
    range do dia anterior. Em dia de medias alinhadas o Keltner nao vale."""
    if not G.intraday:
        return False
    s = G.ini_dia[i]
    if i - s < 6:
        return False
    a = G.atr[i]
    hi, lo = max(G.h[s:i + 1]), min(G.l[s:i + 1])
    m1, m2 = min(G.me200[i], G.me500[i]), max(G.me200[i], G.me500[i])
    if not (lo <= m2 and hi >= m1):
        return False                                           # 200 e 500 dentro da faixa do dia
    if abs(G.vw[i] - G.vw[i - 6]) > 0.3 * a:
        return False                                           # VWAP plana (ultimos 6 candles)
    ant = _dia_anterior(G, s)
    if not ant:
        return False
    pc, ph, pl = ant
    return pl <= G.c[i] <= ph                                  # dentro do range de ontem


def e10_keltner(G, i):
    if not _lateral(G, i):
        return None
    a, m = G.atr[i], G.me20[i]
    b_dentro, b_fora = m - KELT_DENTRO * a, m - KELT_FORA * a
    if not (G.l[i] <= b_dentro and G.c[i] > b_dentro):
        return None                                            # tocou a zona das bandas e fechou para dentro
    ifr = min(G.rsi9[i], G.rsi9[i - 1])
    if ifr > KELT_IFR:
        return None                                            # IFR(9) esticado
    stop = G.abaixo(min(G.l[i], b_fora) - KELT_STOP_ATR * a - G.tick)
    risco, premio = G.c[i] - stop, m - G.c[i]
    if risco <= 0 or risco > 2.5 * a or premio < 0.6 * risco:
        return None
    return dict(tipo="abertura", gatilho=None, stop=stop, validade=1, alvos=(None, m),
                info="banda de Keltner, IFR(9) %.0f" % _lado(G, ifr, 100.0 - ifr))


def e10_atencao(G, i):
    return _lateral(G, i) and G.l[i] <= G.me20[i] - (KELT_DENTRO - 0.5) * G.atr[i] and e10_keltner(G, i) is None


# ------------------------------------------------------------------------------------------ E11
RUIDO_DIAS, RUIDO_MIN_DIAS, RUIDO_PASSO, RUIDO_STOP_ATR = 14, 10, 30, 1.0


def faixa_de_ruido(B):
    """Para cada candle: a media, nos 14 pregoes anteriores, de |fechamento naquele mesmo horario / abertura do dia - 1|.
    E o tamanho do movimento "normal" desde a abertura ate aquela hora (None enquanto nao ha 10 pregoes com aquele horario)."""
    o, c, d, hm = B["o"], B["c"], B["d"], B["hm"]
    n = len(c)
    out = [None] * n
    hist = {}
    i = 0
    while i < n:
        j = i
        while j < n and d[j] == d[i]:
            j += 1
        for q in range(i, j):
            h = hist.get(hm[q])
            if h and len(h) >= RUIDO_MIN_DIAS:
                ult = h[-RUIDO_DIAS:]
                out[q] = sum(ult) / len(ult)
        ab = o[i]
        if ab:
            for q in range(i, j):
                hist.setdefault(hm[q], []).append(abs(c[q] / ab - 1.0))
        i = j
    return out


def _ruido_nivel(G, i, so_na_hora=True):
    """Nivel que o fechamento precisa superar para a compra: o maior entre a faixa de cima e a VWAP.
    Faixa de cima = max(abertura de hoje, fechamento de ontem) + o movimento normal ate aquele horario."""
    if not G.intraday or G.ruido[i] is None:
        return None
    s = G.ini_dia[i]
    if s == 0:
        return None
    if so_na_hora and G.tf < RUIDO_PASSO:
        if ((G.hm[i] // 100) * 60 + G.hm[i] % 100 + G.tf) % RUIDO_PASSO:
            return None                                        # so decide nas horas cheias e nas meias horas (como no estudo)
    ref = max(G.o[s], G.c[s - 1])
    return max(ref + abs(ref) * G.ruido[i], G.vw[i])


def e11_momentum(G, i):
    nivel = _ruido_nivel(G, i)
    if nivel is None or G.c[i] <= nivel:
        return None
    stop = G.abaixo(nivel - RUIDO_STOP_ATR * G.atr[i])
    if G.c[i] - stop <= 0:
        return None
    return dict(tipo="abertura", gatilho=None, stop=stop, validade=1, info="fechou %s da faixa de ruído e da VWAP" % _lado(G, "acima", "abaixo"))


def e11_saida(G, i, pos):
    nivel = _ruido_nivel(G, i)
    if nivel is not None and G.c[i] < nivel:
        return "fechou %s da faixa/VWAP" % _lado(G, "abaixo", "acima")
    return None


def e11_atencao(G, i):
    nivel = _ruido_nivel(G, i, so_na_hora=False)
    return nivel is not None and G.c[i] > nivel - 0.25 * G.atr[i] and e11_momentum(G, i) is None


# ------------------------------------------------------------------------------------------ E12 / E13 (Fibonacci)
F12_ZONA = (0.382, 0.50)            # a correcao precisa buscar 38,2% e nao passar de 50% da pernada
F12_ALVOS = (0.618, 1.0, 1.618)     # projecoes de Fibonacci da pernada, medidas a partir do fundo da correcao (C)
F13_NIVEL = 0.50                    # ordem limitada na retracao de 50% da pernada
F13_ALVOS = (0.0, 0.272, 0.618)     # alvos ancorados na pernada: o topo B, 127,2% e 161,8%
F13_ESPERA = 20                     # candles depois do topo: correcao lenta demais deixa de valer


def _pernada(G, i):
    """Pernada de alta A->B antes do candle i. B = maior topo dos 30 candles anteriores, ja confirmado como pivo (pelo
    menos 2 candles depois dele, nenhum com topo maior); A = menor fundo dos 40 candles antes de B.
    Devolve (indice de A, indice de B, tamanho AB) ou None."""
    j = _topo(G, i, 30)
    if j > i - 2 or G.h[i] >= G.h[j] or j < 4:
        return None
    a0 = j - 1
    for k in range(max(0, j - 40), j):
        if G.l[k] <= G.l[a0]:
            a0 = k
    if j - a0 < 3:
        return None
    return a0, j, G.h[j] - G.l[a0]


def _fundo_c(G, j, i):
    m = j + 1
    for k in range(j + 1, i + 1):
        if G.l[k] <= G.l[m]:
            m = k
    return m


def e12_abc(G, i):
    """Projecao de Fibonacci A-B-C com 3 alvos (a ferramenta "Trend-Based Fib Extension" do TradingView virada regra)."""
    a = G.atr[i]
    if not (G.mm9[i] > G.mm20[i] > G.mm200[i]) or G.mm20[i] <= G.mm20[i - 5]:
        return None                                            # medias simples alinhadas e MM20 subindo
    p = _pernada(G, i)
    if not p:
        return None
    a0, j, ab = p
    if ab < 2.0 * a:
        return None
    m = _fundo_c(G, j, i)                                      # C = fundo da correcao
    ret = (G.h[j] - G.l[m]) / ab
    if not F12_ZONA[0] <= ret <= F12_ZONA[1]:
        return None                                            # buscou 38,2% e nao passou de 50%
    if i - m > 2:
        return None                                            # a reversao tem de vir colada no fundo C
    if not (G.c[i] > G.o[i] and G.c[i] >= (G.h[i] + G.l[i]) / 2 and G.c[i] > G.c[i - 1]):
        return None                                            # candle de reversao
    ent = G.acima(G.h[i] + G.tick)
    if ent >= G.h[j]:
        return None                                            # acima do topo B ja seria o rompimento do pivo (E9)
    stop = G.abaixo(G.l[a0] - G.tick)                          # stop abaixo do inicio da pernada (A)
    if not _risco_ok(G, i, ent, stop, 0.5, 4.0):
        return None
    alvos = tuple(G.abaixo(G.l[m] + r * ab) for r in F12_ALVOS)
    if alvos[0] <= ent + G.tick:
        return None
    return dict(tipo="stop", gatilho=ent, stop=stop, validade=2, alvos=alvos, ret=round(ret, 4),
                info="A-B-C: correção de %s%% da pernada" % _br(100 * ret))


def e12_atencao(G, i):
    if not (G.mm9[i] > G.mm20[i] > G.mm200[i]):
        return False
    p = _pernada(G, i)
    if not p or p[2] < 2.0 * G.atr[i]:
        return False
    ret = (G.h[p[1]] - G.l[_fundo_c(G, p[1], i)]) / p[2]
    return 0.25 <= ret <= F12_ZONA[1] and e12_abc(G, i) is None


def e13_limite(G, i):
    """Ordem limitada na retracao de 50% da pernada (familia Golden Pocket / OTE, com o nivel nos 50%)."""
    a = G.atr[i]
    if not (G.mm20[i] > G.mm200[i] and G.c[i] > G.mm200[i]):
        return None                                            # estrutura de alta: MM20 e preco acima da MM200
    p = _pernada(G, i)
    if not p:
        return None
    a0, j, ab = p
    if ab < 2.5 * a or i - j > F13_ESPERA:
        return None                                            # pernada forte e correcao que nao demora
    if not (G.mm9[j] > G.mm20[j] > G.mm200[j]):
        return None                                            # no topo da pernada as medias estavam alinhadas
    lim = G.abaixo(G.h[j] - F13_NIVEL * ab)
    if min(G.l[k] for k in range(j + 1, i + 1)) <= lim:
        return None                                            # o preco ja buscou o nivel: a ordem ja teria executado
    stop = G.abaixo(G.l[a0] - G.tick)                          # stop abaixo do inicio da pernada (A)
    if not _risco_ok(G, i, lim, stop, 0.5, 4.0):
        return None
    alvos = tuple(G.abaixo(G.h[j] + r * ab) for r in F13_ALVOS)
    return dict(tipo="limite", gatilho=lim, stop=stop, validade=1, alvos=alvos, ret=F13_NIVEL,
                info="limite nos %s%% da pernada" % _br(100 * F13_NIVEL, 0))


def e13_atencao(G, i):
    return False                                               # a propria ordem limitada ja aparece armada na tela


# ------------------------------------------------------------------------------------------ catalogo
ESTRATEGIAS = {
    "E1": dict(nome="Halt na MM20", autor="Mario Pisani + Oliver Velez", fn=e1_halt_mm20, aten=e1_atencao,
               gestao="alvo2", saida=None, intraday=False,
               aguardando="correção encostando na MM20 inclinada",
               ideal="5 e 15 min, qualquer ativo em tendência (melhor no WIN e no ouro)",
               regras=["MM20 inclinada a favor (retrato da força - Velez) e preço do lado certo da MM200",
                       "Correção de 1 a 8 candles (3-5-8) que encosta na MM20 sem fechar além dela (halt - Pisani)",
                       "Sem barra elefante contra na correção (regressão aguda = não operar)",
                       "Candle de confirmação a favor; correção de 1 candle só vale se ele apagar 100% (Gift)",
                       "Entrada 1 tick além da máxima/mínima do candle de sinal; stop 1 tick além do fundo/topo da correção"]),
    "E2": dict(nome="Gatilho de Fibonacci", autor="Mario Pisani", fn=e2_fibonacci, aten=e2_atencao,
               gestao="alvo2", saida=None, intraday=False,
               aguardando="correção entrando na zona 38,2%-61,8% do impulso",
               ideal="5 e 15 min no WIN; no diário em ouro e prata",
               regras=["Impulso de pelo menos 2 ATR a favor da MM20 (subindo para compra, caindo para venda)",
                       "Correção que chega entre 38,2% e 61,8% do impulso (sem passar de ~66%)",
                       "Candle de confirmação que fecha a favor, acima do anterior e de volta acima de 61,8%",
                       "Entrada 1 tick além do candle de sinal; stop 1 tick além do fundo/topo da correção"]),
    "E3": dict(nome="Pullback na VWAP", autor="Mario Pisani + Oliver Velez", fn=e3_vwap, aten=e3_atencao,
               gestao="alvo2", saida=None, intraday=True,
               aguardando="dia de tendência voltando para testar a VWAP",
               ideal="15 min, índices e forex no dia de tendência",
               regras=["Só em gráfico intraday, depois dos primeiros 30 minutos",
                       "Dia de tendência: 70% dos fechamentos do dia do mesmo lado da VWAP e VWAP inclinada",
                       "Preço já se afastou 1 ATR da VWAP e voltou para testá-la sem fechar do outro lado",
                       "Candle de confirmação a favor; entrada 1 tick além dele; stop além do teste"]),
    "E4": dict(nome="Rompimento de base", autor="Oliver Velez (power breakout)", fn=e4_rompimento, aten=e4_atencao,
               gestao="alvo2", saida=None, intraday=False,
               aguardando="base estreita se formando no extremo do movimento",
               ideal="5 min e diário, ativos em tendência forte",
               regras=["MM20 inclinada a favor e preço do lado certo da MM200",
                       "Base de 4 candles com amplitude até 1,2 ATR, no extremo do movimento e apoiada na MM20",
                       "Ordem stop 1 tick além da base (vale 2 candles); stop 1 tick além do outro lado da base"]),
    "E5": dict(nome="Combinação perfeita + Gift na MM9", autor="Oliver Velez + Mario Pisani", fn=e5_mm9_gift, aten=e5_atencao,
               gestao="alvo2", saida=None, intraday=False,
               aguardando="tendência forte fazendo correção rasa até a MM9",
               ideal="5 e 60 min, tendências fortes (ouro, prata)",
               regras=["MM9 > MM20 > MM200 (combinação perfeita) com MM9 e MM20 inclinadas",
                       "Correção rasa de 1 a 3 candles que encosta na MM9 sem fechar além da MM20",
                       "Candle Gift: fecha além da máxima/mínima do candle anterior (apaga 100%)",
                       "Entrada 1 tick além do Gift; stop 1 tick além do fundo/topo da correção"]),
    "E6": dict(nome="RSI(2) de Connors", autor="Larry Connors - a mais testada nos fóruns", fn=e6_rsi2, aten=e6_atencao,
               gestao="propria", saida=e6_saida, intraday=False,
               aguardando="recuo curto contra a tendência (RSI(2) esticado), do lado certo da MM200",
               ideal="Diário (é uma estratégia de swing curto); índices",
               regras=["Compra só acima da MM200 (venda só abaixo) - opera a favor da tendência longa",
                       "Sinal quando o RSI de 2 períodos fecha abaixo de 10 (venda: acima de 90)",
                       "Entra a mercado na abertura do candle seguinte",
                       "Saída quando fecha do outro lado da MM5, ou após 10 candles",
                       "Stop de proteção a 3 ATR (Connors não usava stop; aqui ele existe para você não quebrar)",
                       "Acerta muito e ganha pouco por operação: o resultado vem do conjunto, não de um trade"]),
    "E7": dict(nome="Rompimento do 1º candle (ORB)", autor="Zarattini & Aziz (2023) - estudo acadêmico", fn=e7_orb, aten=e7_atencao,
               gestao="alvo10", saida=None, intraday=True, abertura=True,
               aguardando="abertura do pregão",
               ideal="5 min, índices na abertura (WIN às 10h, USTEC às 9h30 de NY). Acerto baixo, ganhos grandes",
               regras=["Só intraday: olha apenas o 1º candle do pregão",
                       "1º candle de alta: compra na abertura do 2º; de baixa: vende; doji: não opera",
                       "Stop 1 tick além da mínima/máxima do 1º candle",
                       "Alvo 10R ou zeragem no fim do dia (como no estudo: poucos acertos, ganhos grandes)",
                       "Fonte: Zarattini & Aziz, 'Can Day Trading Really Be Profitable?' (SSRN, 2023)"]),
    "E8": dict(nome="Fechamento de gap", autor="Estatística de gaps (índices futuros)", fn=e8_gap, aten=e8_atencao,
               gestao="fixo", saida=None, intraday=True, abertura=True,
               aguardando="gap pequeno na abertura, esperando os 15 primeiros minutos",
               ideal="5 min, índices (WIN, USTEC, JP225). A de maior taxa de acerto: alvo curto no fechamento de ontem",
               regras=["Só intraday e só em dado com gap real (USTEC/JP225 da Dukascopy ou CSV do WIN/WDO do Profit; o Ibovespa à vista não tem gap)",
                       "Abre com gap entre 0,05% e 0,40%, dentro da faixa do dia anterior",
                       "Espera os 15 primeiros minutos: se o gap ainda não fechou, entra na direção de fechá-lo",
                       "Entra a mercado no candle seguinte; stop largo: além da mínima/máxima dos 15 min e a 2 gaps da abertura",
                       "Alvo: o fechamento do dia anterior (o gap fechado); só entra se o alvo valer 0,2R ou mais. Ganha pouco e acerta muito",
                       "Estudos no Nasdaq (2015-2025): gap pequeno aberto dentro da faixa de ontem fecha 78% das vezes"]),
    "E9": dict(nome="OGRO: pivô + Fibonacci", autor="Estilo André Machado (Ogro de Wall Street)", fn=e9_ogro, aten=e9_atencao,
               gestao="fibo", saida=None, intraday=False,
               aguardando="pivô formado (correção até 50%), esperando o rompimento do pivô",
               ideal="5 e 15 min, índices e ouro em tendência, com MM9 > MM20 > MM200",
               regras=["Médias simples alinhadas: MM9 > MM20 > MM200 e MM20 subindo (venda: o inverso)",
                       "Pernada A→B de pelo menos 2 ATR; correção até C que retrai de 23,6% a no máximo 50%",
                       "Compra 1 tick acima do topo B (rompimento do pivô); stop 1 tick abaixo do fundo C",
                       "Alvos na projeção de Fibonacci da pernada a partir de C: 100% (metade + stop no 0x0) e 161,8% (resto)"]),
    "E10": dict(nome="XTRADERS: Keltner lateral", autor="Adriano Mendes (XTraders)", fn=e10_keltner, aten=e10_atencao,
                gestao="fixo", saida=None, intraday=True,
                aguardando="dia lateral com o preço chegando na banda de Keltner",
                ideal="2 e 5 min, índices em dia lateral (médias emboladas, VWAP plana). Alvo curto, acerto alto",
                regras=["Só em dia lateral: MME200 e MME500 cortando os preços do dia, VWAP plana e preço dentro do range de ontem",
                        "Canais de Keltner na MME20: bandas de 2,0 e 2,5 ATR (a zona de pressão fica entre as duas)",
                        "Compra quando o candle toca a banda de baixo e fecha de volta para dentro, com IFR(9) abaixo de 35 (venda: o inverso)",
                        "Entra a mercado; stop atrás da banda de 2,5; alvo na média de 20 (a 'zona de segurança' dele)",
                        "Só entra se o alvo valer pelo menos 0,6R. Em dia de médias alinhadas não opera (lá valem E1-E9)"]),
    "E11": dict(nome="Momentum do dia (faixa de ruído)", autor="Zarattini, Aziz & Barbon (2024) - estudo acadêmico", fn=e11_momentum,
                aten=e11_atencao, gestao="propria", saida=e11_saida, intraday=True, sem_ntsl=True,
                aguardando="preço perto de sair da faixa de movimento normal do dia",
                ideal="60 min no WIN e no Nasdaq (no nosso teste foi onde ficou positiva). Acerta pouco (~40%) e ganha nos dias de tendência",
                regras=["Faixa de ruído: o movimento normal desde a abertura até aquele horário (média dos 14 pregões anteriores)",
                        "Compra quando o candle fecha acima de max(abertura de hoje, fechamento de ontem) + a faixa E acima da VWAP (venda: o inverso)",
                        "Só decide nas horas cheias e nas meias horas; entra a mercado no candle seguinte",
                        "Stop móvel: sai quando fecha de volta abaixo do maior entre a faixa e a VWAP; tudo zerado no fim do dia",
                        "Stop de proteção 1 ATR além do nível (o estudo não usa stop fixo; aqui ele existe para o risco ser conhecido)",
                        "Fonte: 'Beat the Market: An Effective Intraday Momentum Strategy for S&P500 ETF' (SSRN, 2024). No estudo: 37% de acerto, "
                        "ganho pequeno por operação e anos fracos quando o mercado anda pouco (2025 ficou no zero)",
                        "Só no aplicativo: não tem script do Profit"]),
    "E12": dict(nome="Fibo ABC: 3 alvos projetados", autor="Projeção de Fibonacci A-B-C (Trend-Based Fib Extension do TradingView)",
                fn=e12_abc, aten=e12_atencao, gestao="fibo3", saida=None, intraday=False, sem_ntsl=True,
                aguardando="correção entre 38,2% e 50% da pernada, esperando o candle de reversão",
                ideal="60 min em ativos em tendência. No nosso teste (421 operações em 12 ativos) perdeu na média depois dos custos em "
                      "5 e 15 min e ficou perto do zero em 60 min. O stop é largo (abaixo da pernada): confira o % do capital",
                regras=["Médias simples alinhadas: MM9 > MM20 > MM200 e MM20 subindo (venda: o inverso)",
                        "Pernada A→B de pelo menos 2 ATR, com o topo B confirmado como pivô",
                        "Correção até C que busca 38,2% e não passa de 50% da pernada",
                        "Candle de reversão colado no fundo C: compra 1 tick acima dele (vale 2 candles), ainda abaixo do topo B",
                        "Stop 1 tick abaixo do início da pernada (A)",
                        "Três alvos na projeção de Fibonacci da pernada a partir de C: 61,8%, 100% e 161,8%",
                        "Um terço da posição em cada alvo; no alvo 1 o stop vai para a entrada, no alvo 2 vai para o alvo 1 "
                        "(com 1 contrato não há parcial: só o stop sobe e a saída é no alvo 3)"]),
    "E13": dict(nome="Fibo 50: ordem limitada na pernada", autor="Entrada na zona de retração (família Golden Pocket / OTE, com o nível nos 50%)",
                fn=e13_limite, aten=e13_atencao, gestao="fibo3", saida=None, intraday=False, sem_ntsl=True,
                aguardando="pernada pronta: a ordem limitada fica esperando o preço recuar até os 50%",
                ideal="60 min em ativos de custo baixo. No nosso teste (1.755 operações em 12 ativos) ficou perto do zero em 60 min e "
                      "negativa em 5 e 15 min; entre os níveis 38,2%, 50%, 61,8% e 70,5%, o de 50% foi o menos ruim",
                regras=["MM20 e preço acima da MM200; no topo da pernada as médias estavam alinhadas (MM9 > MM20 > MM200)",
                        "Pernada A→B forte: pelo menos 2,5 ATR, com o topo B confirmado como pivô",
                        "Compra LIMITADA nos 50% da pernada: a ordem fica parada esperando o preço recuar (sem candle de confirmação)",
                        "A ordem vale enquanto o preço não fizer topo novo e por até 20 candles depois do topo",
                        "Stop 1 tick abaixo do início da pernada (A)",
                        "Três alvos ancorados na pernada: o topo B, 127,2% e 161,8% da pernada",
                        "Um terço em cada alvo; no alvo 1 o stop vai para a entrada, no alvo 2 vai para o alvo 1",
                        "As versões publicadas usam 61,8% (Golden Pocket) ou 70,5% (OTE); aqui o nível é 50%"]),
}

GESTOES = {
    "padrao": "Padrão de cada estratégia (a gestão que cada uma usa - ver regras)",
    "alvo2": "Alvo 2:1 (tudo no alvo)",
    "alvo3": "Alvo 3:1 (tudo no alvo)",
    "alvo4": "Alvo 4:1 (tudo no alvo)",
    "parcial": "Parcial: metade no 1:1, stop no 0x0, resto no 2:1",
    "conducao": "Condução: metade no 1:1, stop no 0x0, resto carregado pela MM9",
    "trail_atr": "Trailing stop: sem alvo, o stop sobe 2 ATR atrás do melhor preço",
    "trail_r": "Trailing em degraus: sem alvo, a cada 1R a favor o stop sobe 1R",
}
# nome curto (botoes da tela) e o que cada gestao faz, em uma frase
GESTOES_CURTO = {"padrao": "Padrão", "alvo2": "2:1", "alvo3": "3:1", "alvo4": "4:1", "parcial": "Parcial", "conducao": "Condução",
                 "trail_atr": "Trailing ATR", "trail_r": "Trailing degraus"}


def avaliar(Gs, cod, i):
    """Roda a estrategia `cod` no candle fechado i para compra (Gs[1]) e venda (Gs[-1]).
    Devolve a ordem ja convertida para precos reais, ou None."""
    e = ESTRATEGIAS[cod]
    achou = []
    for d in (1, -1):
        o = e["fn"](Gs[d], i)
        if o:
            achou.append((d, o))
    if len(achou) != 1:
        return None                                            # nada ou conflito (nao opera)
    d, o = achou[0]
    o = dict(o, dir=d, est=cod, i_sinal=i)
    if d == -1:
        o["stop"] = -o["stop"]
        if o["gatilho"] is not None:
            o["gatilho"] = -o["gatilho"]
        if o.get("alvos"):
            o["alvos"] = tuple(None if x is None else -x for x in o["alvos"])
    return o


def atencao(Gs, cod, i):
    e = ESTRATEGIAS[cod]
    if e["intraday"] and not Gs[1].intraday:
        return 0
    c = e["aten"](Gs[1], i)
    v = e["aten"](Gs[-1], i)
    return 1 if c and not v else (-1 if v and not c else 0)
