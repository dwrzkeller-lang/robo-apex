# -*- coding: utf-8 -*-
"""
Gera os indicadores NTSL (Profit) das 6 estrategias do ROBO APEX, com as MESMAS regras de
app/estrategias.py e a mesma execucao de app/simulador.py (ordem stop com escorregamento, validade,
cancelamento no stop, alvo so passando 1 tick, stop antes do alvo, zeragem, N stops no dia).

Convencao: o robo decide uma vez por candle, no candle FECHADO. No NTSL o candle fechado e o [1]:
  Python G.h[i]   ->  NTSL vCH[1]        Python G.h[i-k] ->  NTSL vCH[1+k]
Compra usa as series vC* (preco normal); venda usa as series vV* (preco invertido: -minima, -maxima...).
O mesmo bloco de regra e escrito uma vez com {P} e vira compra (C) e venda (V).

No Profit o indicador mostra a ordem armada (entrada, stop, alvo) e a operacao em andamento.
Parcial e conducao ficam so no programa (aqui: alvo fixo em R, ou a saida propria do RSI-2).

Uso: python ferramentas/gerar_ntsl.py   (grava em ntsl/)
"""
import os
import re

RAIZ = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
SAIDA = os.path.join(RAIZ, "ntsl")
if os.name == "nt" and len(SAIDA) > 180:
    SAIDA = "\\\\?\\" + SAIDA        # pasta muito funda: caminho longo do Windows


def ind(txt, n):
    """Indenta um bloco em n espacos."""
    return "\n".join((" " * n + x) if x.strip() else x for x in txt.strip("\n").split("\n"))


# ------------------------------------------------------------------------------------------ blocos comuns
def topo(janela):
    # Python _topo(G, i, janela): maior maxima de i-janela ate i-1 (a mais recente se empatar)
    return """vJ := 1 + %d;
for vK := 0 to %d do
begin
  vM := %d - vK;
  if v{P}H[vM] >= v{P}H[vJ] then vJ := vM;
end;
vNpb := vJ - 2;""" % (janela, janela - 1, janela + 1)


ORDEM_STOP = """v{P}Gat := -Floor(-((v{P}H[1] + Tick) / Tick - 0.0000001)) * Tick;
v{P}Stp := Floor((vLo - Tick) / Tick + 0.0000001) * Tick;
vX := v{P}Gat - v{P}Stp;
if (vX > 0) and (vX >= 0.3 * vA) and (vX <= 2.5 * vA) then
begin
  v{P}Ok := true;
  v{P}Tipo := 0;
  v{P}Val := 2;
end;"""

MIN_PB = """vLo := v{P}L[1];
for vK := 1 to vJ - 1 do
  if v{P}L[vK] < vLo then vLo := v{P}L[vK];"""

# ------------------------------------------------------------------------------------------ as 6 regras
REGRAS = {}

REGRAS["E1"] = dict(nome="E1 HALT MM20", titulo="E1 - Halt na MM20 (Mario Pisani + Oliver Velez)", alvo=2.0, codigo="""
v{P}Ok := false;
if (v{P}M20[1] - v{P}M20[6] >= 0.2 * vA) and (v{P}C[1] > v{P}M200[1]) then
begin
""" + ind(topo(12), 2) + """
  if (vNpb >= 1) and (vNpb <= 8) and (v{P}H[vJ] >= v{P}M20[vJ] + 0.5 * vA) then
  begin
    vToque := false;
    vFora := false;
    for vK := 1 to vJ - 1 do
    begin
      if v{P}L[vK] <= v{P}M20[vK] + 0.15 * vA then vToque := true;
      if v{P}C[vK] < v{P}M20[vK] - 0.05 * vA then vFora := true;
    end;
    for vK := 2 to vJ - 1 do
      if (v{P}C[vK] < v{P}O[vK]) and (v{P}H[vK] - v{P}L[vK] >= 2.0 * vATR[vK]) then vFora := true;
    vSinal := (v{P}C[1] > v{P}O[1]) and (v{P}C[1] >= (v{P}H[1] + v{P}L[1]) / 2) and (v{P}C[1] > v{P}M20[1]);
    if (vNpb = 1) and (v{P}C[1] <= v{P}H[2]) then vSinal := false;
    if vToque and (not vFora) and vSinal then
    begin
""" + ind(MIN_PB, 6) + "\n" + ind(ORDEM_STOP, 6) + """
    end;
  end;
end;
""")

