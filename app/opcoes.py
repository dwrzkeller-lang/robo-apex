# -*- coding: utf-8 -*-
"""
Opcoes da B3 do ROBO APEX (para APRENDER e enxergar oportunidades; nada aqui envia ordem).

  * Grade de opcoes sobre acoes: arquivos oficiais de fim de dia da B3 (cadastro das series, negocios e posicoes em
    aberto). Sao arquivos grandes (20 MB + 5 MB + 4 MB): baixados UMA vez por pregao, numa linha de execucao propria, e
    guardados enxutos em <dados>/opcoes/cad_<data>.json. Enquanto baixa, a tela ve o andamento (estado/progresso).
  * Cotacao do dia (com ~15 min de atraso) do ativo e das series perto do dinheiro: cotacao.b3.com.br, 20 s de memoria.
  * Juros: CDI do Banco Central (12 h de memoria). Historico diario do ativo: Yahoo (30 min de memoria), para a
    volatilidade historica (21 e 63 pregoes) e as medias de 20, 50 e 200.
  * Contas feitas aqui: Black-Scholes europeu (as calls americanas sao aproximadas), volatilidade implicita por
    bissecao (1% a 400%), gregas, e as estruturas (resultado no vencimento, hoje, empates, chance aproximada de lucro).
  * Reserva: se os arquivos da B3 falharem, a serie mensal mais proxima vem do opcoes.net.br (1 pedido por ativo a
    cada 5 min).

Os precos sao de ULTIMO NEGOCIO (nao ha livro de ofertas aqui): na pratica existe diferenca entre compra e venda.
Nenhuma estrutura e infalivel; "entra_agora" e so uma conferencia de regras, nunca uma recomendacao.
"""
import gzip
import http.client
import json
import math
import os
import re
import threading
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, wait
from datetime import date, datetime, timedelta, timezone

import dados_fonte as df

ATIVOS_PADRAO = ["PETR4", "VALE3", "BOVA11", "ITUB4", "BBAS3", "BBDC4", "ABEV3", "B3SA3", "MGLU3", "WEGE3"]
ATIVO_OK = re.compile(r"^[A-Z]{4}[0-9]{1,2}$")
SERIE_OK = re.compile(r"^[A-Z0-9]{5,12}$")
DATA_OK = re.compile(r"^\d{4}-\d{2}-\d{2}$")
CAB = {"User-Agent": "Mozilla/5.0 (RoboApex)", "Accept": "*/*", "Accept-Encoding": "gzip"}
LOTE = 100
TAXA_B3 = 0.00134                  # estimativa de emolumentos + registro + liquidacao sobre o premio, por perna
CDI_RESERVA = 14.0                 # % a.a., usado so se o Banco Central nao responder e nao houver valor guardado
VIDA_COTACAO = 20.0
VIDA_HIST = 1800.0
VIDA_CDI = 12 * 3600.0
VIDA_RESERVA = 300.0
VIDA_OPORT = 300.0
MIN_NEG = 10                       # negocios no pregao para uma serie contar como "com liquidez"
MIN_SNAP = 60                      # fotos diarias de VI para o ranking de VI valer

# feriados da B3 (sem pregao) em 2026 e 2027
FERIADOS = set("""
2026-01-01 2026-02-16 2026-02-17 2026-04-03 2026-04-21 2026-05-01 2026-06-04 2026-09-07 2026-10-12 2026-11-02
2026-11-20 2026-12-24 2026-12-25 2026-12-31
2027-01-01 2027-02-08 2027-02-09 2027-03-26 2027-04-21 2027-05-27 2027-09-07 2027-10-12 2027-11-02 2027-11-15
2027-12-24 2027-12-31
""".split())

_trava = threading.Lock()
_mem = {}                          # chave -> (vence, valor)
_cad = None                        # grade do ultimo pregao na memoria: dict(data, semOI, ativos, fech)
_est = dict(estado="vazio", progresso=0, etapa="", data=None, erro=None)
_ult_checagem = 0.0
_fila = ThreadPoolExecutor(max_workers=6)

# colunas da linha enxuta de cada serie
TK, TP, ES, KK, VC, LT, UL, RF, NG, VL, MN, MX, OI, CB, DS = range(15)


class ErroDados(RuntimeError):
    """Falha de fonte de dados, ja com a mensagem em portugues."""


class ErroHTTP(ErroDados):
    def __init__(self, codigo, msg):
        ErroDados.__init__(self, msg)
        self.codigo = codigo


# ------------------------------------------------------------------------------------------ rede e memoria
def _http(url, timeout=20, quem="a fonte de dados", prog=None):
    """GET devolvendo os bytes. `prog(lidos, total)` e chamado durante a leitura (arquivos grandes)."""
    req = urllib.request.Request(url, headers=CAB)
    try:
        with urllib.request.urlopen(req, timeout=min(timeout, 120)) as r:
            total = int(r.headers.get("Content-Length") or 0)
            partes, lidos = [], 0
            while True:
                p = r.read(262144)
                if not p:
                    break
                partes.append(p)
                lidos += len(p)
                if prog:
                    prog(lidos, total)
            corpo = b"".join(partes)
    except urllib.error.HTTPError as e:
        raise ErroHTTP(e.code, "%s respondeu com erro (HTTP %d)" % (quem, e.code))
    except (urllib.error.URLError, http.client.HTTPException, OSError) as e:
        raise ErroDados("%s não respondeu (sem internet ou tempo esgotado)" % quem)
    if corpo[:2] == b"\x1f\x8b":
        try:
            corpo = gzip.decompress(corpo)
        except (OSError, EOFError):
            raise ErroDados("%s mandou uma resposta corrompida" % quem)
    return corpo


def _json_url(url, timeout=15, quem="a fonte de dados"):
    try:
        return json.loads(_http(url, timeout, quem).decode("utf-8", "replace"))
    except ValueError:
        raise ErroDados("%s mandou uma resposta que não entendi" % quem)


def _memo(chave, vida, fn, vida_erro=60.0):
    """Valor guardado por `vida` segundos. Se a busca falhar, devolve o valor antigo (ou None) e so tenta de novo
    depois de `vida_erro` segundos: sem internet, os pedidos seguintes nao ficam esperando."""
    agora = time.time()
    with _trava:
        m = _mem.get(chave)
    if m and agora < m[0]:
        return m[1]
    try:
        v, dura = fn(), vida
    except Exception:
        v, dura = (m[1] if m else None), vida_erro
    with _trava:
        _mem[chave] = (agora + dura, v)
        if len(_mem) > 4000:                                  # nao cresce sem fim
            for k in [k for k, x in _mem.items() if x[0] < agora]:
                _mem.pop(k, None)
    return v


def _pasta(base):
    p = os.path.join(df.pasta_dados(base), "opcoes")
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


def _n(s):
    """'43,94' -> 43.94 ; vazio -> None"""
    if not s:
        return None
    try:
        return float(s.replace(",", "."))
    except ValueError:
        return None


def _a(v, d=2):
    return None if v is None or v != v or abs(v) == float("inf") else round(v, d)


def _br(v, d=2):
    if v is None:
        return "—"
    s = ("%." + str(d) + "f") % abs(v)
    inteiro, _, frac = s.partition(".")
    grupos = []
    while len(inteiro) > 3:
        grupos.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    grupos.insert(0, inteiro)
    return ("−" if v < 0 else "") + ".".join(grupos) + ("," + frac if frac else "")


def _rs(v, d=2):
    return "—" if v is None else ("−R$ " if v < 0 else "R$ ") + _br(abs(v), d)


def _dbr(iso):
    return "%s/%s/%s" % (iso[8:10], iso[5:7], iso[:4]) if iso and len(iso) >= 10 else "—"


# ------------------------------------------------------------------------------------------ calendario
def _agora_br():
    return datetime.now(timezone.utc) - timedelta(hours=3)          # Brasilia, sem horario de verao


def _hoje():
    return _agora_br().date()


def _d(iso):
    return date(int(iso[:4]), int(iso[5:7]), int(iso[8:10]))


def dia_util(d):
    return d.weekday() < 5 and d.isoformat() not in FERIADOS


def dias_uteis(de, ate):
    """Dias de pregao depois de `de` ate `ate` (inclusive). 0 se `ate` nao for depois de `de`."""
    if ate <= de:
        return 0
    dias = (ate - de).days
    if dias > 2000:
        return int(dias * 252 / 365.25)
    n, d = 0, de
    um = timedelta(days=1)
    while d < ate:
        d += um
        if d.weekday() < 5 and d.isoformat() not in FERIADOS:
            n += 1
    return n


def _pregao_anterior(d):
    d -= timedelta(days=1)
    while not dia_util(d):
        d -= timedelta(days=1)
    return d


def _anos(du):
    return max(du, 0.5) / 252.0


# ------------------------------------------------------------------------------------------ Black-Scholes
def _N(x):
    return 0.5 * math.erfc(-x / math.sqrt(2.0))


def _fi(x):
    return math.exp(-0.5 * x * x) / math.sqrt(2.0 * math.pi)


def bs_preco(tipo, S, K, T, r, v):
    """Preco Black-Scholes europeu, sem dividendos. tipo: 'C' ou 'P'."""
    if T <= 0 or v <= 0:
        return max(S - K, 0.0) if tipo == "C" else max(K - S, 0.0)
    rq = v * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * v * v) * T) / rq
    d2 = d1 - rq
    if tipo == "C":
        return S * _N(d1) - K * math.exp(-r * T) * _N(d2)
    return K * math.exp(-r * T) * _N(-d2) - S * _N(-d1)


def bs_gregas(tipo, S, K, T, r, v):
    """delta, gamma, theta (por dia util) e vega (por 1 ponto de volatilidade)."""
    rq = v * math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * v * v) * T) / rq
    d2 = d1 - rq
    desc = K * math.exp(-r * T)
    if tipo == "C":
        delta = _N(d1)
        theta = -S * _fi(d1) * v / (2 * math.sqrt(T)) - r * desc * _N(d2)
    else:
        delta = _N(d1) - 1.0
        theta = -S * _fi(d1) * v / (2 * math.sqrt(T)) + r * desc * _N(-d2)
    return dict(delta=delta, gamma=_fi(d1) / (S * rq), theta=theta / 252.0, vega=S * _fi(d1) * math.sqrt(T) / 100.0)


def bs_vi(tipo, preco, S, K, T, r):
    """Volatilidade implicita por bissecao entre 1% e 400%. None se o preco nao cabe no modelo (abaixo do valor
    intrinseco, velho, ou fora da faixa)."""
    if not preco or preco <= 0 or S <= 0 or K <= 0 or T <= 0:
        return None
    lo, hi = 0.01, 4.0
    if not (bs_preco(tipo, S, K, T, r, lo) + 1e-7 < preco < bs_preco(tipo, S, K, T, r, hi)):
        return None
    for _ in range(48):
        m = 0.5 * (lo + hi)
        if bs_preco(tipo, S, K, T, r, m) < preco:
            lo = m
        else:
            hi = m
    return 0.5 * (lo + hi)


def _abaixo(x, S, T, r, v):
    """P(preco no vencimento < x) no modelo lognormal (medida neutra ao risco)."""
    if x <= 0:
        return 0.0
    if x == float("inf"):
        return 1.0
    rq = v * math.sqrt(T)
    d2 = (math.log(S / x) + (r - 0.5 * v * v) * T) / rq
    return _N(-d2)


# ------------------------------------------------------------------------------------------ arquivos da B3
def _estado(**k):
    with _trava:
        _est.update(k)


