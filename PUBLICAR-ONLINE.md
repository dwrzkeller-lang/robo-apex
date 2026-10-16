# Colocar o Robô Apex na internet (vender por assinatura)

O mesmo programa que roda no seu computador também roda num servidor na internet. Online, a raiz do site mostra a
página de vendas; quem assina cria a conta com o aceite dos termos, paga pela Hotmart e entra no robô pelo navegador,
sem baixar nada. Você, como administrador, acompanha cadastros, compras, assinantes, visitas e acessos.

## O que você precisa

1. **Um servidor (VPS)** com Linux (Ubuntu 22.04 ou 24.04), 2 GB de memória ou mais. Exemplos: Hostinger VPS,
   Contabo, DigitalOcean, AWS Lightsail. Custa em torno de R$ 30 a R$ 80 por mês.
2. **Um domínio** (ex.: `roboapex.com.br`) apontando para o IP do servidor (registro A no painel do domínio).
3. **Conta de produtor na Hotmart** com o produto criado como **assinatura mensal de R$ 49,99**.

## Passo a passo no servidor

```bash
sudo apt update && sudo apt install -y python3 git caddy
sudo useradd -m -s /bin/bash apex
sudo -u apex git clone ENDERECO-DO-REPOSITORIO-NO-GITHUB /home/apex/robo-apex
```

Serviço do robô (`/etc/systemd/system/roboapex.service`):

```ini
[Unit]
Description=Robo Apex
After=network-online.target

[Service]
User=apex
WorkingDirectory=/home/apex/robo-apex
ExecStart=/usr/bin/python3 app/robo_apex.py --publico --proxy --dominio roboapex.com.br --sem-janela --porta 8765 --base /home/apex/dados
Restart=always

[Install]
WantedBy=multi-user.target
```

HTTPS automático com o Caddy (`/etc/caddy/Caddyfile`):

```
roboapex.com.br, www.roboapex.com.br {
    reverse_proxy 127.0.0.1:8765
}
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now roboapex && sudo systemctl restart caddy
```

`--proxy` diz ao robô que o Caddy está na frente (é dele que vem o IP de cada visitante, usado no limite de tentativas
e no registro). Sem proxy na frente, não use `--proxy`.

Abra `https://roboapex.com.br/app`: na primeira vez o robô pede para criar a senha do administrador. Online, essa tela
pede também o **código do primeiro acesso**, para ninguém da internet virar administrador antes de você. O código aparece
no registro do serviço e fica no arquivo `codigo_primeiro_acesso.txt` da pasta de dados (com o e-mail do administrador):

```bash
sudo journalctl -u roboapex | grep "PRIMEIRO ACESSO"
sudo cat /home/apex/dados/codigo_primeiro_acesso.txt
```

Faça isso na mesma hora. O código vale uma vez e muda a cada vez que o robô abre; o arquivo some depois do primeiro
acesso. A sessão do administrador principal vale 15 minutos depois de entrar (depois disso a tela pede a senha de novo).

## Ligar a venda

1. No robô, botão da sua conta › **Vendas e site**:
   * cole o **link do checkout** da Hotmart;
   * marque **Cadastro aberto** e **Exigir assinatura**;
   * cole o **hottok** (próximo passo).
2. Na Hotmart: *Ferramentas › Webhook (API e notificações)*, versão **2.0.0**, URL
   `https://roboapex.com.br/api/hotmart`, eventos: compra aprovada, completa, cancelada, reembolsada, chargeback,
   protesto e cancelamento de assinatura. Copie o **hottok** mostrado lá para o robô.
3. Na Hotmart, página de obrigado (pós-compra): `https://roboapex.com.br/entrar?cadastro=1`.

Quem compra antes de se cadastrar fica guardado pelo e-mail: quando a pessoa cria a conta com o mesmo e-mail, a
assinatura já entra ativa. O e-mail da compra fica guardado na conta: renovações e cancelamentos continuam valendo mesmo
se a pessoa trocar o e-mail de entrada. Reembolso, chargeback e protesto tiram o acesso na hora; cancelamento da
assinatura mantém o acesso até o fim do mês já pago. Aviso repetido ou atrasado da mesma compra não estende o prazo.
Você também libera ou tira o acesso na mão, na lista de usuários.

Opcional: se você vender outros produtos na mesma conta da Hotmart, ponha o código do produto em `produto_id` no arquivo
`site.json` da pasta de dados (com o robô fechado): avisos de outros produtos ficam só no registro.

## O que o administrador vê

* **Vendas e site**: assinantes ativos, cadastros, quem está conectado, visitas da página de vendas por dia e de onde
  vieram (Instagram, Google, link direto...), cada aviso da Hotmart.
* **Usuários**: cada conta com a situação da assinatura e o último acesso.
* **Registro de acessos**: entradas, cadastros, compras, testes ligados, ordens da boleta, conexões com corretora.

## Pontos de atenção

* **Dados da B3**: os gratuitos (Yahoo) chegam com cerca de 15 minutos de atraso. Para tempo real, cada usuário pode
  conectar o MetaTrader 5 dele (aba Conectar), ou você contrata um provedor de dados com licença de redistribuição.
* **Limite do Yahoo**: o robô faz no máximo 45 pedidos por minuto, somando todos os usuários (o resultado é
  compartilhado entre quem olha o mesmo ativo). Com muitos assinantes, um provedor pago de dados é o caminho.
* **Cópia de segurança**: a pasta `/home/apex/dados` tem as contas, compras e configurações. Faça backup diário dela.
* **Jurídico**: antes de vender, converse com um advogado sobre a CVM (Resolução 20/2021, análise de valores
  mobiliários), o Código de Defesa do Consumidor (propaganda) e a LGPD. Os termos e o aviso de risco do robô ajudam,
  mas não substituem essa conversa.
