// Emails con Resend (https://resend.com). Si no hay clave configurada, no se envía nada y no falla.
const FROM = () => process.env.MAIL_FROM || "Evasion Print <info@evasionprint.com>";
const SHOP = () => process.env.SHOP_EMAIL || "info@evasionprint.com";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const eur = (n) => Number(n).toLocaleString("es-ES", { style: "currency", currency: "EUR" });

export async function sendMail({ to, subject, html, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { skipped: true };
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM(), to: Array.isArray(to) ? to : [to], subject, html, reply_to: replyTo }),
    });
    if (!r.ok) console.error("Resend", r.status, await r.text());
    return { ok: r.ok };
  } catch (e) {
    console.error("Resend", e);
    return { ok: false };
  }
}

function frame(inner) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#15171c">
  <div style="font-weight:900;font-size:22px;letter-spacing:.02em;margin:8px 0 18px">EVASION <i style="font-family:Georgia,serif;font-weight:400">Print</i></div>
  ${inner}
  <p style="color:#6b7078;font-size:12px;margin-top:28px">Evasion Print · C/ Tetuán, 4 · 08800 Vilanova i la Geltrú · 696 356 962 · info@evasionprint.com</p></div>`;
}

function itemsTable(o) {
  return `<table style="width:100%;border-collapse:collapse;font-size:14px">${(o.items || []).map((i) => `<tr>
    <td style="padding:8px 0;border-bottom:1px solid #e3e5e8"><b>${esc(i.qty)} × ${esc(i.name)}</b><br><span style="color:#6b7078;font-size:12px">${esc(i.sizes || "")}${i.parts && i.parts.length ? " · " + esc(i.parts.join(" · ")) : ""}</span></td>
    <td style="padding:8px 0;border-bottom:1px solid #e3e5e8;text-align:right;white-space:nowrap">${eur(i.total)}</td></tr>`).join("")}
    ${o.shipping ? `<tr><td style="padding:8px 0">Envío</td><td style="text-align:right">${eur(o.shipping)}</td></tr>` : ""}
    <tr><td style="padding:10px 0"><b>Total con IVA</b></td><td style="text-align:right"><b>${eur(o.total)}</b></td></tr></table>`;
}

export async function mailOrderPaid(o) {
  const first = String(o.name || "").split(" ")[0];
  const due = o.due ? new Date(o.due).toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" }) : "";
  await sendMail({
    to: o.email,
    replyTo: SHOP(),
    subject: `Pedido ${o.ref} confirmado`,
    html: frame(`<h2 style="font-family:Georgia,serif;font-weight:400">Gracias, ${esc(first)}. Tu pedido está pagado.</h2>
      <p>Revisamos tus archivos antes de producir. Solo te escribimos si hay que cambiar algo.</p>
      <p><b>${o.ship === "tienda" ? "Listo para recoger en la tienda" : "Enviado a tu dirección"}:</b> ${esc(due)} (aprox.)</p>
      ${itemsTable(o)}
      <p style="font-size:13px">Pago: ${o.pay === "bizum" ? "Bizum" : "Tarjeta"}${o.ship === "envio" ? ` · Envío a ${esc(o.addr)}` : " · Recogida en C/ Tetuán, 4"}</p>`),
  });
  await sendMail({
    to: SHOP(),
    replyTo: o.email,
    subject: `Nuevo pedido ${o.ref} · ${eur(o.total)} · ${o.name}`,
    html: frame(`<h2>Nuevo pedido pagado</h2><p>${esc(o.name)} · ${esc(o.email)} · ${esc(o.tel)}${o.company ? " · " + esc(o.company) : ""}</p>${itemsTable(o)}
      <p>Ábrelo en Gestión para ver la hoja de producción y descargar los archivos.</p>`),
  });
}

export async function mailOrderTransfer(o, rates) {
  const first = String(o.name || "").split(" ")[0];
  const iban = rates.iban || "", holder = rates.bankHolder || "Javier Mercadé López";
  await sendMail({
    to: o.email, replyTo: SHOP(),
    subject: `Pedido ${o.ref} recibido · datos para la transferencia`,
    html: frame(`<h2 style="font-family:Georgia,serif;font-weight:400">Gracias, ${esc(first)}. Tenemos tu pedido.</h2>
      <p>Empezamos a prepararlo ya. Cuando puedas, haz la transferencia:</p>
      <p style="background:#f3f4f6;padding:12px;border-radius:8px"><b>${esc(holder)}</b><br>${iban ? `IBAN: <b>${esc(iban)}</b><br>` : ""}Concepto: <b>${esc(o.ref)}</b><br>Importe: <b>${eur(o.total)}</b></p>
      ${itemsTable(o)}`),
  });
  await sendMail({
    to: SHOP(), replyTo: o.email,
    subject: `Nuevo pedido ${o.ref} por TRANSFERENCIA · ${eur(o.total)} · ${o.company || o.name}`,
    html: frame(`<h2>Nuevo pedido (pago por transferencia pendiente)</h2><p>${esc(o.name)} · ${esc(o.email)} · ${esc(o.tel)}${o.company ? " · " + esc(o.company) : ""}</p>${itemsTable(o)}
      <p>Cuando llegue el dinero, márcalo como cobrado en Gestión → pedido.</p>`),
  });
}

const KIND = { alta: "Solicitud de área de cliente", contacto: "Mensaje de contacto" };
export async function mailQuote(qt) {
  await sendMail({
    to: SHOP(),
    replyTo: qt.email,
    subject: `${KIND[qt.kind] || "Solicitud de presupuesto"} ${qt.ref} · ${qt.company || qt.name}`,
    html: frame(`<h2>${KIND[qt.kind] || "Nueva solicitud de presupuesto"}</h2>
      <p>${esc(qt.name)} · ${esc(qt.email)} · ${esc(qt.tel)}${qt.company ? " · " + esc(qt.company) : ""}</p>
      <p><b>Productos:</b> ${esc(qt.products)}<br><b>Cantidad:</b> ${esc(qt.qty)}<br><b>Fecha límite:</b> ${esc(qt.deadline)}<br><b>Comentarios:</b> ${esc(qt.comments)}</p>
      <p>${(qt.files || []).length} archivo(s) adjunto(s). Lo tienes en Gestión → Presupuestos.</p>`),
  });
  await sendMail({
    to: qt.email,
    replyTo: SHOP(),
    subject: qt.kind === "contacto" ? "Hemos recibido tu mensaje" : `Hemos recibido tu solicitud ${qt.ref}`,
    html: frame(`<h2 style="font-family:Georgia,serif;font-weight:400">Recibido, ${esc(String(qt.name).split(" ")[0])}.</h2><p>${qt.kind === "contacto" ? "Te respondemos lo antes posible." : qt.kind === "alta" ? "Te enviamos el acceso a tu área de cliente en 24 h laborables." : "Te respondemos con el precio en 24 h laborables."}</p>`),
  });
}

export { esc, eur };