def _arquivo_b3(nome, data, faixa=None):
    """Baixa um arquivo diario da B3 e devolve o texto. `faixa` = (inicio, fim) do progresso em %."""
    quem = "a B3 (arquivos do pregão)"
    j = _json_url("https://arquivos.b3.com.br/api/download/requestname?fileName=%s&date=%s" % (nome, data), 30, quem)
    token = (j or {}).get("token")
    if not token:
        raise ErroDados("a B3 não liberou o arquivo %s de %s" % (nome, _dbr(data)))

    def prog(lidos, total):
        if faixa:
            fr = min(1.0, lidos / float(total)) if total else min(0.95, lidos / 21e6)
            _estado(progresso=int(faixa[0] + (faixa[1] - faixa[0]) * fr))
    return _http("https://arquivos.b3.com.br/api/download/?token=" + token, 120, quem, prog).decode("latin-1")


def _tabela(texto):
    """(status do arquivo, {coluna: indice}, linhas de dados)"""
    linhas = texto.split("\n")
    status, i = "", 0
    while i < len(linhas) and i < 5 and not linhas[i].startswith("RptDt;"):
        if linhas[i].lower().startswith("status"):
            status = linhas[i].split(":", 1)[-1].strip().lower()
        i += 1
    if i >= len(linhas) or not linhas[i].startswith("RptDt;"):
        raise ErroDados("a B3 mandou um arquivo em formato inesperado")
    col = {n: k for k, n in enumerate(linhas[i].rstrip("\r").split(";"))}
    return status, col, linhas[i + 1:]


def _ler_cadastro(texto, data):
    """Series de opcao sobre acao ainda vivas -> ({ativo: [linhas]}, {ticker: linha})"""
    _, c, linhas = _tabela(texto)
    try:
        i_tk, i_as, i_cat, i_tp, i_es = c["TckrSymb"], c["Asst"], c["SctyCtgyNm"], c["OptnTp"], c["OptnStyle"]
        i_k, i_x, i_lt = c["ExrcPric"], c["XprtnDt"], c["AllcnRndLot"]
    except KeyError:
        raise ErroDados("a B3 mudou as colunas do cadastro de instrumentos")
    maior = max(i_tk, i_as, i_cat, i_tp, i_es, i_k, i_x, i_lt)
    ativos, por_tk = {}, {}
    for ln in linhas:
        if "OPTION ON EQUITIES" not in ln:
            continue
        p = ln.rstrip("\r").split(";")
        if len(p) <= maior or p[i_cat] != "OPTION ON EQUITIES":
            continue
        venc, k, tipo = p[i_x], _n(p[i_k]), p[i_tp][:1].upper()
        if not k or k <= 0 or venc < data or tipo not in ("C", "P") or not DATA_OK.match(venc):
            continue
        linha = [p[i_tk], tipo, "A" if p[i_es].upper().startswith("AMER") else "E", k, venc, int(_n(p[i_lt]) or LOTE),
                 None, None, 0, 0, None, None, None, None, None]
        ativos.setdefault(p[i_as], []).append(linha)
        por_tk[p[i_tk]] = linha
    return ativos, por_tk


def _ler_negocios(texto, ativos, por_tk):
    """Preenche ultimo, referencia, negocios, volume, minima e maxima; devolve o fechamento de cada ativo-objeto."""
    _, c, linhas = _tabela(texto)
    try:
        i_tk, i_ul, i_rf, i_ng, i_vl = c["TckrSymb"], c["LastPric"], c["RefPric"], c["TradQty"], c["NtlFinVol"]
        i_mn, i_mx, i_os = c["MinPric"], c["MaxPric"], c.get("OscnPctg")
    except KeyError:
        raise ErroDados("a B3 mudou as colunas do arquivo de negócios")
    maior = max(i_tk, i_ul, i_rf, i_ng, i_vl, i_mn, i_mx)
    fech = {}
    for ln in linhas:
        p = ln.rstrip("\r").split(";")
        if len(p) <= maior:
            continue
        tk = p[i_tk]
        o = por_tk.get(tk)
        if o is not None:
            o[UL], o[RF], o[NG], o[VL] = _n(p[i_ul]), _n(p[i_rf]), int(_n(p[i_ng]) or 0), _n(p[i_vl]) or 0
            o[MN], o[MX] = _n(p[i_mn]), _n(p[i_mx])
        elif tk in ativos:
            ult = _n(p[i_ul])
            if ult:
                fech[tk] = [ult, _n(p[i_mn]), _n(p[i_mx]), _n(p[i_os]) if i_os is not None and len(p) > i_os else None]
    return fech


def _ler_posicoes(texto, por_tk):
    _, c, linhas = _tabela(texto)
    try:
        i_tk, i_tt, i_cb, i_ds = c["TckrSymb"], c["TtlPos"], c["CvrdQty"], c["UcvrdQty"]
    except KeyError:
        raise ErroDados("a B3 mudou as colunas do arquivo de posições em aberto")
    maior = max(i_tk, i_tt, i_cb, i_ds)
    for ln in linhas:
        p = ln.rstrip("\r").split(";")
        if len(p) <= maior:
            continue
        o = por_tk.get(p[i_tk])
        if o is not None:
            o[OI], o[CB], o[DS] = _n(p[i_tt]), _n(p[i_cb]), _n(p[i_ds])


def _arq_cad(base, data):
    return os.path.join(_pasta(base), "cad_%s.json" % data)


def _ler_disco(base):
    """A grade mais nova ja guardada (ou None)."""
    try:
        nomes = sorted((n for n in os.listdir(_pasta(base)) if re.match(r"^cad_\d{4}-\d{2}-\d{2}\.json$", n)), reverse=True)
    except OSError:
        return None
    for n in nomes[:3]:
        j = _ler_json(os.path.join(_pasta(base), n))
        if isinstance(j, dict) and j.get("v") == 1 and isinstance(j.get("ativos"), dict) and j.get("data"):
            return j
    return None


def _limpar_antigos(base):
    try:
        nomes = sorted((n for n in os.listdir(_pasta(base)) if re.match(r"^cad_\d{4}-\d{2}-\d{2}\.json$", n)), reverse=True)
        for n in nomes[3:]:                                    # ficam os 3 pregoes mais novos
            os.remove(os.path.join(_pasta(base), n))
    except OSError:
        pass


def _por_tk(cad):
    return {o[TK]: o for linhas in cad["ativos"].values() for o in linhas}


def _baixar(base):
    """Linha de execucao propria: acha o ultimo pregao com arquivo final, baixa, enxuga e guarda."""
    global _cad, _ult_checagem
    with _trava:
        atual = _cad
    try:
        # posicoes em aberto que faltaram na ultima vez (a B3 as vezes demora a soltar esse arquivo)
        if atual and atual.get("semOI"):
            try:
                _estado(etapa="posições em aberto de %s" % _dbr(atual["data"]), progresso=5)
                _ler_posicoes(_arquivo_b3("DerivativesOpenPositionFile", atual["data"], (5, 30)), _por_tk(atual))
                atual["semOI"] = False
                _gravar_json(_arq_cad(base, atual["data"]), atual)
            except ErroDados:
                pass
        hoje, novo = _hoje(), None
        for i in range(8):
            d = hoje - timedelta(days=i)
            if not dia_util(d):
                continue
            ds = d.isoformat()
            if atual and ds <= atual["data"]:
                break                                           # o que esta na memoria ja e o mais novo
            _estado(etapa="procurando o pregão de %s" % _dbr(ds), progresso=2)
            try:
                t_neg = _arquivo_b3("TradeInformationConsolidatedFile", ds, (2, 18))
            except ErroHTTP as e:
                if e.codigo in (400, 404):
                    continue                                    # dia sem arquivo (ainda): tenta o anterior
                raise
            status = _tabela(t_neg)[0]
            if status.startswith("parc") or len(t_neg) < 300000:
                continue                                        # pregao em andamento: o arquivo ainda e parcial
            _estado(etapa="cadastro das séries de %s (arquivo grande)" % _dbr(ds), progresso=18)
            ativos, por_tk = _ler_cadastro(_arquivo_b3("InstrumentsConsolidatedFile", ds, (18, 80)), ds)
            if not ativos:
                raise ErroDados("o cadastro da B3 de %s veio sem opções" % _dbr(ds))
            fech = _ler_negocios(t_neg, ativos, por_tk)
            t_neg = None
            sem_oi = False
            _estado(etapa="posições em aberto de %s" % _dbr(ds), progresso=80)
            for tentativa in (0, 1):
                try:
                    _ler_posicoes(_arquivo_b3("DerivativesOpenPositionFile", ds, (80, 96)), por_tk)
                    sem_oi = False
                    break
                except ErroDados:
                    sem_oi = True
            _estado(etapa="guardando", progresso=97)
            for linhas in ativos.values():
                linhas.sort(key=lambda o: (o[VC], o[KK], o[TP]))
            novo = dict(v=1, data=ds, semOI=sem_oi, ativos=ativos, fech=fech)
            _gravar_json(_arq_cad(base, ds), novo)
            _limpar_antigos(base)
            break
        with _trava:
            if novo:
                _cad = novo
            _ult_checagem = time.time()
            tem = _cad
            for k in [k for k in _mem if k[0] in ("viatm", "oport")]:
                _mem.pop(k, None)
        if tem:
            _estado(estado="pronto", progresso=100, etapa="", data=tem["data"], erro=None)
        else:
            _estado(estado="erro", progresso=0, etapa="", erro="não achei arquivo de pregão da B3 nos últimos 7 dias")
    except Exception as e:                                       # rede, formato... nada derruba o robo
        msg = str(e) if isinstance(e, ErroDados) else "falha ao ler os arquivos da B3 (%s)" % type(e).__name__
        with _trava:
            _ult_checagem = time.time()
            tem = _cad
        if tem:
            _estado(estado="pronto", progresso=100, etapa="", data=tem["data"], erro="não consegui atualizar a grade: " + msg)
        else:
            _estado(estado="erro", progresso=0, etapa="", erro=msg)


def _precisa(cad):
    agora = time.time()
    if cad is None:
        return agora - _ult_checagem > 90                         # depois de um erro, espera um pouco
    if agora - _ult_checagem < 1800:
        return False
    if cad.get("semOI"):
        return True
    br = _agora_br()
    esperado = _pregao_anterior(br.date())
    if dia_util(br.date()) and br.hour * 60 + br.minute >= 18 * 60 + 30:
        esperado = br.date()                                     # depois do fechamento o arquivo final do dia pode sair
    return cad["data"] < esperado.isoformat()


def _garantir(base):
    """Devolve a grade na memoria (ou None) e, se for o caso, dispara o download em segundo plano. Nunca espera."""
    global _cad
    with _trava:
        cad, rodando = _cad, _est["estado"] == "baixando"
    if cad is None and not rodando:
        lido = _ler_disco(base)                                   # fora da trava: e leitura de disco
        if lido:
            with _trava:
                if _cad is None:
                    _cad = lido
                    _est.update(estado="pronto", progresso=100, etapa="", data=lido["data"], erro=None)
                cad = _cad
    disparar = False
    with _trava:
        if _est["estado"] != "baixando" and _precisa(cad):
            _est.update(estado="baixando", progresso=0, etapa="conectando na B3", erro=None)
            disparar = True
    if disparar:
        threading.Thread(target=_baixar, args=(base,), name="opcoes-b3", daemon=True).start()
    return cad


def estado_download():
    with _trava:
        return dict(_est)


