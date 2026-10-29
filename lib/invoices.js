// Facturas: numeración, facturas de uno o varios albaranes (pedidos) y facturas rectificativas.
import crypto from "node:crypto";
import { db, q } from "./db.js";
import { orderLines } from "./orders.js";

export const r2 = (n) => Math.round(n * 100) / 100;
const str = (v, n = 200) => String(v ?? "").trim().slice(0, n);

// Factura vigente de un pedido (una anulada deja el pedido libre para volver a facturarlo).
export const INVOICE_OF_ORDER = `(select number from invoices i where o.ref = any(i.refs) and i.kind='F' and i.status<>'anulada' order by i.created_at desc limit 1)`;
export async function invoiceOf(ref) {
  return (await q("select number from invoices where $1 = any(refs) and kind='F' and status<>'anulada' order by created_at desc limit 1", [ref])).rows[0]?.number || null;
}

// Enlace para que el cliente vea la factura sin iniciar sesión (para enviarla por email).
export function invoiceToken(number) {
  return crypto.createHmac("sha256", process.env.SESSION_SECRET || "dev").update("inv:" + number).digest("base64url").slice(0, 22);
}

export function cleanBilling(b = {}) {
  const billing = { name: str(b.name, 160), cif: str(b.cif, 30).toUpperCase(), addr: str(b.addr, 200), zip: str(b.zip, 10), city: str(b.city, 80), province: str(b.province, 80) };
  if (!billing.name || !billing.cif || !billing.addr || !billing.zip || !billing.city) throw new InvoiceError("Para la factura faltan la razón social, el NIF/CIF o la dirección.");
  return billing;
}

const payable = (o) => o.paid || !["card", "bizum"].includes(o.pay);

async function nextNumber(cx, kind, year) {
  const seq = (await cx.query("select coalesce(max(seq),0)+1 n from invoices where year=$1 and kind=$2", [year, kind])).rows[0].n;
  return { seq, number: `${kind === "R" ? "R" : "W"}${String(year).slice(2)}-${String(seq).padStart(4, "0")}` };
}

async function withLock(fn) {
  const p = await db();
  const cx = await p.connect();
  try {
    await cx.query("begin");
    await cx.query("select pg_advisory_xact_lock(4242)");
    const out = await fn(cx);
    await cx.query("commit");
    return out;
  } catch (e) { await cx.query("rollback").catch(() => {}); throw e; } finally { cx.release(); }
}

// Factura de uno o varios pedidos (albaranes) del mismo cliente.
export async function createInvoice({ refs, billing, client = null, onlyClient = null }) {
  refs = [...new Set((refs || []).map((r) => str(r, 40)).filter(Boolean))].slice(0, 200);
  if (!refs.length) throw new InvoiceError("Elige al menos un albarán.");
  billing = cleanBilling(billing);
  return withLock(async (cx) => {
    const rows = (await cx.query("select ref,client,paid,pay,total,data,state,created_at from orders where ref = any($1) order by created_at", [refs])).rows;
    if (rows.length !== refs.length) throw new InvoiceError("Algún albarán ya no existe.");
    for (const o of rows) {
      if (onlyClient && o.client !== onlyClient) throw new InvoiceError("No encuentro ese pedido en tu área.");
      if (!payable(o)) throw new InvoiceError(`El pedido ${o.ref} aún no está pagado.`);
      if ((o.state?.status || o.data?.status) === "cancelado") throw new InvoiceError(`El pedido ${o.ref} está cancelado.`);
    }
    const owners = [...new Set(rows.map((o) => o.client || ""))];
    if (owners.length > 1) throw new InvoiceError("Solo se pueden facturar juntos albaranes del mismo cliente.");
    const taken = (await cx.query("select number, refs from invoices where refs && $1 and kind='F' and status<>'anulada'", [refs])).rows;
    if (taken.length) {
      if (refs.length === 1) return { number: taken[0].number, existed: true };
      throw new InvoiceError(`Alguno ya está facturado (${taken.map((t) => t.number).join(", ")}).`);
    }
    const year = new Date().getFullYear();
    const { seq, number } = await nextNumber(cx, "F", year);
    const multi = rows.length > 1;
    const lines = rows.flatMap((o) => orderLines({ ...o.data, ...(o.state || {}) }).map((l) => (multi ? { ...l, d: `Alb. ${o.ref} · ${l.d}` } : l)));
    const pay = rows[0].pay;
    await cx.query("insert into invoices(number,ref,year,seq,kind,refs,client,data) values($1,$2,$3,$4,'F',$5,$6,$7)",
      [number, multi ? "F:" + number : rows[0].ref, year, seq, rows.map((o) => o.ref), owners[0] || client || null,
        JSON.stringify({ billing, date: new Date().toISOString(), lines, pay, paid: rows.every((o) => o.paid) })]);
    return { number };
  });
}

