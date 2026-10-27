// Sesiones con cookie firmada (HMAC) y contraseñas con scrypt.
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { q } from "./db.js";

const COOKIE = "ep_s";
const MAX_AGE = 60 * 60 * 24 * 30; // 30 días

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 24) throw new Error("Falta SESSION_SECRET (mínimo 24 caracteres) en Vercel.");
  return s;
}

const b64 = (b) => Buffer.from(b).toString("base64url");

export function sign(payload) {
  const body = b64(JSON.stringify({ ...payload, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  const mac = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${mac}`;
}

export function verify(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, mac] = token.split(".");
  const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(mac || ""), b = Buffer.from(good);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch { return null; }
}

export async function getSession() {
  const jar = await cookies();
  return verify(jar.get(COOKIE)?.value);
}

export async function setSession(payload) {
  const jar = await cookies();
  jar.set(COOKIE, sign(payload), {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function requireAdmin() {
  const s = await getSession();
  return s && s.role === "admin" ? s : null;
}

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(pw, salt, 32, { N: 16384, r: 8, p: 1 });
  return `scrypt$${salt.toString("base64url")}$${key.toString("base64url")}`;
}

export function checkPassword(pw, stored) {
  if (!stored || !stored.startsWith("scrypt$")) return false;
  const [, salt, key] = stored.split("$");
  const want = Buffer.from(key, "base64url");
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, "base64url"), want.length, { N: 16384, r: 8, p: 1 });
  return crypto.timingSafeEqual(got, want);
}

export function safeEqual(a, b) {
  const x = crypto.createHash("sha256").update(String(a)).digest();
  const y = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// Frena ataques de fuerza bruta: máximo 8 intentos fallidos por IP o email en 15 minutos.
export async function tooManyAttempts(ip, email) {
  const r = await q(
    "select count(*)::int n from login_attempts where at > now() - interval '15 minutes' and (ip=$1 or email=$2)",
    [ip, email]
  );
  return r.rows[0].n >= 8;
}
export async function recordFailure(ip, email) {
  await q("insert into login_attempts(ip,email) values($1,$2)", [ip, email]);
  await q("delete from login_attempts where at < now() - interval '1 day'");
}

export function clientIp(req) {
  return (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";
}
