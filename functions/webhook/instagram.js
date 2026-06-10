import { findMatchingFlow, json, normalizeIncomingMessage, readFlows, runFlow, text } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === env.META_VERIFY_TOKEN) {
    return text(challenge || "");
  }

  return text("Token de verificacao invalido.", 403);
}

export async function onRequestPost({ request, env }) {
  if (env.WEBHOOK_SECRET && request.headers.get("x-webhook-secret") !== env.WEBHOOK_SECRET) {
    return json({ error: "Webhook nao autorizado." }, 401);
  }

  const payload = await request.json();
  const incoming = normalizeIncomingMessage(payload);

  if (!incoming.senderId || !incoming.text) {
    return json({
      error: "Mensagem invalida.",
      expected: {
        senderId: "id-da-pessoa",
        text: "mensagem recebida"
      }
    }, 400);
  }

  const flows = (await readFlows(env)).flows.filter((flow) => flow.enabled);
  const flow = findMatchingFlow(flows, incoming.text, incoming.postId);

  if (!flow) {
    return json({
      matched: false,
      message: "Nenhum fluxo encontrado para a mensagem."
    });
  }

  const actions = await runFlow(env, flow, incoming);
  return json({
    matched: true,
    flowId: flow.id,
    flowName: flow.name,
    actions
  });
}
