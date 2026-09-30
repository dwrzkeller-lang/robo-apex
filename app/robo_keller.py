# -*- coding: utf-8 -*-
"""
ROBO KELLER - programa principal.
Sobe um servidor local (so no seu computador), roda as estrategias e abre a tela.
Nao envia ordens: informa o momento de entrada e simula o resultado com dados reais.

Uso:  python robo_keller.py            (ou o RoboKeller.exe)
      python robo_keller.py --sem-janela --porta 8765
"""
import json
import mimetypes
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import traceback
import urllib.parse
import webbrowser
from datetime import date
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import time

import dados_fonte as df
import historico
import noticias
import radar
from estrategias import AQUECIMENTO, ESTRATEGIAS, GESTOES, atencao
from simulador import estatisticas, preparar, simular


def pastas():
    # .exe (PyInstaller): tela em _MEIPASS e dados ao lado do .exe.
    # Python: tela em app/web e dados na pasta do projeto (a mesma do .exe).
    if getattr(sys, "frozen", False):
        return getattr(sys, "_MEIPASS"), os.path.dirname(sys.executable)
    aqui = os.path.dirname(os.path.abspath(__file__))
    return aqui, os.path.dirname(aqui)


RECURSOS, BASE = pastas()
WEB = os.path.join(RECURSOS, "web")
NOME_OK = re.compile(r"^[A-Za-z0-9_\-.]{1,80}$")
TRAVA_DADOS = threading.Lock()


# ------------------------------------------------------------------------------------------ dados
def carregar(chave, tf):
    with TRAVA_DADOS:
        if chave.startswith("CSV:"):
            B, fonte, cfg = df.carregar_csv(BASE, chave[4:])
        else:
            if chave not in df.ATIVOS:
                raise ValueError("ativo desconhecido: %s" % chave)
            cfg = df.ATIVOS[chave]
            B, fonte = df.carregar(BASE, chave, tf)
    if len(B["c"]) < AQUECIMENTO + 20:
        raise RuntimeError("Poucos candles (%d) em %s. Preciso de pelo menos %d." % (len(B["c"]), chave, AQUECIMENTO + 20))
    return B, fonte, cfg


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


def contexto(chave):
    """Tendencia de Dow no Diario e no Semanal (leitura, nao entra na decisao das estrategias)."""
    if chave.startswith("CSV:"):
        return None
    try:
        with TRAVA_DADOS:
            B, _ = df.carregar_yahoo(BASE, chave, 1440)
    except Exception:
        return None
    h, l, c, d = B["h"], B["l"], B["c"], B["d"]
    sem = {}
    for k in range(len(c)):
        dt = date(d[k] // 10000, d[k] // 100 % 100, d[k] % 100).isocalendar()[:2]
        w = sem.get(dt)
        sem[dt] = [max(w[0], h[k]), min(w[1], l[k]), c[k]] if w else [h[k], l[k], c[k]]
    ws = [sem[k] for k in sorted(sem)]
    return dict(diario=dow(h[-60:], l[-60:], c[-60:]),
                semanal=dow([w[0] for w in ws[-30:]], [w[1] for w in ws[-30:]], [w[2] for w in ws[-30:]]))


def _i_da_data(d, alvo, primeiro=True):
    if primeiro:
        for i, x in enumerate(d):
            if x >= alvo:
                return i
        return len(d)
    for i in range(len(d) - 1, -1, -1):
        if d[i] <= alvo:
            return i
    return -1


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
              "veredito", "cor", "explica")
    return {k: st.get(k) for k in chaves}


