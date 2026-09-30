# -*- coding: utf-8 -*-
"""
"RODAR ROBO": qual estrategia mais se encaixa no mercado de AGORA num ativo, em qual tempo grafico, e quanto
ela pode ganhar/perder daqui para frente.

  * Roda cada estrategia sozinha em 5, 15 e 60 min com toda a base (ate 5 meses).
  * "Encaixe agora" = resultado medio por dia nos ultimos 20 pregoes, puxado para a media do periodo todo
    (com poucas operacoes recentes, vale mais o historico: evita escolher por sorte de uma semana).
  * So recomenda estrategia com historico positivo e pelo menos 20 operacoes. Se nenhuma passar, diz isso.
  * Projecao: Monte Carlo (3.000 caminhos) sorteando operacoes reais da propria estrategia, no ritmo de
    operacoes por dia que ela teve: proximo mes (21 pregoes) e ate 31/12.
"""
import random
from datetime import date, timedelta

from estrategias import ESTRATEGIAS
from simulador import estatisticas, preparar, simular

DIAS_RECENTES = 20
K_ENCOLHE = 15          # quantas operacoes o historico "vale" na media ponderada
TEMPOS_RADAR = (5, 15, 60)


def _pregoes_ate_fim_do_ano(hoje, todo_dia=False):
    fim, d, n = date(hoje.year, 12, 31), hoje + timedelta(days=1), 0
    while d <= fim:
        if todo_dia or d.weekday() < 5:
            n += 1
        d += timedelta(days=1)
    return n


def projecao(valores, ops_por_dia, dias, caminhos=3000, semente=7):
    if not valores or ops_por_dia <= 0 or dias <= 0:
        return None
    rnd = random.Random(semente)
    n_ops = max(1, int(round(ops_por_dia * dias)))
    finais, piores = [], []
    for _ in range(caminhos):
        eq = pico = dd = 0.0
        for _k in range(n_ops):
            eq += valores[rnd.randrange(len(valores))]
            pico = max(pico, eq)
            dd = max(dd, pico - eq)
        finais.append(eq)
        piores.append(dd)
    finais.sort()
    piores.sort()
    q = lambda x, p: x[min(len(x) - 1, int(p * len(x)))]          # noqa: E731
    return dict(ops=n_ops, dias=dias, p10=q(finais, 0.10), p50=q(finais, 0.50), p90=q(finais, 0.90),
                chancePerda=100.0 * sum(1 for v in finais if v < 0) / len(finais), quedaP90=q(piores, 0.90))


def _medir(trades, d, capital):
    dias_todos = sorted(set(d))
    corte = dias_todos[-DIAS_RECENTES] if len(dias_todos) >= DIAS_RECENTES else dias_todos[0]
    rec = [t for t in trades if d[t["i_ent"]] >= corte]
    st = estatisticas(trades, capital, lambda i: d[i])
    n, nr = len(trades), len(rec)
    media = st.get("mediaDin") or 0.0
    media_rec = sum(t["dinheiro"] for t in rec) / nr if nr else 0.0
    ops_dia = n / max(1, len(dias_todos))
    media_mista = (nr * media_rec + K_ENCOLHE * media) / (nr + K_ENCOLHE) if (nr + K_ENCOLHE) else 0.0
    return dict(n=n, acerto=st.get("acerto"), media=media, total=st.get("total", 0.0), veredito=st.get("veredito"),
                cor=st.get("cor"), explica=st.get("explica"), ddMax=st.get("ddMax"), dias=len(dias_todos),
                rec=dict(n=nr, total=sum(t["dinheiro"] for t in rec), acerto=100.0 * sum(1 for t in rec if t["R"] > 0) / nr if nr else None,
                         desde=corte),
                opsDia=ops_dia, encaixe=media_mista * ops_dia, valores=[t["dinheiro"] for t in trades])


def rodar(carregar, cfg_de, chave, gestao, contratos, capital, max_stops):
    """carregar(chave, tf) -> (B, fonte, cfg). Devolve o ranking e a projecao."""
    linhas, fontes = [], {}
    hoje = date.today()
    for tf in TEMPOS_RADAR:
        try:
            B, fonte, cfg = carregar(chave, tf)
        except Exception as e:
            fontes[tf] = "erro: %s" % e
            continue
        fontes[tf] = fonte
        sc = cfg_de(cfg)
        if not cfg.get("fracionado"):
            contratos_tf = max(1.0, round(contratos))
        else:
            contratos_tf = contratos
        Gs = preparar(B, sc)
        todo_dia = bool(cfg.get("fim_de_semana"))
        for cod in list(ESTRATEGIAS) + ["TODAS"]:
            cods = list(ESTRATEGIAS) if cod == "TODAS" else [cod]
            if cod != "TODAS" and ESTRATEGIAS[cod]["intraday"] and tf >= 1440:
                continue
            r = simular(Gs, sc, cods, gestao=gestao, contratos=contratos_tf, max_stops=max_stops, juntas=cod == "TODAS")
            m = _medir(r["trades"], B["d"], capital)
            m.update(est=cod, tf=tf, pregoesAno=_pregoes_ate_fim_do_ano(hoje, todo_dia), pregoesMes=30 if todo_dia else 21)
            linhas.append(m)
    # melhor tempo grafico de cada estrategia (pelo encaixe)
    melhor_tf = {}
    for m in linhas:
        if m["n"] >= 20 and (m["est"] not in melhor_tf or m["encaixe"] > melhor_tf[m["est"]]["encaixe"]):
            melhor_tf[m["est"]] = m
    aptas = [m for m in linhas if m["n"] >= 20 and m["media"] > 0 and m["encaixe"] > 0 and m["est"] != "TODAS"]
    aptas.sort(key=lambda m: -m["encaixe"])
    escolha = aptas[0] if aptas else None
    for m in linhas:
        # projecao so para o que aparece em destaque (melhor tempo de cada estrategia): e a conta mais pesada
        if melhor_tf.get(m["est"]) is m:
            m["proj1m"] = projecao(m["valores"], m["opsDia"], m["pregoesMes"], caminhos=1500)
            m["projAno"] = projecao(m["valores"], m["opsDia"], m["pregoesAno"], caminhos=1500)
        del m["valores"]
    if escolha:
        txt = ("%s em %d min: melhor resultado por dia nos últimos %d pregões, com histórico positivo em %d operações."
               % (ESTRATEGIAS[escolha["est"]]["nome"], escolha["tf"], DIAS_RECENTES, escolha["n"]))
    else:
        txt = ("Nenhuma estratégia tem histórico positivo com pelo menos 20 operações e bom momento neste ativo. "
               "O robô recomenda ficar de fora (ou testar outro ativo).")
    return dict(ativo=chave, gestao=gestao, contratos=contratos, capital=capital, fontes=fontes,
                linhas=linhas, escolha=None if not escolha else dict(est=escolha["est"], tf=escolha["tf"]),
                melhorTf={k: v["tf"] for k, v in melhor_tf.items()}, texto=txt, diasRecentes=DIAS_RECENTES)
