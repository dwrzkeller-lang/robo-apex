# -*- coding: utf-8 -*-
"""Fontes de dados do ROBO KELLER.

  * Base de 5 meses em candles de 1 minuto (app/historico.py): Dukascopy para forex, ouro, Nasdaq 100 (USTEC)
    e Nikkei 225 (JP225); Binance para o Bitcoin. Os candles de HOJE vem do Yahoo (ou da Binance, no BTC),
    com o nivel ajustado pela diferenca media entre as fontes, para a serie ficar continua.
  * Yahoo Finance: WIN e WDO (substitutos: Ibovespa a vista e USD/BRL), prata e petroleo (60 dias em 2-30 min,
    2 anos em 60 min) e o diario de 10 anos de todos. Cada download do Yahoo e somado a um arquivo local, entao
    o historico desses ativos cresce sozinho com o uso.
  * CSV exportado do Profit / MetaTrader colocado na pasta 'dados' (o dado mais real do WIN/WDO).

Horario: forex, ouro, BTC e B3 em horario de Brasilia; USTEC em horario de Nova York e JP225 em horario de
Toquio (o pregao a vista de cada bolsa, com horario de verao americano ja considerado).

Custos (por lado = na entrada E na saida):
  slip  = escorregamento em pontos de preco (B3: 1 tick; forex/CFD: meio spread + 1 tick)
  custo = corretagem/emolumentos por contrato/lote, na moeda do ativo"""
import csv
import glob
import io
import json
import os
import time
import unicodedata
import urllib.request
from datetime import datetime, timedelta, timezone

import historico

BRT = timezone(timedelta(hours=-3))

# ativos internacionais (horario de Brasilia): Londres de madrugada, Nova York a partir das 10:30
INTL_PRM = dict(HoraInicio=400, HoraFimEntradas=1500, HoraZeragem=1600)


def _intl(nome, yahoo, tick, dec, valor, lote, slip):
    return dict(nome=nome, yahoo=yahoo, escala=1.0, tick=tick, sessao=(300, 1700), decimais=dec,
                valor_ponto=valor, moeda="US$", lote=lote, prm=INTL_PRM, slip=slip, custo=3.5, fracionado=True)


# valor_ponto = quanto vale 1,00 de variacao de preco em 1 contrato/lote
ATIVOS = {
    "WIN": dict(nome="Mini Índice (WIN) - proxy: Ibovespa à vista", yahoo="^BVSP", escala=1.0, tick=5.0,
                sessao=(1000, 1800), decimais=0, valor_ponto=0.20, moeda="R$", lote="contrato",
                prm=dict(HoraInicio=1005, HoraFimEntradas=1630, HoraZeragem=1650),   # o a vista fecha ~17h
                slip=5.0, custo=0.30, fracionado=False),
    "WDO": dict(nome="Mini Dólar (WDO) - proxy: USD/BRL x1000", yahoo="BRL=X", escala=1000.0, tick=0.5,
                sessao=(900, 1825), decimais=1, valor_ponto=10.0, moeda="R$", lote="contrato",
                prm=dict(HoraInicio=905, HoraFimEntradas=1700, HoraZeragem=1745), slip=0.5, custo=1.20, fracionado=False),
    "EURUSD": _intl("EUR/USD", "EURUSD=X", 0.00001, 5, 100000.0, "lote padrão (100 mil)", 0.00006),
    "GBPUSD": _intl("GBP/USD", "GBPUSD=X", 0.00001, 5, 100000.0, "lote padrão (100 mil)", 0.00008),
    "USDJPY": _intl("USD/JPY", "JPY=X", 0.001, 3, 667.0, "lote padrão (100 mil) - valor aproximado", 0.008),
    "AUDUSD": _intl("AUD/USD", "AUDUSD=X", 0.00001, 5, 100000.0, "lote padrão (100 mil)", 0.00006),
    "XAUUSD": _intl("XAU/USD - Ouro", "GC=F", 0.01, 2, 100.0, "lote de 100 onças", 0.2),
    "USTEC": dict(nome="USTEC - Nasdaq 100 (horário de Nova York)", yahoo="^NDX", escala=1.0, tick=0.1, fuso="NY",
                  sessao=(930, 1600), decimais=1, valor_ponto=1.0, moeda="US$", lote="lote (US$ 1 por ponto)",
                  prm=dict(HoraInicio=935, HoraFimEntradas=1530, HoraZeragem=1555), slip=1.0, custo=0.0, fracionado=True),
    "JP225": dict(nome="JP225 - Nikkei 225 (horário de Tóquio)", yahoo="^N225", escala=1.0, tick=1.0, fuso="TOQUIO",
                  sessao=(900, 1530), decimais=0, valor_ponto=0.67, moeda="US$", lote="lote (¥100 por ponto ≈ US$ 0,67)",
                  prm=dict(HoraInicio=905, HoraFimEntradas=1500, HoraZeragem=1525), slip=5.0, custo=0.0, fracionado=True),
    "BTCUSD": dict(nome="BTC/USD - Bitcoin (24 h)", yahoo="BTC-USD", escala=1.0, tick=0.1, fim_de_semana=True,
                   sessao=(0, 2359), decimais=1, valor_ponto=1.0, moeda="US$", lote="1 BTC",
                   prm=dict(HoraInicio=0, HoraFimEntradas=2300, HoraZeragem=2355), slip=10.0, custo=0.0, fracionado=True),
    "PRATA": _intl("Prata (XAG/USD - futuro SI)", "SI=F", 0.005, 3, 5000.0, "lote de 5.000 onças", 0.01),
    "PETROLEO": _intl("Petróleo WTI (futuro CL)", "CL=F", 0.01, 2, 1000.0, "lote de 1.000 barris", 0.02),
}

