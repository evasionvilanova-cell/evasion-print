// Gestión → Facturación: facturar albaranes, rectificar y enviar facturas.
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, fail, body, siteUrl } from "@/lib/http";
import { createInvoice, rectify, listInvoices, invoiceToken, InvoiceError } from "@/lib/invoices";
import { sendMail, esc, eur } from "@/lib/mail";

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  const d = await body(req).catch(() => ({}));
  try {
    if (d.action === "list") return json({ ok: true, invoices: await listInvoices() });
    if (d.action === "create") {
      const r = await createInvoice({ refs: d.refs, billing: d.billing });
      return json({ ok: true, number: r.number, invoices: await listInvoices() });
    }
    if (d.action === "rectify") {
      const r = await rectify({ number: d.number, mode: d.mode === "total" ? "total" : "parcial", amount: d.amount, reason: d.reason });
      return json({ ok: true, number: r.number, invoices: await listInvoices() });
    }
    if (d.action === "send") {
      const inv = (await q("select number,kind,data from invoices where number=$1", [String(d.number || "")])).rows[0];
      if (!inv) return fail("No encuentro esa factura.", 404);
      const to = String(d.to || "").trim();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) return fail("Escribe un email válido.");
      const link = `${siteUrl(req)}/api/doc?type=factura&n=${encodeURIComponent(inv.number)}&t=${invoiceToken(inv.number)}`;
      const total = (inv.data.lines || []).reduce((a, l) => a + l.total, 0);
      const title = inv.kind === "R" ? "Factura rectificativa" : "Factura";
      const subject = `${title} ${inv.number} · Evasion Print`;
      const text = `Hola,\n\nTe enviamos la ${title.toLowerCase()} ${inv.number} por ${eur(total)}.\n\nPuedes verla y descargarla en PDF aquí:\n${link}\n\nGracias,\nEvasion Print`;
      const sent = await sendMail({ to, subject, html: `<div style="font-family:Arial,sans-serif;font-size:15px;color:#15171c"><p>Hola,</p><p>Te enviamos la ${title.toLowerCase()} <b>${esc(inv.number)}</b> por <b>${eur(total)}</b>.</p><p><a href="${link}" style="display:inline-block;background:#15171c;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Ver y descargar la factura</a></p><p>Gracias,<br>Evasion Print</p></div>` });
      if (sent.skipped) return json({ ok: true, mailto: `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(text)}`, link });
      if (!sent.ok) return fail("No se ha podido enviar el email. Prueba otra vez.", 502);
      await q("update invoices set sent_at=now() where number=$1", [inv.number]);
      return json({ ok: true, sent: true, invoices: await listInvoices() });
    }
    if (d.action === "mark-sent") {
      await q("update invoices set sent_at=now() where number=$1", [String(d.number || "")]);
      return json({ ok: true, invoices: await listInvoices() });
    }
  } catch (e) {
    if (e instanceof InvoiceError) return fail(e.message);
    throw e;
  }
  return fail("Acción no válida.");
}
