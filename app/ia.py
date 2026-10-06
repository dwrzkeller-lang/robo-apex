# -*- coding: utf-8 -*-
"""
ROBO APEX - IA: aprende com as operacoes ja feitas e estima a chance de uma entrada nova dar certo.

Como funciona (sem biblioteca externa):
  1. No candle de cada sinal o simulador tira um RETRATO do momento (`caracteristicas`): tamanho do stop em ATR,
     custo em R, a favor ou contra o diario, movimento limpo ou em serrote, distancia das medias e da VWAP, IFR,
     volume, tamanho do candle, hora do pregao, volatilidade, relacao alvo/risco, profundidade da correcao.
     O retrato so usa candles ja fechados: nao olha o futuro.
  2. Um modelo simples (regressao logistica com regularizacao) aprende, com as operacoes encerradas, quais retratos
     terminaram em ganho. Ele e reavaliado SEMPRE fora da amostra (treina no passado, preve o trecho seguinte), e a tela
     mostra essa nota: se a IA nao acerta mais que o acaso, ela diz isso.
  3. Cada operacao nova entra na conta: o modelo e refeito quando chegam operacoes novas.
"""
import math
import random

NOMES = ("risco_atr", "custo_r", "ctx", "er", "d_mm20", "d_mm200", "incl20", "d_vwap", "ifr9", "vol_rel", "amp",
         "hora", "atr_rel", "alvo_r", "ret")
ROTULOS = {
    "risco_atr": "tamanho do stop (em ATR)", "custo_r": "custo em relação ao risco", "ctx": "tendência do diário",
    "er": "movimento limpo (eficiência)", "d_mm20": "distância da MM20", "d_mm200": "distância da MM200",
    "incl20": "inclinação da MM20", "d_vwap": "distância da VWAP", "ifr9": "IFR(9)", "vol_rel": "volume do candle de sinal",
    "amp": "tamanho do candle de sinal", "hora": "hora do pregão", "atr_rel": "volatilidade em relação ao normal",
    "alvo_r": "relação alvo/risco", "ret": "profundidade da correção",
}


def _lim(x, lo, hi):
    return lo if x < lo else hi if x > hi else x