REGRAS["E2"] = dict(nome="E2 FIBONACCI", titulo="E2 - Gatilho de Fibonacci (Mario Pisani)", alvo=2.0, codigo="""
v{P}Ok := false;
if (v{P}M20[1] > v{P}M20[6]) and (v{P}C[1] > v{P}M200[1]) then
begin
""" + ind(topo(15), 2) + """
  if (vNpb >= 1) and (vNpb <= 12) then
  begin
    vM := vJ + 1;
    for vK := 0 to 29 do
    begin
      vM2 := vJ + 30 - vK;
      if v{P}L[vM2] <= v{P}L[vM] then vM := vM2;
    end;
    vPerna := v{P}H[vJ] - v{P}L[vM];
    if (vPerna >= 2.0 * vA) and (vM - vJ >= 2) then
    begin
""" + ind(MIN_PB, 6) + """
      vRet := (v{P}H[vJ] - vLo) / vPerna;
      vX := v{P}H[vJ] - 0.618 * vPerna;
      vSinal := (v{P}C[1] > v{P}O[1]) and (v{P}C[1] >= (v{P}H[1] + v{P}L[1]) / 2) and (v{P}C[1] > v{P}C[2]) and (v{P}C[1] > vX);
      if (vRet >= 0.35) and (vRet <= 0.66) and vSinal then
      begin
""" + ind(ORDEM_STOP, 8) + """
      end;
    end;
  end;
end;
""")

REGRAS["E3"] = dict(nome="E3 VWAP", titulo="E3 - Pullback na VWAP (Mario Pisani + Oliver Velez) - so intraday", alvo=2.0, codigo="""
v{P}Ok := false;
if (Intraday = 1) and (vNb >= vMinB) and (vNb >= 4) then
begin
  if (v{P}C[1] > v{P}VW[1]) and (v{P}VW[1] > v{P}VW[4]) then
  begin
    vAc := 0;
    vHi := v{P}H[1];
    for vK := 1 to vNb do
    begin
      if v{P}C[vK] > v{P}VW[vK] then vAc := vAc + 1;
      if v{P}H[vK] > vHi then vHi := v{P}H[vK];
    end;
    if (vAc >= 0.7 * vNb) and (vHi >= v{P}VW[1] + 1.0 * vA) then
    begin
      vToque := false;
      vFora := false;
      vLo := v{P}L[1];
      for vK := 1 to 3 do
      begin
        if v{P}L[vK] <= v{P}VW[vK] + 0.15 * vA then vToque := true;
        if v{P}C[vK] < v{P}VW[vK] - 0.05 * vA then vFora := true;
        if v{P}L[vK] < vLo then vLo := v{P}L[vK];
      end;
      vSinal := (v{P}C[1] > v{P}O[1]) and (v{P}C[1] >= (v{P}H[1] + v{P}L[1]) / 2);
      if vToque and (not vFora) and vSinal then
      begin
""" + ind(ORDEM_STOP, 8) + """
      end;
    end;
  end;
end;
""")

REGRAS["E4"] = dict(nome="E4 ROMPIMENTO", titulo="E4 - Rompimento de base (Oliver Velez - power breakout)", alvo=2.0, codigo="""
v{P}Ok := false;
if (v{P}M20[1] - v{P}M20[6] >= 0.2 * vA) and (v{P}C[1] > v{P}M200[1]) then
begin
  vHi := v{P}H[1];
  vLo := v{P}L[1];
  for vK := 1 to 4 do
  begin
    if v{P}H[vK] > vHi then vHi := v{P}H[vK];
    if v{P}L[vK] < vLo then vLo := v{P}L[vK];
  end;
  vX := v{P}H[1];
  for vK := 1 to 21 do
    if v{P}H[vK] > vX then vX := v{P}H[vK];
  if (vHi - vLo <= 1.2 * vA) and (vHi >= vX - 0.3 * vA) and (vLo >= v{P}M20[1] - 0.2 * vA) then
  begin
    v{P}Gat := -Floor(-((vHi + Tick) / Tick - 0.0000001)) * Tick;
    v{P}Stp := Floor((vLo - Tick) / Tick + 0.0000001) * Tick;
    vX := v{P}Gat - v{P}Stp;
    if (v{P}C[1] < v{P}Gat) and (vX > 0) and (vX >= 0.3 * vA) and (vX <= 2.5 * vA) then
    begin
      v{P}Ok := true;
      v{P}Tipo := 0;
      v{P}Val := 2;
    end;
  end;
end;
""")

