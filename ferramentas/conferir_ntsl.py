# -*- coding: utf-8 -*-
"""
Confere os scripts NTSL sem o Profit: um interpretador do pedaco de NTSL que o gerador usa
(Pascal: begin/end, if/then/else, for/to/do, series x[k], precedencia do Pascal) roda cada .ntsl
sobre os mesmos candles do Yahoo e compara as ORDENS e as OPERACOES com o simulador em Python.

Uso: python ferramentas/conferir_ntsl.py [WIN] [5]
"""
import math
import os
import re
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.normpath(os.path.join(AQUI, ".."))
sys.path.insert(0, os.path.join(RAIZ, "app"))
import dados_fonte as df                      # noqa: E402
from estrategias import sma, vwap_dia         # noqa: E402
from simulador import preparar, simular       # noqa: E402

TOK = re.compile(r'\s*(?:(//[^\n]*)|("[^"]*")|(\d+\.\d+|\d+)|([A-Za-z_]\w*)|(:=|<=|>=|<>|[-+*/()\[\];,:=<>]))')
REL = {"=": "==", "<>": "!=", "<": "<", ">": ">", "<=": "<=", ">=": ">="}


def tokens(txt):
    out, pos = [], 0
    while pos < len(txt):
        m = TOK.match(txt, pos)
        if not m or m.end() == pos:
            if txt[pos:].strip() == "":
                break
            raise SyntaxError("caractere inesperado: %r" % txt[pos:pos + 20])
        pos = m.end()
        if m.group(1):
            continue
        out.append(next(g for g in m.groups()[1:] if g is not None))
    return out


class Compilador:
    def __init__(self, toks, entradas, variaveis):
        self.t, self.k = toks, 0
        self.ent, self.var = entradas, variaveis

    def ver(self):
        return self.t[self.k] if self.k < len(self.t) else None

    def pega(self, esperado=None):
        tk = self.t[self.k]
        if esperado and tk.lower() != esperado:
            raise SyntaxError("esperava %r e veio %r perto de %s" % (esperado, tk, " ".join(self.t[self.k - 5:self.k + 5])))
        self.k += 1
        return tk

    # ---------------- expressoes (precedencia do Pascal: not > * / and > + - or > relacionais)
    def expr(self):
        a = self.simples()
        if self.ver() in REL:
            op = REL[self.pega()]
            b = self.simples()
            return "(%s %s %s)" % (a, op, b)
        return a

    def simples(self):
        if self.ver() in ("+", "-"):
            s = self.pega()
            a = "(%s%s)" % (s, self.termo())
        else:
            a = self.termo()
        while self.ver() in ("+", "-") or (self.ver() or "").lower() == "or":
            op = self.pega().lower()
            b = self.termo()
            a = "(%s %s %s)" % (a, op, b)
        return a

    def termo(self):
        a = self.fator()
        while self.ver() in ("*", "/") or (self.ver() or "").lower() == "and":
            op = self.pega().lower()
            b = self.fator()
            a = "(%s %s %s)" % (a, op, b)
        return a

    def fator(self):
        tk = self.pega()
        low = tk.lower()
        if tk == "(":
            e = self.expr()
            self.pega(")")
            return "(%s)" % e
        if low == "not":
            return "(not %s)" % self.fator()
        if low in ("true", "false"):
            return "True" if low == "true" else "False"
        if re.match(r"^\d", tk):
            return tk
        if tk.startswith('"'):
            return tk
        if self.ver() == "(":                  # funcao
            self.pega("(")
            args = []
            if self.ver() != ")":
                args.append(self.expr())
                while self.ver() == ",":
                    self.pega(",")
                    args.append(self.expr())
            self.pega(")")
            return "F_%s(%s)" % (tk, ", ".join(args))
        idx = "0"
        if self.ver() == "[":
            self.pega("[")
            idx = self.expr()
            self.pega("]")
        if tk in self.ent:
            return "IN[%r]" % tk
        if tk in self.var:
            return "S[%r][t - (%s)]" % (tk, idx)
        if tk in ("Open", "High", "Low", "Close", "Date", "Time"):
            return "B[%r][t - (%s)]" % (tk, idx)
        if tk == "CurrentBar":
            return "t"
        if tk == "BarDuration":
            return "TF"
        if tk.startswith("cl"):
            return repr(tk)
        raise SyntaxError("nome desconhecido: " + tk)

    # ---------------- comandos
    def comando(self, ind):
        p = " " * ind
        tk = (self.ver() or "").lower()
        if tk == "begin":
            self.pega()
            linhas = []
            while (self.ver() or "").lower() != "end":
                linhas.append(self.comando(ind))
                if self.ver() == ";":
                    self.pega()
            self.pega("end")
            return "\n".join(linhas) if linhas else p + "pass"
        if tk == "if":
            self.pega()
            c = self.expr()
            self.pega("then")
            s1 = self.comando(ind + 1)
            out = "%sif %s:\n%s" % (p, c, s1)
            if (self.ver() or "").lower() == "else":
                self.pega()
                out += "\n%selse:\n%s" % (p, self.comando(ind + 1))
            return out
        if tk == "for":
            self.pega()
            v = self.pega()
            self.pega(":=")
            a = self.expr()
            self.pega("to")
            b = self.expr()
            self.pega("do")
            corpo = self.comando(ind + 1)
            return "%sfor _x in range(int(%s), int(%s) + 1):\n%s S[%r][t] = _x\n%s" % (p, a, b, p, v, corpo)
        nome = self.pega()
        if self.ver() == ":=":
            self.pega()
            if nome not in self.var:
                raise SyntaxError("atribuicao a nome nao declarado: " + nome)
            return "%sS[%r][t] = %s" % (p, nome, self.expr())
        if self.ver() == "(":
            self.k -= 1
            return p + self.fator()
        return p + "F_%s()" % nome


