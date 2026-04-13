# Prisma Migration Checklist

Migration from `redbean-node` to Prisma ORM. Covers 44 files and 284 `R.` usages.

---

## Critical

> These block everything else — must be done first.

- [ ] **Install `prisma` (devDep) and `@prisma/client` (dep) via npm**
  Run `npm install --save-dev prisma && npm install @prisma/client`. Without these packages, no Prisma tooling or generated client is available.

- [ ] **Run `npx prisma init --datasource-provider sqlite`**
  Scaffolds `prisma/schema.prisma` and sets `DATABASE_URL` in `.env`. Must match the SQLite path used by the existing app (`data/kuma.db`).

- [ ] **Derive and write `prisma/schema.prisma` covering all tables from 49 Knex migrations**
  Read all files in `db/knex_migrations/` in order to reconstruct every table, column, type, default, and relation accurately. This is the source of truth for the generated client — gaps here cause runtime failures.

- [ ] **Run `npx prisma generate` successfully**
  Generates the typed PrismaClient under the configured output path. Nothing downstream compiles or runs until this succeeds cleanly.

- [ ] **Create `server/prisma.js` PrismaClient singleton (JS, no TypeScript)**
  A single shared instance prevents connection pool exhaustion. All model and service files will import from this one file. Keep it plain JS to match the rest of the server codebase.

- [ ] **Configure `prisma/schema.prisma` output path to `../server/generated/prisma`**
  Add `output = "../server/generated/prisma"` to the `generator client` block so the generated client lives inside `server/` and can be imported with a short relative path from any server file.

- [ ] **Verify generated client imports work in a test file**
  Write a minimal `server/prisma-smoke.js` that imports `{ PrismaClient }` from the generated path and instantiates it. Confirms the output path and generation step are correct before touching any production code.

- [ ] **Add `server/generated/` to `.gitignore`**
  Generated files must not be committed. Add the entry to `.gitignore` immediately after `npx prisma generate` first succeeds, before any other changes land.

---

## High

> Model file migrations — each replaces redbean-node `BeanModel` usage with Prisma calls.

- [ ] **Migrate `server/model/api_key.js`**
  Extends `BeanModel`. Handles API key creation and lookup. Replace `R.store()` / `R.findOne()` with `prisma.apiKey.create()` / `prisma.apiKey.findFirst()`. Ensures API authentication continues to work.

- [ ] **Migrate `server/model/docker_host.js`**
  Extends `BeanModel`. Manages Docker host records used by Docker container monitors. Replace CRUD calls; verify foreign-key relations to `monitor` table are preserved.

- [ ] **Migrate `server/model/domain_expiry.js`**
  Extends `BeanModel`. Stores domain certificate/expiry data. Replace `R.store()` / `R.findOne()` with equivalent Prisma upsert or create/findFirst calls.

- [ ] **Migrate `server/model/group.js`**
  Extends `BeanModel`. Represents monitor groups in the status page. Lightweight model — replace store/find calls and verify group ordering is maintained.

- [ ] **Migrate `server/model/heartbeat.js`**
  Extends `BeanModel`. The most frequently written model — every monitor check produces a heartbeat row. Replace `R.store()` (high volume) with `prisma.heartbeat.create()`. Performance-sensitive: test write throughput.

- [ ] **Migrate `server/model/incident.js`**
  Extends `BeanModel`. Tracks status-page incidents. Replace store/find calls; incident creation and resolution flows both touch this model.

- [ ] **Migrate `server/model/maintenance.js`**
  Extends `BeanModel`. Complex model with relations to monitors and status pages. Replace all `R.` calls; verify maintenance window scheduling logic is unaffected.

- [ ] **Migrate `server/model/monitor.js`**
  Extends `BeanModel`. Central model — nearly every feature touches it. Replace `R.store()`, `R.findOne()`, `R.find()`, and raw `R.exec()` calls. Highest risk of regressions; test thoroughly.

- [ ] **Migrate `server/model/proxy.js`**
  Extends `BeanModel`. Stores proxy configuration used by HTTP monitors. Replace CRUD calls; verify proxy assignment to monitors still works.

- [ ] **Migrate `server/model/remote_browser.js`**
  Extends `BeanModel`. Manages remote browser endpoints for browser-based monitors. Replace store/find calls.

- [ ] **Migrate `server/model/status_page.js`**
  Extends `BeanModel`. Drives the public status page — slug lookups and page config. Replace `R.findOne()` (slug queries are critical) with `prisma.statusPage.findFirst()`.

