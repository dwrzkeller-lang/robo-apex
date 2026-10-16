"""Nota de qualidade de cada sinal (A+, A, B, C), feita de price action e so com o que ja tinha acontecido.

No candle do sinal (i) o robo confere quatro coisas, cada uma vale 1 ponto:
  estrutura  o preco esta fazendo topos e fundos a favor (fundo mais alto e topo mais alto na compra) ou acabou de
             romper o ultimo topo (rompimento de estrutura); na venda, o espelho
  espaco     da entrada ate a proxima barreira contra (o topo anterior mais perto, na compra) cabem pelo menos 2 vezes
             o risco: o alvo nao vai bater num "teto" no meio do caminho
  diario     a tendencia do grafico diario esta a favor
  rejeicao   o candle do sinal mostra rejeicao a favor (pavio grande contra e fechamento perto do extremo a favor)

4 pontos = A+, 3 = A, 2 = B, 0 ou 1 = C. Os topos e fundos so contam depois de confirmados (K candles de cada lado
ja fechados ate o candle i): nada aqui olha o futuro.
"""

K = 3                  # candles de cada lado para confirmar um topo ou um fundo
JANELA = 240           # quantos candles para tras procurar topos e fundos
ESPACO_MIN = 2.0       # espaco minimo ate a barreira, em vezes o risco
NOTAS = ("C", "C", "B", "A", "A+")
ORDEM = {"C": 0, "B": 1, "A": 2, "A+": 3}


def _pivos(h, l, i, k=K, janela=JANELA):
    """Topos e fundos confirmados ate o candle i (do mais recente para o mais antigo): ([(j, preco)], [(j, preco)])."""
    topos, fundos = [], []
    for j in range(i - k, max(k, i - janela) - 1, -1):
        hj, lj = h[j], l[j]
        if all(hj > h[j - m] for m in range(1, k + 1)) and all(hj >= h[j + m] for m in range(1, k + 1)):
            topos.append((j, hj))
        if all(lj < l[j - m] for m in range(1, k + 1)) and all(lj <= l[j + m] for m in range(1, k + 1)):
            fundos.append((j, lj))
    return topos, fundos


def nota(G, i, direcao, ref, stop):
    """G = grafico normal (o lado da compra). Devolve dict(nota, pontos, itens, espaco)."""
    h, l, o, c = G.h, G.l, G.o, G.c
    topos, fundos = _pivos(h, l, i)
    itens = []
    risco = abs(ref - stop) or 1e-9
    # 1. estrutura
    if direcao > 0:
        sobe = len(topos) >= 2 and len(fundos) >= 2 and topos[0][1] > topos[1][1] and fundos[0][1] > fundos[1][1]
        rompeu = bool(topos) and c[i] > topos[0][1]
    else:
        sobe = len(topos) >= 2 and len(fundos) >= 2 and topos[0][1] < topos[1][1] and fundos[0][1] < fundos[1][1]
        rompeu = bool(fundos) and c[i] < fundos[0][1]
    if sobe or rompeu:
        itens.append("estrutura")
    # 2. espaco ate a proxima barreira contra
    if direcao > 0:
        acima = [p for _, p in topos if p > ref]
        barreira = min(acima) if acima else None
    else:
        abaixo = [p for _, p in fundos if p < ref]
        barreira = max(abaixo) if abaixo else None
    espaco = None if barreira is None else abs(barreira - ref) / risco
    if espaco is None or espaco >= ESPACO_MIN:
        itens.append("espaco")
    # 3. diario
    td = G.tend_d[i] if G.tend_d else 0
    if (td or 0) * direcao > 0:
        itens.append("diario")
    # 4. rejeicao no candle do sinal
    amp = h[i] - l[i]
    if amp > 0:
        if direcao > 0:
            rej = (min(o[i], c[i]) - l[i]) / amp >= 0.35 or (c[i] - l[i]) / amp >= 0.7
        else:
            rej = (h[i] - max(o[i], c[i])) / amp >= 0.35 or (h[i] - c[i]) / amp >= 0.7
        if rej:
            itens.append("rejeicao")
    n = len(itens)
    return dict(nota=NOTAS[n], pontos=n, itens=itens, espaco=None if espaco is None else round(espaco, 2))


def passa(nota_txt, minima):
    """minima: "" (todas), "B" (B, A e A+), "A" (A e A+) ou "A+"."""
    if not minima:
        return True
    return ORDEM.get(nota_txt, 0) >= ORDEM.get(minima, 0)