def carregar_ntsl(caminho):
    txt = open(caminho, encoding="utf-8").read()
    toks = tokens(txt)
    k = 0
    entradas, variaveis = {}, {}
    assert toks[k].lower() == "input"
    k += 1
    while toks[k].lower() != "var":
        nome = toks[k]; assert toks[k + 1] == "("
        sinal = -1 if toks[k + 2] == "-" else 1
        j = k + 3 if sinal < 0 else k + 2
        entradas[nome] = sinal * float(toks[j]); assert toks[j + 1] == ")" and toks[j + 2] == ";"
        k = j + 3
    k += 1
    while toks[k].lower() != "begin":
        variaveis[toks[k]] = toks[k + 2]; assert toks[k + 1] == ":" and toks[k + 3] == ";"
        k += 4
    c = Compilador(toks[k:], entradas, variaveis)
    corpo = c.comando(1)
    assert c.k == len(c.t) - 1 and c.t[-1] == ";", "sobrou texto depois do end final"
    return entradas, variaveis, "def passo(t):\n" + corpo + "\n"


def rodar(caminho, B, tf, entradas_extra):
    entradas, variaveis, fonte = carregar_ntsl(caminho)
    entradas.update(entradas_extra)
    n = len(B["c"])
    S = {v: [0.0] * n for v in variaveis}
    for v, tipo in variaveis.items():
        if tipo == "Boolean":
            S[v] = [False] * n
    medias = {}
    textos = []
    vw = vwap_dia(B["h"], B["l"], B["c"], B["v"], B["d"])

    def F_Media(p, serie_valor):
        p = int(p)
        if p not in medias:
            m = sma(B["c"], p)
            medias[p] = [x if x is not None else B["c"][i] for i, x in enumerate(m)]
        return medias[p][T[0]]

    T = [0]
    amb = dict(S=S, IN=entradas, TF=tf, B={"Open": B["o"], "High": B["h"], "Low": B["l"], "Close": B["c"], "Date": B["d"], "Time": B["hm"]},
               F_Media=F_Media, F_VWAP=lambda x: vw[T[0]], F_Floor=math.floor,
               F_PlotText=lambda txt, *a: textos.append((T[0], txt)), F_Alert=lambda *a: None,
               F_Plot=lambda *a: None, F_Plot2=lambda *a: None, F_Plot3=lambda *a: None, F_NoPlot=lambda *a: None,
               F_SetPlotColor=lambda *a: None)
    exec(compile(fonte, caminho, "exec"), amb)
    passo = amb["passo"]
    ordens, saidas = [], []
    for t in range(n):
        T[0] = t
        if t:
            for v in S:
                S[v][t] = S[v][t - 1]
        est_antes = S["vEst"][t]
        passo(t)
        if S["vEst"][t] == 1 and S["vBarSinal"][t] == t - 1 and (est_antes != 1 or S["vBarSinal"][t - 1] != t - 1):
            ordens.append((t - 1, int(S["vDir"][t]), round(S["vGat"][t], 6), round(S["vStp"][t], 6)))
        for (tt, txt) in textos:
            if tt == t and not txt.startswith(("COMPRA", "VENDA")):
                saidas.append((t - 1, round(S["vRes"][t], 6)))
        textos.clear()
    return ordens, saidas


