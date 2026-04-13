# Prisma Migration Review — Uptime Kuma (`prisma-migration` branch)

_Generated from direct inspection of the `prisma-migration` branch._

---

## 1. Executive Summary

Replacing `redbean-node` with Prisma is a **high-effort, high-risk migration** that touches 44 source files
and 284 discrete ORM method call sites across the backend. The core challenge is not Prisma itself — it is
that the existing codebase is built around an Active Record pattern (`BeanModel`) with loosely typed,
convention-driven table access, heavy raw SQL (`R.exec`: 64 calls), and a multi-dialect database setup
(SQLite, MariaDB, Embedded MariaDB) that Prisma handles differently from Knex. This document captures the
current state, the decision analysis, and a recommended incremental strategy.

---

## 2. Current ORM Architecture

### Knex + redbean-node layering

`server/database.js` line 372–384 shows the initialization chain:

```js
const knexInstance = knex(config);   // line 372 — Knex configured for sqlite/mysql2
R.setup(knexInstance);               // line 374 — redbean-node wraps the Knex instance
R.freeze(true);                      // line 381 — disables auto table-creation
R.autoloadModels("./server/model");  // line 384 — discovers all BeanModel subclasses
```

redbean-node is therefore **a thin Active Record layer on top of Knex**, not a standalone ORM driver.
Removing it means replacing both the query API _and_ the object-mapping layer in one shot.

### Multi-dialect support

`Database.connect()` (lines 257–361) builds different Knex configs for three database back ends:

| Back end | Knex client | Notes |
|---|---|---|
| SQLite | Custom `@louislam/sqlite3` Dialect | WAL mode, PRAGMA-heavy init |
| MariaDB (external) | `mysql2` | Pool config, utf8mb4 charset |
| MariaDB (embedded) | `mysql2` | Unix socket path |

The custom SQLite dialect (`KumaColumnCompiler`, `@louislam/sqlite3`) and the `typeCast` shim for
MariaDB DATETIME fields (lines 323–327, 350–354) are both custom workarounds that have no equivalent
in Prisma's built-in connectors.

### Active Record model pattern

Every model extends `BeanModel` from `redbean-node/dist/bean-model`:

```js
// server/model/monitor.js line 47-48
const { BeanModel } = require("redbean-node/dist/bean-model");
class Monitor extends BeanModel { ... }

// server/model/user.js line 1
const { BeanModel } = require("redbean-node/dist/bean-model");
class User extends BeanModel { ... }

// server/model/tag.js line 1
const { BeanModel } = require("redbean-node/dist/bean-model");
class Tag extends BeanModel { ... }
```

`BeanModel` provides implicit property access mapped to database columns (no schema declaration needed).
`Tag.toJSON()` (tag.js lines 8–14) accesses `this._id`, `this._name`, `this._color` — the underscore
prefix is a redbean-node convention for raw column values. Prisma has no equivalent; all field access
must be explicitly declared in `schema.prisma`.

---

## 3. All redbean-node Usage Locations

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

### Method-to-Prisma mapping

| redbean-node | Prisma equivalent | Notes |
|---|---|---|
| `R.findOne(table, where, params)` | `prisma.table.findFirst({ where })` | Param style changes from `?` to object |
| `R.store(bean)` | `prisma.table.upsert / create / update` | Requires knowing create vs update intent |
| `R.getAll(sql, params)` | `prisma.$queryRaw` | Only for raw SQL usage |
| `R.find(table, where, params)` | `prisma.table.findMany({ where })` | |
| `R.getRow(sql, params)` | `prisma.$queryRaw` + `[0]` | |
| `R.trash(bean)` | `prisma.table.delete({ where: { id } })` | |
| `R.load(table, id)` | `prisma.table.findUnique({ where: { id } })` | |
| `R.exec(sql, params)` | `prisma.$executeRaw` | **64 calls — biggest risk** |
| `R.begin()` | `prisma.$transaction()` | API style completely different |

---

## 4. Model File Inventory

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

## 5. Current Migration System

### Two-tier migration history

1. **Legacy SQL patch files** — `Database.patchList` (`database.js` lines 71–116): ~35 named `.sql`
   files applied in dependency order. The last one converted is `patch-monitor-tls-info-add-fk.sql`
   (line 115 comment: _"The last file so far converted to a knex migration file"_).

