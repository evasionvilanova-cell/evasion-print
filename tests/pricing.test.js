import test from "node:test";
import assert from "node:assert/strict";
import { priceCart } from "../lib/shop.js";

test("precio de una camiseta con logo y texto, con talla grande", () => {
  // 3 M + 1 2XL de la técnica (8,90): prenda 35,60 + 1,50; logo DTF 28 cm (7) + texto 22 cm (4,50) por unidad
  const items = [{ id: "a", pid: "dep-tecnica", name: "T", q: { M: 3, "2XL": 1 }, total: 83.1,
    design: { els: [{ kind: "logo", tech: "dtf", w: 28 }, { kind: "text", wcm: 22, vinyl: "V-01" }] } }];
  const r = priceCart({}, items, { ship: "tienda" });
  assert.equal(r.lines[0].total, 83.1);
  assert.equal(r.changed, false);
  assert.equal(r.shipping, 0);
});

test("descuento por cantidad y envío", () => {
  const items = [{ id: "a", pid: "cam-algodon", name: "T", q: { M: 10 }, total: 0, design: { els: [{ kind: "logo", tech: "dtf", w: 8 }] } }];
  const r = priceCart({}, items, { ship: "envio" });
  assert.equal(r.lines[0].total, 94.05); // (69 + 30) − 5 %
  assert.equal(r.shipping, 5.9);
  assert.equal(r.changed, true);
});

test("serigrafía: 0,45 €/ud + clichés 38 € + IVA y mínimo de 100 ud", () => {
  const it = (n) => [{ id: "s", pid: "cam-algodon", name: "T", q: { M: n }, total: 0, design: { els: [{ kind: "logo", tech: "seri", w: 25, recolor: "V-02" }] } }];
  const r = priceCart({}, it(100), { ship: "tienda" });
  // (6,90 + 0,45 × 1,21) × 100 = 744,45 − 20 % = 595,56 + 38 × 1,21 = 45,98 → 641,54
  assert.equal(r.lines[0].total, 641.54);
  assert.throws(() => priceCart({}, it(50), { ship: "tienda" }), /100 unidades/);
});

test("pedido mínimo de la prenda", () => {
  const kv = { ep_catalog: { "cam-algodon": { minQty: 25 } } };
  const it = (n) => [{ id: "m", pid: "cam-algodon", name: "T", q: { M: n }, total: 0, design: { els: [] } }];
  assert.throws(() => priceCart(kv, it(10), { ship: "tienda" }), /mínimo de 25/);
  assert.equal(priceCart(kv, it(25), { ship: "tienda" }).lines[0].qty, 25);
  assert.equal(priceCart(kv, it(10), { ship: "tienda", ignoreMin: true }).lines[0].qty, 10);
});
