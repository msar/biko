# Biko Trip Manager — Engineering Brief (MVP)

Derived from [`docs/trip-manager-prd.md`](./trip-manager-prd.md). This brief is the build contract for schema, API, and web surfaces. **Do not implement product code from this doc until scheduled**—it exists so design/engineering share one locked shape.

## Goals

1. Ship a **standalone** trip loop: create → invite → stay → lists → expenses → **Liquidar viaje** → closed.
2. Keep **optional** **Pasar a Biko** as a one-way write into household `Purchase` under Viajes—never a dependency for trip CRUD/close.
3. Reuse **math** from `packages/shared` (`expense-allocation`, `settle-up`); do **not** reuse household purchase tables or screens as the trip source of truth.

## Non-goals (MVP)

- Day-by-day itinerary, maps, chat, photo albums, booking email parse.
- Multi-stay, budget caps, multi-currency FX (v1.1+).
- Coupling trip entities to `Purchase` / `HouseholdSettlement` for core operations.

## Explicit non-coupling to Purchase

| Allowed | Forbidden for trip core |
|---------|-------------------------|
| Call shared allocation/settle pure functions | `TripExpense` extends or aliases `Purchase` |
| After export: store `exportedPurchaseId` / batch id on trip rows | Require `householdId` on `Trip` to create/list/settle |
| Pasar a Biko service creates `Purchase` rows | Household settle required to close a trip |
| Seed Viajes subcategories for export targets | Guest join → household membership |

Trip data remains source of truth until export. Unexported trips are valid forever.

---

## Auth, guests, and share links (implemented)

| Concern | Contract |
|---------|----------|
| **Invite URL** | `/viajes/invitar/{shareSlug}` — `Trip.shareSlug` from trip name (+ year / `-2` on collision). Stable after create. Legacy `TripInvite.code` (cuid) still resolves. |
| **Guest JWT** | `{ kind: 'trip_guest', tripId, tripMemberId }` after name-only join. No `User` / household required. |
| **User JWT** | `{ kind: 'user', userId, householdId?, email }`. `householdId` may be null for trip-only accounts linked later. |
| **Public routes** | `GET /trips/invite/:code`, `POST /trips/join` (optional auth). |
| **Link account** | `POST /trips/:tripId/link-account` (guest JWT) → register trip-only or login → sets `TripMember.userId`, returns user JWT. |
| **Hub flag** | `isGuestSession: true` for guest JWT. Guests denied Pasar a Biko / export. |
| **Trip chrome** | On `/viajes*`, bottom nav is trip-only (Resumen / Gastos / Listas / Personas + trip FAB). Household Resumen/Gastos/Promos/Más are not shown. Exit to Biko only via explicit “Volver a Biko” on the trip list for household users. |

Auth: JWT user **or** trip guest; `authenticateUser` rejects guests for create/list trip and household/export routes.

---

## Conceptual schema

Names are indicative; Prisma enums/models may match closely. Ownership: **`createdByUserId`**, not household-owned.

### Enums (indicative)

```text
TripStatus: PLANNING | ACTIVE | CLOSED
TripMemberRole: ORGANIZER | MEMBER
TripMemberInviteStatus: PENDING | JOINED | DECLINED
TripListItemType: TODO | PACK | BUY
TripListItemStatus: PENDING | DONE
TripExpenseCategory:  // product fixed set; store as enum or string matching PRD UI
  ALOJAMIENTO | VUELOS | TRANSPORTE | COMIDA | RESTAURANTES | ACTIVIDADES | OTROS
```

### Entities

#### `Trip`

| Field | Notes |
|-------|--------|
| `id` | cuid |
| `createdByUserId` | Organizer / owner — **required** |
| `name`, `destination` | Free text |
| `shareSlug` | Unique human invite path; set at create; stable on rename |
| `startDate`, `endDate` | Trip window |
| `status` | PLANNING → ACTIVE → CLOSED |
| `baseCurrency` | Default `ARS` |
| `exportHouseholdId` | **Optional**; set only when Pasar a Biko runs |
| `exportBatchId` / timestamps | Idempotency metadata for export |
| timestamps | `createdAt`, `updatedAt` |

**No required `householdId`.** Closed ≠ exported.

#### `TripMember`

| Field | Notes |
|-------|--------|
| `tripId`, `userId` | `userId` nullable until claim |
| `displayName` | Required for guests pre-account |
| `role` | ORGANIZER \| MEMBER |
| `inviteStatus` | PENDING (pre-created / unclaimed) \| JOINED \| … |
| `tripHouseholdId` | Optional FK to trip-internal group |
| unique | `(tripId, userId)` when userId set |

#### `TripHousehold` (trip-internal group)

| Field | Notes |
|-------|--------|
| `tripId`, `name` | Named settlement group (e.g. “Los García”) |
| **Not** | Biko `Household` / hogar — no relation to Pasar a Biko |

