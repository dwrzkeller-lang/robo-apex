# -*- coding: utf-8 -*-
"""
ROBO APEX - simulador unico. Executa as ordens das estrategias candle a candle, sem olhar o futuro:

  * ordem stop: executa quando o preco passa do gatilho, pelo gatilho (ou pela abertura, se abrir alem dele)
    MAIS o escorregamento do ativo; ordem "a mercado na abertura": abertura + escorregamento;
  * se o preco vai ao stop antes de ativar a entrada, a ordem e cancelada; validade de 1 a 2 candles;
  * stop tocado -> sai no stop MENOS o escorregamento (abriu alem do stop -> sai na abertura);
  * alvo (ordem limitada) so conta se o preco passar 1 tick alem dele;
  * candle que toca stop e alvo ao mesmo tempo -> conta o STOP (sempre a hipotese pior);
  * saidas por fechamento (conducao pela MM9, saida do RSI-2) executam na abertura do candle seguinte;
  * intraday: sem entradas fora do horario, zeragem no horario do ativo, e o dia para apos N stops;
  * custo por contrato (corretagem/emolumentos) descontado; R e sempre LIQUIDO de custos;
  * ordem limitada (compra abaixo do preco): so executa se o preco passar 1 tick ALEM do limite, sem escorregamento;
  * trailing stop: o stop so anda no FECHAMENTO de cada candle (nunca no meio dele) e nunca volta;
  * ajustes feitos na mao num teste ao vivo valem do momento em que foram feitos em diante, nunca para tras.

Modo "TODAS juntas": uma operacao por vez; a primeira ordem de qualquer estrategia que executar vale e
as outras ordens pendentes sao canceladas.
"""
import bisect
import math

from estrategias import (AQUECIMENTO, ESTRATEGIAS, Grafico, atencao, avaliar, eficiencia, eficiencia_em, faixa_de_ruido,
                         passa_seletivo, tendencia_diaria)
from ia import caracteristicas

FOLGA_PCT = 0.00015        # folga atras do stop tecnico: 0,015% do preco (20 pontos com o indice em 130 mil)
TOL_FRAC = 0.20            # tolerancia extra de stop quando o sinal e a favor do diario e limpo
PROTECOES = {"folga": "Folga no stop (0,015% do preço atrás do stop técnico)", "tol": "Tolerância de +20% no stop em sinal forte",
             "corte": "Corte antecipado em meia perda quando volta contra com força", "forca": "Stop para −20% ou 0x0 quando perde força"}
TRAIL_ATR = 2.0            # trailing stop: distancia do stop ate o melhor preco, em ATR


def preparar(B, cfg):
    Gs = {1: Grafico(B, cfg["tick"], B["tf"]), -1: Grafico(B, cfg["tick"], B["tf"], espelho=True)}
    td, er = tendencia_diaria(B), eficiencia(B["c"])          # contexto: calculado uma vez, igual nos dois lados
    ruido = faixa_de_ruido(B) if B["tf"] < 1440 else None
    for g in Gs.values():
        g.tend_d, g.er, g.ruido = td, er, ruido
    return Gs


def atualizar_ultimo(Gs, B):
    """O candle aberto mudou (mesmos candles fechados): atualiza so ele nos dois lados, sem refazer os indicadores.
    So pode ser chamado por quem tem a trava de calculo: altera os graficos no lugar."""
    for g in Gs.values():
        g.atualizar_ultimo(B)
    Gs[1].er[len(B["c"]) - 1] = eficiencia_em(B["c"], len(B["c"]) - 1)        # a lista e a mesma nos dois lados


def gestao_de(cod, gestao):
    if gestao == "padrao":
        g = ESTRATEGIAS[cod]["gestao"]
        if g == "propria" and not ESTRATEGIAS[cod]["saida"]:
            g = "alvo2"
        return g
    return gestao


def alvos_da_gestao(g, ent, risco, alvos_ordem):
    """(alvo parcial, alvo final, rotulo, alvo do meio) no espaco da compra. alvos_ordem = alvos da propria estrategia.
    O alvo do meio so existe na gestao de 3 alvos (fibo3). Trailing e saida propria nao tem alvo."""
    if g == "alvo2":
        return None, ent + 2 * risco, "alvo 2:1", None
    if g == "alvo3":
        return None, ent + 3 * risco, "alvo 3:1", None
    if g == "alvo4":
        return None, ent + 4 * risco, "alvo 4:1", None
    if g == "alvo10":
        return None, ent + 10 * risco, "alvo 10:1", None
    if g == "parcial":
        return ent + risco, ent + 2 * risco, "alvo 2:1", None
    if g == "conducao":
        return ent + risco, None, "", None
    if g in ("esc3", "esc4"):
        # escalonada: alvo 1 = o primeiro alvo da estrategia (ou 1:1); na de 4 ha tambem o alvo 2 (ou 2:1).
        # O ultimo contrato nao tem alvo: segue com o stop no 0x0 e depois por trailing.
        t1 = alvos_ordem[0] if alvos_ordem and alvos_ordem[0] is not None and alvos_ordem[0] > ent else ent + risco
        t2 = None
        if g == "esc4":
            t2 = alvos_ordem[1] if alvos_ordem and len(alvos_ordem) > 1 and alvos_ordem[1] is not None and alvos_ordem[1] > t1 else max(t1 + risco, ent + 2 * risco)
        return t1, None, "", t2
    if g == "fixo" and alvos_ordem:
        return None, alvos_ordem[1], "alvo da estratégia", None
    if g == "fibo" and alvos_ordem:
        return alvos_ordem[0], alvos_ordem[1], "alvo Fibonacci 161,8%", None
    if g == "fibo3" and alvos_ordem and len(alvos_ordem) >= 3:
        return alvos_ordem[0], alvos_ordem[2], "alvo 3", alvos_ordem[1]
    return None, None, "", None