# ------------------------------------------------------------------------------------------ reserva (opcoes.net.br)
def _reserva(ativo):
    """So a serie mensal mais proxima, no formato enxuto. (linhas, data dos precos, vencimento) ou None."""
    def buscar():
        j = _json_url("https://opcoes.net.br/listaopcoes/completa?idAcao=%s&listarVencimentos=true&cotacoes=true" % ativo,
                      25, "o opcoes.net.br")
        d = (j or {}).get("data") or {}
        venc = next((v.get("value") for v in d.get("vencimentos") or [] if v.get("selected")), None)
        brutas = d.get("cotacoesOpcoes") or []
        if not venc or not DATA_OK.match(venc) or not brutas:
            raise ErroDados("o opcoes.net.br não tem a grade deste ativo")
        ultima = max((str(x[11])[:10] for x in brutas if len(x) > 11 and x[11]), default=None)
        linhas = []
        for x in brutas:
            try:
                tk, tipo, k = str(x[0]).split("_")[0], str(x[2])[:1].upper(), float(x[5])
                fresco = str(x[11])[:10] == ultima
                ult = float(x[8]) if fresco and x[8] else None
                neg = int(x[9] or 0) if fresco else 0
                vol = float(x[10] or 0) if fresco else 0
            except (TypeError, ValueError, IndexError):
                continue
            if tipo in ("C", "P") and k > 0 and SERIE_OK.match(tk):
                linhas.append([tk, tipo, "A" if str(x[3]).upper().startswith("A") else "E", k, venc, LOTE,
                               ult, None, neg, vol, None, None, None, None, None])
        if not linhas:
            raise ErroDados("o opcoes.net.br não tem a grade deste ativo")
        linhas.sort(key=lambda o: (o[KK], o[TP]))
        return linhas, ultima or _hoje().isoformat(), venc
    return _memo(("reserva", ativo), VIDA_RESERVA, buscar, VIDA_RESERVA)        # no maximo 1 pedido por ativo a cada 5 min


def _series(base, ativo):
    """dict(linhas, data, fonte, fech, avisos) com as series do ativo; linhas vazias se nao houver."""
    cad = _garantir(base)
    est = estado_download()
    if cad is not None:
        linhas = cad["ativos"].get(ativo) or []
        avisos = []
        if not linhas:
            avisos.append("%s não tem opções listadas no arquivo da B3 de %s." % (ativo, _dbr(cad["data"])))
        if cad.get("semOI"):
            avisos.append("A B3 ainda não liberou as posições em aberto de %s; a coluna fica vazia por enquanto." % _dbr(cad["data"]))
        if est.get("erro"):
            avisos.append("Grade de %s: %s." % (_dbr(cad["data"]), est["erro"]))
        return dict(linhas=linhas, data=cad["data"], fonte="B3", fech=(cad.get("fech") or {}).get(ativo), avisos=avisos)
    if est["estado"] == "erro":
        r = _reserva(ativo)
        if r:
            return dict(linhas=r[0], data=r[1], fonte="opcoes.net.br", fech=None, avisos=[
                "Os arquivos da B3 falharam (%s). Mostrando só o vencimento mensal mais próximo, pelo opcoes.net.br, "
                "sem posições em aberto nem preço de referência." % est.get("erro")])
        return dict(linhas=[], data=None, fonte=None, fech=None,
                    avisos=["Sem grade de opções: %s. O robô tenta de novo sozinho em instantes." % (est.get("erro") or "sem dados")])
    return dict(linhas=[], data=None, fonte=None, fech=None, avisos=[])


# ------------------------------------------------------------------------------------------ cotacao, juros, historico
def _cotacao(tk):
    """Cotacao do dia (~15 min de atraso). dict ou None quando a B3 nao tem cotacao para o papel."""
    def buscar():
        j = _json_url("https://cotacao.b3.com.br/mds/api/v1/instrumentQuotation/" + tk, 7, "a B3 (cotação)")
        try:
            q = j["Trad"][0]["scty"]["SctyQtn"]
            preco = float(q.get("curPrc") or 0)
        except (KeyError, IndexError, TypeError, ValueError):
            return False                                          # "Quotation not available"
        if preco <= 0:
            return False
        f = lambda k: (float(q[k]) if q.get(k) not in (None, "") else None)
        return dict(preco=preco, abertura=f("opngPric"), min=f("minPric"), max=f("maxPric"), medio=f("avrgPric"),
                    var=f("prcFlcn"), hora=str((j.get("Msg") or {}).get("dtTm") or ""))
    return _memo(("q", tk), VIDA_COTACAO, buscar, 30.0) or None


def _cotacoes(tks, espera=9.0):
    """Varias cotacoes ao mesmo tempo (6 por vez), sem passar de `espera` segundos no total."""
    tks = list(dict.fromkeys(tks))
    if not tks:
        return {}
    fut = {tk: _fila.submit(_cotacao, tk) for tk in tks}
    wait(list(fut.values()), timeout=espera)
    saida = {}
    for tk, f in fut.items():
        if f.done() and not f.cancelled():
            try:
                saida[tk] = f.result()
            except Exception:
                saida[tk] = None
    return saida


def _cdi(base):
    """dict(valor % a.a., data, reserva)"""
    arq = os.path.join(_pasta(base), "cdi.json")

    def buscar():
        j = _json_url("https://api.bcb.gov.br/dados/serie/bcdata.sgs.4389/dados/ultimos/1?formato=json", 10, "o Banco Central")
        v = float(str(j[-1]["valor"]).replace(",", "."))
        if not 0 < v < 100:
            raise ErroDados("CDI fora da faixa")
        o = dict(valor=v, data=str(j[-1].get("data") or ""), reserva=False)
        _gravar_json(arq, o)
        return o
    o = _memo(("cdi",), VIDA_CDI, buscar, 600.0)
    if o:
        return o
    g = _ler_json(arq)
    if isinstance(g, dict) and isinstance(g.get("valor"), (int, float)) and 0 < g["valor"] < 100:
        return dict(valor=g["valor"], data=g.get("data") or "", reserva=True)
    return dict(valor=CDI_RESERVA, data="", reserva=True)


def _historico(ativo):
    """Fechamentos diarios de ~1 ano (Yahoo). dict(fech=[...], preco, t) ou None."""
    def buscar():
        j = _json_url("https://query1.finance.yahoo.com/v8/finance/chart/%s.SA?interval=1d&range=1y" % ativo, 12, "o Yahoo")
        try:
            r = j["chart"]["result"][0]
            fech = [float(x) for x in r["indicators"]["quote"][0]["close"] if x]
            meta = r.get("meta") or {}
        except (KeyError, IndexError, TypeError):
            raise ErroDados("o Yahoo não tem o histórico deste ativo")
        if len(fech) < 5:
            raise ErroDados("histórico curto demais")
        return dict(fech=fech, preco=meta.get("regularMarketPrice"), t=meta.get("regularMarketTime"),
                    ant=meta.get("chartPreviousClose"))
    return _memo(("hist", ativo), VIDA_HIST, buscar, 120.0)


def _vol_hist(fech, n):
    """Volatilidade historica anualizada dos ultimos n retornos diarios."""
    if not fech or len(fech) < n + 1:
        return None
    rets = [math.log(fech[i] / fech[i - 1]) for i in range(len(fech) - n, len(fech)) if fech[i] > 0 and fech[i - 1] > 0]
    if len(rets) < 2:
        return None
    m = sum(rets) / len(rets)
    return math.sqrt(sum((x - m) ** 2 for x in rets) / (len(rets) - 1)) * math.sqrt(252.0)


def _media(fech, n):
    return sum(fech[-n:]) / n if fech and len(fech) >= n else None


def _percentil_hv(fech):
    """Onde a HV de 21 pregoes de hoje esta entre as do ultimo ano (0 a 100)."""
    if not fech or len(fech) < 60:
        return None
    serie = [v for v in (_vol_hist(fech[:i], 21) for i in range(22, len(fech) + 1)) if v is not None]
    if len(serie) < 20:
        return None
    return 100.0 * sum(1 for v in serie if v <= serie[-1]) / len(serie)


def _tendencia(preco, mm20, mm50, mm200):
    if preco is None or mm20 is None or mm50 is None:
        return dict(cod="sem", txt="sem histórico suficiente para ler a tendência")
    longo = "" if mm200 is None else (" e acima da média de 200" if preco > mm200 else " e abaixo da média de 200")
    if preco > mm20 > mm50:
        return dict(cod="alta", txt="alta: preço acima da média de 20, que está acima da de 50" + longo)
    if preco < mm20 < mm50:
        return dict(cod="baixa", txt="baixa: preço abaixo da média de 20, que está abaixo da de 50" + longo)
    return dict(cod="lateral", txt="sem tendência definida: preço e médias de 20 e 50 estão embaralhados" + longo)


def _contexto(base, ativo, fech_arq=None):
    """Tudo do ativo-objeto e dos juros (cada parte com a sua memoria; as buscas correm em paralelo)."""
    fq, fh, fc = _fila.submit(_cotacao, ativo), _fila.submit(_historico, ativo), _fila.submit(_cdi, base)
    wait([fq, fh, fc], timeout=14)

    def pegar(f, padrao=None):
        try:
            return f.result(timeout=0) if f.done() else padrao
        except Exception:
            return padrao
    q, h, cdi = pegar(fq), pegar(fh), pegar(fc) or dict(valor=CDI_RESERVA, data="", reserva=True)
    fech = (h or {}).get("fech") or []
    avisos = []
    if q:
        preco, var, hora, fonte = q["preco"], q.get("var"), q.get("hora"), "B3, cerca de 15 min de atraso"
    elif h and h.get("preco"):
        preco, hora, fonte = float(h["preco"]), "", "Yahoo (a cotação da B3 não respondeu)"
        var = 100.0 * (preco / fech[-2] - 1) if len(fech) >= 2 and fech[-2] else None
        try:
            hora = (datetime.fromtimestamp(h["t"], timezone.utc) - timedelta(hours=3)).strftime("%Y-%m-%d %H:%M:%S")
        except (TypeError, ValueError, OSError):
            pass
    elif fech_arq:
        preco, var, hora, fonte = fech_arq[0], fech_arq[3] if len(fech_arq) > 3 else None, "", "fechamento do último pregão (sem cotação do dia)"
        avisos.append("Sem cotação do dia para %s: usando o fechamento do último pregão." % ativo)
    else:
        preco, var, hora, fonte = None, None, "", None
        avisos.append("Não consegui o preço de %s (sem internet, ou o código não existe)." % ativo)
    if not h:
        avisos.append("Sem histórico diário de %s agora: volatilidade histórica e médias ficam em branco." % ativo)
    if cdi.get("reserva"):
        avisos.append("O Banco Central não respondeu: usando CDI de %s%% a.a. (%s)." % (
            _br(cdi["valor"]), "último valor guardado" if cdi.get("data") else "valor fixo de reserva"))
    mm20, mm50, mm200 = _media(fech, 20), _media(fech, 50), _media(fech, 200)
    return dict(preco=preco, var=var, hora=hora, fonte=fonte, q=q, fech=fech, mm20=mm20, mm50=mm50, mm200=mm200,
                hv21=_vol_hist(fech, 21), hv63=_vol_hist(fech, 63), hvPct=_percentil_hv(fech),
                tendencia=_tendencia(preco, mm20, mm50, mm200), cdi=cdi, r=math.log(1.0 + cdi["valor"] / 100.0), avisos=avisos)


# ------------------------------------------------------------------------------------------ vencimentos e VI de referencia
def _vencimentos(linhas, ref):
    """[dict(data, du, semanal, series, negocios)] a partir de `ref` (data), em ordem."""
    por = {}
    for o in linhas:
        v = por.setdefault(o[VC], [0, 0, 0])
        v[0] += 1
        v[1] += o[NG] or 0
        v[2] += 1 if re.search(r"W\d$", o[TK]) else 0
    saida = []
    for venc in sorted(por):
        dv = _d(venc)
        if dv < ref:
            continue
        n, neg, sem = por[venc]
        saida.append(dict(data=venc, du=dias_uteis(ref, dv), semanal=sem * 2 > n, series=n, negocios=neg))
    return saida


