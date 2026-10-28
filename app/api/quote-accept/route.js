// El cliente acepta un presupuesto desde su área: se crea el pedido y se paga (Redsys o transferencia).
import { q } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { json, fail, body, siteUrl } from "@/lib/http";
import { loadKv } from "@/lib/shop";
import { buildPayment, redsysConfig } from "@/lib/redsys";
import { orderToken, etaFrom } from "@/lib/orders";
import { mailOrderTransfer } from "@/lib/mail";
import { str, r2, nextOrderRef } from "@/lib/manual";

export async function POST(req) {
  const s = await getSession().catch(() => null);
  if (!s || s.role !== "client") return fail("Inicia sesión en tu área de cliente.", 401);
  const d = await body(req).catch(() => ({}));
  const row = (await q("select data from quotes where ref=$1", [str(d.ref, 40)])).rows[0];
  const qt = row && row.data;
  if (!qt || qt.client !== s.client || !Array.isArray(qt.lines) || !qt.answer) return fail("No encuentro ese presupuesto.", 404);
  if (qt.status !== "enviado") return fail(qt.status === "aceptado" ? "Este presupuesto ya está aceptado." : "Este presupuesto ya no está disponible.", 409);
  if (qt.validUntil && qt.validUntil < new Date().toISOString().slice(0, 10)) return fail("Este presupuesto ha caducado. Escríbenos y lo renovamos.", 409);
  const c = d.customer || {};
  if (!["card", "bizum", "transfer"].includes(c.pay)) return fail("Elige cómo pagar.");
  if (c.ship === "envio" && str(c.addr).length < 8) return fail("Completa la dirección de envío.");
  if (str(c.tel).replace(/\D/g, "").length < 9) return fail("Escribe un teléfono de 9 cifras.");
  const kv = await loadKv();
  const transfer = c.pay === "transfer";
  if (transfer && !(kv.ep_clients || {})[s.client]?.transfer) return fail("El pago por transferencia no está disponible para esta cuenta.", 403);
  const cfg = redsysConfig();
  if (!transfer && !cfg) return fail("El pago con tarjeta aún no está activado. Escríbenos y te lo cerramos por otra vía.", 503);

  const ship = c.ship === "envio" ? "envio" : "tienda";
  const items = qt.lines.map((l, i) => ({ id: `Q${i}`, free: true, name: l.name, qty: l.qty, unit: l.unit, cost: (qt.lineCosts || [])[i] ?? null, total: r2(l.total), sizes: l.sizes || "", parts: [`Presupuesto ${qt.ref}`] }));
  const subtotal = r2(items.reduce((a, i) => a + i.total, 0));
  const R = kv.ep_rates || {};
  const shipping = ship === "envio" ? (subtotal >= (R.freeShip ?? 100) ? 0 : (R.shipping ?? 5.9)) : 0;
  const total = r2(subtotal + shipping);
  const { ref, seq, yy } = await nextOrderRef();
  const redsysOrder = `${yy}${String(seq).padStart(6, "0")}01`;
  const order = {
    ref, date: new Date().toISOString(), status: "nuevo", client: s.client, by: s.name, fromQuote: qt.ref,
    name: str(c.name, 120) || s.name, email: str(c.email, 200).toLowerCase() || s.email, tel: str(c.tel, 40), company: qt.company || "", cif: str(c.cif, 30),
    ship, addr: ship === "envio" ? str(c.addr, 300) : "", pay: c.pay, subtotal, shipping, total,
    due: etaFrom(5).toISOString(), items, notes: qt.answer.days ? `Plazo del presupuesto: ${qt.answer.days}` : "",
  };
  await q(
    `insert into orders(ref,seq,status,total,email,client,pay,redsys_order,redsys_attempts,data)
     values($1,$2,$3,$4,$5,$6,$7,$8,1,$9)`,
    [ref, seq, transfer ? "nuevo" : "pendiente_pago", total, order.email, s.client, c.pay, transfer ? null : redsysOrder, JSON.stringify(order)]
  );
  const t = orderToken(ref);
  if (transfer) {
    await q("update quotes set data = data || $2::jsonb where ref=$1", [qt.ref, JSON.stringify({ status: "aceptado", orderRef: ref, acceptedAt: new Date().toISOString() })]);
    await mailOrderTransfer(order, R).catch(() => {});
    return json({ ref, token: t, transfer: true, total });
  }
  const site = siteUrl(req);
  const pay = buildPayment(cfg, {
    amount: total, order: redsysOrder, method: c.pay,
    notifyUrl: `${site}/api/redsys/notify`,
    okUrl: `${site}/?pedido=${encodeURIComponent(ref)}&t=${t}`,
    koUrl: `${site}/?pedido=${encodeURIComponent(ref)}&t=${t}&pago=ko`,
    description: `Pedido ${ref} · Presupuesto ${qt.ref}`, holder: order.name,
  });
  return json({ ref, token: t, total, redsys: pay });
}
