# Household Finance App — Project Brief

## Context

Personal finance management app for a household in Argentina. First users: a couple (2 people), so no complex multi-tenant requirements are needed yet, but the data model is designed household-first so it scales beyond 2 users without rework.

Core differentiator vs. generic finance apps (YNAB, Ualá, Fintonic): native modeling of **Argentina-specific bank/wallet promotions** (day-of-week discounts tied to a payment method and optionally a store) combined with **credit card installment tracking**, so the app can tell the household not just "what did we spend" but "where/how should we be paying to save money."

## Goals (in priority order)

1. Track shared household expenses (manual entry first).
2. Categorize expenses (butcher, produce, supermarket, poultry shop, etc.).
3. Track credit card purchases paid in installments (cuotas), correctly reflected in the month they actually bill.
4. Maintain a catalog of bank/wallet promotions (e.g. "Mondays, ChangoMás, MODO, 25% off up to $20,000") and recommend which payment method to use per day/store.
5. Track savings with accurate cap enforcement, including **per-promotion, per-bank monthly caps** (each promo has its own tope, tracked separately for each paying bank).
6. (Later) Bulk-load expenses from bank statement PDFs/CSVs.
7. (Later, lower priority) Automate promotion updates via scraping bank/wallet sites. Explicitly deprioritized — see Risks section.

## Explicitly out of scope for now

- **Direct bank account connection / open banking.** Not available as a public API in Argentina today. Aggregators like Belvo exist but are paid B2B services, overkill for a 2-user app. Bank statement file import (PDF/CSV) is the chosen substitute.
- **Automated promotion scraping.** Deprioritized to a later phase due to fragility (banks/wallets change their sites without notice, some require authenticated sessions, ToS risk on some portals). MVP uses manually-curated promotions instead — the two users already know their own bank promos, so this isn't a blocker to shipping value.

## Deployment target

Railway (both API and web app as separate services within one Railway project, plus managed PostgreSQL).

## Tech stack (decided)

- **Backend:** NestJS (TypeScript) — chosen because the developer has a Java/Spring background; NestJS's module/controller/service/DI structure maps closely, low ramp-up cost.
- **ORM:** Prisma
- **Database:** PostgreSQL (Railway managed)
- **Frontend:** Next.js configured as a PWA (installable, mobile-first — this is the primary usage pattern, so expense entry UX must be 2–3 taps max)
- **Auth:** Simple email/password (JWT) for MVP, but the `User` model is already prepared to add an external provider (e.g. Clerk, Google) later without a schema migration — see `authProvider` / `externalId` fields below.

## Suggested repo structure

```
/apps
  /api                    → NestJS
    /src
      /modules
        /household
        /users
        /expenses         (purchases + installments)
        /categories
        /payment-methods
        /promotions
        /statement-import
      /common
    prisma/
      schema.prisma
  /web                    → Next.js (PWA)
    /app
      /(auth)
      /dashboard
      /expenses
      /promotions
      /today               → "what to buy today and where" view
    /public
      manifest.json
      sw.js
/packages
  /shared                 → shared TS types between api and web
```

## Suggested phasing

**Phase 1 — MVP**
- Household with 2 users, shared expenses
- Categories
- Credit card installment purchases, correctly billed to the right month (respects card closing/due day)
- Simple dashboard: spend by category/person for the current month

**Phase 2**
- Promotions catalog (manual entry via admin UI or config)
- Automatic promotion suggestion when logging an expense (entity + day + store + payment method match, respecting monthly cap already consumed)
- Weekly "where to shop with what card" calendar view
- Savings report (sum of discounts applied, by month/category/promotion)

**Phase 3**
- Bank statement import (PDF/CSV) for bulk expense loading

**Phase 4 (optional, reassess necessity before building)**
- Scraping automation for promotions, or integrate a third-party aggregator if one exists, instead of maintaining scrapers per bank

---

## Data model (Prisma schema, current state)

This is the finalized schema after several design iterations. Key modeling decisions are annotated inline as comments.

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============================================================
// ENUMS
// ============================================================

enum PaymentMethodType {
  DEBIT_CARD
  CREDIT_CARD
  WALLET // e.g. MODO, MercadoPago
  CASH
  BANK_TRANSFER
}

enum DayOfWeek {
  MONDAY
  TUESDAY
  WEDNESDAY
  THURSDAY
  FRIDAY
  SATURDAY
  SUNDAY
}

enum PromotionSource {
  MANUAL
  SCRAPED
}

enum StatementImportStatus {
  PENDING
  PROCESSED
  FAILED
}

// ============================================================
// HOUSEHOLD & USERS
// ============================================================

