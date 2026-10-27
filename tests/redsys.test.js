import test from "node:test";
import assert from "node:assert/strict";
import { buildPayment, readNotification, signNotification } from "../lib/redsys.js";

// Clave pública del entorno de pruebas de Redsys
const cfg = { merchant: "999008881", key: "sq7HjrUOBfKmC576ILgskD5srU870gJ7", terminal: "1", env: "test" };

test("firma del pago (comprobada con node-redsys-api)", () => {
  const p = buildPayment(cfg, { amount: 57.7, order: "2600104701", notifyUrl: "https://x/n", okUrl: "https://x/ok", koUrl: "https://x/ko", method: "bizum", description: "Pedido", holder: "Joan" });
  assert.equal(p.fields.Ds_Signature, "3QgSsFcEfkuMQoxjidjL5JCro72XlUAg01x5ZawIszY=");
  const params = JSON.parse(Buffer.from(p.fields.Ds_MerchantParameters, "base64").toString());
  assert.equal(params.DS_MERCHANT_AMOUNT, "5770");
  assert.equal(params.DS_MERCHANT_PAYMETHODS, "z");
});

test("notificación válida, denegada y manipulada", () => {
  const ok = signNotification(cfg, { Ds_Order: "2600104701", Ds_Response: "0000", Ds_Amount: "5770" });
  const r = readNotification(cfg, ok.Ds_MerchantParameters, ok.Ds_Signature);
  assert.equal(r.authorized, true);
  assert.equal(r.amount, 57.7);
  const ko = signNotification(cfg, { Ds_Order: "2600104701", Ds_Response: "0190", Ds_Amount: "5770" });
  assert.equal(readNotification(cfg, ko.Ds_MerchantParameters, ko.Ds_Signature).authorized, false);
  assert.equal(readNotification(cfg, ok.Ds_MerchantParameters, "A" + ok.Ds_Signature.slice(1)), null);
});
