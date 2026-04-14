# Prisma Migration Review — Uptime Pro (`prisma-migration` branch)

_Generated from direct inspection of the `prisma-migration` branch._

> **Status: COMPLETE (2026-04-13).** The migration from `redbean-node` to Prisma is finished. All 44 files
> and 284 ORM call sites have been converted. This document is retained as historical reference for the
> migration decisions and analysis performed before and during the migration.

---

## 1. Executive Summary

Replacing `redbean-node` with Prisma was a **high-effort, high-risk migration** that touched 44 source files
and 284 discrete ORM method call sites across the backend. The core challenge was not Prisma itself — it was
that the codebase was built around an Active Record pattern (`BeanModel`) with loosely typed,
convention-driven table access, heavy raw SQL (`R.exec`: 64 calls), and a multi-dialect database setup
(SQLite, MariaDB, Embedded MariaDB) that Prisma handles differently from Knex. This document captures the
pre-migration state, the decision analysis, and the incremental strategy that was followed.

---

## 2. Pre-Migration ORM Architecture

### Knex + redbean-node layering (historical)

`server/database.js` previously initialized the ORM as follows:

```js
const knexInstance = knex(config);   // Knex configured for sqlite/mysql2
R.setup(knexInstance);               // redbean-node wraps the Knex instance
R.freeze(true);                      // disables auto table-creation
R.autoloadModels("./server/model");  // discovers all BeanModel subclasses
```

redbean-node was **a thin Active Record layer on top of Knex**, not a standalone ORM driver.
Removing it meant replacing both the query API _and_ the object-mapping layer in one shot.

### Multi-dialect support

`Database.connect()` built different Knex configs for three database back ends:

| Back end | Knex client | Notes |
|---|---|---|
| SQLite | Custom `@louislam/sqlite3` Dialect | WAL mode, PRAGMA-heavy init |
| MariaDB (external) | `mysql2` | Pool config, utf8mb4 charset |
| MariaDB (embedded) | `mysql2` | Unix socket path |

The custom SQLite dialect (`KumaColumnCompiler`, `@louislam/sqlite3`) and the `typeCast` shim for
MariaDB DATETIME fields were custom workarounds. Prisma now uses the `better-sqlite3` driver adapter
pattern, bypassing these issues for SQLite.

### Active Record model pattern (replaced)

Every model previously extended `BeanModel` from `redbean-node/dist/bean-model`:

```js
// Before migration:
const { BeanModel } = require("redbean-node/dist/bean-model");
class Monitor extends BeanModel { ... }
class User extends BeanModel { ... }
class Tag extends BeanModel { ... }
```

`BeanModel` provided implicit property access mapped to database columns (no schema declaration needed).
After migration, all model classes are plain classes with explicit Prisma Client queries. Field access
uses direct property names declared in `prisma/schema.prisma`.

---

## 3. All redbean-node Usage Locations (all migrated to Prisma)