REGRAS["E5"] = dict(nome="E5 COMBINACAO+GIFT", titulo="E5 - Combinacao perfeita + Gift na MM9 (Oliver Velez + Mario Pisani)", alvo=2.0, codigo="""
v{P}Ok := false;
if (v{P}M9[1] > v{P}M20[1]) and (v{P}M20[1] > v{P}M200[1]) and (v{P}M9[1] > v{P}M9[4]) and (v{P}M20[1] - v{P}M20[6] >= 0.3 * vA) then
begin
""" + ind(topo(6), 2) + """
  if (vNpb >= 1) and (vNpb <= 3) then
  begin
    vToque := false;
    vFora := false;
    for vK := 1 to vJ - 1 do
    begin
      if v{P}L[vK] <= v{P}M9[vK] + 0.1 * vA then vToque := true;
      if v{P}C[vK] < v{P}M20[vK] then vFora := true;
    end;
    vSinal := (v{P}C[1] > v{P}O[1]) and (v{P}C[1] > v{P}H[2]);
    if vToque and (not vFora) and vSinal then
    begin
""" + ind(MIN_PB, 6) + "\n" + ind(ORDEM_STOP, 6) + """
    end;
  end;
end;
""")

REGRAS["E6"] = dict(nome="E6 RSI-2", titulo="E6 - RSI(2) de Larry Connors (a mais testada nos foruns)", alvo=0.0, codigo="""
v{P}Ok := false;
if (v{P}C[1] > v{P}M200[1]) and (v{P}R[1] < 10) then
begin
  v{P}Gat := v{P}C[1];
  v{P}Stp := Floor((v{P}C[1] - 3.0 * vA) / Tick + 0.0000001) * Tick;
  v{P}Ok := true;
  v{P}Tipo := 1;
  v{P}Val := 1;
end;
""")


REGRAS["E7"] = dict(nome="E7 ORB", titulo="E7 - Rompimento do 1o candle (ORB) - Zarattini & Aziz (2023) - so intraday", alvo=10.0,
                    modo="R", hora_inicio=0, codigo="""
v{P}Ok := false;
if (Intraday = 1) and (Date[1] <> Date[2]) and (v{P}C[1] > v{P}O[1]) then
begin
  v{P}Stp := Floor((v{P}L[1] - Tick) / Tick + 0.0000001) * Tick;
  vX := v{P}C[1] - v{P}Stp;
  if (vX >= 0.1 * vA) and (vX <= 4.0 * vA) then
  begin
    v{P}Gat := v{P}C[1];
    v{P}Ok := true;
    v{P}Tipo := 1;
    v{P}Val := 1;
  end;
end;
""")

REGRAS["E8"] = dict(nome="E8 GAP", titulo="E8 - Fechamento de gap - so intraday e so em contrato com gap real (WIN/WDO do Profit)", alvo=0.0,
                    modo="fixo", hora_inicio=0, codigo="""
v{P}Ok := false;
vN15 := 1;
if BarDuration > 0 then
  if Floor(15 / BarDuration) > 1 then vN15 := Floor(15 / BarDuration);
if (Intraday = 1) and (GapReal = 1) and (vNb = vN15) then
begin
  vPC := v{P}C[vNb + 1];
  vPH := v{P}H[vNb + 1];
  vPL := v{P}L[vNb + 1];
  vSeguir2 := true;
  for vK := vNb + 1 to vNb + 220 do
    if vSeguir2 then
    begin
      if Date[vK] = Date[vNb + 1] then
      begin
        if v{P}H[vK] > vPH then vPH := v{P}H[vK];
        if v{P}L[vK] < vPL then vPL := v{P}L[vK];
      end
      else vSeguir2 := false;
    end;
  vX := vPC;
  if vX < 0 then vX := -vX;
  vGap := (v{P}O[vNb] - vPC) / vX;
  vHi := v{P}H[1];
  vLo := v{P}L[1];
  for vK := 1 to vNb do
  begin
    if v{P}H[vK] > vHi then vHi := v{P}H[vK];
    if v{P}L[vK] < vLo then vLo := v{P}L[vK];
  end;
  if (vGap >= -0.004) and (vGap <= -0.0005) and (v{P}O[vNb] >= vPL) and (vHi < vPC) then
  begin
    vX := v{P}O[vNb] - 2 * (vPC - v{P}O[vNb]);
    if vLo < vX then vX := vLo;
    v{P}Stp := Floor((vX - Tick) / Tick + 0.0000001) * Tick;
    vRisco2 := v{P}C[1] - v{P}Stp;
    vPremio := vPC - v{P}C[1];
    if (vRisco2 > 0) and (vRisco2 <= 6.0 * vA) and (vPremio >= 0.2 * vRisco2) then
    begin
      v{P}Gat := v{P}C[1];
      v{P}A1 := vPC;
      v{P}A2 := vPC;
      v{P}Ok := true;
      v{P}Tipo := 1;
      v{P}Val := 1;
    end;
  end;
end;
""")

