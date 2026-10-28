// Utilidades para pedidos y presupuestos creados desde Gestión.
import crypto from "node:crypto";
import { q } from "./db.js";
import { hashPassword } from "./auth.js";

export const str = (v, n = 300) => String(v ?? "").trim().slice(0, n);
export const r2 = (n) => Math.round(n * 100) / 100;
export const MANUAL_PAY = ["pendiente", "transfer", "efectivo", "tpv", "bizum_tienda"];

// Líneas libres (concepto, unidades, precio por unidad con IVA): las pone la tienda.
export function freeLines(list) {
  return (Array.isArray(list) ? list : []).slice(0, 60).map((l, i) => {
    const qty = Math.max(0, Math.floor(+l.qty || 0)), unit = r2(Math.max(0, +l.unit || 0));
    return { id: "F" + Date.now() + i, free: true, name: str(l.desc, 160), qty, unit, total: r2(qty * unit), sizes: str(l.sizes, 160), parts: l.note ? [str(l.note, 300)] : [] };
  }).filter((l) => l.name && l.qty > 0);
}

export async function nextOrderRef() {
  const yy = String(new Date().getFullYear()).slice(2);
  const seq = (await q("select nextval('order_seq')::int n")).rows[0].n;
  return { ref: `EP-${yy}-${seq}`, seq, yy };
}

export function newPassword() {
  const w = ["sol", "mar", "pista", "meta", "gol", "salto", "ruta", "faro", "vela", "trail"];
  return w[crypto.randomInt(w.length)] + "-" + w[crypto.randomInt(w.length)] + "-" + crypto.randomInt(100, 999);
}

// Crea un cliente con su área y un usuario. Devuelve {key, pass}.
export async function createClient(kv, { company, name, email, tel, type }) {
  const em = str(email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error("Revisa el email del cliente nuevo.");
  const exists = (await q("select client_key from users where email=$1", [em])).rows[0];
  if (exists) throw new Error(`Ese email ya tiene área de cliente (${exists.client_key}). Elige el cliente en la lista.`);
  const all = kv.ep_clients || {};
  const base = (str(company || name, 80).normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)) || "CLIENTE";
  let key; do { key = base + crypto.randomInt(10, 99); } while (all[key]);
  const pass = newPassword();
  all[key] = { name: str(company || name, 160), type: str(type, 60) || "Cliente", crest: "", contact: str(tel, 40),
    users: [{ email: em, name: str(name, 120) || str(company, 120), role: "Responsable", hasPass: true }], products: [] };
  await q("insert into kv(key,value) values('ep_clients',$1) on conflict(key) do update set value=$1, updated_at=now()", [JSON.stringify(all)]);
  await q("insert into users(email,client_key,name,pass_hash) values($1,$2,$3,$4)", [em, key, str(name, 120) || null, hashPassword(pass)]);
  kv.ep_clients = all;
  return { key, pass };
}
