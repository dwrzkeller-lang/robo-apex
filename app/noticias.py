# -*- coding: utf-8 -*-
"""
Noticias que mexem no mercado brasileiro: le varios feeds (RSS/Atom) ao mesmo tempo, junta, tira repetidas e
classifica o impacto por palavras-chave (Copom, Selic, IPCA, Fed, fiscal, Petrobras...). Atualiza a cada 45 s.
Nao e recomendacao: e um radar para voce saber o que saiu antes de apertar o botao.
"""
import concurrent.futures as cf
import email.utils
import html
import re
import threading
import time
import unicodedata
import urllib.request
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

FONTES = [
    ("Banco Central", "https://www.bcb.gov.br/api/feed/sitebcb/sitefeeds/notasImprensa"),
    ("InfoMoney", "https://www.infomoney.com.br/feed/"),
    ("Money Times", "https://www.moneytimes.com.br/feed/"),
    ("Valor", "https://valor.globo.com/rss/valor"),
    ("g1 Economia", "https://g1.globo.com/rss/g1/economia/"),
    ("E-Investidor", "https://einvestidor.estadao.com.br/feed/"),
    ("Investing.com", "https://br.investing.com/rss/news.rss"),
    ("Google Notícias", "https://news.google.com/rss/search?q=Ibovespa+OR+d%C3%B3lar+OR+Copom+OR+Selic+OR+IPCA+OR+Haddad+OR+Gal%C3%ADpolo&hl=pt-BR&gl=BR&ceid=BR:pt-419"),
]

# (peso, ativos afetados, palavras) - palavras sem acento e em minusculas
REGRAS = [
    (5, "WIN WDO", ["copom", "selic", "taxa de juros", "decisao de juros", "galipolo", "banco central eleva", "banco central corta", "banco central mantem"]),
    (5, "WIN WDO", ["ipca", "inflacao oficial", "ipca-15", "igp-m"]),
    (5, "WIN WDO", ["fed ", "fomc", "powell", "payroll", "federal reserve", "juros nos eua", "treasur"]),
    (5, "WIN WDO", ["fiscal", "arcabouco", "meta fiscal", "rombo", "deficit", "ministro da fazenda", "ministerio da fazenda", "orcamento"]),
    (4, "WDO", ["intervencao", "leilao de dolar", "swap cambial", "iof", "cambio"]),
    (4, "WIN WDO", ["tarifa", "trump", "guerra comercial", "sancao", "sancoes"]),
    (4, "WIN WDO", ["pib", "recessao", "desemprego", "caged", "pnad", "rating", "moody", "fitch", "s&p global"]),
    (4, "WIN", ["petrobras", "petr4", "vale3", "minerio", "itau", "bradesco", "banco do brasil"]),
    (3, "WIN WDO", ["lula", "haddad", "tarcisio", "eleicao", "pesquisa eleitoral", "stf", "congresso", "camara aprova", "senado aprova"]),
    (3, "WIN WDO", ["china", "petroleo", "brent", "opep", "commodities"]),
    (2, "WDO", ["dolar", "real se", "moeda americana"]),
    (2, "WIN", ["ibovespa", "bolsa", "b3 ", "mercado de acoes", "dividendos"]),
    (2, "WIN WDO", ["focus", "boletim focus", "balanca comercial", "varejo", "producao industrial", "servicos"]),
]

_cache = dict(t=0.0, dados=None)
_trava = threading.Lock()


def _norm(s):
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


def _data(txt):
    txt = (txt or "").strip()
    if not txt:
        return None
    try:
        d = email.utils.parsedate_to_datetime(txt)
    except (TypeError, ValueError):
        d = None
    if d is None:
        for fmt in ("%Y-%m-%dT%H:%M:%S%z", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%d %H:%M:%S"):
            try:
                d = datetime.strptime(txt.replace("Z", "+00:00") if "%z" in fmt else txt, fmt)
                break
            except ValueError:
                continue
    if d is None:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.timestamp()


def _ler(nome, url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"})
    with urllib.request.urlopen(req, timeout=10) as r:
        bruto = r.read()
    raiz = ET.fromstring(bruto.lstrip(b"\xef\xbb\xbf"))
    itens = []
    for el in raiz.iter():
        tag = el.tag.split("}")[-1]
        if tag not in ("item", "entry"):
            continue
        campos = {c.tag.split("}")[-1]: c for c in el}
        titulo = html.unescape((campos.get("title").text or "") if campos.get("title") is not None else "").strip()
        link = ""
        if campos.get("link") is not None:
            link = campos["link"].text or campos["link"].attrib.get("href", "")
        quando = None
        for k in ("pubDate", "updated", "published", "date"):
            if campos.get(k) is not None:
                quando = _data(campos[k].text)
                if quando:
                    break
        fonte = nome
        if nome == "Google Notícias" and " - " in titulo:
            titulo, fonte = titulo.rsplit(" - ", 1)
            fonte = fonte.strip() + " (via Google)"
        if titulo and quando:
            itens.append(dict(titulo=titulo, link=(link or "").strip(), fonte=fonte, t=quando))
    return itens


def _classificar(it):
    txt = " " + _norm(it["titulo"]) + " "
    peso, ativos, motivos = 0, set(), []
    for p, ats, palavras in REGRAS:
        for w in palavras:
            if w in txt:
                peso += p
                ativos.update(ats.split())
                motivos.append(w.strip())
                break
    if it["fonte"] == "Banco Central":
        peso += 3
        ativos.update(("WIN", "WDO"))
    it["peso"] = peso
    it["impacto"] = "ALTO" if peso >= 5 else ("MÉDIO" if peso >= 2 else "BAIXO")
    it["ativos"] = sorted(ativos)
    it["motivos"] = motivos[:4]
    return it


def buscar(forcar=False):
    with _trava:
        if not forcar and _cache["dados"] and time.time() - _cache["t"] < 45:
            return _cache["dados"]
    itens, erros = [], []
    with cf.ThreadPoolExecutor(len(FONTES)) as ex:
        futuros = {ex.submit(_ler, n, u): n for n, u in FONTES}
        for f in cf.as_completed(futuros):
            try:
                itens += f.result()
            except Exception as e:
                erros.append("%s: %s" % (futuros[f], str(e)[:80]))
    agora = time.time()
    vistos, out, por_fonte = set(), [], {}
    for it in sorted(itens, key=lambda x: -x["t"]):
        por_fonte[it["fonte"]] = por_fonte.get(it["fonte"], 0) + 1
        if por_fonte[it["fonte"]] > 40:
            continue                                   # nenhuma fonte domina a lista
        if it["t"] > agora + 600 or agora - it["t"] > 36 * 3600:
            continue                                   # so as ultimas 36 horas
        chave = re.sub(r"[^a-z0-9]", "", _norm(it["titulo"]))[:60]
        if chave in vistos:
            continue
        vistos.add(chave)
        out.append(_classificar(it))
    dados = dict(itens=out[:250], erros=erros, atualizado=agora, fontes=[n for n, _ in FONTES])
    with _trava:
        _cache.update(t=agora, dados=dados)
    return dados
