# -*- coding: utf-8 -*-
"""
ROBO APEX - programa principal.
Sobe um servidor local (so no seu computador), roda as estrategias e abre a tela.
Nao envia ordens: informa o momento de entrada e simula o resultado com dados reais.

Uso:  python robo_apex.py            (ou o RoboApex.exe)
      python robo_apex.py --sem-janela --porta 8765
      python robo_apex.py --redefinir-admin     (esqueci a senha do administrador: volta para o "primeiro acesso")

Como o servidor trabalha (versao 2):
  * dados: cada ativo/tempo tem o seu retrato de candles, renovado em segundo plano (dados_fonte.vivo). Pedido nenhum
    da tela espera a internet depois da primeira carga.
  * contas: os indicadores so sao refeitos quando um candle FECHA; enquanto ele esta aberto, so o ultimo ponto muda.
    A simulacao continua do ponto em que parou (retomada) em vez de refazer o periodo inteiro.
  * tela: recebe so o trecho que mudou (resposta "delta") ou um "igual" quando nada mudou.
  * acesso: toda rota /api exige sessao (auth.py). Os testes ao vivo rodam aqui no servidor (classe Sentinela), mesmo
    com a tela fechada, e geram os eventos e os avisos.
"""
import bisect
import collections
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback
import urllib.parse
import urllib.request
import webbrowser
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import agenda
import tempo_real
import auth
import assinaturas
import avisos
import boleta
import corretora
import cripto
import opcoes
import profit
import dados_fonte as df
import historico
import ia
import noticias
import plano as plano_mod
import radar
from estrategias import AQUECIMENTO, ESTRATEGIAS, GESTOES, GESTOES_CURTO, atencao
from simulador import PROTECOES, atualizar_ultimo, estatisticas, preparar, simular

VERSAO = "3.4"
ARGS = sys.argv[1:]


def _arg(nome, padrao=None):
    return ARGS[ARGS.index(nome) + 1] if nome in ARGS and ARGS.index(nome) + 1 < len(ARGS) else padrao


def pastas():
    # .exe (PyInstaller): tela em _MEIPASS e dados ao lado do .exe.
    # Python: tela em app/web e dados na pasta do projeto (a mesma do .exe).
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS"), os.path.dirname(sys.executable)
    aqui = os.path.dirname(os.path.abspath(__file__))
    return aqui, os.path.dirname(aqui)


RECURSOS, BASE = pastas()
if _arg("--base"):                                  # outra pasta de dados (testes e desenvolvimento)
    BASE = os.path.abspath(_arg("--base"))
WEB = os.path.join(RECURSOS, "web")
NOME_OK = re.compile(r"^[A-Za-z0-9_\-.]{1,80}$")
ACESSOS = None                                      # auth.Acessos, criado no main()
PORTA = 0
TRAVA = threading.RLock()                           # trava de CALCULO: indicadores e simulacao (nunca segura a internet)


# ------------------------------------------------------------------------------------------ dados
_csv_mem = {}


def _cripto_viva(chave, tf):
    def fabrica():
        def fn(ant):
            B, fonte, cfg = cripto.candles(BASE, chave, tf)
            return df.marcar(B, ant[0] if ant else None), fonte, cfg
        return fn
    return df.vivo(("cr", chave, tf), fabrica, 1.5, 2.5)         # cripto: retrato com mais de 2,5 s e buscado na hora


def _ao_vivo(chave, tf):
    """Ouro e prata: historico no nivel do a vista + candles feitos com a cotacao ao vivo (tempo_real.py)."""
    def fabrica():
        def fn(ant):
            b0, _ = df.carregar(BASE, chave, tf)
            b = tempo_real.misturar(chave, b0, df.ATIVOS[chave], df.offset_horas, df._add, df._barras_vazias)
            return b0 if b is b0 else df.marcar(b, ant)
        return fn
    return df.vivo(("tr", chave, tf), fabrica, 1.0, 2.0)


_MT5_MEM = {}
_UID = threading.local()            # usuario do pedido (ou do teste ao vivo) que esta sendo atendido nesta thread


def _dono_mt5(chave):
    """'MT5:SIMBOLO' (o do usuario desta thread) ou 'MT5:SIMBOLO@usuario' (uso interno) -> (simbolo, usuario).
    Cada usuario so enxerga os candles que o EA DELE mandou."""
    sim, _, uid = chave[4:].partition("@")
    atual = getattr(_UID, "v", None)
    if not uid:
        uid = atual
    elif atual and uid != atual:
        raise ValueError("ativo inválido")
    sim = sim.strip().upper()
    if not uid or not (uid == auth.ADMIN_ID or auth.ID_OK.match(uid)) or not corretora.simbolo_ok(sim):
        raise ValueError("ativo do MetaTrader inválido: %s" % chave[:40])
    return sim, uid


def _ck(chave):
    """Chave interna dos calculos guardados: o MT5:SIMBOLO de cada usuario e um ativo diferente (nada se mistura)."""
    if chave.startswith("MT5:") and "@" not in chave:
        return "MT5:%s@%s" % _dono_mt5(chave)
    return chave


def _mt5(chave, tf):
    """Candles que o EA mandou do MetaTrader 5 (dados da corretora, tempo real), agrupados no tempo grafico pedido.
    Custos, horario e valor do ponto vem do ativo do robo escolhido na aba Conectar (WIN, WDO, PETR4...)."""
    sim, uid = _dono_mt5(chave)
    minutos, versao = CONEX.minutos(uid, sim)
    if not minutos:
        raise RuntimeError("Ainda não chegaram candles do MetaTrader para %s: ligue o EA no MetaTrader 5." % sim)
    base_at = CONEX.ativo_de(uid, sim)
    cfg = dict(df.ATIVOS.get(base_at) or df.ATIVOS["WIN"])
    cfg.update(nome="%s - MetaTrader 5 (dados da sua corretora, tempo real)" % sim, curto=sim, yahoo=None)
    ck = (uid, sim, tf)
    v = _MT5_MEM.get(ck)
    if v and v[0] == versao:
        return v[1], v[2], cfg
    B = df.agrupar(cfg, minutos, tf if tf in (1, 2, 5, 15, 30, 60) else 5)
    B = df.marcar(B, v[1] if v else None)
    fonte = "MetaTrader 5 · %s · dados da sua corretora em tempo real · custos do %s" % (sim, base_at)
    _MT5_MEM[ck] = (versao, B, fonte)
    return B, fonte, cfg


def carregar(chave, tf):
    """(retrato dos candles, fonte, configuracao do ativo). Nao espera a internet depois da 1a carga."""
    if chave.startswith("MT5:"):
        B, fonte, cfg = _mt5(chave, tf)
        if len(B["c"]) < AQUECIMENTO + 20:
            raise RuntimeError("Poucos candles do MetaTrader ainda (%d). Deixe o EA ligado: ele manda o histórico de 1 minuto." % len(B["c"]))
        return B, fonte, cfg
    if chave.startswith("CSV:"):
        nome = os.path.basename(chave[4:])
        arq = os.path.join(df.pasta_dados(BASE), nome)
        mt = os.path.getmtime(arq) if os.path.exists(arq) else None
        v = _csv_mem.get(nome)
        if not v or v[0] != mt:
            B, fonte, cfg = df.carregar_csv(BASE, nome)
            v = _csv_mem[nome] = (mt, (df.marcar(B), fonte, cfg))
        B, fonte, cfg = v[1]
    elif cripto.eh_cripto(chave):
        B, fonte, cfg = _cripto_viva(chave, tf)          # qualquer moeda da Binance, em tempo real
    else:
        if chave not in df.ATIVOS:
            raise ValueError("ativo desconhecido: %s" % chave)
        cfg = df.ATIVOS[chave]
        # moedas, metais e futuros: retrato com mais de 3 s e buscado AGORA (a resposta sai com o preco de agora, nao com o
        # da rodada anterior); B3 (fonte com ~15 min de atraso) e diario: so depois de 1 min parado
        vivo_ja = df.ATIVOS[chave].get("mercado") != "b3" and tf < 1440
        B, fonte = df.carregar(BASE, chave, tf, max_idade=3.0 if vivo_ja else 60.0)
        if chave in tempo_real.SWISS and B.get("tf", tf) < 1440:
            B = _ao_vivo(chave, tf)                     # ouro e prata: candle de agora com a cotacao a vista de segundos atras
            fonte = fonte.replace(", futuro com atraso ~10 min", "") + " · preço ao vivo: Swissquote (à vista)"
    if len(B["c"]) < AQUECIMENTO + 20:
        raise RuntimeError("Poucos candles (%d) em %s. Preciso de pelo menos %d." % (len(B["c"]), chave, AQUECIMENTO + 20))
    return B, fonte, cfg


def idade_dados(chave, tf):
    """Segundos desde a ultima renovacao boa dos candles deste ativo (None para arquivo CSV)."""
    if chave.startswith("CSV:") or chave.startswith("MT5:"):
        return None
    ck = ("cr", chave, tf) if cripto.eh_cripto(chave) else df.chave_viva(BASE, chave, tf)
    return df.idade(ck)[0]


_GS = collections.OrderedDict()


def graficos(chave, tf, B, sc, aberto=False):
    """Candles + indicadores dos dois lados. Refaz tudo so quando um candle FECHA (ou um candle fechado muda); com os
    mesmos candles fechados, so o candle aberto e atualizado. Chamar com a TRAVA de calculo."""
    n = len(B["c"])
    nf = n - 1 if aberto else n
    ck = (_ck(chave), tf)
    v = _GS.get(ck)
    if v and v["n"] == n and v["nf"] == nf:
        if v["B"] is B:
            _GS.move_to_end(ck)
            return v["Gs"]
        A = v["B"]
        if aberto and all(A[c][:nf] == B[c][:nf] for c in df.COLUNAS):
            atualizar_ultimo(v["Gs"], B)
            v["B"] = B
            _GS.move_to_end(ck)
            return v["Gs"]
    Gs = preparar(B, sc)
    _GS[ck] = dict(B=B, n=n, nf=nf, Gs=Gs)
    _GS.move_to_end(ck)
    while len(_GS) > 10:
        _GS.popitem(last=False)
    return Gs


def impressao(B, m):
    """Numero que muda se qualquer candle ate o indice m (inclusive) mudar. Serve para saber se um retrato de simulacao
    ou o que a tela ja tem continua valendo para estes candles."""
    mem = B.setdefault("_fp", {})
    v = mem.get(m)
    if v is None:
        v = hash((m,) + tuple(hash(tuple(B[c][:m + 1])) for c in ("t", "o", "h", "l", "c", "v")))
        if len(mem) > 8:
            mem.clear()
        mem[m] = v
    return v


_RET = collections.OrderedDict()


# ------------------------------------------------------------------------------------------ rodizio automatico
# A cada dia, so operam as 3 estrategias que mais ganharam (soma em vezes o risco) nos 20 dias de pregao anteriores, e
# so as que ficaram no positivo. So usa dias que ja terminaram: nada olha o futuro. Teste com custos (90 mil operacoes,
# 12 ativos, 5/15/60 min): media -0,060R contra -0,117R operando todas (a perda caiu pela metade nas duas metades do
# periodo), mas continua negativa: nao e garantia de lucro.
RODIZIO_DIAS, RODIZIO_N = 20, 3
_ROD = collections.OrderedDict()


def rodizio_mapa(chave, tf, B, Gs, sc, gestao, contratos, max_stops, plano):
    """{dia AAAAMMDD: (codigos escolhidos)} para todos os dias dos candles (o de hoje sai dos dias anteriores)."""
    d = B["d"]
    hoje = d[-1]
    i_ontem = bisect.bisect_left(d, hoje) - 1
    pl = {k: v for k, v in (plano or {}).items() if k != "rodizio"}
    key = (_ck(chave), tf, hoje, i_ontem, B.get("sid") if i_ontem < 0 else impressao(B, max(AQUECIMENTO, i_ontem)), gestao,
           float(contratos), max_stops, json.dumps(pl, sort_keys=True, default=str))
    if key in _ROD:
        _ROD.move_to_end(key)
        return _ROD[key]
    por = collections.defaultdict(lambda: collections.defaultdict(float))
    if i_ontem > AQUECIMENTO:
        for cod in ESTRATEGIAS:
            if ESTRATEGIAS[cod]["intraday"] and tf >= 1440:
                continue
            r = simular_c(chave, tf, B, Gs, sc, [cod], AQUECIMENTO, i_ontem, False, gestao=gestao, contratos=contratos,
                          max_stops=max_stops, plano=pl or None)
            for t in r["trades"]:
                por[cod][d[t["i_ent"]]] += t["R"]
    dias = sorted(set(d[AQUECIMENTO:]))
    mapa = {}
    for k, dia in enumerate(dias):
        janela = dias[max(0, k - RODIZIO_DIAS):k]
        if len(janela) < 5:
            continue
        somas = sorted(((sum(por[c].get(x, 0.0) for x in janela), c) for c in por), reverse=True)[:RODIZIO_N]
        mapa[dia] = [c for v, c in somas if v > 0]
    _ROD[key] = mapa
    while len(_ROD) > 40:
        _ROD.popitem(last=False)
    return mapa


def simular_c(chave, tf, B, Gs, sc, cods, i_ini=None, i_fim=None, aberto=False, gestao="padrao", contratos=1.0, max_stops=2,
              juntas=False, com_atencao=False, plano=None, ajustes=None):
    """Simulacao com retomada: continua do ultimo retrato valido desta mesma consulta em vez de refazer o periodo.
    O retrato fica 2 candles atras do fim (o ultimo candle fechado as vezes e corrigido pela fonte). Chamar com a TRAVA.
    cods == ["AUTO"]: rodizio automatico (as 3 melhores estrategias dos ultimos 20 dias, a cada dia)."""
    if "AUTO" in cods:
        mapa = rodizio_mapa(chave, tf, B, Gs, sc, gestao, contratos, max_stops, plano)
        cods = [c for c in ESTRATEGIAS if not (ESTRATEGIAS[c]["intraday"] and tf >= 1440)]
        juntas = False
        plano = dict(plano or {}, rodizio=mapa)
    n = len(B["c"])
    vivo = i_fim is None or i_fim >= n - 1
    alvo = (n - 3) if vivo else i_fim
    ini = max(AQUECIMENTO, i_ini or 0)
    pk = None if not plano else tuple(sorted((k, json.dumps(v, sort_keys=True) if isinstance(v, (dict, list)) else v)
                                             for k, v in plano.items() if v))
    ak = None if not ajustes else json.dumps(ajustes, sort_keys=True)
    custos = (sc.get("valor_ponto"), sc.get("custo"), sc.get("custo_pct"), sc.get("tick"))     # lote da cripto pode mudar: retrato antigo nao vale
    key = (_ck(chave), tf, tuple(cods), gestao, float(contratos), max_stops, juntas, ini, com_atencao, pk, ak, None if vivo else i_fim, custos)
    ck = _RET.get(key)
    ret = None
    if ck and ini - 1 <= ck["m"] <= alvo and ck["fp"] == impressao(B, ck["m"]):
        ret = ck["ret"]
    r = simular(Gs, sc, cods, gestao=gestao, contratos=contratos, max_stops=max_stops, juntas=juntas, i_ini=i_ini,
                i_fim=None if vivo else i_fim, com_atencao=com_atencao, i_formando=(n - 1) if (aberto and vivo) else None,
                plano=plano, tempos=B["t"], ajustes=ajustes, retomar=ret, ponto=alvo if alvo >= ini else None)
    p = r.pop("ponto", None)
    for nome in ("trades", "ordens", "abertas"):
        r[nome] = [dict(x) for x in r[nome]]
    if p is not None and (ck is None or p is not ck["ret"]):
        _RET[key] = dict(m=p["m"], fp=impressao(B, p["m"]), ret=p)
    if key in _RET:
        _RET.move_to_end(key)
    while len(_RET) > 200:
        _RET.popitem(last=False)
    return r


def formando(B, cfg, chave):
    """True se o ultimo candle ainda nao fechou (o relogio da bolsa ainda esta dentro dele)."""
    if chave.startswith("CSV:") or not B["t"]:
        return False
    agora = time.time()
    local = agora + 3600 * df.offset_horas(cfg.get("fuso", "BRT"), agora)
    tf = B.get("tf", 5)
    if tf >= 1440 and cfg.get("cripto"):
        return True                              # o candle diario da Binance de hoje esta sempre aberto (fecha 21h de Brasilia)
    if tf >= 1440:
        g = time.gmtime(local)
        fim = (cfg.get("sessao") or (0, 2359))[1]
        return B["d"][-1] == g.tm_year * 10000 + g.tm_mon * 100 + g.tm_mday and g.tm_hour * 100 + g.tm_min <= fim
    return local < B["t"][-1] + tf * 60


def dow(hs, ls, cs, forca=2):
    """Teoria de Dow (so para leitura de contexto): +1 topos e fundos subindo com o ultimo fundo preservado,
    -1 o inverso, 0 indefinido."""
    phs, pls = [], []
    m = len(hs)
    for i in range(m - 1 - forca, forca - 1, -1):
        if len(phs) < 2 and all(hs[i] > hs[i - k] for k in range(1, forca + 1)) and all(hs[i] >= hs[i + k] for k in range(1, forca + 1)):
            phs.append(hs[i])
        if len(pls) < 2 and all(ls[i] < ls[i - k] for k in range(1, forca + 1)) and all(ls[i] <= ls[i + k] for k in range(1, forca + 1)):
            pls.append(ls[i])
        if len(phs) >= 2 and len(pls) >= 2:
            break
    if len(phs) < 2 or len(pls) < 2:
        return 0
    if phs[0] > phs[1] and pls[0] > pls[1]:
        return 1 if cs[-1] >= pls[0] else 0
    if phs[0] < phs[1] and pls[0] < pls[1]:
        return -1 if cs[-1] <= phs[0] else 0
    return 0