- [ ] **Migrate `server/model/tag.js`**
  Extends `BeanModel`. Stores monitor tags. Replace store/find calls; verify tag-monitor join table operations.

- [ ] **Migrate `server/model/user.js`**
  Extends `BeanModel`. Core authentication model. Replace `R.findOne()` (login), `R.store()` (register/update). Any regression here breaks all authenticated access.

- [ ] **Remove `BeanModel` extends from each model file**
  After each model is migrated, remove `extends BeanModel` and the `redbean-node/dist/bean-model` import. Leaving stale extends causes silent mixin pollution from the old ORM.

- [ ] **Replace all `R.store()` calls (40 total)**
  Map each to the appropriate `prisma.<model>.create()` or `prisma.<model>.update()`. `R.store()` is overloaded (insert or update by presence of `id`) — determine intent at each call site.

- [ ] **Replace all `R.findOne()` calls (55 total)**
  Replace with `prisma.<model>.findFirst({ where: { ... } })`. The highest-count method — each call site needs its `where` clause explicitly reconstructed from the original SQL fragment passed to `R.findOne()`.

- [ ] **Replace all `R.find()` calls (18 total)**
  Replace with `prisma.<model>.findMany({ where: { ... } })`. Verify ordering and filtering match the original SQL fragments.

- [ ] **Replace all `R.exec()` calls (64 raw SQL — each needs careful mapping)**
  The riskiest category. Each raw SQL string must be read, understood, and replaced with the correct Prisma query or a `prisma.$queryRaw` tagged template. Prioritize correctness over terseness — 64 sites across model and server files.

- [ ] **Replace all `R.getAll()` calls (22 total)**
  Returns arrays of plain objects from raw SQL. Replace with `prisma.$queryRaw` or a typed `prisma.<model>.findMany()` where the query maps cleanly to a model.

- [ ] **Replace all `R.getRow()` calls (6 total)**
  Returns a single plain-object row. Replace with `prisma.$queryRaw` (first result) or `prisma.<model>.findFirst()`.

- [ ] **Replace all `R.trash()` calls (5 total)**
  Deletes a bean by primary key. Replace with `prisma.<model>.delete({ where: { id: ... } })`. Confirm no soft-delete logic is hidden behind `R.trash()` in any model hook.

---

## Medium

> Non-model server files that import and use `R.` — migrate after models are stable.

- [ ] **Migrate `server/auth.js`**
  Uses `R.` for user lookup during authentication. Depends on `server/model/user.js` being migrated first. Replace `R.findOne()` calls with `prisma.user.findFirst()`.

- [ ] **Migrate `server/2fa.js`**
  Uses `R.` to read/write two-factor auth secrets on the user record. Replace with direct Prisma user update/findFirst calls.

- [ ] **Migrate `server/client.js`**
  Uses `R.` for data queries sent to the frontend over Socket.IO. Replace queries; verify serialization shape matches what the Vue frontend expects.

- [ ] **Migrate `server/database.js`**
  Remove `R.setup()`, `R.freeze()`, and the redbean-node connection setup. **Keep Knex** for running `db/knex_migrations/` — Knex migrations remain the schema authority until a Prisma Migrate strategy is decided. This file is the bootstrap point; regressions here prevent server startup.

- [ ] **Migrate `server/docker.js`**
  Uses `R.` to read Docker host records. Replace with `prisma.dockerHost.findFirst()` / `prisma.dockerHost.findMany()`.

- [ ] **Migrate `server/jobs/clear-old-data.js`**
  Scheduled job that deletes old heartbeats and events. Replace `R.exec()` / `R.trash()` with `prisma.heartbeat.deleteMany({ where: { ... } })`. Correctness matters — over-deletion loses history.

- [ ] **Migrate `server/jobs/incremental-vacuum.js`**
  Runs SQLite `PRAGMA incremental_vacuum`. Uses `R.exec()` for a raw pragma — replace with `prisma.$executeRaw\`PRAGMA incremental_vacuum\``.

- [ ] **Migrate `server/notification.js`**
  Uses `R.` to load notification provider configs. Replace with `prisma.notification.findMany()` / `prisma.notification.findFirst()`.

- [ ] **Migrate `server/prometheus.js`**
  Reads monitor and heartbeat data for Prometheus metrics. Replace `R.getAll()` / `R.findOne()` with Prisma queries; verify metric label cardinality is unchanged.

- [ ] **Migrate `server/proxy.js`**
  Loads and caches proxy configurations. Replace `R.find()` with `prisma.proxy.findMany()`.

- [ ] **Migrate `server/remote-browser.js`**
  Reads remote browser endpoint records. Replace `R.findOne()` / `R.find()` with Prisma equivalents.

