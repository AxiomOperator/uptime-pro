# Prisma Migration Checklist

Migration from `redbean-node` to Prisma ORM. Covers 44 files and 284 `R.` usages.

> **Status (2026-04-13):** All Critical, High, and Medium items are COMPLETE. Migration validated: 212/213 backend tests pass (1 pre-existing flaky MQTT timeout unrelated to migration). Docker build succeeds; app starts cleanly ("Connected to the database"). See `prisma-migration` branch.

---

## Critical

> These block everything else — must be done first.

- [x] **Install `prisma` (devDep) and `@prisma/client` (dep) via npm**
  Completed. Added `better-sqlite3` and `@prisma/adapter-better-sqlite3` as well (required by Prisma 7 driver adapter pattern).

- [x] **Run `npx prisma init --datasource-provider sqlite`**
  Completed. `.env` created with `DATABASE_URL=file:./data/kuma.db`.

- [x] **Derive and write `prisma/schema.prisma` covering all tables from 49 Knex migrations**
  Completed. 26 tables derived from all Knex migrations. Note: `proxy.default` column mapped as `isDefault` with `@map("default")` to avoid Prisma keyword conflict.

- [x] **Run `npx prisma generate` successfully**
  Completed. Client output to `server/generated/prisma/`.

- [x] **Create `server/prisma.js` PrismaClient singleton (JS, no TypeScript)**
  Completed. Uses Prisma 7 driver adapter pattern (`PrismaBetterSqlite3`). Exports `{ getPrisma, disconnectPrisma }`. Critical fix: `resolveDbUrl()` syncs `DATABASE_URL` env var for test isolation.

- [x] **Configure `prisma/schema.prisma` output path to `../server/generated/prisma`**
  Completed.

- [x] **Verify generated client imports work in a test file**
  Completed via server startup test (node server/server.js: "Connected to the database").

- [x] **Add `server/generated/` to `.gitignore`**
  Completed.

---

## High

> Model file migrations — each replaces redbean-node `BeanModel` usage with Prisma calls.

- [x] **Migrate `server/model/api_key.js`**
- [x] **Migrate `server/model/docker_host.js`**
- [x] **Migrate `server/model/domain_expiry.js`**
- [x] **Migrate `server/model/group.js`**
- [x] **Migrate `server/model/heartbeat.js`**
- [x] **Migrate `server/model/incident.js`**
- [x] **Migrate `server/model/maintenance.js`**
- [x] **Migrate `server/model/monitor.js`**
- [x] **Migrate `server/model/proxy.js`** — Note: `_default` field renamed to `isDefault` (@map("default"))
- [x] **Migrate `server/model/remote_browser.js`**
- [x] **Migrate `server/model/status_page.js`**
- [x] **Migrate `server/model/tag.js`**
- [x] **Migrate `server/model/user.js`**
- [x] **Remove `BeanModel` extends from each model file** — All model files converted to plain classes with `constructor() { this.beanMeta = {}; }` where needed.
- [x] **Replace all `R.store()` calls (40 total)** — Each site handled as explicit create or update based on presence of `id`.
- [x] **Replace all `R.findOne()` calls (55 total)**
- [x] **Replace all `R.find()` calls (18 total)**
- [x] **Replace all `R.exec()` calls (64 raw SQL)** — Replaced with `prisma.$executeRaw` tagged templates or `prisma.$queryRaw`.
- [x] **Replace all `R.getAll()` calls (22 total)**
- [x] **Replace all `R.getRow()` calls (6 total)**
- [x] **Replace all `R.trash()` calls (5 total)**

---

## Medium

> Non-model server files that import and use `R.` — migrate after models are stable.