def _venc_padrao(vencs):
    """O mensal com 20 a 45 dias uteis e mais negocios; senao o primeiro com 5 dias ou mais; senao o primeiro."""
    bons = [v for v in vencs if not v["semanal"] and 20 <= v["du"] <= 45]
    if bons:
        return max(bons, key=lambda v: v["negocios"])["data"]
    for filtro in (lambda v: not v["semanal"] and v["du"] >= 5, lambda v: v["du"] >= 5, lambda v: True):
        resto = [v for v in vencs if filtro(v)]
        if resto:
            return resto[0]["data"]
    return None


def _vi_atm_fech(base, ativo, ser, r):
    """VI no dinheiro com os precos do FECHAMENTO do arquivo (uma por pregao; alimenta o ranking de VI).
    Devolve dict(vi, venc, du) ou None."""
    if ser["fonte"] != "B3" or not ser["fech"] or not ser["linhas"]:
        return None

    def calc():
        S, ref = ser["fech"][0], _d(ser["data"])
        cand = [v for v in _vencimentos(ser["linhas"], ref) if 8 <= v["du"] <= 60 and v["negocios"] > 0]
        if not cand:
            return False
        v = max(cand, key=lambda x: x["negocios"])
        T, vis = _anos(v["du"]), []
        for tipo in ("C", "P"):
            ops = [o for o in ser["linhas"] if o[VC] == v["data"] and o[TP] == tipo and o[NG] > 0 and o[UL]]
            ops.sort(key=lambda o: abs(o[KK] / S - 1))
            for o in ops[:4]:
                if abs(o[KK] / S - 1) > 0.06:
                    break
                vi = bs_vi(tipo, o[UL], S, o[KK], T, r)
                if vi:
                    vis.append(vi)
                    break
        if not vis:
            return False
        vi = sum(vis) / len(vis)
        arq = os.path.join(_pasta(base), "iv_%s.json" % ativo)
        with _trava_iv:
            hist = _ler_json(arq, {})
            if not isinstance(hist, dict):
                hist = {}
            if ser["data"] not in hist:
                hist[ser["data"]] = round(vi, 4)
                _gravar_json(arq, hist)
        return dict(vi=vi, venc=v["data"], du=v["du"])
    return _memo(("viatm", ativo, ser["data"]), 6 * 3600.0, calc, 300.0) or None


_trava_iv = threading.Lock()                # gravacao dos arquivos pequenos de VI (um por ativo)


def _rank_vi(base, ativo, vi_atual, hv_pct):
    """Ranking de VI com as fotos diarias; antes de MIN_SNAP fotos, mostra o percentil da volatilidade historica."""
    hist = _ler_json(os.path.join(_pasta(base), "iv_%s.json" % ativo), {})
    vals = [v for _, v in sorted(hist.items())[-252:] if isinstance(v, (int, float))] if isinstance(hist, dict) else []
    n = len(vals)
    if n >= MIN_SNAP and vi_atual is not None and max(vals) > min(vals):
        rank = 100.0 * (vi_atual - min(vals)) / (max(vals) - min(vals))
        return dict(modo="vi", rank=_a(max(0.0, min(100.0, rank)), 0), n=n, minimo=MIN_SNAP,
                    txt="Ranking de VI com %d pregões guardados: 0 é a menor VI do período e 100 a maior." % n)
    return dict(modo="hv", rank=_a(hv_pct, 0), n=n, minimo=MIN_SNAP,
                txt="Ainda há %d de %d fotos diárias de VI deste ativo (o robô guarda uma por pregão). Até lá, o número "
                    "mostrado é o percentil da volatilidade HISTÓRICA de 21 pregões no último ano, que não é a mesma coisa." % (n, MIN_SNAP))


# ------------------------------------------------------------------------------------------ montagem da grade
def _validar_ativo(ativo):
    ativo = str(ativo or "").strip().upper()
    if not ATIVO_OK.match(ativo):
        raise ValueError("código de ativo inválido (use 4 letras e 1 ou 2 números, como PETR4)")
    return ativo


def _lado(o, q, S, S_arq, T, T_arq, r):
    """Uma serie com preco, VI e gregas. O preco e a VI usam um par coerente (cotacao do dia com o ativo de agora;
    preco do arquivo com o fechamento do ativo naquele pregao); as gregas sao sempre para o ativo de agora."""
    tipo, K = o[TP], o[KK]
    if q and q.get("preco"):
        preco, fonte, Sx, Tx = q["preco"], "agora", S, T
    elif o[UL] and o[NG]:
        preco, fonte, Sx, Tx = o[UL], "fech", S_arq, T_arq
    elif o[RF]:
        preco, fonte, Sx, Tx = o[RF], "ref", S_arq, T_arq
    else:
        preco, fonte, Sx, Tx = None, None, S_arq, T_arq
    vi = bs_vi(tipo, preco, Sx, K, Tx, r) if preco else None
    g = bs_gregas(tipo, S, K, T, r, vi) if vi else {}
    intr = (max(Sx - K, 0.0) if tipo == "C" else max(K - Sx, 0.0)) if preco else None
    dist = 100.0 * (K / S - 1)
    if abs(dist) <= 1.0:
        mon = "ATM"
    elif (tipo == "C") == (K < S):
        mon = "ITM"
    else:
        mon = "OTM"
    return dict(tk=o[TK], tipo="call" if tipo == "C" else "put", estilo="americana" if o[ES] == "A" else "europeia",
                k=K, preco=_a(preco), fonte=fonte, ult=_a(o[UL]), ref=_a(o[RF]), neg=o[NG] or 0, vol=_a(o[VL], 0),
                oi=_a(o[OI], 0), coberto=_a(o[CB], 0), descoberto=_a(o[DS], 0), min=_a(o[MN]), max=_a(o[MX]),
                mon=mon, dist=_a(dist, 1), vi=_a(vi, 4), delta=_a(g.get("delta"), 3), gamma=_a(g.get("gamma"), 4),
                theta=_a(g.get("theta"), 4), vega=_a(g.get("vega"), 4), intr=_a(intr),
                tempo=_a(max(preco - intr, 0.0)) if preco else None, liq=bool(fonte == "agora" or (o[NG] or 0) >= MIN_NEG),
                semNeg=not (o[NG] or 0) and fonte != "agora", hora=(q or {}).get("hora") if fonte == "agora" else None)


def _montar(base, ativo, venc, cotar=True):
    """Contexto + series do vencimento, ja com VI e gregas. Devolve um dict interno (ver `grade`)."""
    ser = _series(base, ativo)
    ctx = _contexto(base, ativo, ser["fech"])
    avisos = list(ser["avisos"]) + list(ctx["avisos"])
    hoje = _hoje()
    vencs = _vencimentos(ser["linhas"], hoje) if ser["linhas"] else []
    if venc and not DATA_OK.match(str(venc)):
        raise ValueError("vencimento inválido")
    if not venc or venc not in [v["data"] for v in vencs]:
        venc = _venc_padrao(vencs)
    m = dict(ativo=ativo, venc=venc, ser=ser, ctx=ctx, avisos=avisos, vencs=vencs, lados=[], S=ctx["preco"], du=None, T=None,
             r=ctx["r"], viAtm=None)
    S = ctx["preco"]
    if not venc or not S:
        return m
    S_arq = ser["fech"][0] if ser["fech"] else S
    du = dias_uteis(hoje, _d(venc))
    T = _anos(du)
    T_arq = _anos(dias_uteis(_d(ser["data"]), _d(venc))) if ser["data"] else T
    m.update(du=du, T=T, S_arq=S_arq)
    # uma serie por (tipo, strike): a de mais negocios (ha calls americanas e europeias no mesmo strike)
    melhor = {}
    for o in ser["linhas"]:
        if o[VC] != venc:
            continue
        ch = (o[TP], round(o[KK], 2))
        a = melhor.get(ch)
        if a is None or (o[NG] or 0, o[OI] or 0, o[RF] or 0) > (a[NG] or 0, a[OI] or 0, a[RF] or 0):
            melhor[ch] = o
    vol = ctx["hv21"] or 0.35
    limite = max(0.08, min(0.35, 3.0 * vol * math.sqrt(T)))
    perto = [o for o in melhor.values() if abs(o[KK] / S - 1) <= limite and ((o[NG] or 0) > 0 or (o[OI] or 0) > 0)]
    if len({round(o[KK], 2) for o in perto}) < 9:
        ks = sorted({round(o[KK], 2) for o in melhor.values()}, key=lambda k: abs(k / S - 1))[:15]
        perto = [o for o in melhor.values() if round(o[KK], 2) in ks]
    cot = {}
    if cotar and ser["fonte"] == "B3":
        alvo = sorted((o for o in perto if abs(o[KK] / S - 1) <= 0.10 and (o[NG] or 0) > 0), key=lambda o: -(o[NG] or 0))[:30]
        cot = _cotacoes([o[TK] for o in alvo])
    lados = [_lado(o, cot.get(o[TK]), S, S_arq, T, T_arq, ctx["r"]) for o in perto]
    lados.sort(key=lambda x: (x["k"], x["tipo"]))
    m["lados"] = lados
    # VI no dinheiro deste vencimento: media da call e da put mais proximas do preco, de preferencia com negocio
    vis = []
    for tipo in ("call", "put"):
        c = sorted((x for x in lados if x["tipo"] == tipo and x["vi"]), key=lambda x: (x["fonte"] == "ref", abs(x["dist"])))
        c = [x for x in c if abs(x["dist"]) <= 6]
        if c:
            vis.append(c[0]["vi"])
    m["viAtm"] = sum(vis) / len(vis) if vis else None
    if ser["fonte"] == "B3" and not cot and cotar and lados:
        avisos.append("Sem cotação do dia para as opções agora: os prêmios são os do fechamento de %s." % _dbr(ser["data"]))
    return m


# ------------------------------------------------------------------------------------------ API: painel e grade
def painel(base, ativo):
    """Cabecalho da aba: ativo-objeto, juros, vencimentos e o estado do download da grade."""
    ativo = _validar_ativo(ativo)
    ser = _series(base, ativo)
    ctx = _contexto(base, ativo, ser["fech"])
    vencs = _vencimentos(ser["linhas"], _hoje()) if ser["linhas"] else []
    ref = _vi_atm_fech(base, ativo, ser, ctx["r"])
    vi_atm = ref["vi"] if ref else None
    rk = _rank_vi(base, ativo, vi_atm, ctx["hvPct"])
    est = estado_download()
    avisos = list(ser["avisos"]) + list(ctx["avisos"])
    if est["estado"] == "baixando" and not ser["linhas"]:
        avisos.append("Baixando a grade oficial da B3 (uma vez por pregão; leva de 10 a 60 segundos).")
    return dict(
        ativo=ativo, ativos=list(ATIVOS_PADRAO),
        base=dict(preco=_a(ctx["preco"]), var=_a(ctx["var"]), hora=ctx["hora"], fonte=ctx["fonte"],
                  abertura=_a((ctx["q"] or {}).get("abertura")), min=_a((ctx["q"] or {}).get("min")), max=_a((ctx["q"] or {}).get("max")),
                  fechArquivo=_a(ser["fech"][0]) if ser["fech"] else None,
                  mm20=_a(ctx["mm20"]), mm50=_a(ctx["mm50"]), mm200=_a(ctx["mm200"]), tendencia=ctx["tendencia"],
                  hv21=_a(ctx["hv21"], 4), hv63=_a(ctx["hv63"], 4), hvPct=_a(ctx["hvPct"], 0), pregoes=len(ctx["fech"])),
        cdi=dict(valor=ctx["cdi"]["valor"], data=ctx["cdi"].get("data") or "", reserva=bool(ctx["cdi"].get("reserva"))),
        vi=dict(atm=_a(vi_atm, 4), venc=ref["venc"] if ref else None, du=ref["du"] if ref else None, **rk),
        dataGrade=ser["data"], fonteGrade=ser["fonte"], vencs=vencs, vencPadrao=_venc_padrao(vencs),
        download=dict(estado=est["estado"], progresso=est["progresso"], etapa=est["etapa"], erro=est["erro"]),
        avisos=avisos, agora=int(time.time()))


