# Robô Apex: guia para quem for mexer no código

Robô de **estratégias de day trade** para ações da B3, opções e cripto: mostra sinais, simula, ensina e, se o usuário
quiser, envia ordens pela conta DELE no MetaTrader 5 (EA), sempre por decisão dele. Servidor em Python (só biblioteca padrão) e tela em
JavaScript puro com lightweight-charts 4. O dono não é programador e tem alunos usando: escreva para ele em português
simples, sem jargão.

## Regras que não mudam

- O projeto se chama **Robô Apex**. O nome antigo do projeto não pode reaparecer em código, textos, imagens ou releases
  (`ferramentas/conferir.py` verifica).
- Ordens reais só pelo EA do MetaTrader 5 (`app/web/RoboApex.mq5` + `app/corretora.py`): o usuário instala, aceita o
  termo e liga; vem travado em conta DEMO, com lote máximo, perda máxima no dia e liga/desliga. O robô nunca recebe
  senha de corretora. A ponte com o Profit (`app/profit.py`) é só simulador.
- Propaganda: nada de depoimento inventado, resultado escolhido a dedo sem contexto ou promessa de ganho (CDC art. 37,
  CVM). A página de vendas (`app/web/site`) mostra prints reais com o aviso de simulação.
- Nada de promessa de resultado nem de "infalível". Toda estatística é com custos e escorregamento. Desde a 3.1 o
  selo "comprovada / não comprovada" saiu da tela (pedido do dono); fica o aviso de POUCOS DADOS e os textos de risco. Não dar recomendação pessoal de investimento.
- As estratégias **E2 e E9 não são alteradas**. Melhoria entra como estratégia nova (E14, E15…).
- Tela simples: tudo que não for óbvio tem um "?" com explicação (`data-dica` ou `AX.q("texto")`).
- Sem dependências novas no servidor (só biblioteca padrão do Python 3.12).
- Moedas, metais e petróleo têm sessão de 24 h; índices dos EUA usam o futuro (NQ, ES, YM). Mudou a fonte ou o horário
  de um ativo? Ponha-o em `FONTE_NOVA_*` (dados_fonte.py) para os arquivos guardados ganharem nome novo.
- `dados/` (contas, sessões, cache, desenhos) nunca vai para o Git. Nenhuma senha, token ou e-mail pessoal no repositório.

## Como rodar

```bash
python app/robo_apex.py                                  # abre a janela (Windows)
python app/robo_apex.py --sem-janela --porta 8790 --base /tmp/apex   # só o servidor, dados numa pasta à parte
python ferramentas/conferir.py                           # conferência rápida (sintaxe, nome, servidor sobe)
```

O primeiro acesso cria a conta de administrador na própria tela (não existe senha padrão). Para testar, use sempre uma
`--base` separada. Os dados de mercado vêm do Yahoo (limite de 45 pedidos por minuto); sem internet a tela abre, mas
sem candles.

## Mapa

- `app/robo_apex.py` — servidor HTTP, rotas `/api/*`, Sentinela (testes ao vivo), `VERSAO`.
- `app/estrategias.py` (E1–E23, gestões), `app/simulador.py` (execução, custos, proteções), `app/ia.py`,
  `app/auth.py`, `app/dados_fonte.py`, `app/opcoes.py`, `app/profit.py`, `app/avisos.py`.
- `app/qualidade.py` — nota de qualidade A+/A/B/C de cada sinal (price action, só com o passado) e o filtro `qual`.
- `app/boleta.py` — boleta simulada (paper trading ao vivo). `app/corretora.py` — conexão MetaTrader 5 (termo, código,
  candles do EA viram o ativo `MT5:<simbolo>`, sinal em texto para o EA; piloto automático com travas do servidor
  e botão de emergência `ZERAR=1`). Foco do dono: o robô operar sozinho na conta de cada usuário pela corretora. `app/assinaturas.py` — site online: termos,
  cadastro, Hotmart, visitas. Modo online: `--publico --dominio X` (ver PUBLICAR-ONLINE.md).
- `app/web/` — a tela. Tudo vive em `window.AX`: eventos `AX.on/emit`, camadas de desenho `AX.camadas.push((ctx,u)=>…)`,
  `AX.mostrar/avancar/atualizar` para o gráfico. `app.js` é o núcleo; `ops.js` operações e marcações; `replay.js`
  replay da entrada e "E se…" (as edições ficam em `estado_edicoes.json` e o SERVIDOR as aplica como ajustes; "Usar como
  regra" vira o parâmetro `regra` = fator do stop e alvo em R por estratégia); `testar.js` (Testar estratégia e Minhas
  estratégias; curva em `curva.js`); `replay_dia.js` (botão Replay do topo) e `vela_viva.js` (candle se formando);
  `aovivo.js` (Ao vivo do topo e pop-up dos sinais, só do mercado aberto); `raiox.js` (Raio-X do price action);
  `tema2.css` (visual 3.2); `boleta.js`; `mercado.js` (modo Cripto); `conectar.js`; `tutorial.js`; `vitrine.js` (`?vitrine=1` borra
  o nome das estratégias para prints); `tema.css` (visual da 3.0); `desenho.js` ferramentas de desenho; `dicas.js` os "?".
- `ntsl/` — scripts para o Profit, gerados por `ferramentas/gerar_ntsl.py`.
- `ferramentas/backtest.py` — testes das estratégias com custos.

## Publicar uma versão

1. Subir `VERSAO` em `app/robo_apex.py` e acrescentar "Novidades da versão X" no `LEIA-ME.md`; o `README.md` é uma
   cópia idêntica do `LEIA-ME.md`.
2. `python ferramentas/conferir.py` sem problemas.
3. O executável é feito **no Windows**: `python -m PyInstaller --noconfirm RoboApex.spec` (sai em `dist/RoboApex.exe`)
   e vai anexado na página de Releases (`vX.Y`), nunca dentro do repositório.
