"use strict";

let state = { flows: [] };
let selectedId = "";

const els = {
  flows: document.querySelector("#flows"),
  addFlow: document.querySelector("#addFlow"),
  emptyState: document.querySelector("#emptyState"),
  flowForm: document.querySelector("#flowForm"),
  flowName: document.querySelector("#flowName"),
  flowEnabled: document.querySelector("#flowEnabled"),
  matchType: document.querySelector("#matchType"),
  postIds: document.querySelector("#postIds"),
  keywords: document.querySelector("#keywords"),
  steps: document.querySelector("#steps"),
  addMessage: document.querySelector("#addMessage"),
  addDelay: document.querySelector("#addDelay"),
  addTag: document.querySelector("#addTag"),
  deleteFlow: document.querySelector("#deleteFlow"),
  runTest: document.querySelector("#runTest"),
  testSender: document.querySelector("#testSender"),
  testPostId: document.querySelector("#testPostId"),
  testText: document.querySelector("#testText"),
  testResult: document.querySelector("#testResult"),
  clearQueue: document.querySelector("#clearQueue"),
  replyQueue: document.querySelector("#replyQueue"),
  clearEvents: document.querySelector("#clearEvents"),
  eventLog: document.querySelector("#eventLog")
};

boot();

async function boot() {
  state = await request("/api/flows");
  selectedId = state.flows[0]?.id || "";
  render();
  await renderQueue();
  await renderEvents();
}

els.addFlow.addEventListener("click", () => {
  const id = `fluxo-${Date.now()}`;
  state.flows.push({
    id,
    name: "Novo fluxo",
    enabled: true,
    match: { type: "contains", postIds: [], keywords: [""] },
    steps: [{ type: "message", text: "Oi! Como posso ajudar?" }]
  });
  selectedId = id;
  render();
});

els.flowForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  syncSelectedFromForm();
  state = await request("/api/flows", {
    method: "PUT",
    body: JSON.stringify(state)
  });
  selectedId = state.flows.find((flow) => flow.id === selectedId)?.id || state.flows[0]?.id || "";
  render();
});

els.deleteFlow.addEventListener("click", () => {
  state.flows = state.flows.filter((flow) => flow.id !== selectedId);
  selectedId = state.flows[0]?.id || "";
  render();
});

els.addMessage.addEventListener("click", () => addStep({ type: "message", text: "Nova mensagem" }));
els.addDelay.addEventListener("click", () => addStep({ type: "delay", seconds: 2 }));
els.addTag.addEventListener("click", () => addStep({ type: "tag", tag: "novo_lead" }));

els.runTest.addEventListener("click", async () => {
  syncSelectedFromForm();
  await request("/api/flows", { method: "PUT", body: JSON.stringify(state) });
  const result = await publicRequest("/webhook/instagram", {
    method: "POST",
    body: JSON.stringify({
      senderId: els.testSender.value,
      postId: els.testPostId.value,
      text: els.testText.value
    })
  });
  els.testResult.textContent = JSON.stringify(result, null, 2);
  await renderQueue();
  await renderEvents();
});

els.clearQueue.addEventListener("click", async () => {
  await request("/api/queue", { method: "DELETE" });
  await renderQueue();
});

els.clearEvents.addEventListener("click", async () => {
  await request("/api/events", { method: "DELETE" });
  await renderEvents();
});

function addStep(step) {
  const flow = selectedFlow();
  if (!flow) {
    return;
  }

  syncSelectedFromForm();
  flow.steps.push(step);
  renderEditor(flow);
}

function render() {
  renderFlowList();
  const flow = selectedFlow();
  els.emptyState.classList.toggle("hidden", Boolean(flow));
  els.flowForm.classList.toggle("hidden", !flow);
  if (flow) {
    renderEditor(flow);
  }
}

function renderFlowList() {
  els.flows.innerHTML = "";

  state.flows.forEach((flow) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `flow-card${flow.id === selectedId ? " active" : ""}`;
    const postLabel = (flow.match.postIds || []).length ? ` - post ${(flow.match.postIds || []).join(", ")}` : "";
    button.innerHTML = `<strong>${escapeHtml(flow.name)}</strong><span>${flow.enabled ? "Ativo" : "Pausado"} - ${(flow.match.keywords || []).join(", ")}${escapeHtml(postLabel)}</span>`;
    button.addEventListener("click", () => {
      syncSelectedFromForm();
      selectedId = flow.id;
      render();
    });
    els.flows.appendChild(button);
  });
}

function renderEditor(flow) {
  els.flowName.value = flow.name;
  els.flowEnabled.checked = flow.enabled;
  els.matchType.value = flow.match.type;
  els.postIds.value = (flow.match.postIds || []).join("\n");
  els.keywords.value = (flow.match.keywords || []).join("\n");
  els.steps.innerHTML = "";

  flow.steps.forEach((step, index) => {
    const card = document.createElement("div");
    card.className = "step";
    card.innerHTML = stepTemplate(step, index);
    card.querySelector("[data-remove]").addEventListener("click", () => {
      syncSelectedFromForm();
      selectedFlow().steps.splice(index, 1);
      renderEditor(selectedFlow());
    });
    els.steps.appendChild(card);
  });
}