def grade(base, ativo, venc=None):
    """Grade do vencimento: uma linha por strike, call de um lado e put do outro."""
    ativo = _validar_ativo(ativo)
    m = _montar(base, ativo, venc)
    S = m["S"]
    por_k = {}
    for x in m["lados"]:
        por_k.setdefault(round(x["k"], 2), {})[x["tipo"]] = x
    ks = sorted(por_k)
    if len(ks) > 45 and S:
        ks = sorted(sorted(ks, key=lambda k: abs(k / S - 1))[:45])
    atm = min(ks, key=lambda k: abs(k - S)) if ks and S else None
    linhas = [dict(k=k, dist=_a(100.0 * (k / S - 1), 1), atm=k == atm, call=por_k[k].get("call"), put=por_k[k].get("put")) for k in ks]
    tem_amer = any(x["estilo"] == "americana" for x in m["lados"])
    return dict(ativo=ativo, venc=m["venc"], du=m["du"], anos=_a(m["T"], 4), spot=_a(S), spotFonte=m["ctx"]["fonte"],
                spotHora=m["ctx"]["hora"], dataGrade=m["ser"]["data"], fonteGrade=m["ser"]["fonte"],
                juros=_a(100.0 * (math.exp(m["r"]) - 1), 2), viAtm=_a(m["viAtm"], 4), hv21=_a(m["ctx"]["hv21"], 4),
                atmK=atm, linhas=linhas, lote=LOTE, temAmericana=tem_amer,
                agora=sum(1 for x in m["lados"] if x["fonte"] == "agora"),
                avisos=m["avisos"], download=estado_download())


# ------------------------------------------------------------------------------------------ avaliacao de estruturas
def _pl_venc(pernas, x):
    """Resultado no vencimento (R$) com o ativo em x, antes dos custos."""
    t = 0.0
    for p in pernas:
        n = p["lado"] * p["qtd"] * LOTE
        if p["tipo"] == "acao":
            t += n * (x - p["preco"])
        elif p["tipo"] == "call":
            t += n * (max(x - p["k"], 0.0) - p["preco"])
        else:
            t += n * (max(p["k"] - x, 0.0) - p["preco"])
    return t


def _pl_hoje(pernas, x, r, T, sigma):
    """Resultado HOJE (R$) se o ativo fosse para x agora: opcoes pelo modelo, cada uma com a sua VI."""
    t = 0.0
    for p in pernas:
        n = p["lado"] * p["qtd"] * LOTE
        if p["tipo"] == "acao":
            t += n * (x - p["preco"])
        else:
            t += n * (bs_preco("C" if p["tipo"] == "call" else "P", max(x, 0.01), p["k"], T, r, p.get("vi") or sigma) - p["preco"])
    return t


def _avaliar(pernas, S, r, T, sigma):
    """Metricas comuns a qualquer conjunto de pernas. Valores em R$ para as quantidades dadas (1 = 1 lote de 100)."""
    ops = [p for p in pernas if p["tipo"] != "acao"]
    custos = sum(TAXA_B3 * p["preco"] * p["qtd"] * LOTE for p in ops)
    liquido = sum(-p["lado"] * p["preco"] * p["qtd"] * LOTE for p in ops)        # + recebe, - paga
    quinas = sorted({p["k"] for p in ops})
    pts = [0.0] + quinas
    vals = [_pl_venc(pernas, x) - custos for x in pts]
    incl = sum(p["lado"] * p["qtd"] * LOTE for p in pernas if p["tipo"] in ("acao", "call"))     # depois do ultimo strike
    ganho = None if incl > 1e-9 else max(vals)
    perda = None if incl < -1e-9 else -min(vals)
    empates = []
    for i in range(1, len(pts)):
        a, b = vals[i - 1], vals[i]
        if (a < 0 < b) or (a > 0 > b):
            empates.append(pts[i - 1] + (pts[i] - pts[i - 1]) * (0 - a) / (b - a))
        elif b == 0 and a != 0:
            empates.append(pts[i])
    if abs(incl) > 1e-9:
        x = pts[-1] - vals[-1] / incl
        if x > pts[-1] + 1e-9:
            empates.append(x)
    empates = sorted(set(round(e, 4) for e in empates))
    # chance aproximada de terminar no lucro: soma das faixas de preco em que o resultado e positivo
    prob, v = None, sigma
    if v and v > 0 and S and S > 0:
        bordas = [0.0] + empates + [float("inf")]
        prob = 0.0
        for i in range(1, len(bordas)):
            a, b = bordas[i - 1], bordas[i]
            meio = (a + b) / 2 if b != float("inf") else max(a * 1.5, a + S, S * 3)
            if _pl_venc(pernas, meio) - custos > 0:
                prob += _abaixo(b, S, T, r, v) - _abaixo(a, S, T, r, v)
    lo = 0.8 * min([S] + quinas)
    hi = 1.2 * max([S] + quinas)
    xs = sorted(set([round(lo + (hi - lo) * i / 48.0, 4) for i in range(49)] + [k for k in quinas if lo <= k <= hi] + [round(S, 4)]))
    venc = [[_a(x, 2), _a(_pl_venc(pernas, x) - custos, 2)] for x in xs]
    hoje = [[_a(x, 2), _a(_pl_hoje(pernas, x, r, T, sigma or 0.35) - custos, 2)] for x in xs]
    gr = dict(delta=0.0, gamma=0.0, theta=0.0, vega=0.0)
    for p in pernas:
        n = p["lado"] * p["qtd"] * LOTE
        if p["tipo"] == "acao":
            gr["delta"] += n
        else:
            g = bs_gregas("C" if p["tipo"] == "call" else "P", S, p["k"], T, r, p.get("vi") or sigma or 0.35)
            for k in gr:
                gr[k] += n * g[k]
    return dict(liquido=_a(liquido), custos=_a(custos), ganhoMax=_a(ganho), perdaMax=_a(perda), empates=[_a(e) for e in empates],
                prob=_a(100.0 * prob, 0) if prob is not None else None,
                payoff=dict(venc=venc, hoje=hoje, spot=_a(S), strikes=[_a(k) for k in quinas]),
                gregas=dict(delta=_a(gr["delta"], 1), gamma=_a(gr["gamma"], 2), theta=_a(gr["theta"], 2), vega=_a(gr["vega"], 2)))


def _perna(lado, x, qtd=1):
    return dict(lado=lado, tipo=x["tipo"], tk=x["tk"], k=x["k"], preco=x["preco"], qtd=qtd, vi=x["vi"], fonte=x["fonte"],
                delta=x["delta"], neg=x["neg"], estilo=x["estilo"], liq=x["liq"])


def _perna_acao(ativo, S, lado=1, qtd=1):
    return dict(lado=lado, tipo="acao", tk=ativo, k=None, preco=round(S, 2), qtd=qtd, vi=None, fonte="agora", delta=1.0,
                neg=None, estilo=None, liq=True)


def _pernas_tela(pernas):
    nomes = {(1, "acao"): "tem", (-1, "acao"): "vende"}
    return [dict(lado=nomes.get((p["lado"], p["tipo"]), "compra" if p["lado"] > 0 else "venda"), tipo=p["tipo"], tk=p["tk"],
                 k=_a(p["k"]), preco=_a(p["preco"]), qtd=p["qtd"], fonte=p.get("fonte"), vi=_a(p.get("vi"), 4),
                 delta=_a(p.get("delta"), 3), neg=p.get("neg"), estilo=p.get("estilo")) for p in pernas]


def _por_delta(lados, tipo, alvo, faixa, cond=None):
    """A serie com |delta| mais perto do alvo: primeiro as com liquidez dentro da faixa; depois qualquer uma dentro da
    faixa; por fim a com liquidez mais proxima (entre 0,10 e 0,45)."""
    c = [x for x in lados if x["tipo"] == tipo and x["delta"] is not None and x["preco"] and (cond is None or cond(x))]
    perto = lambda x: abs(abs(x["delta"]) - alvo)
    for grupo in ([x for x in c if x["liq"]], c):
        dentro = [x for x in grupo if faixa[0] <= abs(x["delta"]) <= faixa[1]]
        if dentro:
            return min(dentro, key=perto)
    resto = [x for x in c if x["liq"] and 0.10 <= abs(x["delta"]) <= 0.45]
    return min(resto, key=perto) if resto else None


def _no_dinheiro(lados, tipo):
    c = [x for x in lados if x["tipo"] == tipo and x["preco"] and x["vi"]]
    liq = [x for x in c if x["liq"]]
    c = [x for x in (liq or c) if abs(x["dist"]) <= 5]
    return min(c, key=lambda x: abs(x["dist"])) if c else None


def _ck(ok, txt):
    return dict(ok=bool(ok), txt=txt)


def _ck_prazo(du, lo=20, hi=45):
    return _ck(lo <= du <= hi, "Vencimento em %d dias úteis (regra: de %d a %d)" % (du, lo, hi))


def _ck_delta(x, nome):
    return _ck(0.20 <= abs(x["delta"]) <= 0.30, "Delta da %s %s: %s (regra: entre 0,20 e 0,30 em módulo)" % (nome, x["tk"], _br(x["delta"])))


def _ck_liq(pernas):
    ruins = [p["tk"] for p in pernas if p["tipo"] != "acao" and not p["liq"]]
    return _ck(not ruins, "Todas as séries tiveram pelo menos %d negócios no último pregão" % MIN_NEG if not ruins else
               "Pouca ou nenhuma liquidez em %s (menos de %d negócios): o preço mostrado pode não ser executável" % (", ".join(ruins), MIN_NEG))


def _ck_vi(m):
    vi, hv = m["viAtm"], m["ctx"]["hv21"]
    if not vi or not hv:
        return _ck(False, "Não deu para comparar a volatilidade implícita com a histórica agora")
    return _ck(vi >= hv, "VI no dinheiro %s%% contra volatilidade histórica de 21 pregões %s%% (regra para quem vende: VI maior ou igual)" % (
        _br(100 * vi, 1), _br(100 * hv, 1)))


def _fechar(est, m, pernas, capital, capital_txt, checks):
    """Junta as metricas, o retorno sobre o capital e a conferencia das regras."""
    a = _avaliar(pernas, m["S"], m["r"], m["T"], m["viAtm"] or m["ctx"]["hv21"] or 0.35)
    du = max(m["du"], 1)
    ret = 100.0 * a["ganhoMax"] / capital if a["ganhoMax"] is not None and capital else None
    velhas = sorted({p["fonte"] for p in pernas if p["tipo"] != "acao" and p["fonte"] != "agora"})
    avisos = []
    if "fech" in velhas:
        avisos.append("Prêmio do fechamento de %s (sem cotação do dia nesta série): o preço de agora pode ser outro." % _dbr(m["ser"]["data"]))
    if "ref" in velhas:
        avisos.append("Há série sem negócio no último pregão: foi usado o preço de referência da B3, que é teórico.")
    if any(p.get("estilo") == "americana" and p["lado"] < 0 for p in pernas):
        avisos.append("A call vendida é americana: você pode ser exercido antes do vencimento (mais comum perto de data de dividendo).")
    ok = all(c["ok"] for c in checks)
    est.update(a)
    est.update(disponivel=True, pernas=_pernas_tela(pernas), capital=_a(capital), capitalTxt=capital_txt,
               retorno=_a(ret, 2), retornoAno=_a(ret * 252.0 / du, 1) if ret is not None and a["liquido"] > 0 else None, du=m["du"], avisos=avisos,
               entra_agora=dict(ok=ok, motivos=checks, nota="Conferência das regras da própria estrutura com os dados de agora. "
                                "Não é recomendação: regra atendida não garante lucro."))
    return est


