# -*- coding: utf-8 -*-
"""
ROBO APEX - os setups da apostila do Mario Pisani, um por um (E26 a E46), para o backtest.

Mesma regra de ouro de estrategias.py: cada setup olha SO candles ja fechados (ate o candle i) e a regra de compra e
escrita uma vez; a venda e o espelho (o grafico invertido roda a mesma regra).

Fontes: os slides da apostila (desenho de cada setup) e a aba REGRAS da planilha de estatisticas dele. Regras gerais
aplicadas em todos os setups de pivo:
  - JAMAIS entrar depois de tres barras seguidas da mesma cor a favor (regra universal)
  - impulso de 3 a 5 barras com pelo menos um par de barras de maxima e minima maiores; mais de 5 descaracteriza
  - correcao de 2 a 3 barras, ate 50% do impulso (61,8% so quando o impulso e pequeno)
  - impulso muito grande com correcao pequena tende a falhar
  - MM20 inclinada a favor (ja virada um candle antes) e o pivo nao pode estar cruzando a MM20
  - a MM200 nao pode estar na cara da entrada (entre a entrada e o primeiro alvo)
Gestao padrao = o "manejo parcial" da apostila: metade no 1:1, stop no 0x0 e o resto conduzido pela MM9.
Nao entram aqui (precisam do operador): limite de 3 trades por dia e parar depois de 2 stops (isso fica no plano de
trade), noticias, volatilidade historica para o tamanho da mao.
"""
from estrategias import _alvos_do_topo, _br, _dia_anterior, _risco_ok, _serie, _tendencia_ok, ema, sma

PRIMEIRO_MOV_MIN = 180          # "trade de primeiro movimento: ate as 12:00 no maximo" (3 h depois da abertura)
TARDE_MIN = 150                 # trade da tarde: depois das primeiras 2 h 30


# ------------------------------------------------------------------------------------------ regras gerais
def _tres_cores(G, i):
    """Regra universal: tres barras seguidas a favor (verdes na compra) logo antes do gatilho = nao entra."""
    return i >= 2 and G.c[i] > G.o[i] and G.c[i - 1] > G.o[i - 1] and G.c[i - 2] > G.o[i - 2]


def _mm20_virada(G, i):
    """MM20 subindo e ja virada pelo menos um candle antes do sinal."""
    m = G.mm20
    return m[i - 2] is not None and m[i] > m[i - 1] >= m[i - 2]


def _mm200_no_caminho(G, i, ent, risco):
    """A MM200 esta entre a entrada e o primeiro alvo (1:1)? Entao o trade e de retorno a ela, nao de pivo."""
    m = G.mm200[i]
    return m is not None and ent < m < ent + risco


def _ordem(G, i, ent, stop, info, alvos=None, rmin=0.3, rmax=2.5, validade=1):
    if not _risco_ok(G, i, ent, stop, rmin, rmax):
        return None
    o = dict(tipo="stop", gatilho=ent, stop=stop, validade=validade, info=info)
    if alvos:
        o["alvos"] = tuple(alvos)
    return o


def _pausa(G, i, max_barras=3, desde=None):
    """Pivo curto no fim: topo j (maior maxima desde `desde`) com 1 a max_barras barras de pausa depois dele, todas
    abaixo dele. Devolve (j, minima da pausa) ou None."""
    ini = max(desde if desde is not None else i - max_barras - 6, 0)
    if ini >= i:
        return None
    j = max(range(ini, i), key=lambda k: (G.h[k], k))
    if not 1 <= i - j <= max_barras or max(G.h[j + 1:i + 1]) >= G.h[j]:
        return None
    return j, min(G.l[j + 1:i + 1])


def _pivo_classico(G, i, ret_max=0.5, ret_max_pequeno=0.618):
    """Pivo classico no candle i, com as regras da planilha: impulso A->B de 3 a 5 barras (com um par de barras de
    maxima e minima maiores), correcao de 2 a 3 barras depois de B (com uma barra de maxima e minima menores) sem romper
    B, fundo C acima de A, correcao de 15% ate 50% (ate 61,8% so com impulso pequeno, de ate 2 ATR).
    Devolve (a, b, c, ab, ret) ou None."""
    h, l = G.h, G.l
    for nc in (2, 3):
        b = i - nc
        if b < 8 or h[b] < h[b - 1] or max(h[b + 1:i + 1]) >= h[b]:
            continue
        a = min(range(b - 4, b - 1), key=lambda k: (l[k], -k))          # 3 a 5 barras de impulso
        if l[a] > min(l[a - 2:a]) or h[b] < max(h[a:b]):
            continue                                                     # o impulso comecou antes (mais de 5 barras)
        if not any(h[k] > h[k - 1] and l[k] > l[k - 1] for k in range(a + 1, b + 1)):
            continue
        if not any(h[k] < h[k - 1] and l[k] < l[k - 1] for k in range(b + 1, i + 1)):
            continue
        c = min(range(b + 1, i + 1), key=lambda k: (l[k], -k))
        ab = h[b] - l[a]
        if l[c] <= l[a] or ab < G.atr[i]:
            continue
        ret = (h[b] - l[c]) / ab
        if not 0.15 <= ret <= (ret_max_pequeno if ab <= 2 * G.atr[i] else ret_max):
            continue
        if ab > 4 * G.atr[i] and ret < 0.236:
            continue                                                     # impulso enorme com correcao pequena falha
        return a, b, c, ab, ret
    return None


def _pivo_com_regras(G, i, ret_max=0.5):
    """Pivo classico + MM20 virada e encostada (sem cruzar o pivo e sem estar longe) + MM200 fora do caminho + regra das
    tres cores. Devolve (a, b, c, ab, ret, ent, stop) ou None."""
    if G.mm200[i] is None or not _mm20_virada(G, i) or _tres_cores(G, i):
        return None
    r = _pivo_classico(G, i, ret_max)
    if not r:
        return None
    a, b, c, ab, ret = r
    m20, at = G.mm20, G.atr[i]
    if G.l[c] < m20[c] - 0.15 * at or G.l[c] - m20[i] > 2.0 * at:
        return None                                                      # cruzando a MM20 ou longe demais dela
    ent = G.acima(G.h[b] + G.tick)
    stop = G.abaixo(G.l[c] - G.tick)
    if _mm200_no_caminho(G, i, ent, ent - stop):
        return None
    return a, b, c, ab, ret, ent, stop


# ------------------------------------------------------------------------------------------ E26 pivo classico
def e26_pivo_classico(G, i):
    r = _pivo_com_regras(G, i)
    if not r:
        return None
    a, b, c, ab, ret, ent, stop = r
    return _ordem(G, i, ent, stop, "pivô clássico: impulso de %d barras, correção de %s%%" % (b - a + 1, _br(100 * ret, 0)),
                  _alvos_do_topo(G, b, ab))


def e26_atencao(G, i):
    return G.mm200[i] is not None and _mm20_virada(G, i) and _pivo_classico(G, i, 0.618) is not None and e26_pivo_classico(G, i) is None


# ------------------------------------------------------------------------------------------ primeiro movimento do dia
def _primeiro_mov(G, i, ate=PRIMEIRO_MOV_MIN):
    """Indice do 1o candle do dia se o candle i ainda esta na janela do primeiro movimento; senao None."""
    if not G.intraday:
        return None
    s = G.ini_dia[i]
    if i - s < 4 or (i - s) * G.tf > ate:
        return None
    return s


