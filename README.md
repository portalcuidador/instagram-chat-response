# Instagram Chat Response

Aplicativo local para automatizar respostas de DM do Instagram por palavras-chave e fluxos condicionais, no estilo Manychat, usando a sua propria API de envio.

Para producao no Cloudflare Pages, siga o guia [CLOUDFLARE.md](CLOUDFLARE.md).

## Como rodar

1. Copie `.env.example` para `.env`.
2. Preencha `OUTBOUND_API_URL` com a URL da sua API, se ja tiver uma.
3. Preencha `OUTBOUND_API_TOKEN` se sua API usar token Bearer.
4. Preencha `META_VERIFY_TOKEN` com um texto criado por voce para cadastrar o webhook na Meta.
5. Inicie:

```powershell
node server.js
```

Abra:

```text
http://localhost:3000
```

## Webhook

Configure sua integracao do Instagram para enviar mensagens para:

```text
POST /webhook/instagram
```

Payload simples aceito:

```json
{
  "senderId": "id-da-pessoa",
  "postId": "id-da-postagem",
  "text": "Oi, quero saber o preco"
}
```

Tambem ha suporte ao formato comum do webhook da Meta:

```json
{
  "entry": [
    {
      "messaging": [
        {
          "sender": { "id": "id-da-pessoa" },
          "message": { "text": "Oi" }
        }
      ]
    }
  ]
}
```

## Envio para sua API

Quando um fluxo combina com a mensagem recebida, o app chama `OUTBOUND_API_URL` com:

```json
{
  "recipientId": "id-da-pessoa",
  "text": "mensagem do fluxo",
  "source": "instagram-dm-automation",
  "sourcePayload": {}
}
```

Se `OUTBOUND_API_URL` estiver vazio, o app roda em modo de simulacao, mostra os envios no terminal e adiciona as mensagens na "Fila de respostas" da tela principal.

## Teste em producao

Para cadastrar o webhook na Meta, use:

```text
https://seu-dominio.com/webhook/instagram
```

O token de verificacao deve ser exatamente o mesmo valor de `META_VERIFY_TOKEN`.

## Condicional por postagem

Cada fluxo pode ter um ou mais IDs de postagem no campo "ID da postagem".

- Se o campo ficar vazio, o fluxo vale para qualquer postagem.
- Se o campo tiver um ID, o fluxo so dispara quando a mensagem vier daquela postagem.
- Se houver varios IDs, coloque um por linha ou separados por virgula.

Exemplo:

```text
Fluxo: Post de produto A
ID da postagem: 17900000000000000
Palavra-chave: quero
Resposta: Oi! Vi que voce comentou no produto A. Aqui esta o link...
```

## Testes

```powershell
node test-engine.js
```