def simular(Gs, cfg, codigos, gestao="padrao", contratos=1.0, max_stops=2, juntas=False,
            i_ini=None, i_fim=None, com_atencao=False, i_formando=None, plano=None,
            tempos=None, ajustes=None, retomar=None, ponto=None):
    """i_formando = indice do candle que ainda nao fechou (ao vivo). Nele o preco ja negociado vale para executar
    ordem, stop e alvo, mas nenhuma decisao que depende do FECHAMENTO e tomada (sinal novo, saida por fechamento).

    plano (opcional) = regras do plano de trade:
      tam="risco", risco_pct, capital -> o tamanho de cada operacao e calculado para arriscar risco_pct% do capital
                                         daquele momento (capital inicial + resultado acumulado); se nem o lote minimo
                                         cabe no risco, a ordem e cancelada
      loss_dia, meta_dia (dinheiro)   -> intraday: para de abrir operacoes no dia depois de perder / ganhar esse valor
      seletivo=True                   -> filtro de contexto (estrategias.passa_seletivo): so a favor da tendencia do
                                         diario e, nas estrategias de correcao, so com tendencia limpa

    tempos + ajustes (teste ao vivo) = o que o usuario mudou na mao. Cada ajuste: dict(t=horario do candle em que foi
      feito, tipo, chave="EST|t_sinal|dir", ...). "stop"/"alvo" (valor) valem a partir do candle SEGUINTE; "sair" e
      "entrar" (preco, h, l = retrato do candle na hora do clique) e "cancelar" valem na hora.

    retomar / ponto = retomada: `ponto` pede um retrato do estado logo depois do candle `ponto` (vem em r["ponto"]);
      `retomar` continua de um retrato desses em vez de refazer o periodo inteiro. Quem chama garante que os candles
      ate ali nao mudaram."""
    G = Gs[1]
    n = G.n if i_fim is None else min(G.n, i_fim + 1)
    ini = max(AQUECIMENTO, i_ini or 0)
    tick, slip = cfg["tick"], cfg["slip"]
    vp, custo = cfg["valor_ponto"], cfg["custo"]
    custo_pts = 2.0 * custo / vp                     # custo de ida e volta em pontos de preco (por contrato)
    custo_pct = cfg.get("custo_pct", 0.0)            # taxa em % do valor negociado, por lado (cripto)
    fracionado, passo = cfg["fracionado"], cfg.get("passo_lote", 0.01)
    pl = plano or {}
    por_risco = pl.get("tam") == "risco" and (pl.get("risco_pct") or 0) > 0
    capital0 = float(pl.get("capital") or 0.0)
    loss_dia, meta_dia = float(pl.get("loss_dia") or 0.0), float(pl.get("meta_dia") or 0.0)
    seletivo = bool(pl.get("seletivo"))
    prot = set(pl.get("prot") or ())                 # protecoes do plano: folga, tol, corte, forca (ver PROTECOES)
    h_ini, h_fim, h_zer = cfg["hora_inicio"], cfg["hora_fim"], cfg["hora_zeragem"]
    d, hm = G.d, G.hm
    codigos = [c for c in codigos if not (ESTRATEGIAS[c]["intraday"] and not G.intraday)]
    if retomar:
        # continua de onde parou: copia o retrato (ele nao pode ser alterado) e religa as ordens pendentes na lista
        trades, ordens, aten = list(retomar["trades"]), list(retomar["ordens"]), dict(retomar["aten"])
        slots = []
        for c in retomar["slots"]:
            s = dict(c)
            if c["pos"]:
                s["pos"] = dict(c["pos"], G=Gs[c["pos"]["dir"]])
            s["pend"] = []
            for oc in c["pend"]:
                od = dict(oc)
                ordens[od["k"]] = od
                s["pend"].append(od)
            slots.append(s)
        i_loop = retomar["m"] + 1
    else:
        slots = [dict(nome="TODAS", cods=list(codigos))] if juntas else [dict(nome=c, cods=[c]) for c in codigos]
        for s in slots:
            s.update(pos=None, pend=[], stops=0, pnl=0.0, pnl_dia=0.0, trava=None)
        trades, ordens = [], []
        aten = {}
        i_loop = ini
    retrato = None
    # ajustes manuais por candle em que foram feitos
    aj_no = {}
    if ajustes and tempos:
        for a in ajustes:
            i0 = bisect.bisect_right(tempos, a["t"]) - 1
            if i0 >= ini:
                aj_no.setdefault(i0, []).append(a)

    def chave_de(x):                                 # mesma chave que a tela usa: estrategia | horario do sinal | lado
        return "%s|%d|%d" % (x["est"], tempos[x["i_sinal"]], x["dir"])

    def capturar(m):
        """Retrato do estado depois do candle m (para a proxima chamada continuar daqui)."""
        cs, novas = [], {}
        for s in slots:
            c = dict(s)
            if s["pos"]:
                c["pos"] = dict(s["pos"], G=None)
            c["pend"] = []
            for od in s["pend"]:
                oc = dict(od)
                novas[od["k"]] = oc
                c["pend"].append(oc)
            cs.append(c)
        oo = list(ordens)
        for k, oc in novas.items():
            oo[k] = oc
        return dict(m=m, slots=cs, trades=list(trades), ordens=oo, aten=dict(aten))

    # ------------------------------------------------------------------ helpers
    def frac_parcial(q):                             # metade no 1:1 (contrato inteiro: so com 2 ou mais)
        if fracionado:
            return 0.5
        return math.floor(q / 2) / q if q >= 2 else 0.0

    def fracs_3alvos(q):
        """(fatia no alvo 1, fatia no alvo 2) da gestao de 3 alvos; o resto vai ate o alvo 3. Contrato inteiro: um terco
        em cada alvo com 3 ou mais; com 2, um no alvo 1 e um ate o alvo 3; com 1 nao ha parcial (so o stop sobe)."""
        if fracionado:
            return 1.0 / 3.0, 1.0 / 3.0
        if q >= 3:
            t = math.floor(q / 3) / q
            return t, t
        return (0.5, 0.0) if q >= 2 else (0.0, 0.0)

    def fracs_esc(g, q):
        """Escalonada 3: dois tercos saem no alvo 1. Escalonada 4: metade no alvo 1 e um quarto no alvo 2. O resto e
        carregado. Com contrato inteiro so sai o que da para dividir (com 1 contrato nada sai: so o stop sobe)."""
        f1, f2 = (2.0 / 3.0, 0.0) if g == "esc3" else (0.5, 0.25)
        if fracionado:
            return f1, f2
        n1 = math.floor(q * f1 + 1e-9)
        n2 = math.floor(q * f2 + 1e-9)
        if n1 + n2 >= q:                                 # sempre sobra pelo menos 1 contrato para carregar
            n2 = max(0, q - n1 - 1)
            if n1 + n2 >= q:
                n1 = max(0, q - 1)
        return n1 / q, n2 / q

    def tamanho(s, preco, risco, custo_p):
        """Quantidade da operacao. Por risco: quanto cabe em risco_pct% do capital atual, arredondado para baixo."""
        if not por_risco:
            return contratos
        orcamento = max(0.0, capital0 + s["pnl"]) * pl["risco_pct"] / 100.0
        por_lote = (risco + custo_p) * vp            # perda de 1 lote se for stopado (com os custos)
        q = orcamento / por_lote if por_lote > 0 else 0.0
        if fracionado:
            return round(math.floor(q / passo + 1e-9) * passo, 8)
        return float(math.floor(q + 1e-9))

    def fechar(s, p, frac, preco, i, motivo, esc=0.0):
        frac = min(frac, p["frac"])
        if frac > 1e-12:
            p["pts"] += frac * (preco - p["ent"])
            p["esc"] += frac * esc
            p["frac"] -= frac
        p["motivo"] = motivo
        if p["frac"] > 1e-9:
            return
        sg = p["G"].sinal
        pts_liq = p["pts"] - p["custo_pts"]
        R = pts_liq / p["risco"]
        q = p["q"]
        din = pts_liq * vp * q
        t = dict(est=p["est"], dir=p["dir"], i_sinal=p["i_sinal"], i_ent=p["i_ent"], i_sai=i,
                 ent=sg * p["ent"], stop=sg * p["stop_ini"], alvo=None if p["alvo"] is None else sg * p["alvo"],
                 sai=sg * (p["ent"] + p["pts"]), motivo=motivo, gestao=p["gest"], parcial=p["parcial"],
                 risco=p["risco"], pts=pts_liq, R=R, maxR=(p["maxfav"] - p["ent"]) / p["risco"],
                 dinheiro=din, info=p["info"], q=q, custo=(p["custo_pts"] + p["esc"]) * vp * q, ctx=p["ctx"])
        if p["alvo1"] is not None or p["alvo2"] is not None:
            t.update(alvo1=None if p["alvo1"] is None else sg * p["alvo1"], alvo2=None if p["alvo2"] is None else sg * p["alvo2"])
        if p["f"] is not None:
            t["f"] = p["f"]
        if p["manual"]:
            t["manual"] = p["manual"]
        trades.append(t)
        s["pos"] = None
        s["pnl"] += din
        s["pnl_dia"] += din
        if R < 0:
            s["stops"] += 1
            if s["stops"] >= max_stops and G.intraday:
                cancelar(s, i, "limite de %d stops no dia" % max_stops)
        if G.intraday and not s["trava"]:
            if loss_dia > 0 and s["pnl_dia"] <= -loss_dia:
                s["trava"] = "limite de perda do dia"
            elif meta_dia > 0 and s["pnl_dia"] >= meta_dia:
                s["trava"] = "meta do dia batida"
            if s["trava"]:
                cancelar(s, i, s["trava"])

    def cancelar(s, i, motivo):
        for od in s["pend"]:
            od.update(status="cancelada", motivo=motivo, i_fim=i)
        s["pend"] = []

    def motivo_stop(p):
        if p["stop_manual"] is not None and abs(p["stop"] - p["stop_manual"]) < tick / 2:
            return "stop ajustado na mão"
        if p["stop"] > p["stop_ini"] + 1e-9:
            if abs(p["stop"] - p["ent"]) < tick / 2:
                return "stop no 0x0"
            if p["parcial2"] and p["alvo1"] is not None and abs(p["stop"] - p["alvo1"]) < tick / 2:
                return "stop no alvo 1"
            return "stop móvel"
        return "stop"

    def abrir(s, od, preco, i, esc_ent=None, manual=None):
        Gd = Gs[od["dir"]]
        stop_g = od["dir"] * od["stop"]
        risco = preco - stop_g
        g = gestao_de(od["est"], gestao)
        alvos_g = None if not od.get("alvos") else tuple(None if x is None else od["dir"] * x for x in od["alvos"])
        # os alvos saem do risco TECNICO (sem a folga/tolerancia do plano): alargar o stop nao empurra o alvo para longe
        alvo1, alvo, rot, alvo2 = alvos_da_gestao(g, preco, max(tick, risco - od.get("extra", 0.0)), alvos_g)
        if od.get("alvo_manual") is not None:               # alvo movido na mao antes da entrada: vira o alvo unico
            alvo, rot, alvo2 = od["dir"] * od["alvo_manual"], "alvo ajustado na mão", None
            if alvo1 is not None and alvo1 >= alvo:
                alvo1 = None
        if (g in ("fixo", "fibo", "fibo3") or od.get("alvo_manual") is not None) and (alvo is None or alvo <= preco + tick):
            od.update(status="cancelada", motivo="o preço já passou do alvo", i_fim=i)
            s["pend"].remove(od)
            return False
        if alvo1 is not None and alvo1 <= preco + tick:
            alvo1 = None                                    # abriu alem do alvo parcial: fica so o alvo final
        if alvo2 is not None and alvo2 <= preco + tick:
            alvo2 = None
        custo_p = custo_pts + 2.0 * custo_pct * abs(preco)
        q = tamanho(s, preco, risco, custo_p)
        if q <= 0:
            od.update(status="cancelada", motivo="risco acima do plano (o lote mínimo arrisca mais que %s%% do capital)"
                      % ("%g" % pl["risco_pct"]).replace(".", ","), i_fim=i)
            s["pend"].remove(od)
            return False
        if g in ("esc3", "esc4"):
            fp1, fp2 = fracs_esc(g, q)
        elif alvo2 is not None:                             # gestao de 3 alvos: um terco em cada um
            fp1, fp2 = fracs_3alvos(q)
        else:
            fp1, fp2 = frac_parcial(q), 0.0
        p = dict(est=od["est"], dir=od["dir"], G=Gd, ent=preco, stop=stop_g, stop_ini=stop_g, risco=risco,
                 alvo=alvo, alvo1=alvo1, rot=rot, gest=g, frac=1.0, pts=0.0,
                 parcial=False, i_sinal=od["i_sinal"], i_ent=i, sair=None, maxfav=preco, motivo="", info=od["info"],
                 q=q, custo_pts=custo_p, esc=slip if esc_ent is None else esc_ent, frac_parc=fp1, ctx=od.get("ctx", 0),
                 alvo2=alvo2, parcial2=False, frac_parc2=fp2, f=od.get("f"), manual=manual,
                 stop_manual=stop_g if od.get("stop_manual") else None)
        s["pos"] = p
        od.update(status="executada", i_fim=i, preco=od["dir"] * preco, q=q)
        for outra in s["pend"]:
            if outra is not od:
                outra.update(status="cancelada", motivo="outra ordem executou", i_fim=i)
        s["pend"] = []
        return True

    def processar_ordens(s, i):
        for od in list(s["pend"]):
            if i > od["i_sinal"] + od["validade"]:
                od.update(status="expirou", i_fim=i - 1)
                s["pend"].remove(od)
                continue
            Gd, sg = Gs[od["dir"]], od["dir"]
            stop_g = sg * od["stop"]
            esc_ent = None
            if od["tipo"] == "abertura":
                preco = Gd.o[i] + slip
            elif od["tipo"] == "limite":
                # compra limitada (abaixo do preco): so executa se o preco passar 1 tick ALEM do limite; sai pelo limite,
                # ou pela abertura se o candle ja abriu abaixo dele. Ordem limitada nao tem escorregamento.
                lim = sg * od["gatilho"]
                if Gd.l[i] > lim - tick:
                    continue
                preco, esc_ent = min(Gd.o[i], lim), 0.0
            else:
                gat = sg * od["gatilho"]
                if Gd.h[i] >= gat:
                    preco = max(Gd.o[i], gat) + slip
                elif Gd.l[i] <= stop_g:
                    od.update(status="cancelada", motivo="foi ao stop antes de ativar", i_fim=i)
                    s["pend"].remove(od)
                    continue
                else:
                    continue
            if preco - stop_g <= tick / 2:
                od.update(status="cancelada", motivo="abriu além do stop", i_fim=i)
                s["pend"].remove(od)
                continue
            if abrir(s, od, preco, i, esc_ent):
                return

    def gerir(s, p, i, ohlc=None, so_preco=False):
        """ohlc = pedaco do candle a considerar (ajuste manual no meio do candle); so_preco = sem as regras de fechamento."""
        Gp = p["G"]
        o, h, l, c = ohlc or (Gp.o[i], Gp.h[i], Gp.l[i], Gp.c[i])
        ent, R = p["ent"], p["risco"]
        na_entrada = p["i_ent"] == i
        if not na_entrada and o <= p["stop"]:
            return fechar(s, p, p["frac"], o - slip, i, motivo_stop(p) + " (abriu além)", slip)
        if l <= p["stop"]:
            return fechar(s, p, p["frac"], p["stop"] - slip, i, motivo_stop(p), slip)
        p["maxfav"] = max(p["maxfav"], h)
        g = p["gest"]
        if p["alvo1"] is not None and not p["parcial"] and h >= p["alvo1"] + tick:
            p["parcial"] = True
            if p["frac_parc"] > 0:
                fechar(s, p, p["frac_parc"], p["alvo1"], i, "parcial")
            p["stop"] = max(p["stop"], ent)
            if l <= ent:            # voltou ao 0x0 no mesmo candle: a ordem dos eventos e desconhecida -> pior caso
                return fechar(s, p, p["frac"], ent - slip, i, "stop no 0x0", slip)
        if p["alvo2"] is not None and not p["parcial2"] and h >= p["alvo2"] + tick:
            p["parcial2"] = True                            # alvo 2 de 3: mais um terco sai e o stop sobe para o alvo 1
            if p["frac_parc2"] > 0:
                fechar(s, p, p["frac_parc2"], p["alvo2"], i, "parcial no alvo 2")
            degrau = p["alvo1"] if p["alvo1"] is not None else ent
            p["stop"] = max(p["stop"], degrau)
            if l <= degrau:         # voltou ao alvo 1 no mesmo candle: a ordem dos eventos e desconhecida -> pior caso
                return fechar(s, p, p["frac"], degrau - slip, i, motivo_stop(p), slip)
        if p["alvo"] is not None:
            if not na_entrada and o >= p["alvo"]:
                return fechar(s, p, p["frac"], o, i, "alvo (abriu além)")
            if h >= p["alvo"] + tick:
                return fechar(s, p, p["frac"], p["alvo"], i, p["rot"] or "alvo")
        if i == i_formando or so_preco:
            return
        if prot and not p["sair"]:
            fraco = c < o and c < Gp.mm9[i] if Gp.mm9[i] is not None else False     # candle contra, fechando alem da MM9
            novo = None
            if "forca" in prot and fraco:
                # andou pelo menos 25% do caminho ate o alvo e perdeu forca: o stop vem para -20% do risco;
                # se ja tinha andado metade, vem para a entrada (0x0)
                dist = (p["alvo"] - ent) if p["alvo"] is not None else 2.0 * R
                if dist > 0 and p["maxfav"] - ent >= 0.25 * dist:
                    novo = ent if p["maxfav"] - ent >= 0.5 * dist else ent - 0.2 * R
            if "corte" in prot and novo is None and fraco and c < ent - 0.25 * R and (c - l) <= (h - l) / 3.0:
                novo = ent - 0.5 * R                       # voltou contra com forca logo depois da entrada: corta em meia perda
            if novo is not None:
                novo = Gp.abaixo(novo)
                if c <= novo:
                    p["sair"] = "saída antecipada (perdeu força)"
                elif novo > p["stop"]:
                    p["stop"] = novo
        if g == "trail_atr":                                # o stop acompanha o melhor preco a TRAIL_ATR x ATR, so sobe
            novo = Gp.abaixo(p["maxfav"] - TRAIL_ATR * Gp.atr[i])
            if novo > p["stop"]:
                p["stop"] = novo
        elif g == "trail_r":                                # degraus: a cada 1R a favor o stop sobe 1R (1R -> 0x0, 2R -> +1R...)
            k = math.floor((p["maxfav"] - ent) / R + 1e-9)
            if k >= 1:
                novo = Gp.abaixo(ent + (k - 1) * R)
                if novo > p["stop"]:
                    p["stop"] = novo
        elif g in ("esc3", "esc4") and p["parcial"]:        # depois do alvo 1 o que sobrou segue por trailing (2 ATR), nunca abaixo do 0x0
            novo = Gp.abaixo(p["maxfav"] - TRAIL_ATR * Gp.atr[i])
            if novo > p["stop"]:
                p["stop"] = novo
        elif g == "conducao" and p["parcial"]:
            if c < Gp.mm9[i] and Gp.mm9[i] > ent:
                p["sair"] = "fechou além da MM9 (condução)"
            elif p["maxfav"] - ent >= 3 * R:
                p["stop"] = max(p["stop"], Gp.abaixo(l - tick))       # acima de 3R: stop candle a candle
        elif g == "propria":
            m = ESTRATEGIAS[p["est"]]["saida"](Gp, i, p)
            if m:
                p["sair"] = m

    def no_espaco(sg, o, h, l, c):                    # precos reais -> espaco da compra (na venda o grafico e invertido)
        return (o, h, l, c) if sg > 0 else (-o, -l, -h, -c)

    def movidos(s, lista):
        """Stop/alvo movidos na mao no candle anterior: valem a partir deste candle."""
        for a in lista:
            if a["tipo"] not in ("stop", "alvo"):
                continue
            p = s["pos"]
            if p and chave_de(p) == a["chave"]:
                sg = p["G"].sinal
                if a["tipo"] == "stop":
                    p["stop"] = p["stop_manual"] = sg * a["valor"]
                else:
                    p["alvo"], p["rot"] = sg * a["valor"], "alvo ajustado na mão"
                    if p["alvo1"] is not None and p["alvo1"] >= p["alvo"]:
                        p["alvo1"] = None
                    if p["alvo2"] is not None and p["alvo2"] >= p["alvo"]:
                        p["alvo2"] = None
                p["manual"] = "ajuste"
                continue
            for od in s["pend"]:
                if chave_de(od) == a["chave"]:
                    if a["tipo"] == "stop":
                        od.update(stop=a["valor"], stop_manual=True)
                    else:
                        od.update(alvo=a["valor"], alvo_manual=a["valor"])

    def na_hora(s, lista, i):
        """Cancelar e entrar na mao: valem no instante do clique (dentro do candle i). Devolve o ajuste de entrada usado."""
        for a in lista:
            if a["tipo"] not in ("cancelar", "entrar") or s["pos"] is not None:
                continue
            for od in list(s["pend"]):
                if chave_de(od) != a["chave"]:
                    continue
                if a["tipo"] == "cancelar":
                    od.update(status="cancelada", motivo="cancelada na mão", i_fim=i)
                    s["pend"].remove(od)
                elif abrir(s, od, od["dir"] * a["preco"] + slip, i, manual="entrada"):
                    return a
        return None

    def pode_entrar(i, cod):
        if not G.intraday:
            return True
        if ESTRATEGIAS[cod].get("abertura"):          # ORB e gap usam o proprio candle de abertura
            return hm[i] < h_fim
        return h_ini <= hm[i] < h_fim

    # ------------------------------------------------------------------ laco principal
    for i in range(i_loop, n):
        novo_dia = d[i] != d[i - 1]
        fim_dia = G.intraday and (hm[i] >= h_zer or (i + 1 < G.n and d[i + 1] != d[i]))
        for s in slots:
            if novo_dia:
                s["stops"] = 0
                s["pnl_dia"] = 0.0
                s["trava"] = None
            p = s["pos"]
            if p and p["sair"]:
                fechar(s, p, p["frac"], p["G"].o[i] - slip, i, p["sair"], slip)
            entrou = None
            if aj_no:
                if i - 1 in aj_no:
                    movidos(s, aj_no[i - 1])
                if i in aj_no:
                    entrou = na_hora(s, aj_no[i], i)
            if s["pos"] is None and s["pend"]:
                processar_ordens(s, i)
            if s["pos"]:
                p = s["pos"]
                Gp = p["G"]
                sai = None
                if aj_no and i in aj_no:
                    sai = next((a for a in aj_no[i] if a["tipo"] == "sair" and a["chave"] == chave_de(p)), None)
                if sai:
                    # saida na mao: ate o clique vale o que o candle tinha feito ate ali; depois sai pelo preco da hora
                    o_, h_, l_, c_ = no_espaco(Gp.sinal, sai["preco"], sai["h"], sai["l"], sai["preco"])
                    gerir(s, p, i, (Gp.o[i], max(h_, c_), min(l_, c_), c_), True)
                    if s["pos"] is p:
                        p["manual"] = "saida"
                        fechar(s, p, p["frac"], c_ - slip, i, "saída na mão", slip)
                elif entrou:
                    # entrou na mao no meio do candle: so conta o que o preco fez DEPOIS do clique (o que da para saber)
                    o_, h_, l_, c_ = no_espaco(Gp.sinal, entrou["preco"], entrou["h"], entrou["l"], entrou["preco"])
                    gerir(s, p, i, (c_, Gp.h[i] if Gp.h[i] > h_ else c_, Gp.l[i] if Gp.l[i] < l_ else c_, Gp.c[i]))
                else:
                    gerir(s, p, i)
            if fim_dia:
                if s["pos"]:
                    p = s["pos"]
                    fechar(s, p, p["frac"], p["G"].c[i] - slip, i, "zeragem do dia", slip)
                cancelar(s, i, "fim do dia")
            if (s["pos"] is None and not fim_dia and i != i_formando and not s["trava"]
                    and not (G.intraday and s["stops"] >= max_stops)):
                for cod in s["cods"]:
                    if not pode_entrar(i, cod):
                        continue
                    od = avaliar(Gs, cod, i)
                    if not od:
                        continue
                    od["ctx"] = G.tend_d[i] * od["dir"]        # +1 a favor da tendencia do diario, -1 contra, 0 indefinida
                    od["er"] = round(G.er[i], 2)
                    if seletivo and not passa_seletivo(G, cod, i, od["dir"]):
                        continue
                    if "folga" in prot or "tol" in prot:
                        ref0 = od["gatilho"] if od["gatilho"] is not None else G.c[i]
                        tec = abs(ref0 - od["stop"])
                        extra = 0.0
                        if "folga" in prot:                    # folga fixa atras do stop tecnico (20 pontos no indice de 130 mil)
                            extra += max(2 * tick, round(FOLGA_PCT * abs(ref0) / tick) * tick)
                        if "tol" in prot and od["ctx"] > 0 and od["er"] >= 0.35:
                            extra += round(TOL_FRAC * tec / tick) * tick      # sinal a favor do diario e limpo: tolera 20% a mais
                        if extra > 0:
                            od["stop"] = od["stop"] - od["dir"] * extra
                            od["extra"] = extra
                    repetida = False
                    for velha in list(s["pend"]):
                        if (velha["est"] == cod and od["tipo"] == "limite" and velha["tipo"] == "limite" and velha["dir"] == od["dir"]
                                and velha["gatilho"] == od["gatilho"] and velha.get("alvos") == od.get("alvos")
                                and (velha.get("stop_manual") or velha["stop"] == od["stop"])):
                            # ordem limitada que continua valendo (mesma pernada): fica a mesma, so renova a validade
                            velha["validade"] = i - velha["i_sinal"] + od["validade"]
                            repetida = True
                        elif velha["est"] == cod:
                            velha.update(status="substituída", motivo="novo candle de sinal", i_fim=i)
                            s["pend"].remove(velha)
                        elif velha["dir"] == od["dir"] and velha["gatilho"] == od["gatilho"] and velha["stop"] == od["stop"]:
                            repetida = True
                    if repetida:
                        continue
                    g = gestao_de(cod, gestao)
                    ref = od["gatilho"] if od["gatilho"] is not None else G.c[i]
                    sg = od["dir"]
                    a1, a2, _, am = alvos_da_gestao(g, sg * ref, max(tick, sg * (ref - od["stop"]) - od.get("extra", 0.0)),
                                                    None if not od.get("alvos") else tuple(None if x is None else sg * x for x in od["alvos"]))
                    risco_prev = abs(ref - od["stop"])
                    od.update(status="pendente", motivo="", i_fim=None, gestao=g, slot=s["nome"],
                              alvo=None if a2 is None else sg * a2, alvo1=None if a1 is None else sg * a1,
                              q=tamanho(s, abs(ref), risco_prev, custo_pts + 2.0 * custo_pct * abs(ref)) if risco_prev > 0 else contratos)
                    if am is not None:
                        od["alvo2"] = sg * am
                    od["f"] = caracteristicas(Gs[sg], G, i, od, ref, cfg)    # retrato do momento do sinal (para a IA)
                    od["k"] = len(ordens)                                    # posicao na lista (usada na retomada)
                    ordens.append(od)
                    s["pend"].append(od)
        if com_atencao:
            lst = [[c, a] for c in codigos for a in [atencao(Gs, c, i)] if a]
            if lst:
                aten[i] = lst
        if i == ponto:
            retrato = capturar(i)

    abertas = []
    for s in slots:
        p = s["pos"]
        if p:
            Gp = p["G"]
            sg = Gp.sinal
            ult = n - 1
            abertas.append(dict(est=p["est"], dir=p["dir"], i_sinal=p["i_sinal"], i_ent=p["i_ent"], ent=sg * p["ent"],
                                stop=sg * p["stop"], stop_ini=sg * p["stop_ini"],
                                alvo=None if p["alvo"] is None else sg * p["alvo"], gestao=p["gest"], parcial=p["parcial"],
                                risco=p["risco"], R=(p["pts"] + p["frac"] * (Gp.c[ult] - p["ent"]) - p["custo_pts"]) / p["risco"],
                                sair=p["sair"], info=p["info"], q=p["q"], ctx=p["ctx"],
                                alvo1=None if p["alvo1"] is None else sg * p["alvo1"],
                                alvo2=None if p["alvo2"] is None else sg * p["alvo2"], parcial2=p["parcial2"],
                                maxR=(p["maxfav"] - p["ent"]) / p["risco"], f=p["f"], manual=p["manual"]))
    # situacao do ultimo dia simulado (para a tela dizer "pode operar" / "pare por hoje")
    s0 = slots[0] if slots else None
    dia = None
    if s0 is not None and n > ini:
        trava = s0["trava"] or ("limite de %d stops no dia" % max_stops if G.intraday and s0["stops"] >= max_stops else None)
        dia = dict(data=d[n - 1], resultado=s0["pnl_dia"], stops=s0["stops"], trava=trava, capital=capital0 + s0["pnl"])
    if retrato is None and retomar and ponto == retomar["m"]:
        retrato = retomar                                      # nada novo depois do retrato: ele continua valendo
    return dict(trades=trades, ordens=ordens, abertas=abertas, aten=aten, ini=ini, fim=n - 1, codigos=codigos, dia=dia,
                ponto=retrato)


