# Prisma Cutover Checklist

Track the completion of the redbean-node → Prisma migration. Items are organized by priority.

---

## Critical — Migration Foundation

- [x] Install Prisma 7 and configure `prisma/schema.prisma` (26 models)
- [x] Configure better-sqlite3 driver adapter (`@prisma/adapter-better-sqlite3`)
- [x] Generate Prisma client to `server/generated/prisma/`
- [x] Create PrismaClient singleton in `server/prisma.js` (`getPrisma()` / `disconnectPrisma()`)
- [x] Configure `prisma.config.ts` and `.env` with DATABASE_URL
- [x] Preserve Knex as the schema migration authority (`db/knex_migrations/`, 49 migrations)

## High — Core Server Migration

- [x] Migrate all 13 model files from R. to Prisma (`server/model/*.js`)
- [x] Migrate `server/server.js` from R. to Prisma (136 bean variable refs remain as naming only)
- [x] Migrate `server/uptime-kuma-server.js` from R. to Prisma
- [x] Migrate all 10 socket handlers from R. to Prisma (`server/socket-handlers/`)
- [x] Migrate both routers from R. to Prisma (`server/routers/`)
- [x] Migrate utility files: `uptime-calculator.js`, `notification.js`, `proxy.js`, `settings.js`, `remote-browser.js`
- [x] Fix boolean type mapping — Prisma returns `true`/`false` vs SQLite `0`/`1`:
  - [x] `twofa_status` (User)
  - [x] `is_default` / `isDefault` (Notification, Proxy)
  - [x] `upside_down` (Monitor — via `isUpsideDown()` wrapper)
  - [x] `active` fields (Monitor, Maintenance, User, ApiKey)
- [x] Fix Dockerfile to remove upstream base image references (commit `1cc12436`)

## Medium — Schema and Naming

- [ ] Convert schema field names to camelCase with `@map("snake_case_column")` annotations
  - [ ] User model fields
  - [ ] Monitor model fields (107 fields)
  - [ ] Heartbeat model fields
  - [ ] Notification model fields
  - [ ] Maintenance model fields
  - [ ] StatusPage model fields
  - [ ] All remaining models
- [ ] Rename all `bean` variables throughout codebase (~479 references in 14 files)
  - [ ] `server/server.js` (136 refs)
  - [ ] `server/model/monitor.js` (100 refs)
  - [ ] `server/routers/api-router.js` (51 refs)
  - [ ] `server/uptime-calculator.js` (42 refs)
  - [ ] `server/socket-handlers/maintenance-socket-handler.js` (42 refs)
  - [ ] `server/model/maintenance.js` (28 refs)
  - [ ] `server/socket-handlers/status-page-socket-handler.js` (17 refs)
  - [ ] `server/model/domain_expiry.js` (14 refs)
  - [ ] `server/remote-browser.js` (12 refs)
  - [ ] Remaining 5 files (~37 refs total)
- [ ] Rename `beanMeta` to `_meta` (non-enumerable) in `server/model/maintenance.js` (18 refs)

## Low — Peripheral Code Migration

- [ ] Rewrite `extra/remove-2fa.js` from R. to Prisma (1 R.findOne call)
- [ ] Rewrite `extra/reset-password.js` from R. to Prisma (1 R.findOne call)
- [ ] Rewrite `extra/reset-migrate-aggregate-table-state.js` from R. to Prisma (3 R.exec calls)
- [ ] Rewrite `test/backend-test/test-domain.js` from R. to Prisma (1 R.findOne call)
- [ ] Rewrite `test/backend-test/test-migration.js` from R. to Prisma/Knex (9 R. refs)
- [ ] Migrate `db/knex_init_db.js` MariaDB init from R.knex to direct Knex (1 ref)
- [ ] Update JSDoc `@param {Bean}` / `@param {Heartbeat} bean` annotations (6 occurrences in 4 files)

## Cleanup — Remove Redbean Vestiges

- [ ] Remove `redbean-node` from `package.json` dependencies
- [ ] Run `npm ci` to verify clean dependency tree without redbean-node
- [ ] Remove any remaining `require("redbean-node")` statements
- [ ] Clean `bean`/`redbean` references from project documentation
- [ ] Remove migration planning files no longer needed:
  - [ ] `prisma-migration-checklist.md`
  - [ ] `prisma-migration-plan.md`
  - [ ] `prisma-migration-review.md`
  - [ ] `prisma-migration-test-plan.md`
  - [ ] `migration.md`
- [ ] Verify no orphaned redbean-related code in `node_modules/` after removal

## Future Enhancements

- [ ] Add Prisma relations for complex JOINs (currently using raw SQL)
- [ ] Replace `prisma.$queryRaw` calls with typed Prisma queries where feasible
- [ ] Add Prisma middleware for logging/auditing
- [ ] Evaluate Prisma Migrate as potential replacement for Knex migrations
- [ ] Add TypeScript types for model methods using Prisma-generated types
- [ ] Add database seeding via `prisma db seed`
- [ ] Consider Prisma Studio for development database inspection

---

## Final Validation

- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` completes successfully
- [ ] `npx prisma generate` produces client without errors
- [ ] `npm run test-backend` passes (212/213, 1 known flaky MQTT timeout)
- [ ] Server starts and connects to database without redbean runtime errors
- [ ] Docker build succeeds (`docker build -f docker/dockerfile .`)
- [ ] Manual QA: login, create monitor, view status page, notifications work
- [ ] Commit and verify branch stability on `prisma-migration`
