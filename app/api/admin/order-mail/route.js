// Gestión → pedido → «Mensaje al cliente»: lo envía por email y lo apunta en el pedido.
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";
import { mailOrderMessage } from "@/lib/mail";

const SUBJ = { produccion: "está en producción", listo: "ya está listo", entregado: "entregado", incidencia: "necesitamos revisar tu archivo", cambios: "cambios en tu pedido" };

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  const { ref, text, tpl } = await body(req).catch(() => ({}));
  const t = String(text || "").trim().slice(0, 4000);
  if (!t) return fail("Escribe el mensaje.");
  const r = (await q("select ref,email,client,data,state from orders where ref=$1", [String(ref || "")])).rows[0];
  if (!r) return fail("No encuentro ese pedido.", 404);
  const o = { ...r.data, ...(r.state || {}), ref: r.ref, email: r.email || r.data.email, client: r.client || r.data.client };
  if (!o.email) return fail("Este pedido no tiene email del cliente.");
  const subject = `Pedido ${o.ref}${SUBJ[tpl] ? " · " + SUBJ[tpl] : ""} · Evasion Print`;
  const sent = await mailOrderMessage(o, t, subject);
  if (sent.skipped) return fail("El envío de emails aún no está configurado (falta RESEND_API_KEY en Vercel).", 503);
  if (!sent.ok) return fail("No se ha podido enviar el email. Prueba otra vez.", 502);
  const msg = { date: new Date().toISOString(), text: t, email: true, to: (sent.to || [o.email]).join(", ") };
  const messages = [...((r.state && r.state.messages) || []), msg];
  await q("update orders set state = coalesce(state,'{}'::jsonb) || $2::jsonb where ref=$1", [r.ref, JSON.stringify({ messages, msgDraft: null })]);
  return json({ ok: true, messages });
}
