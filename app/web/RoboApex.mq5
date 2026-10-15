//+------------------------------------------------------------------+
//| RoboApex.mq5                                                     |
//| Liga o MetaTrader 5 ao Robo Apex.                                |
//|                                                                  |
//| O que este EA faz:                                               |
//|  1. Manda ao robo os candles de 1 minuto do grafico (dados da    |
//|     sua corretora, em tempo real).                               |
//|  2. Pergunta ao robo, a cada poucos segundos, o que o teste ao   |
//|     vivo escolhido na aba Conectar quer: ordem armada, posicao   |
//|     com stop e alvo, ou nada.                                    |
//|  3. Envia, muda e cancela as ordens NA SUA CONTA, dentro do seu  |
//|     MetaTrader, so com o Algo Trading ligado por voce.           |
//|                                                                  |
//| Travas: so opera em conta DEMO (a nao ser que voce mude a opcao  |
//| SomenteDemo E permita conta real no robo), lote maximo, perda    |
//| maxima no dia e o botao LIGADO/DESLIGADO do robo.                |
//|                                                                  |
//| Antes de usar: Ferramentas > Opcoes > Expert Advisors > marque   |
//| "Permitir WebRequest para as URLs listadas" e adicione o endereco|
//| do robo (por padrao http://127.0.0.1:8765).                      |
//|                                                                  |
//| Voce e o unico responsavel pelas ordens enviadas pela sua conta. |
//+------------------------------------------------------------------+
#property copyright "Robo Apex"
#property version   "1.00"
#property description "Liga o MetaTrader 5 ao Robo Apex (aba Conectar). Use primeiro em conta DEMO."

#include <Trade\Trade.mqh>

input string Codigo         = "";                      // Codigo de conexao (aba Conectar do robo)
input string Servidor       = "http://127.0.0.1:8765"; // Endereco do robo
input bool   SomenteDemo    = true;                    // So operar em conta DEMO
input double LoteMaximo     = 1.0;                     // Lote maximo por ordem (trava do EA)
input double PerdaMaximaDia = 0.0;                     // Perda maxima no dia, na moeda da conta (0 = sem limite)
input long   Magico         = 7031;                    // Numero magico das ordens do robo
input int    Intervalo      = 2;                       // Segundos entre as consultas ao robo

CTrade trade;
string g_eventos = "";
bool   g_historico = false;
int    g_contagem = 0;
string g_usados[];                                     // ordens que este EA ja enviou (nunca envia a mesma duas vezes)
string g_ultimoAviso = "";
datetime g_diaUsados = 0;

//+------------------------------------------------------------------+
string Esc(string s)
  {
   StringReplace(s, "\\", "/");
   StringReplace(s, "\"", "'");
   StringReplace(s, "\n", " ");
   StringReplace(s, "\r", " ");
   return s;
  }

void Evento(string tipo, string detalhe)
  {
   Print("Robo Apex: ", tipo, ": ", detalhe);
   if(StringLen(g_eventos) > 6000)
      return;
   if(g_eventos != "")
      g_eventos += ",";
   g_eventos += "{\"tipo\":\"" + Esc(tipo) + "\",\"detalhe\":\"" + Esc(detalhe) + "\"}";
  }

void Aviso(string tipo, string detalhe)                 // o mesmo aviso nao e repetido a cada consulta
  {
   if(g_ultimoAviso == tipo + detalhe)
      return;
   g_ultimoAviso = tipo + detalhe;
   Evento(tipo, detalhe);
  }