2. **Knex migrations** — `db/knex_migrations/` — 49 files, JS-based, timestamped:
   - Earliest: `2023-08-16-0000-create-uptime.js`
   - Latest: `2025-03-04-0000-ping-advanced-options.js`
   - Run via `Database.knexMigrationsPath = "./db/knex_migrations"` (line 128)

The CI workflow (`validate.yml`) runs `node ./extra/check-knex-filenames.mjs` to validate migration
filename format. Any Prisma migration files must not break this validation or must be excluded from it.

### Knex migration runner

`Database.connect()` calls `R.setup(knexInstance)` — the same Knex instance is reused for both
the ORM and migration running. There is no separate migration runner process.

---

## 6. Database Provider Assumptions

The codebase explicitly supports three database configurations (`database.js` lines 257–361):

| Provider | Config key | Special handling |
|---|---|---|
| SQLite | `type: "sqlite"` | Custom `@louislam/sqlite3` driver, PRAGMA init per connection, WAL mode |
| MariaDB (external) | `type: "mariadb"` | `mysql2` pool, `utf8mb4`, DATETIME typeCast shim |
| MariaDB (embedded) | `type: "embedded-mariadb"` | Same as above but via Unix socket |

**Prisma implication**: Prisma requires a separate `datasource` block per provider and does not support
switching providers at runtime from a config file. The current runtime-switchable `db-config.json`
pattern (`Database.readDBConfig()` line 170) is fundamentally incompatible with Prisma's static schema
approach. This is a **top-tier architectural blocker**.

The custom SQLite driver (`@louislam/sqlite3`) enables WAL mode and custom PRAGMA settings per-connection
via the `afterCreate` pool hook (lines 279–284). Prisma's SQLite connector does not expose per-connection
PRAGMA hooks.

---

## 7. Prisma Suitability Analysis

### Where Prisma fits well

- Type-safe query building for straightforward CRUD (e.g., `monitor`, `user`, `tag`, `proxy` models)
- Schema-as-code for documentation and onboarding
- Generated client reduces hand-written SQL risk for simple queries

### Where Prisma fits poorly for this codebase

| Concern | Detail |
|---|---|
| Runtime provider switching | Prisma schema is static; `db-config.json` allows SQLite/MariaDB choice at startup |
| Raw PRAGMA calls | 18+ `R.exec("PRAGMA ...")` calls have no safe Prisma abstraction |
| Embedded MariaDB socket path | Prisma datasource URLs are static strings or env vars, not dynamic socket paths |
| `BeanModel` inheritance | 13 model classes inherit `BeanModel`; Prisma has no class-based Active Record |
| `R.store()` upsert semantics | redbean-node auto-detects insert vs update; Prisma requires explicit `create`/`update`/`upsert` with `where` |
| `this._field` underscore convention | Used in `tag.js` (lines 10–12); no equivalent in Prisma result objects |
| `R.autoloadModels()` | Auto-discovers classes from directory; Prisma client is statically generated |
| Transaction API | `R.begin()` is implicit/callback; `prisma.$transaction()` requires wrapping entire callback scope |

---

## 8. Key Risks and Incompatibilities

### R.exec — 64 raw SQL calls (highest risk)

Raw SQL calls span critical paths:

- `server/model/user.js` lines 16, 30: `UPDATE \`user\` SET password = ? WHERE id = ?`
- `server/2fa.js` line 10: `UPDATE \`user\` SET twofa_status = 0`
- `server/auth.js` line 25: password update on login
- `server/database.js` lines 464, 473: `PRAGMA foreign_keys = OFF/ON` (SQLite integrity maintenance)
- `server/database.js` line 719: dynamic statement execution during patching
- `server/database.js` line 737: `PRAGMA wal_checkpoint(TRUNCATE)`
- `server/database.js` line 776: `VACUUM`
- `server/jobs/clear-old-data.js` lines 44, 49, 52: bulk DELETE + `PRAGMA optimize`
- `server/jobs/incremental-vacuum.js` lines 18–19: `PRAGMA incremental_vacuum` + `wal_checkpoint`
- `server/model/monitor.js` lines 1309, 1608: INSERT + UPDATE

PRAGMA calls **cannot** be safely replaced with `prisma.$executeRaw` on MariaDB (they are SQLite-only).
Any Prisma migration must preserve the dialect-conditional PRAGMA execution path.

### BeanModel class extension

All 13 model classes use `class X extends BeanModel`. Prisma returns plain objects, not class instances.
Every method defined on these model classes (`toJSON`, `toPublicJSON`, `start`, `beat`, `sendNotification`,
etc.) would need to be extracted to plain functions or service classes. In `monitor.js` alone this
represents ~2000 lines of interleaved ORM + domain logic that cannot be mechanically refactored.

