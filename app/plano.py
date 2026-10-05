# -*- coding: utf-8 -*-
"""
PLANO DE TRADE: meta x realidade.

A partir das operacoes que a estrategia REALMENTE fez no periodo escolhido (com o tamanho e as regras do plano), responde:

  * o que e provavel num mes: sorteio de dias inteiros do proprio historico (com reposicao), milhares de vezes
    (dias sem operacao entram como zero; sortear o dia inteiro preserva as sequencias de ganho e perda do mesmo dia);
  * a chance de bater a meta do mes e a chance de passar pela perda maxima que a pessoa diz aceitar;
  * o tamanho que seria preciso para a meta virar o resultado medio, e a queda que viria junto;
  * a vantagem por operacao com a margem de erro (se a margem inclui zero, a vantagem NAO esta comprovada);
  * o teto de risco de Kelly, usado so como FREIO: e a fracao do capital por operacao acima da qual o capital encolhe
    mesmo com vantagem. Calculado com a vantagem no piso da margem de erro (conservador): sem vantagem comprovada = zero;
  * risco de ruina: a chance de um dia perder metade do capital mantendo o risco atual.

Tudo isso e estatistica do passado, nao promessa: com poucas operacoes a margem de erro e enorme (o aviso vai junto).
"""
import math
import random


def _q(x, p):
    return x[min(len(x) - 1, max(0, int(p * len(x))))]


def projetar(trades, dias_do_periodo, d_sai, capital, meta_mes=0.0, queda_max=0.0, dias_mes=21, caminhos=4000, semente=11):
    """trades = operacoes fechadas; dias_do_periodo = lista dos dias (AAAAMMDD) simulados; d_sai(i) = dia do candle i."""
    dias = sorted(set(dias_do_periodo))
    por_dia = {x: 0.0 for x in dias}
    for t in trades:
        por_dia[d_sai(t["i_sai"])] = por_dia.get(d_sai(t["i_sai"]), 0.0) + t["dinheiro"]
    serie = [por_dia[x] for x in sorted(por_dia)]
    n_d, n = len(serie), len(trades)
    out = dict(dias=n_d, ops=n, diasMes=dias_mes, metaMes=meta_mes, quedaMax=queda_max, capital=capital)
    if n_d < 20 or n < 20:
        out.update(vazio=True)                  # periodo curto demais: projetar um mes com poucos dias seria enganar
        return out
    media_d = sum(serie) / n_d
    rnd = random.Random(semente)
    finais, quedas = [], []
    bateu = caiu = 0
    for _ in range(caminhos):
        eq = pico = dd = 0.0
        for _k in range(dias_mes):
            eq += serie[rnd.randrange(n_d)]
            if eq > pico:
                pico = eq
            if pico - eq > dd:
                dd = pico - eq
        finais.append(eq)
        quedas.append(dd)
        if meta_mes > 0 and eq >= meta_mes:
            bateu += 1
        if queda_max > 0 and dd >= queda_max:
            caiu += 1
    finais.sort()
    quedas.sort()
    out.update(mediaDia=media_d, mediaMes=media_d * dias_mes, p10=_q(finais, 0.10), p50=_q(finais, 0.50), p90=_q(finais, 0.90),
               chanceNegativo=100.0 * sum(1 for v in finais if v < 0) / caminhos,
               chanceMeta=(100.0 * bateu / caminhos) if meta_mes > 0 else None,
               chanceQueda=(100.0 * caiu / caminhos) if queda_max > 0 else None,
               quedaP50=_q(quedas, 0.50), quedaP90=_q(quedas, 0.90),
               diasPositivos=100.0 * sum(1 for v in serie if v > 0) / n_d, diasComOperacao=sum(1 for v in serie if v != 0))
    # tamanho necessario para a meta virar o resultado MEDIO de um mes
    if meta_mes > 0:
        if media_d > 0:
            k = meta_mes / (media_d * dias_mes)
            out.update(fatorMeta=k, quedaNaMeta=_q(quedas, 0.90) * k)
        else:
            out.update(fatorMeta=None)
    # Kelly e risco de ruina (em R = resultado / risco de cada operacao)
    Rs = [t["R"] for t in trades]
    gan = [r for r in Rs if r > 0]
    per = [-r for r in Rs if r <= 0]
    w = len(gan) / float(n)
    mg = sum(gan) / len(gan) if gan else 0.0
    mp = sum(per) / len(per) if per else 0.0
    mu = sum(Rs) / n
    var = sum((r - mu) ** 2 for r in Rs) / (n - 1) if n > 1 else 0.0
    erro = 1.96 * math.sqrt(var / n) if n > 1 else None               # margem de erro (95%) da media em R
    piso = mu - erro if erro is not None else None
    # Kelly continuo: fracao do capital a arriscar por operacao = media / variancia (em R). "Teto" = com a media no piso
    kelly = (mu / var) if (var > 0 and mu > 0) else 0.0
    teto = (piso / var) if (var > 0 and piso is not None and piso > 0) else 0.0
    riscos = [abs(t["dinheiro"] / t["R"]) for t in trades if t["R"] and t["dinheiro"]]
    risco_medio = sum(riscos) / len(riscos) if riscos else 0.0
    f = risco_medio / capital if capital > 0 else 0.0                 # fracao do capital arriscada por operacao hoje
    if mu <= 0 or var <= 0 or f <= 0:
        ruina = 100.0 if mu <= 0 else None
    else:
        ruina = 100.0 * math.exp(-2.0 * mu * (0.5 / f) / var)         # chance de um dia perder metade do capital (aproximacao)
    out.update(acerto=100.0 * w, ganhoMedioR=mg, perdaMediaR=mp, mediaR=mu, erroR=erro, comprovada=bool(piso is not None and piso > 0),
               kelly=100.0 * kelly, kellyTeto=100.0 * teto,
               riscoMedio=risco_medio, riscoPctAtual=100.0 * f, ruinaMetade=ruina, poucasOps=n < 30)
    return out
