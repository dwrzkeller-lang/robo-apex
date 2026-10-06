# -*- coding: utf-8 -*-
"""
Relatorio do ROBO APEX no terminal: as 6 estrategias + TODAS juntas, com o mesmo simulador do programa.

Uso:
  python ferramentas/backtest.py                       (WIN e WDO, 5 min)
  python ferramentas/backtest.py EURUSD OURO --tf 60
  python ferramentas/backtest.py WIN --tf 1440 --gestao conducao --contratos 2
  python ferramentas/backtest.py CSV:WINZ26.csv        (arquivo exportado do Profit na pasta dados)
"""
import os
import sys

APP = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "app"))
BASE = os.path.dirname(APP)
sys.path.insert(0, APP)
import dados_fonte as df                                   # noqa: E402
from estrategias import ESTRATEGIAS                        # noqa: E402
from simulador import estatisticas, preparar, simular      # noqa: E402


def relatorio(chave, tf, gestao, contratos):
    if chave.startswith("CSV:"):
        B, fonte, cfg = df.carregar_csv(BASE, chave[4:])
        tf = B["tf"]
    else:
        cfg = df.ATIVOS[chave]
        B, fonte = df.carregar_yahoo(BASE, chave, tf)
    sc = df.sessao_cfg(cfg)
    Gs = preparar(B, sc)
    m = cfg.get("moeda", "R$")
    print("\n== %s | %s | %d candles, %d dias | gestao %s | %g contrato(s)" % (cfg["nome"], fonte, len(B["c"]), len(set(B["d"])), gestao, contratos))
    print("   %-36s %5s %7s %7s %11s %13s %12s  %s" % ("estrategia", "ops", "acerto", "empate", "media/op", "resultado", "pior queda", "veredito"))
    for cod in list(ESTRATEGIAS) + ["TODAS"]:
        cods = list(ESTRATEGIAS) if cod == "TODAS" else [cod]
        r = simular(Gs, sc, cods, gestao=gestao, contratos=contratos, juntas=cod == "TODAS")
        st = estatisticas(r["trades"], 10000.0, lambda i: B["d"][i])
        nome = "TODAS juntas" if cod == "TODAS" else "%s %s" % (cod, ESTRATEGIAS[cod]["nome"])
        if not st["n"]:
            print("   %-36s %5d" % (nome, 0))
            continue
        print("   %-36s %5d %6.1f%% %6.1f%% %s%9.2f %s%11.2f %s%10.2f  %s" % (
            nome[:36], st["n"], st["acerto"], st["empate"] or 0, m, st["mediaDin"], m, st["total"], m, st["ddMax"], st["veredito"]))


if __name__ == "__main__":
    args = sys.argv[1:]
    op = {"--tf": "5", "--gestao": "padrao", "--contratos": "1"}
    for k in list(op):
        if k in args:
            i = args.index(k)
            op[k] = args[i + 1]
            del args[i:i + 2]
    for a in (args or ["WIN", "WDO"]):
        relatorio(a, int(op["--tf"]), op["--gestao"], float(op["--contratos"]))