model Household {
  id        String   @id @default(cuid())
  name      String
  createdAt DateTime @default(now())

  users            User[]
  categories       Category[]
  paymentMethods   PaymentMethod[]
  purchases        Purchase[]
  statementImports StatementImport[]
  monthlyCapUsages MonthlyCapUsage[]
}

model User {
  id           String    @id @default(cuid())
  householdId  String
  household    Household @relation(fields: [householdId], references: [id])
  name         String
  email        String    @unique
  // Null if the user authenticates via an external provider (e.g. Clerk) instead of a local password.
  passwordHash String?
  // "password" today; "clerk" / "google" once migrated to an external provider.
  authProvider String    @default("password")
  // User id on the external provider, when authProvider != "password".
  externalId   String?
  createdAt    DateTime  @default(now())

  purchases    Purchase[]
  ownedMethods PaymentMethod[] @relation("MethodOwner")
}

// ============================================================
// CATEGORIES & PAYMENT METHODS
// ============================================================

model Category {
  id          String     @id @default(cuid())
  // null = global/seed category, not exclusive to one household
  householdId String?
  household   Household? @relation(fields: [householdId], references: [id])
  name        String     // Butcher, Produce, Supermarket, Poultry, etc.
  icon        String?
  color       String?

  purchases   Purchase[]

  @@unique([householdId, name])
}

model PaymentMethod {
  id          String            @id @default(cuid())
  householdId String
  household   Household         @relation(fields: [householdId], references: [id])
  ownerUserId String?           // whose card/account this is (for per-person reporting)
  owner       User?             @relation("MethodOwner", fields: [ownerUserId], references: [id])

  name        String            // "Visa Galicia", "MODO Account", "Cash"
  type        PaymentMethodType
  entity      String            // bank/wallet: "Galicia", "Santander", "BBVA", "MODO", "Naranja X", "MercadoPago"
  lastFour    String?

  // CREDIT_CARD only: determines which billing month each installment falls into
  closingDay  Int?              // statement closing day (e.g. 15)
  dueDay      Int?              // statement due day (e.g. 10 of the month after closing)

  purchases   Purchase[]

  @@index([householdId])
}

// ============================================================
// PROMOTIONS (global data, not household-specific)
// ============================================================

model Promotion {
  id                 String             @id @default(cuid())
  entity             String             // "MODO", "Santander", "Naranja X", etc.
  store              String?            // "ChangoMás", "Carrefour" — null = applies to any store
  paymentMethodType  PaymentMethodType? // restricts to a payment method type, if applicable
  dayOfWeek          DayOfWeek?         // null = every day

  discountPercentage Decimal            @db.Decimal(5, 2) // e.g. 25.00
  discountCap        Decimal?           @db.Decimal(12, 2) // monthly cap in ARS, null = uncapped
  minPurchaseAmount  Decimal?           @db.Decimal(12, 2)

  validFrom          DateTime?
  validTo            DateTime?

  source             PromotionSource    @default(MANUAL)
  sourceUrl          String?            // e.g. https://www.modo.com.ar/promos (for future scraping)
  active             Boolean            @default(true)
  notes              String?

  createdAt          DateTime           @default(now())
  updatedAt          DateTime           @updatedAt

  purchases          Purchase[]

  @@index([entity, dayOfWeek, active])
}

// ============================================================
// PURCHASES & INSTALLMENTS
// ============================================================

// Purchase = the actual transaction. Stores a *snapshot* of the discount applied
// (not just a promotionId reference) so historical savings never change if the
// promotion is edited or deactivated later.
model Purchase {
  id              String    @id @default(cuid())
  householdId     String
  household       Household @relation(fields: [householdId], references: [id])
  userId          String    // who logged/made the purchase
  user            User      @relation(fields: [userId], references: [id])
  paymentMethodId String
  paymentMethod   PaymentMethod @relation(fields: [paymentMethodId], references: [id])
  categoryId      String
  category        Category  @relation(fields: [categoryId], references: [id])

  store           String
  description     String?
  purchaseDate    DateTime

  // Amounts
  grossAmount     Decimal   @db.Decimal(12, 2) // 100,000 (list price, no discount)

  // Snapshot of the applied promotion (if any)
  promotionId               String?
  promotion                 Promotion? @relation(fields: [promotionId], references: [id])
  discountPercentageApplied Decimal?   @db.Decimal(5, 2) // 25.00 (copied at purchase time)
  discountCapApplied        Decimal?   @db.Decimal(12, 2) // remaining cap available at purchase time

  discountAmount  Decimal   @db.Decimal(12, 2) @default(0) // 20,000 → already cap-adjusted
  netAmount       Decimal   @db.Decimal(12, 2) // grossAmount - discountAmount = 80,000 (what's actually paid/financed)

  installmentsCount Int     @default(1)

  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt

  installments    Installment[]

  @@index([householdId, purchaseDate])
  @@index([categoryId])
}

