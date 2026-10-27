import { clearSession } from "@/lib/auth";
import { json } from "@/lib/http";
export async function POST() { await clearSession(); return json({ ok: true }); }