def _indisp(est, motivo):
    est.update(disponivel=False, motivo=motivo, entra_agora=dict(ok=False, motivos=[_ck(False, motivo)], nota=""))
    return est


def _e_coberto(m):
    S, du, ctx = m["S"], m["du"], m["ctx"]
    est = dict(id="coberto", nome="Lançamento coberto", visao="neutra a levemente de alta",
               resumo="Você já tem 100 ações e vende uma call acima do preço. Recebe o prêmio agora; em troca, abre mão da alta acima do strike.")
    c = _por_delta(m["lados"], "call", 0.25, (0.20, 0.30), lambda x: x["k"] > S)
    if not c:
        return _indisp(est, "Não achei call fora do dinheiro com delta perto de 0,25 e preço válido neste vencimento.")
    pernas = [_perna_acao(m["ativo"], S), _perna(-1, c)]
    premio = c["preco"] * LOTE
    checks = [_ck_prazo(du), _ck_delta(c, "call"), _ck_liq(pernas), _ck_vi(m),
              _ck(ctx["tendencia"]["cod"] != "baixa", "Tendência do ativo: %s (regra: não vender call coberta com o ativo em baixa, porque a queda da ação é o risco de verdade)" % ctx["tendencia"]["cod"])]
    est.update(
        quandoPerde="Perde quando a ação cai mais que o prêmio recebido (abaixo de %s no vencimento). O prêmio só amortece %s%% de queda." % (
            _rs(S - c["preco"]), _br(100 * c["preco"] / S, 1)),
        riscoCauda="O risco é o de ter a ação: numa queda forte você perde quase tudo o que a ação perder, menos o prêmio. E se ela disparar, o ganho para em %s." % _rs(c["k"]),
        passos=[
            "Tenha 100 %s na carteira (ou compre: cerca de %s). Elas ficam como garantia da call vendida." % (m["ativo"], _rs(S * LOTE)),
            "Venda 1 lote (100 opções) da call %s, strike %s, vencimento %s. Prêmio a receber: cerca de %s." % (c["tk"], _rs(c["k"]), _dbr(m["venc"]), _rs(premio)),
            "No vencimento, se a ação fechar ABAIXO de %s: a call vira pó, você fica com as ações e com o prêmio." % _rs(c["k"]),
            "Se fechar ACIMA de %s: você é exercido e entrega as ações por %s cada. Ganha a diferença até o strike mais o prêmio, e nada além disso." % (_rs(c["k"]), _rs(c["k"])),
            "Para sair antes: recompre a mesma call. Se a ação subiu muito, a recompra custa mais do que você recebeu.",
        ])
    return _fechar(est, m, pernas, S * LOTE - premio, "valor das 100 ações menos o prêmio recebido; as ações ficam bloqueadas como garantia", checks)


def _e_put_caixa(m):
    S, du, ctx = m["S"], m["du"], m["ctx"]
    est = dict(id="put_caixa", nome="Venda de put com caixa", visao="neutra a de alta",
               resumo="Você vende uma put abaixo do preço e deixa separado o dinheiro para comprar as ações se for exercido. Recebe o prêmio; se a ação cair, compra mais barato que hoje (mas pode estar ainda mais barata).")
    p = _por_delta(m["lados"], "put", 0.25, (0.20, 0.30), lambda x: x["k"] < S)
    if not p:
        return _indisp(est, "Não achei put fora do dinheiro com delta perto de −0,25 e preço válido neste vencimento.")
    pernas = [_perna(-1, p)]
    premio = p["preco"] * LOTE
    checks = [_ck_prazo(du), _ck_delta(p, "put"), _ck_liq(pernas), _ck_vi(m),
              _ck(ctx["tendencia"]["cod"] != "baixa", "Tendência do ativo: %s (regra: não vender put com o ativo em baixa)" % ctx["tendencia"]["cod"])]
    est.update(
        quandoPerde="Perde quando a ação fecha abaixo de %s (strike menos o prêmio). Daí para baixo, a perda cresce junto com a queda." % _rs(p["k"] - p["preco"]),
        riscoCauda="Numa queda forte (resultado ruim, crise) você é obrigado a comprar as ações por %s mesmo que valham muito menos. A perda máxima teórica é quase todo o caixa separado." % _rs(p["k"]),
        passos=[
            "Separe %s em caixa (strike × 100). Esse dinheiro é a garantia: sem ele, a operação vira venda a descoberto com chamada de margem." % _rs(p["k"] * LOTE),
            "Venda 1 lote da put %s, strike %s, vencimento %s. Prêmio a receber: cerca de %s." % (p["tk"], _rs(p["k"]), _dbr(m["venc"]), _rs(premio)),
            "No vencimento, se a ação fechar ACIMA de %s: a put vira pó e o prêmio é seu." % _rs(p["k"]),
            "Se fechar ABAIXO: você compra 100 ações por %s cada. Seu custo real fica em %s (strike menos prêmio)." % (_rs(p["k"]), _rs(p["k"] - p["preco"])),
            "Só faça com ação que você aceitaria ter na carteira a esse preço.",
        ])
    return _fechar(est, m, pernas, p["k"] * LOTE, "caixa separado para comprar as 100 ações no strike (o prêmio recebido abate uma parte)", checks)


def _e_trava(m, alta):
    S, du, ctx = m["S"], m["du"], m["ctx"]
    tipo = "call" if alta else "put"
    est = dict(id="trava_alta" if alta else "trava_baixa",
               nome="Trava de alta com calls" if alta else "Trava de baixa com puts", visao="de alta" if alta else "de baixa",
               resumo=("Compra uma call perto do preço e vende outra mais acima, no mesmo vencimento. Paga um valor fixo (débito) para ganhar se a ação subir; "
                       "a perda máxima é o que pagou." if alta else
                       "Compra uma put perto do preço e vende outra mais abaixo, no mesmo vencimento. Paga um valor fixo (débito) para ganhar se a ação cair; "
                       "a perda máxima é o que pagou."))
    a = _no_dinheiro(m["lados"], tipo)
    if not a:
        return _indisp(est, "Não achei %s no dinheiro com preço válido neste vencimento." % tipo)
    b = _por_delta(m["lados"], tipo, 0.25, (0.20, 0.30), (lambda x: x["k"] > a["k"]) if alta else (lambda x: x["k"] < a["k"]))
    if not b or b["preco"] >= a["preco"]:
        return _indisp(est, "Não achei a segunda %s (delta perto de 0,25) com preço coerente neste vencimento." % tipo)
    pernas = [_perna(1, a), _perna(-1, b)]
    debito, largura = a["preco"] - b["preco"], abs(b["k"] - a["k"])
    mm20, mm50 = ctx["mm20"], ctx["mm50"]
    if mm20 is None or mm50 is None:
        ck_t = _ck(False, "Sem médias de 20 e 50 agora para conferir a tendência")
    elif alta:
        ck_t = _ck(S > mm20 > mm50, "Preço %s, média de 20 %s, média de 50 %s (regra: preço > média 20 > média 50)" % (_br(S), _br(mm20), _br(mm50)))
    else:
        ck_t = _ck(S < mm20 < mm50, "Preço %s, média de 20 %s, média de 50 %s (regra: preço < média 20 < média 50)" % (_br(S), _br(mm20), _br(mm50)))
    checks = [_ck_prazo(du, 15, 45), ck_t,
              _ck(debito <= 0.40 * largura + 1e-9, "Débito de %s por ação = %s%% da distância entre os strikes (regra: até 40%%)" % (_rs(debito), _br(100 * debito / largura, 0))),
              _ck_delta(b, tipo + " vendida"), _ck_liq(pernas)]
    emp = a["k"] + debito if alta else a["k"] - debito
    est.update(
        quandoPerde=("Perde se a ação não passar de %s até o vencimento. Parada ou em queda, você perde o débito inteiro." % _rs(emp) if alta else
                     "Perde se a ação não cair abaixo de %s até o vencimento. Parada ou em alta, você perde o débito inteiro." % _rs(emp)),
        riscoCauda="A perda é limitada ao débito pago (%s por lote), mas perder 100%% do que foi posto é um resultado comum, não raro. O tempo joga contra: cada dia parado tira valor." % _rs(debito * LOTE),
        passos=[
            "Compre 1 lote da %s %s, strike %s (perto do preço atual, %s). Custa cerca de %s." % (tipo, a["tk"], _rs(a["k"]), _rs(S), _rs(a["preco"] * LOTE)),
            "No mesmo momento, venda 1 lote da %s %s, strike %s, mesmo vencimento (%s). Recebe cerca de %s." % (tipo, b["tk"], _rs(b["k"]), _dbr(m["venc"]), _rs(b["preco"] * LOTE)),
            "O que sai do bolso é a diferença: cerca de %s. É também o máximo que dá para perder." % _rs(debito * LOTE),
            "Ganho máximo: a distância entre os strikes menos o débito, cerca de %s, se a ação fechar %s de %s." % (
                _rs((largura - debito) * LOTE), "acima" if alta else "abaixo", _rs(b["k"])),
            "Monte as duas pernas juntas (muitas corretoras têm a boleta de estratégia). Desmontar uma perna só muda todo o risco.",
        ])
    return _fechar(est, m, pernas, debito * LOTE, "o débito pago; não exige garantia além disso enquanto as duas pernas estiverem montadas", checks)


def _e_collar(m):
    S, du = m["S"], m["du"]
    est = dict(id="collar", nome="Collar (proteção financiada)", visao="proteção de quem já tem a ação",
               resumo="Você tem 100 ações, compra uma put abaixo do preço (o seguro) e paga esse seguro vendendo uma call acima. Fica com um piso e um teto até o vencimento.")
    p = _por_delta(m["lados"], "put", 0.25, (0.20, 0.30), lambda x: x["k"] < S)
    c = _por_delta(m["lados"], "call", 0.25, (0.20, 0.30), lambda x: x["k"] > S)
    if not p or not c:
        return _indisp(est, "Não achei a put e a call com delta perto de 0,25 e preço válido neste vencimento.")
    pernas = [_perna_acao(m["ativo"], S), _perna(1, p), _perna(-1, c)]
    custo = p["preco"] - c["preco"]                                # + paga, - recebe
    checks = [_ck_prazo(du), _ck_delta(p, "put"), _ck_delta(c, "call"), _ck_liq(pernas),
              _ck(abs(custo) <= 0.005 * S, "Custo líquido de %s por ação = %s%% do preço (regra: perto de zero, até 0,5%%)" % (_rs(custo), _br(100 * abs(custo) / S, 2)))]
    est.update(
        quandoPerde="Perde se a ação cair, mas só até o piso: abaixo de %s a put cobre a queda. A perda máxima fica em torno de %s por lote." % (
            _rs(p["k"]), _rs((S - p["k"] + custo) * LOTE)),
        riscoCauda="A cauda de queda está coberta até o vencimento. O preço disso é a cauda boa: se a ação disparar, o ganho para em %s. Depois do vencimento a proteção acaba e precisa ser refeita." % _rs(c["k"]),
        passos=[
            "Tenha 100 %s na carteira (cerca de %s)." % (m["ativo"], _rs(S * LOTE)),
            "Compre 1 lote da put %s, strike %s: é o seguro. Custa cerca de %s." % (p["tk"], _rs(p["k"]), _rs(p["preco"] * LOTE)),
            "Venda 1 lote da call %s, strike %s, mesmo vencimento (%s). Recebe cerca de %s." % (c["tk"], _rs(c["k"]), _dbr(m["venc"]), _rs(c["preco"] * LOTE)),
            "Saldo das duas opções: %s %s por lote." % ("você paga" if custo > 0 else "você recebe", _rs(abs(custo) * LOTE)),
            "Até o vencimento, sua ação vale no mínimo %s e no máximo %s para você." % (_rs(p["k"]), _rs(c["k"])),
        ])
    return _fechar(est, m, pernas, S * LOTE + custo * LOTE, "valor das 100 ações mais o custo líquido das opções; as ações garantem a call vendida", checks)


