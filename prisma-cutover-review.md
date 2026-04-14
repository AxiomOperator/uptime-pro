# Prisma Cutover Review

## Overview

Uptime Pro (a fork of Uptime Kuma) is migrating from **redbean-node** ORM to **Prisma 7** with a better-sqlite3 driver adapter. This document reviews the current state of that migration and provides a recommendation for the final hard cutover.

---

## 1. Current ORM Architecture Summary

### Original: redbean-node (Active Record Pattern)

The project originally used [redbean-node](https://www.npmjs.com/package/redbean-node), a JavaScript port of RedBeanPHP. This provided an Active Record pattern with the following API surface:

| Operation | API |
|-----------|-----|
| Find one record | `R.findOne("model", " condition ", [params])` |
| Find many records | `R.find("model", " condition ", [params])` |
| Load by ID | `R.load("model", id)` |
| Create/Update | `R.store(bean)` |
| Delete | `R.trash(bean)` |
| Raw SQL exec | `R.exec(sql, params)` |
| Raw SQL query | `R.getAll(sql, params)` |
| Knex access | `R.knex` |

Records were returned as "bean" objects — mutable JavaScript objects with `__type` metadata allowing `R.store()` to determine INSERT vs UPDATE.

### New: Prisma 7 with better-sqlite3 Adapter

The replacement stack:

- **@prisma/client** `^7.7.0` — generated query client
- **@prisma/adapter-better-sqlite3** `^7.7.0` — SQLite driver adapter
- **better-sqlite3** `^12.9.0` — native SQLite binding
- **prisma** `^7.7.0` — CLI/dev tooling

Architecture:
- PrismaClient singleton via `getPrisma()` in `server/prisma.js`
- Generated client output at `server/generated/prisma/`
- Schema defined in `prisma/schema.prisma` (26 models, ~435 lines)
- Uses `PrismaBetterSqlite3` driver adapter

---

## 2. Remaining Redbean References

### 2.1 Production Server Code

**Zero** `require("redbean-node")` statements remain in `server/`. The core migration is complete.

### 2.2 Standalone Scripts (Still Using R.)

| File | Usage | Notes |
|------|-------|-------|
| `extra/remove-2fa.js` | `R.findOne()` (1 call) | Utility to remove 2FA from a user |
| `extra/reset-password.js` | `R.findOne()` (1 call) | Utility to reset a user password |
| `extra/reset-migrate-aggregate-table-state.js` | `R.exec()` (3 calls) | Resets migration state for aggregate tables |

### 2.3 Database Init

| File | Usage | Notes |
|------|-------|-------|
| `db/knex_init_db.js` | `R.knex` (1 reference) | MariaDB initialization helper |

### 2.4 Test Files (Still Using R.)

| File | Usage | Notes |
|------|-------|-------|
| `test/backend-test/test-domain.js` | `R.findOne()` (1 call) | Domain expiry test |
| `test/backend-test/test-migration.js` | `R.setup()`, `R.exec()`, etc. (9 refs) | Migration integration test |

### 2.5 Package.json

`redbean-node: ~0.3.3` remains listed as a production dependency.

### 2.6 Bean Variable Names (~479 references in server/)

The variable name `bean` is used extensively as a local variable name throughout server code. These are no longer tied to redbean-node but retain the naming convention:

| File | Count | Context |
|------|-------|---------|
| `server/server.js` | 136 | Heartbeat processing, monitor handling |
| `server/model/monitor.js` | 100 | Monitor CRUD, heartbeat creation |
| `server/routers/api-router.js` | 51 | API endpoints for monitors, status pages |
| `server/uptime-calculator.js` | 42 | Uptime statistics processing |
| `server/socket-handlers/maintenance-socket-handler.js` | 42 | Maintenance CRUD via sockets |
| `server/model/maintenance.js` | 28 | Maintenance model logic |
| `server/socket-handlers/status-page-socket-handler.js` | 17 | Status page CRUD |
| `server/model/domain_expiry.js` | 14 | Domain expiry checking |
| `server/remote-browser.js` | 12 | Remote browser management |
| Others | ~37 | api-key handler, settings, proxy, group, etc. |

### 2.7 beanMeta Pattern

`server/model/maintenance.js` uses `this.beanMeta` (18 references) to store transient runtime state:
- `beanMeta.job` — Croner cron job instance
- `beanMeta.status` — Current maintenance status ("scheduled", "under-maintenance")
- `beanMeta.durationTimeout` — Timeout handle for auto-ending maintenance

### 2.8 JSDoc Bean References

Six files contain `@param` JSDoc annotations referencing `bean` or `Bean`:
- `server/model/maintenance.js` (2 annotations)
- `server/model/monitor.js` (2 annotations)
- `server/routers/api-router.js` (1 annotation)
- `server/proxy.js` (1 annotation)

---

## 3. Impacted Files

### Server Models (13 files — all migrated to Prisma)
- `server/model/api_key.js`
- `server/model/docker_host.js`
- `server/model/domain_expiry.js`
- `server/model/group.js`
- `server/model/heartbeat.js`
- `server/model/incident.js`
- `server/model/maintenance.js`
- `server/model/monitor.js`
- `server/model/proxy.js`
- `server/model/remote_browser.js`
- `server/model/status_page.js`
- `server/model/tag.js`
- `server/model/user.js`

### Server Core
- `server/server.js` — Main server logic (migrated)
- `server/uptime-kuma-server.js` — Server class definition (migrated)
- `server/prisma.js` — New Prisma singleton (added)

### Socket Handlers (10 files — all migrated)
- `server/socket-handlers/api-key-socket-handler.js`
- `server/socket-handlers/chart-socket-handler.js`
- `server/socket-handlers/cloudflared-socket-handler.js`
- `server/socket-handlers/database-socket-handler.js`
- `server/socket-handlers/docker-socket-handler.js`
- `server/socket-handlers/general-socket-handler.js`
- `server/socket-handlers/maintenance-socket-handler.js`
- `server/socket-handlers/proxy-socket-handler.js`
- `server/socket-handlers/remote-browser-socket-handler.js`
- `server/socket-handlers/status-page-socket-handler.js`

### Routers (2 files — all migrated)
- `server/routers/api-router.js`
- `server/routers/status-page-router.js`

### Utility Files
- `server/uptime-calculator.js`
- `server/notification.js`
- `server/proxy.js`
- `server/settings.js`
- `server/remote-browser.js`

### Notification Providers (93 files — no direct ORM usage)

Notification providers do not call the ORM directly. They receive data objects via parameters.

---

## 4. Database Schema

### Primary Database: SQLite

- Database file: `data/kuma.db`
- Schema defined in `prisma/schema.prisma`
- 26 Prisma models covering all application entities

### Prisma Models

User, Monitor, Heartbeat, Notification, MonitorNotification, Tag, MonitorTag, Incident, Proxy, DockerHost, RemoteBrowser, StatusPage, StatusPageCname, Group, MonitorGroup, Maintenance, MaintenanceStatusPage, MonitorMaintenance, ApiKey, StatMinutely, StatHourly, StatDaily, Setting, MonitorTlsInfo, NotificationSentHistory, DomainExpiry

### Knex Migrations

49 migration files in `db/knex_migrations/` remain the **schema migration authority**. Prisma introspects the database rather than managing migrations directly. This is intentional — the upstream project uses Knex for migrations and this fork preserves compatibility.

---

## 5. Prisma Architecture

### Client Singleton (`server/prisma.js`)

```javascript
const { PrismaClient } = require("./generated/prisma");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

let prisma;

function getPrisma() {
    if (!prisma) {
        const adapter = new PrismaBetterSqlite3(/* resolved DATABASE_URL */);
        prisma = new PrismaClient({ adapter });
    }
    return prisma;
}
```

### Generated Client

Output: `server/generated/prisma/` (configured in `prisma/schema.prisma`)

### Configuration

- `prisma.config.ts` — Prisma configuration file
- `.env` — `DATABASE_URL=file:./data/kuma.db`

---

## 6. Schema Field Naming

The schema is transitioning from **snake_case** (matching SQLite column names) to **camelCase** with `@map` annotations:

```prisma
model Proxy {
  isDefault Boolean @default(false) @map("default")
}
```

This allows idiomatic JavaScript property access (`proxy.isDefault`) while preserving the underlying database column names (`default`).

**Current state**: Most fields still use snake_case names matching column names directly. The `@map` pattern has been applied selectively (e.g., `Proxy.isDefault`).

---

## 7. Risks

### 7.1 Field Name Mapping Correctness
As camelCase `@map` annotations are added, every consumer of those fields must be updated simultaneously. Raw SQL queries must continue using snake_case column names.

### 7.2 Boolean Type Mapping
SQLite stores booleans as integers (0/1). Prisma returns native `true`/`false`. Code that previously compared against `0`/`1` must use boolean comparisons. Key fields affected:
- `user.twofa_status`
- `notification.is_default`
- `monitor.upside_down`
- `proxy.isDefault` (mapped from `default` column)
- Various `active` fields on Monitor, Maintenance, User, etc.

### 7.3 Raw SQL Queries
`prisma.$executeRaw` and `prisma.$queryRaw` operate on actual column names, not Prisma field names. Any raw SQL must use snake_case column names.

### 7.4 Bean Variable Naming
479 `bean` variable references create cognitive noise. While functional, they confuse developers about which ORM is in use.

### 7.5 beanMeta Pattern
The `beanMeta` pattern in `maintenance.js` stores runtime state on database objects. This needs renaming but the logic must be preserved.

---

## 8. Recommendation

**Confirm Prisma as the permanent ORM.** The migration is ~95% complete:

- ✅ All production server code uses Prisma
- ✅ 26 models defined in schema.prisma
- ✅ Generated client configured and working
- ✅ All 13 model files migrated
- ✅ All socket handlers and routers migrated
- ⚠️ 3 standalone scripts, 2 test files, and package.json still reference redbean-node
- ⚠️ ~479 `bean` variable names need renaming for clarity

The remaining work is cleanup-grade, not migration-grade. Prisma should be declared the sole ORM and all redbean vestiges should be systematically removed per the cutover checklist and plan.