#### `TripInvite`

| Field | Notes |
|-------|--------|
| `tripId`, `code` | Unique code/link token |
| `expiresAt` | Optional |
| `createdByUserId` | Who minted the invite |

Joining creates/updates `TripMember` only—**never** household membership. Claim path: `POST /trips/join` with `{ claimMemberId }` links `userId` to a PENDING slot.

#### `TripExpense` + `TripExpensePayment` + `TripExpenseAllocation`

| Field | Notes |
|-------|--------|
| expense: `tripId`, `paidByMemberId` (primary / denormalized), `amount`, `category`, `note`, `date`, `currency` | Trip-scoped |
| payment: `tripExpenseId`, `tripMemberId`, `amount` | Who paid; rows must sum to expense amount |
| allocation: `tripExpenseId`, `tripMemberId`, `amount` | Who owes / share; same mental model as household splits |
| `exportedPurchaseId` | Optional; set per expense or via batch table after export |

**Not** a subclass of `Purchase`. Split modes invoke shared builders with **trip member ids** (adapter if household helpers assume “hogar” wording—prefer generic member-id APIs or thin wrappers). Balance **paid** = Σ payments; **share** = Σ allocations.

#### `TripSettlement`

| Field | Notes |
|-------|--------|
| `tripId`, `fromMemberId`, `toMemberId`, `amount`, `settledAt` | Within-trip paybacks (rows store representative members) |
| Balance UI / Liquidar | Aggregate to **settlement units** = `TripHousehold` or solo `TripMember`; minimize transfers between units |
| Independent of | `HouseholdSettlement` |

#### `TripListItem`

| Field | Notes |
|-------|--------|
| `tripId`, `type` (TODO \| PACK \| BUY), `title`, `notes`, `quantity` | |
| `assigneeMemberId` | Optional |
| `status`, optional `dayDate` | Soft itinerary hint only |

#### `TripAccommodation`

| Field | Notes |
|-------|--------|
| `tripId` | One primary stay in MVP (1:1 or enforce single row in service) |
| `label`, `address`, `checkIn`, `checkOut` | |
| `amount`, `expenseId` | Stay cost synced to linked `TripExpense` (category ALOJAMIENTO); counts in balances |
| `link`, `notes` | Notes may hold door codes—treat as sensitive in logs/UI |

#### Export link (optional table)

`TripExportBatch`: `id`, `tripId`, `householdId`, `exportedByUserId`, `createdAt`, links to created `Purchase` ids. Supports idempotent Pasar a Biko.

---

## Shared library reuse

| Library | Use in trips |
|---------|----------------|
| [`packages/shared/src/expense-allocation.ts`](../packages/shared/src/expense-allocation.ts) | EQUAL, ASSIGN, AMOUNT, SHARES, PERCENTAGE → `TripExpenseAllocation` |
| [`packages/shared/src/settle-up.ts`](../packages/shared/src/settle-up.ts) | Build balances from paid vs share; `simplify` / minimize transfers for **Liquidar viaje**; `applySettlementOffsets` for recorded `TripSettlement` |
| [`packages/shared/src/category-groups.ts`](../packages/shared/src/category-groups.ts) | **Export only**—map trip category buckets → seed category names under Viajes group (see PRD taxonomy) |
| `/juntada` / party helpers | UX inspiration only; trip settle is **persistent** and trip-scoped |

If allocation helpers hard-code “hogar” error strings or assume household user ids, add trip-agnostic wrappers in shared (or pass member ids without renaming domain).

---

## Viajes seed work (export path)

Implementers must:

1. Seed global categories from the PRD table (`Alojamiento`, `Vuelos`, `Movilidad viaje`, `Comida viaje`, `Restaurantes viaje`, `Actividades`; keep `Viajes`).
2. Expand `CATEGORY_GROUPS` entry `viajes.categoryNames` accordingly.
3. Map trip UI categories → those names on Pasar a Biko (see PRD).

No trip feature should require those categories to exist until export runs—but seeding early keeps export deterministic.

---

## API route sketch

NestJS module e.g. `trips` (names indicative). Auth: JWT user; guest join may use invite token + optional register/login.

### Trips

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/trips` | List for current user (member of); active first |
| `POST` | `/trips` | Create; set `createdByUserId`, add organizer member |
| `GET` | `/trips/:tripId` | Hub payload (summary + flags: canExport, isGuestSession) |
| `PATCH` | `/trips/:tripId` | Update metadata; reopen only organizer |
| `POST` | `/trips/:tripId/close` | Close after settle rules satisfied (product: typically after liquidar) |

### Members & invites

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/trips/:tripId/members` | Roster (joined + pending) |
| `POST` | `/trips/:tripId/members` | Organizer: pre-create pending traveller `{ displayName, tripHouseholdId? }` |
| `DELETE` | `/trips/:tripId/members/:memberId` | Organizer: remove member (not self / not organizer; blocked if has expenses) |
| `POST` | `/trips/:tripId/invites` | Mint trip invite (not household) |
| `GET` | `/trips/invite/:code` | Preview trip + unclaimed members for claim picker |
| `POST` | `/trips/join` | Body: `{ code, displayName?, claimMemberId? }` → claim slot or create member |
| `PATCH` | `/trips/:tripId/members/:memberId` | Role / name / `tripHouseholdId` (organizer) |
| `GET/POST` | `/trips/:tripId/households` | List / create trip-internal groups |
| `PATCH/DELETE` | `/trips/:tripId/households/:id` | Rename / delete group (members ungrouped) |