def estruturas(base, ativo, venc=None):
    """As 5 estruturas didaticas montadas com series reais do vencimento."""
    ativo = _validar_ativo(ativo)
    m = _montar(base, ativo, venc)
    geral = dict(ativo=ativo, venc=m["venc"], du=m["du"], spot=_a(m["S"]), dataGrade=m["ser"]["data"], viAtm=_a(m["viAtm"], 4),
                 hv21=_a(m["ctx"]["hv21"], 4), lote=LOTE, taxa=TAXA_B3, avisos=m["avisos"], download=estado_download(),
                 nota="Preços de último negócio, sem corretagem e sem a diferença entre compra e venda. A chance de lucro é uma "
                      "conta de modelo (lognormal, com a VI de agora), não uma previsão. Nenhuma estrutura é infalível.")
    if not m["lados"] or not m["S"] or m["du"] is None:
        geral["lista"] = []
        return geral
    lista = []
    for fn in (_e_coberto, _e_put_caixa, lambda x: _e_trava(x, True), lambda x: _e_trava(x, False), _e_collar):
        try:
            lista.append(fn(m))
        except (ValueError, ZeroDivisionError, OverflowError, TypeError):
            pass                                                   # conta impossivel com os dados de agora: pula
    geral["lista"] = lista
    return geral


# ------------------------------------------------------------------------------------------ API: montar a minha
def simular(base, pernas, ativo=None, venc=None):
    """Pernas escolhidas pelo usuario -> as mesmas metricas das estruturas.
    Cada perna: dict(tipo 'call'|'put'|'acao', lado 'compra'|'venda', qtd (lotes), e `tk` (serie da grade) ou k + preco)."""
    if not isinstance(pernas, list) or not pernas:
        raise ValueError("adicione pelo menos uma perna")
    if len(pernas) > 8:
        raise ValueError("no máximo 8 pernas")
    if not ativo:
        ativo = next((p.get("ativo") for p in pernas if isinstance(p, dict) and p.get("ativo")), None)
    if not ativo:                                                  # sem ativo: descobre pela serie de alguma perna
        tks = {str(p.get("tk") or "").upper() for p in pernas if isinstance(p, dict)} - {""}
        cad = _garantir(base)
        if cad and tks:
            for nome, linhas in cad["ativos"].items():
                achada = next((o for o in linhas if o[TK] in tks), None)
                if achada:
                    ativo, venc = nome, venc or achada[VC]
                    break
        if not ativo:
            raise ValueError("diga o ativo da simulação (ex.: PETR4)")
    ativo = _validar_ativo(ativo)
    if not venc:
        venc = next((p.get("venc") for p in pernas if isinstance(p, dict) and p.get("venc")), None)
    m = _montar(base, ativo, venc)
    if not m["S"]:
        raise ValueError("sem preço de %s agora: não dá para simular" % ativo)
    por_tk = {x["tk"]: x for x in m["lados"]}
    # series fora do recorte da tela (muito longe do dinheiro) tambem valem, desde que sejam deste vencimento
    resto = {o[TK]: o for o in m["ser"]["linhas"] if o[VC] == m["venc"]} if m["venc"] else {}
    S, T, r = m["S"], m["T"] or _anos(21), m["r"]
    limpas, avisos = [], list(m["avisos"])

    def num(v, nome, lo, hi):
        try:
            v = float(v)
        except (TypeError, ValueError):
            raise ValueError("%s inválido" % nome)
        if v != v or not lo <= v <= hi:
            raise ValueError("%s fora da faixa" % nome)
        return v
    for p in pernas:
        if not isinstance(p, dict):
            raise ValueError("perna inválida")
        lado = {"compra": 1, "tem": 1, "venda": -1, "vende": -1}.get(str(p.get("lado") or "").lower())
        if lado is None:
            raise ValueError("lado da perna inválido (compra ou venda)")
        qtd = int(num(p.get("qtd", 1), "quantidade", 1, 1000))
        tipo = str(p.get("tipo") or "").lower()
        tk = str(p.get("tk") or "").upper()
        if tipo == "acao":
            preco = num(p["preco"], "preço", 0.01, 1e6) if p.get("preco") not in (None, "") else S
            x = _perna_acao(ativo, preco, lado, qtd)
        else:
            if p.get("venc") and m["venc"] and p["venc"] != m["venc"]:
                raise ValueError("por enquanto todas as pernas precisam ter o mesmo vencimento (%s)" % _dbr(m["venc"]))
            s = por_tk.get(tk)
            if s is None and tk in resto:
                s = _lado(resto[tk], _cotacao(tk) if m["ser"]["fonte"] == "B3" else None, S, m.get("S_arq") or S, T,
                          _anos(dias_uteis(_d(m["ser"]["data"]), _d(m["venc"]))), r)
            if s is not None:
                x = _perna(lado, s, qtd)
                if p.get("preco") not in (None, ""):
                    x["preco"] = num(p["preco"], "preço", 0.01, 1e6)
                    x["fonte"] = "digitado"
                    x["vi"] = bs_vi("C" if x["tipo"] == "call" else "P", x["preco"], S, x["k"], T, r) or x["vi"]
                if not x["preco"]:
                    raise ValueError("a série %s está sem preço: digite o prêmio" % tk)
            else:
                if tipo not in ("call", "put"):
                    raise ValueError("tipo da perna inválido (call, put ou acao)")
                k = num(p.get("k"), "strike", 0.01, 1e6)
                preco = num(p.get("preco"), "prêmio", 0.01, 1e6)
                vi = bs_vi("C" if tipo == "call" else "P", preco, S, k, T, r)
                g = bs_gregas("C" if tipo == "call" else "P", S, k, T, r, vi) if vi else {}
                x = dict(lado=lado, tipo=tipo, tk=tk if SERIE_OK.match(tk) else "", k=k, preco=preco, qtd=qtd, vi=vi,
                         fonte="digitado", delta=g.get("delta"), neg=None, estilo=None, liq=False)
        limpas.append(x)
    a = _avaliar(limpas, S, r, T, m["viAtm"] or m["ctx"]["hv21"] or 0.35)
    acoes = sum(p["preco"] * p["qtd"] * LOTE for p in limpas if p["tipo"] == "acao" and p["lado"] > 0)
    if a["perdaMax"] is None:
        capital, txt = None, ("perda sem limite na alta: a corretora exige garantia (margem) e pode pedir mais dinheiro se o preço andar contra. "
                              "Não é estrutura para quem está aprendendo.")
    elif acoes:
        capital, txt = acoes - a["liquido"], "valor das ações mais o saldo pago nas opções (ou menos o saldo recebido)"
    else:
        capital, txt = a["perdaMax"], "igual à perda máxima: é o que precisa estar disponível (débito pago ou garantia da venda)"
    if any(p["lado"] < 0 and p["tipo"] != "acao" for p in limpas) and a["perdaMax"] is not None and not acoes:
        txt += ". Há opção vendida: a corretora bloqueia garantia mesmo com a perda limitada."
    if any(p["tipo"] == "acao" and p["lado"] < 0 for p in limpas):
        avisos.append("Venda de ação a descoberto exige aluguel do papel e garantia; isso não está nas contas.")
    du = max(m["du"] or 1, 1)
    ret = 100.0 * a["ganhoMax"] / capital if a["ganhoMax"] is not None and capital and capital > 0 else None
    a.update(ativo=ativo, venc=m["venc"], du=m["du"], spot=_a(S), pernas=_pernas_tela(limpas), capital=_a(capital), capitalTxt=txt,
             retorno=_a(ret, 2), retornoAno=_a(ret * 252.0 / du, 1) if ret is not None and a["liquido"] > 0 else None, avisos=avisos,
             nota="Simulação com preços de último negócio, sem corretagem. A chance de lucro é conta de modelo, não previsão.")
    return a


# ------------------------------------------------------------------------------------------ API: oportunidades
def oportunidades(base):
    """Triagem nos ativos padrao com os dados do FECHAMENTO do ultimo arquivo (nada de cotacao do dia).
    E so um filtro para saber onde olhar: nao e sinal de compra nem de venda."""
    cad = _garantir(base)
    est = estado_download()
    vazio = dict(dataGrade=None, download=est, vi=[], volume=[], cobertas=[],
                 filtros="", aviso="A triagem usa a grade oficial da B3, que ainda não está carregada.")
    if cad is None:
        return vazio

    def calc():
        cdi = _cdi(base)
        r = math.log(1.0 + cdi["valor"] / 100.0)
        ref = _d(cad["data"])
        fut = {a: _fila.submit(_historico, a) for a in ATIVOS_PADRAO}
        wait(list(fut.values()), timeout=14)
        tab_vi, tab_vol, tab_cob = [], [], []
        for ativo in ATIVOS_PADRAO:
            linhas, fech = cad["ativos"].get(ativo) or [], (cad.get("fech") or {}).get(ativo)
            if not linhas or not fech:
                continue
            S = fech[0]
            try:
                h = fut[ativo].result(timeout=0) if fut[ativo].done() else None
            except Exception:
                h = None
            hv = _vol_hist((h or {}).get("fech") or [], 21)
            ser = dict(linhas=linhas, data=cad["data"], fonte="B3", fech=fech)
            v = _vi_atm_fech(base, ativo, ser, r)
            if v:
                tab_vi.append(dict(ativo=ativo, spot=_a(S), viAtm=_a(v["vi"], 4), hv21=_a(hv, 4), razao=_a(v["vi"] / hv, 2) if hv else None,
                                   venc=v["venc"], du=v["du"]))
            vencs = {x["data"]: x for x in _vencimentos(linhas, ref)}
            for o in linhas:
                if (o[NG] or 0) >= 50 and o[UL] and o[VC] in vencs:
                    tab_vol.append(dict(ativo=ativo, tk=o[TK], tipo="call" if o[TP] == "C" else "put", k=o[KK], venc=o[VC], du=vencs[o[VC]]["du"],
                                        ult=_a(o[UL]), neg=o[NG], vol=_a(o[VL], 0), oi=_a(o[OI], 0), dist=_a(100.0 * (o[KK] / S - 1), 1)))
            for venc, x in vencs.items():
                if not 5 <= x["du"] <= 60:
                    continue
                T, melhor = _anos(x["du"]), None
                for o in linhas:
                    if o[VC] != venc or o[TP] != "C" or (o[NG] or 0) < MIN_NEG or not o[UL] or not S < o[KK] <= S * 1.2:
                        continue
                    vi = bs_vi("C", o[UL], S, o[KK], T, r)
                    if not vi:
                        continue
                    delta = bs_gregas("C", S, o[KK], T, r, vi)["delta"]
                    if 0.15 <= delta <= 0.35 and (melhor is None or abs(delta - 0.25) < abs(melhor[1] - 0.25)):
                        melhor = (o, delta)
                if melhor:
                    o, delta = melhor
                    taxa = 100.0 * o[UL] / S
                    tab_cob.append(dict(ativo=ativo, tk=o[TK], k=o[KK], venc=venc, du=x["du"], semanal=x["semanal"], premio=_a(o[UL]),
                                        delta=_a(delta, 2), pctSpot=_a(taxa, 2), aoAno=_a(taxa * 252.0 / x["du"], 1),
                                        dist=_a(100.0 * (o[KK] / S - 1), 1), neg=o[NG], spot=_a(S)))
        tab_vi.sort(key=lambda x: -(x["razao"] or 0))
        tab_vol.sort(key=lambda x: -(x["vol"] or 0))
        tab_cob.sort(key=lambda x: -(x["aoAno"] or 0))
        return dict(dataGrade=cad["data"], vi=tab_vi, volume=tab_vol[:20], cobertas=tab_cob[:25],
                    filtros="Ativos: %s. Preços e negócios do fechamento de %s. Volume: séries com 50 negócios ou mais. Lançamento coberto: "
                            "calls fora do dinheiro com %d negócios ou mais, delta entre 0,15 e 0,35 (a mais perto de 0,25 por vencimento), "
                            "de 5 a 60 dias úteis." % (", ".join(ATIVOS_PADRAO), _dbr(cad["data"]), MIN_NEG),
                    aviso="Isto é triagem, não recomendação. VI alta costuma ter motivo (resultado, notícia, risco); taxa alta de "
                          "lançamento coberto quase sempre vem com ação mais arriscada. A taxa ao ano supõe repetir a operação o ano "
                          "todo sem ser exercido e sem a ação cair, o que não acontece.")
    saida = _memo(("oport", cad["data"]), VIDA_OPORT, calc, 30.0)
    if not saida:
        return vazio
    saida = dict(saida)
    saida["download"] = est
    return saida