bool Pedir(string metodo, string caminho, string corpo, string &resposta)
  {
   char dados[];
   char res[];
   string cabRes;
   string cab = "X-Apex-Token: " + Codigo + "\r\n";
   if(metodo == "POST")
     {
      cab += "Content-Type: application/json\r\n";
      int n = StringToCharArray(corpo, dados, 0, WHOLE_ARRAY, CP_UTF8);
      if(n > 0)
         ArrayResize(dados, n - 1);                     // sem o zero do fim da string
     }
   ResetLastError();
   int r = WebRequest(metodo, Servidor + caminho, cab, 8000, dados, res, cabRes);
   if(r == -1)
     {
      int e = GetLastError();
      if(e == 4014)
         Aviso("conexao", "permita o endereco " + Servidor + " em Ferramentas > Opcoes > Expert Advisors > WebRequest");
      else
         Aviso("conexao", "o robo nao respondeu (erro " + IntegerToString(e) + "). Ele esta aberto?");
      return false;
     }
   resposta = CharArrayToString(res, 0, WHOLE_ARRAY, CP_UTF8);
   if(r != 200)
     {
      Aviso("conexao", "o robo recusou (HTTP " + IntegerToString(r) + "): " + resposta);
      return false;
     }
   return true;
  }

//+------------------------------------------------------------------+
int OnInit()
  {
   if(StringLen(Codigo) < 20)
     {
      Alert("Robo Apex: cole o codigo de conexao (aba Conectar do robo) nas entradas do EA.");
      return INIT_PARAMETERS_INCORRECT;
     }
   if(SomenteDemo && AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO)
     {
      Alert("Robo Apex: esta conta nao e DEMO. O EA esta travado em conta demo (opcao SomenteDemo).");
      return INIT_FAILED;
     }
   trade.SetExpertMagicNumber(Magico);
   trade.SetDeviationInPoints(20);
   trade.SetTypeFillingBySymbol(_Symbol);
   EventSetTimer(MathMax(1, Intervalo));
   Evento("inicio", "EA iniciado em " + _Symbol + " (conta " + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + ")");
   return INIT_SUCCEEDED;
  }

void OnDeinit(const int reason)
  {
   EventKillTimer();
   string r;
   Evento("fim", "EA retirado do grafico (motivo " + IntegerToString(reason) + ")");
   EnviarEstado();
  }

void OnTimer()
  {
   g_contagem++;
   EnviarCandles();
   string sinal;
   if(Pedir("GET", "/api/ea/sinal", "", sinal))
      Executar(sinal);
   if(g_contagem % 5 == 1 || g_eventos != "")
      EnviarEstado();
  }

//+------------------------------------------------------------------+
//| candles de 1 minuto para o robo                                  |
//+------------------------------------------------------------------+
void EnviarCandles()
  {
   MqlRates r[];
   int quer = g_historico ? 5 : 30000;
   int n = CopyRates(_Symbol, PERIOD_M1, 0, quer, r);
   if(n <= 0)
      return;
   long off = (long)(TimeTradeServer() - TimeGMT());
   off = (long)MathRound(off / 900.0) * 900;           // fuso do servidor em quartos de hora
   string s = "{\"simbolo\":\"" + Esc(_Symbol) + "\",\"offset\":" + IntegerToString(off) + ",\"barras\":[";
   for(int i = 0; i < n; i++)
     {
      if(i > 0)
         s += ",";
      s += "[" + IntegerToString((long)r[i].time) + "," + DoubleToString(r[i].open, _Digits) + "," + DoubleToString(r[i].high, _Digits) + ","
           + DoubleToString(r[i].low, _Digits) + "," + DoubleToString(r[i].close, _Digits) + "," + IntegerToString((long)r[i].tick_volume) + "]";
     }
   s += "]}";
   string resp;
   if(Pedir("POST", "/api/ea/candles", s, resp) && !g_historico)
     {
      g_historico = true;
      Evento("candles", IntegerToString(n) + " candles de 1 minuto enviados ao robo");
     }
  }

