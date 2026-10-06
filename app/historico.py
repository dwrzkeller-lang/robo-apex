# -*- coding: utf-8 -*-
"""
Base historica de 5 meses em candles de 1 minuto (depois agrupados em 2/5/15/30/60 min).

  * Dukascopy (banco suico, feed ECN real): forex, ouro, Nasdaq 100 e Nikkei 225. Um arquivo por dia,
    baixado uma unica vez e guardado em dados/historico/<SIMBOLO>/<AAAAMMDD>.bi5. O servidor da Dukascopy
    e lento e limita pedidos, entao o download roda em segundo plano, devagar, e continua de onde parou.
  * Binance: Bitcoin (BTC/USDT), rapido.
  * Hoje: os candles do dia de hoje (que a Dukascopy so publica no dia seguinte) vem do Yahoo, com o nivel
    ajustado pela diferenca media entre as duas fontes no ultimo dia em comum.

Uso direto (baixar tudo agora):  python app/historico.py
"""
import datetime as _dt
import json
import lzma
import os
import struct
import sys
import threading
import time
import urllib.request

DIAS_BASE = 155                    # ~5 meses
UTC = _dt.timezone.utc
BRT = _dt.timezone(_dt.timedelta(hours=-3))

# simbolo na Dukascopy e divisor do preco
DUKAS = {"EURUSD": ("EURUSD", 1e5), "GBPUSD": ("GBPUSD", 1e5), "USDJPY": ("USDJPY", 1e3), "AUDUSD": ("AUDUSD", 1e5),
         "XAUUSD": ("XAUUSD", 1e3), "USTEC": ("USATECHIDXUSD", 1e3), "JP225": ("JPNIDXJPY", 1e3)}
BINANCE = {"BTCUSD": "BTCUSDT"}

ESTADO = dict(rodando=False, feitos=0, total=0, falhas=0, atual="", erro=None, inicio=None)
_TRAVA = threading.Lock()


def _pasta(base, sym):
    import dados_fonte as df
    p = os.path.join(df.pasta_dados(base), "historico", sym)
    os.makedirs(p, exist_ok=True)
    return p


def _dias(n=DIAS_BASE):
    hoje = _dt.datetime.now(UTC).date()
    return [hoje - _dt.timedelta(days=k) for k in range(n, 0, -1)]


def _baixar(url, tentativas=4, espera=3.0):
    erro = None
    for t in range(tentativas):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
            with urllib.request.urlopen(req, timeout=45) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return b""
            erro = e
        except Exception as e:           # tempo esgotado, conexao recusada...
            erro = e
        time.sleep(espera * (t + 1))
    raise RuntimeError(str(erro))


def faltando_dukas(base, chave):
    sym = DUKAS[chave][0]
    pasta = _pasta(base, sym)
    out = []
    for d in _dias():
        if d.weekday() == 5:               # sabado: mercado fechado
            continue
        if not os.path.exists(os.path.join(pasta, d.strftime("%Y%m%d") + ".bi5")):
            out.append(d)
    return out


def baixar_dia_dukas(base, chave, d):
    sym = DUKAS[chave][0]
    url = "https://datafeed.dukascopy.com/datafeed/%s/%04d/%02d/%02d/BID_candles_min_1.bi5" % (sym, d.year, d.month - 1, d.day)
    dados = _baixar(url)
    arq = os.path.join(_pasta(base, sym), d.strftime("%Y%m%d") + ".bi5")
    tmp = arq + ".tmp"
    with open(tmp, "wb") as f:
        f.write(dados)
    os.replace(tmp, arq)


