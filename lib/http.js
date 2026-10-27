export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export const fail = (message, status = 400) => json({ error: message }, status);

export function siteUrl(req) {
  if (process.env.SITE_URL) return process.env.SITE_URL.replace(/\/$/, "");
  const h = req.headers;
  const host = h.get("x-forwarded-host") || h.get("host");
  const proto = h.get("x-forwarded-proto") || (host && host.startsWith("localhost") ? "http" : "https");
  return `${proto}://${host}`;
}

export async function body(req, max = 2_000_000) {
  const text = await req.text();
  if (text.length > max) throw new Error("too_big");
  try { return JSON.parse(text || "{}"); } catch { throw new Error("bad_json"); }
}