| File | R method calls | Methods used |
|---|---|---|
| server/model/monitor.js | ~40 | exec, findOne, store, getAll, getRow, load, find |
| server/database.js | ~15 | exec, getAll, getCell, begin |
| server/model/status_page.js | ~20 | findOne, store, exec, getAll, find |
| server/model/maintenance.js | ~18 | findOne, store, exec, getAll |
| server/model/domain_expiry.js | ~12 | findOne, store, exec |
| server/socket-handlers/maintenance-socket-handler.js | ~12 | findOne, store, exec, getAll |
| server/socket-handlers/status-page-socket-handler.js | ~12 | findOne, store, exec |
| server/uptime-kuma-server.js | ~12 | findOne, find, store, getAll, exec |
| server/notification.js | ~10 | findOne, store, exec, getAll |
| server/model/heartbeat.js | ~8 | exec, getAll, getRow |
| server/server.js | ~8 | findOne, exec, store |
| server/settings.js | ~7 | findOne, store, exec |
| server/socket-handlers/api-key-socket-handler.js | ~6 | findOne, store, trash, getAll |
| server/model/api_key.js | ~5 | findOne, store, exec |
| server/routers/api-router.js | ~5 | findOne, store |
| server/routers/status-page-router.js | ~5 | findOne, store |
| server/auth.js | ~4 | exec, findOne |
| server/model/proxy.js | ~4 | findOne, store |
| server/model/docker_host.js | ~3 | findOne, store |
| server/model/group.js | ~3 | findOne, store |
| server/model/incident.js | ~3 | findOne, store, trash |
| server/model/remote_browser.js | ~3 | findOne, store |
| server/model/tag.js | ~3 | findOne, store, trash |
| server/model/user.js | ~3 | exec |
| server/jobs/clear-old-data.js | ~4 | exec |
| server/jobs/incremental-vacuum.js | ~2 | exec |
| server/2fa.js | ~1 | exec |
| server/docker.js | ~2 | exec, findOne |
| server/prometheus.js | ~3 | findOne, getAll |
| server/proxy.js | ~3 | findOne, getAll |
| server/remote-browser.js | ~3 | findOne, store |
| server/uptime-calculator.js | ~3 | exec, getAll |
| server/util-server.js | ~2 | findOne |
| server/client.js | ~2 | findOne |
| server/monitor-types/dns.js | ~1 | findOne |
| server/monitor-types/globalping.js | ~1 | findOne |
| _(other files at 1–2 calls each)_ | ~10 | findOne, store |
| **TOTAL** | **~284** | exec(64), findOne(55), store(40), getAll(22), find(18), getRow(6), trash(5), load(2), begin(1) |

### Method-to-Prisma mapping (completed)

| redbean-node (removed) | Prisma replacement (in use) | Notes |
|---|---|---|
| `R.findOne(table, where, params)` | `prisma.table.findFirst({ where })` | Param style changed from `?` to object |
| `R.store(bean)` | `prisma.table.upsert / create / update` | Each call site audited for create vs update intent |
| `R.getAll(sql, params)` | `prisma.$queryRaw` | Raw SQL preserved where needed |
| `R.find(table, where, params)` | `prisma.table.findMany({ where })` | |
| `R.getRow(sql, params)` | `prisma.$queryRaw` + `[0]` | |
| `R.trash(bean)` | `prisma.table.delete({ where: { id } })` | |
| `R.load(table, id)` | `prisma.table.findUnique({ where: { id } })` | |
| `R.exec(sql, params)` | `prisma.$executeRaw` | All 64 calls converted |
| `R.begin()` | `prisma.$transaction()` | API style completely different |

---

## 4. Model File Inventory (all converted to plain classes with Prisma queries)

| File | Lines | Complexity | Key methods / notes |
|---|---|---|---|
| server/model/monitor.js | 2107 | **Very High** | `toJSON`, `toPublicJSON`, `start`, `stop`, `beat`, `getTags`, `sendNotification`, `getUptimeCalculator`; mixes domain logic with ORM heavily |
| server/model/status_page.js | 585 | High | Status page rendering, slug lookup, incident association |
| server/model/maintenance.js | 506 | High | Cron/window scheduling, monitor association |
| server/model/domain_expiry.js | 368 | Medium-High | Certificate/domain expiry tracking |
| server/model/heartbeat.js | 84 | Medium | Heartbeat storage, per-monitor cleanup |
| server/model/api_key.js | 76 | Medium | Key hashing, active checks |
| server/model/user.js | 52 | Low | Password reset (`R.exec` lines 16 and 30), JWT creation |
| server/model/incident.js | 36 | Low | Status page incident CRUD |
| server/model/group.js | 49 | Low | Monitor group, status page association |
| server/model/proxy.js | 25 | Low | Proxy bean, no domain logic |
| server/model/docker_host.js | 19 | Low | Docker host bean, no domain logic |
| server/model/remote_browser.js | 17 | Low | Remote browser bean |
| server/model/tag.js | 17 | Low | `toJSON` uses `this._id`, `this._name`, `this._color` (redbean-node underscore convention) |

**monitor.js is the highest-risk single file** — 2107 lines, 40+ ORM calls, domain logic and
monitoring execution interleaved with ORM access.

