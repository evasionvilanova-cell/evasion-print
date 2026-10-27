import { getSession } from "./auth.js";

export const KEY_RE = /^[a-z]{1,6}_[A-Za-z0-9_.\-]{1,160}$/;
// Archivos que sube un cliente (logos del pedido y adjuntos de presupuesto): nunca públicos en la web.
export const isCustomerKey = (k) => k.startsWith("lg_") || k.startsWith("q_");
export const scopeOf = (k) => (isCustomerKey(k) ? "private" : "public");

export async function canUpload(key) {
  if (!KEY_RE.test(key || "")) return { ok: false, why: "Nombre de archivo no válido." };
  const s = await getSession().catch(() => null);
  if (s && s.role === "admin") return { ok: true, admin: true };
  if (isCustomerKey(key)) return { ok: true, admin: false };
  return { ok: false, why: "Inicia sesión en Gestión." };
}

export const blobEnabled = () => !!process.env.BLOB_READ_WRITE_TOKEN;
export const MAX_UPLOAD = 25 * 1024 * 1024;
export const ALLOWED = ["image/png", "image/jpeg", "image/webp", "image/svg+xml", "image/gif", "application/pdf",
  "application/postscript", "application/illustrator", "image/vnd.adobe.photoshop", "application/octet-stream"];
