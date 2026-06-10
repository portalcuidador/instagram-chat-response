const FLOWS_KEY = "flows";
const QUEUE_KEY = "queue";
const EVENTS_KEY = "events";

const defaultFlows = {
  flows: [
    {
      id: "boas-vindas",
      name: "Boas-vindas",
      enabled: true,
      match: {
        type: "contains",
        postIds: [],
        keywords: ["oi", "ola", "preco"]
      },
      steps: [
        {
          type: "message",
          text: "Oi! Que bom receber sua mensagem. Posso te ajudar com precos, horarios ou atendimento?"
        },
        {
          type: "delay",
          seconds: 2
        },
        {
          type: "message",
          text: "Responda com PRECO para valores, HORARIO para funcionamento ou ATENDENTE para falar com uma pessoa."
        }
      ]
    },
    {
      id: "atendente",
      name: "Encaminhar para atendente",
      enabled: true,
      match: {
        type: "equals",
        postIds: [],
        keywords: ["atendente", "humano"]
      },
      steps: [
        {
          type: "message",
          text: "Perfeito, vou chamar uma pessoa do time para continuar por aqui."
        },
        {
          type: "tag",
          tag: "precisa_atendimento"
        }
      ]
    }
  ]
};

export function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

export function text(body, status = 200) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });
}

export function requireAdmin(request, env) {
  if (!env.ADMIN_TOKEN) {
    return null;
  }

  const token = request.headers.get("x-admin-token");
  if (token === env.ADMIN_TOKEN) {
    return null;
  }

  return json({ error: "Token de administrador invalido." }, 401);
}

export async function readFlows(env) {
  assertKv(env);
  return (await env.CHAT_RESPONSE_KV.get(FLOWS_KEY, "json")) || defaultFlows;
}

export async function writeFlows(env, data) {
  assertKv(env);
  await env.CHAT_RESPONSE_KV.put(FLOWS_KEY, JSON.stringify(data));
}

export async function readQueue(env) {
  assertKv(env);
  return (await env.CHAT_RESPONSE_KV.get(QUEUE_KEY, "json")) || { items: [] };
}

export async function writeQueue(env, data) {
  assertKv(env);
  await env.CHAT_RESPONSE_KV.put(QUEUE_KEY, JSON.stringify(data));
}

export async function readEvents(env) {
  assertKv(env);
  return (await env.CHAT_RESPONSE_KV.get(EVENTS_KEY, "json")) || { items: [] };
}

export async function writeEvents(env, data) {
  assertKv(env);
  await env.CHAT_RESPONSE_KV.put(EVENTS_KEY, JSON.stringify(data));
}

export async function logEvent(env, event) {
  const events = await readEvents(env);
  const item = {
    id: `event-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    ...event
  };

  events.items.unshift(item);
  events.items = events.items.slice(0, 50);
  await writeEvents(env, events);
  return item;
}

export async function enqueueReply(env, reply) {
  const queue = await readQueue(env);
  const item = {
    id: `reply-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    ...reply
  };

  queue.items.unshift(item);
  await writeQueue(env, queue);
  return item;
}

export function normalizeIncomingMessage(payload) {
  return {
    senderId:
      payload.senderId ||
      payload.sender_id ||
      payload.from?.id ||
      payload.comment?.from?.id ||
      payload.entry?.[0]?.messaging?.[0]?.sender?.id ||
      payload.entry?.[0]?.changes?.[0]?.value?.from?.id ||
      "",
    postId:
      payload.postId ||
      payload.post_id ||
      payload.mediaId ||
      payload.media_id ||
      payload.comment?.media?.id ||
      payload.entry?.[0]?.changes?.[0]?.value?.media?.id ||
      payload.entry?.[0]?.changes?.[0]?.value?.post_id ||
      "",
    commentId:
      payload.commentId ||
      payload.comment_id ||
      payload.comment?.id ||
      payload.entry?.[0]?.changes?.[0]?.value?.id ||
      payload.entry?.[0]?.changes?.[0]?.value?.comment_id ||
      "",
    text:
      payload.text ||
      payload.message?.text ||
      payload.comment?.text ||
      payload.entry?.[0]?.messaging?.[0]?.message?.text ||
      payload.entry?.[0]?.changes?.[0]?.value?.text ||
      "",
    raw: payload
  };
}

export function findMatchingFlow(flows, textValue, postId = "") {
  const normalizedText = normalizeText(textValue);
  const normalizedPostId = normalizeText(postId);

  return flows.find((flow) => {
    const match = flow.match || {};
    const keywords = (match.keywords || []).map(normalizeText).filter(Boolean);
    const postIds = (match.postIds || []).map(normalizeText).filter(Boolean);

    if (postIds.length && !postIds.includes(normalizedPostId)) {
      return false;
    }

    if (match.type === "equals") {
      return keywords.some((keyword) => normalizedText === keyword);
    }

    if (match.type === "startsWith") {
      return keywords.some((keyword) => normalizedText.startsWith(keyword));
    }

    return keywords.some((keyword) => normalizedText.includes(keyword));
  });
}