REGRAS["E9"] = dict(nome="E9 OGRO", titulo="E9 - OGRO: rompimento de pivo + Fibonacci (estilo Andre Machado, Ogro de Wall Street)", alvo=0.0,
                    modo="fibo", codigo="""
v{P}Ok := false;
if (v{P}M9[1] > v{P}M20[1]) and (v{P}M20[1] > v{P}M200[1]) and (v{P}M20[1] > v{P}M20[6]) then
begin
""" + ind(topo(30), 2) + """
  if (vJ >= 3) and (v{P}H[1] < v{P}H[vJ]) then
  begin
    vM := vJ - 1;
    for vK := 1 to vJ - 1 do
    begin
      vM2 := vJ - vK;
      if v{P}L[vM2] <= v{P}L[vM] then vM := vM2;
    end;
    if (vM > 1) and (v{P}L[1] > v{P}L[vM]) then
    begin
      vA0 := vJ + 1;
      for vK := 0 to 39 do
      begin
        vM2 := vJ + 40 - vK;
        if v{P}L[vM2] <= v{P}L[vA0] then vA0 := vM2;
      end;
      vPerna := v{P}H[vJ] - v{P}L[vA0];
      if (vPerna >= 2.0 * vA) and (vA0 - vJ >= 3) then
      begin
        vRet := (v{P}H[vJ] - v{P}L[vM]) / vPerna;
        if (vRet >= 0.236) and (vRet <= 0.50) then
        begin
          v{P}Gat := -Floor(-((v{P}H[vJ] + Tick) / Tick - 0.0000001)) * Tick;
          v{P}Stp := Floor((v{P}L[vM] - Tick) / Tick + 0.0000001) * Tick;
          vX := v{P}Gat - v{P}Stp;
          if (vX > 0) and (vX >= 0.3 * vA) and (vX <= 2.5 * vA) then
          begin
            v{P}A1 := v{P}L[vM] + vPerna;
            v{P}A2 := v{P}L[vM] + 1.618 * vPerna;
            v{P}Ok := true;
            v{P}Tipo := 0;
            v{P}Val := 1;
          end;
        end;
      end;
    end;
  end;
end;
""")

REGRAS["E10"] = dict(nome="E10 XTRADERS", titulo="E10 - XTRADERS: Keltner em dia lateral (setup do Adriano Mendes) - so intraday", alvo=0.0,
                     modo="fixo", codigo="""
v{P}Ok := false;
if (Intraday = 1) and (vNb >= 7) then
begin
  vHi := v{P}H[1];
  vLo := v{P}L[1];
  for vK := 1 to vNb do
  begin
    if v{P}H[vK] > vHi then vHi := v{P}H[vK];
    if v{P}L[vK] < vLo then vLo := v{P}L[vK];
  end;
  vM1 := v{P}E200[1];
  vM2b := v{P}E500[1];
  if vM2b < vM1 then
  begin
    vX := vM1;
    vM1 := vM2b;
    vM2b := vX;
  end;
  vX := v{P}VW[1] - v{P}VW[7];
  if vX < 0 then vX := -vX;
  if (vLo <= vM2b) and (vHi >= vM1) and (vX <= 0.3 * vA) then
  begin
    vPH := v{P}H[vNb + 1];
    vPL := v{P}L[vNb + 1];
    vSeguir2 := true;
    for vK := vNb + 1 to vNb + 220 do
      if vSeguir2 then
      begin
        if Date[vK] = Date[vNb + 1] then
        begin
          if v{P}H[vK] > vPH then vPH := v{P}H[vK];
          if v{P}L[vK] < vPL then vPL := v{P}L[vK];
        end
        else vSeguir2 := false;
      end;
    if (v{P}C[1] >= vPL) and (v{P}C[1] <= vPH) then
    begin
      vMe := v{P}E20[1];
      vBd := vMe - 2.0 * vA;
      vBf := vMe - 2.5 * vA;
      vIfr := v{P}R9[1];
      if v{P}R9[2] < vIfr then vIfr := v{P}R9[2];
      if (v{P}L[1] <= vBd) and (v{P}C[1] > vBd) and (vIfr <= 35) then
      begin
        vX := v{P}L[1];
        if vBf < vX then vX := vBf;
        v{P}Stp := Floor((vX - 0.25 * vA - Tick) / Tick + 0.0000001) * Tick;
        vRisco2 := v{P}C[1] - v{P}Stp;
        vPremio := vMe - v{P}C[1];
        if (vRisco2 > 0) and (vRisco2 <= 2.5 * vA) and (vPremio >= 0.6 * vRisco2) then
        begin
          v{P}Gat := v{P}C[1];
          v{P}A1 := vMe;
          v{P}A2 := vMe;
          v{P}Ok := true;
          v{P}Tipo := 1;
          v{P}Val := 1;
        end;
      end;
    end;
  end;
end;
""")

