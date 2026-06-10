# Deploy no Cloudflare Pages

Esta e a versao recomendada para producao no Cloudflare Pages.

## O que esta pronto

- `public/`: interface do painel.
- `functions/api/flows.js`: salva e lista fluxos.
- `functions/api/queue.js`: salva e limpa a fila de respostas.
- `functions/webhook/instagram.js`: recebe o webhook do Instagram/Meta.
- `functions/_lib.js`: motor de condicoes, fila e envio.
- `wrangler.toml`: configuracao base do Cloudflare.

## 1. Criar o KV

No Cloudflare Dashboard:

1. Acesse Workers & Pages.
2. Abra KV.
3. Crie um namespace chamado `CHAT_RESPONSE_KV`.
4. Copie o ID do namespace.
5. Cole esse ID em `wrangler.toml`, trocando:

```toml
id = "substitua-pelo-id-do-kv"
```

## 2. Configurar variaveis

No projeto do Cloudflare Pages, configure:

```text
META_VERIFY_TOKEN=crie-um-token-secreto
ADMIN_TOKEN=crie-uma-senha-para-o-painel
OUTBOUND_API_URL=
OUTBOUND_API_TOKEN=
WEBHOOK_SECRET=
```

Enquanto voce nao tiver API de envio, deixe `OUTBOUND_API_URL` vazio. Assim as respostas vao para a Fila de respostas.

## 3. Configurar Pages

Use estes valores:

```text
Framework preset: None
Build command: deixe vazio
Build output directory: public
Functions directory: functions
```

Se estiver usando GitHub, suba este projeto para um repositorio e conecte o repositorio no Cloudflare Pages.

## 4. Cadastrar webhook na Meta

Use:

```text
https://seu-projeto.pages.dev/webhook/instagram
```

O token de verificacao na Meta precisa ser igual a:

```text
META_VERIFY_TOKEN
```

## 5. Teste real

1. Abra `https://seu-projeto.pages.dev`.
2. Digite o `ADMIN_TOKEN` quando o painel pedir.
3. Crie um fluxo com o ID da postagem e palavra-chave.
4. Configure a Meta para enviar eventos para o webhook.
5. Quando chegar evento compativel, a resposta aparece na Fila de respostas.

## Observacao importante

Cloudflare Pages nao usa `server.js` em producao. Esse arquivo continua existindo apenas para teste local simples com `node server.js`.
