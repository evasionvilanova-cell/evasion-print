// Pedido creado a mano desde Gestión: productos del área del cliente y/o líneas libres.
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";
import { loadKv, priceCart, PriceError } from "@/lib/shop";
import { etaFrom } from "@/lib/orders";
import { str, r2, freeLines, nextOrderRef, MANUAL_PAY } from "@/lib/manual";

export async function POST(req) {
  const s = await requireAdmin();
  if (!s) return fail("Inicia sesión en Gestión.", 401);
  let d;
  try { d = await body(req, 3_000_000); } catch { return fail("Demasiados datos."); }
  const c = d.customer || {};
  const kv = await loadKv();
  const clientKey = d.client && (kv.ep_clients || {})[d.client] ? d.client : null;
  const cpItems = (Array.isArray(d.items) ? d.items : []).filter((i) => i && i.cpId).map((i) => ({ ...i, client: clientKey }));
  const free = freeLines(d.free);
  if (!cpItems.length && !free.length) return fail("Añade al menos un producto o una línea.");
  if (!str(c.name) && !clientKey) return fail("Escribe el nombre del cliente.");
  const ship = c.ship === "envio" ? "envio" : "tienda";
  let price = { lines: [], subtotal: 0 };
  if (cpItems.length) {
    try { price = priceCart(kv, cpItems, { clientKey, ship: "tienda", ignoreMin: true }); }
    catch (e) { if (e instanceof PriceError) return fail(e.message, 422); throw e; }
  }
  const byLine = new Map(price.lines.map((l) => [l.id, l]));
  const items = [
    ...cpItems.map((i) => { const l = byLine.get(i.id) || {}; return { ...i, logos: undefined, total: l.total, qty: l.qty, days: l.days }; }),
    ...free,
  ];
  const subtotal = r2(items.reduce((a, i) => a + (+i.total || 0), 0));
  const R = kv.ep_rates || {};
  const shipping = ship === "envio" ? (d.shipping != null && d.shipping !== "" ? r2(+d.shipping || 0) : subtotal >= (R.freeShip ?? 100) ? 0 : (R.shipping ?? 5.9)) : 0;
  const total = r2(subtotal + shipping);
  const pay = MANUAL_PAY.includes(d.pay) ? d.pay : "pendiente";
  const paid = !!d.paid && pay !== "pendiente";
  const { ref, seq } = await nextOrderRef();
  const units = items.reduce((a, i) => a + (+i.qty || 0), 0);
  const due = d.due && /^\d{4}-\d{2}-\d{2}$/.test(d.due) ? new Date(d.due + "T12:00:00Z") : etaFrom(units >= (R.bigQty || 50) ? R.bigDays || 5 : R.prodDays || 3);
  const order = {
    ref, date: new Date().toISOString(), status: "nuevo", manual: true,
    client: clientKey, by: "Gestión",
    name: str(c.name, 120), email: str(c.email, 200).toLowerCase(), tel: str(c.tel, 40), company: str(c.company, 160), cif: str(c.cif, 30),
    ship, addr: ship === "envio" ? str(c.addr, 300) : "", pay,
    subtotal, shipping, total, due: due.toISOString(), items, notes: str(d.notes, 2000), fromQuote: str(d.fromQuote, 40) || null,
  };
  await q(
    `insert into orders(ref,seq,status,paid,paid_at,total,email,client,pay,data)
     values($1,$2,'nuevo',$3,case when $3 then now() end,$4,$5,$6,$7,$8)`,
    [ref, seq, paid, total, order.email || "-", clientKey, pay, JSON.stringify(order)]
  );
  return json({ ok: true, ref, total });
}