for _c in ("E1", "E2", "E3", "E4", "E5"):
    REGRAS[_c]["modo"] = "R"
REGRAS["E6"]["modo"] = "propria"

# ------------------------------------------------------------------------------------------ esqueleto
CAB = """// =====================================================================
//  ROBO APEX - {TITULO}
//  Tipo no Profit: Indicador (no grafico de preco). NAO envia ordens.
//  Linhas: BRANCA = entrada | VERMELHA = stop | VERDE = alvo
//  (aparecem enquanto a ordem esta armada ou a operacao esta aberta).
//  Mesmas regras e mesma execucao do programa ROBO APEX.
//  Parametros por ativo (Tick, Slip, CustoPts, horarios): veja o LEIA-ME.
//  Gerado por ferramentas/gerar_ntsl.py - edite la, nao aqui.
// =====================================================================
"""

ENTRADAS = """input
  Tick(5.0);
  Slip(5.0);
  CustoPts(3.0);
  AlvoR({ALVO});
  MaxStopsDia(2);
  Intraday(1);
  HoraInicio({HI});
  HoraFimEntradas(1630);
  HoraZeragem(1650);{EXTRA}
"""

SERIES = """// ---------------- series (todo candle)
vM5 := Media(5, Close);
vM9 := Media(9, Close);
vM20 := Media(20, Close);
vM200 := Media(200, Close);
if Intraday = 1 then vVW := VWAP(1)
else vVW := Close;
vTR := High - Low;
if CurrentBar > 1 then
begin
  if High - Close[1] > vTR then vTR := High - Close[1];
  if Close[1] - Low > vTR then vTR := Close[1] - Low;
end;
vATR := 0;
if CurrentBar > 20 then
begin
  for vK := 0 to 13 do vATR := vATR + vTR[vK];
  vATR := vATR / 14;
end;
if CurrentBar > 1 then vDif := Close - Close[1]
else vDif := 0;
vGanho := 0;
vPerda := 0;
if vDif > 0 then vGanho := vDif;
if vDif < 0 then vPerda := -vDif;
if CurrentBar < 5 then
begin
  vMG := vGanho;
  vMP := vPerda;
end
else
begin
  vMG := (vMG[1] + vGanho) / 2;
  vMP := (vMP[1] + vPerda) / 2;
end;
if vMP = 0 then vRSI := 100
else vRSI := 100 - 100 / (1 + vMG / vMP);
// IFR(9) de Wilder e medias exponenciais 20/200/500 (comecam no 1o preco, como no programa)
if CurrentBar < 5 then
begin
  vMG9 := vGanho;
  vMP9 := vPerda;
end
else
begin
  vMG9 := (vMG9[1] * 8 + vGanho) / 9;
  vMP9 := (vMP9[1] * 8 + vPerda) / 9;
end;
if vMP9 = 0 then vRSI9 := 100
else vRSI9 := 100 - 100 / (1 + vMG9 / vMP9);
if vIniE = 0 then
begin
  vE20 := Close;
  vE200 := Close;
  vE500 := Close;
  vIniE := 1;
end
else
begin
  vE20 := vE20[1] + (Close - vE20[1]) * 2 / 21;
  vE200 := vE200[1] + (Close - vE200[1]) * 2 / 201;
  vE500 := vE500[1] + (Close - vE500[1]) * 2 / 501;
end;
// compra = preco normal | venda = preco invertido (a mesma regra serve para os dois lados)
vCH := High;
vCL := Low;
vCO := Open;
vCC := Close;
vCM5 := vM5;
vCM9 := vM9;
vCM20 := vM20;
vCM200 := vM200;
vCVW := vVW;
vCR := vRSI;
vCR9 := vRSI9;
vCE20 := vE20;
vCE200 := vE200;
vCE500 := vE500;
vVH := -Low;
vVL := -High;
vVO := -Open;
vVC := -Close;
vVM5 := -vM5;
vVM9 := -vM9;
vVM20 := -vM20;
vVM200 := -vM200;
vVVW := -vVW;
vVR := 100 - vRSI;
vVR9 := 100 - vRSI9;
vVE20 := -vE20;
vVE200 := -vE200;
vVE500 := -vE500;"""


