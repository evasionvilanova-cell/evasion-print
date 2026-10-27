# Evasion Print

Tienda online de ropa personalizada (DTF a todo color y vinilo a un color) de Evasion Running Vilanova.
El cliente diseña, ve el precio al momento y paga con tarjeta o Bizum (Redsys). Sin presupuestos.

## Cómo está hecha

- **Next.js en Vercel.** La web es `shop/tienda.html` (el prototipo probado). El servidor le añade los datos al cargarla.
- **Base de datos Neon (Postgres):** catálogo, colores, tallas, tarifas, clientes, pedidos y presupuestos. Las tablas se crean solas.
- **Vercel Blob:** fotos de prendas, logos de los pedidos y adjuntos de presupuestos.
- **Redsys:** el precio se **recalcula en el servidor** antes de cobrar; el pedido solo aparece en Gestión cuando el banco confirma el pago.
- **Contraseñas:** las de los clientes se guardan cifradas (scrypt); la de Gestión está en las variables de Vercel.

| Ruta | Qué hace |
|---|---|
| `/` | La tienda |
| `/#admin` | Gestión |
| `/api/checkout` | Crea el pedido y prepara el pago |
| `/api/redsys/notify` | Redsys confirma el pago aquí |

## Puesta en marcha (una sola vez)

1. **Vercel → Add New → Project →** importa `evasion-print` de GitHub y pulsa *Deploy*. La web dará error hasta completar los pasos 2–5; es normal.
2. **Storage → Create → Neon** (Postgres) → conéctalo al proyecto. Crea `DATABASE_URL`.
3. **Storage → Create → Blob** → conéctalo al proyecto. Crea `BLOB_READ_WRITE_TOKEN`.
4. **Settings → Environment Variables:** añade las de `.env.example` (`SESSION_SECRET`, `ADMIN_EMAIL`, `ADMIN_PASSWORD`, las de Redsys y `SITE_URL`).
5. **Deployments → Redeploy.**
6. **Settings → Domains:** añade `evasionprint.com` y `www.evasionprint.com` y copia los registros DNS que te indique Vercel en tu proveedor del dominio.

## Redsys

- Empieza con `REDSYS_ENV=test`. Tarjeta de prueba: **4548 8100 0000 0003**, caducidad **12/49**, CVV **123**.
- Cuando el banco te dé los datos reales (FUC, terminal y clave SHA-256), cámbialos en Vercel, pon `REDSYS_ENV=real` y redespliega.
- En el módulo de administración de Redsys (Canales), deja la notificación online activada y **«Parámetros en las URLs: Sí»**.
- Si el banco aún no ha activado Bizum, pon `REDSYS_BIZUM=off` y la opción desaparece del pago.

## Pruebas

`npm test` comprueba la firma de Redsys y el cálculo de precios.
