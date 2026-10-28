// Cambios de Gestión en un pedido: estado, notas, elementos quitados, devoluciones, mensajes…
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  const { ref, patch, paid } = await body(req, 4_400_000).catch(() => ({}));
  if (ref && paid === true) await q("update orders set paid=true, paid_at=now() where ref=$1 and pay not in ('card','bizum')", [ref]);
  if (ref && paid === false) await q("update orders set paid=false, paid_at=null where ref=$1 and pay not in ('card','bizum')", [ref]);
  if (ref && patch && patch.pay && ["pendiente", "transfer", "efectivo", "tpv", "bizum_tienda"].includes(patch.pay)) await q("update orders set pay=$2 where ref=$1 and pay not in ('card','bizum')", [ref, patch.pay]);
  if (ref && patch && Number.isFinite(+patch.total) && patch.total !== undefined) await q("update orders set total=$2 where ref=$1", [ref, Math.round(+patch.total * 100) / 100]);
  if (!ref || !patch || typeof patch !== "object") return fail("Faltan datos.");
  const r = await q("update orders set state = state || $2::jsonb where ref=$1 returning ref", [ref, JSON.stringify(patch)]);
  if (!r.rowCount) return fail("No encuentro ese pedido.", 404);
  if (patch.status) await q("update orders set status=$2 where ref=$1", [ref, String(patch.status)]);
  return json({ ok: true });
}
