# -*- coding: utf-8 -*-
"""
Criptomoedas do ROBO KELLER.

  * Candles e precos em tempo real pela BINANCE (a corretora de maior volume), sem chave: mercado a vista ("BN:DOGEUSDT")
    e futuros perpetuos ("BF:POPCATUSDT"). Qualquer moeda da Binance vira um ativo do robo (grafico, estrategias,
    simulacao e teste ao vivo), com a TAXA DA CORRETORA nas contas (0,10% por lado a vista; 0,05% no futuro).
  * Radar de moedas meme: a lista vem da propria Binance (etiqueta "Meme" a vista e nos futuros) e e atualizada
    sozinha. Para cada moeda: variacao em 5 min / 1 h / 24 h, volume da ultima hora contra o normal, pressao de compra
    (quanto do volume foi comprador agressor), se esta na maxima de 24 h, e a taxa de financiamento do futuro.
  * Estudo "o que costuma vir depois": com os candles de 1 hora dos ultimos ~120 dias de todas as memes, mede o que
    aconteceu nas 4 h e 24 h seguintes a cada estado (rompendo com volume, esquentando, esticada, despencando).
  * Tokens novos nas corretoras descentralizadas (DEX): GeckoTerminal (em alta por rede), com os sinais de risco
    visiveis (liquidez, idade, giro) e checagem de golpe sob demanda (GoPlus, RugCheck, honeypot.is).

Nada aqui envia ordem nem conecta carteira: e so leitura de dados publicos.
"""
import gzip
import http.client
import json
import math
import os
import re
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import dados_fonte as df

SPOT = ("https://api.binance.com", "https://data-api.binance.vision")
FUT = ("https://fapi.binance.com",)
SIMBOLO_OK = re.compile(r"^[A-Z0-9]{2,24}$")
INTERVALO = {2: "1m", 5: "5m", 15: "15m", 30: "30m", 60: "1h", 1440: "1d"}
MS = {"1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000, "1h": 3600000, "1d": 86400000}
# quantos candles guardar por intervalo (2 min usa 1 min agrupado)
ALVO = {"1m": 10080, "5m": 17280, "15m": 11520, "30m": 11520, "1h": 12000, "1d": 1000}
TAXA = {"BN": 0.0010, "BF": 0.0005}        # taxa de quem executa a mercado (taker), por lado
VIDA_CANDLES = 7.0                         # segundos: o mesmo pedido dentro desse tempo usa a memoria

_trava = threading.Lock()
_mem = {}                                  # (mercado, sym, intervalo) -> dict(linhas, lido, salvo)
_info_mem = {}
_b_mem = {}                                # (chave, tf) -> (linhas cruas, (B, fonte, cfg))


_local = threading.local()
_fila = ThreadPoolExecutor(max_workers=16)        # as linhas ficam vivas: cada uma guarda a sua conexao com a Binance
CABECALHO = {"User-Agent": "Mozilla/5.0", "Accept": "application/json", "Connection": "keep-alive"}


def _direto(host, caminho, timeout):
    """GET com conexao reaproveitada (sem refazer o aperto de mao a cada pedido). Devolve (status, corpo)."""
    conns = getattr(_local, "conns", None)
    if conns is None:
        conns = _local.conns = {}
    for tentativa in (0, 1):
        c = conns.get(host)
        if c is None:
            c = conns[host] = http.client.HTTPSConnection(host, timeout=timeout)
        try:
            c.request("GET", caminho, headers=CABECALHO)
            r = c.getresponse()
            return r.status, r.read()
        except (http.client.HTTPException, OSError):
            try:
                c.close()
            except Exception:
                pass
            conns.pop(host, None)                                # conexao velha caiu: abre outra e tenta mais uma vez
            if tentativa:
                raise


def _get(hosts, caminho, timeout=15):
    erro = None
    for h in hosts:
        try:
            try:
                status, corpo = _direto(h.split("//", 1)[1], caminho, timeout)
            except (http.client.HTTPException, OSError):         # rede com proxy etc.: usa o caminho normal do Python
                req = urllib.request.Request(h + caminho, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
                try:
                    with urllib.request.urlopen(req, timeout=timeout) as r:
                        status, corpo = r.status, r.read()
                except urllib.error.HTTPError as e:
                    status, corpo = e.code, e.read()
            if status == 200:
                return json.loads(corpo.decode("utf-8"))
            texto = corpo.decode("utf-8", "replace")[:200]
            if status == 400 and "Invalid symbol" in texto:
                raise ValueError("moeda não encontrada na Binance")
            erro = RuntimeError("HTTP %d %s" % (status, texto))
            if status in (418, 429):
                break                                            # a Binance pediu para ir mais devagar: nao insiste
        except ValueError:
            raise
        except Exception as e:                                   # sem internet, tempo esgotado...
            erro = e
    raise RuntimeError("a Binance não respondeu (%s)" % erro)


def _url_json(url, timeout=15, cabecalhos=None):
    h = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}
    h.update(cabecalhos or {})
    req = urllib.request.Request(url, headers=h)
    with urllib.request.urlopen(req, timeout=timeout) as r:
        corpo = r.read()
    if corpo[:2] == b"\x1f\x8b":
        corpo = gzip.decompress(corpo)
    return json.loads(corpo.decode("utf-8"))


def separar(chave):
    """'BN:DOGEUSDT' -> ('BN', 'DOGEUSDT'). Levanta ValueError se nao for uma chave de cripto valida."""
    mercado, _, sym = chave.partition(":")
    sym = sym.upper()
    if mercado not in TAXA or not SIMBOLO_OK.match(sym):
        raise ValueError("moeda inválida: %s" % chave)
    return mercado, sym


def eh_cripto(chave):
    return chave[:3] in ("BN:", "BF:")


def _pasta(base):
    p = os.path.join(df.pasta_dados(base), "historico", "cripto")
    os.makedirs(p, exist_ok=True)
    return p


def _ler_json(arq, padrao=None):
    try:
        with open(arq, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return padrao


def _gravar_json(arq, obj):
    try:
        tmp = arq + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(obj, f, separators=(",", ":"))
        os.replace(tmp, arq)
    except OSError:
        pass                                 # sem permissao de gravar: segue so na memoria


# ------------------------------------------------------------------------------------------ candles
def _klines(mercado, sym, intervalo, inicio=None, limite=1000):
    hosts, caminho = (SPOT, "/api/v3/klines") if mercado == "BN" else (FUT, "/fapi/v1/klines")
    q = "?symbol=%s&interval=%s&limit=%d" % (sym, intervalo, limite)
    if inicio is not None:
        q += "&startTime=%d" % inicio
    js = _get(hosts, caminho + q)
    # [abertura em segundos, o, h, l, c, volume em USDT, volume comprador agressor em USDT]
    return [[int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7]), float(k[10])] for k in js]


