// La tienda: sirve la web con los datos de la base de datos ya incluidos.
import { getSession } from "@/lib/auth";
import { q } from "@/lib/db";
import { shopHtml, loadKv, PUBLIC_KEYS, stripUsers, clientSlice } from "@/lib/shop";
import { redsysConfig } from "@/lib/redsys";
import { blobEnabled } from "@/lib/files";

export const dynamic = "force-dynamic";

function orderForShop(r) {
  return { ...r.data, ref: r.ref, total: +r.total, status: r.data.status || "nuevo", paid: r.paid, pay: r.pay, date: r.created_at.toISOString() };
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
    const o = await q("select ref,status,paid,total,pay,data,state,created_at from orders where paid order by created_at desc limit 2000");
    boot.orders = o.rows.map(orderForShop);
    o.rows.forEach((r) => { if (r.state && Object.keys(r.state).length) boot.ostate[r.ref] = r.state; });
    const qs = await q("select data from quotes order by created_at desc limit 1000");
    boot.quotes = qs.rows.map((r) => r.data);
  } else if (role === "client") {
    Object.assign(boot.kv, clientSlice(kv, session.client));
    boot.session = { key: session.client, email: session.email, name: session.name };
    const fl = await q("select key,url from files where scope='client' and key like $1", [`cl_${session.client}_%`]);
    fl.rows.forEach((f) => { boot.files[f.key] = f.url; });
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
