"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const FLOWS_PATH = path.join(ROOT, "data", "flows.json");
const QUEUE_PATH = path.join(ROOT, "data", "queue.json");

loadEnv(path.join(ROOT, ".env"));

const PORT = Number(process.env.PORT || 3000);
const OUTBOUND_API_URL = normalizeOutboundApiUrl(process.env.OUTBOUND_API_URL || "");
const OUTBOUND_API_TOKEN = process.env.OUTBOUND_API_TOKEN || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const META_VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/flows") {
      return sendJson(res, 200, readFlows());
    }

    if (req.method === "PUT" && url.pathname === "/api/flows") {
      const body = await readJson(req);
      const normalized = normalizeFlows(body);
      writeFlows(normalized);
      return sendJson(res, 200, normalized);
    }

    if (req.method === "GET" && url.pathname === "/api/queue") {
      return sendJson(res, 200, readQueue());
    }

    if (req.method === "DELETE" && url.pathname === "/api/queue") {
      writeQueue({ items: [] });
      return sendJson(res, 200, readQueue());
    }

    if (req.method === "POST" && url.pathname === "/webhook/instagram") {
      return handleInstagramWebhook(req, res);
    }

    if (req.method === "GET" && url.pathname === "/webhook/instagram") {
      return handleWebhookVerification(url, res);
    }

    if (req.method === "GET" && url.pathname === "/health") {
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === "GET") {
      return serveStatic(url.pathname, res);
    }

    sendJson(res, 405, { error: "Metodo nao permitido." });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: "Erro interno.", detail: error.message });
  }
});

if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`App rodando em http://localhost:${PORT}`);
  });
}

function handleWebhookVerification(url, res) {
  const mode = url.searchParams.get("hub.mode");
  const token = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");

  if (mode === "subscribe" && token && token === META_VERIFY_TOKEN) {
    return sendText(res, 200, challenge || "");
  }

  return sendText(res, 403, "Token de verificacao invalido.");
}

async function handleInstagramWebhook(req, res) {
  if (WEBHOOK_SECRET && req.headers["x-webhook-secret"] !== WEBHOOK_SECRET) {
    return sendJson(res, 401, { error: "Webhook nao autorizado." });
  }

  const payload = await readJson(req);
  const incoming = normalizeIncomingMessage(payload);

  if (!incoming.senderId || !incoming.text) {
    return sendJson(res, 400, {
      error: "Mensagem invalida.",
      expected: {
        senderId: "id-da-pessoa",
        text: "mensagem recebida"
      }
    });
  }

  const flows = readFlows().flows.filter((flow) => flow.enabled);
  const flow = findMatchingFlow(flows, incoming.text, incoming.postId);

  if (!flow) {
    return sendJson(res, 200, {
      matched: false,
      message: "Nenhum fluxo encontrado para a mensagem."
    });
  }

  const actions = await runFlow(flow, incoming);
  sendJson(res, 200, {
    matched: true,
    flowId: flow.id,
    flowName: flow.name,
    actions
  });
}

