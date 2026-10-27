// Borrar una foto o archivo desde Gestión.
import { del } from "@vercel/blob";
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { blobEnabled } from "@/lib/files";
import { json, fail, body } from "@/lib/http";

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  const { key } = await body(req).catch(() => ({}));
  const r = await q("delete from files where key=$1 returning url", [String(key || "")]);
  const url = r.rows[0]?.url;
  if (url && url.startsWith("https://") && blobEnabled()) await del(url).catch(() => {});
  return json({ ok: true });
}