// Each installment is an "expense" that hits a specific month.
// For non-installment purchases, installmentsCount = 1 and there is a single
// Installment row with dueDate = purchaseDate. This way the monthly dashboard
// always queries this table, without branching on cash vs. installment logic.
model Installment {
  id          String   @id @default(cuid())
  purchaseId  String
  purchase    Purchase @relation(fields: [purchaseId], references: [id], onDelete: Cascade)

  // denormalized for cheap dashboard queries without heavy joins
  householdId String

  number      Int      // 1, 2, 3... N
  amount      Decimal  @db.Decimal(12, 2)
  dueDate     DateTime
  paid        Boolean  @default(false)
  paidDate    DateTime?

  @@index([householdId, dueDate])
  @@unique([purchaseId, number])
}

// ============================================================
// MONTHLY DISCOUNT CAP PER PROMOTION + PAYING BANK
// ============================================================

// Reintegro caps are monthly and tracked per (promotion, paying bank), not per
// transaction. Each promo has its own tope, and each participating bank manages
// it independently. E.g. a MODO promo in ChangoMás paid with Santander consumes
// Santander's cap for that promo; the same promo paid with BBVA uses BBVA's own
// (independent) cap. A different promo from the same bank also has its own cap.
// `entityId` is the entity of the payment method used (the bank), not the
// promo's entity (which for MODO is the wallet).
model MonthlyCapUsage {
  id          String    @id @default(cuid())
  householdId String
  household   Household @relation(fields: [householdId], references: [id])
  promotionId String    // cap is tracked per promotion
  entityId    String    // ...and per paying bank (payment method entity)
  yearMonth   String    // format "2026-07"
  usedAmount  Decimal   @db.Decimal(12, 2) @default(0)

  @@unique([householdId, promotionId, entityId, yearMonth])
  @@index([householdId, yearMonth])
}

// ============================================================
// BANK STATEMENT IMPORT
// ============================================================

model StatementImport {
  id             String   @id @default(cuid())
  householdId    String
  household      Household @relation(fields: [householdId], references: [id])
  fileName       String
  bankSource     String   // "Galicia", "Santander", etc.
  status         StatementImportStatus @default(PENDING)
  processedCount Int      @default(0)
  errorLog       String?
  importedAt     DateTime @default(now())

  @@index([householdId])
}
```

---

## Business logic already designed

### 1. Discount calculation with cap (implemented — `installment-calculator.ts`)

```ts
export function calculateDiscount(
  grossAmount: number,
  discountPercentage?: number | null,
  discountCap?: number | null,
): { discountAmount: number; netAmount: number } {
  if (!discountPercentage) {
    return { discountAmount: 0, netAmount: grossAmount };
  }
  const rawDiscount = grossAmount * (discountPercentage / 100);
  const discountAmount = discountCap != null ? Math.min(rawDiscount, discountCap) : rawDiscount;
  return {
    discountAmount: round2(discountAmount),
    netAmount: round2(grossAmount - discountAmount),
  };
}
```

Example: $100,000 purchase, 25% discount, $20,000 cap → `min(25,000, 20,000) = 20,000` saved, not 25,000.

Note: this function takes a `discountCap` argument directly. When called from the promotion-suggestion flow (see #3 below), the caller must pass the **remaining** monthly cap for that bank, not the promotion's raw `discountCap` field — the remaining amount already accounts for what was spent earlier in the month.

### 2. Installment generation respecting card billing cycle (implemented — `installment-calculator.ts`)

```ts
export function generateInstallments(
  netAmount: number,
  installmentsCount: number,
  purchaseDate: Date,
  paymentMethod: { type: PaymentMethodType; closingDay?: number | null; dueDay?: number | null },
): Array<{ number: number; amount: number; dueDate: Date }> {
  if (paymentMethod.type !== 'CREDIT_CARD') {
    // Cash / debit / wallet / transfer: settled immediately, single paid installment.
    return [{ number: 1, amount: netAmount, dueDate: purchaseDate }];
  }
  const firstDueDate = getFirstDueDate(purchaseDate, paymentMethod.closingDay, paymentMethod.dueDay);
  return splitAmount(netAmount, installmentsCount).map((amount, i) => ({
    number: i + 1,
    amount,
    dueDate: addMonths(firstDueDate, i),
  }));
}
```

Key rule: if the purchase date is after the card's `closingDay`, the first installment rolls into the *next* billing cycle (`closingMonth += 1`), matching how Argentine credit card statements actually work. The last installment absorbs rounding drift so the sum always matches `netAmount` exactly.

Full implementation is in the attached `installment-calculator.ts` file.

### 3. Weekly promotion recommendation by household payment methods (implemented — `promotion-recommender.ts`)

Cross-references the household's actual `PaymentMethod.entity` values against active `Promotion` records per day of week. A promotion is only surfaced if the household actually holds a matching payment method — no point recommending a Naranja X promo to a household that doesn't have that card.

Full implementation is in the attached `promotion-recommender.ts` file.

### 4. Promotion auto-suggestion with monthly cap enforcement (designed, **not yet implemented as code**)

This is the next piece to build. Requirements gathered so far:

- Given `{ householdId, date, store, paymentMethodId }`, find candidate promotions matching entity + day-of-week + (store or store-agnostic) + payment method type.
- Prefer store-specific promotions over store-agnostic ones when both match.
- For each candidate, look up (or lazily create) a `MonthlyCapUsage` row keyed by `(householdId, promotion.id, payingBankEntityId, yearMonth)`.
- `remainingCap = promotion.discountCap != null ? max(promotion.discountCap - usedAmount, 0) : Infinity`.
- **If `remainingCap <= 0`, skip this candidate — no discount should be applied for that promotion + bank this month, even though the promotion itself is "active."** Caps are per promotion and per paying bank: e.g. if the "ChangoMás 20%" promo's $25,000 monthly cap was already consumed with Santander, paying with Santander gives no further discount, while paying the same promo with BBVA (or a different promo) keeps its own independent cap.
- If a valid candidate is found, apply `calculateDiscount(grossAmount, promotion.discountPercentage, remainingCap)`, then increment `MonthlyCapUsage.usedAmount` by the `discountAmount` actually applied.
- If no candidate survives the cap check, the purchase is saved with `discountAmount = 0`, `netAmount = grossAmount`, `promotionId = null`.

Suggested service shape (pseudocode, to be implemented in NestJS with Prisma):

```ts
interface CapUsageRepository {
  getUsedAmount(householdId: string, promotionId: string, entityId: string, yearMonth: string): Promise<number>;
  incrementUsedAmount(householdId: string, promotionId: string, entityId: string, yearMonth: string, amount: number): Promise<void>;
}

