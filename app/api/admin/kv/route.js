// Gestión guarda aquí la configuración de la tienda (catálogo, colores, tarifas, clientes…).
import { q } from "@/lib/db";
import { requireAdmin, hashPassword } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";
import { ALL_KEYS, loadKv } from "@/lib/shop";

function usersOf(clients, adm) {
  const out = [];
  Object.entries(clients || {}).forEach(([key, c]) => (c.users || []).forEach((u) => out.push({ key, u })));
  Object.entries((adm && adm.users) || {}).forEach(([key, list]) => (list || []).forEach((u) => out.push({ key, u })));
  return out;
}

export async function POST(req) {
  if (!(await requireAdmin())) return fail("Inicia sesión en Gestión.", 401);
  let data;
  try { data = await body(req, 4_400_000); } catch (e) { return fail(e.message === "too_big" ? "Demasiados datos de golpe. Usa imágenes más ligeras." : "Datos no válidos."); }
  const { key, value } = data;
  if (!ALL_KEYS.includes(key)) return fail("Clave no permitida.");
  if (value === null || value === undefined) {
    await q("delete from kv where key=$1", [key]);
    return json({ ok: true });
  }
  let v = value;
  if (key === "ep_clients" || key === "ep_admin") {
    // Las contraseñas nunca se guardan tal cual: pasan a la tabla de usuarios cifradas.
    const kv = await loadKv(["ep_clients", "ep_admin"]);
    const clients = key === "ep_clients" ? v : kv.ep_clients;
    const adm = key === "ep_admin" ? v : kv.ep_admin;
    const all = usersOf(clients, adm);
    for (const { key: ck, u } of all) {
      if (!u || !u.email) continue;
      const em = String(u.email).trim().toLowerCase();
      if (u.pass) {
        if (String(u.pass).length < 8) return fail(`La contraseña de ${em} necesita al menos 8 caracteres.`);
        await q(
          `insert into users(email,client_key,name,pass_hash) values($1,$2,$3,$4)
           on conflict(email) do update set client_key=$2,name=$3,pass_hash=$4,updated_at=now()`,
          [em, ck, u.name || null, hashPassword(String(u.pass))]
        );
        delete u.pass;
        u.hasPass = true;
      } else {
        await q("update users set client_key=$2,name=$3 where email=$1", [em, ck, u.name || null]);
      }
    }
    const keep = all.map(({ u }) => String(u.email || "").trim().toLowerCase()).filter(Boolean);
    await q("delete from users where not (email = any($1))", [keep]);
  }
  await q(
    "insert into kv(key,value) values($1,$2) on conflict(key) do update set value=$2, updated_at=now()",
    [key, JSON.stringify(v)]
  );
  return json({ ok: true });
}
