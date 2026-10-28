// Datos de la tienda compartidos con la web (se leen del propio HTML para que haya una sola fuente)
// y cálculo del precio en el servidor: lo que se cobra nunca depende de lo que diga el navegador.
import fs from "node:fs";
import path from "node:path";
import { q } from "./db.js";

const HTML_PATH = path.join(process.cwd(), "shop", "tienda.html");
let cache;

export function shopHtml() {
  if (!cache || process.env.NODE_ENV !== "production") cache = fs.readFileSync(HTML_PATH, "utf8");
  return cache;
}

// Extrae "const NOMBRE=<literal>;" del script de la web, contando corchetes.
function literal(src, name) {
  const start = src.indexOf(`const ${name}=`);
  if (start < 0) throw new Error(`No encuentro ${name} en tienda.html`);
  let i = src.indexOf("=", start) + 1, depth = 0, str = null;
  const from = i;
  for (; i < src.length; i++) {
    const c = src[i];
    if (str) { if (c === "\\") i++; else if (c === str) str = null; continue; }
    if (c === '"' || c === "'" || c === "`") { str = c; continue; }
    if (c === "[" || c === "{" || c === "(") depth++;
    else if (c === "]" || c === "}" || c === ")") depth--;
    else if (c === ";" && depth === 0) break;
  }
  return src.slice(from, i);
}

let base;
export function baseData() {
  if (base) return base;
  const src = shopHtml();
  const BASIC = new Function(`return ${literal(src, "BASIC")}`)();
  const PRODUCTS = new Function("BASIC", `return ${literal(src, "PRODUCTS")}`)(BASIC);
  const VINYL = new Function(`return ${literal(src, "VINYL")}`)();
  const SIZE_GROUPS_DEFAULT = new Function(`return ${literal(src, "SIZE_GROUPS_DEFAULT")}`)();
  const RATES_DEFAULT = new Function(`return ${literal(src, "RATES_DEFAULT")}`)();
  base = { PRODUCTS, VINYL, SIZE_GROUPS_DEFAULT, RATES_DEFAULT };
  return base;
}

// Claves de configuración que edita la tienda desde Gestión.
export const PUBLIC_KEYS = ["ep_colors", "ep_sizes", "ep_cats", "ep_catmeta", "ep_rates", "ep_catalog", "ep_shapes"];
export const PRIVATE_KEYS = ["ep_clients", "ep_admin"];
export const ALL_KEYS = [...PUBLIC_KEYS, ...PRIVATE_KEYS];

export async function loadKv(keys = ALL_KEYS) {
  const r = await q("select key, value from kv where key = any($1)", [keys]);
  return Object.fromEntries(r.rows.map((x) => [x.key, x.value]));
}

// Quita contraseñas antes de mandar datos de clientes al navegador.
export function stripUsers(obj) {
  const clone = JSON.parse(JSON.stringify(obj || {}));
  const walk = (users) => (users || []).forEach((u) => { if (u.pass) { u.hasPass = true; } delete u.pass; });
  if (clone.users && typeof clone.users === "object" && !Array.isArray(clone.users)) Object.values(clone.users).forEach(walk);
  Object.values(clone).forEach((c) => { if (c && Array.isArray(c.users)) walk(c.users); });
  return clone;
}

// Solo los datos del cliente que ha iniciado sesión.
export function clientSlice(kv, key) {
  const ex = kv.ep_clients || {}, adm = kv.ep_admin || {};
  return {
    ep_clients: ex[key] ? stripUsers({ [key]: ex[key] }) : {},
    ep_admin: stripUsers({
      users: adm.users && adm.users[key] ? { [key]: adm.users[key] } : {},
      prices: adm.prices || {},
      removed: adm.removed || [],
    }),
  };
}

/* ======== Precio ======== */
const r2 = (n) => Math.round(n * 100) / 100;

function pricing(kv) {
  const { PRODUCTS, VINYL, SIZE_GROUPS_DEFAULT, RATES_DEFAULT } = baseData();
  const R = { ...JSON.parse(JSON.stringify(RATES_DEFAULT)), ...(kv.ep_rates || {}) };
  if (R.tiers && !R.tierRows) R.tierRows = [1, 5, 10, 25, 50, 100].map((m, i) => [m, R.tiers[i] || 0]).filter((r, i) => i === 0 || r[1] > 0);
  const rows = (R.tierRows || [[1, 0]]).map(([m, p]) => [Math.max(1, Math.round(+m || 1)), Math.max(0, +p || 0)]).sort((a, b) => a[0] - b[0]);
  if (!rows.length || rows[0][0] !== 1) rows.unshift([1, 0]);
  const TIERS = rows.map(([m, p]) => [m, p / 100]);
  const tierFor = (n) => { let d = 0; TIERS.forEach(([min, pct]) => { if (n >= min) d = pct; }); return d; };
  const sizeGroups = Array.isArray(kv.ep_sizes) && kv.ep_sizes.length ? kv.ep_sizes : SIZE_GROUPS_DEFAULT;
  const isPlus = (s) => sizeGroups.some((g) => (g.plus || []).includes(s));
  const plusQty = (qs) => Object.entries(qs).reduce((a, [s, n]) => a + (isPlus(s) ? +n || 0 : 0), 0);
  const refl = (code) => (VINYL.find((v) => v[0] === code) || VINYL[0])[3] === "refl";
  const dtf = (w) => (w <= 10 ? R.dtf[0] : w <= 20 ? R.dtf[1] : R.dtf[2]);
  const vinylLogo = (w) => (w <= 10 ? R.vinylLogo[0] : w <= 20 ? R.vinylLogo[1] : R.vinylLogo[2]);
  const text = (w) => (w <= 10 ? R.text[0] : w <= 20 ? R.text[1] : w <= 30 ? R.text[2] : R.text[3]);
  const elPrice = (el) => {
    if (el.kind === "logo" && el.tech === "seri") return R.serPrint ?? 0.45;
    if (el.kind === "logo") return el.tech === "vinilo" ? vinylLogo(+el.w) + (refl(el.recolor || "V-01") ? R.reflect : 0) : dtf(+el.w);
    return text(+el.wcm || 0) + (refl(el.vinyl) ? R.reflect : 0);
  };
  // catálogo con los cambios hechos desde Gestión
  const X = kv.ep_catalog || {};
  const products = new Map(PRODUCTS.map((p) => [p.id, { ...p }]));
  (X.__new || []).forEach((p) => { if (!products.has(p.id)) products.set(p.id, { ...p }); });
  for (const [id, o] of Object.entries(X)) if (!id.startsWith("__") && products.has(id)) Object.assign(products.get(id), o, { off: !!o.off });
  (X.__deleted || []).forEach((id) => products.delete(id));
  const prodDays = (n) => (n >= (R.bigQty || 50) ? R.bigDays || 5 : R.prodDays || 3);
  return { R, tierFor, plusQty, elPrice, products, prodDays };
}