// Factura rectificativa: anula la factura entera o rectifica un importe (IVA incluido).
export async function rectify({ number, mode, amount, reason }) {
  reason = str(reason, 300);
  if (!reason) throw new InvoiceError("Escribe el motivo de la rectificación.");
  return withLock(async (cx) => {
    const inv = (await cx.query("select * from invoices where number=$1 for update", [str(number, 20)])).rows[0];
    if (!inv || inv.kind !== "F") throw new InvoiceError("No encuentro esa factura.");
    if (inv.status === "anulada") throw new InvoiceError("Esa factura ya está anulada.");
    const orig = inv.data.lines || [];
    const origTotal = r2(orig.reduce((a, l) => a + l.total, 0));
    const done = (await cx.query("select data from invoices where rect_of=$1", [inv.number])).rows
      .reduce((a, r) => a + (r.data.lines || []).reduce((x, l) => x + l.total, 0), 0);
    const left = r2(origTotal + done); // lo que queda por rectificar (las rectificativas son negativas)
    let lines;
    if (mode === "total") {
      if (done) lines = [{ d: `Anulación del resto de la factura ${inv.number}`, sub: "", qty: 1, total: -left }];
      else lines = orig.map((l) => ({ ...l, total: -l.total }));
    } else {
      const a = r2(Math.abs(+amount || 0));
      if (!a) throw new InvoiceError("Pon el importe a rectificar.");
      if (a > left + 0.001) throw new InvoiceError(`No puedes rectificar más de ${left.toFixed(2).replace(".", ",")} € en esta factura.`);
      lines = [{ d: reason, sub: `Rectifica la factura ${inv.number}`, qty: 1, total: -a }];
    }
    const year = new Date().getFullYear();
    const { seq, number: rn } = await nextNumber(cx, "R", year);
    const full = mode === "total" || Math.abs(left + lines.reduce((a, l) => a + l.total, 0)) < 0.005;
    await cx.query("insert into invoices(number,ref,year,seq,kind,refs,client,rect_of,data) values($1,$2,$3,$4,'R',$5,$6,$7,$8)",
      [rn, "R:" + rn, year, seq, inv.refs, inv.client, inv.number,
        JSON.stringify({ billing: inv.data.billing, date: new Date().toISOString(), lines, reason, mode: full ? "total" : "parcial", rectOfDate: inv.data.date || inv.created_at, pay: inv.data.pay })]);
    await cx.query("update invoices set status=$2 where number=$1", [inv.number, full ? "anulada" : "rectificada"]);
    return { number: rn, status: full ? "anulada" : "rectificada" };
  });
}

// Para Gestión: todas las facturas, ya con totales.
export async function listInvoices() {
  const r = await q("select number,kind,refs,status,rect_of,client,data,created_at,sent_at from invoices order by created_at desc limit 5000");
  return r.rows.map(invoiceForShop);
}
export function invoiceForShop(x) {
  const total = r2((x.data.lines || []).reduce((a, l) => a + l.total, 0)), base = r2(total / 1.21);
  return { number: x.number, kind: x.kind, refs: x.refs || [], status: x.status, rectOf: x.rect_of, client: x.client, billing: x.data.billing || {}, date: x.data.date || x.created_at,
    reason: x.data.reason || "", total, base, iva: r2(total - base), sentAt: x.sent_at, token: invoiceToken(x.number) };
}

export class InvoiceError extends Error {}
