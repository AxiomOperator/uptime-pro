# Prisma Cutover Checklist

Track the completion of the redbean-node → Prisma migration. Items are organized by priority.

---

## Critical — Migration Foundation ✅ COMPLETE

- [x] Install Prisma 7 and configure `prisma/schema.prisma` (26 models)
- [x] Configure better-sqlite3 driver adapter (`@prisma/adapter-better-sqlite3`)
- [x] Generate Prisma client to `server/generated/prisma/`
- [x] Create PrismaClient singleton in `server/prisma.js` (`getPrisma()` / `disconnectPrisma()`)
- [x] Configure `prisma.config.ts` and `.env` with DATABASE_URL
- [x] Preserve Knex as the schema migration authority (`db/knex_migrations/`, 49 migrations)

## High — Core Server Migration ✅ COMPLETE

- [x] Migrate all 13 model files from R. to Prisma (`server/model/*.js`)
- [x] Migrate `server/server.js` from R. to Prisma
- [x] Migrate `server/uptime-kuma-server.js` from R. to Prisma
- [x] Migrate all 10 socket handlers from R. to Prisma (`server/socket-handlers/`)
- [x] Migrate both routers from R. to Prisma (`server/routers/`)
- [x] Migrate utility files: `uptime-calculator.js`, `notification.js`, `proxy.js`, `settings.js`, `remote-browser.js`
- [x] Migrate `extra/` scripts to Prisma (`remove-2fa.js`, `reset-password.js`, `reset-migrate-aggregate-table-state.js`)
- [x] Fix boolean type mapping — Prisma returns `true`/`false` vs SQLite `0`/`1`
- [x] Fix Dockerfile to use local image instead of upstream base
- [x] Fix parseInt for monitorID — Prisma requires Int, `for...in` produces strings
- [x] Fix BigInt serialization — added `BigInt.prototype.toJSON` polyfill for Socket.IO
- [x] Fix snake_case → camelCase mapping for monitor "add" handler (frontend sends snake_case fields)
- [x] Fix `domainNameList` missing from status page JSON responses (`toJSON`/`toPublicJSON`)

## Medium — Schema and Naming ✅ COMPLETE

- [x] Convert all schema field names to camelCase with `@map("snake_case_column")` annotations (184 @map entries across 26 models)
- [x] Remove all `bean` variable names from codebase
- [x] Remove `redbean-node` from `package.json` dependencies
- [x] Remove all `require("redbean-node")` statements
- [x] Remove all bean/redbean references from documentation and comments

## Cleanup ✅ COMPLETE

- [x] Removed stale migration planning docs (`prisma-migration-*.md`, `migration.md`, `prisma-cutover-review.md`, `prisma-cutover-plan.md`, `prisma-cutover-validation.md`)
- [x] 213/213 backend tests pass
- [x] Zero lint errors (`npm run lint`)
- [x] Docker build and deploy successful
- [x] Server starts cleanly, connects to database without errors

## Future Enhancements

- [ ] Add Prisma relations for complex JOINs (currently using `$queryRaw`)
- [ ] Replace remaining `prisma.$queryRaw` calls with typed Prisma queries where feasible
- [ ] Add Prisma middleware for query logging/auditing
- [ ] Evaluate Prisma Migrate as potential replacement for Knex migrations
- [ ] Add TypeScript types for model methods using Prisma-generated types
- [ ] Consider Prisma Studio for development database inspection

---

## Final Validation ✅ COMPLETE

- [x] `npm run lint` passes with zero errors
- [x] `npm run build` completes successfully
- [x] `npx prisma generate` produces client without errors
- [x] `npm run test-backend` passes (213/213)
- [x] Server starts and connects to database without redbean runtime errors
- [x] Docker build and deploy succeeds
- [x] Manual QA: login works, monitor creation works, status page save works
- [x] Branch `prisma-migration` is stable — **ready to merge**