def _baixar_tudo(mercado, sym, intervalo):
    ms, alvo = MS[intervalo], ALVO[intervalo]
    agora = int(time.time() * 1000)
    primeiro = _klines(mercado, sym, intervalo, inicio=0, limite=1)
    if not primeiro:
        return []
    ini = max(primeiro[0][0] * 1000, agora - alvo * ms)
    janelas = list(range(ini, agora + 1, 1000 * ms))
    partes = list(_fila.map(lambda t0: _klines(mercado, sym, intervalo, inicio=t0), janelas))
    por_t = {}
    for p in partes:
        for k in p:
            por_t[k[0]] = k
    return [por_t[t] for t in sorted(por_t)]


def linhas(base, mercado, sym, intervalo):
    """Candles crus do intervalo, do mais antigo ao atual (o ultimo ainda esta em formacao)."""
    ck = (mercado, sym, intervalo)
    agora = time.time()
    with _trava:
        m = _mem.get(ck)
        if m and agora - m["lido"] < VIDA_CANDLES:
            return m["linhas"]
    arq = os.path.join(_pasta(base), "%s_%s_%s.json" % (mercado, sym, intervalo))
    ant = m["linhas"] if m else _ler_json(arq, [])
    ms, alvo = MS[intervalo], ALVO[intervalo]
    if ant and (agora - ant[-1][0]) * 1000 < 0.8 * alvo * ms:
        novos, t0 = [], ant[-1][0] * 1000                 # continua de onde parou (refaz o ultimo, que estava aberto)
        for _ in range(40):
            p = _klines(mercado, sym, intervalo, inicio=t0)
            novos += p
            if len(p) < 1000:
                break
            t0 = p[-1][0] * 1000 + ms
        if novos:
            k = len(ant)
            while k and ant[k - 1][0] >= novos[0][0]:
                k -= 1
            ant = ant[:k] + novos
    else:
        ant = _baixar_tudo(mercado, sym, intervalo)
    ant = ant[-alvo:]
    with _trava:
        salvo = m["salvo"] if m else 0.0
        if agora - salvo > 300:                           # grava no disco no maximo a cada 5 min
            _gravar_json(arq, ant)
            salvo = agora
        _mem[ck] = dict(linhas=ant, lido=agora, salvo=salvo)
        if len(_mem) > 120:
            for velho in sorted(_mem, key=lambda x: _mem[x]["lido"])[:30]:
                _mem.pop(velho, None)
    return ant


def _casas(tick):
    return max(0, min(10, int(round(-math.log10(tick))))) if tick < 1 else 0


def info(mercado, sym):
    """tick (menor variacao de preco) e nome da moeda."""
    ck = (mercado, sym)
    v = _info_mem.get(ck)
    if v and time.time() - v[0] < 86400:
        return v[1]
    if mercado == "BN":
        js = _get(SPOT, "/api/v3/exchangeInfo?symbol=" + sym)
        s = (js.get("symbols") or [None])[0]
    else:
        js = _get(FUT, "/fapi/v1/exchangeInfo", timeout=25)
        for x in js.get("symbols", []):
            f = next((f for f in x.get("filters", []) if f.get("filterType") == "PRICE_FILTER"), {})
            _info_mem[("BF", x["symbol"])] = (time.time(), dict(tick=float(f.get("tickSize") or 0) or 10.0 ** -int(x.get("pricePrecision", 2)),
                                                                moeda=x.get("baseAsset", ""), cotacao=x.get("quoteAsset", "USDT"),
                                                                ativo=x.get("status") == "TRADING" and x.get("contractType") == "PERPETUAL"))
        if ck not in _info_mem:
            raise ValueError("moeda não encontrada nos futuros da Binance")
        return _info_mem[ck][1]
    if not s:
        raise ValueError("moeda não encontrada na Binance")
    f = next((f for f in s.get("filters", []) if f.get("filterType") == "PRICE_FILTER"), {})
    out = dict(tick=float(f.get("tickSize") or 0) or 1e-8, moeda=s.get("baseAsset", sym), cotacao=s.get("quoteAsset", "USDT"),
               ativo=s.get("status") == "TRADING")
    _info_mem[ck] = (time.time(), out)
    return out