def fechar(rotulo):
    return """vRes := vPts + vFrac * vDir * (vPreco - vEnt) - CustoPts;
if vRes < 0 then vStops := vStops + 1;
vEst := 0;
vSair := 0;
if vRes >= 0 then PlotText("%s +", clLime, 2, 8)
else PlotText("%s -", clRed, 2, 8);""" % (rotulo, rotulo)


def processo(r):
    regra_c = r["codigo"].replace("{P}", "C")
    regra_v = r["codigo"].replace("{P}", "V")
    nome = r["nome"]
    modo = r["modo"]
    if modo == "R":
        alvos_entrada = """vTemAlvo := 0;
vTemA1 := 0;
if AlvoR > 0 then
begin
  vAlvo := vEnt + vDir * AlvoR * vRisco;
  vTemAlvo := 1;
end;"""
    elif modo == "propria":
        alvos_entrada = """vTemAlvo := 0;
vTemA1 := 0;"""
    else:
        alvos_entrada = """vAlvo := vA2;
vTemAlvo := 1;
vTemA1 := 0;
if vDir * (vAlvo - vEnt) <= Tick then vEst := 0;""" + ("""
vAlvo1 := vA1;
if vDir * (vA1 - vEnt) > Tick then vTemA1 := 1;""" if modo == "fibo" else "")
    guarda_alvos = lambda sinal, pre: "" if modo not in ("fixo", "fibo") else "\n      vA1 := %s%sA1;\n      vA2 := %s%sA2;" % (sinal, pre, sinal, pre)
    parcial = "" if modo != "fibo" else """
if (vTemA1 = 1) and (vParcial = 0) and (((vDir = 1) and (High[1] >= vAlvo1 + Tick)) or ((vDir = -1) and (Low[1] <= vAlvo1 - Tick))) then
begin
  vParcial := 1;
  vPts := vPts + FracParcial * vDir * (vAlvo1 - vEnt);
  vFrac := vFrac - FracParcial;
  if vDir * (vStp - vEnt) < 0 then vStp := vEnt;
  if ((vDir = 1) and (Low[1] <= vEnt)) or ((vDir = -1) and (High[1] >= vEnt)) then
  begin
    vPreco := vEnt - vDir * Slip;
""" + ind(fechar("0x0"), 4) + """
  end;
end;"""
    alvo_bloco = """if (vEst = 2) and (vTemAlvo = 1) then
begin
  if (vB <> vBarEnt) and (vDir * (Open[1] - vAlvo) >= 0) then
  begin
    vPreco := Open[1];
""" + ind(fechar("ALVO"), 4) + """
  end
  else if ((vDir = 1) and (High[1] >= vAlvo + Tick)) or ((vDir = -1) and (Low[1] <= vAlvo - Tick)) then
  begin
    vPreco := vAlvo;
""" + ind(fechar("ALVO"), 4) + """
  end;
end;"""
    propria = "" if modo != "propria" else """
if vEst = 2 then
begin
  if vDir * (Close[1] - vM5[1]) > 0 then vSair := 1
  else if vB - vBarEnt + 1 >= 10 then vSair := 1;
end;"""
    gerir_resto = ind((parcial + "\n" + alvo_bloco + propria).strip("\n"), 6)
    plot_pend = "if AlvoR > 0 then Plot3(vGat + AlvoR * (vGat - vStp))\n  else NoPlot(3);" if modo in ("R", "propria") else "Plot3(vA2);"
    return """// ---------------- decide uma vez por candle, com o candle FECHADO ([1])
if (CurrentBar > 230) and (CurrentBar <> vUlt) then
begin
  vUlt := CurrentBar;
  vB := CurrentBar - 1;
  vA := vATR[1];
  if Date[1] <> Date[2] then vStops := 0;
  vFimDia := (Intraday = 1) and ((Time[1] >= HoraZeragem) or (Date <> Date[1]));
  // candles do dia ate o candle fechado (VWAP)
  vNb := 0;
  vSeguir := true;
  if Intraday = 1 then
    for vK := 1 to 220 do
      if vSeguir then
      begin
        if Date[vK] = Date[1] then vNb := vNb + 1
        else vSeguir := false;
      end;
  vMinB := 4;
  if BarDuration > 0 then
    if Floor(30 / BarDuration) > 4 then vMinB := Floor(30 / BarDuration);

  // 1) saida marcada no fechamento anterior (RSI-2): executa na abertura
  if (vEst = 2) and (vSair = 1) then
  begin
    vPreco := Open[1] - vDir * Slip;
""" + ind(fechar("SAIDA"), 4) + """
  end;

  // 2) ordem armada: expira, cancela se o preco foi ao stop antes, ou executa
  if vEst = 1 then
  begin
    if vB > vBarSinal + vVal then vEst := 0
    else
    begin
      vOk := false;
      if vTipo = 1 then
      begin
        vOk := true;
        vPreco := Open[1] + vDir * Slip;
      end
      else
      begin
        if (vDir = 1) and (High[1] >= vGat) then
        begin
          vOk := true;
          vPreco := vGat;
          if Open[1] > vPreco then vPreco := Open[1];
          vPreco := vPreco + Slip;
        end;
        if (vDir = -1) and (Low[1] <= vGat) then
        begin
          vOk := true;
          vPreco := vGat;
          if Open[1] < vPreco then vPreco := Open[1];
          vPreco := vPreco - Slip;
        end;
        if not vOk then
          if ((vDir = 1) and (Low[1] <= vStp)) or ((vDir = -1) and (High[1] >= vStp)) then vEst := 0;
      end;
      if vOk then
      begin
        if vDir * (vPreco - vStp) <= Tick / 2 then vEst := 0
        else
        begin
          vEst := 2;
          vEnt := vPreco;
          vBarEnt := vB;
          vSair := 0;
          vRisco := vDir * (vEnt - vStp);
          vPts := 0;
          vFrac := 1;
          vParcial := 0;
""" + ind(alvos_entrada, 10) + """
        end;
      end;
    end;
  end;

  // 3) operacao aberta: stop primeiro (hipotese pior), depois alvo, depois saida propria
  if vEst = 2 then
  begin
    if (vB <> vBarEnt) and (vDir * (Open[1] - vStp) <= 0) then
    begin
      vPreco := Open[1] - vDir * Slip;
""" + ind(fechar("STOP"), 6) + """
    end
    else if ((vDir = 1) and (Low[1] <= vStp)) or ((vDir = -1) and (High[1] >= vStp)) then
    begin
      vPreco := vStp - vDir * Slip;
""" + ind(fechar("STOP"), 6) + """
    end
    else
    begin
""" + gerir_resto + """
    end;
  end;

  // 4) fim do dia: zera e cancela
  if vFimDia then
  begin
    if vEst = 2 then
    begin
      vPreco := Close[1] - vDir * Slip;
""" + ind(fechar("ZERAGEM"), 6) + """
    end;
    if vEst = 1 then vEst := 0;
  end;

  // 5) procura o setup no candle fechado (compra e venda)
  vPode := (Intraday = 0) or ((Time[1] >= HoraInicio) and (Time[1] < HoraFimEntradas) and (vStops < MaxStopsDia));
  if (vEst <> 2) and (not vFimDia) and vPode then
  begin
    // --- compra
""" + ind(regra_c, 4) + """
    // --- venda (mesma regra no grafico invertido)
""" + ind(regra_v, 4) + """
    if vCOk and (not vVOk) then
    begin
      vEst := 1;
      vDir := 1;
      vGat := vCGat;
      vStp := vCStp;
      vTipo := vCTipo;
      vVal := vCVal;
      vBarSinal := vB;""" + guarda_alvos("", "vC") + """
      PlotText("COMPRA {NOME}", clAqua, 0, 9);
      Alert(clAqua);
    end
    else if vVOk and (not vCOk) then
    begin
      vEst := 1;
      vDir := -1;
      vGat := -vVGat;
      vStp := -vVStp;
      vTipo := vVTipo;
      vVal := vVVal;
      vBarSinal := vB;""" + guarda_alvos("-", "vV") + """
      PlotText("VENDA {NOME}", clFuchsia, 1, 9);
      Alert(clFuchsia);
    end;
  end;
end;

// ---------------- linhas: entrada (branca), stop (vermelha), alvo (verde)
if vEst = 1 then
begin
  Plot(vGat);
  Plot2(vStp);
  """ + plot_pend + """
end
else if vEst = 2 then
begin
  Plot(vEnt);
  Plot2(vStp);
  if vTemAlvo = 1 then Plot3(vAlvo)
  else NoPlot(3);
end
else
begin
  NoPlot(1);
  NoPlot(2);
  NoPlot(3);
end;
SetPlotColor(1, clWhite);
SetPlotColor(2, clRed);
SetPlotColor(3, clLime);"""


