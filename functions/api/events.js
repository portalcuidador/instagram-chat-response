import { json, readEvents, requireAdmin, writeEvents } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  return json(await readEvents(env));
}

export async function onRequestDelete({ request, env }) {
  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  await writeEvents(env, { items: [] });
  return json(await readEvents(env));
}
