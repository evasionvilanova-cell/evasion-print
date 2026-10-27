// Permiso para subir un archivo directamente a Vercel Blob desde el navegador (sin límite de 4,5 MB).
import { handleUpload } from "@vercel/blob/client";
import { canUpload, MAX_UPLOAD, ALLOWED } from "@/lib/files";
import { json, fail } from "@/lib/http";

export async function POST(req) {
  const b = await req.json().catch(() => null);
  if (!b) return fail("Datos no válidos.");
  try {
    const out = await handleUpload({
      body: b,
      request: req,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        let key = "";
        try { key = JSON.parse(clientPayload || "{}").key; } catch {}
        const c = await canUpload(key);
        if (!c.ok) throw new Error(c.why);
        return { allowedContentTypes: ALLOWED, maximumSizeInBytes: MAX_UPLOAD, addRandomSuffix: true, tokenPayload: JSON.stringify({ key }) };
      },
      onUploadCompleted: async () => {},
    });
    return json(out);
  } catch (e) {
    return fail(e.message || "No se ha podido preparar la subida.", 400);
  }
}