- [ ] **Migrate `server/routers/api-router.js`**
  REST API router — uses `R.` for resource lookups and writes. Replace each call with the appropriate Prisma query; API response shapes must remain backward-compatible.

- [ ] **Migrate `server/routers/status-page-router.js`**
  Public status page router — uses `R.` to look up pages by slug. Replace `R.findOne()` with `prisma.statusPage.findFirst({ where: { slug } })`. Slug lookup is user-facing — any regression is immediately visible.

- [ ] **Migrate `server/settings.js`**
  Reads/writes the `setting` key-value table via `R.`. Replace with `prisma.setting.findFirst()` / `prisma.setting.upsert()`. Settings are read at every startup and on many socket events.

- [ ] **Migrate `server/socket-handlers/api-key-socket-handler.js`**
  Socket.IO handler for API key management. Replace `R.store()` / `R.findOne()` / `R.trash()` with Prisma create/findFirst/delete.

- [ ] **Migrate `server/socket-handlers/maintenance-socket-handler.js`**
  Socket.IO handler for maintenance window CRUD. Complex multi-table writes — replace carefully and test maintenance window creation/deletion end-to-end.

- [ ] **Migrate `server/socket-handlers/status-page-socket-handler.js`**
  Socket.IO handler for status page configuration. Uses `R.` for page, group, and monitor-group joins. Replace and verify the status page editor still saves correctly.

- [ ] **Migrate `server/uptime-calculator.js`**
  Queries heartbeat aggregates for uptime ratio calculations. Uses `R.getAll()` / `R.getRow()` with date-range SQL. Replace with `prisma.$queryRaw` or `prisma.heartbeat.aggregate()` — verify ratios are numerically identical.

- [ ] **Migrate `server/uptime-kuma-server.js`**
  Main server class — orchestrates monitor loading, socket broadcasting, and startup. Uses `R.` broadly. Migrate after all model files are done; this file is the integration point.

- [ ] **Migrate `server/util-server.js`**
  Utility functions that issue `R.` queries (e.g., certificate expiry helpers). Replace with Prisma queries; keep function signatures identical so callers need no changes.

- [ ] **Migrate `server/monitor-types/dns.js`**
  DNS monitor type implementation. Uses `R.` for result storage. Replace with `prisma.heartbeat.create()` or equivalent.

- [ ] **Migrate `server/monitor-types/globalping.js`**
  Globalping monitor type. Uses `R.` for result storage. Replace with Prisma create call; verify result schema matches heartbeat table columns.

- [ ] **Migrate transaction usage (`R.begin` in server code)**
  Identify every `R.begin()` / `R.commit()` / `R.rollback()` call site. Replace with `prisma.$transaction([...])` (array form) or `prisma.$transaction(async (tx) => { ... })` (interactive form). Transaction boundaries must be preserved exactly — partial writes cause data integrity issues.

- [ ] **Update `server/server.js` redbean-node imports**
  Remove the top-level `require('redbean-node')` and any `R` alias setup. Replace with `require('./prisma')` singleton import. This is the entry point — a bad import here crashes startup.

- [ ] **Verify app startup works after migration**
  Run `node server/server.js` (or `npm run dev`) and confirm: database connects, all monitors load, Socket.IO accepts connections, and the status page renders. Fix any import or query errors surfaced here.

---

## Low

> Cleanup — do only after migration is verified working in a staging environment.

- [ ] **Remove `redbean-node` from `package.json` dependencies**
  Run `npm uninstall redbean-node`. Removing it before migration is complete will break the app. Only safe once zero `R.` references remain in production code paths.

- [ ] **Remove `redbean-node/dist/bean-model` imports from all files**
  Search for `require('redbean-node/dist/bean-model')` and `from 'redbean-node/dist/bean-model'` across the codebase. All such imports become dead code once model files no longer extend `BeanModel`.

- [ ] **Clean up any leftover `R` variable references**
  Run `grep -r '\bR\.' server/` after the migration. Any remaining hits are either missed migrations or false positives (log formatters, etc.) — resolve each one.

- [ ] **Update `prisma-migration-review.md` with actual findings**
  Document schema deviations discovered during migration, any `R.exec()` queries that required `prisma.$queryRaw`, and performance notes from high-volume paths (heartbeat writes, uptime calculations).

- [ ] **Document any behavior deviations found during migration**
  If any Prisma query returns data in a different shape or order than the equivalent redbean-node call, document the deviation and the fix. Future developers need this context if bugs surface post-migration.

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
