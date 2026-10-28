// Crea el pedido con el precio calculado en el servidor y prepara el pago en Redsys.
import { q } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { json, fail, body, siteUrl } from "@/lib/http";
import { loadKv, priceCart, PriceError } from "@/lib/shop";
import { buildPayment, redsysConfig } from "@/lib/redsys";
import { orderToken, etaFrom, markPaidSimulated } from "@/lib/orders";
import { mailOrderTransfer } from "@/lib/mail";

const str = (v, n = 300) => String(v ?? "").trim().slice(0, n);

export async function POST(req) {
  let d;
  try { d = await body(req, 3_000_000); } catch { return fail("El carrito es demasiado grande. Divide el pedido en dos."); }
  const c = d.customer || {};
  const items = Array.isArray(d.items) ? d.items.slice(0, 60) : [];
  const err = [];
  if (!items.length) err.push("El carrito está vacío.");
  if (!str(c.name)) err.push("Escribe tu nombre.");
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(c.email))) err.push("Revisa el email.");
  if (str(c.tel).replace(/\D/g, "").length < 9) err.push("Escribe un teléfono de 9 cifras.");
  if (!["tienda", "envio"].includes(c.ship)) err.push("Elige recogida o envío.");
  if (c.ship === "envio" && str(c.addr).length < 8) err.push("Completa la dirección de envío.");
  if (!["card", "bizum", "transfer"].includes(c.pay)) err.push("Elige cómo pagar.");
  if (err.length) return fail(err.join(" "));

  const s = await getSession().catch(() => null);
  // Gestión puede hacer el pedido en nombre de un cliente (desde «Ver su área»)
  const fromAdmin = s && s.role === "admin";
  const itemClients = [...new Set(items.map((i) => i && i.client).filter(Boolean))];
  if (fromAdmin && itemClients.length > 1) return fail("El carrito tiene productos de dos clientes distintos. Haz un pedido para cada uno.");
  const clientKey = s && s.role === "client" ? s.client : fromAdmin ? itemClients[0] || null : null;
  const kv = await loadKv();
  let price;
  try { price = priceCart(kv, items, { clientKey, ship: c.ship }); }
  catch (e) { if (e instanceof PriceError) return fail(e.message, 422); throw e; }
  if (price.changed) {
    return json({ error: "Hemos actualizado algún precio desde que lo añadiste al carrito. Revisa el total y vuelve a pulsar Pagar.", lines: price.lines, total: price.total }, 409);
  }

  // Transferencia: solo para clientes con la opción activada en Gestión
  const transfer = c.pay === "transfer";
  if (transfer && !(clientKey && (kv.ep_clients || {})[clientKey]?.transfer)) return fail("El pago por transferencia no está disponible para esta cuenta.", 403);
  const cfg = redsysConfig();
  const simulated = !transfer && !cfg && process.env.SIMULATED_PAY === "on";
  if (!transfer && !cfg && !simulated) return fail("El pago con tarjeta aún no está activado. Escríbenos a info@evasionprint.com o por WhatsApp al 696 356 962.", 503);

  const yy = String(new Date().getFullYear()).slice(2);
  const seq = (await q("select nextval('order_seq')::int n")).rows[0].n;
  const ref = `EP-${yy}-${seq}`;
  const redsysOrder = `${yy}${String(seq).padStart(6, "0")}01`;
  const byLine = new Map(price.lines.map((l) => [l.id, l]));
  const cleanItems = items.map((i) => { const l = byLine.get(i.id) || {}; return { ...i, logos: undefined, total: l.total, qty: l.qty, days: l.days }; });
  const maxDays = Math.max(...price.lines.map((l) => l.days));
  const due = etaFrom(maxDays + (c.ship === "envio" ? 1 : 0));
  const order = {
    ref, date: new Date().toISOString(), status: "nuevo",
    client: clientKey, by: clientKey ? (fromAdmin ? `Gestión (${String(c.name || "").trim() || s.email})` : s.name) : null,
    name: str(c.name, 120), email: str(c.email, 200).toLowerCase(), tel: str(c.tel, 40), company: str(c.company, 160), cif: str(c.cif, 30),
    ship: c.ship, addr: c.ship === "envio" ? str(c.addr, 300) : "", pay: c.pay,
    subtotal: price.subtotal, shipping: price.shipping, total: price.total, due: due.toISOString(), items: cleanItems, notes: "",
  };
  await q(
    `insert into orders(ref,seq,status,total,email,client,pay,redsys_order,redsys_attempts,data,price_check)
     values($1,$2,'pendiente_pago',$3,$4,$5,$6,$7,1,$8,$9)`,
    [ref, seq, price.total, order.email, clientKey, c.pay, simulated || transfer ? null : redsysOrder, JSON.stringify(order), JSON.stringify(price)]
  );
  if (transfer) {
    await q("update orders set status='nuevo' where ref=$1", [ref]);
    await mailOrderTransfer(order, kv.ep_rates || {}).catch((e) => console.error(e));
    return json({ ref, token: orderToken(ref), transfer: true, total: price.total });
  }
  const t = orderToken(ref);
  const site = siteUrl(req);
  if (simulated) {
    await markPaidSimulated(ref);
    return json({ ref, token: t, simulated: true, total: price.total });
  }
  const pay = buildPayment(cfg, {
    amount: price.total, order: redsysOrder, method: c.pay,
    notifyUrl: `${site}/api/redsys/notify`,
    okUrl: `${site}/?pedido=${encodeURIComponent(ref)}&t=${t}`,
    koUrl: `${site}/?pedido=${encodeURIComponent(ref)}&t=${t}&pago=ko`,
    description: `Pedido ${ref} · Evasion Print`, holder: order.name,
  });
  return json({ ref, token: t, total: price.total, redsys: pay });
}
