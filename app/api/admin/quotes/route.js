// Gestión guarda la lista de presupuestos (respuestas, estados, conversiones a cliente).
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  const { list } = await body(req, 4_400_000).catch(() => ({}));
  if (!Array.isArray(list)) return fail("Faltan datos.");
  for (const item of list) {
    if (!item || !item.ref || item.example) continue;
    await q("insert into quotes(ref,data) values($1,$2) on conflict(ref) do update set data=$2", [item.ref, JSON.stringify(item)]);
  }
  return json({ ok: true });
}