# ------------------------------------------------------------------------------------------ /api/sim
def api_sim(q):
    chave = q.get("ativo", ["WIN"])[0]
    tf = _int(q, "tf", 5)
    if tf not in df.TEMPOS:
        tf = 5
    est = q.get("est", ["E1"])[0]
    todas = est == "TODAS"
    if not todas and est not in ESTRATEGIAS:
        raise ValueError("estratégia desconhecida: %s" % est)
    gestao = q.get("gestao", ["padrao"])[0]
    if gestao not in GESTOES:
        gestao = "padrao"
    contratos = _float(q, "contratos", 1.0, 0.01, 10000)
    capital = _float(q, "capital", 10000.0, 1.0, 1e9)
    max_stops = int(_float(q, "maxstops", 2, 1, 50))
    com_aten = q.get("aten", ["0"])[0] == "1"

    B, fonte, cfg = carregar(chave, tf)
    tf = B.get("tf", tf)
    sc = df.sessao_cfg(cfg)
    if not cfg.get("fracionado"):
        contratos = max(1.0, round(contratos))
    Gs = preparar(B, sc)
    n = len(B["c"])
    d = B["d"]
    de = _int(q, "de", 0)
    ate = _int(q, "ate", 0)
    i_ini = max(AQUECIMENTO, _i_da_data(d, de) if de else AQUECIMENTO)
    i_fim = _i_da_data(d, ate, primeiro=False) if ate else n - 1
    if i_fim < i_ini:
        raise ValueError("Período vazio: não há candles entre as datas escolhidas (depois dos %d candles de aquecimento)." % AQUECIMENTO)
    codigos = list(ESTRATEGIAS) if todas else [est]
    r = simular(Gs, sc, codigos, gestao=gestao, contratos=contratos, max_stops=max_stops, juntas=todas,
                i_ini=i_ini, i_fim=i_fim, com_atencao=com_aten)
    dsai = lambda i: d[i]                                      # noqa: E731
    st = estatisticas(r["trades"], capital, dsai)
    por_est = {}
    if todas:
        for cod in r["codigos"]:
            ri = simular(Gs, sc, [cod], gestao=gestao, contratos=contratos, max_stops=max_stops, i_ini=i_ini, i_fim=i_fim)
            por_est[cod] = dict(isolada=_resumo(estatisticas(ri["trades"], capital, dsai)),
                                naJunta=_resumo(estatisticas([t for t in r["trades"] if t["est"] == cod], capital, dsai)),
                                # operacoes da estrategia sozinha (para o calendario): entrada, saida, lado, R, dinheiro, motivo, precos
                                ops=[[t["i_ent"], t["i_sai"], t["dir"], round(t["R"], 3), round(t["dinheiro"], 2), t["motivo"],
                                      t["ent"], t["sai"]] for t in ri["trades"]])
    # estado no ultimo candle (o "agora" da simulacao)
    ult = i_fim
    aten_ult = [[c, a] for c in r["codigos"] for a in [atencao(Gs, c, ult)] if a]
    dec = cfg["decimais"] + 2

    def rd(x):
        return [None if v is None else round(v, dec) for v in x]
    G = Gs[1]
    t = B["t"]
    for tr in r["trades"]:
        tr.update(t_sinal=t[tr["i_sinal"]], t_ent=t[tr["i_ent"]], t_sai=t[tr["i_sai"]])
    for od in r["ordens"]:
        od["t_sinal"] = t[od["i_sinal"]]
    return dict(
        meta=dict(ativo=chave, nome=cfg["nome"], fonte=fonte, tick=cfg["tick"], decimais=cfg["decimais"],
                  moeda=cfg.get("moeda", "R$"), lote=cfg.get("lote", "contrato"), tf=tf, nomeTf=df.NOME_TEMPO.get(tf, "%d min" % tf),
                  valorPonto=sc["valor_ponto"], custo=sc["custo"], slip=sc["slip"], fracionado=sc["fracionado"],
                  horaInicio=sc["hora_inicio"], horaFim=sc["hora_fim"], horaZeragem=sc["hora_zeragem"], intraday=tf < 1440,
                  est=est, gestao=gestao, contratos=contratos, capital=capital, maxStops=max_stops,
                  iIni=r["ini"], iFim=r["fim"], dataIni=d[r["ini"]], dataFim=d[r["fim"]],
                  dataMin=d[AQUECIMENTO], dataMax=d[-1], ultimo=n - 1, codigos=r["codigos"]),
        t=t, d=d, hm=B["hm"], o=rd(B["o"]), h=rd(B["h"]), l=rd(B["l"]), c=rd(B["c"]),
        mm9=rd(G.mm9), mm20=rd(G.mm20), mm200=rd(G.mm200), vw=rd(G.vw) if G.vw else None,
        trades=r["trades"], ordens=r["ordens"], abertas=r["abertas"],
        aten={str(k): v for k, v in r["aten"].items()}, atenUlt=aten_ult,
        stats=st, porEst=por_est, contexto=contexto(chave))


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
    ck = (chave, gestao, contratos, capital, max_stops)
    with RADAR_LOCK:
        if q.get("forcar", ["0"])[0] != "1" and ck in RADAR_CACHE and time.time() - RADAR_CACHE[ck][0] < 600:
            return RADAR_CACHE[ck][1]
    res = radar.rodar(carregar, df.sessao_cfg, chave, gestao, contratos, capital, max_stops)
    cfg = df.ATIVOS.get(chave, {})
    res.update(moeda=cfg.get("moeda", "R$"), nome=cfg.get("nome", chave), calculado=time.time())
    with RADAR_LOCK:
        RADAR_CACHE[ck] = (time.time(), res)
    return res


