import { getGraphHost, json, requireAdmin } from "../_lib.js";

export async function onRequestGet({ request, env }) {
  const authError = requireAdmin(request, env);
  if (authError) {
    return authError;
  }

  const accessToken = String(env.META_ACCESS_TOKEN || "").trim();
  const igUserId = String(env.META_IG_USER_ID || "").trim();

  if (!accessToken || !igUserId) {
    return json({
      posts: [],
      error: "Configure META_ACCESS_TOKEN e META_IG_USER_ID no Cloudflare para listar postagens."
    });
  }

  const apiVersion = env.META_GRAPH_VERSION || "v25.0";
  const graphHost = getGraphHost(accessToken, env.META_GRAPH_HOST);
  const fields = "id,caption,permalink,timestamp,media_type";
  const url = new URL(`https://${graphHost}/${apiVersion}/${igUserId}/media`);
  url.searchParams.set("fields", fields);
  url.searchParams.set("limit", "25");
  url.searchParams.set("access_token", accessToken);

  const response = await fetch(url);
  const data = await response.json();

  if (!response.ok) {
    return json({ posts: [], error: data.error?.message || "Nao foi possivel listar postagens." }, 502);
  }

  return json({
    posts: (data.data || []).map((post) => ({
      id: post.id,
      caption: post.caption || "",
      permalink: post.permalink || "",
      timestamp: post.timestamp || "",
      mediaType: post.media_type || ""
    }))
  });
}