# ------------------------------------------------------------------------------------------ estatistica
def _media(x):
    return sum(x) / len(x) if x else 0.0


def estatisticas(trades, capital, d_sai):
    """d_sai(i) -> data (AAAAMMDD) do candle i."""
    n = len(trades)
    out = dict(n=n)
    if n == 0:
        out.update(veredito="SEM OPERAÇÕES", cor="neutro",
                   explica="A estratégia não encontrou nenhum setup neste período.")
        return out
    Rs = [t["R"] for t in trades]
    din = [t["dinheiro"] for t in trades]
    gan = [r for r in Rs if r > 0]
    per = [-r for r in Rs if r <= 0]
    mg, mp = _media(gan), _media(per)
    expR = _media(Rs)
    sdR = (sum((r - expR) ** 2 for r in Rs) / (n - 1)) ** 0.5 if n > 1 else 0.0
    # o veredito usa o DINHEIRO por operacao (o que cai na conta com os contratos escolhidos);
    # o R (resultado / risco) fica como informacao para comparar estrategias
    exp = _media(din)
    sd = (sum((v - exp) ** 2 for v in din) / (n - 1)) ** 0.5 if n > 1 else 0.0
    ic = 1.96 * sd / n ** 0.5 if n > 1 else None
    eq, pico, dd, ddp = capital, capital, 0.0, 0.0
    seq = seq_max = 0
    for v in din:
        eq += v
        if eq > pico:
            pico = eq
        dd = max(dd, pico - eq)
        if pico > 0:
            ddp = max(ddp, (pico - eq) / pico)
        seq = seq + 1 if v <= 0 else 0
        seq_max = max(seq_max, seq)
    lucro = sum(v for v in din if v > 0)
    preju = -sum(v for v in din if v <= 0)
    meio = n // 2
    e1, e2 = _media(din[:meio]), _media(din[meio:])
    custos = sum(t.get("custo", 0.0) for t in trades)
    riscos = [t["risco"] * t.get("q", 1.0) for t in trades]
    # custo medio em R: quanto do risco de cada operacao vai embora em taxa e escorregamento
    custo_r = _media([t.get("custo", 0.0) / (abs(t["dinheiro"] / t["R"])) for t in trades if t["R"] and t["dinheiro"]])
    favor = [t["dinheiro"] for t in trades if t.get("ctx", 0) > 0]
    contra = [t["dinheiro"] for t in trades if t.get("ctx", 0) < 0]
    meses = {}
    for t in trades:
        k = d_sai(t["i_sai"]) // 100
        m = meses.setdefault(k, dict(mes=k, n=0, ganhos=0, dinheiro=0.0, R=0.0))
        m["n"] += 1
        m["ganhos"] += 1 if t["R"] > 0 else 0
        m["dinheiro"] += t["dinheiro"]
        m["R"] += t["R"]
    out.update(acerto=100.0 * len(gan) / n, payoff=(mg / mp) if mp > 0 else None,
               empate=100.0 * mp / (mg + mp) if (mg + mp) > 0 else None,
               expR=expR, icR=1.96 * sdR / n ** 0.5 if n > 1 else None, somaR=sum(Rs), total=sum(din), mediaDin=exp, icDin=ic,
               fatorLucro=(lucro / preju) if preju > 0 else None, ddMax=dd, ddPct=100.0 * ddp,
               perdasSeguidas=seq_max, exp1=e1, exp2=e2, n1=meio, n2=n - meio,
               custos=custos, bruto=sum(din) + custos, custoR=custo_r,
               ctx=dict(favor=dict(n=len(favor), media=_media(favor), total=sum(favor)),
                        contra=dict(n=len(contra), media=_media(contra), total=sum(contra))),
               meses=[meses[k] for k in sorted(meses)], capitalFinal=eq)
    if n < 30:
        out.update(veredito="POUCOS DADOS", cor="amarelo",
                   explica="Só %d operações: amostra pequena demais para concluir. Aumente o período ou use outro tempo gráfico." % n)
    elif exp <= 0:
        out.update(veredito="NÃO OPERAR", cor="vermelho",
                   explica="Expectativa negativa: com custos e escorregamento, perdeu dinheiro neste ativo/tempo gráfico/gestão.")
    elif ic is not None and exp - ic > 0 and e1 > 0 and e2 > 0:
        out.update(veredito="VANTAGEM ESTATÍSTICA", cor="verde",
                   explica="Positiva com margem de erro acima de zero e positiva nas duas metades do período.")
    elif ic is not None and exp - ic > 0:
        out.update(veredito="INSTÁVEL", cor="amarelo",
                   explica="Positiva no total, mas uma das metades do período foi negativa: a vantagem não se repetiu.")
    else:
        out.update(veredito="PROMISSORA, NÃO COMPROVADA", cor="amarelo",
                   explica="Resultado positivo, mas a margem de erro ainda inclui zero: pode ser sorte. Precisa de mais operações.")
    return out