def e27_classico_metade(G, i):
    """Primeiro movimento A->B do dia, pullback ate a metade (30% a 50%) formando um pivo curto no meio do movimento;
    gatilho na maxima desse pivo curto, so se ainda houver espaco ate 80% do primeiro movimento."""
    s = _primeiro_mov(G, i)
    if s is None or _tres_cores(G, i):
        return None
    b = max(range(s, i - 2), key=lambda k: (G.h[k], k))
    if b - s < 2 or max(G.h[b + 1:i + 1]) >= G.h[b]:
        return None
    a = min(range(s, b), key=lambda k: (G.l[k], -k))
    ab = G.h[b] - G.l[a]
    if ab < 1.5 * G.atr[i]:
        return None
    c = min(range(b + 1, i), key=lambda k: (G.l[k], -k))
    ret = (G.h[b] - G.l[c]) / ab
    if not 0.30 <= ret <= 0.50:
        return None                                                      # o PB nao pode perder mais do que 50%
    p = _pausa(G, i, 3, c + 1)
    if not p:
        return None
    j, m = p
    if m <= G.l[c] or G.h[j] > G.l[a] + 0.8 * ab:
        return None                                                      # sem espaco ate 80% do primeiro movimento
    ent, stop = G.acima(G.h[j] + G.tick), G.abaixo(m - G.tick)
    if G.h[b] - ent < ent - stop:
        return None                                                      # o topo B precisa ficar a 1:1 ou mais
    return _ordem(G, i, ent, stop, "clássico metade: pullback de %s%% do primeiro movimento" % _br(100 * ret, 0),
                  (G.abaixo(G.h[b]), G.abaixo(G.h[b] + 0.618 * ab), G.abaixo(G.h[b] + ab)), 0.25, 2.0)


def e27_atencao(G, i):
    s = _primeiro_mov(G, i)
    if s is None:
        return False
    b = max(range(s, i + 1), key=lambda k: (G.h[k], k))
    ab = G.h[b] - min(G.l[s:b + 1])
    return b < i and ab > 0 and 0.2 <= (G.h[b] - min(G.l[b:i + 1])) / ab <= 0.5 and e27_classico_metade(G, i) is None


def e28_classico_afastado(G, i):
    """Primeiro movimento A->B, pullback fundo (mais de 50%) que pode indicar exaustao: espera o preco voltar para a
    regiao do rompimento de B e fazer uma barra de pausa (pre, no ou pos rompimento); gatilho na maxima da pausa."""
    s = _primeiro_mov(G, i)
    if s is None or _tres_cores(G, i):
        return None
    p = _pausa(G, i, 3, max(s, i - 12))
    if not p:
        return None
    j, m = p
    if j - s < 5:
        return None
    c = min(range(s + 2, j), key=lambda k: (G.l[k], -k))
    b = max(range(s, c), key=lambda k: (G.h[k], k))
    a = min(range(s, b + 1), key=lambda k: (G.l[k], -k))
    ab = G.h[b] - G.l[a]
    if b - a < 2 or ab < 1.5 * G.atr[i]:
        return None
    ret = (G.h[b] - G.l[c]) / ab
    if not 0.5 < ret <= 0.79 or G.h[j] < G.h[b] - 0.25 * ab:
        return None                                                      # voltou para a regiao do rompimento de B
    volta = G.h[j] - G.l[c]
    if G.h[j] - m > 0.5 * volta or not _mm20_virada(G, i):
        return None
    ent, stop = G.acima(G.h[j] + G.tick), G.abaixo(m - G.tick)
    onde = "pré" if G.h[j] < G.h[b] - 0.1 * ab else ("no" if G.h[j] <= G.h[b] + 0.1 * ab else "pós")
    return _ordem(G, i, ent, stop, "clássico afastado: correção de %s%%, pausa %s rompimento" % (_br(100 * ret, 0), onde),
                  _alvos_do_topo(G, j, volta))


def e28_atencao(G, i):
    s = _primeiro_mov(G, i)
    if s is None or i - s < 5:
        return False
    b = max(range(s, i), key=lambda k: (G.h[k], k))
    ab = G.h[b] - min(G.l[s:b + 1])
    return b < i - 2 and ab > 0 and (G.h[b] - min(G.l[b:i + 1])) / ab > 0.5 and e28_classico_afastado(G, i) is None


# ------------------------------------------------------------------------------------------ E29 trick entry
def e29_trick_entry(G, i):
    """Pivo dentro do pivo numa tendencia definida: depois do impulso A->B e da correcao ate C, o preco faz um pivo
    menor por dentro (topo j abaixo de B e pausa); a entrada e antecipada na maxima de j, sem esperar romper B."""
    if not _tendencia_ok(G, i) or not _mm20_virada(G, i) or _tres_cores(G, i):
        return None
    p = _pausa(G, i, 2, i - 5)
    if not p:
        return None
    j, m = p
    b = max(range(i - 18, j), key=lambda k: (G.h[k], k))
    if G.h[b] <= G.h[j] or j - b < 3:
        return None
    c = min(range(b + 1, j), key=lambda k: (G.l[k], -k))
    a = min(range(b - 6, b - 1), key=lambda k: (G.l[k], -k))
    ab = G.h[b] - G.l[a]
    if ab < G.atr[i] or m <= G.l[c] or G.l[c] <= G.l[a]:
        return None
    ret = (G.h[b] - G.l[c]) / ab
    if not 0.2 <= ret <= 0.618 or G.h[b] - G.h[j] < 0.3 * (G.h[b] - G.l[c]):
        return None                                                      # gatilho colado em B: melhor o pivo maior
    ent, stop = G.acima(G.h[j] + G.tick), G.abaixo(m - G.tick)
    return _ordem(G, i, ent, stop, "trick entry: pivô por dentro da correção de %s%%" % _br(100 * ret, 0),
                  (G.abaixo(G.h[b]),) + _alvos_do_topo(G, b, ab)[:2], 0.2, 2.0)


def e29_atencao(G, i):
    return _tendencia_ok(G, i) and _pivo_classico(G, i, 0.618) is not None and e29_trick_entry(G, i) is None


# ------------------------------------------------------------------------------------------ E30 FAB4 (abertura)
def e30_fab4(G, i):
    """Abertura acima do fechamento anterior, da MM20 e da MM200 (as quatro referencias a favor), gap de ate 3%; o
    primeiro pivo da abertura (impulso + correcao que nao fecha o gap) e comprado no rompimento. Trade curto."""
    if not G.intraday or not getattr(G, "abertura_real", G.gap_real):
        return None
    s = G.ini_dia[i]
    if i - s < 2 or (i - s + 1) * G.tf > max(30, 3 * G.tf):
        return None
    ant = _dia_anterior(G, s)
    if not ant or G.mm200[s - 1] is None:
        return None
    pc = ant[0]
    gap = (G.o[s] - pc) / abs(pc)
    if not 0 < gap <= 0.03 or G.o[s] <= G.mm20[s - 1] or G.o[s] <= G.mm200[s - 1]:
        return None
    b = max(range(s, i), key=lambda k: (G.h[k], k))
    if max(G.h[b + 1:i + 1]) >= G.h[b] or _tres_cores(G, i):
        return None
    c = min(range(b + 1, i + 1), key=lambda k: (G.l[k], -k))
    ab = G.h[b] - min(G.l[s:b + 1])
    if G.l[c] <= pc or ab < 0.8 * G.atr[i] or (G.h[b] - G.l[c]) / ab > 0.618:
        return None                                                      # o gap nao pode fechar no pullback
    ent, stop = G.acima(G.h[b] + G.tick), G.abaixo(G.l[c] - G.tick)
    return _ordem(G, i, ent, stop, "FAB4: abertura com gap de %s%% acima das 4 referências" % _br(100 * gap * G.sinal, 2, True),
                  _alvos_do_topo(G, b, ab), 0.25, 2.0)