# ------------------------------------------------------------------------------------------ comparar (fundo)
CMP = dict(rodando=False, feito=0, total=0, linhas=[], erro=None, pedido=None)
CMP_LOCK = threading.Lock()


def _comparar(pedido):
    try:
        ativos = pedido["ativos"]
        with CMP_LOCK:
            CMP.update(total=len(ativos), feito=0, linhas=[], erro=None)
        for a in ativos:
            linha = dict(ativo=a)
            try:
                B, _, cfg = carregar(a, pedido["tf"])
                sc = df.sessao_cfg(cfg)
                Gs = preparar(B, sc)
                d = B["d"]
                i_ini = max(AQUECIMENTO, _i_da_data(d, pedido["de"])) if pedido["de"] else AQUECIMENTO
                linha.update(nome=cfg["nome"], moeda=cfg.get("moeda", "R$"), dataIni=d[i_ini], dataFim=d[-1],
                             dias=len(set(d[i_ini:])))
                res = {}
                for cod in list(ESTRATEGIAS) + ["TODAS"]:
                    cods = list(ESTRATEGIAS) if cod == "TODAS" else [cod]
                    if cod != "TODAS" and ESTRATEGIAS[cod]["intraday"] and pedido["tf"] >= 1440:
                        res[cod] = None
                        continue
                    r = simular(Gs, sc, cods, gestao=pedido["gestao"], contratos=1.0, max_stops=pedido["maxstops"],
                                juntas=cod == "TODAS", i_ini=i_ini)
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
            CMP["erro"] = str(e)
    finally:
        with CMP_LOCK:
            CMP["rodando"] = False


def config():
    ativos = [dict(chave=k, nome=v["nome"], moeda=v["moeda"], lote=v["lote"], fracionado=v.get("fracionado", False))
              for k, v in df.ATIVOS.items()]
    ativos += [dict(chave="CSV:" + n, nome="Arquivo: " + n, moeda="R$", lote="contrato", fracionado=False) for n in df.listar_csv(BASE)]
    ests = [dict(cod=k, nome=v["nome"], autor=v["autor"], regras=v["regras"], aguardando=v["aguardando"],
                 intraday=v["intraday"], gestao=v["gestao"], ideal=v.get("ideal", "")) for k, v in ESTRATEGIAS.items()]
    tempos = [dict(tf=k, nome=df.NOME_TEMPO[k], periodo="10 anos" if k >= 1440 else "") for k in df.TEMPOS]
    return dict(ativos=ativos, estrategias=ests, gestoes=GESTOES, tempos=tempos, pastaDados=df.pasta_dados(BASE))


