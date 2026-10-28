// Presupuesto creado desde Gestión para un cliente (existente o nuevo). El cliente lo ve en su área.
import crypto from "node:crypto";
import { q } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";
import { loadKv } from "@/lib/shop";
import { str, r2, freeLines, createClient } from "@/lib/manual";

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  let d;
  try { d = await body(req, 500_000); } catch { return fail("Demasiados datos."); }
  const kv = await loadKv(["ep_clients"]);
  let key = d.client && (kv.ep_clients || {})[d.client] ? d.client : null, pass = null;
  const nc = d.newClient || {};
  if (!key && d.newClient) {
    if (!str(nc.company) && !str(nc.name)) return fail("Escribe el nombre del cliente nuevo.");
    try { ({ key, pass } = await createClient(kv, nc)); } catch (e) { return fail(e.message); }
  }
  if (!key) return fail("Elige un cliente o crea uno nuevo.");
  const fl = freeLines(d.lines);
  const lineCosts = fl.map((l) => l.cost);
  const lines = fl.map(({ id, free, cost, ...l }) => l);
  if (!lines.length) return fail("Añade al menos una línea con concepto, unidades y precio.");
  const total = r2(lines.reduce((a, l) => a + l.total, 0));
  const c = kv.ep_clients[key];
  const u = (c.users || [])[0] || {};
  const ref = d.ref && /^PR-\d{2}-[A-Z0-9]{4,6}$/.test(d.ref) ? d.ref : "PR-" + String(new Date().getFullYear()).slice(2) + "-" + crypto.randomBytes(3).toString("hex").toUpperCase();
  const qt = {
    ref, kind: "presupuesto", manual: true, date: new Date().toISOString(), status: "enviado", client: key,
    name: str(nc.name, 120) || u.name || c.name, email: str(nc.email, 200).toLowerCase() || u.email || "", tel: str(nc.tel, 40) || c.contact || "", company: c.name,
    products: lines.map((l) => `${l.qty} × ${l.name}`).join(" · ").slice(0, 400), qty: String(lines.reduce((a, l) => a + l.qty, 0)),
    lines, lineCosts, validUntil: str(d.validUntil, 10), comments: "", files: [],
    answer: { total, unit: "", days: str(d.days, 60), notes: str(d.notes, 2000), date: new Date().toISOString() },
  };
  await q("insert into quotes(ref,data) values($1,$2) on conflict(ref) do update set data=$2", [ref, JSON.stringify(qt)]);
  return json({ ok: true, ref, client: key, pass, email: qt.email });
}