//+------------------------------------------------------------------+
//| conta e posicoes para o robo                                     |
//+------------------------------------------------------------------+
void EnviarEstado()
  {
   long modo = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   string tipo = modo == ACCOUNT_TRADE_MODE_DEMO ? "DEMO" : (modo == ACCOUNT_TRADE_MODE_REAL ? "REAL" : "CONCURSO");
   string pos = "";
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != Magico)
         continue;
      if(pos != "")
         pos += ",";
      pos += "{\"lado\":" + (PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? "1" : "-1") + ",\"volume\":" + DoubleToString(PositionGetDouble(POSITION_VOLUME), 2)
             + ",\"preco\":" + DoubleToString(PositionGetDouble(POSITION_PRICE_OPEN), _Digits) + ",\"sl\":" + DoubleToString(PositionGetDouble(POSITION_SL), _Digits)
             + ",\"tp\":" + DoubleToString(PositionGetDouble(POSITION_TP), _Digits) + ",\"lucro\":" + DoubleToString(PositionGetDouble(POSITION_PROFIT), 2) + "}";
     }
   string s = "{\"conta\":\"" + IntegerToString(AccountInfoInteger(ACCOUNT_LOGIN)) + "\",\"tipo\":\"" + tipo + "\",\"corretora\":\"" + Esc(AccountInfoString(ACCOUNT_COMPANY))
              + "\",\"servidor\":\"" + Esc(AccountInfoString(ACCOUNT_SERVER)) + "\",\"saldo\":" + DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2)
              + ",\"patrimonio\":" + DoubleToString(AccountInfoDouble(ACCOUNT_EQUITY), 2) + ",\"moeda\":\"" + Esc(AccountInfoString(ACCOUNT_CURRENCY))
              + "\",\"simbolo\":\"" + Esc(_Symbol) + "\",\"versao\":\"1.00\",\"resultadoDia\":" + DoubleToString(ResultadoDia(), 2)
              + ",\"posicoes\":[" + pos + "],\"eventos\":[" + g_eventos + "]}";
   string resp;
   if(Pedir("POST", "/api/ea/estado", s, resp))
      g_eventos = "";
  }

double ResultadoDia()
  {
   MqlDateTime t;
   TimeToStruct(TimeTradeServer(), t);
   t.hour = 0;
   t.min = 0;
   t.sec = 0;
   datetime ini = StructToTime(t);
   double soma = 0;
   if(!HistorySelect(ini, TimeTradeServer() + 60))
      return 0;
   for(int i = HistoryDealsTotal() - 1; i >= 0; i--)
     {
      ulong d = HistoryDealGetTicket(i);
      if(d == 0 || HistoryDealGetInteger(d, DEAL_MAGIC) != Magico || HistoryDealGetString(d, DEAL_SYMBOL) != _Symbol)
         continue;
      soma += HistoryDealGetDouble(d, DEAL_PROFIT) + HistoryDealGetDouble(d, DEAL_COMMISSION) + HistoryDealGetDouble(d, DEAL_SWAP);
     }
   return soma;
  }

//+------------------------------------------------------------------+
//| auxiliares de preco e volume                                     |
//+------------------------------------------------------------------+
double Tick()
  {
   double t = SymbolInfoDouble(_Symbol, SYMBOL_TRADE_TICK_SIZE);
   return t > 0 ? t : _Point;
  }
double Preco(string txt)
  {
   if(txt == "")
      return 0;
   double p = StringToDouble(txt);
   if(p <= 0)
      return 0;
   double t = Tick();
   return NormalizeDouble(MathRound(p / t) * t, _Digits);
  }
double Volume(double q)
  {
   double mn = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MIN), mx = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_MAX), st = SymbolInfoDouble(_Symbol, SYMBOL_VOLUME_STEP);
   if(st <= 0)
      st = 1;
   q = MathMin(q, LoteMaximo);
   q = MathFloor(q / st + 1e-9) * st;
   if(q < mn)
      return 0;
   return MathMin(q, mx);
  }
bool Usado(string id)
  {
   for(int i = 0; i < ArraySize(g_usados); i++)
      if(g_usados[i] == id)
         return true;
   return false;
  }
void Usar(string id)
  {
   int n = ArraySize(g_usados);
   ArrayResize(g_usados, n + 1);
   g_usados[n] = id;
  }