### No database to introspect

The app is in first-run state — no `data/kuma.db` exists. `prisma db pull` cannot be used. The schema
must be **derived from the 49 Knex migrations + legacy SQL patches**. This is a one-time manual effort
with significant risk of missed columns or wrong types.

### Dynamic model registration

`R.autoloadModels("./server/model")` (line 384) scans the directory at runtime. Prisma's generated client
is static. Any new model file added during development must also be reflected in `schema.prisma` and
regenerated — this changes the contribution workflow.

### `R.store()` insert-or-update ambiguity

`R.store(bean)` checks `bean.id` to decide insert vs update. There are 40 call sites where this implicit
behavior is relied upon. Each must be audited individually to determine which Prisma operation is correct,
since `prisma.table.upsert` has different semantics (requires explicit `where` + `create` + `update`
blocks).

---

## 9. Decision Analysis

### JS-only Prisma vs TypeScript conversion

**DECISION: JS-only Prisma**

The backend is entirely JavaScript (except `src/util.ts` which is a standalone util file). Converting
to TypeScript to use Prisma's full type-safety would double the migration scope and introduce type errors
across all 44 affected files. `npm run tsc` already reports 1400+ errors on the current codebase.
Use Prisma with `@prisma/client` in JS mode (`prismaClient.js` pattern, no `.d.ts` required in calling
code). Type safety is a secondary benefit that can be captured incrementally.

### Keep Knex migrations vs Prisma Migrate

**DECISION: Keep Knex migrations**

There are 49 existing Knex migration files with CI validation (`check-knex-filenames.mjs`). Production
deployments already have migration history tracked in the `knex_migrations` table. Switching to
`prisma migrate` would require a one-time migration history reconciliation for all existing deployments,
with no rollback path. Prisma's `prisma migrate --schema-only` (baseline) process is error-prone when
the schema was not originally authored in Prisma. **Keep Knex for all new migrations; use Prisma client
only for queries.**

### Introspection vs derived schema

**DECISION: Derive schema from migrations**

No database file exists. `prisma db pull` is unavailable. The schema must be hand-derived by reading all
49 Knex migrations plus the `Database.patchList` SQL files in order. This should be treated as a
**separate tracked task** with column-by-column review, not assumed correct until integration tests pass.

### Adapter/wrapper vs direct replacement

**Option A — Adapter/wrapper layer**

Write a thin compatibility shim that exposes `R.findOne`, `R.store`, `R.exec`, etc., implemented on top
of `prisma.$queryRaw` / `prisma.$executeRaw` / explicit Prisma client calls. This allows incremental
migration without touching call sites immediately.

- _Pros_: Low initial risk; existing tests remain green; can be done per-method; enables side-by-side
  validation.
- _Cons_: Perpetuates the redbean-node API shape; `R.store()` upsert ambiguity is hard to shim correctly;
  PRAGMA handling still requires dialect branching; does not deliver Prisma's type safety.

**Option B — Direct replacement (model by model)**

Replace each model class one at a time: remove `BeanModel` extension, add Prisma client calls, migrate
domain methods to plain functions or service classes.

- _Pros_: Clean result; delivers type safety and Prisma schema accuracy per model; testable in isolation.
- _Cons_: Each model requires call-site updates in all consuming files; `monitor.js` (2107 lines) is
  particularly high effort; cannot be safely feature-flagged without significant scaffolding.

**Recommendation**: Start with Option A for non-model files and leaf models (tag, user, docker_host,
remote_browser, proxy) to validate the Prisma schema is correct, then apply Option B to progressively
replace heavier models.

---

## 10. Recommended Migration Strategy

### Phase 0 — Schema derivation (prerequisite, not optional)

1. Run all 49 Knex migrations + legacy SQL patches against a fresh SQLite database.
2. Run `prisma db pull` against that database to generate an initial `schema.prisma`.
3. Manually review every table and column against the Knex migration history.
4. Add all `@relation` directives, `@id`, `@default`, `@map` annotations.
5. Commit `schema.prisma` as a standalone PR before any code changes.

### Phase 1 — Install Prisma, co-exist with redbean-node

1. `npm install @prisma/client && npm install -D prisma`
2. Add `prisma generate` to the build script.
3. Instantiate `PrismaClient` in `server/database.js` alongside existing `R.setup()`.
4. Do not remove `redbean-node` yet.

