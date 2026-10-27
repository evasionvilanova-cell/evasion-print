// Acceso a Gestión. El email y la contraseña se configuran en Vercel (ADMIN_EMAIL y ADMIN_PASSWORD).
import { setSession, safeEqual, tooManyAttempts, recordFailure, clientIp } from "@/lib/auth";
import { json, fail, body } from "@/lib/http";

export async function POST(req) {
  const { email, password } = await body(req).catch(() => ({}));
  const em = String(email || "").trim().toLowerCase();
  const ip = clientIp(req);
  const want = String(process.env.ADMIN_EMAIL || "").trim().toLowerCase();
  const pass = process.env.ADMIN_PASSWORD || "";
  if (!want || pass.length < 10) return fail("Falta configurar ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 10 caracteres) en Vercel.", 500);
  if (await tooManyAttempts(ip, em)) return fail("Demasiados intentos. Espera 15 minutos.", 429);
  if (!safeEqual(em, want) || !safeEqual(String(password || ""), pass)) {
    await recordFailure(ip, em);
    return fail("Email o contraseña incorrectos.", 401);
  }
  await setSession({ role: "admin", email: want });
  return json({ ok: true });
}
