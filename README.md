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
- **Recurrentes**: luz, gas, gym y similares (monto fijo o variable). Los fijos generan el gasto al vencer; los variables quedan pendientes hasta que ingresás el monto. Cambiar un monto fijo aplica *desde ahora* (historial aparte).
- **Notificaciones**: bandeja in-app + Web Push (PWA). Tipos extensibles (`RECURRING_*` hoy; mismo pipeline para futuros avisos).
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

Proyecto **poetic-intuition** con 4 servicios:

| Servicio | URL | Rol |
|----------|-----|-----|
| **api** | https://api-production-e98e.up.railway.app | Fastify + Prisma (migraciones + seed al arrancar) |
| **web** | https://web-production-b6d21.up.railway.app | React PWA (`vite preview`) |
| **Postgres** | (interno) | Base de datos managed |
| **promotions-sync** | (cron, sin URL pública) | Scraper MODO + Naranja X + Mercado Pago diario `0 9 * * *` UTC |

### Setup inicial (CLI)

Requisito: [Railway CLI](https://docs.railway.com/guides/cli) logueado (`railway login`).

```bash
# Linkear el repo al proyecto (una vez)
railway link --project poetic-intuition --environment production --service api

# Configurar servicios, variables y deploy (idempotente)
./scripts/railway-setup.sh
```

El script crea `api`, `web` y `promotions-sync` (si no existen), configura variables con referencias cruzadas (`${{Postgres.DATABASE_URL}}`, `${{api.RAILWAY_PUBLIC_DOMAIN}}`, etc.), aplica build/start commands vía `railway environment edit`, genera dominios y despliega con `railway up`.

### Variables por servicio

**api**
- `DATABASE_URL` → `${{Postgres.DATABASE_URL}}`
- `JWT_SECRET` → generado con `${{ secret(...) }}`
- `CORS_ORIGIN` → `https://${{web.RAILWAY_PUBLIC_DOMAIN}}`
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT` → Web Push (`npx web-push generate-vapid-keys`)
- `CRON_SECRET` → protege `POST /internal/jobs/recurring`

**web**
- `VITE_API_URL` → `https://${{api.RAILWAY_PUBLIC_DOMAIN}}` (horneado en build)

**promotions-sync**
- `DATABASE_URL` → `${{Postgres.DATABASE_URL}}`
- Cron: `0 9 * * *` (09:00 UTC = 06:00 ART)
- Corre MODO, Naranja X y Mercado Pago en un solo job (continúa si una fuente falla)

**recurring-daily** (cron recomendado, o el mismo servicio api)
- Cron: `0 11 * * *` UTC (08:00 ART)
- `curl -X POST "$API_URL/internal/jobs/recurring" -H "X-Cron-Secret: $CRON_SECRET"`

También se puede disparar a mano con los botones de sync en la pestaña Promos (admin).

### Redeploy manual

```bash
railway up --service api --detach
railway up --service web --detach
```

Config as code de referencia: `apps/api/railway.json`, `apps/web/railway.json`, `apps/api/railway-promotions.json`.

## Decisiones de modelo de datos

Ver [docs/project-brief.md](docs/project-brief.md). Resumen:

- `Purchase` guarda snapshot del descuento aplicado (el histórico no cambia si la promo se edita).
- Toda compra genera filas `Installment` (contado = 1 cuota paga); el dashboard mensual consulta solo esa tabla.
- `MonthlyCapUsage` acumula el descuento usado por `(hogar, entidad, mes)` — el tope es por banco, no por promoción.
- `Entity` + `PaymentMethodDefinition` son catálogo global seedeado; `PaymentMethod` del hogar solo agrega apodo, últimos 4 dígitos y ciclo de la tarjeta.