- [x] **Migrate `server/auth.js`**
- [x] **Migrate `server/2fa.js`**
- [x] **Migrate `server/client.js`**
- [x] **Migrate `server/database.js`** — Removed R.setup()/R.freeze(); kept Knex for migrations. Added DATABASE_URL env sync for test isolation (critical fix).
- [x] **Migrate `server/docker.js`**
- [x] **Migrate `server/jobs/clear-old-data.js`**
- [x] **Migrate `server/jobs/incremental-vacuum.js`**
- [x] **Migrate `server/notification.js`**
- [x] **Migrate `server/prometheus.js`**
- [x] **Migrate `server/proxy.js`**
- [x] **Migrate `server/remote-browser.js`**
- [x] **Migrate `server/routers/api-router.js`**
- [x] **Migrate `server/routers/status-page-router.js`**
- [x] **Migrate `server/settings.js`**
- [x] **Migrate `server/socket-handlers/api-key-socket-handler.js`**
- [x] **Migrate `server/socket-handlers/maintenance-socket-handler.js`**
- [x] **Migrate `server/socket-handlers/status-page-socket-handler.js`**
- [x] **Migrate `server/uptime-calculator.js`**
- [x] **Migrate `server/uptime-kuma-server.js`**
- [x] **Migrate `server/util-server.js`**
- [x] **Migrate `server/monitor-types/dns.js`**
- [x] **Migrate `server/monitor-types/globalping.js`** — Note: dns() no longer accepts R param; test-globalping.js updated accordingly.
- [x] **Migrate transaction usage (`R.begin` in server code)** — Replaced with `prisma.$transaction()`.
- [x] **Update `server/server.js` redbean-node imports** — Removed top-level R setup; uses `./prisma` singleton.
- [x] **Verify app startup works after migration** — Docker container starts cleanly: "Connected to the database", "No user, need setup".

---

## Low

> Cleanup — do only after migration is verified working in a staging environment.

- [ ] **Remove `redbean-node` from `package.json` dependencies**
  Run `npm uninstall redbean-node`. Deferred until after merge validation — still in package.json as a safety net. Zero `R.` references remain in active production code paths.

- [ ] **Remove `redbean-node/dist/bean-model` imports from all files**
  All model files have already been converted to plain classes. Run one final `grep` pass to confirm no stale imports remain.

- [x] **Clean up any leftover `R` variable references**
  `grep -r "R\." server/` returns zero hits in active code after migration.

- [ ] **Update `prisma-migration-review.md` with actual findings**
  Document confirmed schema deviations: `proxy.isDefault` mapping, `beanMeta` constructor pattern, `R.store()` upsert ambiguity, Prisma 7 driver adapter requirement, DATABASE_URL env sync for test isolation.

- [x] **Document any behavior deviations found during migration**
  Key deviations documented in commit messages and technical notes: `proxy.default` → `isDefault`, `_fieldName` → `fieldName` for BeanModel private fields, tagged template requirement for `$queryRaw`/`$executeRaw`, empty-array guard for `Prisma.join()`.

---

## Future Enhancements

> Not required for the migration — consider after the codebase is stable on Prisma.

- [ ] **Add PostgreSQL provider to `schema.prisma` (now unblocked by Prisma)**
  Prisma's multi-provider support makes this straightforward. Add a `postgresql` datasource block and test with a Postgres instance. This was not feasible with redbean-node's SQLite-first design.

- [ ] **Consider replacing Knex migrations with Prisma Migrate**
  Once the schema in `prisma/schema.prisma` is verified as authoritative, evaluate switching from `db/knex_migrations/` to `prisma migrate`. Reduces tooling surface area but requires a migration history baseline.

- [ ] **Add Prisma-generated TypeScript types to model layer**
  The generated client exports full TypeScript types for every model. Gradually adopt these in `server/model/` files to catch shape mismatches at compile time rather than runtime.

- [ ] **Enable Prisma query logging for observability**
  Pass `log: ['query', 'warn', 'error']` to `new PrismaClient()` in `server/prisma.js` (behind a `DEBUG` env flag). Helps identify N+1 queries introduced during migration.
