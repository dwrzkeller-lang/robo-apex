# -*- coding: utf-8 -*-
"""
ROBO APEX - ponte com o Profit (Nelogica). ESTRUTURA PRONTA, AINDA SEM A DLL.

O Profit so entrega cotacao em tempo real e recebe ordens de fora por um componente pago a parte, a ProfitDLL
(arquivo ProfitDLL64.dll + chave de ativacao da Nelogica). Sem ela nao existe conexao: nem este robo nem nenhum outro
programa consegue "ler" o Profit. Este modulo deixa pronto o que NAO depende da DLL:

  1. onde o arquivo e a chave devem ficar e como o robo descobre que eles chegaram (`estado`);
  2. o formato unico de cotacao e de ordem que o resto do robo vai usar (`Ordem`, `Roteador`);
  3. o roteador em modo SIMULADOR: toda ordem e so registrada em dados/profit_ordens.jsonl, nada vai para a corretora.

O que falta fazer quando a DLL existir (nao da para escrever as chamadas sem ela para testar: um parametro errado numa
DLL derruba o programa): carregar com ctypes.WinDLL, chamar a inicializacao com a chave/usuario/senha, registrar os
retornos de negocio e de livro, e trocar `Roteador.enviar` para a rota de simulacao da propria corretora. A regra do
projeto continua: primeiro so conta de simulacao; ordem em conta real so com decisao explicita do dono e com os limites
de perda do dia obrigatorios.
"""
import json
import os
import threading
import time

NOME_DLL = "ProfitDLL64.dll"
MODOS = ("simulador",)                     # "real" so entra quando a ponte existir e for testada em conta de simulacao
_trava = threading.Lock()


def pasta(base_dados):
    """Pasta onde a DLL e a configuracao ficam: <dados>/profit."""
    p = os.path.join(base_dados, "profit")
    os.makedirs(p, exist_ok=True)
    return p


def estado(base_dados):
    """O que ja existe para a conexao. A tela mostra isto em Ajustes."""
    p = pasta(base_dados)
    dll = os.path.isfile(os.path.join(p, NOME_DLL))
    cfg = _ler(os.path.join(p, "config.json"))
    chave = bool(cfg.get("chave"))
    if dll and chave:
        situacao, falta = "pronta para ligar", "A DLL e a chave foram encontradas. A ligacao com o Profit ainda precisa ser ativada e testada em conta de simulacao."
    elif dll:
        situacao, falta = "falta a chave", "Achei a %s, mas falta a chave de ativacao da Nelogica (Conta > Profit)." % NOME_DLL
    else:
        situacao, falta = "sem a ProfitDLL", ("O Profit so conversa com outros programas pela ProfitDLL, vendida a parte pela Nelogica. "
                                              "Quando tiver, coloque o arquivo %s na pasta abaixo." % NOME_DLL)
    return dict(dll=dll, chave=chave, modo="simulador", situacao=situacao, falta=falta, pasta=p,
                ordens=len(ordens(base_dados, 500)))


def _ler(arq):
    try:
        with open(arq, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


class Ordem(dict):
    """Ordem no formato do robo: ativo, lado (+1 compra, -1 venda), tipo ("stop", "limite", "mercado"), preco, stop,
    alvo, quantidade, origem (estrategia e teste que gerou)."""

    def __init__(self, ativo, lado, tipo, preco, stop, alvo, quantidade, origem=""):
        if lado not in (1, -1) or tipo not in ("stop", "limite", "mercado") or not quantidade or quantidade <= 0:
            raise ValueError("ordem invalida")
        super().__init__(ativo=str(ativo), lado=lado, tipo=tipo, preco=preco, stop=stop, alvo=alvo,
                         quantidade=quantidade, origem=str(origem)[:120])


class Roteador:
    """Para onde as ordens vao. Hoje: so o registro de simulacao."""

    def __init__(self, base_dados):
        self.arq = os.path.join(pasta(base_dados), "..", "profit_ordens.jsonl")
        self.modo = "simulador"

    def enviar(self, ordem):
        if self.modo != "simulador":
            raise RuntimeError("Envio para a corretora ainda nao existe: so o modo simulador esta ativo.")
        linha = dict(ordem, quando=round(time.time(), 1), modo=self.modo, situacao="registrada (simulador)")
        with _trava:
            with open(self.arq, "a", encoding="utf-8") as f:
                f.write(json.dumps(linha, ensure_ascii=False) + "\n")
        return linha


def ordens(base_dados, n=100):
    arq = os.path.join(base_dados, "profit_ordens.jsonl")
    try:
        with open(arq, encoding="utf-8") as f:
            return [json.loads(x) for x in f.readlines()[-n:] if x.strip()]
    except (OSError, ValueError):
        return []