function stepTemplate(step, index) {
  const header = `
    <div class="step-top">
      <strong>${index + 1}. ${labelForStep(step.type)}</strong>
      <button class="secondary" type="button" data-remove>Remover</button>
    </div>
  `;

  if (step.type === "delay") {
    return `${header}<label>Segundos<input data-step="${index}" data-field="seconds" type="number" min="0" max="10" value="${Number(step.seconds || 0)}"></label>`;
  }

  if (step.type === "tag") {
    return `${header}<label>Etiqueta<input data-step="${index}" data-field="tag" value="${escapeHtml(step.tag || "")}"></label>`;
  }

  return `${header}<label>Texto<textarea data-step="${index}" data-field="text" rows="4">${escapeHtml(step.text || "")}</textarea></label>`;
}

function syncSelectedFromForm() {
  const flow = selectedFlow();
  if (!flow || els.flowForm.classList.contains("hidden")) {
    return;
  }

  flow.name = els.flowName.value.trim() || "Fluxo sem nome";
  flow.enabled = els.flowEnabled.checked;
  flow.match = {
    type: els.matchType.value,
    postIds: els.postIds.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean),
    keywords: els.keywords.value.split(/\n|,/).map((item) => item.trim()).filter(Boolean)
  };

  els.steps.querySelectorAll("[data-step]").forEach((input) => {
    const step = flow.steps[Number(input.dataset.step)];
    if (!step) {
      return;
    }
    const field = input.dataset.field;
    step[field] = field === "seconds" ? Number(input.value || 0) : input.value;
  });
}

function selectedFlow() {
  return state.flows.find((flow) => flow.id === selectedId);
}

async function renderQueue() {
  const queue = await request("/api/queue");
  els.replyQueue.innerHTML = "";

  if (!queue.items.length) {
    els.replyQueue.innerHTML = `<div class="queue-item"><span>Nenhuma resposta na fila ainda.</span></div>`;
    return;
  }

  queue.items.forEach((item) => {
    const card = document.createElement("div");
    card.className = "queue-item";
    card.innerHTML = `
      <strong>${escapeHtml(item.flowName || "Fluxo")}</strong>
      <span>Pessoa: ${escapeHtml(item.recipientId || "-")}</span>
      <span>Post: ${escapeHtml(item.postId || "qualquer")}</span>
      <span>Recebido: ${escapeHtml(item.incomingText || "-")}</span>
      <div class="queue-message">${escapeHtml(item.responseText || "")}</div>
      <button type="button">Copiar resposta</button>
    `;
    card.querySelector("button").addEventListener("click", async () => {
      await navigator.clipboard.writeText(item.responseText || "");
    });
    els.replyQueue.appendChild(card);
  });
}

async function renderEvents() {
  const events = await request("/api/events");
  els.eventLog.innerHTML = "";

  if (!events.items.length) {
    els.eventLog.innerHTML = `<div class="queue-item"><span>Nenhum webhook recebido ainda.</span></div>`;
    return;
  }

  events.items.slice(0, 10).forEach((item) => {
    const card = document.createElement("div");
    card.className = "queue-item";
    card.innerHTML = `
      <strong>${escapeHtml(labelForEvent(item.status))}</strong>
      <span>Post: ${escapeHtml(item.incoming?.postId || "-")}</span>
      <span>Pessoa: ${escapeHtml(item.incoming?.senderId || "-")}</span>
      <span>Texto: ${escapeHtml(item.incoming?.text || "-")}</span>
      <span>Fluxo: ${escapeHtml(item.flowName || item.reason || "-")}</span>
    `;
    els.eventLog.appendChild(card);
  });
}

async function request(url, options = {}) {
  const headers = {
    "content-type": "application/json"
  };
  const adminToken = localStorage.getItem("adminToken");

  if (adminToken) {
    headers["x-admin-token"] = adminToken;
  }

  let response = await fetch(url, {
    headers,
    ...options
  });

  if (response.status === 401) {
    const token = prompt("Digite o token de administrador:");
    if (token) {
      localStorage.setItem("adminToken", token);
      response = await fetch(url, {
        headers: {
          ...headers,
          "x-admin-token": token
        },
        ...options
      });
    }
  }

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Erro na requisicao.");
  }
  return data;
}

async function publicRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: { "content-type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || "Erro na requisicao.");
  }
  return data;
}

function labelForStep(type) {
  return {
    message: "Mensagem",
    delay: "Espera",
    tag: "Etiqueta"
  }[type] || "Passo";
}

function labelForEvent(status) {
  return {
    matched: "Combinou com fluxo",
    unmatched: "Recebido sem fluxo",
    invalid: "Recebido invalido"
  }[status] || "Webhook recebido";
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