function clientProduct(kv, clientKey, cpId) {
  const ex = kv.ep_clients || {}, adm = kv.ep_admin || {};
  const c = ex[clientKey];
  if (!c) return null;
  const cp = (c.products || []).find((p) => p.id === cpId);
  if (!cp || (adm.removed || []).includes(cp.id)) return null;
  const price = adm.prices && adm.prices[cp.id] != null ? +adm.prices[cp.id] : +cp.price;
  return { ...cp, price };
}

const cleanQty = (obj) => {
  const out = {};
  for (const [s, n] of Object.entries(obj || {})) {
    const v = Math.floor(+n || 0);
    if (v > 0 && v <= 9999 && String(s).length <= 12) out[String(s)] = v;
  }
  return out;
};

// Devuelve el precio del servidor para cada línea del carrito.
export function priceCart(kv, items, { clientKey, ship }) {
  const P = pricing(kv);
  const lines = [];
  for (const it of items) {
    if (!it || typeof it !== "object") throw new PriceError("Hay una línea del carrito que no se puede leer.");
    let qty, total, days;
    if (it.cpId) {
      if (!clientKey || it.client !== clientKey) throw new PriceError("Para pedir los productos de tu área tienes que iniciar sesión.");
      const cp = clientProduct(kv, clientKey, it.cpId);
      if (!cp) throw new PriceError(`«${it.name}» ya no está disponible en tu área. Quítalo del carrito.`);
      const qs = cleanQty(it.q);
      qty = Object.values(qs).reduce((a, b) => a + b, 0);
      total = qty * cp.price + P.plusQty(qs) * P.R.big;
    } else {
      const p = P.products.get(it.pid);
      if (!p || p.off) throw new PriceError(`«${it.name}» ya no está a la venta. Quítalo del carrito.`);
      const d = it.design || {};
      const team = d.team && d.team.on ? d.team : null;
      let qs;
      if (team) {
        qs = {};
        (it.roster || []).forEach((r) => { if (r && r.size) qs[r.size] = (qs[r.size] || 0) + 1; });
      } else qs = cleanQty(it.q);
      qty = Object.values(qs).reduce((a, b) => a + b, 0);
      const garment = p.price * qty + P.R.big * P.plusQty(qs);
      const decoUnit = (d.els || []).reduce((a, el) => a + P.elPrice(el), 0);
      let teamCost = 0;
      if (team) {
        const rf = (() => { const { VINYL } = baseData(); return (VINYL.find((v) => v[0] === team.vinyl) || VINYL[0])[3] === "refl"; })();
        (it.roster || []).forEach((r) => {
          let k = 0;
          if (team.name && r.name) { teamCost += P.R.name; k++; }
          if (team.numB && r.num) { teamCost += P.R.numBack; k++; }
          if (team.numF && r.num) { teamCost += P.R.numFront; k++; }
          if (rf) teamCost += P.R.reflect * k;
        });
      }
      const sub = garment + decoUnit * qty + teamCost;
      // serigrafía: mínimo de unidades y clichés (una vez por logo, IVA incluido)
      const seri = (d.els || []).filter((e) => e.kind === "logo" && e.tech === "seri").length;
      if (seri && qty < (P.R.serMin ?? 100)) throw new PriceError(`«${it.name}»: la serigrafía es a partir de ${P.R.serMin ?? 100} unidades.`);
      total = sub - sub * P.tierFor(qty) + seri * (P.R.serCliche ?? 38) * 1.21;
    }
    if (!qty) throw new PriceError(`«${it.name}» no tiene unidades.`);
    days = P.prodDays(qty);
    lines.push({ id: it.id, qty, total: r2(total), days, clientTotal: r2(+it.total || 0) });
  }
  const subtotal = r2(lines.reduce((a, l) => a + l.total, 0));
  const shipping = ship === "envio" ? (subtotal >= P.R.freeShip ? 0 : P.R.shipping) : 0;
  return { lines, subtotal, shipping: r2(shipping), total: r2(subtotal + shipping), changed: lines.some((l) => Math.abs(l.total - l.clientTotal) > 0.009) };
}

export class PriceError extends Error {}