function normalizeIncomingMessage(payload) {
  return {
    senderId:
      payload.senderId ||
      payload.sender_id ||
      payload.from?.id ||
      payload.comment?.from?.id ||
      payload.entry?.[0]?.messaging?.[0]?.sender?.id ||
      payload.entry?.[0]?.changes?.[0]?.value?.from?.id ||
      "",
    senderUsername:
      payload.senderUsername ||
      payload.sender_username ||
      payload.username ||
      payload.from?.username ||
      payload.comment?.from?.username ||
      payload.entry?.[0]?.messaging?.[0]?.sender?.username ||
      payload.entry?.[0]?.changes?.[0]?.value?.from?.username ||
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

async function runFlow(flow, incoming) {
  const actions = [];

  for (const step of flow.steps || []) {
    if (step.type === "delay") {
      const seconds = Math.max(0, Math.min(Number(step.seconds || 0), 10));
      await wait(seconds * 1000);
      actions.push({ type: "delay", seconds });
      continue;
    }

    if (step.type === "message") {
      const text = renderTemplate(step.text || "", incoming);
      const result = await sendOutboundMessage(incoming, text, flow);
      actions.push({ type: "message", text, sent: result.sent, detail: result.detail });
      continue;
    }

    if (step.type === "link_button") {
      const text = renderTemplate(step.text || "", incoming);
      const buttonTitle = renderTemplate(step.buttonTitle || "Abrir link", incoming);
      const buttonUrl = renderTemplate(step.buttonUrl || "", incoming);
      const result = await sendOutboundMessage(incoming, text, flow, { buttonTitle, buttonUrl });
      actions.push({ type: "link_button", text, buttonTitle, buttonUrl, sent: result.sent, detail: result.detail });
      continue;
    }

    if (step.type === "tag") {
      actions.push({ type: "tag", tag: step.tag || "" });
    }
  }

  return actions;
}

async function sendOutboundMessage(incoming, text, flow, options = {}) {
  if (!OUTBOUND_API_URL) {
    const item = enqueueReply({
      recipientId: incoming.senderId,
      recipientUsername: incoming.senderUsername,
      postId: incoming.postId,
      commentId: incoming.commentId,
      incomingText: incoming.text,
      responseText: text,
      buttonTitle: options.buttonTitle || "",
      buttonUrl: options.buttonUrl || "",
      flowId: flow.id,
      flowName: flow.name
    });
    console.log("[QUEUE]", item);
    return { sent: false, detail: "Resposta adicionada a fila.", queueId: item.id };
  }

  const headers = {
    "content-type": "application/json"
  };

  if (OUTBOUND_API_TOKEN) {
    headers.authorization = `Bearer ${OUTBOUND_API_TOKEN}`;
  }

  const response = await fetch(OUTBOUND_API_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({
      recipientId: incoming.senderId,
      text,
      source: "instagram-dm-automation",
      sourcePayload: incoming.raw
    })
  });

  const detail = await response.text();
  return { sent: response.ok, detail: detail || response.statusText };
}

function findMatchingFlow(flows, text, postId = "") {
  const normalizedText = normalizeText(text);
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
    .replaceAll("{{username}}", incoming.senderUsername)
    .replaceAll("{{postId}}", incoming.postId)
    .replaceAll("{{commentId}}", incoming.commentId)
    .replaceAll("{{text}}", incoming.text);
}

function normalizeFlows(body) {
  const flows = Array.isArray(body.flows) ? body.flows : [];

  return {
    flows: flows.map((flow, index) => ({
      id: slugify(flow.id || flow.name || `fluxo-${index + 1}`),
      name: String(flow.name || `Fluxo ${index + 1}`).trim(),
      enabled: Boolean(flow.enabled),
      match: {
        type: ["contains", "equals", "startsWith"].includes(flow.match?.type) ? flow.match.type : "contains",
        postIds: String((flow.match?.postIds || []).join("\n"))
          .split(/\n|,/)
          .map((postId) => postId.trim())
          .filter(Boolean),
        keywords: String((flow.match?.keywords || []).join("\n"))
          .split(/\n|,/)
          .map((keyword) => keyword.trim())
          .filter(Boolean)
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

      if (step.type === "link_button") {
        return {
          type: "link_button",
          text: String(step.text || "").trim(),
          buttonTitle: String(step.buttonTitle || "Abrir link").trim(),
          buttonUrl: String(step.buttonUrl || "").trim()
        };
      }

      return { type: "message", text: String(step.text || "").trim() };
    })
    .filter((step) => {
      if (step.type === "message") {
        return step.text;
      }

      if (step.type === "link_button") {
        return step.text && step.buttonUrl;
      }

      return true;
    });
}

function readFlows() {
  return JSON.parse(fs.readFileSync(FLOWS_PATH, "utf8"));
}

function writeFlows(data) {
  fs.writeFileSync(FLOWS_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function readQueue() {
  if (!fs.existsSync(QUEUE_PATH)) {
    return { items: [] };
  }

  return JSON.parse(fs.readFileSync(QUEUE_PATH, "utf8"));
}

function writeQueue(data) {
  fs.writeFileSync(QUEUE_PATH, `${JSON.stringify(data, null, 2)}\n`);
}

function enqueueReply(reply) {
  const queue = readQueue();
  const item = {
    id: `reply-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    createdAt: new Date().toISOString(),
    status: "pending",
    ...reply
  };

  queue.items.unshift(item);
  writeQueue(queue);
  return item;
}

function serveStatic(pathname, res) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, safePath));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, "Acesso negado.");
  }

  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return sendText(res, 404, "Pagina nao encontrada.");
  }

  const ext = path.extname(filePath);
  res.writeHead(200, { "content-type": mimeTypes[ext] || "application/octet-stream" });
  fs.createReadStream(filePath).pipe(res);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        req.destroy();
        reject(new Error("Payload muito grande."));
      }
    });
    req.on("end", () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (error) {
        reject(new Error("JSON invalido."));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data, null, 2));
}

function sendText(res, status, text) {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(text);
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function slugify(value) {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || `fluxo-${Date.now()}`;
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function normalizeOutboundApiUrl(value) {
  const url = String(value || "").trim();
  if (!url || url.includes("sua-api.com")) {
    return "";
  }

  return url;
}

module.exports = {
  findMatchingFlow,
  normalizeIncomingMessage,
  normalizeText,
  renderTemplate,
  server
};
