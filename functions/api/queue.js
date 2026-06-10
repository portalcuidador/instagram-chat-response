import { json, readQueue, requireAdmin, writeQueue } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  return json(await readQueue(env));
}

export async function onRequestDelete({ request, env }) {
  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  await writeQueue(env, { items: [] });
  return json(await readQueue(env));
}
