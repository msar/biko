# Biko — Gastos del hogar

Expense tracker para un hogar en Argentina: gastos compartidos, compras en cuotas que impactan el mes que realmente facturan, y promociones bancarias (MODO, Santander, BBVA, Naranja X, MercadoPago…) con topes mensuales de reintegro por entidad.

## Estructura

```
apps/api          Fastify + Prisma + PostgreSQL (REST, JWT)
apps/web          React + Vite PWA (instalable, offline-first, es-AR)
packages/shared   Lógica de dominio pura compartida (cuotas, descuentos, matching de promos)
docs/             Brief del proyecto
```

## Funcionalidad

- **Gastos**: carga rápida (monto → categoría → medio de pago), por miembro del hogar.
- **Cuotas**: las compras con tarjeta de crédito respetan cierre/vencimiento de la tarjeta; cada cuota impacta el dashboard del mes que factura.
- **Promociones**: catálogo de promos por entidad/días/comercio/rubro (una promo puede aplicar varios días, ej. "miércoles y domingos"). Al cargar un gasto el server sugiere y aplica la mejor promo, **respetando el tope mensual compartido por banco** (si el tope de Santander ya se consumió este mes, no aplica más descuento aunque la promo siga activa).
- **Promo recomendada al cargar un gasto**: la app compara todos los medios de pago del hogar y recomienda con cuál pagar, mostrando el ahorro estimado y el tope restante antes de guardar.
- **Calendario semanal** ("Promos") y vista **"Hoy conviene…"**: solo promos que matchean medios de pago que el hogar realmente tiene.
- **"¿Cuándo ir?"**: filtrás por rubro (ej. Combustible) y te dice qué días conviene comprar y con qué tarjeta.
- **Sync de promos MODO**: scraper de modo.com.ar/promos (botón manual en la pestaña Promos + cron diario en Railway). Las promos scrapeadas se deduplican por id externo y se dan de baja solas cuando desaparecen del sitio.
- **Medios de pago estandarizados**: catálogo global seedeado (Santander Visa, Santander Amex, MODO, …). Nada de texto libre tipo "Visa Sant".
- **Offline**: la PWA se instala desde el navegador, abre sin conexión con los datos cacheados (IndexedDB) y los gastos cargados offline se encolan y sincronizan al volver la red (idempotente vía `clientId`).
- **Auth**: email/password + JWT. El modelo `User` ya tiene `authProvider`/`externalId` para migrar a Clerk sin migración de datos.

## Desarrollo local

Requisitos: Node 20+. Postgres puede ser Docker o el embebido (sin Docker):

```bash
npm install

# opción A: Postgres embebido (descargado por npm, corre en puerto 5433)
npm run dev:db --workspace @biko/api

# opción B: Docker
docker compose up -d   # puerto 5432; ajustar DATABASE_URL en apps/api/.env

# primera vez: migraciones + seed (catálogo, categorías, promos de ejemplo)
npm run db:migrate --workspace @biko/api
npm run db:seed --workspace @biko/api

# levantar api (3001) y web (5173, proxy /api → 3001)
npm run dev:api
npm run dev:web
```

Tests: `npm test` (Vitest en `packages/shared`).

## Deploy en Railway

Un proyecto con 3 servicios:

1. **PostgreSQL** (plugin managed de Railway).
2. **api** — root del repo, config en `apps/api/railway.json`. Variables:
   - `DATABASE_URL` → referencia a la DB del proyecto
   - `JWT_SECRET` → secreto fuerte
   - `CORS_ORIGIN` → URL pública del servicio web
   El start command corre `prisma migrate deploy` + seed antes de levantar el server.
3. **web** — root del repo, config en `apps/web/railway.json`. Variables:
   - `VITE_API_URL` → URL pública del servicio api (se hornea en build)
4. **modo-sync (cron)** — servicio extra apuntando al mismo repo con:
   - Start command: `npm run sync:modo --workspace @biko/api`
   - Cron schedule: `0 9 * * *` (diario)
   - `DATABASE_URL` → misma referencia a la DB
   También se puede disparar a mano con el botón "Sincronizar MODO" en la pestaña Promos.

## Decisiones de modelo de datos

Ver [docs/project-brief.md](docs/project-brief.md). Resumen:

- `Purchase` guarda snapshot del descuento aplicado (el histórico no cambia si la promo se edita).
- Toda compra genera filas `Installment` (contado = 1 cuota paga); el dashboard mensual consulta solo esa tabla.
- `MonthlyCapUsage` acumula el descuento usado por `(hogar, entidad, mes)` — el tope es por banco, no por promoción.
- `Entity` + `PaymentMethodDefinition` son catálogo global seedeado; `PaymentMethod` del hogar solo agrega apodo, últimos 4 dígitos y ciclo de la tarjeta.