def caracteristicas(Gd, G, i, od, ref, cfg):
    """Retrato do momento do sinal, no sentido da operacao (Gd = grafico do lado da ordem: na venda ele e invertido,
    entao "acima da media" quer sempre dizer "a favor"). Devolve a lista na ordem de NOMES, ou None sem ATR."""
    a = Gd.atr[i]
    if not a or a <= 0:
        return None
    sg = od["dir"]
    c = Gd.c[i]
    risco = abs(ref - od["stop"])
    if risco <= 0:
        return None
    vp = cfg["valor_ponto"]
    custo_pts = 2.0 * cfg["slip"] + 2.0 * cfg["custo"] / vp + 2.0 * cfg.get("custo_pct", 0.0) * abs(ref)
    mm20, mm200 = Gd.mm20[i], Gd.mm200[i]
    ant = Gd.mm20[i - 5] if i >= 5 else None
    vw = Gd.vw[i] if Gd.vw else None
    v = Gd.v
    base_v = [x for x in v[max(0, i - 20):i] if x]
    vol_rel = (v[i] / (sum(base_v) / len(base_v))) if (base_v and v[i]) else 1.0
    atrs = [x for x in Gd.atr[max(0, i - 100):i] if x]
    atr_rel = a / (sum(atrs) / len(atrs)) if atrs else 1.0
    if Gd.intraday:
        ini, fim = cfg["hora_inicio"], cfg["hora_zeragem"]
        m0, m1 = ini // 100 * 60 + ini % 100, fim // 100 * 60 + fim % 100
        hm = Gd.hm[i]
        hora = _lim((hm // 100 * 60 + hm % 100 - m0) / max(1.0, m1 - m0), 0.0, 1.0)
    else:
        hora = 0.5
    alvo = od.get("alvo")
    alvo_r = _lim(abs(alvo - ref) / risco, 0.0, 12.0) if alvo is not None else 0.0
    ret = od.get("ret")
    r9 = Gd.rsi9[i]
    f = (_lim(risco / a, 0.0, 8.0), _lim(custo_pts / risco, 0.0, 3.0), float(od.get("ctx", 0)), G.er[i],
         _lim((c - mm20) / a, -8.0, 8.0) if mm20 is not None else 0.0,
         _lim((c - mm200) / a, -15.0, 15.0) if mm200 is not None else 0.0,
         _lim((mm20 - ant) / a, -4.0, 4.0) if (mm20 is not None and ant is not None) else 0.0,
         _lim((c - vw) / a, -8.0, 8.0) if vw is not None else 0.0,
         (r9 if r9 is not None else 50.0) / 100.0, _lim(vol_rel, 0.0, 8.0), _lim((Gd.h[i] - Gd.l[i]) / a, 0.0, 8.0),
         hora, _lim(atr_rel, 0.0, 5.0), alvo_r, float(ret) if ret is not None else -1.0)
    return [round(x, 4) for x in f]


# ------------------------------------------------------------------------------------------ modelo
MIN_TREINO = 150           # operacoes encerradas para comecar a aprender
MAX_TREINO = 6000          # usa as mais recentes
EPOCAS, PASSO, L2 = 30, 0.05, 0.002
BLOCOS = 6                 # avaliacao fora da amostra: treina nos blocos anteriores, preve o seguinte
NOMES_MODELO = list(NOMES[:14]) + ["tem_ret", "ret"]


def _entrada(f, k_est, n_est):
    """Vetor do modelo: as leituras do retrato (a profundidade da correcao vira "tem/nao tem" + valor) + qual estrategia."""
    ret = f[14]
    x = list(f[:14]) + [1.0 if ret >= 0 else 0.0, ret if ret >= 0 else 0.45]
    est = [0.0] * n_est
    if 0 <= k_est < n_est:
        est[k_est] = 1.0
    return x, est


def _sig(z):
    if z < -30.0:
        return 1e-13
    if z > 30.0:
        return 1.0 - 1e-13
    return 1.0 / (1.0 + math.exp(-z))


def _medias(sel):
    g = [r for _, _, r in sel if r > 0]
    p = [r for _, _, r in sel if r <= 0]
    return (sum(g) / len(g) if g else None, sum(p) / len(p) if p else None, len(sel))


def treinar(amostras, cods, semente=11):
    """amostras = [(est, f, R)] em ordem de tempo. Devolve o modelo (dict so com numeros e listas) ou None."""
    dados = [(e, f, r) for e, f, r in amostras if f is not None][-MAX_TREINO:]
    if len(dados) < MIN_TREINO:
        return None
    idx = {c: k for k, c in enumerate(cods)}
    n_est = len(cods)
    X = [_entrada(f, idx.get(e, -1), n_est) for e, f, _ in dados]
    y = [1.0 if r > 0 else 0.0 for _, _, r in dados]
    nf = len(X[0][0])
    n = len(X)
    media = [sum(x[0][j] for x in X) / n for j in range(nf)]
    desvio = [(sum((x[0][j] - media[j]) ** 2 for x in X) / n) ** 0.5 or 1.0 for j in range(nf)]
    Z = [[(x[0][j] - media[j]) / desvio[j] for j in range(nf)] + x[1] for x in X]
    d = nf + n_est
    w = [0.0] * d
    base = sum(y) / n
    b = math.log(max(1e-6, base) / max(1e-6, 1.0 - base))
    ordem = list(range(n))
    rnd = random.Random(semente)
    soma_w, soma_b, passos = [0.0] * d, 0.0, 0
    mul = float.__mul__
    for ep in range(EPOCAS):
        rnd.shuffle(ordem)
        lr = PASSO / (1.0 + 0.15 * ep)
        k = 1.0 - lr * L2
        for i in ordem:
            z = Z[i]
            g = lr * (_sig(b + sum(map(mul, w, z))) - y[i])
            w = [wj * k - g * zj for wj, zj in zip(w, z)]
            b -= g
        if ep >= EPOCAS // 2:                                  # media dos pesos da 2a metade: resultado mais estavel
            soma_w = [a + c for a, c in zip(soma_w, w)]
            soma_b += b
            passos += 1
    w = [a / passos for a in soma_w]
    b = soma_b / passos
    # ganho medio e perda media por estrategia (para o valor esperado), com o geral de reserva
    geral = _medias(dados)
    por_est = {}
    for c in cods:
        m = _medias([x for x in dados if x[0] == c])
        por_est[c] = dict(ganho=m[0] if m[0] is not None and m[2] >= 20 else geral[0],
                          perda=m[1] if m[1] is not None and m[2] >= 20 else geral[1], n=m[2])
    return dict(w=w, b=b, media=media, desvio=desvio, cods=list(cods), n=n, base=base, por_est=por_est,
                ganho=geral[0] or 0.0, perda=geral[1] or 0.0)


def prever(modelo, est, f):
    """(chance de ganho, valor esperado em R) para um sinal com o retrato f; None sem modelo ou sem retrato."""
    if not modelo or f is None:
        return None
    cods = modelo["cods"]
    x, e = _entrada(f, cods.index(est) if est in cods else -1, len(cods))
    z = [(x[j] - modelo["media"][j]) / modelo["desvio"][j] for j in range(len(x))] + e
    p = _sig(modelo["b"] + sum(map(float.__mul__, modelo["w"], z)))
    pe = modelo["por_est"].get(est) or {}
    g = pe.get("ganho") if pe.get("ganho") is not None else modelo["ganho"]
    pd = pe.get("perda") if pe.get("perda") is not None else modelo["perda"]
    return p, p * (g or 0.0) + (1.0 - p) * (pd or 0.0)


def _auc(pares):
    """Chance de a IA dar nota maior para uma operacao que ganhou do que para uma que perdeu (0,5 = acaso)."""
    pares = sorted(pares, key=lambda x: x[0])
    n1 = sum(1 for _, y in pares if y)
    n0 = len(pares) - n1
    if not n1 or not n0:
        return None
    soma, i = 0.0, 0
    while i < len(pares):                                      # postos medios para empates
        j = i
        while j < len(pares) and pares[j][0] == pares[i][0]:
            j += 1
        posto = (i + j + 1) / 2.0
        soma += posto * sum(1 for k in range(i, j) if pares[k][1])
        i = j
    return (soma - n1 * (n1 + 1) / 2.0) / (n1 * n0)


def _t(a, b):
    """t de Welch da diferenca de medias entre duas listas."""
    if len(a) < 2 or len(b) < 2:
        return 0.0
    ma, mb = sum(a) / len(a), sum(b) / len(b)
    va = sum((x - ma) ** 2 for x in a) / (len(a) - 1)
    vb = sum((x - mb) ** 2 for x in b) / (len(b) - 1)
    den = (va / len(a) + vb / len(b)) ** 0.5
    return (ma - mb) / den if den > 0 else 0.0


def _media(x):
    return sum(x) / len(x) if x else None


def _dif_tercos(sel):
    """Media do terco com as maiores notas menos a do terco com as menores."""
    o = sorted(sel, key=lambda x: x[0][0])
    k = len(o) // 3
    return ((_media([r for _, r in o[-k:]]) or 0.0) - (_media([r for _, r in o[:k]]) or 0.0)) if k else 0.0


def avaliar_fora(amostras, cods, tempos=None):
    """Nota honesta da IA: para cada bloco de tempo, treina SO com o que veio antes e preve o bloco. Devolve
    (resumo, previsoes), com previsoes[i] = (chance, valor esperado) da operacao i quando ela ainda era futuro (ou None).
    tempos[i] = (horario do sinal, horario da saida) da operacao i: com ele, o treino de cada bloco usa so operacoes que
    ja tinham SAIDO antes do primeiro sinal do bloco (o resultado delas ja era conhecido), e o resumo traz os modelos de
    cada bloco em "blocos" = [(horario em que o bloco comeca, modelo)], para dar nota a qualquer sinal daquele trecho."""
    dados = [(k, e, f, r) for k, (e, f, r) in enumerate(amostras) if f is not None]
    prev = [None] * len(amostras)
    n = len(dados)
    if n < MIN_TREINO + 60:
        return None, prev
    corte = [n * q // BLOCOS for q in range(BLOCOS + 1)]
    blocos = []
    for q in range(2, BLOCOS):
        if tempos:
            t0 = tempos[dados[corte[q]][0]][0]
            treino = [(e, f, r) for k, e, f, r in dados[:corte[q]] if tempos[k][1] < t0]
        else:
            t0, treino = None, [(e, f, r) for _, e, f, r in dados[:corte[q]]]
        m = treinar(treino, cods) if len(treino) >= MIN_TREINO else None
        if not m:
            continue
        if tempos:
            blocos.append((t0, m))
        for k, e, f, r in dados[corte[q]:corte[q + 1]]:
            prev[k] = prever(m, e, f)
    fora = [(prev[k], r) for k, _, _, r in dados if prev[k] is not None]
    if len(fora) < 60:
        return None, prev
    todas = [r for _, r in fora]
    favor = [r for (p, ev), r in fora if ev > 0]
    contra = [r for (p, ev), r in fora if ev <= 0]
    # tercos pela nota da IA: se ela sabe algo, o terco de cima rende mais que o de baixo
    ordenadas = sorted(fora, key=lambda x: x[0][0])
    t3 = len(ordenadas) // 3
    baixo, alto = [r for _, r in ordenadas[:t3]], [r for _, r in ordenadas[-t3:]]
    auc = _auc([(p, r > 0) for (p, _), r in fora])
    tt = _t(alto, baixo)
    meio = len(fora) // 2
    d1, d2 = _dif_tercos(fora[:meio]), _dif_tercos(fora[meio:])    # a nota tem de se repetir nas duas metades
    comprovada = bool(tt >= 2.0 and d1 > 0 and d2 > 0 and auc is not None and auc > 0.52)
    return dict(n=len(fora), auc=auc, t=tt, comprovada=comprovada, metades=[d1, d2], blocos=blocos,
                todas=dict(n=len(todas), mediaR=_media(todas), acerto=100.0 * sum(1 for r in todas if r > 0) / len(todas)),
                favor=dict(n=len(favor), mediaR=_media(favor), acerto=100.0 * sum(1 for r in favor if r > 0) / len(favor) if favor else None),
                contra=dict(n=len(contra), mediaR=_media(contra)),
                alto=dict(n=len(alto), mediaR=_media(alto)), baixo=dict(n=len(baixo), mediaR=_media(baixo))), prev


# ------------------------------------------------------------------------------------------ licoes (o que os dados ensinaram)
FAIXAS = {
    "ctx": [(-1.5, -0.5, "contra a tendência do diário"), (-0.5, 0.5, "com o diário sem tendência"), (0.5, 1.5, "a favor da tendência do diário")],
    "hora": [(-0.1, 0.34, "no começo do pregão"), (0.34, 0.67, "no meio do pregão"), (0.67, 1.1, "no fim do pregão")],
}
TEXTO_FAIXA = {
    "risco_atr": ("com stop curto", "com stop de tamanho médio", "com stop largo"),
    "custo_r": ("com custo baixo em relação ao risco", "com custo médio em relação ao risco", "com custo alto em relação ao risco"),
    "er": ("com o mercado em serrote", "com movimento mais ou menos limpo", "com movimento limpo"),
    "d_mm20": ("perto ou contra a MM20", "a uma distância média da MM20", "esticado em relação à MM20"),
    "d_mm200": ("perto ou contra a MM200", "a uma distância média da MM200", "longe da MM200, a favor"),
    "incl20": ("com a MM20 quase plana ou contra", "com a MM20 inclinada", "com a MM20 muito inclinada a favor"),
    "d_vwap": ("abaixo ou colado na VWAP", "um pouco acima da VWAP", "esticado em relação à VWAP"),
    "ifr9": ("com o IFR(9) baixo", "com o IFR(9) no meio", "com o IFR(9) alto"),
    "vol_rel": ("com volume fraco no candle de sinal", "com volume normal no candle de sinal", "com volume forte no candle de sinal"),
    "amp": ("com candle de sinal pequeno", "com candle de sinal médio", "com candle de sinal grande"),
    "atr_rel": ("com volatilidade abaixo do normal", "com volatilidade normal", "com volatilidade acima do normal"),
    "alvo_r": ("com alvo curto em relação ao risco", "com alvo médio em relação ao risco", "com alvo longo em relação ao risco"),
}


def licoes(amostras, maximo=5):
    """Leituras em que o resultado foi claramente diferente (|t| >= 3, pelo menos 40 operacoes de cada lado) E a diferenca
    apareceu com o mesmo sinal nas duas metades do periodo. O criterio e duro de proposito: sao 14 leituras em 3 faixas
    cada, e com |t| >= 2 apareciam uma ou duas "licoes" por puro acaso em dados sem padrao nenhum."""
    dados = [(f, r) for _, f, r in amostras if f is not None]
    n = len(dados)
    out = []
    if n < 120:
        return out
    meio = n // 2
    for j, nome in enumerate(NOMES):
        if nome == "ret":
            continue
        if nome in FAIXAS:
            grupos = [([k for k in range(n) if lo < dados[k][0][j] <= hi], txt) for lo, hi, txt in FAIXAS[nome]]
        else:
            ordem = sorted(range(n), key=lambda k: dados[k][0][j])
            if dados[ordem[0]][0][j] == dados[ordem[-1]][0][j]:
                continue
            t3 = n // 3
            tx = TEXTO_FAIXA[nome]
            grupos = [(ordem[:t3], tx[0]), (ordem[t3:n - t3], tx[1]), (ordem[n - t3:], tx[2])]
        for ks, txt in grupos:
            if len(ks) < 40 or n - len(ks) < 40:
                continue
            dentro = set(ks)
            a = [dados[k][1] for k in ks]
            b = [dados[k][1] for k in range(n) if k not in dentro]
            t = _t(a, b)
            if abs(t) < 3.0:
                continue
            ma, mb = sum(a) / len(a), sum(b) / len(b)
            difs = []
            for lo, hi in ((0, meio), (meio, n)):
                x = [dados[k][1] for k in ks if lo <= k < hi]
                y = [dados[k][1] for k in range(lo, hi) if k not in dentro]
                difs.append((sum(x) / len(x) - sum(y) / len(y)) if x and y else 0.0)
            if difs[0] * difs[1] <= 0 or (ma - mb) * difs[0] <= 0:
                continue                                       # nao se repetiu nas duas metades: pode ser acaso
            out.append(dict(leitura=nome, rotulo=ROTULOS[nome], quando=txt, n=len(a), mediaR=ma, restoR=mb, t=t,
                            acerto=100.0 * sum(1 for r in a if r > 0) / len(a), melhor=ma > mb))
    out.sort(key=lambda x: -abs(x["t"]))
    vistos, final = set(), []
    for x in out:                                              # uma licao por leitura (a mais forte)
        if x["leitura"] not in vistos:
            vistos.add(x["leitura"])
            final.append(x)
    return final[:maximo]


def erros_e_acertos(trades, h, l, espera=40):
    """O que deu errado e poderia ter dado certo (olhando DEPOIS, so para aprender): stops em que o preco depois foi
    ate o alvo, operacoes que chegaram a +1R e terminaram em perda, e ganhos em que o preco andou mais 1R depois da saida.
    h, l = maximas e minimas dos candles (precos reais)."""
    n = len(h)
    stops = voltaram = viraram = perdas = ganhos = correu = 0
    for t in trades:
        d, risco, sai = t["dir"], t["risco"], t["i_sai"]
        if not risco or risco <= 0:
            continue
        if t["R"] <= 0:
            perdas += 1
            if (t.get("maxR") or 0) >= 1.0:
                viraram += 1
            if str(t.get("motivo", "")).startswith("stop") and t.get("alvo") is not None:
                stops += 1
                alvo, pior = t["alvo"], t["stop"] - d * risco      # mais 1R contra depois do stop = a operacao estava errada
                for k in range(sai + 1, min(n, sai + 1 + espera)):
                    if (l[k] <= pior) if d > 0 else (h[k] >= pior):
                        break
                    if (h[k] >= alvo) if d > 0 else (l[k] <= alvo):
                        voltaram += 1
                        break
        else:
            ganhos += 1
            alem = t["sai"] + d * risco
            for k in range(sai + 1, min(n, sai + 1 + espera)):
                if (l[k] <= t["ent"]) if d > 0 else (h[k] >= t["ent"]):
                    break
                if (h[k] >= alem) if d > 0 else (l[k] <= alem):
                    correu += 1
                    break
    return dict(perdas=perdas, ganhos=ganhos, stops=stops, stopsVoltaram=voltaram, viraramPerda=viraram, ganhosCorreram=correu, espera=espera)


def pesos_do_modelo(modelo, maximo=6):
    """As leituras que mais pesam na nota (peso > 0 = quanto maior a leitura, maior a chance de ganho)."""
    if not modelo:
        return []
    itens = [(NOMES_MODELO[j], modelo["w"][j]) for j in range(len(NOMES_MODELO)) if NOMES_MODELO[j] != "tem_ret"]
    itens.sort(key=lambda x: -abs(x[1]))
    return [dict(leitura=nm, rotulo=ROTULOS.get(nm, nm), peso=round(w, 3)) for nm, w in itens[:maximo] if abs(w) >= 0.03]


def explicar(modelo, est, f, maximo=3):
    """Para UM sinal: as leituras que mais empurraram a nota para cima (+) e para baixo (-)."""
    if not modelo or f is None:
        return []
    cods = modelo["cods"]
    x, _ = _entrada(f, cods.index(est) if est in cods else -1, len(cods))
    contrib = [(NOMES_MODELO[j], modelo["w"][j] * (x[j] - modelo["media"][j]) / modelo["desvio"][j])
               for j in range(len(x)) if NOMES_MODELO[j] != "tem_ret"]
    contrib.sort(key=lambda c: -abs(c[1]))
    return [dict(leitura=nm, rotulo=ROTULOS.get(nm, nm), efeito=round(v, 3)) for nm, v in contrib[:maximo] if abs(v) >= 0.05]