def conferir(chave="WIN", tf=5):
    cfg = df.ATIVOS[chave]
    B, _ = df.carregar(RAIZ, chave, tf)
    sc = df.sessao_cfg(cfg)
    Gs = preparar(B, sc)
    extra = dict(Tick=sc["tick"], Slip=sc["slip"], CustoPts=2 * sc["custo"] / sc["valor_ponto"], MaxStopsDia=2,
                 Intraday=1 if tf < 1440 else 0, HoraInicio=sc["hora_inicio"], HoraFimEntradas=sc["hora_fim"],
                 HoraZeragem=sc["hora_zeragem"])
    pasta = os.path.join(RAIZ, "ntsl")
    tudo_ok = True
    for arq in sorted(os.listdir(pasta)):
        cod = arq[:2]
        ex = dict(extra, FracParcial=0.5 if sc["fracionado"] else 0.0, GapReal=1 if B.get("gap_real") else 0)
        if cod in ("E7", "E8"):
            ex["HoraInicio"] = 0                   # ORB e gap usam o candle de abertura
        ordens_n, saidas_n = rodar(os.path.join(pasta, arq), B, tf, ex)
        r = simular(Gs, sc, [cod], gestao="padrao", contratos=1, max_stops=2)
        ini, n = 240, len(B["c"])
        ordens_p = [(o["i_sinal"], o["dir"], round(o["gatilho"] if o["gatilho"] is not None else B["c"][o["i_sinal"]], 6), round(o["stop"], 6))
                    for o in r["ordens"] if ini <= o["i_sinal"] < n - 1]      # o ultimo candle ainda esta "se formando" no NTSL
        ordens_n = [o for o in ordens_n if o[0] >= ini]
        saidas_p = [(t["i_sai"], round(t["pts"], 6)) for t in r["trades"] if t["i_sinal"] >= ini and t["i_sai"] < n - 1]
        prim = min([o[0] for o in ordens_n] + [10 ** 9])
        saidas_n = [s for s in saidas_n if s[0] >= prim]
        ok = ordens_n == ordens_p and saidas_n == saidas_p
        tudo_ok &= ok
        print("%-26s ordens NTSL %4d / Python %4d | operacoes NTSL %4d / Python %4d  %s"
              % (arq, len(ordens_n), len(ordens_p), len(saidas_n), len(saidas_p), "IGUAIS" if ok else "DIFERENTES"))
        if not ok:
            for a, b in zip(ordens_n, ordens_p):
                if a != b:
                    print("   1a ordem diferente: NTSL", a, "| Python", b)
                    break
            for a, b in zip(saidas_n, saidas_p):
                if a != b:
                    print("   1a saida diferente: NTSL", a, "| Python", b)
                    break
    return tudo_ok


if __name__ == "__main__":
    a = sys.argv[1] if len(sys.argv) > 1 else "WIN"
    tf = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    sys.exit(0 if conferir(a, tf) else 1)
