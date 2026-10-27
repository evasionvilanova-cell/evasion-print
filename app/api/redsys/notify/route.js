// Redsys avisa aquí del resultado del pago (notificación online).
import { applyRedsys } from "@/lib/orders";

export async function POST(req) {
  const form = await req.formData().catch(() => null);
  const mp = form?.get("Ds_MerchantParameters"), sig = form?.get("Ds_Signature");
  const r = await applyRedsys(mp, sig).catch((e) => { console.error(e); return { ok: false }; });
  if (!r.ok) console.warn("Redsys notify", r);
  return new Response("OK", { status: 200 });
}