---

## 5. Migration System (Knex retained)

### Two-tier migration history

1. **Legacy SQL patch files** — `Database.patchList`: ~35 named `.sql`
   files applied in dependency order.

2. **Knex migrations** — `db/knex_migrations/` — 49 files, JS-based, timestamped.
   Knex remains the sole migration tool. Prisma Migrate is not used.

The CI workflow (`validate.yml`) runs `node ./extra/check-knex-filenames.mjs` to validate migration
filename format.

### Knex migration runner

After migration, `Database.connect()` still uses Knex for running migrations. The Prisma Client
connects via the `better-sqlite3` driver adapter and `DATABASE_URL` env var. The two systems coexist
cleanly — Knex handles schema migrations, Prisma handles queries.

---

## 6. Database Provider Assumptions

The codebase supports three database configurations:

| Provider | Config key | Special handling |
|---|---|---|
| SQLite | `type: "sqlite"` | Uses `better-sqlite3` driver adapter with Prisma 7 |
| MariaDB (external) | `type: "mariadb"` | `mysql2` pool, `utf8mb4`, DATETIME typeCast shim |
| MariaDB (embedded) | `type: "embedded-mariadb"` | Same as above but via Unix socket |

**Resolution**: The Prisma migration uses `DATABASE_URL` env var (synced from `db-config.json` at startup
via `resolveDbUrl()` in `server/prisma.js`). The Prisma 7 driver adapter pattern (`PrismaBetterSqlite3`)
handles SQLite directly, bypassing the static schema limitation for the primary use case.

---

## 7. Prisma Suitability Analysis

### Where Prisma fits well

- Type-safe query building for straightforward CRUD (e.g., `monitor`, `user`, `tag`, `proxy` models)
- Schema-as-code for documentation and onboarding
- Generated client reduces hand-written SQL risk for simple queries

### Challenges encountered during migration

| Concern | How it was resolved |
|---|---|
| Runtime provider switching | `DATABASE_URL` env var synced from `db-config.json` at startup via `resolveDbUrl()` |
| Raw PRAGMA calls | Converted to `prisma.$executeRaw` with tagged templates; dialect guards preserved |
| `BeanModel` inheritance | All 13 model classes converted to plain classes with `constructor() { this.beanMeta = {}; }` |
| `R.store()` upsert semantics | Each of 40 call sites audited and converted to explicit `create`/`update` |
| `this._field` underscore convention | All underscore-prefixed accessors updated to direct property names |
| `R.autoloadModels()` | Removed; Prisma client is statically generated |
| Transaction API | `R.begin()` replaced with `prisma.$transaction()` callback pattern |

---

## 8. Key Risks and Incompatibilities (resolved)

### R.exec — 64 raw SQL calls

All 64 raw SQL calls were converted to `prisma.$executeRaw` with `Prisma.sql` tagged templates
or `prisma.$queryRaw`. PRAGMA calls are preserved with dialect-conditional execution paths.

### BeanModel class extension

All 13 model classes were converted from `class X extends BeanModel` to plain classes. Instance methods
(`toJSON`, `toPublicJSON`, `start`, `beat`, `sendNotification`, etc.) were preserved on the plain classes.
The `Object.assign(new Model(), row)` pattern is used where callers expect instance methods.

### Schema derivation

The schema was hand-derived from all 49 Knex migrations. 26 tables were defined in `prisma/schema.prisma`.
Key mapping: `proxy.default` column mapped as `isDefault` with `@map("default")` to avoid Prisma keyword conflict.

### `R.store()` insert-or-update ambiguity

All 40 `R.store()` call sites were audited. Each was converted to explicit `prisma.model.create` or
`prisma.model.update` based on the presence of `id`.

---

## 9. Decision Analysis (decisions made and implemented)

### JS-only Prisma vs TypeScript conversion

**DECISION: JS-only Prisma** ✅ Implemented.

The backend remains entirely JavaScript. Prisma is used with `@prisma/client` in JS mode.
Type safety is a secondary benefit that can be captured incrementally.

