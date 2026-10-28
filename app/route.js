// La tienda: sirve la web con los datos de la base de datos ya incluidos.
import { getSession } from "@/lib/auth";
import { q } from "@/lib/db";
import { shopHtml, loadKv, PUBLIC_KEYS, stripUsers, clientSlice } from "@/lib/shop";
import { redsysConfig } from "@/lib/redsys";
import { blobEnabled } from "@/lib/files";

export const dynamic = "force-dynamic";

function orderForShop(r) {
  return { ...r.data, ref: r.ref, total: +r.total, status: r.data.status || "nuevo", paid: r.paid, pay: r.pay, date: r.created_at.toISOString(), invoice: r.invoice || null };
}

export async function GET() {
  const session = await getSession().catch(() => null);
  const role = session?.role || null;
  const kv = await loadKv();
  const boot = { role, demo: false, kv: {}, files: {}, orders: [], ostate: {}, quotes: [], session: null };
  PUBLIC_KEYS.forEach((k) => { if (k in kv) boot.kv[k] = kv[k]; });

  const files = await q(role === "admin" ? "select key,url from files" : "select key,url from files where scope='public'");
  files.rows.forEach((f) => { boot.files[f.key] = f.url; });

  if (role === "admin") {
    boot.adminEmail = session.email;
    if (kv.ep_clients) boot.kv.ep_clients = stripUsers(kv.ep_clients);
    if (kv.ep_admin) boot.kv.ep_admin = stripUsers(kv.ep_admin);
    const o = await q("select o.ref,o.status,o.paid,o.total,o.pay,o.data,o.state,o.created_at,i.number invoice from orders o left join invoices i on i.ref=o.ref where o.paid or o.pay not in ('card','bizum') order by o.created_at desc limit 2000");
    boot.orders = o.rows.map(orderForShop);
    o.rows.forEach((r) => { if (r.state && Object.keys(r.state).length) boot.ostate[r.ref] = r.state; });
    const qs = await q("select data from quotes order by created_at desc limit 1000");
    boot.quotes = qs.rows.map((r) => r.data);
  } else if (role === "client") {
    Object.assign(boot.kv, clientSlice(kv, session.client));
    boot.session = { key: session.client, email: session.email, name: session.name };
    (await q("select key,url from files where key like $1", [`cl_${session.client}_%`])).rows.forEach((f) => { boot.files[f.key] = f.url; });
    const o = await q(
      `select o.ref,o.status,o.paid,o.total,o.pay,o.data,o.state,o.created_at,i.number invoice
       from orders o left join invoices i on i.ref=o.ref where o.client=$1 and (o.paid or o.pay not in ('card','bizum')) and coalesce(o.state->>'status',o.status)<>'cancelado' order by o.created_at desc limit 500`,
      [session.client]);
    // los costes son solo para Gestión
    const noCost = (items) => (items || []).map(({ cost, ...i }) => i);
    boot.myOrders = o.rows.map((r) => { const x = { ...orderForShop(r), ...(r.state || {}), invoice: r.invoice || null }; x.items = noCost(x.items); return x; });
    const mq = await q("select data from quotes where data->>'client'=$1 and data->>'status' in ('enviado','aceptado') and data ? 'answer' order by created_at desc limit 200", [session.client]);
    boot.myQuotes = mq.rows.map((r) => { const { lineCosts, ...x } = r.data; return x; }).filter((x) => x.answer && x.answer.total);
    const keys = new Set();
    const addKeys = (it) => ((it && it.design && it.design.els) || []).forEach((e) => [e.file, e.mask, e.orig].forEach((k) => k && keys.add(k)));
    boot.myQuotes.forEach((x) => (x.lines || []).forEach((l) => addKeys(l.item)));
    boot.myOrders.forEach((x) => (x.items || []).forEach(addKeys));
    if (keys.size) (await q("select key,url from files where key = any($1)", [[...keys]])).rows.forEach((f) => { boot.files[f.key] = f.url; });
  }
  boot.blob = blobEnabled();
  const cfg = redsysConfig();
  boot.pay = { redsys: !!cfg, bizum: !cfg || cfg.bizum, env: cfg ? cfg.env : "simulado" };

  const html = shopHtml().replace(
    "<script>",
    `<script>window.__BOOT=${JSON.stringify(boot).replace(/</g, "\\u003c")};</script>\n<script>`
  );
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