bool MinhaPosicao(long &lado, double &vol, double &sl, double &tp, ulong &ticket)
  {
   for(int i = PositionsTotal() - 1; i >= 0; i--)
     {
      ulong tk = PositionGetTicket(i);
      if(tk == 0 || PositionGetString(POSITION_SYMBOL) != _Symbol || PositionGetInteger(POSITION_MAGIC) != Magico)
         continue;
      lado = PositionGetInteger(POSITION_TYPE) == POSITION_TYPE_BUY ? 1 : -1;
      vol = PositionGetDouble(POSITION_VOLUME);
      sl = PositionGetDouble(POSITION_SL);
      tp = PositionGetDouble(POSITION_TP);
      ticket = tk;
      return true;
     }
   return false;
  }

void CancelarPendentes(string manter = "")
  {
   for(int i = OrdersTotal() - 1; i >= 0; i--)
     {
      ulong tk = OrderGetTicket(i);
      if(tk == 0 || OrderGetString(ORDER_SYMBOL) != _Symbol || OrderGetInteger(ORDER_MAGIC) != Magico)
         continue;
      string c = OrderGetString(ORDER_COMMENT);
      if(manter != "" && StringFind(manter, "|" + c + "|") >= 0)
         continue;
      if(trade.OrderDelete(tk))
         Evento("cancelada", "ordem " + c + " cancelada");
     }
  }

void FecharPosicao(string motivo)
  {
   long lado;
   double vol, sl, tp;
   ulong tk;
   if(MinhaPosicao(lado, vol, sl, tp, tk))
     {
      if(trade.PositionClose(tk))
         Evento("saida", "posicao fechada: " + motivo);
      else
         Evento("erro", "nao consegui fechar a posicao: " + trade.ResultRetcodeDescription());
     }
  }

