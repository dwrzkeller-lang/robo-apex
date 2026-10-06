# -*- coding: utf-8 -*-
"""
ROBO APEX - avisos fora da tela (opcional): mensagem no Telegram quando um teste ao vivo arma uma ordem, entra ou sai.

O usuario cria o proprio robo no Telegram (conversa com @BotFather) e cola aqui o codigo dele e o numero da conversa.
O codigo fica so na pasta de dados deste computador e so e usado para falar com api.telegram.org. Sem configurar,
nada e enviado para lugar nenhum.
"""
import json
import queue
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.telegram.org"
TOKEN_OK = re.compile(r"^\d{6,12}:[A-Za-z0-9_\-]{30,60}$")
CHAT_OK = re.compile(r"^(-?\d{4,16}|@[A-Za-z0-9_]{4,40})$")
POR_MINUTO = 20                    # no maximo 20 mensagens por minuto por usuario (uma enxurrada nao bloqueia o robo dele)
TIPOS = ("ordem", "entrada", "saida")


def config_valida(cfg):
    """Normaliza o que veio da tela. Devolve dict(telegram=dict(ligado, token, chat), tipos=dict(...))."""
    tg = (cfg or {}).get("telegram") or {}
    tipos = (cfg or {}).get("tipos") or {}
    return dict(telegram=dict(ligado=bool(tg.get("ligado")), token=str(tg.get("token") or "").strip(), chat=str(tg.get("chat") or "").strip()),
                tipos={k: bool(tipos.get(k, True)) for k in TIPOS})


def erro_de_config(cfg):
    tg = cfg["telegram"]
    if not tg["token"] and not tg["chat"] and not tg["ligado"]:
        return None
    if not TOKEN_OK.match(tg["token"]):
        return "O código do robô do Telegram não parece certo (ele tem o formato 123456789:AA...)."
    if not CHAT_OK.match(tg["chat"]):
        return "O número da conversa (chat id) é só de números, ou @nome_do_canal."
    return None


def publico(cfg):
    """A configuracao sem o codigo (a tela so recebe os 4 ultimos caracteres, para o usuario reconhecer)."""
    tg = cfg["telegram"]
    return dict(telegram=dict(ligado=tg["ligado"], chat=tg["chat"], temToken=bool(tg["token"]), fim=tg["token"][-4:] if tg["token"] else ""),
                tipos=dict(cfg["tipos"]))


def enviar_telegram(token, chat, texto, timeout=8):
    """Devolve None se a mensagem foi aceita, ou o motivo da falha (nunca com o codigo dentro)."""
    if not TOKEN_OK.match(token or "") or not CHAT_OK.match(str(chat or "")):
        return "código ou conversa inválidos"
    dados = urllib.parse.urlencode(dict(chat_id=chat, text=texto[:3500], disable_web_page_preview="true")).encode("utf-8")
    try:
        req = urllib.request.Request("%s/bot%s/sendMessage" % (API, token), data=dados)
        with urllib.request.urlopen(req, timeout=timeout) as r:
            js = json.loads(r.read().decode("utf-8"))
        return None if js.get("ok") else str(js.get("description") or "recusado pelo Telegram")[:200]
    except urllib.error.HTTPError as e:
        try:
            desc = json.loads(e.read().decode("utf-8")).get("description")
        except Exception:
            desc = None
        dica = {401: "código do robô recusado", 400: "conversa não encontrada (mande um oi para o seu robô antes)", 403: "o robô foi bloqueado nessa conversa"}.get(e.code)
        return "Telegram respondeu %d: %s" % (e.code, dica or str(desc or "")[:120])
    except Exception as e:
        return "sem resposta do Telegram (%s)" % type(e).__name__


def texto_evento(ev):
    """Mensagem curta de um evento de teste ao vivo."""
    f = lambda v: ("%.*f" % (ev.get("dec", 2), v)).replace(".", ",") if v is not None else "—"     # noqa: E731
    lado = "COMPRA" if ev.get("dir", 1) > 0 else "VENDA"
    cab = "ROBÔ APEX · %s · %s · %s" % (ev.get("nome") or ev.get("ativo"), ev.get("nomeTf", ""), ev.get("est", ""))
    if ev["tipo"] == "ordem":
        modo = {"stop": "acima de " if ev.get("dir", 1) > 0 else "abaixo de ", "limite": "limitada em "}.get(ev.get("ordem"), "")
        l1 = "%s ARMADA %s%s" % (lado, modo, f(ev.get("gatilho")) if ev.get("gatilho") is not None else "(a mercado no próximo candle)")
        l2 = "Stop %s%s" % (f(ev.get("stop")), (" · Alvo %s" % f(ev["alvo"])) if ev.get("alvo") is not None else "")
    elif ev["tipo"] == "entrada":
        l1 = "%s EXECUTADA a %s" % (lado, f(ev.get("ent")))
        l2 = "Stop %s%s" % (f(ev.get("stop")), (" · Alvo %s" % f(ev["alvo"])) if ev.get("alvo") is not None else "")
    else:
        r = ev.get("R") or 0.0
        l1 = "SAÍDA (%s): %s%sR" % (ev.get("motivo", ""), "+" if r > 0 else "", ("%.2f" % r).replace(".", ","))
        l2 = "Resultado: %s %s" % (ev.get("moeda", "R$"), ("%+.2f" % (ev.get("dinheiro") or 0.0)).replace(".", ","))
    ia = ev.get("ia")
    l3 = ("IA: %d%% de chance de ganho%s\n" % (round(100 * ia[0]), "" if ev.get("iaOk") else " (ainda sem comprovação)")) if ia and ev["tipo"] != "saida" else ""
    return "%s\n%s\n%s\n%sTeste simulado · informativo, não é recomendação." % (cab, l1, l2, l3)


class Carteiro:
    """Fila de envio (uma mensagem por vez, fora das threads do robo) com limite por usuario."""

    def __init__(self):
        self.fila = queue.Queue(maxsize=500)
        self.horas = {}                       # usuario -> horarios dos ultimos envios
        self.erro = {}                        # usuario -> (quando, texto) do ultimo problema
        self.enviadas = 0
        threading.Thread(target=self._laco, daemon=True, name="avisos").start()

    def postar(self, uid, cfg, texto):
        tg = cfg["telegram"]
        if not (tg["ligado"] and tg["token"] and tg["chat"]):
            return False
        agora = time.time()
        h = [t for t in self.horas.get(uid, []) if agora - t < 60]
        if len(h) >= POR_MINUTO:
            self.erro[uid] = (agora, "muitos avisos em 1 minuto: alguns não foram enviados")
            return False
        h.append(agora)
        self.horas[uid] = h
        try:
            self.fila.put_nowait((uid, tg["token"], tg["chat"], texto))
            return True
        except queue.Full:
            return False

    def _laco(self):
        while True:
            uid, token, chat, texto = self.fila.get()
            e = enviar_telegram(token, chat, texto)
            if e:
                self.erro[uid] = (time.time(), e)
            else:
                self.enviadas += 1
                self.erro.pop(uid, None)
            time.sleep(0.4)