### Expenses & settle

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/trips/:tripId/expenses` | Feed |
| `POST` | `/trips/:tripId/expenses` | Create + allocations |
| `PATCH` | `/trips/:tripId/expenses/:id` | Edit |
| `DELETE` | `/trips/:tripId/expenses/:id` | |
| `GET` | `/trips/:tripId/balances` | Running trip balances |
| `POST` | `/trips/:tripId/settle` | Preview and/or record `TripSettlement`s; **Liquidar viaje** |
| `GET` | `/trips/:tripId/settle/preview` | Minimized transfers |

### Lists & stay

| Method | Path | Notes |
|--------|------|--------|
| `GET/POST/PATCH/DELETE` | `/trips/:tripId/list-items` | Filter by type |
| `GET/PUT` | `/trips/:tripId/accommodation` | Single stay MVP |

### Pasar a Biko (optional)

| Method | Path | Notes |
|--------|------|--------|
| `GET` | `/trips/:tripId/export/preview` | Eligibility + category % mix + amounts; 403/empty if ineligible |
| `POST` | `/trips/:tripId/export` | Idempotent create `HOUSEHOLD` purchases; set export metadata |

Authorization: organizer + active household finance context. Guests always denied.

---

## Web screens / routes

Spanish product copy: **Viajes / Gestor de viajes**, **Pasar a Biko**, **Liquidar viaje**.

| Route | Screen | Notes |
|-------|--------|--------|
| `/viajes` | Trip list | Active then closed; trip-first landing |
| `/viajes/nuevo` | Create trip | Minimal form |
| `/viajes/:id` | Trip hub | Tabs: **Resumen · Gastos · Listas · Alojamiento · Personas** |
| `/viajes/:id/gastos/nuevo` | Add expense | Optional deep link; or modal from FAB |
| `/viajes/invitar/:code` | Join | Display name + optional account; no household join |
| **Más** → link | Entry for household-first users | Do not force guests through `/` Resumen |

### Hub tab behavior

- **Resumen** — totals, pie, balances; CTA **Liquidar viaje**; conditional **Pasar a Biko**.
- **Gastos** — feed + FAB; patterns may resemble household expense form; must not open household ledger.
- **Listas** — Hacer / Traer-Comprar toggle.
- **Alojamiento** — address + maps outbound link.
- **Personas** — roster (claim status), trip-household groups, pre-create travellers, copy invite.

### Chrome rules

- Guest / trip-only: hide household bottom-nav destinations or replace with trip-centric shell so promos/gastos hogar are unreachable.
- Never show partner balance, promos, or cuotas inside trip hub.

---

## Pasar a Biko algorithm (sketch)

1. Assert eligibility (organizer + household context + trip liquidated/closed + not already exported for that household).
2. Compute exporter’s / household’s **net trip share** (product rule: typically the household members’ combined share of trip totals after trip settle—lock exact rule in implementation ticket; PRD: absolute amounts = that user’s / household’s net trip share).
3. Bucket trip expenses by trip category → % of trip total.
4. For each non-zero bucket, resolve seed category id via taxonomy map; create `Purchase`(s) scoped `HOUSEHOLD` with allocations consistent with household norms.
5. Persist `TripExportBatch` + link ids; return summary.
6. On retry with same batch key: no-op / return existing purchases.

Failure must not mutate trip status back from closed or undo settlements.

---

## Delivery phases (engineering)

| Phase | Ships |
|-------|--------|
| **MVP** | Schema + APIs above; web `/viajes` hub; Liquidar; optional export + Viajes seed/group expansion |
| **v1.1** | Budget, FX, offline add outbox, templates, push |
| **v2** | Multi-stay, light itinerary, polls, receipts, PDF |

---

## Open implementation notes

1. If every `User` still requires `householdId` in Prisma today, keep that for auth/tenant but **do not** use it as trip owner or gate trip features in UI/API.
2. Prefer evolving schema toward user-owned trips if household-as-container blocks standalone UX (PRD).
3. Door-code notes: avoid logging plaintext in API error/telemetry.
4. Update `category-groups` tests when expanding Viajes `categoryNames`.
5. Statement scrapers that map to `Viajes` remain valid via catch-all category name.
