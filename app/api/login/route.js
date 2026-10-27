// Acceso de clientes (clubs y empresas) con email y contraseña.
import { q } from "@/lib/db";
import { checkPassword, setSession, tooManyAttempts, recordFailure, clientIp } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";
import { loadKv } from "@/lib/shop";

export async function POST(req) {
  const { email, password } = await body(req).catch(() => ({}));
  const em = String(email || "").trim().toLowerCase();
  const ip = clientIp(req);
  if (!em || !password) return fail("Escribe tu email y tu contraseña.");
  if (await tooManyAttempts(ip, em)) return fail("Demasiados intentos. Espera 15 minutos y vuelve a probar.", 429);
  const r = await q("select email,client_key,name,pass_hash from users where email=$1", [em]);
  const u = r.rows[0];
  if (!u || !checkPassword(password, u.pass_hash)) {
    await recordFailure(ip, em);
    return fail("El email o la contraseña no coinciden.", 401);
  }
  const kv = await loadKv(["ep_clients"]);
  if (!(kv.ep_clients || {})[u.client_key]) return fail("Tu área ya no está activa. Escríbenos a info@evasionprint.com.", 403);
  await setSession({ role: "client", email: u.email, client: u.client_key, name: u.name || u.email });
  return json({ ok: true, key: u.client_key });
}
