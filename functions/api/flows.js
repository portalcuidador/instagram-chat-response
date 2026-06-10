import { json, normalizeFlows, readFlows, requireAdmin, writeFlows } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  return json(await readFlows(env));
}

export async function onRequestPut({ request, env }) {
  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  const body = await request.json();
  const normalized = normalizeFlows(body);
  await writeFlows(env, normalized);
  return json(normalized);
}