### Keep Knex migrations vs Prisma Migrate

**DECISION: Keep Knex migrations** ✅ Implemented.

Knex remains the sole migration tool. Prisma Migrate is not used. All 49 existing Knex migration
files are preserved and continue to run at startup.

### Introspection vs derived schema

**DECISION: Derive schema from migrations** ✅ Implemented.

The schema was hand-derived from all 49 Knex migrations. 26 tables defined in `prisma/schema.prisma`,
validated against integration tests.

### Adapter/wrapper vs direct replacement

**DECISION: Direct replacement (Option B)** ✅ Implemented.

Each model class was converted one at a time: `BeanModel` extension removed, Prisma client calls added,
all consuming files updated. The model-by-model approach worked well from leaf models to complex models.

---

## 10. Migration Strategy (completed)

The following phases were executed in order:

### Phase 0 — Schema derivation ✅
Schema hand-derived from all 49 Knex migrations. 26 tables defined in `prisma/schema.prisma`.

### Phase 1 — Install Prisma, co-exist with redbean-node ✅
Prisma installed alongside redbean-node. `server/prisma.js` singleton created with Prisma 7 driver adapter pattern.

### Phase 2 — Replace leaf models ✅
Order: `tag.js` → `docker_host.js` → `remote_browser.js` → `proxy.js` → `incident.js` → `group.js`

### Phase 3 — Replace utility/non-model calls ✅
`server/2fa.js`, `server/auth.js`, `server/jobs/clear-old-data.js`, `server/jobs/incremental-vacuum.js` and others.

### Phase 4 — Medium models ✅
`user.js`, `api_key.js`, `heartbeat.js`, `domain_expiry.js`

### Phase 5 — Heavy models ✅
`maintenance.js`, `status_page.js`, `monitor.js` — all converted. `monitor.js` was the last and most complex.

### Phase 6 — Remove redbean-node ✅ (deferred cleanup)
`R.setup`, `R.freeze`, `R.autoloadModels` removed from `database.js`. The `redbean-node` package remains
in `package.json` as a safety net but has zero active imports in production code paths.

---

## 11. Implementation Difficulty (actual outcomes)

| Dimension | Pre-migration Rating | Actual Outcome |
|---|---|---|
| Overall effort | **High** | Confirmed high — 44 files, 284 call sites converted |
| Schema derivation | **High** | Completed — 26 tables derived from 49 Knex migrations |
| monitor.js migration | **Very High** | Completed — most complex single file |
| PRAGMA handling | **High** | Resolved — dialect guards preserved with `prisma.$executeRaw` |
| Provider switching | **High** | Resolved — `DATABASE_URL` env var synced via `resolveDbUrl()` |
| `R.store()` audit | **Medium-High** | Completed — all 40 sites classified and converted |
| Leaf model migration | **Low-Medium** | Completed smoothly as predicted |
| Test coverage | **Medium** | 212/213 backend tests pass (1 pre-existing flaky MQTT timeout) |
| Regression risk | **High** | No data corruption observed; Docker build and startup verified |

---

## 12. Merge Blockers and Validation Requirements

### Hard blockers (all resolved)

1. ✅ **`schema.prisma` derived from migrations** — 26 tables, validated.

2. ✅ **Runtime provider switching** — `DATABASE_URL` env var populated at startup from `db-config.json`
   via `resolveDbUrl()` in `server/prisma.js`.

3. ✅ **PRAGMA calls dialect-guarded** — All PRAGMA calls use `prisma.$executeRaw` with tagged templates.

4. ✅ **`R.store()` audit complete** — All 40 call sites confirmed as insert or update.

5. ✅ **`BeanModel` underscore convention** — All `this._field` accessors updated to `this.field`.

### Validation results

- ✅ Backend tests: 212/213 pass (1 pre-existing flaky MQTT timeout unrelated to migration)
- ✅ Docker build succeeds
- ✅ App starts cleanly: "Connected to the database", "No user, need setup"
- ✅ `npm run lint` passes