### Phase 2 — Replace leaf models (low complexity, validates schema)

Order: `tag.js` → `docker_host.js` → `remote_browser.js` → `proxy.js` → `incident.js` → `group.js`

For each:
- Remove `BeanModel` extension.
- Replace `R.*` calls with Prisma client calls.
- Update all consuming files.
- Run backend tests after each model.

### Phase 3 — Replace utility/non-model R.exec calls

Target `server/2fa.js`, `server/auth.js`, `server/jobs/clear-old-data.js`,
`server/jobs/incremental-vacuum.js`. Keep PRAGMA calls behind a SQLite dialect guard — do not replace
them with `prisma.$executeRaw` unconditionally.

### Phase 4 — Medium models

`user.js`, `api_key.js`, `heartbeat.js`, `domain_expiry.js`

### Phase 5 — Heavy models (high risk, requires dedicated sprint)

`maintenance.js` (506 lines), `status_page.js` (585 lines), `monitor.js` (2107 lines)

`monitor.js` should be the last file migrated. It contains monitoring execution logic interleaved with
ORM calls at lines 440, 576, 833, 1099, 1293, 1309, 1325, 1387, 1401, 1521, 1561, 1579, 1608, 1622,
1812, 1828, 1927, 1944, 2003, 2022, 2033 — each of which must be individually audited.

### Phase 6 — Remove redbean-node

Only after all 44 files have been migrated and all tests pass. Remove `R.setup`, `R.freeze`,
`R.autoloadModels` from `database.js`. Remove `redbean-node` from `package.json`.

---

## 11. Implementation Difficulty and Risk Assessment

| Dimension | Rating | Rationale |
|---|---|---|
| Overall effort | **High** | 44 files, 284 call sites, 2107-line monitor model |
| Schema derivation | **High** | No existing DB; 49 migrations + legacy patches; manual review required |
| monitor.js migration | **Very High** | Domain logic and ORM entangled across 2107 lines |
| PRAGMA handling | **High** | 18+ SQLite-only calls; must remain dialect-conditional |
| Provider switching | **High** | `db-config.json` runtime switching is incompatible with Prisma static schema |
| R.store() audit | **Medium-High** | 40 sites; each must be classified as insert/update/upsert |
| Leaf model migration | **Low-Medium** | tag, docker_host, proxy: 15–25 lines each, straightforward |
| Test coverage risk | **Medium** | Backend tests exist but no E2E coverage for all ORM paths |
| Regression risk | **High** | Any missed `R.store` insert-vs-update misclassification silently corrupts data |

**Honest assessment**: This is a multi-sprint migration. Treating it as a single PR is not viable.
The `prisma-migration` branch should be restructured as a series of focused PRs following the phased
approach above, each individually reviewable and revertable.

---

## 12. Merge Blockers and Validation Requirements

### Hard blockers (must be resolved before any merge to master)

1. **No `schema.prisma` derived from migrations** — the schema must be correct before any query
   migration is attempted. A wrong type on a single column causes silent data corruption.

2. **Runtime provider switching** — `db-config.json` selects SQLite vs MariaDB at startup.
   A Prisma migration must either maintain this capability (via `DATABASE_URL` env var populated
   at startup from `db-config.json`) or explicitly drop MariaDB support. The current branch must
   state which approach is taken.

3. **PRAGMA calls not dialect-guarded** — any `prisma.$executeRaw("PRAGMA ...")` that runs
   against MariaDB will throw. All PRAGMA calls must be wrapped in `if (dbConfig.type === "sqlite")`.

4. **`R.store()` audit incomplete** — each of the 40 `R.store` call sites must be confirmed as
   insert, update, or upsert before replacing with Prisma equivalents.

5. **`BeanModel` underscore convention** — `tag.js` `this._id`, `this._name`, `this._color` (lines 10–12)
   must be updated to use Prisma result field names before `Tag` is migrated.

### Validation requirements

- All existing backend tests (`npm run test-backend`) must pass with zero regressions.
- E2E Playwright tests (`npm test`) must pass for the full monitor CRUD flow.
- Manual smoke test: first-run setup wizard must complete successfully for both SQLite and MariaDB.
- Database migration from a pre-existing Knex-managed database must succeed without data loss.
- `npm run lint:prod` must pass (zero warnings) — Prisma introduces new imports that must be JSDoc'd
  per `.eslintrc.js` requirements.
