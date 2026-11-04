// Gestión → presupuesto → enviar por email al cliente, con el enlace al presupuesto en PDF.
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, fail, body, siteUrl } from "@/lib/http";
import { quoteToken } from "@/lib/invoices";
import { sendMail, esc, eur } from "@/lib/mail";

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  const { ref, text, to } = await body(req).catch(() => ({}));
  const qt = (await q("select data from quotes where ref=$1", [String(ref || "")])).rows[0]?.data;
  if (!qt) return fail("Guarda primero el presupuesto.", 404);
  const t = String(text || "").trim().slice(0, 4000);
  if (!t) return fail("Escribe el mensaje.");
  const list = [...new Set(String(to || "").split(/[,;\s]+/).map((x) => x.trim().toLowerCase()).filter(Boolean))];
  if (!list.length || list.some((x) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x))) return fail("Revisa los emails del campo «Para».");
  if (list.length > 5) return fail("Como mucho 5 destinatarios.");
  const link = `${siteUrl(req)}/api/doc?type=presupuesto&ref=${encodeURIComponent(qt.ref)}&t=${quoteToken(qt.ref)}`;
  const total = +(qt.answer && qt.answer.total) || 0;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;color:#15171c">
    <div style="font-weight:900;font-size:22px;letter-spacing:.02em;margin:8px 0 18px">EVASION <i style="font-family:Georgia,serif;font-weight:400">Print</i></div>
    <p style="font-size:15px;white-space:pre-wrap">${esc(t)}</p>
    <p><a href="${link}" style="display:inline-block;background:#15171c;color:#fff;padding:12px 18px;border-radius:999px;text-decoration:none;font-weight:700">Ver el presupuesto${total ? " · " + eur(total) : ""}</a></p>
    <p style="font-size:12px;color:#6b7078">Si el botón no funciona, copia este enlace en el navegador:<br><a href="${link}" style="color:#1846d1;word-break:break-all">${link}</a></p>
    ${qt.client ? `<p style="font-size:13px;color:#6b7078">También lo tienes en tu área de cliente de evasionprint.com, donde puedes aceptarlo y pagarlo.</p>` : ""}
    <p style="color:#6b7078;font-size:12px;margin-top:28px">Evasion Print · C/ Tetuán, 4 · 08800 Vilanova i la Geltrú · 696 356 962 · info@evasionprint.com</p></div>`;
  const sent = await sendMail({ to: list, replyTo: process.env.SHOP_EMAIL || "info@evasionprint.com", subject: `Presupuesto ${qt.ref} · Evasion Print`, html });
  if (sent.skipped) return fail("El envío de emails aún no está configurado (falta RESEND_API_KEY en Vercel).", 503);
  if (!sent.ok) return fail("No se ha podido enviar el email. Prueba otra vez.", 502);
  const data = { ...qt, status: qt.status === "aceptado" ? "aceptado" : "enviado", sentAt: new Date().toISOString(), sentTo: list.join(", ") };
  await q("update quotes set data=$2 where ref=$1", [qt.ref, JSON.stringify(data)]);
  return json({ ok: true, quote: data });
}
