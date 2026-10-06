/* ROBÔ APEX — "Como funciona": minijanela que explica cada estratégia passo a passo, para quem opera e não programa.
   AX.explica.abrir("E2") abre (com "TODAS", explica o modo TODAS juntas; um segundo argumento negativo já abre do lado
   da venda); AX.explica.fechar(), Esc ou um clique no fundo escuro fecham. O módulo cria o próprio HTML na primeira vez
   e não depende de nada do index.html.
   Os textos e os desenhos repetem as regras de estrategias.py e simulador.py: MUDOU UMA REGRA LÁ, MUDE AQUI.
   Tudo é escrito uma vez só, para a COMPRA. A venda é o espelho exato (como no servidor): "{compra|venda}" escolhe a
   palavra de cada lado e o desenho é o mesmo com o eixo do preço invertido. */
(() => {
  "use strict";
  const AX = window.AX;
  if (!AX) return;

  const NOTA = "Estatística do passado, não é promessa: nos testes com custos reais nenhuma estratégia teve vantagem comprovada. O robô é informativo e não envia ordens.";
  const GLOSSARIO = "ATR = tamanho médio dos últimos 14 candles. Tick = a menor variação de preço do ativo. Risco = distância da entrada ao stop. " +
    "No intraday o robô só abre operação dentro do horário do ativo, zera a posição no fim do pregão e para o dia ao atingir o limite de stops de ⚙ Ajustes.";
  const lado = (s, venda) => String(s).replace(/\{([^{}|]*)\|([^{}|]*)\}/g, (_, c, v) => (venda ? v : c));

  // ---------------------------------------------------------------- pedaços de texto que se repetem
  const RISCO = " O robô só arma a ordem se o risco (da entrada ao stop) ficar entre 0,3 e 2,5 ATR.";
  const VALE2 = " Vale para os 2 candles seguintes; se o preço for ao stop antes de ativá-la, é cancelada.";
  const ALVO2 = ["Alvo", "Um alvo só, a 2 vezes o risco (2:1): a posição inteira sai lá."];
  const MERCADO = ["Entrada", "{Compra|Venda} a mercado na abertura do candle seguinte."];
  const TERCOS = ["Gestão em três partes", "Um terço da posição sai em cada alvo. No alvo 1 o stop vai para a entrada; no alvo 2, para o alvo 1. Com 1 contrato não há parcial: só o stop anda e a saída é no alvo 3."];
  const CS = "{Compra|Venda} stop", CM = "{Compra|Venda} a mercado", CL = "{Compra|Venda} limitada", R2 = "2× o risco", SOBE = "stop {sobe|desce}";

  // ---------------------------------------------------------------- as estratégias
  // passos = [título, texto]; o número do passo é o da bolinha no desenho.
  // des = desenho numa caixa de 0 a 100 (x = tempo; y = preço, 0 embaixo), sempre do lado da COMPRA:
  //   p  caminho do preço até a entrada                    f  o que vem depois da entrada (mais apagado)
  //   v  candles [x, abertura, máxima, mínima, fechamento] l  linhas [cor, nome, pontos, fina]: médias, VWAP, bandas, stop que anda
  //   z  faixas [x1, y1, x2, y2, cor]    a  áreas [cor, pontos]    h  horários (riscos verticais em x)
  //   n  níveis [tipo, y, texto, x1, passo, etiqueta]: tipo e = entrada, s = stop, a = alvo, r = referência; x1 < 0 = sem linha
  //   t  textos [x, y, texto, âncora (m = meio, e = fim), forte]   m  bolinhas [x, y, passo]   b  pontos [x, y, cor]
  const EST = {
    E1: {
      nome: "Halt na MM20",
      frase: "Em tendência, {comprar|vender} a correção que encosta na média de 20 e não consegue fechar do outro lado dela.",
      passos: [
        ["Tendência a favor", "A média de 20 (MM20) está {subindo|caindo} com força: andou pelo menos 0,2 ATR nos últimos 5 candles. E o preço fecha {acima|abaixo} da média de 200 (MM200)."],
        ["Correção que encosta na MM20 (o halt)", "Depois de um {topo|fundo} afastado da média (0,5 ATR ou mais), o preço corrige de 1 a 8 candles, encosta na MM20 e nenhum candle fecha {abaixo|acima} dela."],
        ["Candle de confirmação", "Um candle de {alta|baixa} que fecha na metade {de cima|de baixo} dele e {acima|abaixo} da MM20. Se a correção teve só 1 candle, ele precisa fechar {acima da máxima|abaixo da mínima} desse candle (o Gift)."],
        ["Entrada", "Ordem de {compra|venda} stop 1 tick {acima da máxima|abaixo da mínima} do candle de confirmação." + VALE2],
        ["Stop", "1 tick {abaixo do fundo|acima do topo} da correção." + RISCO],
        ALVO2,
        ["Quando não opera", "Se a correção tiver uma barra elefante contra (candle de {baixa|alta} com 2 ATR ou mais de tamanho), é regressão aguda: o robô não arma a ordem."],
      ],
      des: {
        p: [[2, 33], [10, 42], [14, 39], [28, 67], [34, 60], [41, 53], [48, 46], [54, 55]],
        f: [[54, 55], [59, 59], [65, 67], [71, 64], [81, 76], [89, 84.5]],
        v: [[54, 47.5, 56, 46.5, 55]],
        l: [["mm20", "MM20", [[0, 26], [100, 66]]], ["mm200", "MM200", [[0, 8], [100, 14]]]],
        n: [["e", 57.5, CS, 52, 4], ["s", 44.5, "", 46, 5], ["a", 83.5, R2, 52, 6]],
        m: [[15.5, 23, 1], [40, 64, 2], [49.2, 61.5, 3]],
      },
    },
    E2: {
      nome: "Gatilho de Fibonacci",
      frase: "Depois de um impulso forte, {comprar|vender} quando a correção para na zona de Fibonacci e um candle confirma a retomada.",
      passos: [
        ["Impulso a favor da média", "A MM20 está {subindo|caindo}, o preço fecha {acima|abaixo} da MM200 e houve um impulso de pelo menos 2 ATR, do {fundo ao topo|topo ao fundo}."],
        ["Correção até a zona de Fibonacci", "O preço devolve parte do impulso durante 1 a 12 candles e para entre 35% e 66% dele: é a zona de 38,2% a 61,8%, com uma pequena folga. Devolveu menos ou mais que isso, não vale."],
        ["Candle de confirmação", "Um candle de {alta|baixa} que fecha na metade {de cima|de baixo} dele, {acima|abaixo} do fechamento anterior e {acima|abaixo} do nível de 61,8%."],
        ["Entrada", "Ordem de {compra|venda} stop 1 tick {acima da máxima|abaixo da mínima} desse candle." + VALE2],
        ["Stop", "1 tick {abaixo do fundo|acima do topo} da correção." + RISCO],
        ALVO2,
      ],
      des: {
        z: [[0, 43.4, 100, 56.6, "fibo"]],
        p: [[2, 29], [7, 25], [12, 22], [20, 42], [24, 38], [33, 66], [36, 63], [40, 78], [46, 68], [50, 62], [54, 55], [58, 50], [63, 58.5]],
        f: [[63, 58.5], [68, 62.5], [76, 72], [80, 69], [90, 82.5], [95, 87]],
        v: [[63, 51.5, 59.5, 50.5, 58.5]],
        l: [["mm20", "MM20", [[0, 6], [100, 34]]]],
        n: [["e", 61, CS, 61, 4], ["s", 48.5, "", 56, 5], ["a", 86, R2, 61, 6]],
        t: [[1.5, 59.5, "38,2%"], [1.5, 40.5, "61,8%"], [12, 16, "{fundo|topo}", "m"], [40, 83, "{topo|fundo}", "m"]],
        m: [[27, 68, 1], [48.5, 51, 2], [57.5, 64, 3]],
      },
    },
    E3: {
      nome: "Pullback na VWAP",
      frase: "Em dia de tendência, {comprar|vender} quando o preço volta até a VWAP, testa e não consegue fechar do outro lado.",
      passos: [
        ["Dia de tendência", "Só no intraday, depois dos primeiros 30 minutos (e de pelo menos 4 candles). A VWAP está {subindo|caindo}, o preço fecha {acima|abaixo} dela e pelo menos 70% dos fechamentos do dia ficaram desse lado."],
        ["Afastou e voltou para testar", "No dia, o preço já andou pelo menos 1 ATR para {cima|baixo} da VWAP. Agora, nos últimos 3 candles, voltou a encostar nela."],
        ["O teste segura", "Nenhum desses 3 candles fecha {abaixo|acima} da VWAP, e o último é um candle de {alta|baixa} que fecha na metade {de cima|de baixo} dele."],
        ["Entrada", "Ordem de {compra|venda} stop 1 tick {acima da máxima|abaixo da mínima} do candle de confirmação." + VALE2],
        ["Stop", "1 tick {abaixo da menor mínima|acima da maior máxima} desses 3 candles." + RISCO],
        ["Alvo", "Um alvo só, a 2 vezes o risco (2:1). Se ele não vier, a posição é zerada no fim do pregão."],
      ],
      des: {
        h: [4],
        p: [[4, 20], [9, 27], [13, 25.5], [25, 48], [31, 45], [39, 60], [45, 54], [51, 48], [56, 44], [61, 52.5]],
        f: [[61, 52.5], [66, 57], [72, 65], [76, 62.5], [86, 75], [92, 81]],
        v: [[61, 46.5, 53.5, 46, 52.5]],
        l: [["vwap", "VWAP", [[4, 20], [100, 63.5]]]],
        n: [["e", 55, CS, 59, 4], ["s", 42.5, "", 54, 5], ["a", 80, R2, 59, 6]],
        t: [[5.5, 96, "abertura"]],
        m: [[31, 24, 1], [39, 68, 2], [50.5, 35, 3]],
      },
    },
    E4: {
      nome: "Rompimento de base",
      frase: "Tendência forte que descansa num retângulo estreito no {topo|fundo}: {comprar|vender} o rompimento dessa base.",
      passos: [
        ["Tendência forte", "A MM20 está {subindo|caindo} com força (pelo menos 0,2 ATR em 5 candles) e o preço fecha {acima|abaixo} da MM200."],
        ["Base estreita no {topo|fundo}", "Os últimos 4 candles cabem numa faixa de no máximo 1,2 ATR, colada no {topo|fundo} do movimento (a até 0,3 ATR {da maior máxima|da menor mínima} dos 20 candles anteriores). A base fica do lado certo da MM20: passa no máximo 0,2 ATR para o outro lado dela."],
        ["Entrada", "Ordem de {compra|venda} stop 1 tick {acima do topo|abaixo do fundo} da base." + VALE2],
        ["Stop", "1 tick {abaixo do fundo|acima do topo} da base." + RISCO],
        ALVO2,
      ],
      des: {
        z: [[39.8, 56, 64.2, 66, "neutro"]],
        p: [[2, 22], [8, 30], [12, 27], [22, 44], [26, 40.5], [38, 62], [41, 60]],
        f: [[61, 60.5], [66, 68.5], [72, 75], [76, 72.5], [86, 84], [92, 89]],
        v: [[43, 58.5, 65, 57, 64], [49, 64, 66, 58.5, 59.5], [55, 59.5, 64.5, 56, 63.5], [61, 63.5, 65.5, 59, 60.5]],
        l: [["mm20", "MM20", [[0, 16], [100, 78]]]],
        n: [["e", 67.5, CS, 39.8, 3], ["s", 54.5, "", 39.8, 4], ["a", 93.5, R2, 62, 5]],
        t: [[50, 73.5, "base"]],
        m: [[8, 12, 1], [46, 73.5, 2]],
      },
    },
    E5: {
      nome: "Combinação perfeita + Gift na MM9",
      frase: "Tendência tão forte que a correção mal chega à média de 9: {comprar|vender} quando um candle apaga o anterior inteiro.",
      passos: [
        ["Combinação perfeita das médias", "MM9 {acima|abaixo} da MM20 e MM20 {acima|abaixo} da MM200, com a MM9 e a MM20 {subindo|caindo} (a MM20 andou pelo menos 0,3 ATR em 5 candles)."],
        ["Correção rasa até a MM9", "Depois do {topo|fundo} mais recente, o preço corrige só de 1 a 3 candles, encosta na MM9 e nenhum candle fecha {abaixo|acima} da MM20."],
        ["Candle Gift", "Um candle de {alta|baixa} que fecha {acima da máxima|abaixo da mínima} do candle anterior: ele apaga o candle anterior inteiro."],
        ["Entrada", "Ordem de {compra|venda} stop 1 tick {acima da máxima|abaixo da mínima} do Gift." + VALE2],
        ["Stop", "1 tick {abaixo do fundo|acima do topo} da correção." + RISCO],
        ALVO2,
      ],
      des: {
        p: [[2, 22], [9, 30], [12, 27.5], [22, 41], [25, 38.5], [40, 62], [44, 58], [48, 52], [54, 60.5]],
        f: [[54, 60.5], [59, 65], [66, 73], [70, 71], [82, 84], [88, 91.5]],
        v: [[48, 58, 59, 50.5, 52], [54, 52.5, 61.5, 51.5, 60.5]],
        l: [["mm9", "MM9", [[0, 16], [22, 31], [40, 46], [48, 50], [62, 60.5], [80, 76], [90, 84]]], ["mm20", "MM20", [[0, 6], [100, 39]]], ["mm200", "MM200", [[0, 2], [100, 8]]]],
        n: [["e", 63, CS, 53, 4], ["s", 49, "", 46, 5], ["a", 91, R2, 53, 6]],
        m: [[30, 26.5, 1], [46.5, 41.5, 2], [49.5, 67.5, 3]],
      },
    },
    E6: {
      nome: "RSI(2) de Connors",
      frase: "A favor da tendência longa, {comprar uma queda|vender uma alta} curta e exagerada e sair assim que o preço volta para a média de 5.",
      passos: [
        ["Do lado certo da tendência longa", "O preço fecha {acima|abaixo} da média de 200 (MM200). Do outro lado dela, a estratégia não {compra|vende}."],
        ["Recuo curto e exagerado", "O RSI de 2 períodos fecha {abaixo de 10|acima de 90}: o preço {caiu|subiu} depressa demais em poucos candles."],
        ["Entrada", "{Compra|Venda} a mercado na abertura do candle seguinte, sem esperar confirmação."],
        ["Stop de proteção", "A 3 ATR do fechamento do candle de sinal. A regra original do Connors não usava stop; aqui ele existe só como proteção."],
        ["Saída", "Não há alvo fixo. A posição sai quando um candle fecha {acima|abaixo} da média de 5 (MM5) ou quando a operação chega a 10 candles; a saída é na abertura do candle seguinte."],
      ],
      des: {
        p: [[2, 66], [10, 74], [15, 70], [26, 82], [31, 78.5], [42, 94], [47, 87], [52, 78], [57, 68]],
        f: [[57, 68], [62, 68], [67, 73], [72, 79], [77, 79.5]],
        l: [["mm5", "MM5", [[18, 71], [31, 77], [42, 84.5], [50, 87], [57, 82], [62, 78], [67, 75.5], [72, 75.5], [79, 78], [90, 84]]], ["mm200", "MM200", [[0, 40], [100, 50]]]],
        n: [["e", 68, CM, 59.5, 3], ["s", 26, "a 3 ATR", 57, 4]],
        b: [[62, 68, "ent"], [77, 79.5, "neutro"]],
        t: [[55, 60, "RSI(2) {< 10|> 90}", "e"], [73, 90, "saída"]],
        m: [[12, 33, 1], [33.5, 60, 2], [69.5, 90, 5]],
      },
    },
    E7: {
      nome: "Rompimento do 1º candle (ORB)",
      frase: "O primeiro candle do pregão dá a direção: entrar a favor dele, com stop curto, e segurar até o alvo distante ou o fim do dia.",
      passos: [
        ["Só o 1º candle do pregão", "Só no intraday. O robô olha apenas o primeiro candle do dia: se ele fecha {acima|abaixo} da abertura (candle de {alta|baixa}), é sinal de {compra|venda}."],
        ["Entrada", "{Compra|Venda} a mercado na abertura do 2º candle."],
        ["Stop", "1 tick {abaixo da mínima|acima da máxima} do 1º candle."],
        ["Saída", "Alvo bem distante, a 10 vezes o risco. Se ele não vier, a posição é zerada no fim do pregão: poucos acertos, ganhos grandes."],
        ["Quando não opera", "Se o 1º candle fechar no mesmo preço em que abriu (doji), ou se a distância do fechamento dele até o stop ficar fora de 0,1 a 4 ATR. É no máximo uma entrada por dia."],
      ],
      des: {
        h: [8, 93],
        f: [[16, 31], [22, 31.5], [28, 37], [32, 34.5], [42, 48], [48, 45], [60, 61], [66, 58], [78, 72], [84, 70], [93, 82]],
        v: [[16, 22, 33, 20, 31]],
        n: [["e", 31.5, CM, 20, 2], ["s", 18.5, "", 13, 3], ["a", 97, "10× o risco {↑|↓}", -1, 4]],
        b: [[22, 31.5, "ent"], [93, 82, "neutro"]],
        t: [[9.5, 96, "abertura"], [17, 39, "1º candle", "m"], [91.5, 90, "zera no fim do pregão", "e"]],
        m: [[17, 47.5, 1], [54.5, 90, 4]],
      },
    },
    E8: {
      nome: "Fechamento de gap",
      frase: "Gap pequeno costuma fechar: entrar na direção do fechamento de ontem, com alvo curto e stop largo.",
      passos: [
        ["Gap pequeno, dentro da faixa de ontem", "Só no intraday e só em dado com gap de verdade. O dia abre {abaixo|acima} do fechamento de ontem, com diferença entre 0,05% e 0,40%, sem passar {da mínima|da máxima} de ontem."],
        ["Espera os primeiros 15 minutos", "O robô decide no fim dos primeiros 15 minutos do pregão (ou do 1º candle, se ele for maior que isso). Se nesse tempo o preço já voltou ao fechamento de ontem, o gap fechou e não há entrada."],
        ["Entrada", "{Compra|Venda} a mercado na abertura do candle seguinte, na direção de fechar o gap."],
        ["Stop largo", "1 tick além do mais distante entre dois pontos: {a mínima|a máxima} dos primeiros 15 minutos e 2 vezes o tamanho do gap contado a partir da abertura."],
        ["Alvo curto", "O fechamento de ontem (o gap fechado). Só entra se o alvo valer pelo menos 20% do risco e se o risco não passar de 6 ATR."],
      ],
      des: {
        h: [33.5],
        z: [[24, 58, 33.5, 74, "neutro"]],
        p: [[2, 52], [6, 38], [11, 60], [15, 55], [20, 78], [24, 74]],
        f: [[50, 62], [56, 62], [61, 60], [67, 66], [73, 64], [81, 71], [88, 75]],
        v: [[38, 58, 60, 51, 53], [44, 53, 59, 50, 58], [50, 58, 63, 56.5, 62]],
        n: [["a", 74, "fech. de ontem", 24, 5], ["e", 62, CM, 54, 3], ["r", 38, "{mín.|máx.} de ontem", 0], ["s", 24.5, "a 2 gaps", 36, 4]],
        b: [[56, 62, "ent"]],
        t: [[32, 96, "ontem", "e"], [35, 96, "abertura"], [28.7, 66, "gap", "m"], [43.5, 44, "15 min"]],
        m: [[28.7, 82, 1], [40, 44, 2]],
      },
    },
    E9: {
      nome: "OGRO: pivô + Fibonacci",
      frase: "Tendência com correção rasa: {comprar|vender} o rompimento do {topo|fundo} anterior (o pivô) e mirar as projeções de Fibonacci da pernada.",
      passos: [
        ["Pernada A→B com médias alinhadas", "MM9 {acima|abaixo} da MM20, MM20 {acima|abaixo} da MM200 e MM20 {subindo|caindo}. A pernada de A até B tem pelo menos 2 ATR; B é o pivô."],
        ["Correção rasa até C", "O preço devolve entre 23,6% e 50% da pernada e forma {o fundo|o topo} C. Se devolver mais que 50%, o desenho deixa de valer."],
        ["Entrada no rompimento do pivô", "Ordem de {compra|venda} stop 1 tick {acima do topo|abaixo do fundo} B. Ela vale para o candle seguinte e é renovada enquanto o desenho continuar valendo."],
        ["Stop", "1 tick {abaixo do fundo|acima do topo} C." + RISCO],
        ["Alvo 1: projeção de 100%", "A pernada A→B é projetada a partir de C. Nos 100% sai metade da posição e o stop vai para o preço de entrada (0x0)."],
        ["Alvo 2: projeção de 161,8%", "O resto sai nos 161,8% da pernada, também contados de C. Com 1 contrato não há parcial: no alvo 1 só o stop anda e a saída é no alvo 2."],
      ],
      des: {
        z: [[0, 29, 64, 38, "fibo"]],
        p: [[10, 12], [17, 24], [20, 21.5], [28, 37], [31, 34.5], [38, 46], [43, 40], [47, 37], [52, 31.7], [58, 40], [61, 38.5], [66, 47.5]],
        f: [[66, 47.5], [72, 56], [76, 53], [84, 67.5], [88, 64.5], [97, 88]],
        l: [["mm20", "MM20", [[0, 2], [100, 38.8]]], ["stop", "", [[83, 30.2], [83, 46.6], [98, 46.6]]]],
        n: [["e", 47.5, CS, 40, 3], ["s", 30.2, "", 54, 4], ["a", 65.7, "100%", 66, 5, "ALVO 1"], ["a", 86.7, "161,8%", 66, 6, "ALVO 2"]],
        t: [[7.5, 12, "A", "e", 1], [38, 50.5, "B", "m", 1], [52, 26.6, "C", "m", 1], [1.5, 33.5, "23,6% a 50%"], [81.5, 38.5, SOBE, "e"]],
        m: [[27, 23, 1], [45, 30, 2]],
      },
    },
    E10: {
      nome: "XTRADERS: Keltner lateral",
      frase: "Em dia sem direção, {comprar|vender} o exagero na banda de Keltner e sair no meio do canal, na média de 20.",
      passos: [
        ["Só em dia lateral", "Intraday, a partir do 7º candle do dia. A VWAP está plana (andou no máximo 0,3 ATR em 6 candles), as médias longas (MME200 e MME500) estão misturadas com os preços do dia e o preço está dentro da faixa de ontem."],
        ["Toque na banda de Keltner", "O canal é a média exponencial de 20 (MME20) com bandas a 2,0 e 2,5 ATR. O candle encosta na banda de 2,0 {de baixo|de cima} (ou passa dela) e fecha de volta para dentro, com o IFR de 9 períodos em {35 ou menos|65 ou mais} nesse candle ou no anterior."],
        MERCADO,
        ["Stop", "0,25 ATR além do mais distante entre {a mínima|a máxima} do candle de sinal e a banda de 2,5. O risco não pode passar de 2,5 ATR."],
        ["Alvo", "A MME20, o meio do canal, no valor que ela tinha no candle de sinal. Só entra se o alvo valer pelo menos 60% do risco."],
        ["Quando não opera", "Em dia de tendência, com as médias longas longe dos preços do dia ou a VWAP inclinada, o toque na banda não vale."],
      ],
      des: {
        a: [["kelt", [[0, 80], [59, 78], [100, 76.6], [100, 83.6], [59, 85], [0, 87]]], ["kelt", [[0, 24], [59, 22], [100, 20.6], [100, 13.6], [59, 15], [0, 17]]]],
        p: [[2, 56], [8, 66], [13, 60], [20, 72], [26, 54], [32, 62], [38, 44], [44, 50], [50, 34], [54, 29], [59, 26]],
        f: [[59, 26], [64, 26], [69, 33], [73, 30.5], [80, 41], [84, 39], [92, 50.8]],
        v: [[59, 29, 30.5, 18.5, 26]],
        l: [["mm20", "", [[0, 52], [59, 50], [100, 48.6]]], ["kelt", "", [[0, 80], [59, 78], [100, 76.6]], 1], ["kelt", "", [[0, 87], [59, 85], [100, 83.6]], 1],
          ["kelt", "", [[0, 24], [59, 22], [100, 20.6]], 1], ["kelt", "", [[0, 17], [59, 15], [100, 13.6]], 1]],
        n: [["a", 50, "MME20", 59, 5], ["e", 26, CM, 62, 3], ["s", 11, "", 57, 4]],
        b: [[64, 26, "ent"]],
        t: [[98.5, 91, "MME20 ± 2,5 ATR", "e"], [98.5, 72, "MME20 ± 2,0 ATR", "e"], [55, 7, "IFR(9) {≤ 35|≥ 65}", "e"]],
        m: [[10, 40, 1], [33.5, 7, 2]],
      },
    },
    E11: {
      nome: "Momentum do dia (faixa de ruído)",
      frase: "Quando o preço sai do movimento normal do dia, seguir a direção até ele voltar para a faixa ou o pregão acabar.",
      passos: [
        ["A faixa de ruído", "Só no intraday. Para cada horário, o robô mede quanto o preço costuma se afastar da abertura até aquela hora (média dos 14 pregões anteriores). Isso forma uma faixa que vai abrindo ao longo do dia; a borda {de cima|de baixo} parte {do maior|do menor} entre a abertura de hoje e o fechamento de ontem."],
        ["Sinal: o preço sai da faixa", "Nas horas cheias e nas meias horas, o candle fecha {acima|abaixo} da borda {de cima|de baixo} da faixa e também {acima|abaixo} da VWAP: o movimento do dia está maior que o normal."],
        MERCADO,
        ["Stop de proteção", "1 ATR {abaixo|acima} do nível rompido. O estudo original não usa stop fixo; aqui ele existe para o risco ser conhecido."],
        ["Saída: o stop móvel", "Não há alvo: nas horas cheias e meias horas, se o candle fechar de volta {abaixo|acima} da faixa ou da VWAP (vale {a mais alta|a mais baixa} das duas), a posição sai na abertura do candle seguinte. O que sobrar é zerado no fim do pregão."],
      ],
      des: {
        h: [6],
        a: [["neutro", [[6, 36], [100, 66], [100, 6]]]],
        p: [[6, 36], [11, 39], [15, 35], [20, 38.5], [25, 34.5], [30, 40], [34, 39], [38, 50]],
        f: [[38, 50], [42, 50.5], [47, 58], [50, 56], [57, 68], [60, 66], [67, 78], [70, 75], [75, 67], [79, 56], [83, 56]],
        l: [["neutro", "", [[6, 36], [100, 66]], 1], ["neutro", "", [[6, 36], [100, 6]], 1], ["vwap", "VWAP", [[6, 36], [40, 37], [70, 40.5], [100, 42]]]],
        n: [["e", 50.5, CM, 40, 3], ["s", 33.5, "a 1 ATR", 38, 4]],
        b: [[42, 50.5, "ent"], [83, 56, "neutro"]],
        t: [[7.5, 96, "abertura"], [63.5, 27, "faixa de ruído"], [90.8, 56, "saída"]],
        m: [[60, 27, 1], [35.5, 56, 2], [87.5, 56, 5]],
      },
    },
    E12: {
      nome: "Fibo ABC: 3 alvos projetados",
      frase: "{Comprar|Vender} a retomada depois de uma correção de 38,2% a 50% da pernada, com stop no início dela e três alvos projetados por Fibonacci.",
      passos: [
        ["Pernada A→B com médias alinhadas", "MM9 {acima|abaixo} da MM20, MM20 {acima|abaixo} da MM200 e MM20 {subindo|caindo}. A pernada de A até B tem pelo menos 2 ATR e B já é um pivô confirmado: pelo menos 2 candles depois dele, nenhum {mais alto|mais baixo}."],
        ["Correção até C", "O preço devolve pelo menos 38,2% e no máximo 50% da pernada. Passou de 50%, não vale."],
        ["Candle de reversão", "Colado em C (no próprio candle de C ou até 2 candles depois): um candle de {alta|baixa} que fecha na metade {de cima|de baixo} dele e {acima|abaixo} do fechamento anterior."],
        ["Entrada", "Ordem de {compra|venda} stop 1 tick {acima da máxima|abaixo da mínima} do candle de reversão, desde que ainda {abaixo do topo|acima do fundo} B." + VALE2],
        ["Stop largo", "1 tick {abaixo|acima} de A, o início da pernada. O risco fica entre 0,5 e 4 ATR: confira quanto do capital isso representa."],
        ["Três alvos de Fibonacci", "A pernada é projetada a partir de C: 61,8%, 100% e 161,8%. Só há ordem se o alvo 1 ficar além da entrada."],
        TERCOS,
      ],
      des: {
        z: [[0, 28, 62, 32.25, "fibo"]],
        p: [[10, 10], [16, 21], [19, 18.5], [27, 35], [30, 32.5], [36, 46], [41, 40], [45, 37], [49, 33], [52, 29.8], [56, 36]],
        f: [[56, 36], [61, 41], [64, 39.5], [72, 53], [75, 51], [83, 66.5], [86, 64], [96, 89]],
        v: [[56, 31, 36.5, 30.5, 36]],
        l: [["mm20", "MM20", [[0, 3], [100, 23]]], ["stop", "", [[71.5, 8.5], [71.5, 37.1], [82.6, 37.1], [82.6, 51.2], [97, 51.2]]]],
        n: [["e", 38, CS, 54, 4], ["s", 8.5, "{abaixo|acima} de A", 10, 5], ["a", 52.05, "61,8%", 56, 6, "ALVO 1"], ["a", 65.8, "100%", 56, 6, "ALVO 2"], ["a", 88.05, "161,8%", 56, 6, "ALVO 3"]],
        t: [[7.5, 10, "A", "e", 1], [36, 50.5, "B", "m", 1], [52, 24.8, "C", "m", 1], [1.5, 36, "38,2% a 50%"], [78.5, 28.5, SOBE]],
        m: [[26, 22, 1], [46, 22.5, 2], [61, 30, 3], [75, 28.5, 7]],
      },
    },
    E13: {
      nome: "Fibo 50: ordem limitada na pernada",
      frase: "Deixar uma ordem limitada na metade da pernada e esperar o preço vir buscar, sem candle de confirmação.",
      passos: [
        ["Pernada forte A→B", "MM20 e preço {acima|abaixo} da MM200. A pernada tem pelo menos 2,5 ATR, B é um pivô confirmado e, em B, as médias estavam alinhadas (MM9 {acima|abaixo} da MM20 e MM20 {acima|abaixo} da MM200)."],
        ["Ordem limitada nos 50%", "O robô deixa uma {compra|venda} limitada parada exatamente na metade da pernada, sem esperar candle de confirmação. Ela só executa se o preço passar 1 tick além do limite."],
        ["Enquanto a ordem vale", "Enquanto o preço não fizer {topo|fundo} novo e por até 20 candles depois de B. Passou disso, a ordem sai."],
        ["Stop largo", "1 tick {abaixo|acima} de A, o início da pernada. O risco fica entre 0,5 e 4 ATR: confira quanto do capital isso representa."],
        ["Três alvos ancorados na pernada", "{O topo|O fundo} B, 127,2% e 161,8% da pernada (medidos a partir de A)."],
        TERCOS,
      ],
      des: {
        p: [[8, 10], [14, 25], [17, 22], [25, 44], [28, 41], [34, 58], [39, 52], [42, 54.5], [48, 45], [51, 47], [56, 32.5]],
        f: [[56, 32.5], [61, 41], [64, 39], [71, 53], [73, 51], [78, 59.5], [81, 57], [87, 72.5], [89, 70.5], [96, 89]],
        l: [["mm20", "MM20", [[0, 2], [100, 22]]], ["stop", "", [[77.1, 8.5], [77.1, 33.1], [86.4, 33.1], [86.4, 57.1], [97, 57.1]]]],
        n: [["e", 34, CL, 36, 2], ["s", 8.5, "{abaixo|acima} de A", 8, 4], ["a", 58, "{topo|fundo} B", 56, 5, "ALVO 1"], ["a", 71.06, "127,2%", 56, 5, "ALVO 2"], ["a", 87.66, "161,8%", 56, 5, "ALVO 3"]],
        b: [[55.5, 34, "ent"]],
        t: [[5.5, 10, "A", "e", 1], [34, 62.5, "B", "m", 1], [34.5, 34, "50%", "e"], [83.3, 27, SOBE]],
        m: [[25, 27, 1], [45, 39.5, 3], [80.3, 27, 6]],
      },
    },
    TODAS: {
      nome: "TODAS juntas",
      frase: "Todas as estratégias vigiam o mercado ao mesmo tempo, mas só existe uma operação por vez: a primeira ordem executada vence e cancela as outras.",
      passos: [
        ["Todas procuram ao mesmo tempo", "A cada candle fechado, cada estratégia confere as próprias regras e, se o setup dela estiver pronto, arma a própria ordem. Várias ordens podem ficar armadas juntas. No gráfico diário, as que só funcionam no intraday ficam de fora."],
        ["A primeira que executar vale", "Só existe uma posição por vez. A primeira ordem que o preço executar abre a operação."],
        ["As outras são canceladas", "No instante da entrada, todas as outras ordens pendentes são canceladas. Enquanto a operação estiver aberta, nenhuma estratégia arma ordem nova."],
        ["A operação segue as regras de quem entrou", "Stop, alvos e saída são os da estratégia que executou (no desenho, a E1: alvo a 2 vezes o risco). As regras de uma não se misturam com as de outra."],
        ["O limite de stops é do conjunto", "No intraday, o limite de stops por dia de ⚙ Ajustes vale para todas juntas: ao atingi-lo, nenhuma estratégia entra mais naquele dia."],
      ],
      des: {
        p: [[2, 44], [8, 51], [13, 47.5], [20, 55], [26, 51.5], [33, 57.5], [40, 54], [46, 59], [50, 62]],
        f: [[50, 62], [56, 68], [60, 65.5], [70, 78], [74, 75], [84, 87], [89, 91]],
        l: [["ent", "", [[18, 80], [50, 80]]], ["ent", "", [[18, 36], [50, 36]]]],
        n: [["e", 62, "E1 executou", 18, 2], ["s", 48, "da E1", 50, 4], ["a", 90, "da E1", 50, 4]],
        b: [[50, 62, "ent"]],
        t: [[18, 84.5, "E9 · {compra|venda} stop"], [18, 66.5, "E1 · {compra|venda} stop"], [18, 40.5, "E13 · {compra|venda} limitada"], [51.8, 80, "×", "", 1], [51.8, 36, "×", "", 1], [60.5, 36, "canceladas"]],
        m: [[13, 73, 1], [47, 71, 2], [56.5, 36, 3]],
      },
    },
  };

  // ---------------------------------------------------------------- desenho (SVG)
  const W = 520, H = 232, X0 = 10, LX = 3.54, Y0 = 14, LY = 2.04, GX = X0 + 100 * LX;     // à direita de GX fica a coluna das etiquetas
  const RAIO = 8, VAO = 2 * RAIO + 1;
  const COR = { mm5: "var(--laranja, #ffa53a)", mm9: "var(--laranja, #ffa53a)", mm20: "var(--azul)", mm200: "var(--roxo)", vwap: "var(--amar)",
    fibo: "var(--amar)", kelt: "#2bb5a0", neutro: "var(--txt2)", stop: "var(--verm)", alvo: "var(--verde2)" };
  const r1 = (v) => Math.round(v * 10) / 10;

  function svgDe(d, venda, nome) {
    // A venda é o espelho da compra: basta inverter o Y de cada ponto. As letras nunca são espelhadas (só mudam de lugar).
    const X = (x) => r1(X0 + x * LX), Y = (y) => r1(Y0 + (venda ? y : 100 - y) * LY);
    const cor = (k) => (k === "ent" ? (venda ? "var(--fucsia)" : "var(--aqua)") : COR[k] || k);
    const pts = (a) => a.map((q) => X(q[0]) + "," + Y(q[1])).join(" ");
    const txt = (s) => AX.esc(lado(s, venda));
    const bola = (x, y, n) => `<circle class="ex-bola" cx="${x}" cy="${y}" r="${RAIO}"/><text class="ex-bolan" x="${x}" y="${y}" dy=".35em" text-anchor="middle">${n}</text>`;
    const rot = [];                // etiquetas da coluna da direita (níveis e linhas que chegam até ela)
    let s = "";
    for (const [x1, y1, x2, y2, c] of d.z || []) s += `<rect class="ex-zona" x="${X(x1)}" y="${Math.min(Y(y1), Y(y2))}" width="${r1((x2 - x1) * LX)}" height="${r1(Math.abs(y2 - y1) * LY)}" style="fill:${cor(c)}"/>`;
    for (const [c, a] of d.a || []) s += `<polygon class="ex-zona" points="${pts(a)}" style="fill:${cor(c)}"/>`;
    for (const x of d.h || []) s += `<line class="ex-fio" x1="${X(x)}" y1="${Y0 - 6}" x2="${X(x)}" y2="${r1(Y0 + 100 * LY + 6)}"/>`;
    for (const [tp, y, t, x1, passo, tag] of d.n || []) {
      const c = cor({ e: "ent", s: "stop", a: "alvo" }[tp] || "neutro");
      if (x1 >= 0) s += `<line class="${tp === "r" ? "ex-fio" : "ex-nivel"}" x1="${X(x1)}" y1="${Y(y)}" x2="${GX}" y2="${Y(y)}" style="stroke:${c}"/>`;
      rot.push({ y: Y(y), c, t, passo, tag: tag || { s: "STOP", a: "ALVO" }[tp], fio: tp === "r", solta: x1 < 0 });
    }
    for (const [c, t, a, fina] of d.l || []) {
      const u = a[a.length - 1];
      s += `<polyline class="ex-ind${fina ? " ex-fina" : ""}" points="${pts(a)}" style="stroke:${cor(c)}"/>`;
      if (t && u[0] >= 100) rot.push({ y: Y(u[1]), c: cor(c), t });                // a linha chega à borda: o nome vai para a coluna
      else if (t) s += `<text class="ex-t" x="${X(u[0] + 1.5)}" y="${Y(u[1])}" dy=".35em">${txt(t)}</text>`;
    }
    if (d.p) s += `<polyline class="ex-preco" points="${pts(d.p)}"/>`;
    if (d.f) s += `<polyline class="ex-preco ex-depois" points="${pts(d.f)}"/>`;
    for (const [x, o, h, l, c] of d.v || []) {
      const yo = Y(o), yc = Y(c);  // candle de alta = fechou mais alto NA TELA (no espelho o mesmo candle vira de baixa)
      s += `<line class="ex-pavio" x1="${X(x)}" y1="${Y(h)}" x2="${X(x)}" y2="${Y(l)}"/><rect class="ex-vela${yc < yo ? "" : " ex-cai"}" x="${r1(X(x) - 5.5)}" y="${Math.min(yo, yc)}" width="11" height="${r1(Math.max(2, Math.abs(yo - yc)))}"/>`;
    }
    for (const [x, y, c] of d.b || []) s += `<circle class="ex-ponto" cx="${X(x)}" cy="${Y(y)}" r="3.5" style="fill:${cor(c)}"/>`;
    for (const [x, y, t, anc, forte] of d.t || []) s += `<text class="ex-t${forte ? " ex-forte" : ""}" x="${X(x)}" y="${Y(y)}" dy=".35em"${anc ? ` text-anchor="${anc === "m" ? "middle" : "end"}"` : ""}>${txt(t)}</text>`;
    for (const [x, y, n] of d.m || []) s += bola(X(x), Y(y), n);
    // Coluna das etiquetas: cada uma na altura da sua linha. Quando duas caem perto demais (muda com o espelho), afasto de
    // cima para baixo e, se a última passou do fim, empurro de volta de baixo para cima; um fio liga a etiqueta à linha.
    rot.sort((a, b) => a.y - b.y);
    rot.forEach((r, i) => { r.ye = Math.max(r.y, i ? rot[i - 1].ye + VAO : RAIO + 2); });
    for (let i = rot.length - 1, teto = H - RAIO - 2; i >= 0; teto = rot[i].ye - VAO, i--) rot[i].ye = r1(Math.min(rot[i].ye, teto));
    s += `<line class="ex-fio" x1="${GX}" y1="4" x2="${GX}" y2="${H - 4}"/>`;
    for (const r of rot) {
      let x = GX + 9;
      if (!r.solta && Math.abs(r.ye - r.y) > 0.5) s += `<polyline class="ex-ind ex-fina" points="${GX},${r.y} ${x - 2},${r.ye}" style="stroke:${r.c}"/>`;
      if (r.passo) { s += bola(x + RAIO, r.ye, r.passo); x += 2 * RAIO + 4; }
      if (r.tag) {                 // STOP e ALVO: etiqueta cheia com a palavra dentro (a cor sozinha não diz nada)
        const w = r1(r.tag.length * 6.4 + 9);
        s += `<rect class="ex-tag" x="${x}" y="${r1(r.ye - 7.5)}" width="${w}" height="15" rx="3" style="fill:${r.c}"/><text class="ex-tagt" x="${r1(x + w / 2)}" y="${r.ye}" dy=".35em" text-anchor="middle">${r.tag}</text>`;
        x += w + 5;
      } else {                     // os outros: risquinho da cor da linha + nome na cor normal do texto
        s += `<line class="${r.fio ? "ex-fio" : "ex-nivel"}" x1="${x}" y1="${r.ye}" x2="${x + 13}" y2="${r.ye}" style="stroke:${r.c}"/>`;
        x += 18;
      }
      if (r.t) s += `<text class="ex-g" x="${r1(x)}" y="${r.ye}" dy=".35em">${txt(r.t)}</text>`;
    }
    return `<svg class="ex-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${AX.esc(`Desenho esquemático de ${nome}, operação de ${venda ? "venda" : "compra"}`)}">${s}</svg>`;
  }

  // ---------------------------------------------------------------- janela
  let fundo = null, aberto = null, venda = false, focoAntes = null, baixouNoFundo = false;
  const el = (cls) => fundo.querySelector("." + cls);

  function montar() {
    fundo = document.createElement("div");
    fundo.className = "ex-fundo";
    fundo.hidden = true;
    // O ✕ leva title e não data-dica: o balão das dicas também abre quando o botão ganha foco pelo teclado, e como o
    // foco nasce nele o balão taparia o botão Compra / Venda assim que a janela abrisse.
    fundo.innerHTML = `<div class="ex-janela" role="dialog" aria-modal="true" aria-labelledby="exTitulo" tabindex="-1">
        <div class="ex-topo"><div class="ex-cab"><h2 class="ex-titulo" id="exTitulo"></h2><div class="ex-autor"></div></div>
          <button type="button" class="ex-fechar" aria-label="Fechar a explicação" title="Fechar (Esc)">✕</button></div>
        <div class="ex-corpo" tabindex="0" role="region" aria-label="Explicação da estratégia"></div>
        <div class="ex-rodape">${AX.esc(NOTA)}</div>
      </div>`;
    document.body.appendChild(fundo);
    // Fecha só se o clique COMEÇOU e terminou no fundo escuro: quem arrasta para marcar um texto e solta o botão fora
    // da janela também gera um "click" no fundo, e a janela não pode sumir por causa disso.
    fundo.addEventListener("pointerdown", (e) => { baixouNoFundo = e.target === fundo; });
    fundo.addEventListener("click", (e) => {
      if (e.target === fundo) { if (baixouNoFundo) fechar(); return; }
      const b = e.target.closest("button");
      if (!b) return;
      if (b.classList.contains("ex-fechar")) fechar();
      else if (b.dataset.v) { venda = b.dataset.v === "1"; pintarLado(); }
    });
    fundo.addEventListener("keydown", (e) => {
      // Com a janela aberta nenhuma tecla pode chegar aos atalhos do gráfico: o espaço do replay, por exemplo, cancela
      // a tecla e o botão em foco aqui dentro nem seria acionado; Delete apagaria um desenho escondido atrás da janela.
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); fechar(); return; }
      const corpo = el("ex-corpo"), anda = { ArrowDown: 40, ArrowUp: -40, PageDown: 0.9, PageUp: -0.9 }[e.key];
      if (anda && !corpo.contains(document.activeElement)) {      // o foco nasce no ✕, fora do miolo: as setas rolam o texto mesmo assim
        e.preventDefault(); corpo.scrollTop += Math.abs(anda) < 1 ? anda * corpo.clientHeight : anda;
        return;
      }
      if (e.key !== "Tab") return;
      const f = [...fundo.querySelectorAll("button, summary, .ex-corpo")], i = f.indexOf(document.activeElement);
      if (e.shiftKey ? i <= 0 : i === f.length - 1) { e.preventDefault(); f[e.shiftKey ? f.length - 1 : 0].focus(); }      // o foco dá a volta sem sair da janela
    });
  }

  function pintarLado() {            // tudo o que muda entre compra e venda: desenho, passos, frase e o botão marcado
    const E = EST[aberto];
    if (!E) return;
    el("ex-desenho").innerHTML = svgDe(E.des, venda, aberto === "TODAS" ? "TODAS juntas" : aberto);
    el("ex-passos").innerHTML = E.passos.map(([t, x], i) =>
      `<li><span class="ex-num" aria-hidden="true">${i + 1}</span><div><b>${AX.esc(lado(t, venda))}</b><p>${AX.esc(lado(x, venda))}</p></div></li>`).join("");
    el("ex-frase").textContent = lado(E.frase, venda);
    fundo.querySelectorAll(".ex-lado button").forEach((b) => {
      const on = (b.dataset.v === "1") === venda;
      b.classList.toggle("ex-on", on); b.setAttribute("aria-pressed", String(on));
    });
  }

  function abrir(cod, dir) {
    cod = String(cod || "").toUpperCase();
    const E = EST[cod], cfg = AX.cfg || null;              // AX.cfg chega do servidor depois deste arquivo: só é lido aqui
    const c = cfg && cfg.estMap && cod !== "TODAS" ? cfg.estMap[cod] : null;
    if (!E && !c) return false;                            // código desconhecido: não há o que mostrar
    if (!fundo) montar();
    if (fundo.hidden) focoAntes = document.activeElement;  // reabrir com outra estratégia não perde para onde o foco volta
    aberto = cod; venda = dir < 0;
    const todas = cod === "TODAS", nome = (c && c.nome) || (E ? E.nome : cod);
    el("ex-titulo").innerHTML = todas ? AX.esc(nome) : `<span class="ex-cod">${AX.esc(cod)}</span> · ${AX.esc(nome)}`;
    el("ex-autor").textContent = todas ? `Modo que roda ${cfg && cfg.estrategias ? "as " + cfg.estrategias.length : "todas as"} estratégias ao mesmo tempo` : (c && c.autor) || "";
    const g = AX.pref && AX.pref.gestao, gTxt = cfg && cfg.gestoes && g && g !== "padrao" ? cfg.gestoes[g] : "";
    let h = "";
    if (E) {
      h += `<div class="ex-quadro"><div class="ex-barra"><span class="ex-leg">Desenho esquemático, fora de escala</span>
          <div class="ex-lado" role="group" aria-label="Lado da operação"><button type="button" data-v="0">Compra</button><button type="button" data-v="1">Venda</button></div></div>
          <div class="ex-desenho"></div></div>
        <p class="ex-mini">A venda é o espelho exato da compra. O trecho mais apagado do preço, depois da entrada, mostra só o caso em que a operação dá certo.</p>
        ${gTxt ? `<p class="ex-aviso">A gestão escolhida agora é “${AX.esc(gTxt)}”, não a padrão ${todas ? "de cada estratégia" : "desta estratégia"}. Ela troca os alvos e a saída descritos abaixo; a entrada e o stop inicial continuam os mesmos.</p>` : ""}
        <h3 class="ex-sec">Passo a passo</h3><ol class="ex-passos"></ol>
        <p class="ex-mini">${AX.esc(GLOSSARIO)}</p>
        <h3 class="ex-sec">Em uma frase</h3><p class="ex-frase"></p>`;
    } else h += `<p class="ex-aviso">Ainda não há desenho nem passo a passo para esta estratégia. As regras que o robô executa estão abaixo.</p>`;
    if (c && c.ideal) h += `<h3 class="ex-sec">Onde costuma se encaixar</h3><p class="ex-ideal">${AX.esc(c.ideal)}</p>`;
    if (c && Array.isArray(c.regras) && c.regras.length) h += `<details class="ex-regras"${E ? "" : " open"}><summary>Regras exatas (as que o robô executa)</summary>
        <ul>${c.regras.map((r) => `<li>${AX.esc(r)}</li>`).join("")}</ul></details>`;
    const corpo = el("ex-corpo");
    corpo.innerHTML = h;
    pintarLado();
    fundo.hidden = false;
    corpo.scrollTop = 0;                                   // só depois de mostrar: escondida, a caixa não tem rolagem para zerar
    el("ex-fechar").focus();
    return true;
  }

  function fechar() {
    if (!fundo || fundo.hidden) return;
    fundo.hidden = true; aberto = null;
    // devolve o foco a quem abriu; se a tela redesenhou aquele botão nesse meio tempo, vai para o novo com o mesmo id
    const a = focoAntes, alvo = a && (a.isConnected ? a : a.id && document.getElementById(a.id));
    focoAntes = null;
    if (alvo && alvo.focus) alvo.focus();
  }

  if (AX.on) AX.on("tecla", (e) => { if (e.key === "Escape") fechar(); });      // Esc com o foco fora da janela
  AX.explica = { abrir, fechar };
})();