# intervalo do Yahoo e periodo maximo para cada tempo grafico
TEMPOS = {2: ("2m", "60d"), 5: ("5m", "60d"), 15: ("15m", "60d"), 30: ("30m", "60d"), 60: ("60m", "730d"),
          1440: ("1d", "10y")}
NOME_TEMPO = {2: "2 min", 5: "5 min", 15: "15 min", 30: "30 min", 60: "60 min", 1440: "Diário"}


def sessao_cfg(cfg):
    """Parametros de execucao que o simulador usa."""
    p = cfg.get("prm", {})
    return dict(tick=cfg["tick"], slip=cfg.get("slip", cfg["tick"]), custo=cfg.get("custo", 0.0),
                custo_pct=cfg.get("custo_pct", 0.0), passo_lote=cfg.get("passo_lote", 0.01),
                valor_ponto=cfg.get("valor_ponto") or 1.0, fracionado=cfg.get("fracionado", False),
                hora_inicio=p.get("HoraInicio", 905), hora_fim=p.get("HoraFimEntradas", 1700),
                hora_zeragem=p.get("HoraZeragem", 1745))


_cache = {}


def caminho_longo(p):
    """No Windows, caminhos com mais de 260 letras falham sem o prefixo de caminho longo (pasta muito funda)."""
    p = os.path.abspath(p)
    if os.name == "nt" and len(p) > 200 and not p.startswith("\\\\?\\"):
        return "\\\\?\\" + p
    return p


def pasta_dados(base):
    p = caminho_longo(os.path.join(base, "dados"))
    os.makedirs(os.path.join(p, "cache"), exist_ok=True)
    return p


# ------------------------------------------------------------------------------------------ fuso de cada bolsa
def _domingo(ano, mes, n):
    """n-esimo domingo do mes (dia)."""
    d = datetime(ano, mes, 1)
    primeiro = 1 + (6 - d.weekday()) % 7
    return primeiro + 7 * (n - 1)


def offset_horas(fuso, t_utc):
    if fuso == "NY":
        dt = datetime.fromtimestamp(t_utc, timezone.utc)
        ini = datetime(dt.year, 3, _domingo(dt.year, 3, 2), 7, tzinfo=timezone.utc)     # 2a domingo de marco, 2h local
        fim = datetime(dt.year, 11, _domingo(dt.year, 11, 1), 6, tzinfo=timezone.utc)   # 1o domingo de novembro
        return -4 if ini <= dt < fim else -5
    if fuso == "TOQUIO":
        return 9
    return -3                                     # Brasilia (sem horario de verao desde 2019)


