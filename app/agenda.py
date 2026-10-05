# -*- coding: utf-8 -*-
"""
Agenda economica: os eventos com hora marcada que costumam mexer no mercado (so informa; nao bloqueia nada).

  * Exterior: calendario semanal do ForexFactory (EUA, Europa, Reino Unido, Japao, Australia, China), impacto alto e medio.
  * Brasil: calendario oficial de divulgacoes do IBGE (IPCA, IPCA-15, PIB, desemprego, industria, varejo, servicos)
    e as reunioes do Copom de 2026 (datas publicadas pelo Banco Central).

Nos estudos, o mercado anda MAIS nos dias e horarios de noticia (a tendencia do dia fica mais forte e os saltos
tambem): por isso o robo avisa a hora, e a decisao de operar ou esperar continua sendo de quem opera.
"""
import gzip
import json
import time
import urllib.request
from datetime import datetime, timedelta, timezone

FF = "https://nfs.faireconomy.media/ff_calendar_thisweek.json"
IBGE = "https://servicodados.ibge.gov.br/api/v3/calendario/?de=%s&ate=%s&qtd=80"
VIDA = 1800                                  # refaz a cada 30 min
_cache = dict(t=0.0, dados=None)

# reunioes do Copom em 2026 (decisao no 2o dia, por volta das 18h30 de Brasilia; ata as 8h da terca seguinte)
COPOM = [("2026-11-04 18:30", "ALTO", "Copom: decisão da taxa Selic"), ("2026-11-10 08:00", "MEDIO", "Ata do Copom"),
         ("2026-12-09 18:30", "ALTO", "Copom: decisão da taxa Selic"), ("2026-12-15 08:00", "MEDIO", "Ata do Copom")]

PAIS = {"USD": "EUA", "EUR": "Europa", "GBP": "Reino Unido", "JPY": "Japão", "AUD": "Austrália", "CNY": "China",
        "CAD": "Canadá", "CHF": "Suíça", "NZD": "N. Zelândia", "BRL": "Brasil", "All": "Mundo"}
TRADUCAO = {
    "non-farm employment change": "Payroll: criação de empregos",
    "unemployment rate": "Taxa de desemprego",
    "average hourly earnings m/m": "Ganho médio por hora",
    "cpi m/m": "Inflação ao consumidor (CPI) no mês", "cpi y/y": "Inflação ao consumidor (CPI) em 12 meses",
    "core cpi m/m": "Núcleo da inflação (CPI) no mês", "core pce price index m/m": "Núcleo do PCE (a inflação que o Fed acompanha)",
    "ppi m/m": "Inflação ao produtor (PPI)", "core ppi m/m": "Núcleo da inflação ao produtor (PPI)",
    "federal funds rate": "Fed: decisão da taxa de juros", "fomc statement": "Fed: comunicado da decisão (FOMC)",
    "fomc press conference": "Fed: entrevista coletiva", "fomc meeting minutes": "Ata do Fed (FOMC)",
    "fomc economic projections": "Fed: projeções econômicas", "fed chair powell speaks": "Discurso do presidente do Fed",
    "advance gdp q/q": "PIB dos EUA (1ª prévia)", "prelim gdp q/q": "PIB dos EUA (2ª prévia)", "final gdp q/q": "PIB dos EUA (final)",
    "retail sales m/m": "Vendas no varejo", "core retail sales m/m": "Vendas no varejo (núcleo)",
    "ism manufacturing pmi": "PMI da indústria (ISM)", "ism services pmi": "PMI de serviços (ISM)",
    "flash manufacturing pmi": "PMI da indústria (prévia)", "flash services pmi": "PMI de serviços (prévia)",
    "unemployment claims": "Pedidos de seguro-desemprego", "adp non-farm employment change": "Empregos no setor privado (ADP)",
    "jolts job openings": "Vagas de emprego abertas (JOLTS)", "cb consumer confidence": "Confiança do consumidor",
    "prelim uom consumer sentiment": "Confiança do consumidor (Michigan, prévia)",
    "revised uom consumer sentiment": "Confiança do consumidor (Michigan)",
    "crude oil inventories": "Estoques de petróleo", "durable goods orders m/m": "Pedidos de bens duráveis",
    "empire state manufacturing index": "Índice industrial de Nova York", "philly fed manufacturing index": "Índice industrial da Filadélfia",
    "new home sales": "Vendas de casas novas", "existing home sales": "Vendas de casas usadas",
    "main refinancing rate": "BCE: decisão da taxa de juros", "ecb press conference": "BCE: entrevista coletiva",
    "monetary policy statement": "Comunicado de política monetária", "official bank rate": "Banco da Inglaterra: decisão de juros",
    "boj policy rate": "Banco do Japão: decisão de juros", "cash rate": "Austrália: decisão de juros",
    "opec-jmmc meetings": "Reunião da OPEP+", "opec meetings": "Reunião da OPEP",
    "employment change": "Criação de empregos", "gdp m/m": "PIB do mês", "trade balance": "Balança comercial",
    "treasury currency report": "Relatório cambial do Tesouro", "bank holiday": "Feriado bancário",
}
IBGE_REGRAS = [                                 # (trecho do titulo, impacto, nome curto)
    ("consumidor amplo 15", "ALTO", "IPCA-15 (prévia da inflação)"),
    ("consumidor amplo", "ALTO", "IPCA (inflação oficial)"),
    ("contas nacionais trimestrais", "ALTO", "PIB do trimestre"),
    ("contínua mensal", "MEDIO", "Desemprego (PNAD Contínua)"),
    ("pesquisa industrial mensal", "MEDIO", "Produção industrial"),
    ("pesquisa mensal de comércio", "MEDIO", "Vendas no varejo"),
    ("pesquisa mensal de serviços", "MEDIO", "Setor de serviços"),
]


