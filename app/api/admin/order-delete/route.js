// Eliminar un pedido de prueba. Si ya tiene factura, no se puede eliminar (cancélalo).
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  const { ref } = await body(req).catch(() => ({}));
  const inv = (await q("select number from invoices where ref=$1", [String(ref || "")])).rows[0];
  if (inv) return fail(`Este pedido tiene la factura ${inv.number}: no se puede eliminar. Cámbialo a «Cancelado».`, 409);
  const r = await q("delete from orders where ref=$1", [String(ref || "")]);
  if (!r.rowCount) return fail("No encuentro ese pedido.", 404);
  return json({ ok: true });
}