TIPOS = {"Integer": ["vK", "vM", "vM2", "vJ", "vNpb", "vAc", "vNb", "vMinB", "vUlt", "vB", "vEst", "vDir", "vTipo", "vVal",
                     "vBarSinal", "vBarEnt", "vStops", "vSair", "vCTipo", "vVTipo", "vCVal", "vVVal",
                     "vTemAlvo", "vTemA1", "vParcial", "vN15", "vA0", "vIniE"],
         "Boolean": ["vToque", "vFora", "vSinal", "vOk", "vFimDia", "vPode", "vCOk", "vVOk", "vSeguir", "vSeguir2"]}


def declarar(texto):
    sem_texto = re.sub(r'"[^"]*"', '""', re.sub(r"//[^\n]*", "", texto))
    usados = sorted(set(re.findall(r"\bv[A-Z][A-Za-z0-9]*\b", sem_texto)))
    linhas = ["var"]
    for v in usados:
        tipo = "Float"
        for t, lst in TIPOS.items():
            if v in lst:
                tipo = t
        linhas.append("  %s : %s;" % (v, tipo))
    return "\n".join(linhas) + "\n"


def conferir(nome, txt):
    """Conferencias estruturais (o Profit nao roda aqui)."""
    c = re.sub(r'"[^"]*"', '""', re.sub(r"//[^\n]*", "", txt))
    ab, fe = len(re.findall(r"\bbegin\b", c)), len(re.findall(r"\bend\b", c))
    assert ab == fe, "%s: begin %d x end %d" % (nome, ab, fe)
    assert c.count("(") == c.count(")"), "%s: parenteses" % nome
    assert c.count("[") == c.count("]"), "%s: colchetes" % nome
    assert not re.search(r";\s*else\b", c), "%s: ';' antes de else" % nome
    assert "{" not in c and "}" not in c, "%s: marcador sobrando" % nome
    decl = set(re.findall(r"^\s+(v\w+) :", c, re.M))
    usados = set(re.findall(r"\bv[A-Z]\w*\b", c))
    assert usados <= decl, "%s: sem declarar %s" % (nome, usados - decl)
    # toda atribuicao/comando termina com ';' (exceto antes de else / linhas de controle)
    linhas = [x.strip() for x in c.split("\n") if x.strip()]
    for k, s in enumerate(linhas):
        prox = linhas[k + 1] if k + 1 < len(linhas) else ""
        if s.endswith((";", "then", "do", "begin", "else")) or s in ("var", "input") or prox.startswith("else"):
            continue
        if re.match(r"^\w+\([^;]*\)$", s) and linhas[max(0, k - 1)] == "input":
            continue
        if re.match(r"^\w+\(.*\);?$", s):
            continue
        raise AssertionError("%s: linha sem ';': %s" % (nome, s))