_ctx_mem = {}


def contexto(chave):
    """Tendencia de Dow no Diario e no Semanal (leitura, nao entra na decisao das estrategias)."""
    if chave.startswith("CSV:"):
        return None
    try:
        if cripto.eh_cripto(chave):
            B = _cripto_viva(chave, 1440)[0]
        else:
            B, _ = df.carregar_yahoo(BASE, chave, 1440)
    except Exception:
        return None
    v = _ctx_mem.get(chave)
    if v and v[0] is B:
        return v[1]
    h, l, c, d = B["h"], B["l"], B["c"], B["d"]
    sem = {}
    for k in range(len(c)):
        dt = date(d[k] // 10000, d[k] // 100 % 100, d[k] % 100).isocalendar()[:2]
        w = sem.get(dt)
        sem[dt] = [max(w[0], h[k]), min(w[1], l[k]), c[k]] if w else [h[k], l[k], c[k]]
    ws = [sem[k] for k in sorted(sem)]
    out = dict(diario=dow(h[-60:], l[-60:], c[-60:]),
               semanal=dow([w[0] for w in ws[-30:]], [w[1] for w in ws[-30:]], [w[2] for w in ws[-30:]]))
    if len(_ctx_mem) > 60:
        _ctx_mem.clear()
    _ctx_mem[chave] = (B, out)
    return out


def _i_da_data(d, alvo, primeiro=True):
    if primeiro:
        return bisect.bisect_left(d, alvo)
    return bisect.bisect_right(d, alvo) - 1


PERIODOS = ("hoje", "5d", "1m", "3m", "tudo")


def janela(d, per="tudo", de=0, ate=0):
    """Indices (inicio, fim) do periodo escolhido no topo. Presets contam a partir do ultimo dia com dados."""
    n = len(d)
    if per in ("hoje", "5d", "1m", "3m"):
        ult = d[-1]
        if per == "hoje":
            de = ult
        elif per == "5d":
            dias = sorted(set(d[-3000:]))
            de = dias[-5] if len(dias) >= 5 else dias[0]
        else:
            dt = date(ult // 10000, ult // 100 % 100, ult % 100) - timedelta(days=30 if per == "1m" else 91)
            de = int(dt.strftime("%Y%m%d"))
        ate = 0
    i_ini = max(AQUECIMENTO, _i_da_data(d, de)) if de else AQUECIMENTO
    i_fim = _i_da_data(d, ate, primeiro=False) if ate else n - 1
    if i_fim < i_ini:
        raise ValueError("Período vazio: não há candles entre as datas escolhidas (os primeiros %d candles servem só para "
                         "aquecer as médias)." % AQUECIMENTO)
    return i_ini, i_fim


def _int(q, nome, padrao):
    try:
        return int(q.get(nome, [padrao])[0])
    except (TypeError, ValueError):
        return padrao


def _float(q, nome, padrao, lo, hi):
    try:
        return max(lo, min(hi, float(str(q.get(nome, [padrao])[0]).replace(",", "."))))
    except (TypeError, ValueError):
        return padrao


def _resumo(st):
    chaves = ("n", "acerto", "empate", "payoff", "expR", "icR", "somaR", "total", "mediaDin", "icDin", "ddMax", "exp1", "exp2",
              "veredito", "cor", "explica", "custos", "bruto", "custoR")
    return {k: st.get(k) for k in chaves}


def regras_de(txt):
    """'E2:1.5:3,E9:0.8:0' -> {'E2': (1.5, 3.0), 'E9': (0.8, 0.0)}: a "Minha regra" de cada estrategia (stop e alvo proprios)."""
    out = {}
    for parte in str(txt or "").split(","):
        p = parte.split(":")
        if len(p) == 3 and p[0] in ESTRATEGIAS:
            try:
                fs, ra = float(p[1]), float(p[2])
            except ValueError:
                continue
            if 0.2 <= fs <= 5.0 and 0.0 <= ra <= 20.0:
                out[p[0]] = (round(fs, 3), round(ra, 2))
    return out


def _plano(q, capital):
    """Regras do plano de trade que vem da tela (aba Plano): tamanho por risco, limite de perda e meta do dia, modo seletivo."""
    return dict(regras=regras_de(q.get("regra", [""])[0]), tam="risco" if q.get("tam", ["fixo"])[0] == "risco" else "fixo", risco_pct=_float(q, "risco", 1.0, 0.05, 20.0),
                capital=capital, loss_dia=_float(q, "lossDia", 0.0, 0.0, 1e9), meta_dia=_float(q, "metaDia", 0.0, 0.0, 1e9),
                seletivo=q.get("seletivo", ["0"])[0] == "1", qual=q.get("qual", [""])[0] if q.get("qual", [""])[0] in ("A+", "A", "B") else "",
                prot=tuple(sorted(x for x in q.get("prot", [""])[0].split(",") if x in PROTECOES)))


def _pedido(q):
    """Le os parametros comuns de /api/sim, /api/metas, /api/gestoes e /api/ia."""
    chave = q.get("ativo", ["WIN"])[0]
    tf = _int(q, "tf", 5)
    if tf not in df.TEMPOS:
        tf = 5
    est = q.get("est", ["E1"])[0]
    if est not in ("TODAS", "AUTO") and est not in ESTRATEGIAS:
        raise ValueError("estratégia desconhecida: %s" % est)
    gestao = q.get("gestao", ["padrao"])[0]
    if gestao not in GESTOES:
        gestao = "padrao"
    capital = _float(q, "capital", 10000.0, 1.0, 1e9)
    pl = _plano(q, capital)
    cambio = None
    if q.get("brl", [""])[0] == "1" and df.ATIVOS.get(chave, {}).get("moeda") == "US$":
        # conta em reais num ativo cotado em dolar: o capital e os limites do dia (digitados em R$) sao convertidos para
        # a moeda do ativo; a tela converte os resultados de volta com o mesmo cambio
        cambio = _usdbrl()
        if cambio:
            capital = capital / cambio
            pl = dict(pl, capital=capital, loss_dia=pl["loss_dia"] / cambio, meta_dia=pl["meta_dia"] / cambio)
    minhas = [c for c in q.get("cods", [""])[0].split(",") if c in ESTRATEGIAS]
    codigos = (minhas or list(ESTRATEGIAS)) if est == "TODAS" else [est]
    return dict(chave=chave, tf=tf, est=est, todas=est == "TODAS", gestao=gestao, capital=capital, codigos=codigos,
                contratos=_float(q, "contratos", 1.0, 0.01, 1e7), max_stops=int(_float(q, "maxstops", 2, 1, 50)),
                plano=pl, cambio=cambio)


def _usdbrl():
    """Dolar em reais (ultimo preco do USD/BRL que o robo ja acompanha), com 2 casas; None se nao houver."""
    try:
        x = carregar("WDO", 5)[0]["c"][-1] / 1000.0
        return round(x, 2) if 3.0 < x < 15.0 else None
    except Exception:
        return None


# ------------------------------------------------------------------------------------------ IA (em segundo plano)
class MotorIA:
    """Mantem, para cada ativo + tempo + gestao, o modelo treinado com as operacoes de TODAS as estrategias (cada uma
    sozinha, no historico inteiro) e a nota dele fora da amostra. O treino roda numa thread propria; enquanto um modelo
    novo nao fica pronto, vale o anterior."""
    VALIDADE = 600.0                                 # confere se ha operacoes novas a cada 10 min

    def __init__(self):
        self.mem, self.fazendo = {}, set()
        self.trava = threading.Lock()
        self.fila = ThreadPoolExecutor(max_workers=1, thread_name_prefix="ia")

    def obter(self, chave, tf, gestao, contratos, agendar=True):
        k = (_ck(chave), tf, gestao, float(contratos))          # MT5: o modelo de cada usuario e so dele
        v = self.mem.get(k)
        if agendar and (v is None or time.time() - v["feito"] > self.VALIDADE):
            with self.trava:
                if k not in self.fazendo:
                    self.fazendo.add(k)
                    self.fila.submit(self._treinar, k)
        return v

    def treinando(self, chave, tf, gestao, contratos):
        return (_ck(chave), tf, gestao, float(contratos)) in self.fazendo

    def _treinar(self, k):
        chave, tf, gestao, contratos = k
        try:
            cods = [c for c in ESTRATEGIAS if not (ESTRATEGIAS[c]["intraday"] and tf >= 1440)]
            ts, B, cfg = [], None, None
            for cod in cods:
                B, _, cfg = carregar(chave, tf)                # sempre o retrato mais novo (o mesmo que a tela esta usando)
                sc = df.sessao_cfg(cfg)
                q = contratos if cfg.get("fracionado") else max(1.0, round(contratos))
                with TRAVA:
                    aberto = formando(B, cfg, chave)
                    Gs = graficos(chave, tf, B, sc, aberto)
                    r = simular_c(chave, tf, B, Gs, sc, [cod], None, None, aberto, gestao=gestao, contratos=q, max_stops=99)
                t = B["t"]
                ts += [(t[x["i_sinal"]], t[x["i_sai"]], x) for x in r["trades"]]
                time.sleep(0.005)                              # da a vez aos pedidos da tela
            ts.sort(key=lambda x: (x[0], x[1]))
            n = len(ts)
            ant = self.mem.get(k)
            if ant and ant["n"] == n and ant["estado"] != "erro":
                ant["feito"] = time.time()                     # nada novo: o modelo continua valendo
                return
            amostras = [(x["est"], x.get("f"), x["R"]) for _, _, x in ts]
            tempos = [(a, b) for a, b, _ in ts]
            geral = dict(n=n, acerto=100.0 * sum(1 for _, _, x in ts if x["R"] > 0) / n if n else None,
                         mediaR=sum(x["R"] for _, _, x in ts) / n if n else None)
            por_est = {}
            for c in cods:
                rs = [x["R"] for _, _, x in ts if x["est"] == c]
                if rs:
                    por_est[c] = dict(n=len(rs), acerto=100.0 * sum(1 for r in rs if r > 0) / len(rs), mediaR=sum(rs) / len(rs))
            res = dict(estado="poucos", feito=time.time(), n=n, base=geral, porEst=por_est, modelo=None, nota=None, blocos=[],
                       licoes=[], pesos=[], erros=None, cods=cods)
            if n >= ia.MIN_TREINO:
                modelo = ia.treinar(amostras, cods)
                nota, _ = ia.avaliar_fora(amostras, cods, tempos)
                blocos = nota.pop("blocos", []) if nota else []
                res.update(estado="pronta", modelo=modelo, nota=nota, blocos=blocos, licoes=ia.licoes(amostras),
                           pesos=ia.pesos_do_modelo(modelo), erros=ia.erros_e_acertos([x for _, _, x in ts], B["h"], B["l"]))
            res["diario"] = self._diario(k, res)
            self.mem[k] = res
            if len(self.mem) > 40:
                for velho in sorted(self.mem, key=lambda x: self.mem[x]["feito"])[:10]:
                    self.mem.pop(velho, None)
        except Exception as e:
            traceback.print_exc()
            self.mem[k] = dict(estado="erro", feito=time.time(), n=0, erro=str(e), modelo=None, nota=None, blocos=[], licoes=[], pesos=[],
                               erros=None, base=None, porEst={}, diario=[], cods=[])
        finally:
            with self.trava:
                self.fazendo.discard(k)

    def _diario(self, k, res):
        """Historico da nota da IA (um ponto por dia, ou quando o numero de operacoes muda bastante)."""
        chave, tf, gestao, contratos = k
        pasta = os.path.join(df.pasta_dados(BASE), "ia")
        if chave.startswith("MT5:") and "@" in chave:              # ativo MT5 de um usuario: o historico fica na pasta dele
            pasta = os.path.join(pasta_de(chave.rpartition("@")[2]), "ia")
        arq = os.path.join(pasta, re.sub(r"[^A-Za-z0-9_\-]", "_", "%s_%d_%s" % (chave, tf, gestao)) + ".json")
        try:
            with open(arq, encoding="utf-8") as f:
                lista = json.load(f)
        except (OSError, ValueError):
            lista = []
        nota = res.get("nota")
        hoje = time.strftime("%Y%m%d")
        ponto = dict(dia=hoje, t=round(time.time()), n=res["n"], auc=nota["auc"] if nota else None, tercos=nota["t"] if nota else None,
                     comprovada=bool(nota and nota["comprovada"]),
                     favor=nota["favor"]["mediaR"] if nota else None, todas=nota["todas"]["mediaR"] if nota else None)
        if lista and lista[-1].get("dia") == hoje:
            lista[-1] = ponto
        else:
            lista.append(ponto)
        lista = lista[-400:]
        try:
            os.makedirs(pasta, exist_ok=True)
            with open(arq + ".tmp", "w", encoding="utf-8") as f:
                json.dump(lista, f)
            os.replace(arq + ".tmp", arq)
        except OSError:
            pass
        return lista[-120:]

    def anotar(self, chave, tf, gestao, contratos, r, t):
        """Escreve em cada ordem pendente a chance estimada pelo modelo atual e, nas operacoes, a nota que a IA dava
        quando elas ainda eram futuro (modelo treinado so com o que tinha fechado antes). Devolve o resumo para a tela."""
        v = self.obter(chave, tf, gestao, contratos)
        if not v or v["estado"] != "pronta":
            return dict(estado=(v or {}).get("estado", "treinando"), n=(v or {}).get("n", 0), minimo=ia.MIN_TREINO)
        modelo, blocos = v["modelo"], v["blocos"]
        ini = [b[0] for b in blocos]
        for od in r["ordens"]:
            if od["status"] == "pendente" and od.get("f") is not None:
                p = ia.prever(modelo, od["est"], od["f"])
                if p:
                    od["ia"] = [round(p[0], 3), round(p[1], 3)]
                    od["iaPq"] = ia.explicar(modelo, od["est"], od["f"])      # as leituras que mais pesaram nesta nota
        for x in list(r["trades"]) + list(r["abertas"]):
            if x.get("f") is None or "ia" in x:
                continue
            k = bisect.bisect_right(ini, t[x["i_sinal"]]) - 1
            if k >= 0:
                p = ia.prever(blocos[k][1], x["est"], x["f"])
                if p:
                    x["ia"] = [round(p[0], 3), round(p[1], 3)]
        nota = v["nota"]
        return dict(estado="pronta", n=v["n"], comprovada=bool(nota and nota["comprovada"]), auc=nota["auc"] if nota else None,
                    base=v["base"]["acerto"] / 100.0 if v["base"]["acerto"] is not None else None)


IA = MotorIA()


def api_ia(q):
    P = _pedido(q)
    B, _, cfg = carregar(P["chave"], P["tf"])
    contratos = P["contratos"] if cfg.get("fracionado") else max(1.0, round(P["contratos"]))
    v = IA.obter(P["chave"], P["tf"], P["gestao"], contratos)
    fazendo = IA.treinando(P["chave"], P["tf"], P["gestao"], contratos)
    if not v:
        return dict(estado="treinando", n=0, minimo=ia.MIN_TREINO, treinando=True)
    out = {k: v.get(k) for k in ("estado", "n", "nota", "licoes", "pesos", "erros", "base", "porEst", "diario", "feito", "erro")}
    out.update(minimo=ia.MIN_TREINO, treinando=fazendo, gestao=P["gestao"], moeda=cfg.get("moeda", "R$"), rotulos=ia.ROTULOS,
               nomeTf=df.NOME_TEMPO.get(P["tf"], "%d min" % P["tf"]))
    return out


# ------------------------------------------------------------------------------------------ /api/sim
def edicoes_de(uid, chave, tf):
    """As edicoes do "E se..." deste usuario neste ativo e tempo, no formato de ajuste do simulador: o stop e o alvo
    editados valem desde o candle do sinal (antes da entrada), entao a operacao inteira e refeita com eles."""
    if not uid:
        return []
    arq = os.path.join(pasta_de(uid), "estado_edicoes.json")
    try:
        mt = os.path.getmtime(arq)
    except OSError:
        return []
    ck = (uid, arq)
    v = _ED_MEM.get(ck)
    if not v or v[0] != mt:
        v = _ED_MEM[ck] = (mt, _ler_json(arq, {}))
    out = []
    for k, e in (v[1] or {}).items():
        try:
            a, t, est, t_ent, d = k.split("|")
            if a != chave or int(t) != int(tf) or not isinstance(e, dict) or not e.get("t_sinal") or est not in ESTRATEGIAS:
                continue
            ch = "%s|%d|%d" % (est, int(e["t_sinal"]), int(d))
            if e.get("stop") is not None:
                out.append(dict(t=int(e["t_sinal"]), tipo="stop", chave=ch, valor=float(e["stop"]), ed=True))
            if e.get("alvo") is not None:
                out.append(dict(t=int(e["t_sinal"]), tipo="alvo", chave=ch, valor=float(e["alvo"]), ed=True))
        except (ValueError, TypeError, KeyError):
            continue
    return out


_ED_MEM = {}


def _ed_versao(uid):
    try:
        return os.path.getmtime(os.path.join(pasta_de(uid), "estado_edicoes.json"))
    except OSError:
        return 0


def _rd(x, dec):
    return [None if v is None else round(v, dec) for v in x]


def api_sim(q, uid=None):
    P = _pedido(q)
    chave, est, todas, gestao, capital, max_stops, pl = P["chave"], P["est"], P["todas"], P["gestao"], P["capital"], P["max_stops"], P["plano"]
    com_aten = q.get("aten", ["0"])[0] == "1"
    B, fonte, cfg = carregar(chave, P["tf"])
    tf = B.get("tf", P["tf"])
    sc = df.sessao_cfg(cfg)
    contratos = P["contratos"] if cfg.get("fracionado") else max(1.0, round(P["contratos"]))
    n = len(B["c"])
    d, t = B["d"], B["t"]
    per = q.get("per", ["tudo"])[0]
    i_ini, i_fim = janela(d, per if per in PERIODOS else "tudo", _int(q, "de", 0), _int(q, "ate", 0))
    aberto = formando(B, cfg, chave)
    vivo = i_fim == n - 1
    # o que a tela ja tem: mesmo retrato -> "igual"; mesmos candles ate n-3 -> so o trecho novo ("delta")
    c_sid, c_n, c_fp = _int(q, "sid", 0), _int(q, "n", 0), q.get("fp", [""])[0]
    mesma_janela = _int(q, "ii", -1) == max(AQUECIMENTO, i_ini) and not com_aten
    if mesma_janela and c_sid and c_sid == B.get("sid") and c_n == n and q.get("fo", [""])[0] == ("1" if aberto and vivo else "0") \
            and q.get("ia", [""])[0] == IA_estado(chave, tf, gestao, contratos):
        IA.obter(chave, tf, gestao, contratos)                 # mantem o modelo em dia mesmo sem nada novo na tela
        return dict(igual=True, sid=c_sid, idade=idade_dados(chave, tf))
    de = None
    if mesma_janela and 4 <= c_n <= n and c_fp and c_fp == str(impressao(B, c_n - 3)) and i_ini <= c_n - 3:
        de = c_n - 2
    codigos = P["codigos"]
    with TRAVA:
        Gs = graficos(chave, tf, B, sc, aberto)
        eds = edicoes_de(uid, chave, tf)
        r = simular_c(chave, tf, B, Gs, sc, codigos, i_ini, i_fim, aberto, gestao=gestao, contratos=contratos, max_stops=max_stops,
                      juntas=todas, com_atencao=com_aten, plano=pl, ajustes=eds or None)
        dsai = lambda i: d[i]                                      # noqa: E731
        st = estatisticas(r["trades"], capital, dsai)
        n_ed = sum(1 for x in r["trades"] + r["abertas"] if x.get("manual") == "edicao")
        st_robo = None
        if n_ed:                                                   # o mesmo periodo sem as edicoes: "o robo sozinho"
            r0 = simular_c(chave, tf, B, Gs, sc, codigos, i_ini, i_fim, aberto, gestao=gestao, contratos=contratos,
                           max_stops=max_stops, juntas=todas, plano=pl)
            st_robo = _resumo(estatisticas(r0["trades"], capital, dsai))
            st_robo["total"] = estatisticas(r0["trades"], capital, dsai).get("total", 0.0)
        por_est = {}
        if todas:
            for cod in r["codigos"]:
                ri = simular_c(chave, tf, B, Gs, sc, [cod], i_ini, i_fim, aberto, gestao=gestao, contratos=contratos,
                               max_stops=max_stops, plano=pl, ajustes=eds or None)
                por_est[cod] = dict(isolada=_resumo(estatisticas(ri["trades"], capital, dsai)),
                                    naJunta=_resumo(estatisticas([x for x in r["trades"] if x["est"] == cod], capital, dsai)),
                                    # operacoes da estrategia sozinha (para o calendario): entrada, saida, lado, R, dinheiro, motivo, precos
                                    ops=[[x["i_ent"], x["i_sai"], x["dir"], round(x["R"], 3), round(x["dinheiro"], 2), x["motivo"],
                                          x["ent"], x["sai"]] for x in ri["trades"] if de is None or x["i_sai"] >= de])
        ult = i_fim
        aten_ult = [[c, a] for c in r["codigos"] for a in [atencao(Gs, c, ult)] if a]
        dec = cfg["decimais"] + 2
        G = Gs[1]
        k0 = de or 0
        vw_de = min(k0, G.ini_dia[k0]) if (G.vw and de is not None) else k0     # a VWAP do dia pode mudar para tras
        series = dict(t=t[k0:], d=d[k0:], hm=B["hm"][k0:], o=_rd(B["o"][k0:], dec), h=_rd(B["h"][k0:], dec), l=_rd(B["l"][k0:], dec),
                      c=_rd(B["c"][k0:], dec), v=[round(x or 0, 2) for x in B["v"][k0:]],
                      mm9=_rd(G.mm9[k0:], dec), mm20=_rd(G.mm20[k0:], dec), mm200=_rd(G.mm200[k0:], dec),
                      vw=_rd(G.vw[vw_de:], dec) if G.vw else None,
                      ruido=[None if x is None else round(x, 6) for x in G.ruido[k0:]] if (G.ruido and (todas or est == "E11")) else None)
        ctx_ult = dict(diario=G.tend_d[ult], er=round(G.er[ult], 2))
    for tr in r["trades"]:
        tr.update(t_sinal=t[tr["i_sinal"]], t_ent=t[tr["i_ent"]], t_sai=t[tr["i_sai"]])
    for od in r["ordens"]:
        od["t_sinal"] = t[od["i_sinal"]]
    for ab in r["abertas"]:
        ab.update(t_sinal=t[ab["i_sinal"]], t_ent=t[ab["i_ent"]])
    ia_res = IA.anotar(chave, tf, gestao, contratos, r, t)
    vol = B["v"]
    meta = dict(ativo=chave, nome=cfg["nome"], fonte=fonte, tick=cfg["tick"], decimais=cfg["decimais"],
                moeda=cfg.get("moeda", "R$"), lote=cfg.get("lote", "contrato"), tf=tf, nomeTf=df.NOME_TEMPO.get(tf, "%d min" % tf),
                valorPonto=sc["valor_ponto"], custo=sc["custo"], slip=sc["slip"], fracionado=sc["fracionado"],
                horaInicio=sc["hora_inicio"], horaFim=sc["hora_fim"], horaZeragem=sc["hora_zeragem"], intraday=tf < 1440,
                est=est, gestao=gestao, contratos=contratos, capital=capital, maxStops=max_stops, per=per,
                aoVivo=vivo, formando=aberto and vivo, temVolume=any(vol[-400:]),
                tam=pl["tam"], riscoPct=pl["risco_pct"], lossDia=pl["loss_dia"], metaDia=pl["meta_dia"], seletivo=pl["seletivo"], qual=pl.get("qual", ""),
                custoPct=sc.get("custo_pct", 0.0), cripto=bool(cfg.get("cripto")), curto=cfg.get("curto"), prot=list(pl["prot"]),
                usdbrl=P.get("cambio") or _usdbrl(),
                dia=r["dia"], ctx=ctx_ult,
                foraDoPlano=sum(1 for o in r["ordens"] if o["status"] == "cancelada" and o["motivo"].startswith("risco acima do plano")),
                iIni=r["ini"], iFim=r["fim"], dataIni=d[r["ini"]], dataFim=d[r["fim"]],
                dataMin=d[AQUECIMENTO], dataMax=d[-1], ultimo=n - 1, codigos=r["codigos"],
                offsetLocal=int(3600 * df.offset_horas(cfg.get("fuso", "BRT"), time.time())),     # relogio do ativo (contagem do candle)
                sid=B.get("sid"), n=n, fp=str(impressao(B, n - 3)), idade=idade_dados(chave, tf), ia=ia_res,
                iaSel=IA_estado(chave, tf, gestao, contratos))
    if est == "AUTO":                                  # rodizio: quais estrategias operam hoje (e as dos ultimos dias)
        with TRAVA:
            mapa = rodizio_mapa(chave, tf, B, Gs, sc, gestao, contratos, max_stops, P["plano"])
        meta["rodizio"] = [[k, mapa[k]] for k in sorted(mapa)[-6:]]
        aten_ult = [x for x in aten_ult if x[0] in mapa.get(d[-1], [])]
    out = dict(meta=meta, abertas=_sem_f(r["abertas"]), atenUlt=aten_ult, stats=st, porEst=por_est, contexto=contexto(chave),
               edN=n_ed, statsRobo=st_robo)
    out.update(series)
    if de is None:
        out.update(trades=_sem_f(r["trades"]), ordens=_sem_f(r["ordens"]), aten={str(k): v for k, v in r["aten"].items()})
    else:
        # delta: a tela guarda o que terminou antes de `de` (isso nao muda) e troca o resto pelo que vem aqui
        out.update(delta=dict(de=de, vwDe=vw_de), trades=_sem_f([x for x in r["trades"] if x["i_sai"] >= de]),
                   ordens=_sem_f([o for o in r["ordens"] if o["i_fim"] is None or o["i_fim"] >= de]), aten={})
    return out


def _sem_f(lista):
    """Copia das operacoes/ordens sem o retrato da IA (a tela nao usa; no servidor ele continua guardado)."""
    return [{k: v for k, v in x.items() if k != "f"} for x in lista]


def IA_estado(chave, tf, gestao, contratos):
    """Selo curto do modelo que a tela esta usando (quando ele muda, a tela pede os dados de novo)."""
    v = IA.mem.get((_ck(chave), tf, gestao, float(contratos)))
    return "%s:%d" % (v["estado"], v["n"]) if v else "-"


# ------------------------------------------------------------------------------------------ testar estrategia / minhas estrategias
def _semana(dd):
    """AAAAMMDD -> segunda-feira da semana (AAAAMMDD)."""
    x = date(dd // 10000, dd // 100 % 100, dd % 100)
    return int((x - timedelta(days=x.weekday())).strftime("%Y%m%d"))


def _resumo_teste(chave, tf_pedido, codigos, P, q, cfg_so=False):
    """Simula `codigos` (juntas se forem varias) no ativo e tempo pedidos e devolve um resumo para a tela."""
    B, fonte, cfg = carregar(chave, tf_pedido)
    tf = B.get("tf", tf_pedido)
    sc = df.sessao_cfg(cfg)
    contratos = P["contratos"] if cfg.get("fracionado") else max(1.0, round(P["contratos"]))
    d, t = B["d"], B["t"]
    per = q.get("per", ["tudo"])[0]
    i_ini, i_fim = janela(d, per if per in PERIODOS else "tudo", _int(q, "de", 0), _int(q, "ate", 0))
    aberto = formando(B, cfg, chave)
    with TRAVA:
        Gs = graficos(chave, tf, B, sc, aberto)
        r = simular_c(chave, tf, B, Gs, sc, codigos, i_ini, i_fim, aberto, gestao=P["gestao"], contratos=contratos,
                      max_stops=P["max_stops"], juntas=len(codigos) > 1, plano=P["plano"])
        aten = [c for c in codigos if atencao(Gs, c, i_fim)] if i_fim == len(t) - 1 else []
    tr = r["trades"]
    st = estatisticas(tr, P["capital"], lambda i: d[i])
    meses, semanas = {}, {}
    for x in tr:
        dd = d[x["i_sai"]]
        m = meses.setdefault(dd // 100, [0, 0.0, 0])
        m[0] += 1; m[1] += x["dinheiro"]; m[2] += x["dinheiro"] > 0
        w = semanas.setdefault(_semana(dd), [0, 0.0, 0])
        w[0] += 1; w[1] += x["dinheiro"]; w[2] += x["dinheiro"] > 0
    acum, curva, pontos, dias = 0.0, [], [], {}
    for x in tr:
        acum += x["dinheiro"]
        curva.append(round(acum, 2))
        pontos.append([t[x["i_sai"]], round(acum, 2), round(x["dinheiro"], 2)])
        dd = dias.setdefault(d[x["i_sai"]], [0.0, 0])
        dd[0] += x["dinheiro"]; dd[1] += 1
    if len(curva) > 120:
        passo = len(curva) / 120.0
        curva = [curva[int(k * passo)] for k in range(120)] + [curva[-1]]
    if len(pontos) > 400:                                   # curva por operacao (periodos curtos): no maximo 400 pontos
        passo = len(pontos) / 400.0
        pontos = [pontos[int(k * passo)] for k in range(400)] + [pontos[-1]]
    acum, serie_dias = 0.0, []                              # curva dia a dia: resultado do dia e acumulado
    for k in sorted(dias):
        acum += dias[k][0]
        serie_dias.append([k, round(dias[k][0], 2), round(acum, 2), dias[k][1]])
    pend = [o for o in r["ordens"] if o["status"] == "pendente"]
    agora = ("operacao" if r["abertas"] else "ordem" if pend else "atencao" if aten else "aguardando")
    ab = r["abertas"][0] if r["abertas"] else None
    din = [x["dinheiro"] for x in tr]
    return dict(tf=tf, nomeTf=df.NOME_TEMPO.get(tf, "%d min" % tf), n=st["n"], total=st.get("total", 0.0), acerto=st.get("acerto"),
                media=st.get("mediaDin"), ddMax=st.get("ddMax", 0.0), veredito=st.get("veredito"), cor=st.get("cor"),
                maiorGanho=max(din) if din else 0.0, maiorPerda=min(din) if din else 0.0,
                perdaMedia=(sum(v for v in din if v <= 0) / max(1, sum(1 for v in din if v <= 0))) if din else 0.0,
                ganhoMedio=(sum(v for v in din if v > 0) / max(1, sum(1 for v in din if v > 0))) if din else 0.0,
                meses=[[k, v[0], round(v[1], 2), v[2]] for k, v in sorted(meses.items())],
                semanas=[[k, v[0], round(v[1], 2), v[2]] for k, v in sorted(semanas.items())][-12:],
                curva=curva, pontos=pontos, dias=serie_dias[-500:], agora=agora,
                aberta=dict(est=ab["est"], dir=ab["dir"], ent=ab["ent"], R=round(ab["R"], 3),
                            dinheiro=round(ab["R"] * ab["risco"] * sc["valor_ponto"] * (ab.get("q") or contratos), 2)) if ab else None,
                ultimas=[dict(est=x["est"], dir=x["dir"], t_ent=t[x["i_ent"]], t_sai=t[x["i_sai"]], ent=x["ent"], sai=x["sai"],
                              motivo=x["motivo"], dinheiro=round(x["dinheiro"], 2)) for x in tr[-8:]][::-1],
                dataIni=d[max(AQUECIMENTO, i_ini)], dataFim=d[i_fim], moeda=cfg.get("moeda", "R$"), decimais=cfg["decimais"],
                intraday=tf < 1440, contratos=contratos)


def api_testar(q):
    """Testar ESTA estrategia: o periodo escolhido em 5, 15 e 60 min (e no tempo do topo, se for outro)."""
    P = _pedido(q)
    if P["todas"]:
        raise ValueError("Escolha uma estratégia (não o modo Minhas estratégias juntas) para testar.")
    tfs = [5, 15, 60]
    if P["tf"] not in tfs:
        tfs.append(P["tf"])
    out = []
    for tf in tfs:
        try:
            out.append(_resumo_teste(P["chave"], tf, [P["est"]], P, q))
        except Exception as e:                                  # um tempo grafico sem dados nao derruba o resto
            out.append(dict(tf=tf, nomeTf=df.NOME_TEMPO.get(tf, "%d min" % tf), erro=str(e)))
    return dict(est=P["est"], ativo=P["chave"], tfAtual=P["tf"], tempos=out)


def api_minhas(q):
    """Minhas estrategias: cada uma sozinha no ativo e tempo do topo, com o resultado do periodo e o que esta fazendo agora."""
    P = _pedido(q)
    cods = [c for c in q.get("cods", [""])[0].split(",") if c in ESTRATEGIAS][:25]
    if not cods:
        raise ValueError("Escolha pelo menos uma estratégia.")
    linhas = []
    for c in cods:
        try:
            x = _resumo_teste(P["chave"], P["tf"], [c], P, q)
            for k in ("curva", "semanas", "pontos", "dias"):
                x.pop(k, None)
            linhas.append(dict(x, est=c, nome=ESTRATEGIAS[c]["nome"]))
        except Exception as e:
            linhas.append(dict(est=c, nome=ESTRATEGIAS[c]["nome"], erro=str(e)))
    juntas = None
    if len(cods) > 1:
        try:
            juntas = _resumo_teste(P["chave"], P["tf"], cods, P, q)
            for k in ("curva", "pontos", "dias"):
                juntas.pop(k, None)
        except Exception as e:
            juntas = dict(erro=str(e))
    return dict(ativo=P["chave"], tf=P["tf"], linhas=linhas, juntas=juntas)


def _ligar_piloto(uid, p, ip, u):
    """Piloto automatico: liga (ou troca) o teste ao vivo no ativo da corretora com a estrategia escolhida e manda o EA
    seguir, com as travas do servidor. Um botao so na aba Conectar."""
    sim = str(p.get("simbolo") or CONEX.publico(uid)["cfg"].get("simbolo") or "").strip().upper()
    if not sim:
        raise ValueError("Escreva o símbolo do MetaTrader (o do gráfico onde o EA está).")
    if not corretora.simbolo_ok(sim):
        raise ValueError("Símbolo inválido.")
    if sim not in CONEX.simbolos_de(uid):
        raise ValueError("O EA ainda não mandou os candles de %s. Abra o MetaTrader, coloque o EA no gráfico desse símbolo "
                         "com o seu código de conexão e espere o \"EA CONECTADO\"." % sim)
    est = str(p.get("est") or "")
    if est not in ("TODAS", "AUTO") and est not in ESTRATEGIAS:
        raise ValueError("Escolha a estratégia.")
    corretora._hhmm(p.get("hora_ini") or 0)                   # horario invalido: erro ANTES de ligar o teste
    corretora._hhmm(p.get("hora_fim") or 0)
    antigo =CONEX.publico(uid)["cfg"].get("teste")
    x = TESTES.ligar(uid, dict(ativo="MT5:" + sim, tf=_int({"tf": [p.get("tf")]}, "tf", 5), est=est, gestao=p.get("gestao"),
                               contratos=p.get("contratos") or 1, capital=p.get("capital") or 10000, maxstops=p.get("maxstops") or 2,
                               qual=p.get("qual") or "", cods=p.get("cods") or "", regra=p.get("regra") or "", brl=p.get("brl"),
                               prot=p.get("prot") or [], seletivo=p.get("seletivo")))
    if antigo and str(antigo) != str(x["id"]):
        try:
            TESTES.parar(uid, antigo)
        except Exception:
            pass
    CONEX.acao(uid, dict(acao="config", simbolo=sim, ativo=p.get("ativo") or "WIN", teste=x["id"], mult=p.get("mult") or 1,
                         max_lote=p.get("max_lote") or 1, perda_dia=p.get("perda_dia") or 0, max_ops=p.get("max_ops") or 0,
                         hora_ini=p.get("hora_ini") or 0, hora_fim=p.get("hora_fim") or 0), ip)
    r = CONEX.acao(uid, dict(acao="ligar", ligado=True), ip)
    ACESSOS.registrar("piloto_ligado", u["email"], "%s %s %s min nota %s" % (sim, est, x["tf"], p.get("qual") or "todas"), ip)
    return r


_LISTA = {"t": 0.0, "v": {}}
_LISTA_TRAVA = threading.Lock()


def api_lista(q):
    """Lista de cotacoes do mercado aberto no topo (como a lista do TradingView): ultimo preco, variacao do dia e se o
    mercado esta aberto. Bolsa e mundo: um pedido so ao Yahoo para varios simbolos (spark), guardado por 10 s.
    Cripto: Binance (24 h)."""
    mercado = q.get("mercado", ["b3"])[0]
    if mercado == "cripto":
        d = api_cripto_mercado()
        return dict(itens=[dict(chave=x["chave"], nome=x["moeda"] + "/USDT", preco=x["preco"], varPct=x["var"],
                                var=x["preco"] - x["preco"] / (1 + x["var"] / 100.0), aberto=True, dec=None) for x in d.get("moedas", [])])
    chaves = [k for k, v in df.ATIVOS.items() if v.get("mercado") != "cripto" and v.get("yahoo")]
    if mercado == "opcoes":
        chaves = [k for k in chaves if df.ATIVOS[k].get("grupo") == "Ações da B3" or k in ("WIN", "BOVA11")]
    with _LISTA_TRAVA:
        faltam = [k for k in chaves if time.time() - _LISTA["v"].get(k, {}).get("_t", 0) > 10]
        for i in range(0, len(faltam), 20):
            parte = faltam[i:i + 20]
            sims = ",".join(urllib.parse.quote(df.ATIVOS[k]["yahoo"], safe="") for k in parte)
            try:
                req = urllib.request.Request("https://query1.finance.yahoo.com/v7/finance/spark?symbols=%s&range=1d&interval=5m" % sims,
                                             headers={"User-Agent": "Mozilla/5.0"})
                with urllib.request.urlopen(req, timeout=12) as r:
                    js = json.loads(r.read().decode("utf-8"))
            except Exception:
                continue
            por_sim = {x.get("symbol"): x for x in (js.get("spark") or {}).get("result") or []}
            for k in parte:
                cfg = df.ATIVOS[k]
                x = por_sim.get(cfg["yahoo"])
                try:
                    m = x["response"][0]["meta"]
                    esc = cfg.get("escala", 1.0)
                    preco, ant = m["regularMarketPrice"] * esc, (m.get("previousClose") or m.get("chartPreviousClose")) * esc
                    t = m.get("regularMarketTime") or 0
                except (TypeError, KeyError, IndexError):
                    continue
                # aberto: negociou nos ultimos 20 min (B3 tem ~15 min de atraso na fonte gratuita)
                _LISTA["v"][k] = dict(chave=k, nome=cfg.get("curto") or cfg["nome"].split(" - ")[0].split(" (")[0], preco=preco,
                                      var=preco - ant, varPct=100.0 * (preco - ant) / ant if ant else 0.0,
                                      aberto=time.time() - t < (35 * 60 if cfg.get("mercado") == "b3" else 20 * 60),
                                      dec=cfg["decimais"], _t=time.time())
        itens = [{kk: vv for kk, vv in _LISTA["v"][k].items() if kk != "_t"} for k in chaves if k in _LISTA["v"]]
    for x in itens:                                    # ouro e prata: o preco a vista ao vivo (igual ao grafico e ao TradingView)
        if x["chave"] in tempo_real.SWISS:
            u = tempo_real.ultimo(x["chave"])
            if u:
                pct = x["varPct"]
                x.update(preco=u[1], var=u[1] * pct / (100.0 + pct), aberto=time.time() - u[0] < 180)
    return dict(itens=itens)


_MERCADO_CR = {"t": 0.0, "v": None}


def api_cripto_mercado():
    """As principais criptomoedas em 24 h (Binance): preco, variacao e volume. Guardado por 20 s."""
    if _MERCADO_CR["v"] and time.time() - _MERCADO_CR["t"] < 20:
        return _MERCADO_CR["v"]
    syms = ["%sUSDT" % m for m, _ in CRIPTOS]
    lista = cripto._get(cripto.SPOT, "/api/v3/ticker/24hr?symbols=" + urllib.parse.quote(json.dumps(syms, separators=(",", ":"))), timeout=12)
    nomes = dict(CRIPTOS)
    out = []
    for x in lista if isinstance(lista, list) else []:
        sym = x.get("symbol", "")
        base = sym[:-4]
        try:
            out.append(dict(chave="BN:" + sym, moeda=base, nome=nomes.get(base, base), preco=float(x["lastPrice"]),
                            var=float(x["priceChangePercent"]), volume=float(x["quoteVolume"]), alta=float(x["highPrice"]),
                            baixa=float(x["lowPrice"])))
        except (KeyError, TypeError, ValueError):
            continue
    out.sort(key=lambda z: -z["volume"])
    v = dict(moedas=out, usdbrl=_usdbrl(), quando=int(time.time()))
    _MERCADO_CR.update(t=time.time(), v=v)
    return v


# ------------------------------------------------------------------------------------------ gestoes lado a lado
STOPS_LADO = (("base", ()), ("curto", ("curto",)), ("be20", ("be20",)), ("curto+be20", ("be20", "curto")))
def api_gestoes(q):
    """A mesma estrategia, no mesmo periodo, com cada gestao (alvo fixo, parcial, conducao, trailing...)."""
    P = _pedido(q)
    B, fonte, cfg = carregar(P["chave"], P["tf"])
    tf = B.get("tf", P["tf"])
    sc = df.sessao_cfg(cfg)
    contratos = P["contratos"] if cfg.get("fracionado") else max(1.0, round(P["contratos"]))
    d = B["d"]
    per = q.get("per", ["tudo"])[0]
    i_ini, i_fim = janela(d, per if per in PERIODOS else "tudo", _int(q, "de", 0), _int(q, "ate", 0))
    codigos = P["codigos"]
    aberto = formando(B, cfg, P["chave"])
    linhas = []
    # cada gestao (o que fazer com o ganho) com cada jeito de stop: o da estrategia, curto (1 ATR), 0x0 aos 20% e os dois
    outras = tuple(x for x in P["plano"]["prot"] if x not in ("curto", "be20"))
    P["plano"] = dict(P["plano"], regras={})
    com_stops = q.get("stops", ["0"])[0] == "1"
    for g in GESTOES:
        linha = None
        for nome_s, extra in STOPS_LADO if com_stops else (("plano", None),):
            pl = P["plano"] if extra is None else dict(P["plano"], prot=tuple(sorted(outras + extra)))
            with TRAVA:
                Gs = graficos(P["chave"], tf, B, sc, aberto)
                r = simular_c(P["chave"], tf, B, Gs, sc, codigos, i_ini, i_fim, aberto, gestao=g, contratos=contratos,
                              max_stops=P["max_stops"], juntas=P["todas"], plano=pl)
            st = estatisticas(r["trades"], P["capital"], lambda i: d[i])
            perdas = [x["dinheiro"] for x in r["trades"] if x["dinheiro"] < 0]
            cel = dict(n=st["n"], total=st.get("total", 0.0), acerto=st.get("acerto"), ddMax=st.get("ddMax", 0.0),
                       perdaMedia=(sum(perdas) / len(perdas)) if perdas else 0.0)
            atual_s = extra is None or tuple(sorted(extra)) == tuple(x for x in P["plano"]["prot"] if x in ("curto", "be20"))
            if linha is None or atual_s:
                base = dict(n=st["n"], total=st.get("total", 0.0), media=st.get("mediaDin"), expR=st.get("expR"), acerto=st.get("acerto"),
                            ddMax=st.get("ddMax", 0.0), maiorR=max([x["R"] for x in r["trades"]], default=None),
                            veredito=st.get("veredito"), cor=st.get("cor"))
                linha = dict(linha or {}, gestao=g, nome=GESTOES_CURTO.get(g, g), **base)
            linha.setdefault("stops", {})[nome_s] = cel
        linhas.append(linha)
    return dict(linhas=linhas, atual=P["gestao"], comStops=com_stops, stopAtual="+".join(x for x in ("curto", "be20") if x in P["plano"]["prot"]) or "base", moeda=cfg.get("moeda", "R$"), est=P["est"], dataIni=d[max(AQUECIMENTO, i_ini)], dataFim=d[i_fim],
                contratos=contratos, fracionado=sc["fracionado"])


# ------------------------------------------------------------------------------------------ ajuste (aba IA)
AJUSTE_PROT = ((), ("corte",), ("forca",), ("corte", "forca"), ("folga",), ("corte", "folga", "forca"))


def api_ajuste(q):
    """Procura a combinacao de gestao + protecoes do stop que mais rendeu nesta estrategia, neste ativo e tempo. Para nao
    escolher por sorte, a escolha e feita so com a PRIMEIRA metade do historico e depois conferida na SEGUNDA metade,
    que ela nao viu. So vira sugestao se ganhar da configuracao atual tambem na segunda metade."""
    P = _pedido(q)
    B, fonte, cfg = carregar(P["chave"], P["tf"])
    tf = B.get("tf", P["tf"])
    sc = df.sessao_cfg(cfg)
    contratos = P["contratos"] if cfg.get("fracionado") else max(1.0, round(P["contratos"]))
    d = B["d"]
    n = len(d)
    meio = AQUECIMENTO + (n - AQUECIMENTO) // 2
    codigos = P["codigos"]

    def medir(g, prot, a, b):
        pl = dict(P["plano"], prot=prot)
        with TRAVA:
            Gs = graficos(P["chave"], tf, B, sc, False)
            r = simular_c(P["chave"], tf, B, Gs, sc, codigos, a, b, False, gestao=g, contratos=contratos, max_stops=P["max_stops"],
                          juntas=P["todas"], plano=pl)
        st = estatisticas(r["trades"], P["capital"], lambda i: d[i])
        return dict(n=st["n"], total=st.get("total", 0.0), media=st.get("mediaDin"), acerto=st.get("acerto"), ddMax=st.get("ddMax", 0.0))
    linhas = []
    for g in GESTOES:
        for prot in AJUSTE_PROT:
            linhas.append(dict(gestao=g, nome=GESTOES_CURTO.get(g, g), prot=list(prot), treino=medir(g, prot, None, meio - 1)))
    atual_prot = tuple(P["plano"]["prot"])
    atual = dict(gestao=P["gestao"], nome=GESTOES_CURTO.get(P["gestao"], P["gestao"]), prot=list(atual_prot),
                 treino=medir(P["gestao"], atual_prot, None, meio - 1), prova=medir(P["gestao"], atual_prot, meio, n - 2))
    validas = [x for x in linhas if x["treino"]["n"] >= 15]
    validas.sort(key=lambda x: -(x["treino"]["media"] or -1e18))
    melhores = validas[:3]
    for x in melhores:
        x["prova"] = medir(x["gestao"], tuple(x["prot"]), meio, n - 2)
    top = melhores[0] if melhores else None
    aprovada = bool(top and top["prova"]["n"] >= 15 and (top["prova"]["media"] or 0) > 0
                    and (top["prova"]["media"] or 0) > (atual["prova"]["media"] or 0))
    return dict(atual=atual, melhores=melhores, aprovada=aprovada, testadas=len(linhas), moeda=cfg.get("moeda", "R$"),
                dataMeio=d[meio], dataIni=d[AQUECIMENTO], dataFim=d[-1], est=P["est"], protecoes=PROTECOES,
                nomeTf=df.NOME_TEMPO.get(tf, "%d min" % tf))


# ------------------------------------------------------------------------------------------ testes ao vivo (Sentinela)
def pasta_de(uid):
    """Pasta dos arquivos de um usuario. O administrador principal usa a propria pasta de dados (o que ja existia e dele)."""
    raiz = df.pasta_dados(BASE)
    if uid == auth.ADMIN_ID:
        return raiz
    if not auth.ID_OK.match(uid or ""):
        raise ValueError("usuário inválido")
    p = os.path.join(raiz, "usuarios", uid)
    os.makedirs(p, exist_ok=True)
    return p


def _pode_usar(uid):
    """O usuario existe, esta ativo e (se o site exige) tem assinatura valida. Sem isso: nada de EA, testes ao vivo ou avisos."""
    u = ACESSOS.por_id(uid) if ACESSOS else None
    return bool(u and u.get("ativo") and SITE.ativa(u))


def _ler_json(arq, padrao):
    try:
        with open(arq, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


_TRAVAS_ARQ = {}
_TRAVAS_ARQ_T = threading.Lock()


def _gravar_json(arq, obj):
    """Grava num arquivo temporario so desta gravacao e troca de uma vez; um arquivo e gravado por uma thread por vez."""
    k = os.path.normcase(os.path.abspath(arq))
    with _TRAVAS_ARQ_T:
        trava = _TRAVAS_ARQ.setdefault(k, threading.Lock())
    with trava:
        if os.path.exists(arq):
            shutil.copyfile(arq, arq + ".bak")
        fd, tmp = tempfile.mkstemp(prefix=os.path.basename(arq) + ".", suffix=".tmp", dir=os.path.dirname(arq) or ".")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(obj, f, ensure_ascii=False)
            os.replace(tmp, arq)
        except BaseException:
            try:
                os.remove(tmp)
            except OSError:
                pass
            raise


CAMPOS_TESTE = ("ativo", "tf", "est", "gestao", "contratos", "capital", "maxstops", "tam", "risco", "lossDia", "metaDia", "seletivo", "prot",
                "cods", "regra", "qual")


def _calc_teste(x, B, fonte, cfg, uid=None):
    """Resultado de um teste ao vivo (simulado): a estrategia e ligada no candle `desde` e so entra depois dele."""
    chave, tf = x["ativo"], B.get("tf", x["tf"])
    est = x["est"]
    todas = est == "TODAS"
    gestao = x.get("gestao") if x.get("gestao") in GESTOES else "padrao"
    sc = df.sessao_cfg(cfg)
    contratos = float(x.get("contratos") or 1.0)
    if not cfg.get("fracionado"):
        contratos = max(1.0, round(contratos))
    capital = float(x.get("capital") or 10000.0)
    pl = dict(tam="risco" if x.get("tam") == "risco" else "fixo", risco_pct=float(x.get("risco") or 1.0), capital=capital,
              loss_dia=float(x.get("lossDia") or 0.0), meta_dia=float(x.get("metaDia") or 0.0), seletivo=bool(x.get("seletivo")),
              prot=tuple(sorted(p for p in (x.get("prot") or []) if p in PROTECOES)), regras=regras_de(x.get("regra")),
              qual=x.get("qual") if x.get("qual") in ("A+", "A", "B") else "")
    if x.get("brl") and cfg.get("moeda") == "US$":
        cambio = _usdbrl()
        if cambio:
            capital = capital / cambio
            pl.update(capital=capital, loss_dia=pl["loss_dia"] / cambio, meta_dia=pl["meta_dia"] / cambio)
    t, d = B["t"], B["d"]
    n = len(t)
    desde, ate = int(x["desde"]), int(x.get("ate") or 0)
    i_ini = max(AQUECIMENTO, bisect.bisect_right(t, desde))
    i_fim = (bisect.bisect_right(t, ate) - 1) if ate else n - 1
    aberto = formando(B, cfg, chave) and i_fim == n - 1
    k = max(0, min(i_fim, n - 1))
    meta = dict(ativo=chave, nome=cfg.get("curto") or cfg["nome"].split(" - ")[0], tf=tf, nomeTf=df.NOME_TEMPO.get(tf, "%d min" % tf), est=est,
                gestao=gestao, contratos=contratos, moeda=cfg.get("moeda", "R$"), decimais=cfg["decimais"], tick=cfg["tick"],
                valorPonto=sc["valor_ponto"], custo=sc["custo"], custoPct=sc.get("custo_pct", 0.0), fracionado=sc["fracionado"],
                intraday=tf < 1440, desde=desde, ultimoT=t[k], preco=B["c"][k], candles=max(0, i_fim - i_ini + 1), formando=aberto,
                fonte=fonte, tam=pl["tam"], riscoPct=pl["risco_pct"], lossDia=pl["loss_dia"], metaDia=pl["meta_dia"],
                seletivo=pl["seletivo"], capital=capital, sid=B.get("sid"), prot=list(pl["prot"]))
    if i_ini > i_fim:
        return dict(meta=meta, trades=[], abertas=[], pend=[], ajPend=[], stats=estatisticas([], capital, lambda i: d[i]))
    ajustes = [a for a in (x.get("ajustes") or []) if isinstance(a, dict)]
    ajustes = [a for a in edicoes_de(uid, chave, tf) if a["t"] >= desde] + ajustes      # edicoes do E se... nas operacoes do teste
    with TRAVA:
        Gs = graficos(chave, tf, B, sc, formando(B, cfg, chave))
        codigos = ([c for c in str(x.get("cods") or "").split(",") if c in ESTRATEGIAS] or list(ESTRATEGIAS)) if todas else [est]
        r = simular_c(chave, tf, B, Gs, sc, codigos, i_ini, i_fim, aberto, gestao=gestao, contratos=contratos,
                      max_stops=int(x.get("maxstops") or 2), juntas=todas, plano=pl, ajustes=ajustes or None)
    meta["dia"] = r["dia"]
    for tr in r["trades"]:
        tr.update(t_sinal=t[tr["i_sinal"]], t_ent=t[tr["i_ent"]], t_sai=t[tr["i_sai"]])
    for ab in r["abertas"]:
        ab.update(t_sinal=t[ab["i_sinal"]], t_ent=t[ab["i_ent"]])
    pend = [od for od in r["ordens"] if od["status"] == "pendente"]
    for od in pend:
        od["t_sinal"] = t[od["i_sinal"]]
    r["ordens"] = pend
    meta["ia"] = IA.anotar(chave, tf, gestao, contratos, r, t)
    # stop/alvo movidos no candle que ainda esta aberto: so valem no proximo (a tela mostra como "a partir do proximo candle")
    aj_pend = [a for a in ajustes if a.get("tipo") in ("stop", "alvo") and bisect.bisect_right(t, a["t"]) - 1 >= i_fim]
    return dict(meta=meta, trades=r["trades"], abertas=r["abertas"], pend=pend, ajPend=aj_pend,
                stats=estatisticas(r["trades"], capital, lambda i: d[i]))


def _ch_ordem(o):
    return "%s|%d|%d" % (o["est"], o["t_sinal"], o["dir"])


def _ch_pos(a):
    return "%s|%d" % (a["est"], a["t_ent"])


def _novidades(antes, depois):
    """O que aconteceu entre dois resultados do mesmo teste: ordem armada, entrada executada, saida."""
    t_antes = antes["meta"]["ultimoT"]
    vp, va, vt = {_ch_ordem(o) for o in antes["pend"]}, {_ch_pos(a) for a in antes["abertas"]}, {_ch_pos(x) for x in antes["trades"]}
    ev = []
    for x in depois["trades"]:
        if _ch_pos(x) not in vt and x["t_sai"] >= t_antes:
            if _ch_pos(x) not in va:
                ev.append(("entrada", x))                      # entrou e saiu entre duas rodadas
            ev.append(("saida", x))
    for a in depois["abertas"]:
        if _ch_pos(a) not in va:
            ev.append(("entrada", a))
    for o in depois["pend"]:
        if _ch_ordem(o) not in vp:
            ev.append(("ordem", o))
    return ev


class Sentinela:
    """Os testes ao vivo de todos os usuarios. Uma thread refaz cada teste ativo a cada poucos segundos (a conta e leve:
    retomada + candles em memoria), compara com a rodada anterior e gera os eventos que a tela mostra/toca e que viram
    aviso no Telegram. Funciona com a tela fechada: basta o robo estar aberto."""

    def __init__(self):
        self.trava = threading.RLock()
        self.listas, self.res, self.selo, self.rodou = {}, {}, {}, {}
        self.vez = {}                                 # (uid, id do teste) -> trava: um calculo por vez de cada teste
        self.conferido = {}                           # (uid, id do teste) -> quando foi conferido com os candles de agora
        self.eventos = {}                             # uid -> deque dos ultimos eventos
        self.ult_seq = 0
        self.novo = threading.Condition()             # avisa quem esta esperando um evento novo (ver `esperar`)
        self.carteiro = avisos.Carteiro()
        self.cfg_avisos = {}

    def _prox_seq(self):
        """Numero do proximo evento: sempre maior que o anterior, mesmo depois de fechar e abrir o robo (vem do relogio)."""
        with self.trava:
            self.ult_seq = max(self.ult_seq + 1, int(time.time() * 1000))
            return self.ult_seq

    # ---------------------------------------------------------------- arquivos
    def lista(self, uid):
        with self.trava:
            if uid not in self.listas:
                bruto = _ler_json(os.path.join(pasta_de(uid), "estado_testes.json"), [])
                ok = []
                for x in bruto if isinstance(bruto, list) else []:
                    if (isinstance(x, dict) and x.get("id") and x.get("ativo") and (x.get("est") in ("TODAS", "AUTO") or x.get("est") in ESTRATEGIAS)
                            and isinstance(x.get("desde"), (int, float)) and x["desde"] > 0):
                        x.setdefault("ajustes", [])
                        x.pop("erro", None)
                        ok.append(x)
                self.listas[uid] = ok
                self.eventos[uid] = collections.deque(self._ler_eventos(uid), maxlen=300)
                if self.eventos[uid]:
                    self.ult_seq = max(self.ult_seq, max(e["seq"] for e in self.eventos[uid]))
            return self.listas[uid]

    def _gravar(self, uid):
        try:
            _gravar_json(os.path.join(pasta_de(uid), "estado_testes.json"), self.listas[uid])
        except OSError:
            pass

    def _ler_eventos(self, uid):
        out = []
        try:
            with open(os.path.join(pasta_de(uid), "sinais.jsonl"), encoding="utf-8") as f:
                for ln in f.readlines()[-300:]:
                    try:
                        ev = json.loads(ln)
                        if isinstance(ev, dict) and isinstance(ev.get("seq"), int) and ev.get("tipo") in ("ordem", "entrada", "saida"):
                            out.append(ev)
                    except ValueError:
                        pass
        except OSError:
            pass
        out.sort(key=lambda e: e["seq"])
        return out

    def avisos_de(self, uid):
        with self.trava:
            if uid not in self.cfg_avisos:
                self.cfg_avisos[uid] = avisos.config_valida(_ler_json(os.path.join(pasta_de(uid), "estado_avisos.json"), {}))
            return self.cfg_avisos[uid]

    def gravar_avisos(self, uid, novo):
        """novo = o que veio da tela; codigo vazio = manter o que ja estava gravado."""
        atual = self.avisos_de(uid)
        cfg = avisos.config_valida(novo)
        if not cfg["telegram"]["token"]:
            cfg["telegram"]["token"] = atual["telegram"]["token"]
        if (novo.get("telegram") or {}).get("apagar"):
            cfg["telegram"].update(token="", chat="", ligado=False)
        erro = avisos.erro_de_config(cfg)
        if erro:
            raise ValueError(erro)
        with self.trava:
            self.cfg_avisos[uid] = cfg
            _gravar_json(os.path.join(pasta_de(uid), "estado_avisos.json"), cfg)
        return cfg

    # ---------------------------------------------------------------- acoes do usuario
    @staticmethod
    def _combo(x):
        return "%s|%s|%s" % (x["ativo"], int(x["tf"]), x["est"])

    def ligar(self, uid, p):
        chave, tf, est = str(p.get("ativo", "")), int(p.get("tf", 5)), str(p.get("est", ""))
        if est not in ("TODAS", "AUTO") and est not in ESTRATEGIAS:
            raise ValueError("estratégia desconhecida")
        if chave.startswith("CSV:"):
            raise ValueError("Arquivo CSV não recebe candles novos: escolha um ativo ao vivo.")
        B, _, cfg = carregar(chave, tf)
        x = dict(id=int(time.time() * 1000), ativo=chave, tf=B.get("tf", tf), est=est,
                 gestao=p.get("gestao") if p.get("gestao") in GESTOES else "padrao",
                 contratos=max(0.01, float(p.get("contratos") or 1)), capital=max(1.0, float(p.get("capital") or 10000)),
                 maxstops=max(1, min(50, int(p.get("maxstops") or 2))), desde=B["t"][-1], criado=int(time.time() * 1000), ate=0,
                 tam="risco" if p.get("tam") == "risco" else "fixo", risco=max(0.05, min(20.0, float(p.get("risco") or 1))),
                 lossDia=max(0.0, float(p.get("lossDia") or 0)), metaDia=max(0.0, float(p.get("metaDia") or 0)),
                 seletivo=bool(p.get("seletivo")), prot=[z for z in (p.get("prot") or []) if z in PROTECOES], ajustes=[],
                 cods=",".join(c for c in str(p.get("cods") or "").split(",") if c in ESTRATEGIAS), brl=bool(p.get("brl")),
                 regra=",".join("%s:%g:%g" % (k, v[0], v[1]) for k, v in regras_de(p.get("regra")).items()),
                 qual=p.get("qual") if p.get("qual") in ("A+", "A", "B") else "")
        with self.trava:
            l = self.lista(uid)
            if len([y for y in l if not y.get("ate")]) >= 30:
                raise ValueError("Limite de 30 testes ao vivo ligados ao mesmo tempo.")
            for y in [y for y in l if self._combo(y) == self._combo(x)]:
                l.remove(y)
                self._esquecer(uid, y["id"])
            l.append(x)
            self._gravar(uid)
        return x

    def para_ea(self, uid, tid):
        """(teste, resultado, quando foi conferido) para o EA, ou None."""
        with self.trava:
            x = next((y for y in self.lista(uid) if str(y["id"]) == str(tid)), None)
            if x is None:
                return None
            k = (uid, x["id"])
            r, q = self.res.get(k), self.conferido.get(k, 0)
        if r is None:
            r = self.rodar(uid, x)
            q = self.conferido.get(k, 0)
        return (x, r, q) if r else None

    def trocar_regras(self, uid, txt):
        """A "Minha regra" mudou na tela: vale tambem para os testes ao vivo ligados (a operacao aberta segue a regra nova)."""
        txt = ",".join("%s:%g:%g" % (k, v[0], v[1]) for k, v in regras_de(txt).items())
        with self.trava:
            mudou = 0
            for x in self.lista(uid):
                if not x.get("ate") and (x.get("regra") or "") != txt:
                    x["regra"] = txt
                    self._esquecer(uid, x["id"])
                    mudou += 1
            if mudou:
                self._gravar(uid)
        return mudou

    def _achar(self, uid, tid):
        x = next((y for y in self.lista(uid) if str(y["id"]) == str(tid)), None)
        if x is None:
            raise ValueError("teste não encontrado")
        return x

    def _esquecer(self, uid, tid):
        for d in (self.res, self.selo, self.rodou, self.vez):
            d.pop((uid, tid), None)

    def parar(self, uid, tid):
        with self.trava:
            x = self._achar(uid, tid)
            if not x.get("ate"):
                r = self.res.get((uid, x["id"]))
                ult = r and r["meta"]["ultimoT"]
                if not ult:
                    try:
                        ult = carregar(x["ativo"], x["tf"])[0]["t"][-1]
                    except Exception:
                        ult = None
                x["ate"] = int(ult or x["desde"])
                self._esquecer(uid, x["id"])
                self._gravar(uid)
            return x

    def apagar(self, uid, tid):
        with self.trava:
            x = self._achar(uid, tid)
            self.listas[uid].remove(x)
            self._esquecer(uid, x["id"])
            self._gravar(uid)

    def ajustar(self, uid, tid, p):
        """Ajuste manual num teste ligado: mover stop/alvo (vale do proximo candle em diante), sair, entrar ou cancelar agora."""
        x = self._achar(uid, tid)
        if x.get("ate"):
            raise ValueError("Este teste já foi encerrado.")
        tipo, ch = p.get("tipo"), str(p.get("chave", ""))
        if tipo not in ("stop", "alvo", "sair", "entrar", "cancelar"):
            raise ValueError("ajuste desconhecido")
        if len(x.get("ajustes") or []) >= 60:
            raise ValueError("Limite de 60 ajustes manuais neste teste.")
        B, fonte, cfg = carregar(x["ativo"], x["tf"])
        r = _calc_teste(x, B, fonte, cfg, uid)
        pos = next((a for a in r["abertas"] if _ch_ordem(a) == ch), None)
        od = next((o for o in r["pend"] if _ch_ordem(o) == ch), None)
        alvo_obj = pos or od
        if alvo_obj is None:
            raise ValueError("Essa operação não está mais aberta (a tela estava desatualizada).")
        aberto = r["meta"]["formando"]
        preco, tick = B["c"][-1], cfg["tick"]
        d = alvo_obj["dir"]
        # O ajuste fica preso ao ULTIMO CANDLE que o robo conhece (o do preco que a pessoa esta vendo), nao ao relogio do
        # computador: com o relogio alguns segundos atrasado ele cairia no candle anterior (ja fechado, e o aviso nem
        # saia), e num ativo com dados atrasados (WIN/WDO pelo Yahoo) ele mudaria de candle conforme os dados chegassem.
        aj = dict(t=int(B["t"][-1]), tipo=tipo, chave=ch)
        if tipo in ("stop", "alvo"):
            try:
                v = round(float(str(p.get("valor")).replace(",", ".")) / tick) * tick
            except (TypeError, ValueError):
                raise ValueError("preço inválido")
            v = round(v, cfg["decimais"] + 2)
            ref = preco if pos else (od["gatilho"] if od["gatilho"] is not None else preco)
            if tipo == "stop" and not (v < ref if d > 0 else v > ref):
                raise ValueError("O stop precisa ficar %s do preço de %s." % ("abaixo" if d > 0 else "acima", "agora" if pos else "entrada"))
            if tipo == "alvo" and not (v > ref if d > 0 else v < ref):
                raise ValueError("O alvo precisa ficar %s do preço de %s." % ("acima" if d > 0 else "abaixo", "agora" if pos else "entrada"))
            if v <= 0:
                raise ValueError("preço inválido")
            aj["valor"] = v
        else:
            if not aberto:
                raise ValueError("O mercado deste ativo está fechado agora: não há preço para executar.")
            if tipo == "sair" and pos is None:
                raise ValueError("Não há operação aberta para sair.")
            if tipo in ("entrar", "cancelar") and od is None:
                raise ValueError("Não há ordem armada.")
            if tipo == "entrar" and not (preco > od["stop"] if d > 0 else preco < od["stop"]):
                raise ValueError("O preço já passou do stop desta ordem.")
            aj.update(preco=preco, h=B["h"][-1], l=B["l"][-1])
        with self.trava:
            x.setdefault("ajustes", []).append(aj)
            self.selo.pop((uid, x["id"]), None)
            self._gravar(uid)
        self.rodar(uid, x, forcar=True)
        return aj

    # ---------------------------------------------------------------- rodadas
    def rodar(self, uid, x, forcar=False):
        """Refaz o teste x se os candles mudaram. Devolve o resultado (ou None se o teste foi apagado no meio)."""
        k = (uid, x["id"])
        _UID.v = uid                                  # ativo MT5:... do teste = os candles do EA DESTE usuario
        with self.trava:
            vez = self.vez.setdefault(k, threading.Lock())
        # Um calculo por vez de cada teste (a thread do Sentinela e os pedidos da tela chegam ao mesmo tempo): os candles
        # sao lidos ja com a vez na mao, entao um resultado nunca e trocado por outro feito com candles mais velhos, e a
        # comparacao "antes x depois" que gera os avisos nunca anda para tras (seria aviso repetido).
        with vez:
            try:
                B, fonte, cfg = carregar(x["ativo"], x["tf"])
                selo = (B.get("sid"), formando(B, cfg, x["ativo"]), x.get("ate"), len(x.get("ajustes") or []),
                        IA_estado(x["ativo"], B.get("tf", x["tf"]), x.get("gestao", "padrao"), x.get("contratos", 1)),
                        _ed_versao(uid), x.get("regra") or "")
                if not forcar and self.selo.get(k) == selo and k in self.res:
                    self.conferido[k] = time.time()
                    return self.res[k]
                r = _calc_teste(x, B, fonte, cfg, uid)
            except Exception as e:
                x["erro"] = str(e)
                return None
            with self.trava:
                if x not in self.listas.get(uid, []):
                    return None
                antes, selo_antes = self.res.get(k), self.selo.get(k)
                self.res[k], self.selo[k] = r, selo
                self.conferido[k] = time.time()
                x.pop("erro", None)
                # edicao ou regra nova refaz o teste inteiro: o que mudou no passado nao vira aviso de "saiu agora"
                so_regra = selo_antes is not None and selo_antes[:5] == selo[:5] and selo_antes[5:] != selo[5:]
                if antes is not None and not x.get("ate") and not so_regra:
                    self._eventos(uid, x, _novidades(antes, r), r["meta"])
            return r

    def _eventos(self, uid, x, novos, meta):
        if not novos:
            return
        cfg = self.avisos_de(uid)
        linhas = []
        for tipo, o in novos:
            ev = dict(seq=self._prox_seq(), quando=round(time.time(), 1), teste=x["id"], ativo=x["ativo"], nome=meta["nome"], tf=meta["tf"],
                      nomeTf=meta["nomeTf"], est=o["est"], tipo=tipo, dir=o["dir"], dec=meta["decimais"], moeda=meta["moeda"],
                      chave=_ch_ordem(o), stop=o.get("stop_ini", o.get("stop")), alvo=o.get("alvo"), ia=o.get("ia"),
                      iaOk=bool((meta.get("ia") or {}).get("comprovada")))
            if tipo == "ordem":
                ev.update(gatilho=o.get("gatilho"), ordem=o.get("tipo"))
                try:                                           # ponte com o Profit em modo simulador: a ordem fica so registrada
                    if uid != auth.ADMIN_ID:                   # (so a do administrador: o arquivo do Profit e um so)
                        raise ValueError("so o administrador")
                    profit.Roteador(df.pasta_dados(BASE)).enviar(profit.Ordem(
                        x["ativo"], o["dir"], "mercado" if o.get("gatilho") is None else ("limite" if o.get("tipo") == "limite" else "stop"),
                        o.get("gatilho"), o.get("stop"), o.get("alvo"), o.get("q") or x.get("contratos") or 1, "%s teste %s" % (o["est"], x["id"])))
                except (OSError, ValueError):
                    pass
            else:
                ev.update(ent=o.get("ent"))
            if tipo == "saida":
                ev.update(sai=o.get("sai"), R=round(o["R"], 3), dinheiro=round(o["dinheiro"], 2), motivo=o.get("motivo"), tipo="saida",
                          ganho=o["R"] > 0)
            self.eventos[uid].append(ev)
            linhas.append(json.dumps(ev, ensure_ascii=False))
            if cfg["tipos"].get(tipo, True) and _pode_usar(uid):      # conta desativada ou sem assinatura: sem avisos
                self.carteiro.postar(uid, cfg, avisos.texto_evento(ev))
        try:
            with open(os.path.join(pasta_de(uid), "sinais.jsonl"), "a", encoding="utf-8") as f:
                f.write("\n".join(linhas) + "\n")
        except OSError:
            pass
        with self.novo:
            self.novo.notify_all()

    def esperar(self, uid, seq, limite):
        """Segura o pedido ate aparecer um evento mais novo que `seq` (ou passar `limite` segundos). Com isso a tela recebe
        o sinal na hora mesmo minimizada: o navegador atrasa os relogios de uma janela escondida, mas nao as respostas."""
        self.lista(uid)
        fim = time.time() + limite
        with self.novo:
            while True:
                evs = self.eventos.get(uid)
                falta = fim - time.time()
                if falta <= 0 or (evs and evs[-1]["seq"] > seq):
                    return
                self.novo.wait(min(1.0, falta))

    def laco(self):
        """Thread: roda os testes ativos de todo mundo. Cripto a cada ~6 s, o resto a cada ~12 s."""
        while True:
            try:
                uids = [u["id"] for u in (ACESSOS.usuarios if ACESSOS else [])]
                for uid in uids:
                    if not _pode_usar(uid):                   # desativado ou assinatura vencida: os testes dele param de rodar
                        continue
                    for x in list(self.lista(uid)):
                        if x.get("ate"):
                            continue
                        k = (uid, x["id"])
                        passo = 6.0 if (cripto.eh_cripto(x["ativo"]) or x["ativo"] in historico.BINANCE) else 12.0
                        if time.time() - self.rodou.get(k, 0) < passo:
                            continue
                        self.rodou[k] = time.time()
                        self.rodar(uid, x)
            except Exception:
                traceback.print_exc()
            time.sleep(2.0)

    # ---------------------------------------------------------------- o que a tela pede
    def painel(self, uid, seq=0):
        """Lista dos testes com o resumo de cada um + os eventos mais novos que `seq`."""
        out = []
        for x in list(self.lista(uid)):
            r = self.res.get((uid, x["id"]))
            if r is None:
                r = self.rodar(uid, x, forcar=True)
            item = {k: x.get(k) for k in ("id", "desde", "criado", "ate", "erro") + CAMPOS_TESTE}
            item["nAjustes"] = len(x.get("ajustes") or [])
            if r:
                st, m = r["stats"], r["meta"]
                a = r["abertas"][0] if r["abertas"] else None
                hoje = datetime.now(df.BRT).strftime("%Y%m%d")
                tr_hoje = [y["dinheiro"] for y in r["trades"] if datetime.fromtimestamp(y["t_sai"], df.BRT).strftime("%Y%m%d") == hoje]
                item["res"] = dict(n=st["n"], total=st.get("total", 0.0), hoje=round(sum(tr_hoje), 2), nHoje=len(tr_hoje), acerto=st.get("acerto"), moeda=m["moeda"], decimais=m["decimais"],
                                   nomeTf=m["nomeTf"], nome=m["nome"], intraday=m["intraday"], ultimoT=m["ultimoT"], formando=m["formando"],
                                   estado="parado" if x.get("ate") else ("operacao" if a else ("ordem" if r["pend"] else "espera")),
                                   R=a["R"] if a else None, dir=(a or (r["pend"][0] if r["pend"] else {})).get("dir"),
                                   trava=(m.get("dia") or {}).get("trava"), abertas=len(r["abertas"]), pend=len(r["pend"]))
            out.append(item)
        with self.trava:                              # copia: outra thread pode estar acrescentando um evento agora
            todos = list(self.eventos.get(uid, ()))
        evs = [e for e in todos if e["seq"] > seq]
        ult = todos[-1]["seq"] if todos else 0
        erro = self.carteiro.erro.get(uid)
        return dict(testes=out, eventos=evs[-60:], seq=ult, avisoErro=erro[1] if erro and time.time() - erro[0] < 3600 else None)

    def detalhe(self, uid, tid):
        """O teste inteiro (operacoes, ordens, ajustes). Quem esta com a tela neste teste recebe o calculo em dia: se os
        candles mudaram desde a ultima rodada do Sentinela, refaz na hora (e os avisos saem aqui mesmo)."""
        x = self._achar(uid, tid)
        k = (uid, x["id"])
        r = (self.res.get(k) if x.get("ate") else None) or self.rodar(uid, x) or self.res.get(k)      # teste parado nao muda mais
        if r is None:
            raise RuntimeError(x.get("erro") or "não consegui calcular este teste")
        ult = self.eventos[uid][-1]["seq"] if self.eventos.get(uid) else 0
        return dict(r, trades=_sem_f(r["trades"]), abertas=_sem_f(r["abertas"]), pend=_sem_f(r["pend"]),
                    ajustes=x.get("ajustes") or [], id=x["id"], ate=x.get("ate") or 0, seq=ult)


TESTES = Sentinela()


# ------------------------------------------------------------------------------------------ sons proprios (opcional)
SONS = ("ordem", "entrada", "ganho", "perda", "aviso")
EXT_SOM = (".wav", ".mp3", ".ogg")


def sons_proprios():
    """Arquivos que o usuario colocou em dados/sons (ex.: entrada.wav). Sem arquivo, a tela usa o som sintetizado."""
    pasta = os.path.join(df.pasta_dados(BASE), "sons")
    out = {}
    if os.path.isdir(pasta):
        for arq in os.listdir(pasta):
            nome, ext = os.path.splitext(arq.lower())
            if nome in SONS and ext in EXT_SOM:
                out[nome] = "sons/" + arq
    return out


# ------------------------------------------------------------------------------------------ /api/metas
def api_metas(q):
    """Aba Plano: meta x realidade com as operacoes do periodo, e o efeito de cada regra do plano (com x sem)."""
    P = _pedido(q)
    B, fonte, cfg = carregar(P["chave"], P["tf"])
    tf = B.get("tf", P["tf"])
    sc = df.sessao_cfg(cfg)
    contratos = P["contratos"] if cfg.get("fracionado") else max(1.0, round(P["contratos"]))
    d = B["d"]
    n = len(d)
    per = q.get("per", ["tudo"])[0]
    i_ini, i_fim = janela(d, per if per in PERIODOS else "tudo", _int(q, "de", 0), _int(q, "ate", 0))
    codigos = P["codigos"]
    aberto = formando(B, cfg, P["chave"])
    capital = P["capital"]

    def rodar(pl):
        with TRAVA:
            Gs = graficos(P["chave"], tf, B, sc, aberto)
            return simular_c(P["chave"], tf, B, Gs, sc, codigos, i_ini, i_fim, aberto, gestao=P["gestao"], contratos=contratos,
                             max_stops=P["max_stops"], juntas=P["todas"], plano=pl)

    def medir(pl):
        st = estatisticas(rodar(pl)["trades"], capital, lambda i: d[i])
        return dict(n=st["n"], total=st.get("total", 0.0), media=st.get("mediaDin"), ddMax=st.get("ddMax", 0.0), acerto=st.get("acerto"))
    pl = P["plano"]
    r = rodar(pl)
    st = estatisticas(r["trades"], capital, lambda i: d[i])
    atual = dict(n=st["n"], total=st.get("total", 0.0), media=st.get("mediaDin"), ddMax=st.get("ddMax", 0.0), acerto=st.get("acerto"))
    proj = plano_mod.projetar(r["trades"], d[r["ini"]:r["fim"] + 1], lambda i: d[i], capital,
                              meta_mes=_float(q, "metaMes", 0.0, 0.0, 1e12), queda_max=_float(q, "quedaMax", 0.0, 0.0, 1e12),
                              dias_mes=30 if cfg.get("fim_de_semana") else 21)
    efeitos = [dict(regra="seletivo", ligado=pl["seletivo"], com=atual if pl["seletivo"] else medir(dict(pl, seletivo=True)),
                    sem=medir(dict(pl, seletivo=False)) if pl["seletivo"] else atual)]
    for nome in PROTECOES:                               # cada protecao do stop: a mesma simulacao com e sem ela
        tem = nome in pl["prot"]
        outro = medir(dict(pl, prot=tuple(sorted(set(pl["prot"]) ^ {nome}))))
        efeitos.append(dict(regra="prot_" + nome, ligado=tem, com=atual if tem else outro, sem=outro if tem else atual))
    if pl["tam"] == "risco":
        efeitos.append(dict(regra="tam", ligado=True, com=atual, sem=medir(dict(pl, tam="fixo"))))
    if pl["loss_dia"] > 0 and tf < 1440:
        efeitos.append(dict(regra="lossDia", ligado=True, com=atual, sem=medir(dict(pl, loss_dia=0.0))))
    if pl["meta_dia"] > 0 and tf < 1440:
        efeitos.append(dict(regra="metaDia", ligado=True, com=atual, sem=medir(dict(pl, meta_dia=0.0))))
    return dict(meta=dict(ativo=P["chave"], nome=cfg["nome"], tf=tf, nomeTf=df.NOME_TEMPO.get(tf, "%d min" % tf), est=P["est"],
                          moeda=cfg.get("moeda", "R$"), decimais=cfg["decimais"], contratos=contratos, capital=capital,
                          fracionado=sc["fracionado"], valorPonto=sc["valor_ponto"], custo=sc["custo"], custoPct=sc.get("custo_pct", 0.0),
                          slip=sc["slip"], intraday=tf < 1440, dataIni=d[r["ini"]], dataFim=d[r["fim"]], lote=cfg.get("lote", "contrato"),
                          tam=pl["tam"], riscoPct=pl["risco_pct"], lossDia=pl["loss_dia"], metaDia=pl["meta_dia"], seletivo=pl["seletivo"],
                          aoVivo=i_fim == n - 1),
                proj=proj, efeitos=efeitos, dia=r["dia"], stats=_resumo(st))


# ------------------------------------------------------------------------------------------ /api/radar
RADAR_CACHE = {}
RADAR_LOCK = threading.Lock()


def api_radar(q):
    chave = q.get("ativo", ["WIN"])[0]
    gestao = q.get("gestao", ["padrao"])[0]
    if gestao not in GESTOES:
        gestao = "padrao"
    contratos = _float(q, "contratos", 1.0, 0.01, 10000)
    capital = _float(q, "capital", 10000.0, 1.0, 1e9)
    max_stops = int(_float(q, "maxstops", 2, 1, 50))
    pl = _plano(q, capital)
    ck = (chave, gestao, contratos, capital, max_stops, pl["tam"], pl["risco_pct"], pl["loss_dia"], pl["meta_dia"], pl["seletivo"])
    with RADAR_LOCK:
        if q.get("forcar", ["0"])[0] != "1" and ck in RADAR_CACHE and time.time() - RADAR_CACHE[ck][0] < 600:
            return RADAR_CACHE[ck][1]
    res = radar.rodar(carregar, df.sessao_cfg, chave, gestao, contratos, capital, max_stops, plano=pl, formando=formando)
    res.update(calculado=time.time(), seletivo=pl["seletivo"], tam=pl["tam"], riscoPct=pl["risco_pct"])
    with RADAR_LOCK:
        if len(RADAR_CACHE) > 40:
            RADAR_CACHE.clear()
        RADAR_CACHE[ck] = (time.time(), res)
    return res


# ------------------------------------------------------------------------------------------ comparar (fundo)
CMPS = {}                                       # usuario -> dict(rodando, feito, total, linhas, erro, pedido): cada um ve o seu
CMP_LOCK = threading.Lock()
CMP_MAX = 2                                     # comparativos rodando ao mesmo tempo no servidor (somando todos os usuarios)


def _cmp_de(uid):
    """Chamar com CMP_LOCK."""
    return CMPS.setdefault(uid, dict(rodando=False, feito=0, total=0, linhas=[], erro=None, pedido=None))


def _comparar(uid, pedido):
    _UID.v = uid
    with CMP_LOCK:
        CMP = _cmp_de(uid)
    try:
        ativos = pedido["ativos"]
        with CMP_LOCK:
            CMP.update(total=len(ativos), feito=0, linhas=[], erro=None)
        for a in ativos:
            linha = dict(ativo=a)
            try:
                B, _, cfg = carregar(a, pedido["tf"])
                sc = df.sessao_cfg(cfg)
                d = B["d"]
                i_ini, i_fim = janela(d, pedido["per"], pedido["de"], pedido["ate"])
                linha.update(nome=cfg["nome"], moeda=cfg.get("moeda", "R$"), dataIni=d[i_ini], dataFim=d[i_fim],
                             dias=len(set(d[i_ini:i_fim + 1])))
                res = {}
                aberto = formando(B, cfg, a)
                for cod in list(ESTRATEGIAS) + ["TODAS"]:
                    cods = list(ESTRATEGIAS) if cod == "TODAS" else [cod]
                    if cod != "TODAS" and ESTRATEGIAS[cod]["intraday"] and pedido["tf"] >= 1440:
                        res[cod] = None
                        continue
                    with TRAVA:                                # uma estrategia por vez: a tela ao vivo passa no meio
                        Gs = graficos(a, B.get("tf", pedido["tf"]), B, sc, aberto)
                        r = simular(Gs, sc, cods, gestao=pedido["gestao"], contratos=1.0, max_stops=pedido["maxstops"],
                                    juntas=cod == "TODAS", i_ini=i_ini, i_fim=i_fim, plano=dict(seletivo=pedido.get("seletivo")))
                    res[cod] = _resumo(estatisticas(r["trades"], 10000.0, lambda i: d[i]))
                linha["res"] = res
            except Exception as e:
                linha["erro"] = str(e)
            with CMP_LOCK:
                CMP["linhas"].append(linha)
                CMP["feito"] += 1
    except Exception as e:
        traceback.print_exc()
        with CMP_LOCK:
            CMP["erro"] = "não consegui terminar o comparativo"
    finally:
        with CMP_LOCK:
            CMP["rodando"] = False


CRIPTOS = (("BTC", "Bitcoin"), ("ETH", "Ethereum"), ("SOL", "Solana"), ("BNB", "BNB"), ("XRP", "XRP"), ("DOGE", "Dogecoin"),
           ("ADA", "Cardano"), ("AVAX", "Avalanche"), ("LINK", "Chainlink"), ("TRX", "Tron"), ("LTC", "Litecoin"), ("DOT", "Polkadot"),
           ("SUI", "Sui"), ("TON", "Toncoin"), ("PEPE", "Pepe"), ("SHIB", "Shiba Inu"))


def config(usuario=None):
    out = _config(usuario)
    if usuario and usuario.get("id"):
        for sim in CONEX.simbolos_de(usuario["id"]):
            a = CONEX.ativo_de(usuario["id"], sim)
            base_cfg = df.ATIVOS.get(a) or df.ATIVOS["WIN"]
            out["ativos"].append(dict(chave="MT5:" + sim, nome="%s - MetaTrader 5 (sua corretora, tempo real)" % sim, moeda=base_cfg["moeda"],
                                      lote=base_cfg["lote"], fracionado=base_cfg.get("fracionado", False), mercado=base_cfg.get("mercado", "b3"),
                                      grupo="MetaTrader 5 (sua corretora)"))
    return out


def _config(usuario=None):
    ativos = [dict(chave=k, nome=v["nome"], moeda=v["moeda"], lote=v["lote"], fracionado=v.get("fracionado", False),
                   mercado=v.get("mercado", "mundo"), grupo=v.get("grupo", ""))
              for k, v in df.ATIVOS.items() if k not in historico.BINANCE]         # cripto vem da Binance, abaixo
    ativos += [dict(chave="BN:%sUSDT" % m, nome="%s/USDT - %s" % (m, n), moeda="US$", lote="fração da moeda", fracionado=True,
                    mercado="cripto", grupo="Criptomoedas (Binance, tempo real)") for m, n in CRIPTOS]
    ativos += [dict(chave="CSV:" + n, nome="Arquivo: " + n, moeda="R$", lote="contrato", fracionado=False) for n in df.listar_csv(BASE)]
    ests = [dict(cod=k, nome=v["nome"], autor=v["autor"], regras=v["regras"], aguardando=v["aguardando"],
                 intraday=v["intraday"], gestao=v["gestao"], ideal=v.get("ideal", ""), semNtsl=bool(v.get("sem_ntsl")))
            for k, v in ESTRATEGIAS.items()]
    tempos = [dict(tf=k, nome=df.NOME_TEMPO[k], periodo="10 anos" if k >= 1440 else "") for k in df.TEMPOS]
    return dict(ativos=ativos, estrategias=ests, gestoes=GESTOES, gestoesCurto=GESTOES_CURTO, tempos=tempos, protecoes=PROTECOES,
                usuario=usuario, versao=VERSAO)                  # sem caminhos de pasta do servidor (a tela nao usa)


# ------------------------------------------------------------------------------------------ HTTP
PUBLICAS_GET = ("/api/acesso/estado", "/api/ea/sinal", "/api/site/termos")
PUBLICAS_POST = ("/api/acesso/entrar", "/api/acesso/primeiro", "/api/acesso/sair", "/api/ea/estado", "/api/ea/candles",
                 "/api/acesso/cadastrar", "/api/hotmart")
COM_SENHA_PROVISORIA = ("/api/acesso/estado", "/api/acesso/sair", "/api/conta/senha")
SEM_ASSINATURA = ("/api/acesso/estado", "/api/acesso/sair", "/api/conta/senha", "/api/conta", "/api/site/minha")


# nomes que a tela pode gravar/ler em /api/estado (estado_<nome>.json na pasta do usuario). Os arquivos em que o servidor
# confia (conexao, testes, avisos, boleta...) nunca entram aqui.
ESTADO_NOMES = ("pref", "edicoes", "licoes")
ESTADO_DESENHOS = re.compile(r"^desenhos_[A-Za-z0-9_.\-]{1,40}$")
ESTADO_MAX = 2 * 1024 * 1024                        # tamanho maximo de cada estado gravado pela tela
ESTADO_MAX_DESENHOS = 300                           # arquivos de desenho por usuario
# limite de pedidos por IP (balde de fichas): rajada e depois N por minuto
LIMITES = {"/api/acesso/entrar": auth.Limite(10, 10), "/api/acesso/cadastrar": auth.Limite(5, 2),
           "/api/acesso/primeiro": auth.Limite(5, 3)}


def _nome_estado(nome):
    """Nome aceito para /api/estado (ou None). A comparacao ignora maiusculas: no Windows Testes == testes."""
    n = (nome or "").strip()
    if n.lower() in ESTADO_NOMES:
        return n.lower()
    return n if ESTADO_DESENHOS.match(n) else None


class Handler(BaseHTTPRequestHandler):
    server_version = "RoboApex/" + VERSAO
    timeout = 30                                    # conexao parada (sem mandar nada) cai depois de 30 s

    def log_message(self, *a):
        pass

    # ---------------------------------------------------------------- respostas
    def _json(self, obj, code=200, cookies=None):
        dados = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Length", str(len(dados)))
        for c in cookies or []:
            self.send_header("Set-Cookie", c)
        self.end_headers()
        self.wfile.write(dados)

    def _texto(self, txt, code=200):
        dados = txt.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def _corpo(self, limite):
        if "application/json" not in (self.headers.get("Content-Type") or "").lower():
            raise ValueError("pedido inválido")
        try:
            tam = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("tamanho inválido")
        if tam <= 0 or tam > limite:
            raise ValueError("tamanho inválido")
        try:
            corpo = json.loads(self.rfile.read(tam).decode("utf-8"))
        except (UnicodeDecodeError, RecursionError):
            raise ValueError("pedido inválido")
        if not isinstance(corpo, (dict, list)) or (isinstance(corpo, list) and urllib.parse.urlparse(self.path).path != "/api/estado"):
            raise ValueError("pedido inválido")
        return corpo

    # ---------------------------------------------------------------- acesso
    def _local(self):
        """So atende pedidos feitos para este proprio computador (bloqueia sites externos apontando um nome para 127.0.0.1).
        No modo online (--publico) aceita tambem o dominio do site, com HTTPS."""
        host = (self.headers.get("Host") or "").lower()
        locais = ("127.0.0.1:%d" % PORTA, "localhost:%d" % PORTA)
        doms = (DOMINIO, "www." + DOMINIO) if (PUBLICO and DOMINIO) else ()
        ok = host in locais or host in doms
        origem = (self.headers.get("Origin") or "").lower()
        if ok and origem and origem not in ("http://127.0.0.1:%d" % PORTA, "http://localhost:%d" % PORTA) and \
                origem not in tuple("https://" + d for d in doms):
            ok = False
        if not ok:
            self._json(dict(erro="pedido recusado"), 403)
        return ok

    def _token(self):
        for parte in (self.headers.get("Cookie") or "").split(";"):
            k, _, v = parte.strip().partition("=")
            if k == "apex_s":
                return v
        return None

    def _cookie(self, token, manter=False):
        return "apex_s=%s; Path=/; HttpOnly; SameSite=Strict%s%s" % (token, "; Max-Age=%d" % auth.SESSAO_LONGA if manter else "",
                                                                   "; Secure" if PUBLICO else "")

    def _ip(self):
        ip = self.client_address[0] if self.client_address else ""
        if PROXY and ip in ("127.0.0.1", "::1"):
            # atras do proxy (--proxy): o IP verdadeiro e o ULTIMO do cabecalho, o que o proprio proxy acrescentou (os da
            # esquerda vem de quem fez o pedido e podem ser inventados)
            xff = [x.strip() for x in (self.headers.get("X-Forwarded-For") or "").split(",") if x.strip()]
            if xff:
                ip = xff[-1][:60]
        return ip

    def _limite(self, cam):
        """False (ja respondeu 429) se este IP passou do limite de pedidos desta rota."""
        lim = LIMITES.get(cam)
        if lim is None or lim.pode(self._ip()):
            return True
        ACESSOS.registrar("limite_ip", "", cam, self._ip())
        self._json(dict(erro="Muitas tentativas a partir deste endereço. Espere um minuto e tente de novo."), 429)
        return False

    def _sessao(self, caminho, publicas):
        """Usuario da sessao, ou None depois de ja ter respondido 401/403."""
        u = ACESSOS.sessao(self._token())
        if caminho in publicas:
            return u or {}
        if not u:
            self._json(dict(erro="Sua sessão terminou. Entre de novo.", login=True), 401)
            return None
        if u["provisoria"] and caminho not in COM_SENHA_PROVISORIA:
            self._json(dict(erro="Troque a senha provisória antes de continuar.", trocar=True), 403)
            return None
        if not SITE.ativa(u) and caminho not in SEM_ASSINATURA and not caminho.startswith("/api/acesso/"):
            self._json(dict(erro="Sua assinatura não está ativa.", assinar=True, checkout=SITE.checkout_para(u["email"], u.get("nome"))), 402)
            return None
        if caminho.startswith("/api/admin/") and u["papel"] != "admin":
            ACESSOS.registrar("admin_negado", u["email"], caminho, self._ip())
            self._json(dict(erro="Só o administrador pode fazer isso."), 403)
            return None
        return u

    # ---------------------------------------------------------------- POST
    def do_POST(self):
        if not self._local():
            return
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        cam = url.path
        _UID.v = None
        try:
            u = self._sessao(cam, PUBLICAS_POST)
            if u is None:
                return
            _UID.v = u.get("id")
            ip = self._ip()
            if not self._limite(cam):
                return
            if cam == "/api/acesso/entrar":
                p = self._corpo(4000)
                tok, usuario = ACESSOS.entrar(p.get("email"), p.get("senha"), bool(p.get("manter")), ip)
                return self._json(dict(ok=True, usuario=usuario), cookies=[self._cookie(tok, bool(p.get("manter")))])
            if cam == "/api/acesso/primeiro":
                p = self._corpo(4000)
                tok, usuario = ACESSOS.primeiro_acesso(p.get("senha"), ip, p.get("codigo"))
                return self._json(dict(ok=True, usuario=usuario), cookies=[self._cookie(tok)])
            if cam == "/api/hotmart":
                try:
                    reg = SITE.hotmart(self.headers, self._corpo(200000), ACESSOS)
                except PermissionError:
                    ACESSOS.registrar("hotmart_negado", "", "hottok inválido", ip)
                    return self._json(dict(erro="não autorizado"), 401)
                ACESSOS.registrar("hotmart", reg.get("email", ""), "%s %s" % (reg.get("evento"), reg.get("transacao")), ip)
                return self._json(dict(ok=True))
            if cam == "/api/acesso/cadastrar":
                if not SITE.cfg["cadastro_aberto"]:
                    return self._json(dict(erro="O cadastro não está aberto. Fale com o administrador."), 403)
                p = self._corpo(8000)
                pend = SITE.pendente(p.get("email"))          # so olha: a compra sai da lista depois que o cadastro deu certo
                assin = None
                if pend:
                    assin = dict(status=pend.get("status"), ate=pend.get("ate"), origem="hotmart", transacao=pend.get("transacao") or "",
                                 quando=time.time())
                    if pend.get("encerradas"):
                        assin["encerradas"] = list(pend["encerradas"])[-20:]
                tok, usuario = ACESSOS.cadastrar(p.get("nome"), p.get("email"), p.get("senha"), p.get("aceite"), ip, assin)
                if pend:
                    SITE.pendente_usada(p.get("email"))
                return self._json(dict(ok=True, usuario=usuario, checkout=SITE.checkout_para(usuario["email"], usuario["nome"])),
                                  cookies=[self._cookie(tok)])
            if cam in ("/api/ea/estado", "/api/ea/candles"):
                uid_ea = CONEX.uid_do_token(self.headers.get("X-Apex-Token") or q.get("token", [""])[0])
                if not uid_ea:
                    return self._texto("OK=0\nMOTIVO=código de conexão inválido\n", 403)
                _UID.v = uid_ea
                if not _pode_usar(uid_ea):                    # conta desativada ou assinatura vencida: nada de ordem nova
                    if cam == "/api/ea/estado":
                        return self._texto("OK=1\nLIGADO=0\nREAL=0\nMOTIVO=conta sem acesso ao robô (desativada ou assinatura vencida)\n")
                    return self._texto("OK=0\nMOTIVO=conta sem acesso ao robô (desativada ou assinatura vencida)\n", 403)
                p = self._corpo(4 * 1024 * 1024)
                if cam == "/api/ea/estado":
                    return self._texto(CONEX.receber_estado(uid_ea, p))
                return self._texto("OK=1\nRECEBIDOS=%d\n" % CONEX.receber_candles(uid_ea, p))
            if cam == "/api/acesso/sair":
                ACESSOS.sair(self._token(), ip)
                return self._json(dict(ok=True), cookies=["apex_s=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"])
            uid = u["id"]
            if cam == "/api/conta/senha":
                p = self._corpo(4000)
                return self._json(dict(ok=True, usuario=ACESSOS.trocar_senha(uid, p.get("atual"), p.get("nova"), self._token(), ip)))
            if cam == "/api/conta":
                p = self._corpo(4000)
                return self._json(dict(ok=True, usuario=ACESSOS.alterar_conta(uid, p.get("nome"), p.get("email"), p.get("senha"), ip)))
            if cam == "/api/admin/usuarios":
                p = self._corpo(8000)
                acao = p.get("acao")
                if acao == "criar":
                    novo, prov = ACESSOS.criar(u, p.get("nome"), p.get("email"), p.get("papel") or "usuario", ip)
                    return self._json(dict(ok=True, usuario=novo, provisoria=prov, usuarios=ACESSOS.listar()))
                if acao == "alterar":
                    ACESSOS.alterar(u, p.get("id"), {k: p[k] for k in ("nome", "papel", "ativo") if k in p}, ip)
                    return self._json(dict(ok=True, usuarios=ACESSOS.listar()))
                if acao == "redefinir":
                    alvo, prov = ACESSOS.redefinir(u, p.get("id"), ip)
                    return self._json(dict(ok=True, usuario=alvo, provisoria=prov, usuarios=ACESSOS.listar()))
                if acao == "apagar":
                    ACESSOS.apagar(u, p.get("id"), ip)
                    return self._json(dict(ok=True, usuarios=ACESSOS.listar()))
                return self._json(dict(erro="ação desconhecida"), 400)
            if cam == "/api/testes":
                p = self._corpo(20000)
                acao = p.get("acao")
                if acao == "ligar":
                    x = TESTES.ligar(uid, p)
                    ACESSOS.registrar("teste_ligado", u["email"], "%s %s min %s" % (x["ativo"], x["tf"], x["est"]), ip)
                elif acao == "parar":
                    x = TESTES.parar(uid, p.get("id"))
                    ACESSOS.registrar("teste_parado", u["email"], "%s %s min %s" % (x["ativo"], x["tf"], x["est"]), ip)
                elif acao == "apagar":
                    TESTES.apagar(uid, p.get("id"))
                    ACESSOS.registrar("teste_apagado", u["email"], str(p.get("id")), ip)
                elif acao == "ajuste":
                    aj = TESTES.ajustar(uid, p.get("id"), p)
                    ACESSOS.registrar("ajuste_manual", u["email"], "%s %s%s" % (aj["tipo"], aj["chave"], (" -> %s" % aj["valor"]) if "valor" in aj else ""), ip)
                else:
                    return self._json(dict(erro="ação desconhecida"), 400)
                return self._json(TESTES.painel(uid, int(p.get("seq") or 0)))
            if cam == "/api/boleta":
                p = self._corpo(4000)
                r = BOLETA.acao(uid, p)
                if p.get("acao") in ("ordem", "zerar", "zerar_tudo", "inverter"):
                    ACESSOS.registrar("boleta", u["email"], "%s %s %s" % (p.get("acao"), p.get("ativo", ""), p.get("tipo", "")), ip)
                return self._json(r)
            if cam == "/api/admin/site":
                p = self._corpo(8000)
                cfg = SITE.salvar(p)
                ACESSOS.registrar("site_configurado", u["email"], ", ".join(sorted(k for k in p if k != "hottok")) + (" + hottok" if p.get("hottok") else ""), ip)
                return self._json(dict(ok=True, cfg=cfg))
            if cam == "/api/admin/assinatura":
                p = self._corpo(2000)
                alvo = next((x for x in ACESSOS.listar() if x["id"] == p.get("id")), None)
                if not alvo:
                    return self._json(dict(erro="usuário não encontrado"), 404)
                dias = int(p.get("dias") or 0)
                if dias > 0:
                    base_t = max(time.time(), float(((alvo.get("assinatura") or {}).get("ate")) or 0))
                    ACESSOS.definir_assinatura(alvo["email"], "ativa", base_t + dias * 86400, "admin", "", u, ip)
                else:
                    ACESSOS.definir_assinatura(alvo["email"], "inativa", time.time(), "admin", "", u, ip)
                return self._json(dict(ok=True, usuarios=ACESSOS.listar()))
            if cam == "/api/conexao":
                p = self._corpo(4000)
                if p.get("acao") == "piloto":
                    return self._json(_ligar_piloto(uid, p, ip, u))
                if p.get("acao") == "ligar" and p.get("ligado"):
                    tid = CONEX.publico(uid)["cfg"].get("teste")
                    if tid and not any(str(x["id"]) == str(tid) and not x.get("ate") for x in TESTES.lista(uid)):
                        return self._json(dict(erro="O teste escolhido não está mais ligado. Ligue um teste ao vivo e escolha ele aqui."), 400)
                r = CONEX.acao(uid, p, ip)
                ACESSOS.registrar("conexao", u["email"], str(p.get("acao")), ip)
                return self._json(r)
            if cam == "/api/regras":
                p = self._corpo(4000)
                txt = ",".join("%s:%g:%g" % (k, v[0], v[1]) for k, v in regras_de(p.get("regra")).items())
                n = TESTES.trocar_regras(uid, txt)
                ACESSOS.registrar("regra_trocada", u["email"], txt or "(nenhuma)", ip)
                return self._json(dict(ok=True, regra=txt, testes=n))
            if cam == "/api/avisos":
                p = self._corpo(4000)
                cfg = TESTES.gravar_avisos(uid, p)
                ACESSOS.registrar("avisos_configurados", u["email"], "Telegram %s" % ("ligado" if cfg["telegram"]["ligado"] else "desligado"), ip)
                return self._json(dict(ok=True, avisos=avisos.publico(cfg)))
            if cam == "/api/opcoes/simular":
                p = self._corpo(20000)
                return self._json(opcoes.simular(BASE, p.get("pernas") or [], p.get("ativo"), p.get("venc")))
            if cam == "/api/avisos/teste":
                cfg = TESTES.avisos_de(uid)
                tg = cfg["telegram"]
                if not tg["token"] or not tg["chat"]:
                    return self._json(dict(erro="Preencha e salve o código do robô e o número da conversa antes."), 400)
                e = avisos.enviar_telegram(tg["token"], tg["chat"], "ROBÔ APEX: aviso de teste. Se você leu isto, os avisos estão funcionando.")
                return self._json(dict(ok=e is None, erro=e), 200 if e is None else 400)
            if cam == "/api/comparar":
                p = self._corpo(100000)
                tf = int(p.get("tf", 5))
                ativos = p.get("ativos") if isinstance(p.get("ativos"), list) else []
                pedido = dict(ativos=[a for a in ativos if isinstance(a, str) and (a in df.ATIVOS or a.startswith("CSV:") or cripto.eh_cripto(a))][:30],
                              seletivo=bool(p.get("seletivo")),
                              tf=tf if tf in df.TEMPOS else 5, gestao=p.get("gestao") if p.get("gestao") in GESTOES else "padrao",
                              maxstops=max(1, min(50, int(p.get("maxstops", 2)))), de=int(p.get("de") or 0),
                              ate=int(p.get("ate") or 0), per=p.get("per") if p.get("per") in PERIODOS else "tudo")
                if not pedido["ativos"]:
                    return self._json(dict(erro="Escolha pelo menos um ativo."), 400)
                with CMP_LOCK:
                    CMP = _cmp_de(uid)
                    if CMP["rodando"]:
                        return self._json(dict(ok=False, jaRodando=True))
                    if sum(1 for c in CMPS.values() if c["rodando"]) >= CMP_MAX:
                        return self._json(dict(erro="O servidor já está fazendo outros comparativos. Tente de novo em alguns minutos."), 429)
                    CMP.update(rodando=True, pedido=pedido, feito=0, total=len(pedido["ativos"]), linhas=[], erro=None)
                threading.Thread(target=_comparar, args=(uid, pedido), daemon=True).start()
                return self._json(dict(ok=True))
            if cam == "/api/estado":
                nome = _nome_estado(q.get("nome", [""])[0])
                if not nome:
                    return self._json(dict(erro="nome inválido"), 400)
                corpo = self._corpo(ESTADO_MAX)
                pasta = pasta_de(uid)
                arq = os.path.join(pasta, "estado_%s.json" % nome)
                if nome.startswith("desenhos_") and not os.path.exists(arq) and \
                        sum(1 for a in os.listdir(pasta) if a.lower().startswith("estado_desenhos_") and a.endswith(".json")) >= ESTADO_MAX_DESENHOS:
                    return self._json(dict(erro="Limite de %d ativos com desenhos. Apague os desenhos de algum ativo." % ESTADO_MAX_DESENHOS), 400)
                _gravar_json(arq, corpo)
                return self._json(dict(ok=True))
            return self._json(dict(erro="rota desconhecida"), 404)
        except ConnectionError:
            return                                             # a tela fechou a conexao no meio da resposta
        except auth.Negado as e:
            return self._json(dict(erro=str(e)), 403)
        except (ValueError, RuntimeError, KeyError, TypeError) as e:
            return self._json(dict(erro=str(e) or "pedido inválido"), 400)
        except Exception:
            traceback.print_exc()
            return self._json(dict(erro="Erro interno do robô. Tente de novo; se continuar, avise o suporte."), 500)

    # ---------------------------------------------------------------- GET
    def do_GET(self):
        if not self._local():
            return
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        cam = url.path
        try:
            if cam.startswith("/api/"):
                return self._api_get(cam, q)
            u = ACESSOS.sessao(self._token())
            raiz_extra = None
            pagina_app = lambda: ("assinar.html" if not SITE.ativa(u) else "index.html") if (u and not u["provisoria"]) else "entrar.html"   # noqa: E731
            # quem ainda tem o cookie de uma sessao que venceu (ex.: a tela mandou de volta para "/") vai para a entrada
            if PUBLICO and cam in ("/", "") and not u and not self._token():
                caminho = "site/index.html"                        # quem chega pelo endereco do site ve a pagina de vendas
                SITE.visita(cam, self._ip(), self.headers.get("Referer"), self.headers.get("User-Agent") or "",
                            "&".join(x for x in (url.query or "").split("&") if x.startswith("utm_")))
            elif cam in ("/", "", "/index.html", "/app", "/entrar"):
                caminho = pagina_app()
            elif cam == "/inicio":                             # menu depois do login: os 3 volumes ou o robo ao vivo
                caminho = "inicio.html" if (u and not u["provisoria"]) else "entrar.html"
            elif re.fullmatch(r"/curso/volume[1-3]\.pdf", cam) or cam == "/baixar":
                # treinamento e versao para Windows: so para quem esta logado e com a assinatura em dia
                if not (u and not u["provisoria"] and SITE.ativa(u)):
                    self.send_response(302)
                    self.send_header("Location", "/inicio" if u else "/entrar")
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                raiz_extra = (os.path.join(RECURSOS, "curso"), cam.rsplit("/", 1)[1]) if cam != "/baixar" else                     (os.path.join(df.pasta_dados(BASE), "baixar"), "RoboApex.exe")
            elif cam in ("/site", "/site/") or (cam.startswith("/site/") and cam.endswith(".html")):
                caminho = "site/index.html" if cam in ("/site", "/site/") else cam.lstrip("/")
                SITE.visita(cam, self._ip(), self.headers.get("Referer"), self.headers.get("User-Agent") or "",
                            "&".join(x for x in (url.query or "").split("&") if x.startswith("utm_")))
            else:
                caminho = urllib.parse.unquote(cam.lstrip("/"))
            raiz = WEB
            if raiz_extra:
                raiz, caminho = raiz_extra
            elif caminho.startswith("sons/"):                    # sons proprios ficam na pasta de dados
                if not u:
                    self.send_error(404)
                    return
                raiz, caminho = os.path.join(df.pasta_dados(BASE), "sons"), os.path.basename(caminho)
                if os.path.splitext(caminho.lower())[1] not in EXT_SOM:
                    self.send_error(404)
                    return
            arq = os.path.normpath(os.path.join(raiz, caminho))
            if not arq.startswith(os.path.normpath(raiz) + os.sep) or not os.path.isfile(arq):
                self.send_error(404)
                return
            tipo = mimetypes.guess_type(arq)[0] or "application/octet-stream"
            if arq.endswith(".js"):
                tipo = "text/javascript"
            with open(arq, "rb") as f:
                dados = f.read()
            faixa = re.match(r"bytes=(\d*)-(\d*)$", self.headers.get("Range") or "") if tipo.startswith("video/") else None
            if faixa and (faixa.group(1) or faixa.group(2)):     # video: o navegador (Safari/iPhone) pede por pedacos
                n = len(dados)
                if faixa.group(1):
                    ini, fim = int(faixa.group(1)), min(n - 1, int(faixa.group(2) or n - 1))
                else:
                    ini, fim = max(0, n - int(faixa.group(2))), n - 1
                if ini >= n or ini > fim:
                    self.send_response(416)
                    self.send_header("Content-Range", "bytes */%d" % n)
                    self.send_header("Content-Length", "0")
                    self.end_headers()
                    return
                self.send_response(206)
                self.send_header("Content-Range", "bytes %d-%d/%d" % (ini, fim, n))
                dados = dados[ini:fim + 1]
            else:
                self.send_response(200)
            if tipo.startswith("video/"):
                self.send_header("Accept-Ranges", "bytes")
            self.send_header("Content-Type", tipo + ("; charset=utf-8" if tipo.startswith("text") else ""))
            self.send_header("Content-Length", str(len(dados)))
            self.send_header("Cache-Control", "no-cache")
            self.send_header("X-Content-Type-Options", "nosniff")
            if arq.endswith(".html"):
                self.send_header("X-Frame-Options", "DENY")
                self.send_header("Referrer-Policy", "no-referrer")
            self.end_headers()
            self.wfile.write(dados)
        except ConnectionError:
            return
        except Exception:
            traceback.print_exc()
            self._json(dict(erro="Erro interno do robô. Tente de novo; se continuar, avise o suporte."), 500)

    def _api_get(self, cam, q):
        _UID.v = None
        try:
            u = self._sessao(cam, PUBLICAS_GET)
            if u is None:
                return
            _UID.v = u.get("id")
            if cam == "/api/acesso/estado":
                est = ACESSOS.estado()
                out = dict(primeiroAcesso=est["primeiroAcesso"], logado=bool(u), usuario=u or None, versao=VERSAO, site=SITE.publico_cfg(),
                           publico=PUBLICO, pedeCodigo=bool(est["primeiroAcesso"] and est["pedeCodigo"]))
                if est["primeiroAcesso"] and not PUBLICO:
                    out["adminEmail"] = est["adminEmail"]      # so no computador da pessoa, enquanto ninguem definiu a senha
                return self._json(out)
            if cam == "/api/site/termos":
                return self._json(dict(termos=assinaturas.TERMOS, versao=assinaturas.TERMOS_VERSAO, site=SITE.publico_cfg()))
            if cam == "/api/ea/sinal":
                uid_ea = CONEX.uid_do_token(self.headers.get("X-Apex-Token") or q.get("token", [""])[0])
                if not uid_ea:
                    return self._texto("OK=0\nMOTIVO=código de conexão inválido\n", 403)
                _UID.v = uid_ea
                if not _pode_usar(uid_ea):                    # LIGADO=0: o EA cancela as ordens pendentes e nao manda nenhuma nova
                    return self._texto("OK=1\nLIGADO=0\nREAL=0\nMOTIVO=conta sem acesso ao robô (desativada ou assinatura vencida)\n")
                return self._texto(CONEX.sinal(uid_ea, TESTES.para_ea))
            uid = u["id"]
            if cam == "/api/site/minha":
                return self._json(dict(usuario=u, ativa=SITE.ativa(u), site=SITE.publico_cfg(), checkout=SITE.checkout_para(u["email"], u.get("nome")),
                                       baixar=os.path.isfile(os.path.join(df.pasta_dados(BASE), "baixar", "RoboApex.exe"))))
            if cam == "/api/admin/site":
                us = ACESSOS.listar()
                ativos = [x for x in us if x["papel"] != "admin" and SITE.ativa(dict(x, papel="usuario")) and (x.get("assinatura") or {}).get("status") == "ativa"]
                return self._json(dict(cfg=SITE.admin_cfg(), compras=SITE.compras(150)[::-1], visitas=SITE.resumo_visitas(30),
                                       resumo=dict(usuarios=len(us), assinantes=len(ativos), online=sum(1 for x in us if x.get("online")),
                                                   cadastros30=sum(1 for x in us if (x.get("criado") or 0) > time.time() - 30 * 86400)),
                                       publico=PUBLICO, dominio=DOMINIO))
            if cam == "/api/conexao":
                return self._json(CONEX.publico(uid, PORTA))
            if cam == "/api/config":
                return self._json(config(u))
            if cam == "/api/sim":
                return self._json(api_sim(q, uid))
            if cam == "/api/testes":
                seq = _int(q, "seq", 0)
                espera = max(0, min(25, _int(q, "espera", 0)))
                if espera:
                    TESTES.esperar(uid, seq, espera)
                return self._json(TESTES.painel(uid, seq))
            if cam == "/api/teste":
                return self._json(TESTES.detalhe(uid, q.get("id", [""])[0]))
            if cam == "/api/avisos":
                return self._json(dict(avisos=avisos.publico(TESTES.avisos_de(uid))))
            if cam == "/api/ia":
                return self._json(api_ia(q))
            if cam == "/api/ajuste":
                return self._json(api_ajuste(q))
            if cam == "/api/boleta":
                return self._json(BOLETA.estado(uid, q.get("ativo", [None])[0]))
            if cam == "/api/testar":
                return self._json(api_testar(q))
            if cam == "/api/lista":
                return self._json(api_lista(q))
            if cam == "/api/minhas":
                return self._json(api_minhas(q))
            if cam == "/api/cripto/mercado":
                return self._json(api_cripto_mercado())
            if cam == "/api/gestoes":
                return self._json(api_gestoes(q))
            if cam == "/api/metas":
                return self._json(api_metas(q))
            if cam == "/api/agenda":
                return self._json(agenda.buscar())
            if cam == "/api/profit/estado":
                e = profit.estado(df.pasta_dados(BASE))
                e["ultimas"] = profit.ordens(df.pasta_dados(BASE), 20) if u["papel"] == "admin" else []
                if PUBLICO:                                        # online: nao mostra o caminho das pastas do servidor
                    e["pasta"] = "dados/profit"
                return self._json(e)
            if cam == "/api/opcoes/painel":
                return self._json(opcoes.painel(BASE, q.get("ativo", ["PETR4"])[0]))
            if cam == "/api/opcoes/grade":
                return self._json(opcoes.grade(BASE, q.get("ativo", ["PETR4"])[0], q.get("venc", [""])[0]))
            if cam == "/api/opcoes/estruturas":
                return self._json(opcoes.estruturas(BASE, q.get("ativo", ["PETR4"])[0], q.get("venc", [""])[0]))
            if cam == "/api/opcoes/oportunidades":
                return self._json(opcoes.oportunidades(BASE))
            if cam == "/api/cripto/info":
                mercado, sym = cripto.separar(q.get("chave", [""])[0])
                inf = cripto.info(mercado, sym)
                if not inf.get("ativo"):
                    raise ValueError("moeda fora de negociação na Binance")
                return self._json(dict(chave="%s:%s" % (mercado, sym),
                                       nome="%s/%s%s" % (inf["moeda"], inf["cotacao"], " (futuro)" if mercado == "BF" else "")))
            if cam == "/api/sons":
                return self._json(dict(sons=sons_proprios()))     # sem o caminho da pasta do servidor (a tela nao usa)
            if cam == "/api/radar":
                return self._json(api_radar(q))
            if cam == "/api/noticias":
                return self._json(noticias.buscar(q.get("forcar", ["0"])[0] == "1", "cripto" if q.get("mercado", [""])[0] == "cripto" else "b3"))
            if cam == "/api/base":
                with historico._TRAVA:
                    est = dict(historico.ESTADO)
                est["dias"] = {c: historico.dias_na_base(BASE, c) for c in list(historico.DUKAS) + list(historico.BINANCE)}
                est["meta"] = historico.DIAS_BASE
                return self._json(est)
            if cam == "/api/comparar":
                with CMP_LOCK:
                    return self._json(dict(_cmp_de(uid)))
            if cam == "/api/estado":
                nome = _nome_estado(q.get("nome", [""])[0])
                if not nome:
                    return self._json(dict(erro="nome inválido"), 400)
                return self._json(dict(valor=_ler_json(os.path.join(pasta_de(uid), "estado_%s.json" % nome), None)))
            if cam == "/api/admin/usuarios":
                return self._json(dict(usuarios=ACESSOS.listar()))
            if cam == "/api/admin/registro":
                return self._json(dict(linhas=ACESSOS.registro(max(1, min(1000, _int(q, "n", 300))), q.get("q", [""])[0])))
            return self._json(dict(erro="rota desconhecida"), 404)
        except ConnectionError:
            return                                             # a tela fechou a conexao (trocou de tela, fechou a janela)
        except auth.Negado as e:
            self._json(dict(erro=str(e)), 403)
        except (ValueError, RuntimeError) as e:
            self._json(dict(erro=str(e)), 400)
        except Exception:
            traceback.print_exc()
            self._json(dict(erro="Erro interno do robô. Tente de novo; se continuar, avise o suporte."), 500)


def porta_livre(pref):
    for p in range(pref, pref + 30):
        with socket.socket() as s:
            try:
                s.bind(("127.0.0.1", p))
                return p
            except OSError:
                continue
    raise RuntimeError("Nenhuma porta livre")


def abrir_janela(url):
    # Edge/Chrome em "modo aplicativo" = janela propria, sem barra de endereco
    candidatos = [
        os.path.expandvars(r"%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"),
        os.path.expandvars(r"%ProgramFiles%\Google\Chrome\Application\chrome.exe"),
        os.path.expandvars(r"%LocalAppData%\Google\Chrome\Application\chrome.exe"),
        shutil.which("msedge") or "", shutil.which("chrome") or "",
    ]
    for exe in candidatos:
        if exe and os.path.isfile(exe):
            try:
                subprocess.Popen([exe, "--app=" + url, "--window-size=1680,1000"])
                return
            except OSError:
                pass
    webbrowser.open(url)


def _splash(txt=None, fechar=False):
    """Tela de abertura do .exe (PyInstaller --splash). No Python puro nao existe e nada acontece."""
    try:
        import pyi_splash                                      # noqa: F401  (so existe dentro do .exe)
        if fechar:
            pyi_splash.close()
        elif txt:
            pyi_splash.update_text(txt)
    except Exception:
        pass


class Servidor(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 64

    def handle_error(self, request, client_address):          # a tela fechou a conexao no meio: nao e erro do robo
        if not isinstance(sys.exc_info()[1], (ConnectionError, TimeoutError)):
            super().handle_error(request, client_address)


SITE = assinaturas.Site(df.pasta_dados(BASE))
PUBLICO = "--publico" in ARGS                      # na internet, atras de um proxy com HTTPS (Caddy/Nginx)
DOMINIO = (_arg("--dominio") or "").strip().lower()
PROXY = "--proxy" in ARGS                          # ha um proxy confiavel na frente (Caddy/Nginx): o IP do cliente vem dele
CONEX = corretora.Conexao(df.pasta_dados(BASE), lambda uid: pasta_de(uid), lambda a, p: _ler_json(a, p), lambda a, o: _gravar_json(a, o))
BOLETA = boleta.Boleta(lambda c, tf: carregar(c, tf), df.sessao_cfg, lambda B, cfg, c: formando(B, cfg, c), lambda uid: pasta_de(uid))
_aquecido = threading.Event()


def aquecer():
    """Carrega os candles de todos os ativos assim que o robo abre (ainda na tela de abertura), para a tela ja encontrar
    tudo atualizado e a troca de ativo ser imediata. Primeiro os 5 min de todos, depois 15 e 60 min, sem pressa: o Yahoo
    tem limite de pedidos por minuto e a tela tem prioridade."""
    chaves = [c for c in df.ATIVOS if not cripto.eh_cripto(c)]

    def um(chave, tf):
        try:
            carregar(chave, tf)
        except Exception:
            pass                                               # sem internet ou ativo sem dados: a tela avisa quando ele for aberto
        _aquecido.set()

    filas = [chaves[k::3] for k in range(3)]                   # os 5 min de todos, de 3 em 3
    ts = [threading.Thread(target=lambda f=f: [um(c, 5) for c in f], daemon=True) for f in filas]
    for t in ts:
        t.start()
    for t in ts:
        t.join()
    for tf in (15, 60):
        for chave in ("WIN", "WDO", "PETR4", "VALE3", "BOVA11", "EURUSD", "XAUUSD", "USTEC"):
            if chave in df.ATIVOS:
                um(chave, tf)
                time.sleep(1.5)


def main():
    global ACESSOS, PORTA
    try:
        sys.stdout.reconfigure(line_buffering=True)            # o que o robo escreve aparece na hora, mesmo gravado em arquivo
    except (AttributeError, ValueError):
        pass
    _splash("Abrindo o robô…")
    ACESSOS = auth.Acessos(df.pasta_dados(BASE))
    if "--redefinir-admin" in ARGS:
        ACESSOS.zerar_admin()
        _splash(fechar=True)
        print("Senha do administrador removida. Abra o robo: ele vai pedir para criar uma senha nova.")
        return
    PORTA = porta_livre(int(_arg("--porta", 8765)))
    srv = Servidor((_arg("--ouvir") or "127.0.0.1", PORTA), Handler)
    url = "http://127.0.0.1:%d/" % PORTA
    print("=" * 66)
    print(" ROBO APEX %s - estrategias de day trade: B3, opcoes e cripto (estudo e simulacao)" % VERSAO)
    print(" Tela: %s" % url)
    print(" Dados e desenhos: %s" % df.pasta_dados(BASE))
    print(" Feche esta janela para encerrar o robo.")
    if PUBLICO:
        cod = ACESSOS.preparar_codigo()                        # online: so quem ve o servidor faz o primeiro acesso
        if cod:
            print(" PRIMEIRO ACESSO: o administrador ainda nao tem senha. Na tela de entrada use o codigo %s" % cod)
            print(" (tambem gravado em %s)." % os.path.join(df.pasta_dados(BASE), auth.ARQ_CODIGO))
    print("=" * 66)
    threading.Thread(target=TESTES.laco, daemon=True, name="sentinela").start()
    if "--sem-base" not in ARGS:
        _splash("Carregando os ativos…")
        threading.Thread(target=aquecer, daemon=True, name="aquecer").start()
        _aquecido.wait(4.0)                                    # o primeiro ativo costuma chegar em 1 a 2 segundos
    if "--sem-janela" not in ARGS:
        _splash("Abrindo a janela…")
        abrir_janela(url)                                      # o servidor ja escuta: a pagina espera o serve_forever
        time.sleep(1.2)
    _splash(fechar=True)
    if "--sem-base" not in ARGS:
        # completa a base de 5 meses (so baixa o que falta; a Dukascopy e lenta, entao vai em segundo plano)
        threading.Thread(target=historico.trabalho, args=(BASE,), daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
