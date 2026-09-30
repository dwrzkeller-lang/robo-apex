# -*- coding: utf-8 -*-
"""
ROBO KELLER - indicadores e as 6 estrategias.

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
            self.o, self.h, self.l, self.c = B["o"], B["h"], B["l"], B["c"]
        self.d, self.hm = B["d"], B["hm"]
        self.n = len(self.c)
        self.atr = atr(B["h"], B["l"], B["c"], 14)                       # igual nos dois lados
        neg = (lambda a: [None if x is None else -x for x in a]) if espelho else (lambda a: a)
        self.mm5 = neg(sma(B["c"], 5))
        self.mm9 = neg(sma(B["c"], 9))
        self.mm20 = neg(sma(B["c"], 20))
        self.mm200 = neg(sma(B["c"], 200))
        r2 = rsi(B["c"], 2)
        self.rsi2 = [None if x is None else 100.0 - x for x in r2] if espelho else r2
        self.vw = neg(vwap_dia(B["h"], B["l"], B["c"], B["v"], B["d"])) if self.intraday else None
        self.ini_dia = inicio_do_dia(B["d"])
        self.gap_real = bool(B.get("gap_real"))    # a fonte tem gap de abertura de verdade (futuro/CFD, nao indice a vista)

    def acima(self, x):      # arredonda para cima no tick (gatilho de compra)
        t = self.tick
        return math.ceil(x / t - 1e-7) * t

    def abaixo(self, x):     # arredonda para baixo no tick (stop de compra)
        t = self.tick
        return math.floor(x / t + 1e-7) * t


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
    return _ordem_stop(G, i, min(G.l[k] for k in pb), info="%d candles de correcao" % npb)


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
    return _ordem_stop(G, i, fundo_pb, info="retracao de %.1f%%" % (100 * ret))


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
    return _ordem_stop(G, i, min(G.l[k] for k in pb), info="correcao de %d candle(s)" % npb)


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
                info="RSI(2) = %.1f" % G.rsi2[i])


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
    return dict(tipo="abertura", gatilho=None, stop=stop, validade=1, info="1º candle do pregão de alta")


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
                info="gap de %.2f%%" % (100 * gap))


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
                info="retração de %.0f%% da pernada" % (100 * ret))


def e9_atencao(G, i):
    return _ogro(G, i) is not None and e9_ogro(G, i) is None


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
               aguardando="base estreita se formando no topo do movimento",
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
               aguardando="queda curta (RSI(2) abaixo de 25) acima da MM200",
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
               aguardando="pivô formado (correção até 50%), esperando o rompimento do topo",
               ideal="5 e 15 min, índices e ouro em tendência, com MM9 > MM20 > MM200",
               regras=["Médias simples alinhadas: MM9 > MM20 > MM200 e MM20 subindo (venda: o inverso)",
                       "Pernada A→B de pelo menos 2 ATR; correção até C que retrai de 23,6% a no máximo 50%",
                       "Compra 1 tick acima do topo B (rompimento do pivô); stop 1 tick abaixo do fundo C",
                       "Alvos na projeção de Fibonacci da pernada a partir de C: 100% (metade + stop no 0x0) e 161,8% (resto)"]),
}

GESTOES = {
    "padrao": "Padrão de cada estratégia (a gestão que cada uma usa - ver regras)",
    "alvo2": "Alvo 2:1 (tudo no alvo)",
    "alvo3": "Alvo 3:1 (tudo no alvo)",
    "parcial": "Parcial: metade no 1:1, stop no 0x0, resto no 2:1",
    "conducao": "Condução: metade no 1:1, stop no 0x0, resto carregado pela MM9",
}


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