def _lote(base, chave, preco):
    """1 lote = potencia de 10 de moedas que vale entre US$ 10 e US$ 100 (ex.: 1.000 DOGE). Fica guardado para o
    tamanho nao mudar sozinho de um dia para o outro; so e refeito se o preco mudar mais de 20 vezes."""
    arq = os.path.join(_pasta(base), "lotes.json")
    lotes = _ler_json(arq, {}) or {}
    q = lotes.get(chave)
    if q and 2.0 <= q * preco <= 2000.0:
        return q
    q = 10.0 ** math.floor(math.log10(100.0 / preco)) if preco > 0 else 1.0
    lotes[chave] = q
    _gravar_json(arq, lotes)
    return q


def _numero(q):
    return ("%d" % q if q >= 1 else ("%f" % q).rstrip("0")).replace(",", ".")


def _milhar(q):
    return "{:,.0f}".format(q).replace(",", ".") if q >= 1 else _numero(q).replace(".", ",")


def candles(base, chave, tf):
    """(B, fonte, cfg) no formato do resto do robo. Horario de Brasilia."""
    mercado, sym = separar(chave)
    if tf not in INTERVALO:
        tf = 5
    inter = INTERVALO[tf]
    inf = info(mercado, sym)
    L = linhas(base, mercado, sym, inter)
    if not L:
        raise RuntimeError("A Binance não devolveu candles de %s." % sym)
    pronto = _b_mem.get((chave, tf))
    if pronto and pronto[0] is L:
        return pronto[1]
    preco = L[-1][4]
    lote = _lote(base, chave, preco)
    tick = inf["tick"]
    nome = "%s/%s" % (inf["moeda"], inf["cotacao"])
    cfg = dict(nome="%s · Binance%s" % (nome, " futuro" if mercado == "BF" else ""), curto=nome, yahoo=None, escala=1.0,
               tick=tick, fim_de_semana=True, sessao=(0, 2359), decimais=_casas(tick), valor_ponto=lote, moeda="US$",
               lote="lote de %s %s (≈ US$ %s)" % (_milhar(lote), inf["moeda"], ("%.0f" % (lote * preco)) if lote * preco >= 10 else ("%.2f" % (lote * preco)).replace(".", ",")),
               prm=dict(HoraInicio=0, HoraFimEntradas=2300, HoraZeragem=2355), slip=tick, custo=0.0,
               custo_pct=TAXA[mercado], fracionado=True, cripto=True, simbolo=sym, mercado=mercado, moedaBase=inf["moeda"])
    b = dict(t=[], o=[], h=[], l=[], c=[], v=[], d=[], hm=[], tf=tf, compra=[])
    passo = 2 if tf == 2 else 1
    k, n = 0, len(L)
    while k < n:
        x = L[k]
        if passo == 2:                                     # 2 min = dois candles de 1 min (minuto par + impar)
            if (x[0] // 60) % 2:
                k += 1
                continue
            o, h, l, c, v, cb = x[1], x[2], x[3], x[4], x[5], x[6]
            if k + 1 < n and L[k + 1][0] == x[0] + 60:
                y = L[k + 1]
                h, l, c, v, cb = max(h, y[2]), min(l, y[3]), y[4], v + y[5], cb + y[6]
                k += 1
        else:
            o, h, l, c, v, cb = x[1], x[2], x[3], x[4], x[5], x[6]
        antes = len(b["t"])
        # intraday: horario de Brasilia; diario: a data do proprio candle da Binance (dia em UTC)
        quando = datetime.fromtimestamp(x[0] - (0 if tf >= 1440 else 10800), timezone.utc).replace(tzinfo=None)
        df._add(b, quando, o, max(o, h, l, c), min(o, h, l, c), c, v)
        if len(b["t"]) > antes:
            b["compra"].append(cb)
        k += 1
    b["gap_real"] = False
    dias = len(set(b["d"]))
    fonte = "Binance %s · tempo real · %d dias · taxa de %s%% por lado nas contas" % (
        "futuro perpétuo" if mercado == "BF" else "à vista", dias, ("%.2f" % (100 * TAXA[mercado])).replace(".", ","))
    if len(_b_mem) > 40:
        _b_mem.clear()
    _b_mem[(chave, tf)] = (L, (b, fonte, cfg))
    return b, fonte, cfg


# ------------------------------------------------------------------------------------------ universo (quais moedas)
PRODUTOS = "https://www.binance.com/bapi/asset/v2/public/asset-service/product/get-products?includeEtf=false"
MAIORES_RESERVA = ["BTC", "ETH", "SOL", "BNB", "XRP", "ADA", "AVAX", "LINK", "SUI", "TRX", "LTC", "NEAR"]
MEMES_RESERVA = ["DOGE", "SHIB", "PEPE", "BONK", "WIF", "FLOKI", "PENGU", "TRUMP", "NEIRO", "BOME", "TURBO", "PNUT"]
_uni = dict(t=0.0, dados=None)
_trava_uni = threading.Lock()


def _base_do_futuro(b):
    """'1000PEPE' -> 'PEPE' (no futuro algumas moedas baratas sao negociadas em pacotes de mil ou de um milhao)."""
    for pre in ("1000000", "1000"):
        if b.startswith(pre) and len(b) > len(pre):
            return b[len(pre):]
    return b


def universo(base):
    """dict(memes=[...], maiores=[...]): cada item = dict(chave, sym, moeda, nome, futuro (simbolo do perpetuo ou None)).
    A lista de memes vem da etiqueta "Meme" da propria Binance (a vista e futuros) e e refeita a cada 6 horas."""
    with _trava_uni:
        if _uni["dados"] and time.time() - _uni["t"] < 6 * 3600:
            return _uni["dados"]
    arq = os.path.join(_pasta(base), "universo.json")
    memes, maiores, perps = {}, [], {}
    try:
        fi = _get(FUT, "/fapi/v1/exchangeInfo", timeout=25)
        for x in fi.get("symbols", []):
            if x.get("contractType") != "PERPETUAL" or x.get("status") != "TRADING" or x.get("quoteAsset") != "USDT":
                continue
            if not SIMBOLO_OK.match(x["symbol"]):
                continue
            eh_meme = any("meme" in str(t).lower() for t in (x.get("underlyingSubType") or []))
            perps[_base_do_futuro(x["baseAsset"])] = (x["symbol"], x["baseAsset"], eh_meme)
    except Exception:
        perps = {}
    try:
        prod = _url_json(PRODUTOS, timeout=25).get("data") or []
        usdt = [x for x in prod if x.get("q") == "USDT" and x.get("st") == "TRADING" and SIMBOLO_OK.match(x.get("s", ""))]
        for x in usdt:
            tags = [str(t).lower() for t in (x.get("tags") or [])]
            if "meme" in tags:
                memes[x["b"]] = dict(chave="BN:" + x["s"], sym=x["s"], moeda=x["b"], nome=x.get("an") or x["b"], futuro=None)
        ruins = ("stablecoin", "bstocks", "tcommodities")
        resto = [x for x in usdt if x["b"] not in memes and not any(t in ruins for t in [str(t).lower() for t in (x.get("tags") or [])])]
        resto.sort(key=lambda x: -float(x.get("qv") or 0))
        maiores = [dict(chave="BN:" + x["s"], sym=x["s"], moeda=x["b"], nome=x.get("an") or x["b"], futuro=None) for x in resto[:15]]
    except Exception:
        pass
    for b, (sym, base_f, eh_meme) in perps.items():
        if b in memes:
            memes[b]["futuro"] = sym
        elif eh_meme:
            memes[b] = dict(chave="BF:" + sym, sym=sym, moeda=base_f, nome=base_f, futuro=sym)
    for m in maiores:
        if m["moeda"] in perps:
            m["futuro"] = perps[m["moeda"]][0]
    dados = dict(memes=list(memes.values()), maiores=maiores)
    if len(dados["memes"]) < 5 or not maiores:
        salvo = _ler_json(arq)
        if salvo and salvo.get("memes"):
            dados = salvo                                   # a Binance nao respondeu: usa a ultima lista guardada
        else:
            dados = dict(memes=dados["memes"] or [dict(chave="BN:%sUSDT" % b, sym=b + "USDT", moeda=b, nome=b, futuro=None) for b in MEMES_RESERVA],
                         maiores=maiores or [dict(chave="BN:%sUSDT" % b, sym=b + "USDT", moeda=b, nome=b, futuro=None) for b in MAIORES_RESERVA])
    else:
        _gravar_json(arq, dados)
    with _trava_uni:
        _uni.update(t=time.time(), dados=dados)
    return dados


# ------------------------------------------------------------------------------------------ radar (retrato de agora)
VOL_ROMPE, VOL_ESQUENTA, ALTA_ESQUENTA, ESTICADA, DESPENCOU = 3.0, 2.0, 0.02, 0.30, -0.20
_painel = dict(t=0.0, dados=None, rodando=False)
_trava_painel = threading.Lock()
VIDA_PAINEL = 12.0


def _medir(item, L, preco_agora=None):
    """Medidas de uma moeda a partir dos candles de 5 min (os ultimos ~3,5 dias). Devolve None se faltar historico."""
    n = len(L)
    if n < 60:
        return None
    c = [x[4] for x in L]
    ult = preco_agora or c[-1]
    volta = lambda k: (ult / c[-1 - k] - 1.0) if n > k and c[-1 - k] > 0 else None       # noqa: E731
    v60 = sum(x[5] for x in L[-12:])
    comp = sum(x[6] for x in L[-12:])
    antes = L[max(0, n - 12 - 864):n - 12]                 # as 72 horas anteriores a ultima hora
    horas = len(antes) / 12.0
    media_h = sum(x[5] for x in antes) / horas if horas >= 12 else None
    vol_rel = (v60 / media_h) if media_h and media_h > 0 else None
    j24 = L[max(0, n - 12 - 288):n - 12]
    max24 = max(x[2] for x in j24) if len(j24) >= 100 else None
    r60, r24 = volta(12), volta(288)
    estado = None
    if vol_rel is not None and r60 is not None:
        rompeu = max24 is not None and max(x[2] for x in L[-12:]) > max24 and ult >= max24
        if rompeu and vol_rel >= VOL_ROMPE and r60 > 0:
            estado = "rompendo"
        elif vol_rel >= VOL_ESQUENTA and r60 >= ALTA_ESQUENTA:
            estado = "esquentando"
    alerta = "esticada" if (r24 is not None and r24 >= ESTICADA) else ("despencando" if (r24 is not None and r24 <= DESPENCOU) else None)
    passo = max(1, (min(n, 288)) // 24)
    spark = [c[k] for k in range(max(0, n - 288), n, passo)][-24:] + [ult]
    return dict(chave=item["chave"], sym=item["sym"], moeda=item["moeda"], nome=item.get("nome") or item["moeda"],
                mercado="futuro" if item["chave"].startswith("BF:") else "vista", preco=ult,
                r5=volta(1), r60=r60, r4h=volta(48), r24=r24, v60=v60, volRel=vol_rel,
                compra=(comp / v60) if v60 > 0 else None, estado=estado, alerta=alerta, spark=spark, funding=None, v24=None)


def _varrer(base):
    uni = universo(base)
    itens = uni["memes"] + uni["maiores"]

    def um(item):
        try:
            mercado, sym = separar(item["chave"])
            return _medir(item, _klines(mercado, sym, "5m", limite=1000))
        except Exception:
            return None
    linhas_ = list(_fila.map(um, itens))
    por_chave = {r["chave"]: r for r in linhas_ if r}
    # volume de 24 h (a vista) e taxa de financiamento (futuros): um pedido para todas as moedas
    try:
        spot = [i["sym"] for i in itens if i["chave"].startswith("BN:")]
        q = urllib.parse.quote(json.dumps(spot, separators=(",", ":")))
        for t in _get(SPOT, "/api/v3/ticker/24hr?type=MINI&symbols=" + q):
            r = por_chave.get("BN:" + t["symbol"])
            if r:
                r["v24"] = float(t.get("quoteVolume") or 0)
    except Exception:
        pass
    try:
        fund = {x["symbol"]: float(x.get("lastFundingRate") or 0) for x in _get(FUT, "/fapi/v1/premiumIndex")}
        vol_f = {x["symbol"]: float(x.get("quoteVolume") or 0) for x in _get(FUT, "/fapi/v1/ticker/24hr")}
        for i in itens:
            r = por_chave.get(i["chave"])
            if r and i.get("futuro"):
                r["funding"] = fund.get(i["futuro"])
                if r["v24"] is None:
                    r["v24"] = vol_f.get(i["futuro"])
    except Exception:
        pass
    ordem = {"rompendo": 0, "esquentando": 1}

    def chave_ordem(r):
        return (ordem.get(r["estado"], 2), -((r["volRel"] or 0) * max(r["r60"] or 0, 0.0)), -(r["v24"] or 0))
    memes = sorted([por_chave[i["chave"]] for i in uni["memes"] if i["chave"] in por_chave], key=chave_ordem)
    maiores = [por_chave[i["chave"]] for i in uni["maiores"] if i["chave"] in por_chave]
    return dict(memes=memes, maiores=maiores, t=time.time(), total=len(itens), respondidas=len(por_chave))


def painel(base):
    """Retrato do radar. A primeira chamada espera a varredura; depois devolve na hora o retrato que tem e, se ele
    passou de 12 s, refaz em segundo plano (uma varredura por vez). Devolve tambem o estudo, se ja estiver pronto."""
    def refazer():
        try:
            dados = _varrer(base)
            with _trava_painel:
                if dados["respondidas"] or not _painel["dados"]:
                    _painel.update(t=time.time(), dados=dados)
        finally:
            with _trava_painel:
                _painel["rodando"] = False
    with _trava_painel:
        tem = _painel["dados"] is not None
        velho = time.time() - _painel["t"] > VIDA_PAINEL
        disparar = (not tem or velho) and not _painel["rodando"]
        if disparar:
            _painel["rodando"] = True
    if disparar and tem:
        threading.Thread(target=refazer, daemon=True).start()
    elif disparar:
        refazer()
    elif not tem:                                            # outra chamada ja esta fazendo a primeira varredura: espera
        for _ in range(100):
            time.sleep(0.2)
            if _painel["dados"] is not None:
                break
    with _trava_painel:
        if _painel["dados"] is None:
            raise RuntimeError("A Binance não respondeu ao radar. Tente de novo em instantes.")
        out = dict(_painel["dados"])
    out["estudo"] = estudo(base)
    out["regras"] = dict(volRompe=VOL_ROMPE, volEsquenta=VOL_ESQUENTA, altaEsquenta=ALTA_ESQUENTA, esticada=ESTICADA, despencou=DESPENCOU)
    return out


# ------------------------------------------------------------------------------------------ estudo: o que veio depois
ESTUDO_PAGINAS, ESTUDO_VIDA = 3, 12 * 3600          # 3 x 1000 candles de 1 h (~125 dias); refeito a cada 12 h
_est = dict(t=0.0, dados=None, rodando=False)
_trava_est = threading.Lock()


def _klines_1h(mercado, sym):
    hosts, caminho = (SPOT, "/api/v3/klines") if mercado == "BN" else (FUT, "/fapi/v1/klines")
    out, fim = [], None
    for _ in range(ESTUDO_PAGINAS):
        q = "?symbol=%s&interval=1h&limit=1000" % sym + ("&endTime=%d" % fim if fim else "")
        js = _get(hosts, caminho + q)
        if not js:
            break
        out = js + out
        fim = int(js[0][0]) - 1
        if len(js) < 1000:
            break
    return [[int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[7])] for k in out]


def _eventos(K):
    """Para cada hora fechada: em que estado a moeda estava e o que aconteceu nas 24 horas seguintes."""
    n = len(K)
    c = [k[4] for k in K]; h = [k[2] for k in K]; l = [k[3] for k in K]; v = [k[5] for k in K]
    ev = []
    soma = sum(v[98:170]) if n > 200 else 0.0
    for i in range(170, n - 25):
        if i > 170:
            soma += v[i - 1] - v[i - 73]
        media = soma / 72.0
        if media <= 0 or c[i] <= 0 or c[i - 1] <= 0 or c[i - 24] <= 0:
            continue
        rv, r1, r24 = v[i] / media, c[i] / c[i - 1] - 1.0, c[i] / c[i - 24] - 1.0
        estados = ["base"]
        if c[i] >= max(h[i - 24:i]) and rv >= VOL_ROMPE and r1 > 0:
            estados.append("rompendo")
        elif rv >= VOL_ESQUENTA and r1 >= ALTA_ESQUENTA:
            estados.append("esquentando")
        if r24 >= ESTICADA:
            estados.append("esticada")
        if r24 <= DESPENCOU:
            estados.append("despencando")
        ev.append((estados, c[i + 24] / c[i] - 1.0, max(h[i + 1:i + 25]) / c[i] - 1.0, min(l[i + 1:i + 25]) / c[i] - 1.0))
    return ev


def _resumir(ev_todos, n_moedas, dias):
    out = {}
    for nome in ("base", "rompendo", "esquentando", "esticada", "despencando"):
        x = [e for e in ev_todos if nome in e[0]]
        n = len(x)
        if n < 30:
            out[nome] = dict(n=n)
            continue
        f24 = sorted(e[1] for e in x)
        pct = lambda cond: 100.0 * sum(1 for e in x if cond(e)) / n                    # noqa: E731
        out[nome] = dict(n=n, subiu=pct(lambda e: e[1] > 0), mediana=100 * f24[n // 2], media=100 * sum(f24) / n,
                         alta10=pct(lambda e: e[2] >= 0.10), alta20=pct(lambda e: e[2] >= 0.20), alta50=pct(lambda e: e[2] >= 0.50),
                         queda10=pct(lambda e: e[3] <= -0.10), queda20=pct(lambda e: e[3] <= -0.20))
    return dict(estados=out, moedas=n_moedas, dias=dias, feito=time.time())


def _estudar(base):
    try:
        uni = universo(base)
        todos, moedas, dias = [], 0, 0
        for item in uni["memes"]:
            try:
                mercado, sym = separar(item["chave"])
                K = _klines_1h(mercado, sym)
            except Exception:
                continue
            if len(K) < 400:
                continue
            todos += _eventos(K)
            moedas += 1
            dias = max(dias, len(K) // 24)
            time.sleep(0.1)
        if moedas >= 5:
            dados = _resumir(todos, moedas, dias)
            _gravar_json(os.path.join(_pasta(base), "estudo_memes.json"), dados)
            with _trava_est:
                _est.update(t=time.time(), dados=dados)
    finally:
        with _trava_est:
            _est["rodando"] = False


def estudo(base):
    """Resultado do estudo (ou None enquanto a primeira conta nao termina). Dispara a conta em segundo plano quando esta velho."""
    with _trava_est:
        if _est["dados"] is None:
            salvo = _ler_json(os.path.join(_pasta(base), "estudo_memes.json"))
            if salvo and salvo.get("estados"):
                _est.update(dados=salvo, t=float(salvo.get("feito") or 0))
        velho = time.time() - _est["t"] > ESTUDO_VIDA
        if velho and not _est["rodando"]:
            _est["rodando"] = True
            threading.Thread(target=_estudar, args=(base,), daemon=True).start()
        return _est["dados"]


# ------------------------------------------------------------------------------------------ tokens novos nas DEX
GT = "https://api.geckoterminal.com/api/v2"
GT_CABECALHO = {"Accept": "application/json;version=20230203"}
GRANDES = {"SOL", "WSOL", "ETH", "WETH", "BTC", "WBTC", "CBBTC", "CBETH", "STETH", "WSTETH", "USDC", "USDT", "USD1", "DAI", "USDE",
           "BNB", "WBNB", "TON", "SUI", "TRX", "JITOSOL", "MSOL", "BUSD", "FDUSD", "PYUSD", "USDS"}
REDES = {"solana": "Solana", "base": "Base", "eth": "Ethereum", "bsc": "BNB Chain", "ton": "TON", "sui-network": "Sui",
         "arbitrum": "Arbitrum", "polygon_pos": "Polygon", "avax": "Avalanche", "tron": "Tron", "robinhood": "Robinhood Chain"}
DS_REDE = {"eth": "ethereum", "sui-network": "sui", "polygon_pos": "polygon", "avax": "avalanche"}
_dex = dict(t=0.0, dados=None)
_trava_dex = threading.Lock()


def _f(x):
    try:
        return float(x)
    except (TypeError, ValueError):
        return None


def _pools(caminho):
    js = _url_json(GT + caminho, timeout=20, cabecalhos=GT_CABECALHO)
    tokens = {t["id"]: t.get("attributes", {}) for t in js.get("included", []) if t.get("type") == "token"}
    out = []
    agora = time.time()
    for p in js.get("data", []):
        a, rel = p.get("attributes", {}), p.get("relationships", {})
        rede = ((rel.get("network") or {}).get("data") or {}).get("id") or p.get("id", "").split("_")[0]
        tid = ((rel.get("base_token") or {}).get("data") or {}).get("id", "")
        tk = tokens.get(tid, {})
        simbolo = tk.get("symbol") or (a.get("name") or "?").split(" / ")[0]
        if simbolo.upper() in GRANDES:
            continue
        liq, vol24, fdv = _f(a.get("reserve_in_usd")), _f((a.get("volume_usd") or {}).get("h24")), _f(a.get("fdv_usd"))
        if not liq or liq < 3000:
            continue
        var = {k: (None if _f(v) is None else _f(v) / 100.0) for k, v in (a.get("price_change_percentage") or {}).items()}
        tx = (a.get("transactions") or {}).get("h1") or {}
        try:
            criado = datetime.strptime(a.get("pool_created_at", "")[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
            idade_h = max(0.0, (agora - criado) / 3600.0)
        except ValueError:
            idade_h = None
        compras, vendas = tx.get("buys") or 0, tx.get("sells") or 0
        sinais = []                                          # sinais de risco visiveis so com os numeros da pool
        if liq < 10000:
            sinais.append(("perigo", "liquidez muito baixa (menos de US$ 10 mil): pode não dar para sair"))
        elif liq < 50000:
            sinais.append(("aviso", "liquidez baixa (menos de US$ 50 mil)"))
        if idade_h is not None and idade_h < 24:
            sinais.append(("perigo", "criado há menos de 1 dia"))
        elif idade_h is not None and idade_h < 72:
            sinais.append(("aviso", "criado há menos de 3 dias"))
        if vol24 and vol24 / liq > 30:
            sinais.append(("aviso", "volume de 24 h mais de 30 vezes a liquidez (pode ser volume artificial)"))
        if fdv and liq / fdv < 0.01:
            sinais.append(("aviso", "a liquidez é menos de 1% do valor de mercado"))
        if compras >= 50 and vendas <= 0.05 * compras:
            sinais.append(("perigo", "quase só compras na última hora: pode ser impossível vender (honeypot)"))
        if (var.get("h24") or 0) >= 3.0:
            sinais.append(("aviso", "já subiu mais de 300% em 24 h"))
        ender = a.get("address") or p.get("id", "").split("_", 1)[-1]
        out.append(dict(id=p.get("id"), rede=rede, redeNome=REDES.get(rede, rede), pool=ender, token=tk.get("address") or tid.split("_", 1)[-1],
                        simbolo=simbolo, nome=tk.get("name") or simbolo, preco=_f(a.get("base_token_price_usd")),
                        r5=var.get("m5"), r60=var.get("h1"), r6h=var.get("h6"), r24=var.get("h24"),
                        vol24=vol24, vol1h=_f((a.get("volume_usd") or {}).get("h1")), liq=liq, fdv=fdv, idadeH=idade_h,
                        compras1h=compras, vendas1h=vendas, sinais=sinais,
                        risco="MUITO ALTO" if any(s[0] == "perigo" for s in sinais) or len(sinais) >= 2 else "ALTO",
                        gt="https://www.geckoterminal.com/%s/pools/%s" % (rede, ender),
                        ds="https://dexscreener.com/%s/%s" % (DS_REDE.get(rede, rede), ender)))
    return out


def dex(base):
    """Tokens em alta nas corretoras descentralizadas (GeckoTerminal, janela de 1 hora). A API publica permite poucos
    pedidos por minuto, entao o retrato e refeito no maximo a cada 3 minutos (3 pedidos)."""
    with _trava_dex:
        if _dex["dados"] and time.time() - _dex["t"] < 180:
            return _dex["dados"]
        vistos, lista, erros = set(), [], []
        for caminho in ("/networks/trending_pools?duration=1h&include=base_token&page=1",
                        "/networks/solana/trending_pools?duration=1h&include=base_token&page=1",
                        "/networks/base/trending_pools?duration=1h&include=base_token&page=1"):
            try:
                for r in _pools(caminho):
                    k = (r["rede"], r["token"])
                    if k not in vistos:
                        vistos.add(k)
                        lista.append(r)
            except Exception as e:
                erros.append(str(e)[:80])
            time.sleep(1.2)
        if lista or not _dex["dados"]:
            _dex.update(t=time.time(), dados=dict(tokens=lista, t=time.time(), erro="; ".join(erros) if not lista else None,
                                                  fonte="GeckoTerminal (em alta na última hora)"))
        else:
            _dex["t"] = time.time() - 120                    # falhou agora: mantem o retrato anterior e tenta de novo em 1 min
        return _dex["dados"]


# ------------------------------------------------------------------------------------------ checagem de golpe
GOPLUS_REDE = {"eth": "1", "bsc": "56", "base": "8453", "arbitrum": "42161", "polygon_pos": "137", "avax": "43114"}
RUGCHECK_PT = {
    "mutable metadata": "o dono pode mudar o nome e a imagem do token",
    "freeze authority still enabled": "o dono pode CONGELAR o token na sua carteira",
    "mint authority still enabled": "o dono pode criar mais moedas quando quiser",
    "low liquidity": "liquidez baixa",
    "low amount of lp providers": "poucas carteiras fornecem a liquidez",
    "large amount of lp unlocked": "grande parte da liquidez não está travada (pode ser retirada)",
    "lp unlocked": "a liquidez não está travada (pode ser retirada)",
    "single holder ownership": "uma única carteira tem grande parte das moedas",
    "top 10 holders high ownership": "as 10 maiores carteiras têm grande parte das moedas",
    "high holder concentration": "as moedas estão concentradas em poucas carteiras",
    "high holder correlation": "muitas carteiras parecem ser do mesmo grupo",
    "creator history of rugged tokens": "o criador já lançou tokens que deram golpe",
    "copycat token": "token imitando outro mais conhecido",
    "low amount of holders": "poucos donos",
    "high ownership": "concentração alta de moedas",
}
_seg = {}


def seguranca(rede, token):
    """Junta as checagens gratuitas que existem para o token. Devolve itens (perigo / aviso / ok / info) em portugues.
    Passar aqui NAO garante nada: so pega os golpes mais comuns."""
    rede, token = str(rede).strip(), str(token).strip()
    if not re.match(r"^[a-z0-9_\-]{2,30}$", rede) or not re.match(r"^[A-Za-z0-9]{20,80}$", token):
        raise ValueError("token inválido")
    ck = (rede, token)
    if ck in _seg and time.time() - _seg[ck][0] < 600:
        return _seg[ck][1]
    itens, fontes = [], []
    add = lambda nivel, texto: itens.append(dict(nivel=nivel, texto=texto))        # noqa: E731

    def gt():
        a = _url_json("%s/networks/%s/tokens/%s/info" % (GT, rede, token), timeout=12, cabecalhos=GT_CABECALHO)["data"]["attributes"]
        fontes.append("GeckoTerminal")
        if a.get("is_honeypot") is True or str(a.get("is_honeypot")).lower() in ("yes", "true"):
            add("perigo", "marcado como HONEYPOT: dá para comprar, mas não para vender")
        ma, fa = str(a.get("mint_authority") or "").lower(), str(a.get("freeze_authority") or "").lower()
        if ma and ma not in ("no", "none", "null"):
            add("perigo", "o dono ainda pode criar mais moedas (autoridade de emissão ativa)")
        elif ma == "no":
            add("ok", "ninguém pode criar mais moedas")
        if fa and fa not in ("no", "none", "null"):
            add("perigo", "o dono pode congelar o token na sua carteira")
        elif fa == "no":
            add("ok", "ninguém pode congelar o token")
        h = a.get("holders") or {}
        top = _f((h.get("distribution_percentage") or {}).get("top_10"))
        if top is not None:
            txt = "as 10 maiores carteiras têm %s%% das moedas" % ("%.0f" % top)
            add("perigo" if top >= 60 else "aviso" if top >= 30 else "ok", txt + (" (a conta inclui a pool e corretoras)" if top >= 30 else ""))
        if h.get("count") is not None:
            add("aviso" if h["count"] < 300 else "info", "%s carteiras têm o token" % "{:,}".format(int(h["count"])).replace(",", "."))
        dev = _f(a.get("developer_holding_percentage"))
        if dev is not None and dev >= 5:
            add("perigo" if dev >= 20 else "aviso", "o criador ainda tem %s%% das moedas" % ("%.0f" % dev))
        if a.get("gt_score") is not None:
            add("info", "nota GeckoTerminal: %.0f de 100 (leva em conta pool, transações, idade e informações)" % a["gt_score"])

    def rugcheck():
        j = _url_json("https://api.rugcheck.xyz/v1/tokens/%s/report/summary" % token, timeout=12)
        fontes.append("RugCheck")
        for r in j.get("risks") or []:
            nome = str(r.get("name") or "")
            pt = RUGCHECK_PT.get(nome.lower())
            add("perigo" if r.get("level") == "danger" else "aviso", pt or ("%s: %s" % (nome, r.get("description") or "")).strip(": "))
        if not j.get("risks"):
            add("ok", "RugCheck não apontou risco conhecido")
        lp = _f(j.get("lpLockedPct"))
        if lp is not None:
            add("ok" if lp >= 90 else "aviso" if lp >= 50 else "perigo", "%s%% da liquidez está travada ou queimada" % ("%.0f" % lp))

    def honeypot():
        j = _url_json("https://api.honeypot.is/v2/IsHoneypot?address=" + token, timeout=12)
        fontes.append("honeypot.is")
        if (j.get("honeypotResult") or {}).get("isHoneypot"):
            add("perigo", "HONEYPOT confirmado na simulação: a venda falha")
        elif j.get("simulationSuccess"):
            add("ok", "a simulação conseguiu comprar e vender")
        else:
            add("aviso", "não foi possível simular a venda deste token (a checagem de honeypot ficou sem resposta)")
        sim = j.get("simulationResult") or {}
        for lado, k in (("compra", "buyTax"), ("venda", "sellTax")):
            v = _f(sim.get(k))
            if v is not None and v > 0:
                add("perigo" if v >= 25 else "aviso" if v >= 5 else "info", "taxa de %s do token: %s%%" % (lado, ("%.1f" % v).replace(".", ",")))

    def goplus():
        j = _url_json("https://api.gopluslabs.io/api/v1/token_security/%s?contract_addresses=%s" % (GOPLUS_REDE[rede], token), timeout=12)
        r = (j.get("result") or {})
        r = r.get(token.lower()) or r.get(token) or (list(r.values())[0] if r else None)
        if not r:
            return
        fontes.append("GoPlus")
        um = lambda k: str(r.get(k, "")) == "1"                                        # noqa: E731
        if um("is_honeypot") or um("cannot_sell_all"):
            add("perigo", "não dá para vender tudo (honeypot)")
        if um("is_mintable"):
            add("aviso", "o contrato permite criar mais moedas")
        if um("hidden_owner") or um("can_take_back_ownership"):
            add("perigo", "dono escondido ou que pode retomar o controle do contrato")
        if um("transfer_pausable"):
            add("perigo", "o dono pode pausar as transferências")
        if um("is_blacklisted"):
            add("aviso", "o contrato tem lista negra (pode bloquear carteiras)")
        if um("slippage_modifiable"):
            add("aviso", "o dono pode aumentar a taxa depois")
        if str(r.get("is_open_source", "")) == "0":
            add("aviso", "código do contrato fechado: várias checagens ficam cegas")
        travada = sum((_f(x.get("percent")) or 0) for x in (r.get("lp_holders") or []) if str(x.get("is_locked")) == "1")
        if r.get("lp_holders"):
            if travada >= 0.5:
                add("ok" if travada >= 0.9 else "aviso", "%.0f%% da liquidez está travada" % (100 * travada))
            else:
                add("aviso", "a liquidez não aparece como travada: quem a colocou pode retirar")

    tarefas = [gt] + ([rugcheck] if rede == "solana" else []) + ([honeypot] if rede in ("eth", "bsc", "base") else []) + ([goplus] if rede in GOPLUS_REDE else [])

    def rodar(fn):
        try:
            fn()
        except Exception:
            pass
    with ThreadPoolExecutor(max_workers=4) as ex:
        list(ex.map(rodar, tarefas))
    ordem = {"perigo": 0, "aviso": 1, "ok": 2, "info": 3}
    vistos, limpos = set(), []
    for it in sorted(itens, key=lambda x: ordem[x["nivel"]]):
        if it["texto"] not in vistos:
            vistos.add(it["texto"])
            limpos.append(it)
    out = dict(itens=limpos, fontes=sorted(set(fontes)), perigos=sum(1 for i in limpos if i["nivel"] == "perigo"),
               avisos=sum(1 for i in limpos if i["nivel"] == "aviso"))
    if fontes:
        _seg[ck] = (time.time(), out)
        if len(_seg) > 300:
            _seg.clear()
    return out
