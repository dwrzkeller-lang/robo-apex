"""Preco AO VIVO de ouro e prata (a vista) pela Swissquote (cotacao publica, segundos de atraso, sem cadastro).

O Yahoo so tem ouro e prata pelo contrato FUTURO (GC=F e SI=F), com uns 10 minutos de atraso e um preco acima do
"a vista" que o TradingView mostra (XAU/USD). Aqui:
  1. Enquanto o ativo e usado (grafico, teste ao vivo, boleta), uma linha de fundo pede a cotacao a cada 2 s.
  2. O historico de candles continua vindo da fonte de sempre, mas fica no MESMO NIVEL do a vista (a diferenca entre o
     futuro e o a vista e medida e descontada).
  3. Do momento em que a coleta comecou em diante, os candles sao feitos com as cotacoes ao vivo (abertura, maxima,
     minima, fechamento). Nada e inventado: antes disso valem os candles da fonte de historico; se ainda faltar algum
     candle (a fonte atrasada nao chegou la), ele fica em branco ate a fonte entregar.
"""
import json
import threading
import time
import urllib.request
from collections import deque
from datetime import datetime, timezone

SWISS = {"XAUUSD": "XAU/USD", "PRATA": "XAG/USD"}
URL = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/%s"
PASSO = 1.0                 # segundos entre cotacoes
OCIOSO = 30 * 60.0          # para de pedir 30 min depois do ultimo uso


class _Fluxo:
    def __init__(self, inst):
        self.inst = inst
        self.ticks = deque(maxlen=30000)          # (t_utc, preco medio)
        self.usado = 0.0
        self.trava = threading.Lock()
        self.rodando = False
        self.erro = None

    def _pedir(self):
        req = urllib.request.Request(URL % self.inst, headers={"User-Agent": "Mozilla/5.0"})
        with urllib.request.urlopen(req, timeout=8) as r:
            js = json.loads(r.read().decode("utf-8"))
        melhor = None
        for x in js if isinstance(js, list) else []:
            for p in x.get("spreadProfilePrices") or []:
                bid, ask = p.get("bid"), p.get("ask")
                if bid and ask and ask >= bid:
                    if melhor is None or (ask - bid) < melhor[2]:
                        melhor = (x.get("ts", 0) / 1000.0, (bid + ask) / 2.0, ask - bid)
        if not melhor:
            raise RuntimeError("cotacao vazia")
        t, mid, _ = melhor
        with self.trava:
            if not self.ticks or t > self.ticks[-1][0]:
                self.ticks.append((t, mid))

    def _laco(self):
        while time.time() - self.usado < OCIOSO:
            try:
                self._pedir()
                self.erro = None
            except Exception as e:                      # internet fora: tenta de novo no proximo passo
                self.erro = str(e)
            time.sleep(PASSO)
        self.rodando = False

    def usar(self):
        self.usado = time.time()
        if not self.rodando:
            self.rodando = True
            if not self.ticks:
                try:
                    self._pedir()                       # primeira cotacao na hora (o grafico ja sai com o preco de agora)
                except Exception as e:
                    self.erro = str(e)
            threading.Thread(target=self._laco, daemon=True, name="aovivo-" + self.inst).start()
        with self.trava:
            return list(self.ticks)


_fluxos = {}
_trava = threading.Lock()


def fluxo(chave):
    with _trava:
        f = _fluxos.get(chave)
        if f is None:
            f = _fluxos[chave] = _Fluxo(SWISS[chave])
    return f


def ultimo(chave):
    """(t_utc, preco) da cotacao mais nova, ou None."""
    if chave not in SWISS:
        return None
    t = fluxo(chave).usar()
    return t[-1] if t else None


def misturar(chave, B, cfg, offset_horas, add, vazias):
    """Candles de B (historico) no nivel do a vista + os candles feitos com as cotacoes ao vivo. Devolve candles novos
    (B nao e alterado) ou B mesmo se nao houver cotacao. offset_horas(fuso, t) e add/vazias vem de dados_fonte."""
    ticks = fluxo(chave).usar()
    if not ticks or not B["t"]:
        return B
    tf = B.get("tf", 5)
    if tf >= 1440:
        return B
    off = lambda t: t + 3600 * offset_horas(cfg.get("fuso", "BRT"), t)       # noqa: E731  (horario local "vestido" de UTC)
    s0 = cfg["sessao"][0] // 100 * 60 + cfg["sessao"][0] % 100
    inicio = lambda tl: int(tl // 60 - ((int(tl // 60) - s0) % tf)) * 60      # noqa: E731  (inicio do candle em segundos)
    # diferenca futuro - a vista: medida no ultimo candle FECHADO do historico (fica parada ate fechar outro candle)
    f = fluxo(chave)
    ref = len(B["t"]) - 2 if len(B["t"]) >= 2 else len(B["t"]) - 1
    chave_base = (B["t"][ref], round(B["c"][ref], 6))
    if getattr(f, "base_ref", None) != chave_base:
        t_fim = B["t"][ref] + tf * 60
        alvo_utc = t_fim - 3600 * offset_horas(cfg.get("fuso", "BRT"), t_fim)
        perto = min(ticks, key=lambda x: abs(x[0] - alvo_utc))
        base = B["c"][ref] - perto[1]
        # historico ja no nivel do a vista (diferenca pequena) ou algo estranho (diferenca enorme): nao desloca
        if abs(base) < 0.0015 * perto[1] or abs(base) > 0.05 * perto[1]:
            base = 0.0
        f.base_ref, f.base = chave_base, base
    base = f.base
    # candles ao vivo: um por periodo, com abertura, maxima, minima e fechamento das cotacoes
    vivos = {}
    for t, p in ticks:
        k = inicio(off(t))
        v = vivos.get(k)
        if v is None:
            vivos[k] = [p, p, p, p]
        else:
            v[1] = max(v[1], p); v[2] = min(v[2], p); v[3] = p
    if not vivos:
        return B
    k0 = min(vivos)
    out = vazias(tf)
    hist = {}
    for i in range(len(B["t"])):
        if B["t"][i] >= k0:
            hist[B["t"][i]] = i
            continue
        dt = datetime.fromtimestamp(B["t"][i], timezone.utc).replace(tzinfo=None)
        add(out, dt, B["o"][i] - base, B["h"][i] - base, B["l"][i] - base, B["c"][i] - base, B["v"][i])
    for k in sorted(set(vivos) | set(hist)):
        if k in vivos:
            o, h, l, c = vivos[k]
            v = 0
            if k in hist:                               # o historico tem o comeco deste candle: abertura e extremos dele valem
                i = hist[k]
                o = B["o"][i] - base
                h, l = max(h, B["h"][i] - base), min(l, B["l"][i] - base)
                v = B["v"][i]
        else:                                           # sem cotacao ao vivo neste candle (internet caiu): fica o historico
            i = hist[k]
            o, h, l, c, v = B["o"][i] - base, B["h"][i] - base, B["l"][i] - base, B["c"][i] - base, B["v"][i]
        dt = datetime.fromtimestamp(k, timezone.utc).replace(tzinfo=None)
        add(out, dt, o, h, l, c, v)
    return out