def _json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=15) as r:
        corpo = r.read()
    if corpo[:2] == b"\x1f\x8b":                 # o IBGE as vezes responde compactado mesmo sem pedir
        corpo = gzip.decompress(corpo)
    return json.loads(corpo.decode("utf-8"))


def _exterior():
    out = []
    for x in _json(FF):
        imp = {"High": "ALTO", "Medium": "MEDIO"}.get(x.get("impact"))
        if not imp:
            continue
        try:
            t = datetime.fromisoformat(x["date"]).timestamp()
        except (ValueError, KeyError):
            continue
        orig = (x.get("title") or "").strip()
        m = x.get("country") or ""
        pt = TRADUCAO.get(orig.lower())
        if not pt and orig.endswith(" Speaks"):
            pt = "Discurso: " + orig[:-7]
        out.append(dict(t=int(t), moeda=m, pais=PAIS.get(m, m), impacto=imp, titulo=pt or orig,
                        original=orig, previsao=x.get("forecast") or "", anterior=x.get("previous") or ""))
    return out


def _brasil():
    hoje = datetime.now(timezone.utc)
    de, ate = hoje - timedelta(days=1), hoje + timedelta(days=10)
    out = []
    for x in (_json(IBGE % (de.strftime("%m-%d-%Y"), ate.strftime("%m-%d-%Y"))).get("items") or []):
        tit = (x.get("titulo") or "").lower()
        regra = next((r for r in IBGE_REGRAS if r[0] in tit), None)
        if not regra or "anual" in tit or "retrospectiva" in tit:
            continue
        try:                                      # o IBGE publica o horario em UTC (12:00 = 9h de Brasilia)
            t = datetime.strptime(x["data_divulgacao"], "%d/%m/%Y %H:%M:%S").replace(tzinfo=timezone.utc).timestamp()
        except (ValueError, KeyError):
            continue
        out.append(dict(t=int(t), moeda="BRL", pais="Brasil", impacto=regra[1], titulo=regra[2], original=x.get("titulo") or "",
                        previsao="", anterior=""))
    return out


def _copom():
    out = []
    for quando, imp, tit in COPOM:
        t = datetime.strptime(quando, "%Y-%m-%d %H:%M").replace(tzinfo=timezone(timedelta(hours=-3))).timestamp()
        out.append(dict(t=int(t), moeda="BRL", pais="Brasil", impacto=imp, titulo=tit, original=tit, previsao="", anterior=""))
    return out


def buscar():
    """dict(eventos=[...] em ordem de horario (so de ontem para a frente), fontes=[...], erro)."""
    agora = time.time()
    if _cache["dados"] and agora - _cache["t"] < VIDA:
        return _cache["dados"]
    eventos, fontes, erros = [], [], []
    for nome, fn in (("ForexFactory", _exterior), ("IBGE", _brasil), ("Banco Central (Copom)", _copom)):
        try:
            ev = fn()
            eventos += ev
            fontes.append(nome)
        except Exception as e:
            erros.append("%s: %s" % (nome, str(e)[:60]))
    eventos = sorted([e for e in eventos if agora - 86400 <= e["t"] <= agora + 9 * 86400], key=lambda e: (e["t"], e["moeda"]))
    dados = dict(eventos=eventos, fontes=fontes, erro="; ".join(erros) or None, atualizado=agora)
    if eventos or not _cache["dados"]:
        _cache.update(t=agora, dados=dados)
    return _cache["dados"]