class PromotionSuggestionService {
  constructor(private capUsage: CapUsageRepository) {}

  async suggestPromotion(params: {
    householdId: string;
    date: Date;
    store: string | null;
    paymentMethod: { entity: string; type: PaymentMethodType };
    promotions: PromotionInput[];
  }): Promise<{ promotion: PromotionInput; remainingCap: number; yearMonth: string } | null> {
    // 1. filter candidates by entity/day/store/type match
    // 2. sort store-specific before store-agnostic
    // 3. for each candidate, check remaining cap via capUsage; skip if <= 0
    // 4. return first valid candidate, or null if none survive
  }

  async applyDiscount(params: {
    householdId: string;
    grossAmount: number;
    suggested: { promotion: PromotionInput; remainingCap: number; yearMonth: string };
  }): Promise<{ discountAmount: number; netAmount: number }> {
    // uses calculateDiscount(grossAmount, promotion.discountPercentage, remainingCap)
    // then increments MonthlyCapUsage via capUsage.incrementUsedAmount
  }
}
```

Suggested API surface: `GET /promotions/suggest?date=&store=&paymentMethodId=` for the frontend to call while the user is logging an expense, before final save.

---

## Attached files

- `schema.prisma` — full data model (source of truth, matches the schema block above)
- `installment-calculator.ts` — discount calculation + installment generation logic
- `promotion-recommender.ts` — weekly recommendation calendar logic

## Open items for the development plan

1. Implement `PromotionSuggestionService` (design above) with Prisma-backed `CapUsageRepository`.
2. Design the NestJS module boundaries and DTOs for `expenses` (purchases + installments combined), `promotions`, `payment-methods`.
3. Define the initial auth flow (email/password + JWT) — keep it minimal, but respect the `authProvider`/`externalId` fields already in the schema so a future Clerk migration doesn't require a data migration, only a cutover.
4. Define seed data: default categories, and a starting set of manually-curated promotions for the banks/wallets the household actually uses.
5. Design the Next.js PWA expense-entry flow (2–3 taps target) and the "Today" view (which promotions apply today given the household's payment methods).
6. Set up the Railway project: API service, Web service, managed Postgres, environment variables, CI/deploy pipeline.
7. Defer: bank statement import (Phase 3) and promotion scraping (Phase 4) — do not scope these into the initial build plan.