# ------------------------------------------------------------------------------------------ HTTP
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _json(self, obj, code=200):
        dados = json.dumps(obj, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(dados)))
        self.end_headers()
        self.wfile.write(dados)

    def _corpo(self, limite):
        tam = int(self.headers.get("Content-Length", "0"))
        if tam <= 0 or tam > limite:
            raise ValueError("tamanho inválido")
        return json.loads(self.rfile.read(tam).decode("utf-8"))

    def do_POST(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        try:
            if url.path == "/api/comparar":
                p = self._corpo(100000)
                tf = int(p.get("tf", 5))
                pedido = dict(ativos=[a for a in p.get("ativos", []) if a in df.ATIVOS or a.startswith("CSV:")][:30],
                              tf=tf if tf in df.TEMPOS else 5, gestao=p.get("gestao") if p.get("gestao") in GESTOES else "padrao",
                              maxstops=max(1, min(50, int(p.get("maxstops", 2)))), de=int(p.get("de") or 0))
                if not pedido["ativos"]:
                    return self._json(dict(erro="Escolha pelo menos um ativo."), 400)
                with CMP_LOCK:
                    if CMP["rodando"]:
                        return self._json(dict(ok=False, jaRodando=True))
                    CMP.update(rodando=True, pedido=pedido, feito=0, total=len(pedido["ativos"]), linhas=[], erro=None)
                threading.Thread(target=_comparar, args=(pedido,), daemon=True).start()
                return self._json(dict(ok=True))
            if url.path == "/api/estado":
                nome = q.get("nome", [""])[0]
                if not NOME_OK.match(nome):
                    return self._json(dict(erro="nome inválido"), 400)
                corpo = self._corpo(20 * 1024 * 1024)
                arq = os.path.join(df.pasta_dados(BASE), "estado_%s.json" % nome)
                if os.path.exists(arq):
                    shutil.copyfile(arq, arq + ".bak")
                tmp = arq + ".tmp"
                with open(tmp, "w", encoding="utf-8") as f:
                    json.dump(corpo, f, ensure_ascii=False)
                os.replace(tmp, arq)
                return self._json(dict(ok=True))
            return self._json(dict(erro="rota desconhecida"), 404)
        except Exception as e:
            traceback.print_exc()
            return self._json(dict(erro=str(e)), 500)

    def do_GET(self):
        url = urllib.parse.urlparse(self.path)
        q = urllib.parse.parse_qs(url.query)
        try:
            if url.path == "/api/config":
                return self._json(config())
            if url.path == "/api/sim":
                return self._json(api_sim(q))
            if url.path == "/api/radar":
                return self._json(api_radar(q))
            if url.path == "/api/noticias":
                return self._json(noticias.buscar(q.get("forcar", ["0"])[0] == "1"))
            if url.path == "/api/base":
                with historico._TRAVA:
                    est = dict(historico.ESTADO)
                est["dias"] = {c: historico.dias_na_base(BASE, c) for c in list(historico.DUKAS) + list(historico.BINANCE)}
                est["meta"] = historico.DIAS_BASE
                return self._json(est)
            if url.path == "/api/comparar":
                with CMP_LOCK:
                    return self._json(dict(CMP))
            if url.path == "/api/estado":
                nome = q.get("nome", [""])[0]
                if not NOME_OK.match(nome):
                    return self._json(dict(erro="nome inválido"), 400)
                arq = os.path.join(df.pasta_dados(BASE), "estado_%s.json" % nome)
                if not os.path.exists(arq):
                    return self._json(dict(valor=None))
                with open(arq, encoding="utf-8") as f:
                    return self._json(dict(valor=json.load(f)))
            caminho = "index.html" if url.path in ("/", "") else url.path.lstrip("/")
            arq = os.path.normpath(os.path.join(WEB, caminho))
            if not arq.startswith(os.path.normpath(WEB)) or not os.path.isfile(arq):
                self.send_error(404)
                return
            tipo = mimetypes.guess_type(arq)[0] or "application/octet-stream"
            if arq.endswith(".js"):
                tipo = "text/javascript"
            with open(arq, "rb") as f:
                dados = f.read()
            self.send_response(200)
            self.send_header("Content-Type", tipo + ("; charset=utf-8" if tipo.startswith("text") else ""))
            self.send_header("Content-Length", str(len(dados)))
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            self.wfile.write(dados)
        except (ValueError, RuntimeError) as e:
            self._json(dict(erro=str(e)), 400)
        except Exception as e:
            traceback.print_exc()
            self._json(dict(erro="%s: %s" % (type(e).__name__, e)), 500)


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


def main():
    args = sys.argv[1:]
    porta = int(args[args.index("--porta") + 1]) if "--porta" in args else 8765
    porta = porta_livre(porta)
    srv = ThreadingHTTPServer(("127.0.0.1", porta), Handler)
    url = "http://127.0.0.1:%d/" % porta
    print("=" * 66)
    print(" ROBO KELLER - informativo e simulador (nao envia ordens a corretora)")
    print(" Tela: %s" % url)
    print(" Dados e desenhos: %s" % df.pasta_dados(BASE))
    print(" Feche esta janela para encerrar o robo.")
    print("=" * 66)
    if "--sem-janela" not in args:
        threading.Timer(0.8, abrir_janela, args=(url,)).start()
    if "--sem-base" not in args:
        # completa a base de 5 meses (so baixa o que falta; a Dukascopy e lenta, entao vai em segundo plano)
        threading.Thread(target=historico.trabalho, args=(BASE,), daemon=True).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
