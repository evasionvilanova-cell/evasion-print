// Solicitud de presupuesto desde la web.
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";
import { mailQuote } from "@/lib/mail";

const str = (v, n = 2000) => String(v ?? "").slice(0, n);

export async function POST(req) {
  const d = await body(req, 200_000).catch(() => null);
  if (!d) return fail("Datos no válidos.");
  if (!str(d.name).trim() || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(d.email, 200))) return fail("Revisa tu nombre y tu email.");
  const s = await getSession().catch(() => null);
  const ref = /^PR-\d{2}-[A-Z0-9]{4,6}$/.test(d.ref || "") ? d.ref : "PR-" + String(new Date().getFullYear()).slice(2) + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const files = (Array.isArray(d.files) ? d.files : []).slice(0, 12).map((f) => ({ name: str(f.name, 200), key: f.key && String(f.key).startsWith("q_") ? String(f.key) : null, type: str(f.type, 100), size: +f.size || 0 }));
  const qt = {
    ref, date: new Date().toISOString(), status: "nuevo", client: s && s.role === "client" ? s.client : null,
    name: str(d.name, 120), email: str(d.email, 200), tel: str(d.tel, 40), company: str(d.company, 160),
    products: str(d.products), colors: str(d.colors), qty: str(d.qty, 200), positions: str(d.positions), inks: str(d.inks),
    tech: str(d.tech, 40), deadline: str(d.deadline, 60), comments: str(d.comments, 4000), files, answer: null,
  };
  const r = await q("insert into quotes(ref,data) values($1,$2) on conflict(ref) do nothing returning ref", [ref, JSON.stringify(qt)]);
  if (!r.rowCount) return fail("Prueba otra vez, por favor.", 409);
  await mailQuote(qt);
  return json({ ok: true, ref });
}