def e30_atencao(G, i):
    if not G.intraday or not getattr(G, "abertura_real", G.gap_real):
        return False
    s = G.ini_dia[i]
    ant = _dia_anterior(G, s) if s else None
    return bool(ant) and i - s < 2 and G.o[s] > ant[0] and G.mm200[s - 1] is not None and G.o[s] > G.mm200[s - 1]


# ------------------------------------------------------------------------------------------ E31 range do primeiro movimento
def _range_abertura(G, i):
    s = _primeiro_mov(G, i)
    if s is None or G.tf > 15:
        return None
    k = max(3, 30 // G.tf)
    if i < s + k + 1:
        return None
    rh, rl = max(G.h[s:s + k]), min(G.l[s:s + k])
    if not 0.3 * G.atr[i] <= rh - rl <= 1.5 * G.atr[i]:
        return None
    return s, k, rh, rl


def e31_range_primeiro(G, i):
    """Os primeiros 30 min de barras de duvida formam o range; o primeiro rompimento para cima (sem perder o fundo do
    range) faz uma pausa e a entrada e na maxima da pausa (a pausa pre-rompimento aumenta a confianca)."""
    r = _range_abertura(G, i)
    if not r or _tres_cores(G, i):
        return None
    s, k, rh, rl = r
    q = next((x for x in range(s + k, i) if G.c[x] > rh), None)
    if q is None or min(G.c[s + k:i + 1]) < rl:
        return None
    p = _pausa(G, i, 3, q)
    if not p:
        return None
    j, m = p
    w = rh - rl
    if m < rh - 0.5 * w:
        return None                                                      # a pausa precisa segurar perto do topo do range
    ent, stop = G.acima(G.h[j] + G.tick), G.abaixo(m - G.tick)
    return _ordem(G, i, ent, stop, "range da abertura rompido; pausa e continuação", _alvos_do_topo(G, j, G.h[j] - rl), 0.2, 2.0)


def e31_atencao(G, i):
    r = _range_abertura(G, i)
    return bool(r) and G.c[i] <= r[2] and e31_range_primeiro(G, i) is None


# ------------------------------------------------------------------------------------------ E32/E33 volta em V
def _queda_violenta(G, i, ini, fim):
    """Queda violenta P->L com o fundo L em [ini, fim]: 2 a 6 barras, pelo menos 2,5 ATR e maioria de barras de baixa."""
    if ini < 8 or fim < ini:
        return None
    L = min(range(ini, fim + 1), key=lambda k: (G.l[k], -k))
    p = max(range(L - 6, L), key=lambda k: (G.h[k], k))
    queda = G.h[p] - G.l[L]
    if L - p < 2 or queda < 2.5 * G.atr[i] or G.h[p] < max(G.h[p - 3:p]):
        return None
    if sum(1 for k in range(p + 1, L + 1) if G.c[k] < G.o[k]) < 0.6 * (L - p):
        return None
    return p, L, queda


def _volta_v(G, i, contra):
    if G.mm200[i] is None:
        return None
    q = _queda_violenta(G, i, i - 2, i - 1)
    if not q:
        return None
    p, L, queda = q
    if not (G.c[i] > G.o[i] and G.c[i] > G.h[i - 1] and G.c[i] >= (G.h[i] + G.l[i]) / 2):
        return None                                                      # a virada: barra de alta forte
    volta = G.c[i] - G.l[L]
    if volta < 0.3 * queda or max(G.h[k] - G.l[k] for k in range(L + 1, i + 1)) < 0.6 * queda / (L - p):
        return None                                                      # simetria: a volta tem barras do tamanho da queda
    m200 = G.mm200[i]
    if G.l[L] < m200 < G.h[p]:
        return None                                                      # volta em V atravessando a MM200: evitar
    if (G.c[i] < m200) != contra:
        return None
    ent, stop = G.acima(G.h[i] + G.tick), G.abaixo(G.l[L] - G.tick)
    risco = ent - stop
    if 0 <= G.mm20[i] - ent < 0.5 * G.atr[i] or G.h[p] - ent < risco:
        return None                                                      # na cara da MM20 ou sem espaco ate o topo
    a1 = max(ent + risco, G.l[L] + 0.618 * queda)
    a2 = max(a1 + 0.5 * risco, G.h[p])
    return _ordem(G, i, ent, stop, "volta em V %s: queda de %s ATR" % ("contra a MM200" if contra else "a favor", _br(queda / G.atr[i], 1)),
                  (G.abaixo(a1), G.abaixo(a2), G.abaixo(a2 + 0.5 * queda)), 0.3, 3.0)


def e32_volta_v_favor(G, i):
    """Volta em V a favor: queda violenta acima da MM200 (dentro da tendencia de alta) e a virada simetrica."""
    return _volta_v(G, i, False)


def e33_volta_v_contra(G, i):
    """Volta em V contra: queda violenta abaixo da MM200 e a virada simetrica (trade de retorno, alvo no topo da queda)."""
    return _volta_v(G, i, True)


def e32_atencao(G, i):
    return G.mm200[i] is not None and G.c[i] > G.mm200[i] and bool(_queda_violenta(G, i, i - 1, i))


def e33_atencao(G, i):
    return G.mm200[i] is not None and G.c[i] < G.mm200[i] and bool(_queda_violenta(G, i, i - 1, i))


# ------------------------------------------------------------------------------------------ E34 volta em V nas Bandas de Bollinger
def _bandas(G):
    def calc():
        c, n = G.c, G.n
        mid = sma(c, 20)
        lo = [None] * n
        for k in range(19, n):
            m = mid[k]
            dp = (sum((x - m) ** 2 for x in c[k - 19:k + 1]) / 20.0) ** 0.5
            lo[k] = m - 2.0 * dp
        return mid, lo
    return _serie(G, "bb20", calc)


def e34_volta_v_bb(G, i):
    """Violencia que leva o preco a fechar FORA da banda de Bollinger de baixo, longe da MM20, e o candle seguinte
    fecha de volta DENTRO, de alta: compra no rompimento dele buscando o retorno a MM20."""
    mid, lo = _bandas(G)
    if lo[i - 1] is None or not (G.c[i - 1] < lo[i - 1] and G.c[i] > lo[i] and G.c[i] > G.o[i]):
        return None
    if mid[i] - G.l[i - 1] < 2.5 * G.atr[i]:
        return None                                                      # a violencia precisa se afastar da MM20
    ent, stop = G.acima(G.h[i] + G.tick), G.abaixo(min(G.l[i - 1], G.l[i]) - G.tick)
    risco = ent - stop
    if mid[i] - ent < risco:
        return None
    return _ordem(G, i, ent, stop, "volta em V nas Bandas de Bollinger: fechou fora, fechou dentro",
                  (G.abaixo(ent + risco), G.abaixo(mid[i]), G.abaixo(mid[i] + risco)), 0.3, 3.0)


def e34_atencao(G, i):
    mid, lo = _bandas(G)
    return lo[i] is not None and G.c[i] < lo[i] and mid[i] - G.l[i] >= 2.5 * G.atr[i]


# ------------------------------------------------------------------------------------------ E35 1-2-3 (Mark Crisp)
def e35_123_crisp(G, i):
    """Depois de uma queda violenta: fundo 1, repique ate 2, fundo 3 mais alto que 1; compra no rompimento de 2.
    Nao depende das medias."""
    if i < 25:
        return None
    p1 = min(range(i - 12, i - 2), key=lambda k: (G.l[k], -k))
    if not _queda_violenta(G, i, p1, p1):
        return None
    p2 = max(range(p1 + 1, i), key=lambda k: (G.h[k], k))
    if p2 >= i or max(G.h[p2 + 1:i + 1]) >= G.h[p2]:
        return None
    p3 = min(range(p2 + 1, i + 1), key=lambda k: (G.l[k], -k))
    perna = G.h[p2] - G.l[p1]
    if G.l[p3] <= G.l[p1] or perna <= 0 or not 0.3 <= (G.h[p2] - G.l[p3]) / perna <= 0.9 or i - p2 > 6:
        return None
    ent, stop = G.acima(G.h[p2] + G.tick), G.abaixo(G.l[p3] - G.tick)
    return _ordem(G, i, ent, stop, "1-2-3: fundo 3 acima do fundo 1, gatilho no topo 2", _alvos_do_topo(G, p2, perna))


def e35_atencao(G, i):
    return i >= 25 and bool(_queda_violenta(G, i, i - 4, i))


# ------------------------------------------------------------------------------------------ E36 DiNapoli (3x3)
def _dma3x3(G):
    def calc():
        m3 = sma(G.c, 3)
        return [None] * 3 + m3[:-3]
    return _serie(G, "dma3x3", calc)


def e36_dinapoli(G, i):
    """Volta em V pela media de 3 deslocada em 3 (DiNapoli): depois de uma queda violenta o preco fecha acima da 3x3
    (estava abaixo havia 5 candles), faz um pivo curto e a compra e no rompimento do topo desse pivo."""
    d = _dma3x3(G)
    q = _queda_violenta(G, i, i - 10, i - 2)
    if not q or d[i - 12] is None:
        return None
    p, L, queda = q
    x = next((k for k in range(L, i) if G.c[k] > d[k] and all(G.c[t] < d[t] for t in range(k - 5, k))), None)
    if x is None:
        return None
    pz = _pausa(G, i, 3, x)
    if not pz:
        return None
    j, m = pz
    if m <= G.l[L] or G.c[i] < d[i]:
        return None
    ent, stop = G.acima(G.h[j] + G.tick), G.abaixo(m - G.tick)
    return _ordem(G, i, ent, stop, "DiNapoli: fechou acima da 3x3 depois da queda, pivô curto",
                  _alvos_do_topo(G, j, G.h[j] - G.l[L]))


def e36_atencao(G, i):
    d = _dma3x3(G)
    return d[i] is not None and G.c[i] > d[i] and bool(_queda_violenta(G, i, i - 6, i - 1))


# ------------------------------------------------------------------------------------------ E37 divergencia no MACD
def _histograma(G):
    def calc():
        e12, e26 = ema(G.c, 12), ema(G.c, 26)
        macd = [a - b for a, b in zip(e12, e26)]
        sig = ema(macd, 9)
        return [a - b for a, b in zip(macd, sig)]
    return _serie(G, "macd_hist", calc)


def e37_divergencia_macd(G, i):
    """Preco faz minima nova abaixo do fundo anterior, mas o histograma do MACD faz fundo mais alto (divergencia);
    so entra com a confirmacao de price action: candle de alta fechando acima da maxima anterior."""
    if i < 60:
        return None
    hs = _histograma(G)
    if not (G.c[i] > G.o[i] and G.c[i] > G.h[i - 1]):
        return None
    f2 = min(range(i - 3, i + 1), key=lambda k: (G.l[k], -k))
    f1 = min(range(i - 30, f2 - 5), key=lambda k: (G.l[k], -k))
    if G.l[f2] >= G.l[f1] or min(G.l[f1 + 1:f2]) < G.l[f1] or max(G.h[f1:f2]) - G.l[f1] < 1.5 * G.atr[i]:
        return None                                                      # minima nova depois de um repique de verdade
    h1, h2 = min(hs[f1 - 2:f1 + 3]), min(hs[f2 - 2:min(f2 + 3, i + 1)])
    if not h1 < 0 or h2 <= h1:
        return None
    ent, stop = G.acima(G.h[i] + G.tick), G.abaixo(G.l[f2] - G.tick)
    topo = max(G.h[f1:f2])
    return _ordem(G, i, ent, stop, "divergência no MACD com candle de reversão",
                  (G.abaixo(ent + (ent - stop)), G.abaixo(topo), G.abaixo(topo + (topo - G.l[f2]) * 0.618)))


def e37_atencao(G, i):
    if i < 60:
        return False
    hs = _histograma(G)
    f1 = min(range(i - 30, i - 5), key=lambda k: (G.l[k], -k))
    return G.l[i] < G.l[f1] and hs[i] > min(hs[f1 - 2:f1 + 3])


# ------------------------------------------------------------------------------------------ E38 range com cor invertida
def e38_range_cor_invertida(G, i, n=9):
    """Range horizontal (9 candles, ate 2 ATR) numa MM20 subindo; quando aparece uma barra de cor invertida (de baixa)
    colada no topo, arma a compra 1 tick acima do topo do range. Mais de 3 toques no topo = rompimento falso, nao entra."""
    if not _mm20_virada(G, i) or G.c[i] >= G.o[i]:
        return None
    rh, rl = max(G.h[i - n + 1:i + 1]), min(G.l[i - n + 1:i + 1])
    w = rh - rl
    if not 0.6 * G.atr[i] <= w <= 2.0 * G.atr[i] or abs(G.c[i] - G.c[i - n + 1]) > 0.5 * w:
        return None
    if G.h[i] < rh - 0.35 * w or G.c[i] < G.mm20[i]:
        return None
    toques = sum(1 for k in range(i - n + 1, i + 1) if G.h[k] >= rh - 0.1 * w)
    if toques > 3:
        return None
    ent, stop = G.acima(rh + G.tick), G.abaixo(min(G.l[i - 1], G.l[i]) - G.tick)
    return _ordem(G, i, ent, stop, "range: barra de cor invertida no topo (%d toques)" % toques,
                  tuple(G.abaixo(rh + r * w) for r in (0.618, 1.0, 1.618)), 0.3, 2.0, validade=2)


def e38_atencao(G, i):
    rh, rl = max(G.h[i - 8:i + 1]), min(G.l[i - 8:i + 1])
    return _mm20_virada(G, i) and 0.6 * G.atr[i] <= rh - rl <= 2.0 * G.atr[i] and e38_range_cor_invertida(G, i) is None


# ------------------------------------------------------------------------------------------ E39 zona de armadilha
def e39_zona_armadilha(G, i):
    """Preco preso entre a MM20 (embaixo) e a MM200 (em cima). So na zona LARGA (2,5 ATR ou mais), com as regras do pivo
    classico, e com o primeiro alvo antes da MM200. Zona estreita: nao opera."""
    m20, m200 = G.mm20[i], G.mm200[i]
    if m200 is None or not m20 < G.c[i] < m200 or m200 - m20 < 2.5 * G.atr[i] or not _mm20_virada(G, i) or _tres_cores(G, i):
        return None
    r = _pivo_classico(G, i)
    if not r:
        return None
    a, b, c, ab, ret = r
    ent, stop = G.acima(G.h[b] + G.tick), G.abaixo(G.l[c] - G.tick)
    risco = ent - stop
    if m200 - ent < risco:
        return None
    return _ordem(G, i, ent, stop, "zona de armadilha larga: pivô entre a MM20 e a MM200",
                  (G.abaixo(ent + risco), G.abaixo(max(ent + 1.5 * risco, m200)), G.abaixo(max(ent + 2 * risco, m200 + risco))))


def e39_atencao(G, i):
    m20, m200 = G.mm20[i], G.mm200[i]
    return m200 is not None and m20 < G.c[i] < m200 and m200 - m20 >= 2.5 * G.atr[i] and e39_zona_armadilha(G, i) is None


# ------------------------------------------------------------------------------------------ E40/E41 power-breakout
def _power(G, i, n=6):
    """Lateralizacao horizontal de 6 candles (ate 1,2 ATR) depois de uma tendencia media, com a MM20 subindo por baixo
    sem entrar nos precos (serve de toque). Devolve (topo, fundo) ou None."""
    if G.mm200[i] is None or i < 30:
        return None
    ini = i - n + 1
    rh, rl = max(G.h[ini:i + 1]), min(G.l[ini:i + 1])
    at = G.atr[i]
    if rh - rl > 1.2 * at or abs(G.c[i] - G.c[ini]) > 0.5 * (rh - rl):
        return None
    if any(G.mm20[k] >= G.l[k] for k in range(ini, i + 1)) or rl - G.mm20[i] > 1.0 * at or not _mm20_virada(G, i):
        return None
    subida = G.h[ini - 1] - min(G.l[i - 20:ini])
    if not 1.5 * at <= subida <= 5.0 * at:
        return None                                                      # power depois de tendencia boa tende a falhar
    return rh, rl


def e40_power_breakout(G, i):
    """Power-breakout (Pisani): lateral horizontal apoiada na MM20 depois de uma tendencia media; compra 1 tick acima do
    topo da lateral, stop 1 tick abaixo do fundo."""
    r = _power(G, i)
    if not r or _tres_cores(G, i):
        return None
    rh, rl = r
    ent, stop = G.acima(rh + G.tick), G.abaixo(rl - G.tick)
    if _mm200_no_caminho(G, i, ent, ent - stop):
        return None
    w = rh - rl
    return _ordem(G, i, ent, stop, "power-breakout: lateral de 6 candles apoiada na MM20",
                  tuple(G.abaixo(rh + r * max(w, G.atr[i])) for r in (1.0, 1.618, 2.618)), 0.3, 2.0)


def e40_atencao(G, i):
    return _power(G, i, 5) is not None and e40_power_breakout(G, i) is None


def e41_power_pullback(G, i):
    """Power-breakout com pullback: a lateral ja rompeu (fechamento acima do topo nos ultimos 4 candles), o preco faz
    um pullback que segura o topo da lateral e a compra e no rompimento da maxima depois do rompimento."""
    for q in range(i - 4, i):
        r = _power(G, q - 1)
        if not r or G.c[q] <= r[0]:
            continue
        rh, rl = r
        p = _pausa(G, i, 3, q)
        if not p:
            return None
        j, m = p
        if m < rh - 0.3 * (rh - rl) or _tres_cores(G, i):
            return None
        ent, stop = G.acima(G.h[j] + G.tick), G.abaixo(m - G.tick)
        return _ordem(G, i, ent, stop, "power-breakout com pullback segurando o topo da lateral",
                      _alvos_do_topo(G, j, G.h[j] - rl), 0.25, 2.0)
    return None


def e41_atencao(G, i):
    return any(_power(G, q - 1) and G.c[q] > _power(G, q - 1)[0] for q in range(i - 2, i + 1)) and e41_power_pullback(G, i) is None


# ------------------------------------------------------------------------------------------ E42 breakout (trade da tarde)
def _alternancias(G, ini, fim):
    """Quantas vezes o fechamento trocou de lado da MM20 entre ini e fim."""
    n, lado = 0, None
    for k in range(ini, fim + 1):
        x = 1 if G.c[k] > G.mm20[k] else -1
        if lado is not None and x != lado:
            n += 1
        lado = x
    return n


def e42_breakout_tarde(G, i):
    """Trade da tarde: lateral em que os precos alternaram com a MM20 (4 alternancias ou mais); o primeiro pivo
    alinhado com a MM20 perto do topo da lateral (pullback pre, no ou pos rompimento) e comprado no rompimento."""
    if not G.intraday or (i - G.ini_dia[i]) * G.tf < TARDE_MIN:
        return None
    r = _pivo_com_regras(G, i, 0.618)
    if not r:
        return None
    a, b, c, ab, ret, ent, stop = r
    ini = max(a - 30, 1)
    alt = _alternancias(G, ini, a)
    if alt < 4:
        return None
    topo = max(G.h[ini:a])
    at = G.atr[i]
    if G.h[b] < topo - 0.3 * at:
        return None                                                      # o pivo precisa estar no topo da lateral
    onde = "pré" if G.h[b] < topo else ("no" if G.l[c] < topo else "pós")
    return _ordem(G, i, ent, stop, "breakout da tarde (%d alternâncias na MM20): pivô %s rompimento" % (alt, onde),
                  _alvos_do_topo(G, b, max(ab, G.h[b] - min(G.l[ini:a + 1]))))


def e42_atencao(G, i):
    return G.intraday and (i - G.ini_dia[i]) * G.tf >= TARDE_MIN and _alternancias(G, i - 30, i) >= 4 and e42_breakout_tarde(G, i) is None


# ------------------------------------------------------------------------------------------ E43 mergulhada dupla
def e43_mergulhada_dupla(G, i):
    """A favor da tendencia: uma correcao grande faz um fundo, repica e volta para fazer um segundo fundo parecido
    (mergulhada dupla); compra quando um candle de alta fecha acima da maxima anterior, stop abaixo dos dois fundos."""
    if not _tendencia_ok(G, i) or G.c[i] < G.mm20[i] or not (G.c[i] > G.o[i] and G.c[i] > G.h[i - 1]):
        return None
    d2 = min(range(i - 3, i + 1), key=lambda k: (G.l[k], -k))
    rep = max(range(d2 - 8, d2), key=lambda k: (G.h[k], k))
    d1 = min(range(rep - 8, rep), key=lambda k: (G.l[k], -k))
    at = G.atr[i]
    if abs(G.l[d2] - G.l[d1]) > 0.35 * at or G.h[rep] - max(G.l[d1], G.l[d2]) < at or rep - d1 < 1 or d2 - rep < 1:
        return None
    topo = max(G.h[d1 - 12:d1])
    if topo - G.l[d1] < 1.5 * at:
        return None                                                      # impulso grande pede correcao proporcional
    ent, stop = G.acima(G.h[i] + G.tick), G.abaixo(min(G.l[d1], G.l[d2]) - G.tick)
    return _ordem(G, i, ent, stop, "mergulhada dupla a favor da tendência",
                  (G.abaixo(G.h[rep]), G.abaixo(topo), G.abaixo(topo + (topo - G.l[d1]) * 0.618)), 0.3, 2.5)


def e43_atencao(G, i):
    return _tendencia_ok(G, i) and G.l[i] <= min(G.l[i - 10:i]) + 0.35 * G.atr[i] and e43_mergulhada_dupla(G, i) is None


# ------------------------------------------------------------------------------------------ E44 MM200 pos-rompimento
def e44_mm200_pos(G, i):
    """O preco vinha abaixo da MM200, fechou acima dela nos ultimos 3 a 15 candles e o pullback segura perto dela: o
    pivo do pos-rompimento (regras do pivo classico) e comprado no rompimento."""
    m200 = G.mm200
    if m200[i - 40] is None:
        return None
    r = _pivo_com_regras(G, i, 0.618)
    if not r:
        return None
    a, b, c, ab, ret, ent, stop = r
    x = next((k for k in range(i - 15, a + 1) if G.c[k] > m200[k] and G.c[k - 1] <= m200[k - 1]), None)
    if x is None or sum(1 for k in range(x - 20, x) if G.c[k] < m200[k]) < 12:
        return None
    at = G.atr[i]
    if any(G.c[k] < m200[k] - 0.2 * at for k in range(x, i + 1)) or G.l[c] > m200[c] + 1.0 * at:
        return None                                                      # o pullback tem que segurar perto da MM200
    return _ordem(G, i, ent, stop, "MM200 pós-rompimento: pivô segurando acima dela", _alvos_do_topo(G, b, ab))


def e44_atencao(G, i):
    m200 = G.mm200
    return m200[i - 20] is not None and G.c[i] > m200[i] and sum(1 for k in range(i - 20, i) if G.c[k] < m200[k]) >= 8 and e44_mm200_pos(G, i) is None


# ------------------------------------------------------------------------------------------ E45 afastamento da MM200
def e45_afastamento(G, i):
    """Afastamento inferior (a venda e o superior): o preco esta longe da MM200 (3 ATR ou mais), a MM20 virou a favor e
    o pivo classico de tamanho medio esta alinhado com ela; o primeiro alvo fica antes da MM200."""
    m200 = G.mm200[i]
    if m200 is None or not _mm20_virada(G, i) or _tres_cores(G, i):
        return None
    r = _pivo_classico(G, i)
    if not r:
        return None
    a, b, c, ab, ret = r
    at = G.atr[i]
    if ab > 4 * at or G.l[c] < G.mm20[c] - 0.25 * at:
        return None                                                      # pivo medio e alinhado com a MM20
    ent, stop = G.acima(G.h[b] + G.tick), G.abaixo(G.l[c] - G.tick)
    risco = ent - stop
    if m200 - ent < max(3 * at, 1.5 * risco):
        return None
    return _ordem(G, i, ent, stop, "afastamento da MM200 (%s ATR): pivô alinhado com a MM20" % _br((m200 - ent) / at, 1),
                  (G.abaixo(ent + risco), G.abaixo(ent + 0.5 * (m200 - ent)), G.abaixo(m200)))


def e45_atencao(G, i):
    m200 = G.mm200[i]
    return m200 is not None and m200 - G.c[i] >= 3 * G.atr[i] and _mm20_virada(G, i) and e45_afastamento(G, i) is None


# ------------------------------------------------------------------------------------------ E46 armadilha na MM200
def e46_armadilha_mm200(G, i):
    """O preco vem de baixo e chega na MM200 com um candle de alta; o candle seguinte faz uma pausa de 1 barra (RBI /
    Gift) sem perder a metade do anterior; compra no rompimento das duas maximas, por cima da MM200."""
    m200 = G.mm200
    if m200[i - 12] is None or not _mm20_virada(G, i):
        return None
    k, at = i - 1, G.atr[i]
    if not (G.c[k] > G.o[k] and G.h[k] >= m200[k] - 0.3 * at and G.c[k] <= m200[k] + 0.3 * at):
        return None
    if sum(1 for t in range(i - 11, i - 1) if G.c[t] < m200[t]) < 7:
        return None                                                      # vinha de baixo da MM200
    if not (G.c[i] < G.o[i] and G.l[i] >= (G.o[k] + G.c[k]) / 2 and G.h[i] <= G.h[k] + 0.2 * at):
        return None
    ent, stop = G.acima(max(G.h[k], G.h[i]) + G.tick), G.abaixo(G.l[i] - G.tick)
    risco = ent - stop
    return _ordem(G, i, ent, stop, "armadilha na MM200: pausa de 1 barra encostada nela",
                  (G.abaixo(ent + risco), G.abaixo(ent + 2 * risco), G.abaixo(ent + 3 * risco)), 0.25, 2.0)


def e46_atencao(G, i):
    m200 = G.mm200[i]
    return m200 is not None and G.c[i] < m200 and m200 - G.h[i] <= 0.5 * G.atr[i] and e46_armadilha_mm200(G, i) is None


# ------------------------------------------------------------------------------------------ registro
_AUTOR = "Mario Pisani (apostila)"
_GERAIS = "Regra universal: não entra depois de 3 barras seguidas da mesma cor a favor"
_GESTAO = "Gestão padrão (manejo parcial da apostila): metade no 1:1, stop no 0x0 e o resto conduzido pela MM9"


def _e(nome, fn, aten, aguardando, regras, intraday=False, gestao="conducao"):
    return dict(nome=nome, autor=_AUTOR, fn=fn, aten=aten, gestao=gestao, saida=None, intraday=intraday, sem_ntsl=True,
                aguardando=aguardando, ideal="Resultado com custos: ver o teste na aba Resultado", regras=regras, pisani=True)


SETUPS = {
    "E26": _e("Pivô clássico (regras da apostila)", e26_pivo_classico, e26_atencao, "impulso feito, esperando a correção de 2 a 3 barras", [
        "Impulso de 3 a 5 barras com pelo menos um par de barras de máxima e mínima maiores (mais de 5 descaracteriza o pivô)",
        "Correção de 2 a 3 barras, sem romper o topo, de 15% até 50% do impulso (61,8% só com impulso pequeno, até 2 ATR)",
        "Impulso enorme (mais de 4 ATR) com correção menor que 23,6% tende a falhar: não entra",
        "MM20 subindo e já virada um candle antes; o pivô não pode cruzar a MM20 nem estar longe dela (2 ATR)",
        "A MM200 não pode estar na cara da entrada (entre a entrada e o 1:1)",
        "Compra 1 tick acima do topo do impulso, valendo 1 candle; stop 1 tick abaixo do fundo da correção",
        _GERAIS, _GESTAO]),
    "E27": _e("Primeiro movimento: clássico metade", e27_classico_metade, e27_atencao, "primeiro movimento do dia feito, pullback indo para a metade", [
        "Só intraday, nas 3 primeiras horas: o primeiro movimento do dia vai do fundo A ao topo B (pelo menos 1,5 ATR)",
        "O pullback vai de 30% a 50% do movimento (não pode perder mais do que 50%)",
        "No meio do movimento forma um pivô curto (topo e 1 a 3 barras de pausa acima do fundo do pullback)",
        "Só entra se a entrada estiver abaixo de 80% do primeiro movimento e o topo B ficar a 1:1 ou mais",
        "Compra 1 tick acima do pivô curto; stop 1 tick abaixo da pausa; primeiro alvo no topo B",
        _GERAIS, _GESTAO], intraday=True),
    "E28": _e("Primeiro movimento: clássico afastado", e28_classico_afastado, e28_atencao, "pullback fundo do primeiro movimento, esperando voltar à região do topo", [
        "Só intraday, nas 3 primeiras horas: primeiro movimento A→B de pelo menos 1,5 ATR",
        "Pullback fundo, de mais de 50% até 79%: o pivô afastado pode sugerir exaustão",
        "Espera o preço voltar para a região do rompimento de B (até 25% abaixo dele) e fazer 1 a 3 barras de pausa (pré, no ou pós rompimento)",
        "A pausa não pode devolver mais do que metade da volta; MM20 subindo",
        "Compra 1 tick acima da pausa; stop 1 tick abaixo dela",
        _GERAIS, _GESTAO], intraday=True),
    "E29": _e("Trick entry (pivô dentro do pivô)", e29_trick_entry, e29_atencao, "correção do pivô maior formando um pivô menor por dentro", [
        "Tendência definida: preço e MM20 acima da MM200, MM20 subindo",
        "Impulso A→B e correção até C de 20% a 61,8%",
        "Dentro da correção o preço faz um pivô menor: topo abaixo de B e 1 a 2 barras de pausa acima de C",
        "Entrada antecipada 1 tick acima desse pivô menor (\"trick entry: sempre antecipar\"); se o gatilho ficar colado em B, vale o pivô maior",
        "Stop 1 tick abaixo da pausa; primeiro alvo no topo B",
        _GERAIS, _GESTAO]),
    "E30": _e("Abertura: FAB4", e30_fab4, e30_atencao, "abertura acima das 4 referências, esperando o primeiro pivô", [
        "Só intraday e em ativos com gap de abertura de verdade (ações da B3, futuros do Profit, USTEC/JP225): nos primeiros 30 minutos",
        "Abertura acima do fechamento anterior, da MM20 e da MM200 (as quatro referências a favor); gap de até 3%",
        "Primeiro pivô da abertura: impulso e correção de até 61,8% que não fecha o gap",
        "Compra 1 tick acima do topo; stop 1 tick abaixo da correção",
        "Trade curto e rápido: gestão padrão Parcial (metade no 1:1, resto no 2:1)", _GERAIS], intraday=True, gestao="parcial"),
    "E31": _e("Primeiro movimento: range", e31_range_primeiro, e31_atencao, "range da abertura montado, esperando o rompimento", [
        "Só intraday (5 e 15 min), nas 3 primeiras horas",
        "Os primeiros 30 minutos (barras de dúvida, sem viés) marcam o range, de 0,3 a 1,5 ATR",
        "Primeiro fechamento acima do topo do range, sem ter fechado abaixo do fundo",
        "Pausa de 1 a 3 barras segurando perto do topo do range (a pausa pré-rompimento aumenta a confiança)",
        "Compra 1 tick acima da pausa; stop 1 tick abaixo dela",
        "Gestão padrão Parcial; depois do parcial, um dos manejos de stop", _GERAIS], intraday=True, gestao="parcial"),
    "E32": _e("Volta em V a favor", e32_volta_v_favor, e32_atencao, "queda violenta acima da MM200, esperando a virada", [
        "Queda violenta: 2 a 6 barras, pelo menos 2,5 ATR, a maioria de baixa, acima da MM200",
        "A virada: candle de alta forte que fecha acima da máxima anterior e na metade de cima dele",
        "Simetria: a volta tem barras do tamanho das da queda e já recuperou 30% dela",
        "Não entra na cara da MM20 nem com a volta atravessando a MM200; precisa de espaço (1:1) até o topo da queda",
        "Compra 1 tick acima do candle de virada; stop 1 tick abaixo do fundo do V",
        _GESTAO]),
    "E33": _e("Volta em V contra", e33_volta_v_contra, e33_atencao, "queda violenta abaixo da MM200, esperando a virada", [
        "Mesmas regras da volta em V a favor, mas abaixo da MM200 (contra a tendência maior)",
        "É trade de retorno: o alvo é o topo de onde a queda começou",
        "A volta não pode atravessar a MM200",
        "Compra 1 tick acima do candle de virada; stop 1 tick abaixo do fundo do V",
        _GESTAO]),
    "E34": _e("Volta em V nas Bandas de Bollinger", e34_volta_v_bb, e34_atencao, "preço fechando fora da banda de baixo", [
        "Bandas de Bollinger de 20 períodos e 2 desvios",
        "Fechou fora: um candle fecha abaixo da banda de baixo, a 2,5 ATR ou mais da MM20 (violência que se afasta da média)",
        "Fechou dentro: o candle seguinte fecha de alta, de volta para dentro da banda",
        "Compra 1 tick acima dele; stop 1 tick abaixo dos dois candles; o alvo é o retorno à MM20 (pelo menos 1:1)",
        _GESTAO]),
    "E35": _e("1-2-3 (Mark Crisp)", e35_123_crisp, e35_atencao, "queda violenta feita, esperando o fundo 3", [
        "Depois de uma queda violenta (2,5 ATR ou mais), o fundo 1",
        "O repique até o topo 2 e a nova queda até o fundo 3, mais alto que o 1 (30% a 90% do repique)",
        "Compra 1 tick acima do topo 2; stop 1 tick abaixo do fundo 3",
        "Não depende das médias", _GESTAO]),
    "E36": _e("Volta em V pela 3x3 (DiNapoli)", e36_dinapoli, e36_atencao, "queda violenta, preço voltando para a média 3x3", [
        "Média móvel de 3 deslocada 3 candles para a frente (3x3 do Joe DiNapoli)",
        "Depois de uma queda violenta, o preço fecha acima da 3x3 (estava abaixo havia 5 candles)",
        "Faz um pivô curto (1 a 3 barras de pausa) sem perder o fundo da queda",
        "Compra 1 tick acima do pivô; stop 1 tick abaixo da pausa", _GESTAO]),
    "E37": _e("Reversão com divergência no MACD", e37_divergencia_macd, e37_atencao, "mínima nova com o histograma do MACD mais alto", [
        "Divergência: o preço faz mínima nova abaixo do fundo anterior (com um repique de 1,5 ATR entre eles), mas o histograma do MACD (12, 26, 9) faz fundo mais alto",
        "Não opera a divergência sozinha: precisa do setup de reversão, um candle de alta fechando acima da máxima anterior",
        "Compra 1 tick acima desse candle; stop 1 tick abaixo da mínima nova",
        "Pode operar contra a tendência", _GESTAO]),
    "E38": _e("Range: rompimento com cor invertida", e38_range_cor_invertida, e38_atencao, "range com a MM20 subindo, esperando a barra de cor invertida no topo", [
        "Range horizontal de 9 candles, de 0,6 a 2 ATR, com a MM20 subindo e o preço acima dela",
        "Barra de cor invertida (de baixa) colada no topo do range: é ela que arma o rompimento",
        "Mais de 3 toques no topo = tentativa demais, rompimento falso: não entra",
        "Compra 1 tick acima do topo do range (vale 2 candles); stop 1 tick abaixo das duas últimas barras", _GESTAO]),
    "E39": _e("Zona de armadilha larga", e39_zona_armadilha, e39_atencao, "preço preso entre a MM20 e a MM200", [
        "Preço entre a MM20 (embaixo) e a MM200 (em cima)",
        "Só na zona larga, de 2,5 ATR ou mais; zona estreita: não operar",
        "Pivô com as regras do pivô clássico e a MM20 subindo",
        "Precisa de 1:1 de espaço antes da MM200 (o primeiro alvo não pode passar dela)",
        _GERAIS, _GESTAO]),
    "E40": _e("Power-breakout (MM20)", e40_power_breakout, e40_atencao, "lateral apoiada na MM20 se formando", [
        "Lateral horizontal de 6 candles, de até 1,2 ATR",
        "Antes dela, uma tendência média (1,5 a 5 ATR): power depois de tendência muito boa tende a falhar",
        "A MM20 sobe por baixo, sem entrar nos preços, a até 1 ATR do fundo da lateral (serve de toque)",
        "Compra 1 tick acima do topo da lateral; stop 1 tick abaixo do fundo; a MM200 não pode estar na cara",
        _GERAIS, _GESTAO]),
    "E41": _e("Power-breakout com pullback", e41_power_pullback, e41_atencao, "lateral rompida, esperando o pullback", [
        "A lateral do power-breakout já rompeu (fechamento acima do topo nos últimos 4 candles)",
        "Pullback de 1 a 3 barras que segura o topo da lateral",
        "Compra 1 tick acima da máxima depois do rompimento; stop 1 tick abaixo do pullback",
        _GERAIS, _GESTAO]),
    "E42": _e("Breakout da tarde (4 alternâncias)", e42_breakout_tarde, e42_atencao, "lateral alternando com a MM20, esperando o pivô no topo", [
        "Só intraday, depois das primeiras 2 h 30 (trade da tarde)",
        "Nos 30 candles antes do pivô os fechamentos alternaram de lado da MM20 pelo menos 4 vezes",
        "O primeiro pivô alinhado com a MM20 no topo da lateral: pullback pré, no ou pós rompimento",
        "Regras do pivô clássico (correção até 61,8%); compra 1 tick acima do topo do pivô",
        _GERAIS, _GESTAO], intraday=True),
    "E43": _e("Mergulhada dupla", e43_mergulhada_dupla, e43_atencao, "correção grande fazendo o segundo fundo", [
        "A favor da tendência: preço e MM20 acima da MM200, preço acima da MM20",
        "Depois de um impulso grande, a correção faz um fundo, repica (pelo menos 1 ATR) e volta para um segundo fundo parecido (até 0,35 ATR de diferença)",
        "Compra quando um candle de alta fecha acima da máxima anterior; stop 1 tick abaixo dos dois fundos",
        "Primeiro alvo no topo do repique", _GESTAO]),
    "E44": _e("MM200: pós-rompimento", e44_mm200_pos, e44_atencao, "preço acabou de passar a MM200, esperando o pullback", [
        "O preço vinha abaixo da MM200 (12 dos 20 candles) e fechou acima dela há 3 a 15 candles",
        "O pullback segura perto da MM200 (sem fechar 0,2 ATR abaixo dela)",
        "Pivô com as regras do pivô clássico (correção até 61,8%) e a MM20 já virada",
        "Compra 1 tick acima do topo do pivô; stop 1 tick abaixo da correção",
        "Pré-rompimento e no rompimento não entram (a apostila manda esperar o pós)", _GESTAO]),
    "E45": _e("Afastamento da MM200", e45_afastamento, e45_atencao, "preço longe da MM200 com a MM20 virando", [
        "Afastamento inferior (compra) ou superior (venda): preço a 3 ATR ou mais da MM200",
        "A MM20 já virou a favor do trade e o pivô (de tamanho médio, até 4 ATR) está alinhado com ela",
        "Regras do pivô clássico; compra 1 tick acima do topo do pivô",
        "O primeiro alvo fica antes da MM200; o último, na própria MM200", _GERAIS, _GESTAO]),
    "E46": _e("Armadilha na MM200 (RBI/Gift)", e46_armadilha_mm200, e46_atencao, "preço chegando na MM200 por baixo", [
        "O preço vinha abaixo da MM200 e chega nela com um candle de alta",
        "O candle seguinte é uma pausa de 1 barra (RBI / Gift): de baixa, sem perder a metade do anterior",
        "MM20 subindo",
        "Compra 1 tick acima das duas máximas (por cima da MM200); stop 1 tick abaixo da pausa", _GESTAO]),
}

# o que o teste com custos mostrou (bt36, 12 ativos, 5/15/60 min, gestao padrao) - aparece em "Onde costuma se encaixar"
RESULTADO = {
    "E26": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 725 operações, média de −0,32R por operação; o 1º alvo (1:1) foi atingido em 39%. No diário do Pisani (operação manual, com alvo parcial menor) o acerto do 1º alvo foi de 75%, em 111 operações (pivô alinhado com a MM20).",
    "E27": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 24 operações, média de −0,42R por operação; o 1º alvo (1:1) foi atingido em 29%. Poucas operações: ainda não dá para concluir.",
    "E28": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 27 operações, média de −0,16R por operação; o 1º alvo (1:1) foi atingido em 33%. Poucas operações: ainda não dá para concluir.",
    "E29": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 204 operações, média de −0,39R por operação; o 1º alvo (1:1) foi atingido em 39%.",
    "E30": "Poucos dados: com 60 dias de candles de 5 min das ações da B3 saíram só 6 operações no teste. Precisa de mais histórico (CSV do Profit) para concluir.",
    "E31": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 71 operações, média de −0,24R por operação; o 1º alvo (1:1) foi atingido em 46%. Poucas operações: ainda não dá para concluir.",
    "E32": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 643 operações, média de −0,18R por operação; o 1º alvo (1:1) foi atingido em 43%. No diário do Pisani (operação manual, com alvo parcial menor) o acerto do 1º alvo foi de 76%, em 101 operações (volta em V a favor).",
    "E33": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 670 operações, média de −0,15R por operação; o 1º alvo (1:1) foi atingido em 46%. No diário do Pisani (operação manual, com alvo parcial menor) o acerto do 1º alvo foi de 84%, em 185 operações (volta em V contra).",
    "E34": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 3.554 operações, média de −0,20R por operação; o 1º alvo (1:1) foi atingido em 44%.",
    "E35": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 4.357 operações, média de −0,28R por operação; o 1º alvo (1:1) foi atingido em 41%.",
    "E36": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 2.582 operações, média de −0,35R por operação; o 1º alvo (1:1) foi atingido em 38%.",
    "E37": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 969 operações, média de −0,17R por operação; o 1º alvo (1:1) foi atingido em 45%.",
    "E38": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 867 operações, média de −0,37R por operação; o 1º alvo (1:1) foi atingido em 36%.",
    "E39": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 170 operações, média de −0,31R por operação; o 1º alvo (1:1) foi atingido em 41%.",
    "E40": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 432 operações, média de −0,31R por operação; o 1º alvo (1:1) foi atingido em 38%. No diário do Pisani (operação manual, com alvo parcial menor) o acerto do 1º alvo foi de 74%, em 180 operações (power-breakout na MM20).",
    "E41": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 51 operações, média de −0,24R por operação; o 1º alvo (1:1) foi atingido em 43%. Poucas operações: ainda não dá para concluir.",
    "E42": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 229 operações, média de −0,25R por operação; o 1º alvo (1:1) foi atingido em 41%. No diário do Pisani (operação manual, com alvo parcial menor) o acerto do 1º alvo foi de 74%, em 204 operações (breakout PB pré).",
    "E43": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 1.467 operações, média de −0,12R por operação; o 1º alvo (1:1) foi atingido em 45%.",
    "E44": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 10 operações, média de −0,33R por operação; o 1º alvo (1:1) foi atingido em 40%. Poucas operações: ainda não dá para concluir. No diário do Pisani (operação manual, com alvo parcial menor) o acerto do 1º alvo foi de 69%, em 135 operações (saída da MM200 pós).",
    "E45": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 95 operações, média de −0,35R por operação; o 1º alvo (1:1) foi atingido em 42%. Poucas operações: ainda não dá para concluir. No diário do Pisani (operação manual, com alvo parcial menor) o acerto do 1º alvo foi de 72%, em 459 operações (afastamento da MM200).",
    "E46": "No nosso teste com custos (12 ativos, 5, 15 e 60 min): 74 operações, média de −0,65R por operação; o 1º alvo (1:1) foi atingido em 23%. Poucas operações: ainda não dá para concluir.",
}
for _k, _t in RESULTADO.items():
    SETUPS[_k]["ideal"] = _t

# no modo seletivo: os de pivo e rompimento so a favor do diario e com tendencia limpa
SELETIVO_TENDENCIA = ("E26", "E27", "E28", "E29", "E30", "E31", "E38", "E40", "E41", "E42", "E43", "E44")