def hora_local(cfg, t_utc):
    return datetime.fromtimestamp(t_utc + 3600 * offset_horas(cfg.get("fuso", "BRT"), t_utc), timezone.utc).replace(tzinfo=None)


def _add(b, dt, o, h, l, c, v):
    # horario local da bolsa "vestido" de UTC para o grafico mostrar a hora local
    t = int(datetime(dt.year, dt.month, dt.day, dt.hour, dt.minute, tzinfo=timezone.utc).timestamp())
    if b["t"] and t <= b["t"][-1]:
        return      # horario repetido/fora de ordem derrubaria o grafico
    b["t"].append(t)
    b["o"].append(o); b["h"].append(h); b["l"].append(l); b["c"].append(c); b["v"].append(v)
    b["d"].append(int(dt.strftime("%Y%m%d"))); b["hm"].append(dt.hour * 100 + dt.minute)


def _barras_vazias(tf):
    return dict(t=[], o=[], h=[], l=[], c=[], v=[], d=[], hm=[], tf=tf)


def agrupar(cfg, minutos, tf):
    """Candles de 1 minuto (t UTC, o, h, l, c, v) -> candles de tf minutos no horario local da bolsa."""
    b = _barras_vazias(tf)
    sessao, fds = cfg["sessao"], cfg.get("fim_de_semana", False)
    s0 = sessao[0] // 100 * 60 + sessao[0] % 100
    atual = None
    for t, o, h, l, c, v in minutos:
        dt = hora_local(cfg, t)
        if not fds and dt.weekday() >= 5:
            continue
        hm = dt.hour * 100 + dt.minute
        if hm < sessao[0] or hm > sessao[1]:
            continue
        m = dt.hour * 60 + dt.minute
        m0 = s0 + ((m - s0) // tf) * tf                        # candles alinhados na abertura da bolsa (NY abre 9:30)
        ini = dt.replace(hour=m0 // 60, minute=m0 % 60, second=0, microsecond=0)
        if atual is None or atual[0] != ini:
            if atual:
                _add(b, *atual)
            atual = [ini, o, h, l, c, v]
        else:
            atual[2] = max(atual[2], h)
            atual[3] = min(atual[3], l)
            atual[4] = c
            atual[5] += v
    if atual:
        _add(b, *atual)
    return b


# ------------------------------------------------------------------------------------------ Yahoo
def _baixar_yahoo(simbolo, intervalo="5m", periodo="60d"):
    url = ("https://query1.finance.yahoo.com/v8/finance/chart/%s?interval=%s&range=%s"
           % (urllib.request.quote(simbolo, safe=""), intervalo, periodo))
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def _yahoo_para_barras(js, cfg, tf=5):
    escala, sessao, fds = cfg["escala"], cfg["sessao"], cfg.get("fim_de_semana", False)
    s0 = sessao[0] // 100 * 60 + sessao[0] % 100          # a grade dos candles comeca na abertura da bolsa
    res = js["chart"]["result"][0]
    ts = res.get("timestamp") or []
    q = res["indicators"]["quote"][0]
    b = _barras_vazias(tf)
    if tf >= 1440:
        # candle diario: a data e a do fuso da propria bolsa (em Brasilia o candle de forex cairia no dia anterior)
        off = int(res.get("meta", {}).get("gmtoffset") or 0)
        for i, t in enumerate(ts):
            o, h, l, c, v = q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i]
            if None in (o, h, l, c):
                continue
            dt = datetime.fromtimestamp(t + off, timezone.utc)
            if not fds and dt.weekday() >= 5:
                continue
            h_, l_ = max(o, h, l, c), min(o, h, l, c)
            _add(b, datetime(dt.year, dt.month, dt.day), o * escala, h_ * escala, l_ * escala, c * escala, v or 0)
        return b
    for i, t in enumerate(ts):
        o, h, l, c, v = q["open"][i], q["high"][i], q["low"][i], q["close"][i], q["volume"][i]
        if None in (o, h, l, c):
            continue
        dt = hora_local(cfg, t)
        if not fds and dt.weekday() >= 5:
            continue
        if (dt.hour * 60 + dt.minute - s0) % tf:
            continue        # retrato do preco "agora" (fora da grade do tempo grafico), nao e candle
        hm = dt.hour * 100 + dt.minute
        if hm < sessao[0] or hm > sessao[1]:
            continue
        h_, l_ = max(o, h, l, c), min(o, h, l, c)       # o Yahoo as vezes manda maxima < fechamento
        _add(b, dt, o * escala, h_ * escala, l_ * escala, c * escala, v or 0)
    return b


def _juntar(antigo, novo):
    """Soma o historico guardado com o download novo (o novo manda onde os dois se sobrepoem)."""
    if not antigo or not antigo.get("t"):
        return novo
    ini = novo["t"][0] if novo["t"] else float("inf")
    k = 0
    while k < len(antigo["t"]) and antigo["t"][k] < ini:
        k += 1
    out = _barras_vazias(novo["tf"])
    for c in ("t", "o", "h", "l", "c", "v", "d", "hm"):
        out[c] = antigo[c][:k] + novo[c]
    return out


def carregar_yahoo(base, chave, tf=5, guardar=True):
    cfg = ATIVOS[chave]
    agora = time.time()
    ck = ("y", chave, tf, guardar)
    if ck in _cache and agora - _cache[ck][0] < (25 if tf < 1440 else 1800):
        return _cache[ck][1]
    sufixo = "" if tf == 5 else ("_D" if tf == 1440 else "_%dm" % tf)
    arq_cache = os.path.join(pasta_dados(base), "cache", "yahoo_%s%s.json" % (chave, sufixo))
    fonte = "Yahoo Finance (%s%s)" % (NOME_TEMPO[tf], ", atraso ~15 min" if tf < 1440 and chave in ("WIN", "WDO") else "")
    try:
        js = _baixar_yahoo(cfg["yahoo"], *TEMPOS[tf])
        if not (js.get("chart") or {}).get("result"):
            raise RuntimeError("o Yahoo nao devolveu candles")
        try:
            tmp = arq_cache + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                json.dump(js, f)
            os.replace(tmp, arq_cache)
        except OSError:
            pass            # sem permissao de gravar: segue com o download na memoria
    except Exception as e:  # sem internet -> ultimo arquivo salvo
        if not os.path.exists(arq_cache):
            raise RuntimeError("Sem internet e sem dados salvos para %s (%s)" % (chave, e))
        with open(arq_cache, encoding="utf-8") as f:
            js = json.load(f)
        fonte = "OFFLINE - ultimo download salvo em %s" % datetime.fromtimestamp(
            os.path.getmtime(arq_cache)).strftime("%d/%m %H:%M")
    b = _yahoo_para_barras(js, cfg, tf=tf)
    if guardar and tf < 1440 and b["t"]:
        # acumula: o Yahoo so da 60 dias em 2-30 min, mas o que ja foi baixado fica guardado
        pasta = os.path.join(pasta_dados(base), "historico", "yahoo")
        os.makedirs(pasta, exist_ok=True)
        arq = os.path.join(pasta, "%s_%d.json" % (chave, tf))
        try:
            antigo = None
            if os.path.exists(arq):
                with open(arq, encoding="utf-8") as f:
                    antigo = json.load(f)
            b = _juntar(antigo, b)
            with open(arq + ".tmp", "w", encoding="utf-8") as f:
                json.dump(b, f, separators=(",", ":"))
            os.replace(arq + ".tmp", arq)
        except (OSError, ValueError, KeyError):
            pass
        dias = len(set(b["d"]))
        fonte += " · %d dias guardados" % dias
    out = (b, fonte)
    _cache[ck] = (agora, out)
    return out


# ------------------------------------------------------------------------------------------ base de 5 meses
_base_cache = {}


def _historia(base, chave, tf):
    """Candles da base local (1 min agrupados), com cache enquanto nenhum arquivo novo chegar."""
    n = historico.dias_na_base(base, chave)
    ck = (chave, tf)
    if ck in _base_cache and _base_cache[ck][0] == n:
        return _base_cache[ck][1]
    minutos = historico.ler_minutos(base, chave)
    b = agrupar(ATIVOS[chave], minutos, tf)
    _base_cache[ck] = (n, b)
    return b


def _mediana(x):
    x = sorted(x)
    return x[len(x) // 2] if x else 0.0


def carregar(base, chave, tf=5):
    """Candles para o robo: base de 5 meses quando existir (forex, ouro, USTEC, JP225, BTC), senao Yahoo."""
    if chave not in ATIVOS:
        raise ValueError("ativo desconhecido: %s" % chave)
    cfg = ATIVOS[chave]
    tem_base = chave in historico.DUKAS or chave in historico.BINANCE
    # usa a fonte com mais historico: o Yahoo tem 60 dias em 2-30 min e 2 anos em 60 min;
    # a base de 5 meses so entra quando ja tiver mais dias que isso (ela cresce em segundo plano)
    dias_yahoo = 60 if tf < 60 else 730
    if tf >= 1440 or not tem_base or historico.dias_na_base(base, chave) <= dias_yahoo:
        b, fonte = carregar_yahoo(base, chave, tf)
        if tem_base and tf < 60:
            fonte += " · base de 5 meses baixando (%d dias)" % historico.dias_na_base(base, chave)
        return b, fonte
    agora = time.time()
    ck = ("b", chave, tf)
    if ck in _cache and agora - _cache[ck][0] < 25:
        return _cache[ck][1]
    hist = _historia(base, chave, tf)
    fonte_hist = "Dukascopy" if chave in historico.DUKAS else "Binance"
    recente, nota = None, ""
    try:
        if chave in historico.BINANCE:
            recente = agrupar(cfg, historico.minutos_recentes_binance(chave), tf)
        else:
            ry, _ = carregar_yahoo(base, chave, tf if tf in (2, 5, 15, 30, 60) else 5, guardar=False)
            recente = ry
    except Exception as e:
        nota = " · sem candles de hoje (%s)" % str(e)[:60]
    b = hist
    if recente and recente["t"] and hist["t"]:
        ult = hist["t"][-1]
        pos = {t: k for k, t in enumerate(hist["t"])}
        difs = [hist["c"][pos[t]] - recente["c"][k] for k, t in enumerate(recente["t"]) if t in pos][-300:]
        ajuste = _mediana(difs) if chave in historico.DUKAS else 0.0
        b = _barras_vazias(tf)
        for c in ("t", "o", "h", "l", "c", "v", "d", "hm"):
            b[c] = list(hist[c])
        novos = 0
        for k, t in enumerate(recente["t"]):
            if t <= ult:
                continue
            _add(b, datetime.fromtimestamp(t, timezone.utc).replace(tzinfo=None), recente["o"][k] + ajuste,
                 recente["h"][k] + ajuste, recente["l"][k] + ajuste, recente["c"][k] + ajuste, recente["v"][k])
            novos += 1
        if novos:
            nota = " + hoje: %s (%d candles%s)" % ("Binance" if chave in historico.BINANCE else "Yahoo", novos,
                                                   ", nível ajustado" if abs(ajuste) > 0 else "")
    dias = len(set(b["d"]))
    b["gap_real"] = chave in ("USTEC", "JP225")          # CFD negociado a noite: a abertura do pregao tem gap de verdade
    out = (b, "%s 1 min → %s · %d dias%s" % (fonte_hist, NOME_TEMPO[tf], dias, nota))
    _cache[ck] = (agora, out)
    return out


# ---------------------------------------------------------------------------
# CSV do Profit / MetaTrader (cabecalho flexivel, virgula ou ponto e virgula)
# ---------------------------------------------------------------------------
def _norm(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower().strip()
    return s.replace("<", "").replace(">", "")


def _num(s):
    s = str(s).strip().replace(" ", "")
    if "," in s and "." in s:
        s = s.replace(".", "").replace(",", ".")
    elif "," in s:
        s = s.replace(",", ".")
    return float(s) if s else 0.0


def _data_hora(ds, hs):
    ds = ds.strip(); hs = (hs or "").strip()
    if " " in ds and not hs:
        ds, hs = ds.split(" ", 1)
    for fmt in ("%d/%m/%Y", "%Y-%m-%d", "%Y.%m.%d", "%d-%m-%Y", "%Y%m%d"):
        try:
            d = datetime.strptime(ds, fmt)
            break
        except ValueError:
            d = None
    if d is None:
        raise ValueError("data invalida: " + ds)
    hs = hs[:8]
    for fmt in ("%H:%M:%S", "%H:%M"):
        try:
            h = datetime.strptime(hs, fmt)
            return d.replace(hour=h.hour, minute=h.minute)
        except ValueError:
            pass
    return d


def listar_csv(base):
    return sorted(os.path.basename(p) for p in glob.glob(os.path.join(pasta_dados(base), "*.csv")))


def carregar_csv(base, nome):
    caminho = os.path.join(pasta_dados(base), os.path.basename(nome))
    with open(caminho, "rb") as f:
        bruto = f.read()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            txt = bruto.decode(enc)
            break
        except UnicodeDecodeError:
            continue
    delim = ";" if txt.count(";") > txt.count(",") else ("\t" if "\t" in txt.splitlines()[0] else ",")
    linhas = list(csv.reader(io.StringIO(txt), delimiter=delim))
    cab = [_norm(x) for x in linhas[0]]

    def col(*nomes):
        for i, c in enumerate(cab):
            if any(c.startswith(n) for n in nomes):
                return i
        return None
    i_d, i_h = col("data", "date", "dia"), col("hora", "time", "horario")
    i_o, i_mx = col("abert", "open"), col("max", "high")
    i_mn, i_c = col("min", "low"), col("fech", "close", "ultimo")
    i_v = col("quant", "vol", "tickvol", "negoc")
    if None in (i_d, i_o, i_mx, i_mn, i_c):
        raise RuntimeError("CSV sem colunas reconhecidas (preciso de Data, Hora, Abertura, Maxima, Minima, Fechamento)")
    regs = []
    for ln in linhas[1:]:
        if len(ln) <= max(i_d, i_o, i_mx, i_mn, i_c):
            continue
        try:
            dt = _data_hora(ln[i_d], ln[i_h] if i_h is not None else "")
            regs.append((dt, _num(ln[i_o]), _num(ln[i_mx]), _num(ln[i_mn]), _num(ln[i_c]),
                         _num(ln[i_v]) if i_v is not None else 0.0))
        except (ValueError, IndexError):
            continue
    regs.sort(key=lambda r: r[0])       # o Profit exporta do mais novo para o mais antigo
    b = dict(t=[], o=[], h=[], l=[], c=[], v=[], d=[], hm=[])
    for dt, o, h, l, c, v in regs:
        h, l = max(o, h, l, c), min(o, h, l, c)
        _add(b, dt, o, h, l, c, v)
    up = nome.upper()
    if "WIN" in up or "IND" in up:
        tick, dec, vp = 5.0, 0, 0.20
    elif "WDO" in up or "DOL" in up:
        tick, dec, vp = 0.5, 1, 10.0
    else:
        difs = sorted({round(abs(a - bb), 8) for a, bb in zip(b["c"][1:500], b["c"][:499]) if a != bb})
        tick, dec, vp = (difs[0] if difs else 0.01), 2, None
    # tempo grafico do arquivo = intervalo mais comum entre candles do mesmo dia
    difs = {}
    for k in range(1, min(len(b["t"]), 3000)):
        if b["d"][k] == b["d"][k - 1]:
            m = (b["t"][k] - b["t"][k - 1]) // 60
            if m <= 0:
                continue
            difs[m] = difs.get(m, 0) + 1
    b["tf"] = max(difs, key=difs.get) if difs else 5
    b["gap_real"] = True                                   # contrato futuro exportado do Profit
    if b["tf"] >= 1380:
        b["tf"] = 1440
    cfg = dict(nome="Arquivo " + nome, tick=tick, decimais=dec, valor_ponto=vp or 1.0, moeda="R$", lote="contrato",
               prm=dict(), slip=tick, custo=0.30 if vp == 0.20 else (1.20 if vp == 10.0 else 0.0), fracionado=False)
    return b, "Arquivo CSV (%d candles de %d min)" % (len(regs), b["tf"]), cfg
