// Estado de un pedido para la página de gracias (con el enlace firmado que vuelve de Redsys).
import { q } from "@/lib/db";
import { json, fail } from "@/lib/http";
import { orderToken, applyRedsys } from "@/lib/orders";
import crypto from "node:crypto";

export async function GET(req) {
  const u = new URL(req.url);
  const ref = u.searchParams.get("ref") || "", t = u.searchParams.get("t") || "";
  const want = orderToken(ref);
  if (!ref || t.length !== want.length || !crypto.timingSafeEqual(Buffer.from(t), Buffer.from(want))) return fail("Enlace no válido.", 403);
  // Si Redsys devuelve los parámetros en la URL, se comprueban igual que la notificación.
  const mp = u.searchParams.get("Ds_MerchantParameters"), sig = u.searchParams.get("Ds_Signature");
  if (mp && sig) await applyRedsys(mp, sig).catch(() => {});
  const r = await q("select ref,paid,status,total,pay,data from orders where ref=$1", [ref]);
  const o = r.rows[0];
  if (!o) return fail("No encuentro el pedido.", 404);
  return json({ ref: o.ref, paid: o.paid, status: o.status, total: +o.total, pay: o.pay, ship: o.data.ship, due: o.data.due, name: o.data.name, email: o.data.email });
}
