// Solo para pruebas sin Vercel Blob: guarda el archivo como data URL en la base de datos.
import { q } from "@/lib/db";
import { canUpload, scopeOf, blobEnabled } from "@/lib/files";
import { json, fail, body } from "@/lib/http";

export async function POST(req) {
  if (blobEnabled()) return fail("Usa la subida a Vercel Blob.", 400);
  const { key, data } = await body(req, 4_400_000).catch(() => ({}));
  const c = await canUpload(key);
  if (!c.ok) return fail(c.why, 401);
  if (typeof data !== "string" || !data.startsWith("data:")) return fail("Archivo no válido.");
  const sql = c.admin
    ? "insert into files(key,url,mime,size,scope) values($1,$2,$3,$4,$5) on conflict(key) do update set url=$2"
    : "insert into files(key,url,mime,size,scope) values($1,$2,$3,$4,$5) on conflict(key) do nothing";
  const r = await q(sql, [key, data, data.slice(5, data.indexOf(";")), data.length, scopeOf(key)]);
  if (!r.rowCount) return fail("Ese archivo ya existe.", 409);
  return json({ ok: true, url: data });
}
