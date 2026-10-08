# Robô Apex — guia para quem for mexer no código

Robô **informativo** de day trade: mostra sinais, simula e ensina. Servidor em Python (só biblioteca padrão) e tela em
JavaScript puro com lightweight-charts 4. O dono não é programador e tem alunos usando: escreva para ele em português
simples, sem jargão.

## Regras que não mudam

- O projeto se chama **Robô Apex**. O nome antigo do projeto não pode reaparecer em código, textos, imagens ou releases
  (`ferramentas/conferir.py` verifica).
- O robô **não envia ordens reais**. A ponte com o Profit (`app/profit.py`) é só simulador.
- Nada de promessa de resultado nem de "infalível". Toda estatística é com custos e escorregamento, e os textos dizem
  quando algo não tem vantagem comprovada. Não dar recomendação pessoal de investimento.
- As estratégias **E2 e E9 não são alteradas**. Melhoria entra como estratégia nova (E14, E15…).
- Tela simples: tudo que não for óbvio tem um "?" com explicação (`data-dica` ou `AX.q("texto")`).
- Sem dependências novas no servidor (só biblioteca padrão do Python 3.12).
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
- `app/estrategias.py` (E1–E15, gestões), `app/simulador.py` (execução, custos, proteções), `app/ia.py`,
  `app/auth.py`, `app/dados_fonte.py`, `app/opcoes.py`, `app/profit.py`, `app/avisos.py`.
- `app/web/` — a tela. Tudo vive em `window.AX`: eventos `AX.on/emit`, camadas de desenho `AX.camadas.push((ctx,u)=>…)`,
  `AX.mostrar/avancar/atualizar` para o gráfico. `app.js` é o núcleo; `ops.js` operações e marcações; `replay.js`
  replay da entrada e "E se…"; `desenho.js` ferramentas de desenho; `dicas.js` os "?".
- `ntsl/` — scripts para o Profit, gerados por `ferramentas/gerar_ntsl.py`.
- `ferramentas/backtest.py` — testes das estratégias com custos.

## Publicar uma versão

1. Subir `VERSAO` em `app/robo_apex.py` e acrescentar "Novidades da versão X" no `LEIA-ME.md`; o `README.md` é uma
   cópia idêntica do `LEIA-ME.md`.
2. `python ferramentas/conferir.py` sem problemas.
3. O executável é feito **no Windows**: `python -m PyInstaller --noconfirm RoboApex.spec` (sai em `dist/RoboApex.exe`)
   e vai anexado na página de Releases (`vX.Y`), nunca dentro do repositório.
