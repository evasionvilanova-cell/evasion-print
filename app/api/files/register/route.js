// Tras subir a Vercel Blob, el navegador avisa de la URL para enlazarla con su clave.
import { q } from "@/lib/db";
import { canUpload, scopeOf } from "@/lib/files";
import { json, fail, body } from "@/lib/http";

export async function POST(req) {
  const { key, url, mime, size } = await body(req).catch(() => ({}));
  const c = await canUpload(key);
  if (!c.ok) return fail(c.why, 401);
  let u;
  try { u = new URL(url); } catch { return fail("URL no válida."); }
  const store = String(process.env.BLOB_READ_WRITE_TOKEN || "").split("_")[3];
  if (u.protocol !== "https:" || !u.hostname.endsWith(".public.blob.vercel-storage.com")) return fail("URL no válida.");
  if (store && !u.hostname.toLowerCase().startsWith(store.toLowerCase() + ".")) return fail("URL no válida.");
  const sql = c.admin
    ? "insert into files(key,url,mime,size,scope) values($1,$2,$3,$4,$5) on conflict(key) do update set url=$2,mime=$3,size=$4"
    : "insert into files(key,url,mime,size,scope) values($1,$2,$3,$4,$5) on conflict(key) do nothing";
  const r = await q(sql, [key, url, String(mime || "").slice(0, 100), +size || 0, scopeOf(key)]);
  if (!r.rowCount) return fail("Ese archivo ya existe.", 409);
  return json({ ok: true, url });
}
