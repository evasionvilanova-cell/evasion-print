// Redsys (TPV virtual): firma HMAC_SHA256_V1 para tarjeta y Bizum.
import crypto from "node:crypto";

export const REDSYS_URL = {
  test: "https://sis-t.redsys.es:25443/sis/realizarPago",
  real: "https://sis.redsys.es/sis/realizarPago",
};

export function redsysConfig() {
  const merchant = process.env.REDSYS_MERCHANT_CODE;
  const key = process.env.REDSYS_SECRET_KEY;
  if (!merchant || !key) return null;
  return {
    merchant,
    key,
    terminal: process.env.REDSYS_TERMINAL || "1",
    env: process.env.REDSYS_ENV === "real" ? "real" : "test",
    bizum: process.env.REDSYS_BIZUM !== "off",
  };
}

function orderKey(secretB64, order) {
  const key = Buffer.from(secretB64, "base64");
  const iv = Buffer.alloc(8, 0);
  const cipher = crypto.createCipheriv("des-ede3-cbc", key, iv);
  cipher.setAutoPadding(false);
  const data = Buffer.from(order, "utf8");
  const padded = Buffer.concat([data, Buffer.alloc((8 - (data.length % 8)) % 8, 0)]);
  return Buffer.concat([cipher.update(padded), cipher.final()]);
}

function mac(secretB64, order, merchantParamsB64) {
  return crypto.createHmac("sha256", orderKey(secretB64, order)).update(merchantParamsB64).digest();
}

export function buildPayment(cfg, p) {
  const params = {
    DS_MERCHANT_AMOUNT: String(Math.round(p.amount * 100)),
    DS_MERCHANT_ORDER: p.order,
    DS_MERCHANT_MERCHANTCODE: cfg.merchant,
    DS_MERCHANT_CURRENCY: "978",
    DS_MERCHANT_TRANSACTIONTYPE: "0",
    DS_MERCHANT_TERMINAL: cfg.terminal,
    DS_MERCHANT_MERCHANTURL: p.notifyUrl,
    DS_MERCHANT_URLOK: p.okUrl,
    DS_MERCHANT_URLKO: p.koUrl,
    DS_MERCHANT_CONSUMERLANGUAGE: "001",
    DS_MERCHANT_MERCHANTNAME: "Evasion Print",
    DS_MERCHANT_PRODUCTDESCRIPTION: (p.description || "").slice(0, 125),
    DS_MERCHANT_TITULAR: (p.holder || "").slice(0, 60),
  };
  if (p.method === "bizum") params.DS_MERCHANT_PAYMETHODS = "z";
  else params.DS_MERCHANT_PAYMETHODS = "C";
  const merchantParams = Buffer.from(JSON.stringify(params)).toString("base64");
  const signature = mac(cfg.key, p.order, merchantParams).toString("base64");
  return {
    url: REDSYS_URL[cfg.env],
    fields: { Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: merchantParams, Ds_Signature: signature },
  };
}

// Comprueba la notificación que envía Redsys. Devuelve los parámetros si la firma es válida.
export function readNotification(cfg, merchantParamsB64, signature) {
  if (!merchantParamsB64 || !signature) return null;
  const norm = (s) => String(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const json = Buffer.from(merchantParamsB64.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
  let params;
  try { params = JSON.parse(json); } catch { return null; }
  const order = params.Ds_Order || params.DS_ORDER;
  if (!order) return null;
  const good = norm(mac(cfg.key, order, merchantParamsB64).toString("base64"));
  const a = Buffer.from(good), b = Buffer.from(norm(signature));
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const code = parseInt(params.Ds_Response, 10);
  return { params, order, authorized: Number.isFinite(code) && code >= 0 && code <= 99, code, amount: +params.Ds_Amount / 100 };
}

// Solo para pruebas: firma una notificación como la haría Redsys.
export function signNotification(cfg, params) {
  const merchantParams = Buffer.from(JSON.stringify(params)).toString("base64");
  const sig = mac(cfg.key, params.Ds_Order, merchantParams).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  return { Ds_SignatureVersion: "HMAC_SHA256_V1", Ds_MerchantParameters: merchantParams, Ds_Signature: sig };
}