# ------------------------------------------------------------------------------------------ autoteste
def _autoteste():
    import sys
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass
    falhas = []

    def conferir(nome, cond):
        print("  [%s] %s" % ("ok" if cond else "FALHOU", nome))
        if not cond:
            falhas.append(nome)
    perto = lambda a, b, tol=1e-6: abs(a - b) <= tol

    print("1) contas")
    S, K, T, r, v = 54.0, 56.0, 30 / 252.0, math.log(1.1365), 0.32
    c, p = bs_preco("C", S, K, T, r, v), bs_preco("P", S, K, T, r, v)
    conferir("paridade call-put: C - P = S - K.e^(-rT)", perto(c - p, S - K * math.exp(-r * T), 1e-9))
    conferir("VI de ida e volta (call e put)", perto(bs_vi("C", c, S, K, T, r), v, 1e-6) and perto(bs_vi("P", p, S, K, T, r), v, 1e-6))
    conferir("VI de preço abaixo do intrínseco = None", bs_vi("C", 1.0, 60.0, 50.0, T, r) is None)
    g = bs_gregas("C", S, K, T, r, v)
    h = 1e-4
    conferir("delta = derivada numérica do preço", perto(g["delta"], (bs_preco("C", S + h, K, T, r, v) - bs_preco("C", S - h, K, T, r, v)) / (2 * h), 1e-5))
    conferir("vega = derivada numérica (por 1 ponto)", perto(g["vega"], (bs_preco("C", S, K, T, r, v + h) - bs_preco("C", S, K, T, r, v - h)) / (2 * h) / 100, 1e-5))
    conferir("theta = derivada numérica (por dia útil)", perto(g["theta"], -(bs_preco("C", S, K, T + h, r, v) - bs_preco("C", S, K, T - h, r, v)) / (2 * h) / 252, 1e-5))
    gp = bs_gregas("P", S, K, T, r, v)
    conferir("delta da put = delta da call - 1; gamma igual", perto(gp["delta"], g["delta"] - 1) and perto(gp["gamma"], g["gamma"]))
    conferir("dias úteis 07/10/2026 -> 16/10 = 6 e -> 19/11 = 29", dias_uteis(date(2026, 10, 7), date(2026, 10, 16)) == 6 and dias_uteis(date(2026, 10, 7), date(2026, 11, 19)) == 29)
    # trava de alta 54/58 pagando 2,00 - 0,60
    tr = [dict(lado=1, tipo="call", k=54.0, preco=2.0, qtd=1, vi=0.3), dict(lado=-1, tipo="call", k=58.0, preco=0.6, qtd=1, vi=0.3)]
    a = _avaliar(tr, 54.0, r, T, 0.3)
    custo = TAXA_B3 * 260
    conferir("trava de alta: perda máx = débito + custos", perto(a["perdaMax"], 140 + custo, 0.011))
    conferir("trava de alta: ganho máx = largura - débito - custos", perto(a["ganhoMax"], 400 - 140 - custo, 0.011))
    conferir("trava de alta: empate = strike comprado + débito", len(a["empates"]) == 1 and perto(a["empates"][0], 55.4 + custo / 100, 0.011))
    conferir("trava de alta: chance de lucro entre 0 e 100", a["prob"] is not None and 0 < a["prob"] < 100)
    # lancamento coberto: acao a 54, call 57 por 0,80
    lc = [dict(lado=1, tipo="acao", k=None, preco=54.0, qtd=1, vi=None), dict(lado=-1, tipo="call", k=57.0, preco=0.8, qtd=1, vi=0.3)]
    a = _avaliar(lc, 54.0, r, T, 0.3)
    conferir("lançamento coberto: ganho máx = (K - S + prêmio) x 100", perto(a["ganhoMax"], 380 - TAXA_B3 * 80, 0.011))
    conferir("lançamento coberto: perda máx = (S - prêmio) x 100", perto(a["perdaMax"], 5320 + TAXA_B3 * 80, 0.011))
    conferir("lançamento coberto: empate = S - prêmio", perto(a["empates"][0], 53.2 + TAXA_B3 * 0.8, 0.011))
    # put vendida e call vendida a seco
    a = _avaliar([dict(lado=-1, tipo="put", k=50.0, preco=0.7, qtd=1, vi=0.3)], 54.0, r, T, 0.3)
    conferir("put vendida: perda máx = (K - prêmio) x 100, ganho = prêmio", perto(a["perdaMax"], 4930 + TAXA_B3 * 70, 0.011) and perto(a["ganhoMax"], 70 - TAXA_B3 * 70, 0.011))
    a = _avaliar([dict(lado=-1, tipo="call", k=57.0, preco=0.8, qtd=1, vi=0.3)], 54.0, r, T, 0.3)
    conferir("call vendida a seco: perda sem limite", a["perdaMax"] is None and a["ganhoMax"] is not None)
    a = _avaliar([dict(lado=1, tipo="acao", k=None, preco=54.0, qtd=1, vi=None), dict(lado=1, tipo="put", k=51.0, preco=0.9, qtd=1, vi=0.3),
                  dict(lado=-1, tipo="call", k=57.0, preco=0.9, qtd=1, vi=0.3)], 54.0, r, T, 0.3)
    conferir("collar de custo zero: piso e teto simétricos", perto(a["perdaMax"], 300 + TAXA_B3 * 180, 0.011) and perto(a["ganhoMax"], 300 - TAXA_B3 * 180, 0.011))

    print("2) dados reais (PETR4)")
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    t0 = time.time()
    pn = painel(base, "PETR4")
    while pn["download"]["estado"] == "baixando" and time.time() - t0 < 300:
        print("   baixando: %3d%% %s" % (pn["download"]["progresso"], pn["download"]["etapa"]))
        time.sleep(3)
        pn = painel(base, "PETR4")
    b = pn["base"]
    print("   grade: %s (%s) em %.1f s | estado %s %s" % (pn["dataGrade"], pn["fonteGrade"], time.time() - t0, pn["download"]["estado"], pn["download"]["erro"] or ""))
    print("   PETR4 %s (%s%%) %s | %s" % (b["preco"], b["var"], b["hora"], b["fonte"]))
    print("   MM20 %s MM50 %s MM200 %s | %s" % (b["mm20"], b["mm50"], b["mm200"], b["tendencia"]["txt"]))
    print("   HV21 %s HV63 %s percentil %s | CDI %s (%s)%s" % (b["hv21"], b["hv63"], b["hvPct"], pn["cdi"]["valor"], pn["cdi"]["data"], " RESERVA" if pn["cdi"]["reserva"] else ""))
    print("   VI ATM fech. %s (venc %s) | rank: %s %s (%d fotos)" % (pn["vi"]["atm"], pn["vi"]["venc"], pn["vi"]["modo"], pn["vi"]["rank"], pn["vi"]["n"]))
    print("   vencimentos: " + ", ".join("%s(%ddu%s)" % (x["data"][5:], x["du"], " sem" if x["semanal"] else "") for x in pn["vencs"][:9]) + " | padrão " + str(pn["vencPadrao"]))
    for av in pn["avisos"]:
        print("   aviso: " + av)
    conferir("painel com preço e vencimentos", bool(b["preco"]) and len(pn["vencs"]) > 0)
    t0 = time.time()
    gr = grade(base, "PETR4", pn["vencPadrao"])
    print("   grade %s: %d strikes, %d cotações do dia, VI ATM %s, em %.1f s" % (gr["venc"], len(gr["linhas"]), gr["agora"], gr["viAtm"], time.time() - t0))
    for ln in gr["linhas"]:
        if abs(ln["dist"]) <= 4:
            f = lambda x: "%-10s %6s %-5s vi %-6s d %-6s neg %-5s oi %-8s" % (x["tk"], x["preco"], x["fonte"], x["vi"], x["delta"], x["neg"], x["oi"]) if x else " " * 60
            print("   %s | %7.2f%s | %s" % (f(ln["call"]), ln["k"], "*" if ln["atm"] else " ", f(ln["put"])))
    conferir("grade com VI no dinheiro", gr["viAtm"] is not None and 0.05 < gr["viAtm"] < 2)
    es = estruturas(base, "PETR4", pn["vencPadrao"])
    for e in es["lista"]:
        if not e["disponivel"]:
            print("   %-28s indisponível: %s" % (e["nome"], e["motivo"]))
            continue
        print("   %-28s %s | líquido %s ganho %s perda %s empates %s chance %s%% capital %s | regras %s" % (
            e["nome"], " ".join("%s %s@%s" % (x["lado"], x["tk"], x["preco"]) for x in e["pernas"]), e["liquido"], e["ganhoMax"], e["perdaMax"],
            e["empates"], e["prob"], e["capital"], "OK" if e["entra_agora"]["ok"] else "não atendidas (%d de %d)" % (
                sum(1 for c in e["entra_agora"]["motivos"] if c["ok"]), len(e["entra_agora"]["motivos"]))))
    conferir("5 estruturas devolvidas", len(es["lista"]) == 5)
    disp = [e for e in es["lista"] if e["disponivel"]]
    if disp:
        e = next((x for x in disp if x["id"] == "trava_alta"), disp[0])
        sm = simular(base, [dict(tipo=x["tipo"], lado=x["lado"], tk=x["tk"], qtd=1) for x in e["pernas"]], "PETR4", es["venc"])
        conferir("simular repete a estrutura (%s)" % e["nome"], sm["ganhoMax"] == e["ganhoMax"] and sm["perdaMax"] == e["perdaMax"])
    t0 = time.time()
    op = oportunidades(base)
    print("   oportunidades em %.1f s: %d VI, %d volume, %d cobertas" % (time.time() - t0, len(op["vi"]), len(op["volume"]), len(op["cobertas"])))
    for x in op["vi"][:4]:
        print("     VI/HV %-6s %s VI %s HV %s" % (x["ativo"], x["razao"], x["viAtm"], x["hv21"]))
    for x in op["cobertas"][:4]:
        print("     coberta %-6s %s K %s %ddu prêmio %s = %s%% (%s%% a.a.) delta %s" % (x["ativo"], x["tk"], x["k"], x["du"], x["premio"], x["pctSpot"], x["aoAno"], x["delta"]))
    conferir("oportunidades com dados", len(op["vi"]) > 0)
    try:
        painel(base, "<script>")
        conferir("ativo inválido recusado", False)
    except ValueError:
        conferir("ativo inválido recusado", True)
    json.dumps([pn, gr, es, op])                                   # tudo precisa virar JSON
    print("RESULTADO: %s" % ("tudo certo" if not falhas else "%d falha(s): %s" % (len(falhas), "; ".join(falhas))))
    return 0 if not falhas else 1


if __name__ == "__main__":
    raise SystemExit(_autoteste())