export async function runFlow(env, flow, incoming) {
  const actions = [];

  for (const step of flow.steps || []) {
    if (step.type === "delay") {
      const seconds = Math.max(0, Math.min(Number(step.seconds || 0), 10));
      actions.push({ type: "delay", seconds });
      continue;
    }

    if (step.type === "message") {
      const responseText = renderTemplate(step.text || "", incoming);
      const result = await sendOutboundMessage(env, incoming, responseText, flow);
      actions.push({ type: "message", text: responseText, sent: result.sent, detail: result.detail, mode: result.mode });
      continue;
    }

    if (step.type === "tag") {
      actions.push({ type: "tag", tag: step.tag || "" });
    }
  }

  return actions;
}

export function normalizeFlows(body) {
  const flows = Array.isArray(body.flows) ? body.flows : [];

  return {
    flows: flows.map((flow, index) => ({
      id: slugify(flow.id || flow.name || `fluxo-${index + 1}`),
      name: String(flow.name || `Fluxo ${index + 1}`).trim(),
      enabled: Boolean(flow.enabled),
      match: {
        type: ["contains", "equals", "startsWith"].includes(flow.match?.type) ? flow.match.type : "contains",
        postIds: splitList(flow.match?.postIds),
        keywords: splitList(flow.match?.keywords)
      },
      steps: normalizeSteps(flow.steps)
    }))
  };
}

function normalizeSteps(steps) {
  return (Array.isArray(steps) ? steps : [])
    .map((step) => {
      if (step.type === "delay") {
        return { type: "delay", seconds: Math.max(0, Number(step.seconds || 0)) };
      }

      if (step.type === "tag") {
        return { type: "tag", tag: String(step.tag || "").trim() };
      }

      return { type: "message", text: String(step.text || "").trim() };
    })
    .filter((step) => step.type !== "message" || step.text);
}

async function sendOutboundMessage(env, incoming, responseText, flow) {
  const outboundUrl = normalizeOutboundApiUrl(env.OUTBOUND_API_URL || "");
  const metaAccessToken = String(env.META_ACCESS_TOKEN || "").trim();

  if (!outboundUrl) {
    if (metaAccessToken && incoming.commentId) {
      const metaResult = await sendMetaPrivateReply(env, incoming.commentId, responseText);
      if (metaResult.sent) {
        return metaResult;
      }

      const fallback = await enqueueReply(env, {
        recipientId: incoming.senderId,
        postId: incoming.postId,
        commentId: incoming.commentId,
        incomingText: incoming.text,
        responseText,
        flowId: flow.id,
        flowName: flow.name,
        deliveryError: metaResult.detail
      });
      return {
        sent: false,
        detail: `Falha no envio automatico. Resposta adicionada a fila. Erro Meta: ${metaResult.detail}`,
        mode: "queue_after_meta_error",
        queueId: fallback.id
      };
    }

    const item = await enqueueReply(env, {
      recipientId: incoming.senderId,
      postId: incoming.postId,
      commentId: incoming.commentId,
      incomingText: incoming.text,
      responseText,
      flowId: flow.id,
      flowName: flow.name
    });
    return { sent: false, detail: "Resposta adicionada a fila.", queueId: item.id, mode: "queue" };
  }

  const headers = { "content-type": "application/json" };
  if (env.OUTBOUND_API_TOKEN) {
    headers.authorization = `Bearer ${env.OUTBOUND_API_TOKEN}`;
  }

  const response = await fetch(outboundUrl, {
    method: "POST",
    headers,
    body: JSON.stringify({
      recipientId: incoming.senderId,
      text: responseText,
      source: "instagram-dm-automation",
      sourcePayload: incoming.raw
    })
  });

  const detail = await response.text();
  return { sent: response.ok, detail: detail || response.statusText, mode: "custom_api" };
}

async function sendMetaPrivateReply(env, commentId, responseText) {
  const apiVersion = env.META_GRAPH_VERSION || "v25.0";
  const url = `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(commentId)}/private_replies`;
  const body = new URLSearchParams();
  body.set("message", responseText);
  body.set("access_token", env.META_ACCESS_TOKEN);

  const response = await fetch(url, {
    method: "POST",
    body
  });

  const detail = await response.text();
  return { sent: response.ok, detail: detail || response.statusText, mode: "meta_private_reply" };
}

function assertKv(env) {
  if (!env.CHAT_RESPONSE_KV) {
    throw new Error("Binding CHAT_RESPONSE_KV nao configurado.");
  }
}

function splitList(value) {
  return String((value || []).join ? value.join("\n") : value)
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function renderTemplate(template, incoming) {
  return template
    .replaceAll("{{senderId}}", incoming.senderId)
    .replaceAll("{{postId}}", incoming.postId)
    .replaceAll("{{commentId}}", incoming.commentId)
    .replaceAll("{{text}}", incoming.text);
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `fluxo-${Date.now()}`;
}

function normalizeOutboundApiUrl(value) {
  const url = String(value || "").trim();
  if (!url || url.includes("sua-api.com")) {
    return "";
  }

  return url;
}