def baixar_binance(base, chave):
    """Candles de 1 min do BTC dos ultimos ~155 dias, guardados por dia (JSON compacto)."""
    sym = BINANCE[chave]
    pasta = _pasta(base, sym)
    for d in _dias():
        arq = os.path.join(pasta, d.strftime("%Y%m%d") + ".json")
        if os.path.exists(arq):
            continue
        ini = int(_dt.datetime(d.year, d.month, d.day, tzinfo=UTC).timestamp() * 1000)
        linhas = []
        for parte in range(2):             # 1440 min = 2 pedidos de 720
            url = ("https://api.binance.com/api/v3/klines?symbol=%s&interval=1m&startTime=%d&limit=720"
                   % (sym, ini + parte * 720 * 60000))
            js = json.loads(_baixar(url).decode("utf-8") or "[]")
            linhas += [[int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])] for k in js]
        linhas = [x for x in linhas if x[0] < ini // 1000 + 86400]
        with open(arq + ".tmp", "w") as f:
            json.dump(linhas, f)
        os.replace(arq + ".tmp", arq)
        with _TRAVA:
            ESTADO["feitos"] += 1


def ler_minutos(base, chave):
    """Lista [(t_utc, o, h, l, c, v)] de 1 minuto de toda a base local."""
    out = []
    if chave in DUKAS:
        sym, div = DUKAS[chave]
        pasta = _pasta(base, sym)
        for nome in sorted(os.listdir(pasta)):
            if not nome.endswith(".bi5"):
                continue
            with open(os.path.join(pasta, nome), "rb") as f:
                bruto = f.read()
            if not bruto:
                continue
            try:
                raw = lzma.decompress(bruto)
            except lzma.LZMAError:
                continue
            d = _dt.datetime.strptime(nome[:8], "%Y%m%d").replace(tzinfo=UTC)
            t0 = int(d.timestamp())
            for k in range(len(raw) // 24):
                ts, o, c, lo, hi, v = struct.unpack_from(">IIIIIf", raw, k * 24)
                if v <= 0 and o == c == lo == hi:
                    continue                  # minuto sem negocio
                out.append((t0 + ts, o / div, hi / div, lo / div, c / div, float(v)))
    elif chave in BINANCE:
        pasta = _pasta(base, BINANCE[chave])
        for nome in sorted(os.listdir(pasta)):
            if nome.endswith(".json"):
                with open(os.path.join(pasta, nome)) as f:
                    out += [tuple(x) for x in json.load(f)]
    return out


def minutos_recentes_binance(chave, dias=3, anteriores=None):
    """Candles de 1 min do BTC dos ultimos 3 dias ate agora. Com `anteriores` (o resultado da chamada passada) baixa so
    do ultimo minuto em diante; se a Binance nao responder, devolve os anteriores (o grafico nao perde os candles de hoje)."""
    sym = BINANCE[chave]
    corte = int((time.time() - dias * 86400) // 60 * 60)
    ant = [x for x in (anteriores or []) if x[0] >= corte]
    ini = (ant[-1][0] if ant else corte) * 1000              # refaz o ultimo minuto, que estava aberto
    try:
        novos = _minutos_binance(sym, ini)
    except Exception:
        if ant:
            return ant
        raise
    if ant and novos:
        k = len(ant)
        while k and ant[k - 1][0] >= novos[0][0]:
            k -= 1
        return ant[:k] + novos
    return ant + novos


def _minutos_binance(sym, ini):
    out = []
    for _ in range(6):
        url = "https://api.binance.com/api/v3/klines?symbol=%s&interval=1m&startTime=%d&limit=1000" % (sym, ini)
        js = json.loads(_baixar(url, tentativas=2, espera=1.0).decode("utf-8") or "[]")
        if not js:
            break
        out += [(int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])) for k in js]
        ini = int(js[-1][0]) + 60000
        if len(js) < 1000:
            break
    return out


def trabalho(base, chaves=None):
    """Baixa o que falta (segundo plano). Dukascopy devagar, um arquivo por vez com pausa."""
    chaves = chaves or list(DUKAS) + list(BINANCE)
    with _TRAVA:
        if ESTADO["rodando"]:
            return
        ESTADO.update(rodando=True, feitos=0, falhas=0, erro=None, inicio=time.time())
    try:
        filas = {c: faltando_dukas(base, c) for c in chaves if c in DUKAS}
        n_bin = sum(1 for c in chaves if c in BINANCE for d in _dias()
                    if not os.path.exists(os.path.join(_pasta(base, BINANCE[c]), d.strftime("%Y%m%d") + ".json")))
        with _TRAVA:
            ESTADO["total"] = sum(len(v) for v in filas.values()) + n_bin
        for c in chaves:
            if c in BINANCE:
                ESTADO["atual"] = c
                try:
                    baixar_binance(base, c)
                except Exception as e:
                    with _TRAVA:
                        ESTADO["falhas"] += 1
                        ESTADO["erro"] = "%s: %s" % (c, e)
        # intercala os ativos: assim todos ficam utilizaveis aos poucos (do mais novo para o mais antigo)
        for c in filas:
            filas[c].reverse()
        while any(filas.values()):
            for c in list(filas):
                if not filas[c]:
                    continue
                d = filas[c].pop(0)
                ESTADO["atual"] = "%s %s" % (c, d.strftime("%d/%m"))
                try:
                    baixar_dia_dukas(base, c, d)
                    with _TRAVA:
                        ESTADO["feitos"] += 1
                except Exception as e:
                    with _TRAVA:
                        ESTADO["falhas"] += 1
                        ESTADO["erro"] = "%s %s: %s" % (c, d, e)
                time.sleep(0.5)
    finally:
        with _TRAVA:
            ESTADO["rodando"] = False
            ESTADO["atual"] = ""


_dias_mem = {}


def dias_na_base(base, chave):
    """Quantos dias ja estao na base local (contar os arquivos custa alguns ms: vale por 5 segundos)."""
    if chave not in DUKAS and chave not in BINANCE:
        return 0
    ck = (base, chave)
    v = _dias_mem.get(ck)
    if v and time.time() - v[0] < 5.0:
        return v[1]
    sym, ext = (DUKAS[chave][0], ".bi5") if chave in DUKAS else (BINANCE[chave], ".json")
    n = len([x for x in os.listdir(_pasta(base, sym)) if x.endswith(ext)])
    _dias_mem[ck] = (time.time(), n)
    return n


if __name__ == "__main__":
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    raiz = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    alvo = sys.argv[1:] or None
    t = threading.Thread(target=trabalho, args=(raiz, alvo), daemon=True)
    t.start()
    while t.is_alive():
        time.sleep(30)
        print(time.strftime("%H:%M:%S"), ESTADO["feitos"], "/", ESTADO["total"], "falhas", ESTADO["falhas"], ESTADO["atual"], flush=True)
    print("fim", ESTADO)
