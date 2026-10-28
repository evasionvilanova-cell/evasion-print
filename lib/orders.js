import crypto from "node:crypto";
import { q } from "./db.js";
import { readNotification, redsysConfig } from "./redsys.js";
import { mailOrderPaid } from "./mail.js";

export function orderToken(ref) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev").update("order:" + ref).digest("base64url").slice(0, 22);
}

// Fecha estimada: días laborables desde hoy (hora de Madrid); después de las 17:00 o en fin de semana cuenta desde mañana.
export function etaFrom(n, now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Madrid", hour: "numeric", hourCycle: "h23", weekday: "short" })
    .formatToParts(now).map((p) => [p.type, p.value]));
  const hour = +parts.hour, wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[parts.weekday];
  const late = hour >= 17 || wd === 0 || wd === 6;
  let left = n + (late && wd !== 0 && wd !== 6 ? 1 : 0);
  const d = new Date(now);
  while (left > 0) { d.setUTCDate(d.getUTCDate() + 1); const w = d.getUTCDay(); if (w !== 0 && w !== 6) left--; }
  return d;
}

// Marca el pedido como pagado si la notificación de Redsys es válida. Se puede llamar varias veces sin duplicar nada.
export async function applyRedsys(merchantParams, signature) {
  const cfg = redsysConfig();
  if (!cfg) return { ok: false, why: "sin_config" };
  const n = readNotification(cfg, merchantParams, signature);
  if (!n) return { ok: false, why: "firma" };
  const r = await q("select ref,total,paid,data from orders where redsys_order=$1", [n.order]);
  const o = r.rows[0];
  if (!o) return { ok: false, why: "pedido" };
  if (!n.authorized) {
    await q("update orders set redsys_result=$2 where ref=$1 and not paid", [o.ref, JSON.stringify(n.params)]);
    return { ok: true, ref: o.ref, paid: o.paid };
  }
  if (Math.abs(n.amount - +o.total) > 0.005) {
    await q("update orders set redsys_result=$2, status='revisar_importe' where ref=$1", [o.ref, JSON.stringify(n.params)]);
    return { ok: false, why: "importe", ref: o.ref };
  }
  const up = await q(
    "update orders set paid=true, paid_at=now(), status='nuevo', redsys_result=$2 where ref=$1 and not paid returning ref",
    [o.ref, JSON.stringify(n.params)]
  );
  if (up.rowCount) await mailOrderPaid({ ...o.data, ref: o.ref, total: +o.total }).catch((e) => console.error(e));
  return { ok: true, ref: o.ref, paid: true };
}

export async function markPaidSimulated(ref) {
  const up = await q("update orders set paid=true, paid_at=now(), status='nuevo' where ref=$1 and not paid returning data,total", [ref]);
  if (up.rowCount) await mailOrderPaid({ ...up.rows[0].data, ref, total: +up.rows[0].total }).catch(() => {});
}

// Líneas de la hoja de pedido y la factura (precios con IVA incluido).
export function orderLines(o) {
  const out = (o.items || []).map((i) => ({ d: `${i.name} · ${i.sizes || ""}`, sub: (i.parts || []).join(" · "), qty: i.qty, total: +i.total }));
  if (o.shipping) out.push({ d: "Envío", sub: "", qty: 1, total: +o.shipping });
  (o.refunds || []).forEach((r) => out.push({ d: `Devolución: ${r.label}`, sub: "", qty: 1, total: -Math.abs(+r.amount) }));
  return out;
}