//+------------------------------------------------------------------+
//| o que o robo quer -> ordens na conta                             |
//+------------------------------------------------------------------+
void Executar(string sinal)
  {
   string linhas[];
   int n = StringSplit(sinal, '\n', linhas);
   bool ok = false, ligado = false, real = false;
   string simbolo = "", pos = "";
   double perdaRobo = 0;
   string ords[];
   ArrayResize(ords, 0);
   for(int i = 0; i < n; i++)
     {
      string l = linhas[i];
      StringTrimLeft(l);
      StringTrimRight(l);
      if(StringFind(l, "OK=") == 0)
         ok = StringSubstr(l, 3) == "1";
      else
         if(StringFind(l, "LIGADO=") == 0)
            ligado = StringSubstr(l, 7) == "1";
         else
            if(StringFind(l, "REAL=") == 0)
               real = StringSubstr(l, 5) == "1";
            else
               if(StringFind(l, "SIMBOLO=") == 0)
                  simbolo = StringSubstr(l, 8);
               else
                  if(StringFind(l, "PERDADIA=") == 0)
                     perdaRobo = StringToDouble(StringSubstr(l, 9));
                  else
                     if(StringFind(l, "POS=") == 0)
                        pos = StringSubstr(l, 4);
                     else
                        if(StringFind(l, "ORD=") == 0)
                          {
                           int k = ArraySize(ords);
                           ArrayResize(ords, k + 1);
                           ords[k] = StringSubstr(l, 4);
                          }
                        else
                           if(StringFind(l, "MOTIVO=") == 0)
                              Aviso("espera", StringSubstr(l, 7));
     }
   if(!ok)
      return;                                          // o robo nao tem certeza agora: nao mexe em nada
   MqlDateTime hoje;
   TimeToStruct(TimeTradeServer(), hoje);
   hoje.hour = 0; hoje.min = 0; hoje.sec = 0;
   if(StructToTime(hoje) != g_diaUsados)
     {
      ArrayResize(g_usados, 0);
      g_diaUsados = StructToTime(hoje);
     }
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE) != ACCOUNT_TRADE_MODE_DEMO && (!real || SomenteDemo))
     {
      Aviso("bloqueio", "conta real sem permissao (libere no EA e na aba Conectar)");
      CancelarPendentes();
      return;
     }
   if(simbolo != "" && simbolo != _Symbol)
     {
      Aviso("simbolo", "o robo espera " + simbolo + " e o EA esta em " + _Symbol);
      return;
     }
   if(!ligado)
     {
      CancelarPendentes();
      return;
     }
   double limite = PerdaMaximaDia;
   if(perdaRobo > 0 && (limite <= 0 || perdaRobo < limite))
      limite = perdaRobo;
   if(limite > 0 && ResultadoDia() <= -limite)
     {
      Aviso("limite", "perda maxima do dia atingida: nada mais e enviado hoje");
      CancelarPendentes();
      FecharPosicao("perda maxima do dia");
      return;
     }
   // ---------------- posicao
   long lado;
   double vol, sl, tp;
   ulong tk;
   bool tenho = MinhaPosicao(lado, vol, sl, tp, tk);
   if(pos == "")
     {
      if(tenho)
         FecharPosicao("o robo saiu da operacao");
     }
   else
     {
      string c[];
      if(StringSplit(pos, ';', c) >= 5)
        {
         long ladoR = StringToInteger(c[1]);
         double nsl = Preco(c[3]), ntp = Preco(c[4]);
         if(tenho && lado != ladoR)
            FecharPosicao("o robo esta do lado contrario");
         else
            if(tenho && (MathAbs(nsl - sl) >= Tick() / 2 || MathAbs(ntp - tp) >= Tick() / 2))
              {
               if(trade.PositionModify(tk, nsl, ntp))
                  Evento("ajuste", "stop " + DoubleToString(nsl, _Digits) + " alvo " + DoubleToString(ntp, _Digits));
               else
                  Aviso("erro", "nao consegui mudar o stop/alvo: " + trade.ResultRetcodeDescription());
              }
            else
               if(!tenho)
                  Aviso("aviso", "o robo esta posicionado, mas a ordem nao executou nesta conta (o EA nao entra atrasado)");
        }
     }
   // ---------------- ordens armadas
   string manter = "|";
   for(int i = 0; i < ArraySize(ords); i++)
     {
      string c[];
      if(StringSplit(ords[i], ';', c) < 7)
         continue;
      string id = c[0];
      long d = StringToInteger(c[1]);
      string tipo = c[2];
      double preco = Preco(c[3]), q = Volume(StringToDouble(c[4])), osl = Preco(c[5]), otp = Preco(c[6]);
      manter += id + "|";
      if(Usado(id) || q <= 0)
         continue;
      if(tenho)
         continue;                                     // uma posicao por vez
      bool feito = false;
      if(tipo == "mercado")
         feito = d > 0 ? trade.Buy(q, _Symbol, 0, osl, otp, id) : trade.Sell(q, _Symbol, 0, osl, otp, id);
      else
         if(tipo == "limite")
            feito = d > 0 ? trade.BuyLimit(q, preco, _Symbol, osl, otp, ORDER_TIME_DAY, 0, id) : trade.SellLimit(q, preco, _Symbol, osl, otp, ORDER_TIME_DAY, 0, id);
         else
            feito = d > 0 ? trade.BuyStop(q, preco, _Symbol, osl, otp, ORDER_TIME_DAY, 0, id) : trade.SellStop(q, preco, _Symbol, osl, otp, ORDER_TIME_DAY, 0, id);
      Usar(id);
      if(feito)
         Evento("ordem", (d > 0 ? "compra " : "venda ") + tipo + " " + DoubleToString(q, 2) + (tipo == "mercado" ? "" : " em " + DoubleToString(preco, _Digits))
                + " stop " + DoubleToString(osl, _Digits) + " alvo " + DoubleToString(otp, _Digits));
      else
         Evento("erro", "ordem recusada pela corretora: " + trade.ResultRetcodeDescription());
     }
   CancelarPendentes(manter);                          // o que o robo nao quer mais
  }
//+------------------------------------------------------------------+
