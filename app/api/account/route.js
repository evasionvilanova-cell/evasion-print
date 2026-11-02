// Área de cliente: cambiar contraseña, logo y datos de facturación; generar facturas.
import { q, db } from "@/lib/db";
import { getSession, checkPassword, hashPassword, tooManyAttempts, recordFailure, clientIp } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";
import { blobEnabled } from "@/lib/files";
import { loadKv, webUnitPrice, productOf, PriceError } from "@/lib/shop";
import { createInvoice, cleanBilling, InvoiceError } from "@/lib/invoices";

const str = (v, n = 200) => String(v ?? "").trim().slice(0, n);

async function saveClient(key, fn) {
  const kv = await loadKv(["ep_clients"]);
  const all = kv.ep_clients || {};
  if (!all[key]) throw new Error("Tu área ya no está activa.");
  fn(all[key]);
  await q("insert into kv(key,value) values('ep_clients',$1) on conflict(key) do update set value=$1, updated_at=now()", [JSON.stringify(all)]);
  return all[key];
}

export async function POST(req) {
  const s = await getSession().catch(() => null);
  const admin = s && s.role === "admin";
  if (!s || (s.role !== "client" && !admin)) return fail("Inicia sesión en tu área de cliente.", 401);
  let d;
  try { d = await body(req, 900_000); } catch { return fail("La imagen es demasiado grande."); }
  if (admin && d.action !== "invoice") return fail("Solo para clientes.", 403);

  if (d.action === "password") {
    const ip = clientIp(req);
    if (await tooManyAttempts(ip, s.email)) return fail("Demasiados intentos. Espera 15 minutos.", 429);
    const u = (await q("select pass_hash from users where email=$1", [s.email])).rows[0];
    if (!u || !checkPassword(d.current || "", u.pass_hash)) { await recordFailure(ip, s.email); return fail("La contraseña actual no es correcta.", 401); }
    const nw = String(d.next || "");
    if (nw.length < 8) return fail("La contraseña nueva necesita al menos 8 caracteres.");
    await q("update users set pass_hash=$2, updated_at=now() where email=$1", [s.email, hashPassword(nw)]);
    return json({ ok: true });
  }

  if (d.action === "profile") {
    const crest = d.crest === null ? "" : typeof d.crest === "string" ? d.crest : undefined;
    if (crest && (!/^data:image\/(png|jpeg|webp|svg\+xml);/.test(crest) || crest.length > 800_000)) return fail("Sube una imagen PNG, JPG, WEBP o SVG más ligera.");
    const b = d.billing || {};
    const billing = { name: str(b.name, 160), cif: str(b.cif, 30).toUpperCase(), addr: str(b.addr, 200), zip: str(b.zip, 10), city: str(b.city, 80), province: str(b.province, 80) };
    const c = await saveClient(s.client, (c) => {
      if (crest !== undefined) c.crest = crest;
      if (d.billing) c.billing = billing;
    });
    return json({ ok: true, crest: c.crest, billing: c.billing });
  }

  if (d.action === "logo-add" || d.action === "logo-del") {
    let c;
    try { c = await saveClient(s.client, (c) => {
      const list = Array.isArray(c.logos) ? c.logos : [];
      if (d.action === "logo-del") { c.logos = list.filter((l) => l.id !== str(d.id, 40)); return; }
      const l = d.logo || {};
      const pre = `cl_${s.client}_`;
      if (list.some((x) => x.name === str(l.name, 120) && +x.px === (+l.px || 0) && +x.ar === (+l.ar || 1))) return; // ya lo tiene
      if (!String(l.file || "").startsWith(pre) || (l.mask && !String(l.mask).startsWith(pre))) throw new Error("Logo no válido.");
      c.logos = [{ id: str(l.id, 40), name: str(l.name, 120), file: l.file, mask: l.mask || null, ar: +l.ar || 1, px: +l.px || 0, vector: !!l.vector, lum: l.lum == null ? null : +l.lum, whiteBg: !!l.whiteBg }, ...list].slice(0, 40);
    }); } catch (e) { return fail(e.message); }
    return json({ ok: true, logos: c.logos });
  }

  if (d.action === "save-product") {
    // El cliente se guarda un diseño en «Mis prendas». El precio lo pone la web; solo Gestión lo cambia.
    if (admin) return fail("Desde Gestión usa «Guardar este diseño en el área de un cliente».");
    const kv = await loadKv();
    const p = productOf(kv, str(d.pid, 60));
    if (!p || p.off) return fail("Esa prenda ya no está a la venta.");
    const color = str(d.color, 20);
    if (!(p.colors || []).includes(color)) return fail("Ese color no está disponible.");
    const pre = `cl_${s.client}_`;
    const num = (v, lo, hi) => Math.min(hi, Math.max(lo, +v || 0));
    // con Blob activado los logos van como enlace; sin Blob (pruebas) se aceptan incrustados
    const okSrc = (u) => typeof u === "string" && ((u.length < 600 && /^https:\/\//.test(u)) || (!blobEnabled() && /^data:image\//.test(u) && u.length < 800_000));
    const els = [];
    for (const e of (Array.isArray(d.els) ? d.els : []).slice(0, 12)) {
      const base = { side: e.side === "back" ? "back" : "front", x: num(e.x, 0, 100), y: num(e.y, 0, 100), place: str(e.place, 20) };
      if (e.kind === "logo") {
        if (!okSrc(e.src) || (e.maskSrc && !okSrc(e.maskSrc)) || !String(e.file || "").startsWith(pre) || (e.mask && !String(e.mask).startsWith(pre))) return fail("Algún logo no se ha subido bien. Vuelve a intentarlo.");
        els.push({ ...base, kind: "logo", w: num(e.w, 2, 60), src: e.src, maskSrc: e.maskSrc || null, file: e.file, mask: e.mask || null, name: str(e.name, 120),
          tech: ["dtf", "vinilo", "seri"].includes(e.tech) ? e.tech : "dtf", recolor: e.recolor ? str(e.recolor, 10) : null, ink: e.ink ? str(e.ink, 20) : null,
          vector: !!e.vector, px: num(e.px, 0, 20000), ar: num(e.ar, 0.05, 20) || 1, lum: e.lum == null ? null : num(e.lum, 0, 255), whiteBg: !!e.whiteBg, knock: !!e.knock });
      } else if (e.kind === "text" && str(e.text, 60)) {
        els.push({ ...base, kind: "text", text: str(e.text, 60), font: str(e.font, 20), vinyl: str(e.vinyl, 10), h: num(e.h, 1, 40), wcm: num(e.wcm, 0, 80) });
      }
    }
    let price;
    try { price = webUnitPrice(kv, p.id, els); } catch (e) { if (e instanceof PriceError) return fail(e.message); throw e; }
    const cp = { id: "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), label: str(d.label, 80) || p.name, pid: p.id, color, price, els, last: {}, byClient: true, created: new Date().toISOString() };
    let out;
    try { out = await saveClient(s.client, (c) => { c.products = c.products || []; if (c.products.length >= 80) throw new Error("Tienes demasiadas prendas guardadas. Pídenos que quitemos alguna."); c.products.push(cp); }); }
    catch (e) { return fail(e.message); }
    return json({ ok: true, product: cp, count: out.products.length });
  }

  if (d.action === "invoice") {
    // Genera la factura de un pedido (una sola vez; después siempre se descarga la misma)
    const o = (await q("select ref,client,paid,pay,total,data,state from orders where ref=$1", [str(d.ref, 40)])).rows[0];
    if (!o || (!admin && o.client !== s.client) || !(o.paid || !["card", "bizum"].includes(o.pay))) return fail("No encuentro ese pedido en tu área.", 404);
    try {
      const r = await createInvoice({ refs: [o.ref], billing: d.billing, onlyClient: admin ? null : s.client });
      if (!admin && !r.existed) await saveClient(s.client, (c) => { c.billing = c.billing && c.billing.cif ? c.billing : cleanBilling(d.billing); }).catch(() => {});
      return json({ ok: true, number: r.number });
    } catch (e) { if (e instanceof InvoiceError) return fail(e.message); throw e; }
  }
  return fail("Acción no válida.");
}