def gerar():
    os.makedirs(SAIDA, exist_ok=True)
    for f in os.listdir(SAIDA):
        if f.endswith(".ntsl"):
            os.remove(os.path.join(SAIDA, f))
    nomes = {"E1": "E1_Halt_MM20", "E2": "E2_Fibonacci", "E3": "E3_VWAP", "E4": "E4_Rompimento",
             "E5": "E5_Combinacao_Gift", "E6": "E6_RSI2", "E7": "E7_ORB", "E8": "E8_Gap", "E9": "E9_OGRO",
             "E10": "E10_XTraders_Keltner"}
    for cod, r in REGRAS.items():
        corpo = "begin\n" + ind(SERIES, 2) + "\n\n" + ind(processo(r).replace("{NOME}", r["nome"]), 2) + "\nend;\n"
        extra = ""
        if r["modo"] == "fibo":
            extra += "\n  FracParcial(0.5);"
        if cod == "E8":
            extra += "\n  GapReal(1);"
        entradas = ENTRADAS.replace("{ALVO}", "%.1f" % r["alvo"]).replace("{HI}", str(r.get("hora_inicio", 1005))).replace("{EXTRA}", extra)
        txt = CAB.replace("{TITULO}", r["titulo"]) + entradas + declarar(corpo) + corpo
        conferir(cod, txt)
        with open(os.path.join(SAIDA, nomes[cod] + ".ntsl"), "w", encoding="utf-8", newline="\r\n") as f:
            f.write(txt)
        print("ok", nomes[cod], len(txt.splitlines()), "linhas")


if __name__ == "__main__":
    gerar()
