// Documentos para imprimir o guardar en PDF: hoja de pedido y factura.
import { q } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { esc, eur } from "@/lib/mail";
import { orderLines } from "@/lib/orders";
import { invoiceToken, invoiceOf } from "@/lib/invoices";
import { safeEqual } from "@/lib/auth";

const SHOP = { name: "Javier Mercadé López", brand: "Evasion Print · Evasion Running Vilanova", nif: "52427223B", addr: "C/ Tetuán, 4", city: "08800 Vilanova i la Geltrú (Barcelona)", tel: "696 356 962", email: "info@evasionprint.com" };
const r2 = (n) => Math.round(n * 100) / 100;
const dES = (d) => new Date(d).toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Madrid" });

function page(title, inner) {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
body{font:14px/1.45 Arial,Helvetica,sans-serif;color:#15171c;margin:0;background:#eceef1}
.doc{max-width:800px;margin:24px auto;background:#fff;padding:40px;box-shadow:0 2px 14px rgba(0,0,0,.08)}
.top{display:flex;justify-content:space-between;gap:24px;align-items:flex-start;border-bottom:2px solid #15171c;padding-bottom:16px}
.brand{font-weight:900;font-size:22px;letter-spacing:.02em}.brand i{font-family:Georgia,serif;font-weight:400}
h1{font-size:22px;margin:0 0 4px;text-align:right}.muted{color:#6b7078}
.cols{display:flex;gap:24px;margin:20px 0}.cols>div{flex:1}.lbl{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#6b7078;margin-bottom:4px}
table{width:100%;border-collapse:collapse;margin-top:8px}th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:#6b7078;border-bottom:1px solid #d9dce1;padding:6px 4px}
td{padding:8px 4px;border-bottom:1px solid #eceef1;vertical-align:top}.r{text-align:right;white-space:nowrap}
.tot{margin-left:auto;width:300px;margin-top:14px}.tot div{display:flex;justify-content:space-between;padding:4px 0}.tot .big{font-weight:700;font-size:17px;border-top:2px solid #15171c;padding-top:8px}
.foot{margin-top:28px;font-size:11px;color:#6b7078}
.bar{max-width:800px;margin:16px auto 0;display:flex;gap:8px;justify-content:flex-end}.bar button{font:600 14px Arial;padding:10px 16px;border-radius:999px;border:0;background:#15171c;color:#fff;cursor:pointer}
@media print{body{background:#fff}.doc{box-shadow:none;margin:0;max-width:none;padding:0}.bar{display:none}}
@media (max-width:600px){.doc{padding:20px;margin:0}.cols{flex-direction:column}.top{flex-direction:column}h1{text-align:left}.tot{width:100%}}
</style></head><body><div class="bar"><button onclick="print()">Imprimir o guardar en PDF</button></div><div class="doc">${inner}</div></body></html>`;
}

export async function GET(req) {
  const u = new URL(req.url);
  const ref = u.searchParams.get("ref") || "", type = ["factura", "presupuesto", "albaran"].includes(u.searchParams.get("type")) ? u.searchParams.get("type") : "pedido";
  const s = await getSession().catch(() => null);
  if (type === "presupuesto") {
    const qt = (await q("select data from quotes where ref=$1", [ref])).rows[0]?.data;
    if (!qt || !s || !(s.role === "admin" || (s.role === "client" && qt.client === s.client))) return new Response("No encontrado", { status: 404 });
    const L = Array.isArray(qt.lines) && qt.lines.length ? qt.lines : [{ name: qt.products || "Presupuesto", qty: 1, unit: +qt.answer?.total || 0, total: +qt.answer?.total || 0 }];
    const total = r2(L.reduce((a, l) => a + (+l.total || 0), 0)), base = r2(total / 1.21), iva = r2(total - base);
    const rows = L.map((l) => `<tr><td>${esc(l.name)}${l.sizes ? `<br><small class="muted">${esc(l.sizes)}</small>` : ""}${(l.parts || l.item?.parts || []).length ? `<br><small class="muted">${esc((l.parts || l.item.parts).join(" · "))}</small>` : ""}</td><td class="r">${l.qty}</td><td class="r">${eur(+l.unit || 0)}</td><td class="r">${eur(+l.total || 0)}</td></tr>`).join("");
    return new Response(page(`Presupuesto ${ref}`, `<div class="top"><div><div class="brand">EVASION <i>Print</i></div><div class="muted">${SHOP.brand}</div></div><div><h1>Presupuesto</h1><div class="r"><b>${esc(ref)}</b><br>Fecha: ${dES(qt.answer?.date || qt.date)}${qt.validUntil ? `<br>Válido hasta: ${dES(qt.validUntil + "T12:00:00Z")}` : ""}</div></div></div>
      <div class="cols"><div><div class="lbl">Emisor</div><b>${SHOP.name}</b><br>NIF ${SHOP.nif}<br>${SHOP.addr}<br>${SHOP.city}<br>${SHOP.tel} · ${SHOP.email}</div><div><div class="lbl">Cliente</div><b>${esc(qt.company || qt.name)}</b>${qt.company && qt.name ? `<br>${esc(qt.name)}` : ""}<br>${esc(qt.email || "")}${qt.tel ? `<br>${esc(qt.tel)}` : ""}</div></div>
      <table><thead><tr><th>Concepto</th><th class="r">Ud</th><th class="r">Precio ud</th><th class="r">Importe</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot"><div class="big"><span>Total con IVA</span><span>${eur(total)}</span></div><div class="muted"><span>Base imponible</span><span>${eur(base)}</span></div><div class="muted"><span>IVA 21 %</span><span>${eur(iva)}</span></div></div>
      <div class="foot">${qt.answer?.days ? `Plazo: ${esc(qt.answer.days)}. ` : ""}${qt.answer?.notes ? esc(qt.answer.notes) + " " : ""}Precios con IVA incluido. Envío no incluido salvo que se indique.</div>`),
      { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
  }
  const head = (title, right) => `<div class="top"><div><div class="brand">EVASION <i>Print</i></div><div class="muted">${SHOP.brand}</div></div><div><h1>${title}</h1>${right}</div></div>`;
  const issuer = `<div><div class="lbl">Emisor</div><b>${SHOP.name}</b><br>NIF ${SHOP.nif}<br>${SHOP.addr}<br>${SHOP.city}<br>${SHOP.tel} · ${SHOP.email}</div>`;
  const HTML = { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } };
  if (type === "factura") {
    // por número (?n=) o por pedido (?ref=); con ?t= se puede abrir sin sesión (enlace del email)
    const number = u.searchParams.get("n") || (ref ? await invoiceOf(ref) : null);
    const inv = number ? (await q("select * from invoices where number=$1", [number])).rows[0] : null;
    if (!inv) return new Response("Esta factura aún no se ha generado.", { status: 404 });
    const t = u.searchParams.get("t");
    const ok = (t && safeEqual(t, invoiceToken(inv.number))) || (s && (s.role === "admin" || (s.role === "client" && inv.client === s.client)));
    if (!ok) return new Response("No encontrado", { status: 404 });
    const b = inv.data.billing || {}, L = inv.data.lines || [], R = inv.kind === "R";
    const total = r2(L.reduce((a, l) => a + l.total, 0)), base = r2(total / 1.21), iva = r2(total - base);
    const rows = L.map((l) => { const bl = r2(l.total / 1.21); return `<tr><td>${esc(l.d)}${l.sub ? `<br><small class="muted">${esc(l.sub)}</small>` : ""}</td><td class="r">${l.qty}</td><td class="r">${eur(r2(bl / (l.qty || 1)))}</td><td class="r">21 %</td><td class="r">${eur(bl)}</td></tr>`; }).join("");
    const refs = inv.refs || [inv.ref];
    const pay = inv.data.pay;
    const payTxt = pay === "transfer" ? "transferencia bancaria" : pay === "bizum" || pay === "bizum_tienda" ? "Bizum" : pay === "efectivo" ? "efectivo" : pay === "tpv" ? "tarjeta (TPV tienda)" : pay === "pendiente" ? "según acuerdo" : "tarjeta";
    let paid = inv.data.paid;
    if (paid == null) paid = (await q("select bool_and(paid) p from orders where ref = any($1)", [refs])).rows[0]?.p;
    const right = `<div class="r"><b>Nº ${esc(inv.number)}</b><br>Fecha: ${dES(inv.data.date || inv.created_at)}<br>${refs.length > 1 ? "Albaranes" : "Pedido"}: ${refs.map(esc).join(", ")}${R ? `<br>Rectifica a: <b>${esc(inv.rect_of)}</b> (${dES(inv.data.rectOfDate || inv.created_at)})` : ""}</div>`;
    return new Response(page(`${R ? "Factura rectificativa" : "Factura"} ${inv.number}`, `${head(R ? "Factura rectificativa" : "Factura", right)}
      ${inv.status === "anulada" && !R ? `<div style="border:2px solid #b42318;color:#b42318;font-weight:700;padding:8px 12px;margin-top:14px;text-align:center">FACTURA ANULADA por factura rectificativa</div>` : ""}
      <div class="cols">${issuer}<div><div class="lbl">Cliente</div><b>${esc(b.name)}</b><br>NIF/CIF ${esc(b.cif)}<br>${esc(b.addr)}<br>${esc(b.zip)} ${esc(b.city)}${b.province ? ` (${esc(b.province)})` : ""}</div></div>
      ${R ? `<p><b>Motivo de la rectificación:</b> ${esc(inv.data.reason || "")}${inv.data.mode === "total" ? " (anulación total)" : ""}</p>` : ""}
      <table><thead><tr><th>Concepto</th><th class="r">Ud</th><th class="r">Precio ud</th><th class="r">IVA</th><th class="r">Base</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot"><div><span>Base imponible</span><span>${eur(base)}</span></div><div><span>IVA 21 %</span><span>${eur(iva)}</span></div><div class="big"><span>Total</span><span>${eur(total)}</span></div></div>
      <div class="foot">${R ? "Factura rectificativa emitida conforme al art. 15 del Reglamento de facturación (RD 1619/2012)." : `Forma de pago: ${payTxt}${paid ? " · Pagada" : " · Pendiente de pago"}.`}</div>`), HTML);
  }
  const r = (await q("select ref,client,paid,pay,total,data,state,created_at from orders where ref=$1", [ref])).rows[0];
  const allowed = r && s && (s.role === "admin" || (s.role === "client" && r.client === s.client));
  if (!allowed) return new Response("No encontrado", { status: 404 });
  const o = { ...r.data, ...(r.state || {}), ref: r.ref };
  let L = orderLines(o);
  const total = r2(L.reduce((a, l) => a + l.total, 0));
  const base = r2(total / 1.21), iva = r2(total - base);
  if (type === "albaran") {
    const st = (o.status === "entregado") ? "Entregado" : "Pendiente de entrega";
    const rows = L.map((l) => `<tr><td>${esc(l.d)}${l.sub ? `<br><small class="muted">${esc(l.sub)}</small>` : ""}</td><td class="r">${l.qty}</td><td class="r">${eur(l.total)}</td></tr>`).join("");
    const inv = await invoiceOf(ref);
    return new Response(page(`Albarán ${ref}`, `${head("Albarán", `<div class="r"><b>Nº ${esc(ref)}</b><br>Fecha: ${dES(r.created_at)}<br>${st}${inv ? `<br>Factura: ${esc(inv)}` : ""}</div>`)}
      <div class="cols">${issuer}<div><div class="lbl">Cliente</div><b>${esc(o.company || o.name)}</b>${o.company ? `<br>${esc(o.name)}` : ""}<br>${esc(o.email || "")}<br>${esc(o.tel || "")}<br>${o.ship === "envio" ? `Entrega en: ${esc(o.addr)}` : "Recogida en tienda"}</div></div>
      <table><thead><tr><th>Concepto</th><th class="r">Ud</th><th class="r">Importe (IVA incl.)</th></tr></thead><tbody>${rows}</tbody></table>
      <div class="tot"><div class="big"><span>Total con IVA</span><span>${eur(total)}</span></div><div class="muted"><span>IVA incluido</span><span>${eur(iva)}</span></div></div>
      <div style="display:flex;gap:24px;margin-top:40px"><div style="flex:1;border-top:1px solid #15171c;padding-top:6px" class="muted">Recibí conforme (nombre, DNI y firma)</div><div style="flex:1;border-top:1px solid #15171c;padding-top:6px" class="muted">Fecha de entrega</div></div>`), HTML);
  }
  const rows = L.map((l) => `<tr><td>${esc(l.d)}${l.sub ? `<br><small class="muted">${esc(l.sub)}</small>` : ""}</td><td class="r">${l.qty}</td><td class="r">${eur(l.total)}</td></tr>`).join("");
  return new Response(page(`Pedido ${ref}`, `${head("Pedido", `<div class="r"><b>${esc(ref)}</b><br>Fecha: ${dES(r.created_at)}</div>`)}
    <div class="cols">${issuer}<div><div class="lbl">Cliente</div><b>${esc(o.company || o.name)}</b>${o.company ? `<br>${esc(o.name)}` : ""}<br>${esc(o.email)}<br>${esc(o.tel)}<br>${o.ship === "envio" ? `Envío a: ${esc(o.addr)}` : "Recogida en tienda"}</div></div>
    <table><thead><tr><th>Concepto</th><th class="r">Ud</th><th class="r">Importe (IVA incl.)</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="tot"><div class="big"><span>Total con IVA</span><span>${eur(total)}</span></div><div class="muted"><span>IVA incluido</span><span>${eur(iva)}</span></div></div>
    <div class="foot">Este documento no es una factura. Puedes generar la factura desde tu área de cliente.</div>`),
    { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
