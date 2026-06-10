"use strict";

process.env.META_VERIFY_TOKEN = "token-teste";

const assert = require("assert");
const {
  findMatchingFlow,
  normalizeIncomingMessage,
  normalizeText,
  renderTemplate,
  server
} = require("./server");

const flows = [
  {
    id: "preco",
    enabled: true,
    match: { type: "contains", postIds: ["post-1"], keywords: ["preço"] }
  },
  {
    id: "atendente",
    enabled: true,
    match: { type: "equals", postIds: [], keywords: ["atendente"] }
  }
];

assert.equal(normalizeText(" Olá, PREÇO! "), "ola, preco!");
assert.equal(findMatchingFlow(flows, "Quero saber o preco", "post-1").id, "preco");
assert.equal(findMatchingFlow(flows, "Quero saber o preco", "post-2"), undefined);
assert.equal(findMatchingFlow(flows, "atendente").id, "atendente");
assert.equal(findMatchingFlow(flows, "quero atendente"), undefined);
assert.equal(
  normalizeIncomingMessage({ entry: [{ messaging: [{ sender: { id: "123" }, message: { text: "Oi" } }] }] }).senderId,
  "123"
);
assert.equal(renderTemplate("Pessoa {{senderId}} disse {{text}}", { senderId: "1", text: "Oi" }), "Pessoa 1 disse Oi");

server.listen(0, async () => {
  try {
    const { port } = server.address();
    const verifyResponse = await fetch(`http://localhost:${port}/webhook/instagram?hub.mode=subscribe&hub.verify_token=token-teste&hub.challenge=ok`);
    assert.equal(await verifyResponse.text(), "ok");

    const response = await fetch(`http://localhost:${port}/webhook/instagram`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ senderId: "usuario_teste", text: "Oi, quero preco" })
    });
    const data = await response.json();
    assert.equal(response.ok, true);
    assert.equal(data.matched, true);
    assert.equal(data.flowId, "boas-vindas");
    console.log("Todos os testes passaram.");
  } finally {
    server.close();
  }
});
