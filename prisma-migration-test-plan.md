# Prisma Migration Test Plan

Migrating Uptime Pro (fork of Uptime Kuma) from `redbean-node` to Prisma ORM.
This document defines exactly what "done" means before the `prisma-migration` branch can be merged.

---

## Overview

**Goal**: Replace all `redbean-node` ORM usage with Prisma while preserving 100% of existing behavior.

**Scope**:
- All server-side model files under `server/model/`
- Any direct `R.*` (redbean-node) calls in `server/database.js`, socket handlers, and routers
- SQLite remains the default database; MariaDB/MySQL compatibility must not regress

**Key models**: `monitor`, `user`, `heartbeat`, `api_key`, `tag`, `status_page`, `maintenance`, `notification`, `proxy`, `docker_host`, `remote_browser`, `group`, `incident`, `domain_expiry`

**Out of scope**: Frontend, Socket.IO protocol shape, REST API request/response contracts (these must not change)

---

## Test Infrastructure

### Existing (do not modify)

| Command | What it runs | Location |
|---|---|---|
| `npm run test-backend` | Node.js built-in test runner, backend unit tests | `test/backend-test/` |
| `npm test` | All tests (backend + E2E via Playwright) | project root |
| `npm run lint` | ESLint + Stylelint | project root |

### New tests to add in `test/backend-test/`

Add the following test files before starting migration work:

- `test/backend-test/test-prisma-client.js` — PrismaClient instantiation, singleton behavior, DB connection
- `test/backend-test/test-prisma-models.js` — CRUD round-trips for every model
- `test/backend-test/test-prisma-migration-compat.js` — Verify Knex migrations and Prisma schema stay in sync

Each new test file must follow the existing pattern (Node.js built-in `node:test`, no external test runner).

---

## Pre-Migration Baseline

Run these steps **before any code changes** and record the results.

```bash
# 1. Confirm you are on the right branch
git checkout prisma-migration
git status   # must be clean

# 2. Install dependencies
npm ci

# 3. Run full backend test suite — record pass/fail count
npm run test-backend 2>&1 | tee baseline-test-results.txt

# 4. Run linter — record warning/error count
npm run lint 2>&1 | tee baseline-lint-results.txt

# 5. Build frontend — must succeed
npm run build

# 6. Start the server and verify it reaches the setup wizard
node server/server.js &
sleep 5
curl -s http://localhost:3001/ | grep -i "setup\|kuma\|uptime" && kill %1
```

Save `baseline-test-results.txt` and `baseline-lint-results.txt` as reference.
All tests that pass before migration must still pass after.

---

## Prisma Setup Validation

### 1. Schema file exists and is valid

```bash
ls prisma/schema.prisma          # must exist
npx prisma validate              # must print: "The schema at prisma/schema.prisma is valid"
```

### 2. Prisma client generates correctly

```bash
npx prisma generate
# Expected: "Generated Prisma Client" with no errors
ls node_modules/.prisma/client/  # must contain index.js and runtime files
```

### 3. PrismaClient singleton instantiates

In `server/database.js` (or wherever the singleton lives), confirm:

```js
// Verify this pattern exists and works:
const { PrismaClient } = require('@prisma/client');
let prisma;
if (!global.__prisma) {
    global.__prisma = new PrismaClient();
}
prisma = global.__prisma;
```

Write a quick smoke test:

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$connect().then(() => { console.log('OK'); p.\$disconnect(); }).catch(e => { console.error(e); process.exit(1); });
"
```

### 4. DB connection works

```bash
# Default SQLite path
DATABASE_URL="file:./data/kuma.db" node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT 1 AS ok\`.then(r => { console.log('Connected:', r); p.\$disconnect(); });
"
```

### 5. Environment variable handling

- Confirm `DATABASE_URL` is read from `.env` via `dotenv` or Prisma's built-in env support
- Confirm the app falls back to `file:./data/kuma.db` when `DATABASE_URL` is not set
- Confirm MariaDB URL format works: `mysql://user:pass@host:3306/dbname`

---

## Model-by-Model Validation Checklist

For each model, verify CRUD operations work, business logic is preserved, and specific edge cases pass.

---

### `tag`

| Operation | What to verify |
|---|---|
| Create | `name`, `color` fields saved correctly |
| Read | Find by id, find all |
| Update | `name` and `color` update without side effects |
| Delete | Cascade removes `monitor_tag` join rows |

**Business logic**: Tags are assigned to monitors via a join table. Deleting a tag must not orphan `monitor_tag` rows.

**Manual test**: Create tag "Production" (green), assign to a monitor, delete the tag, verify monitor no longer shows the tag.

---

### `proxy`

| Operation | What to verify |
|---|---|
| Create | All proxy fields saved (`protocol`, `host`, `port`, `auth`, `username`, `password`) |
| Read | Find by id, list all for a user |
| Update | Host/port update propagates to monitors using this proxy |
| Delete | Cannot delete if monitors reference it (or cascades cleanly — document which behavior is chosen) |

**Business logic**: Proxy credentials must be stored/retrieved without truncation or encoding corruption.

**Manual test**: Create an HTTP proxy, assign it to a monitor, verify monitor uses it.

---

### `docker_host`

| Operation | What to verify |
|---|---|
| Create | `name`, `dockerType`, `dockerDaemon` saved |
| Read | List all, find by id |
| Update | Daemon path updates correctly |
| Delete | Cascades to monitors using this host |

**Manual test**: Add a Docker host, create a Docker container monitor pointing to it, delete the host, verify monitor status reflects disconnection.

---

### `remote_browser`

| Operation | What to verify |
|---|---|
| Create | `name`, `url` saved |
| Read | List all |
| Update | URL updates |
| Delete | No orphan references in monitors |

**Manual test**: Create a remote browser entry, assign it to a browser-type monitor, verify connection is attempted.

---

### `group`

| Operation | What to verify |
|---|---|
| Create | Group monitor created with correct `type = "group"` |
| Read | List all groups, fetch children |
| Update | Name, active state |
| Delete | Ungroups child monitors (sets `parent` to null) or cascades — document which |

**Manual test**: Create a group, add monitors to it, verify group shows correct aggregate status.

---

### `incident`

| Operation | What to verify |
|---|---|
| Create | `title`, `content`, `style`, `createdDate`, `lastUpdatedDate` saved |
| Read | Find by status page id |
| Update | `content` and `lastUpdatedDate` update correctly |
| Delete | Row removed, status page no longer shows it |

**Manual test**: Create an incident on a status page, verify it appears, edit it, verify edit shows, delete it.

---

### `api_key`

| Operation | What to verify |
|---|---|
| Create | Key hash stored (not plaintext), `name`, `expires`, `active` fields saved |
| Read | Find by key hash for auth lookup |
| Update | `active` toggle works |
| Delete | Key immediately invalid for auth |

**Business logic**: API key authentication must use hashed comparison. Plaintext key must never be stored.

**Manual test**: Create an API key, use it in `Authorization: Bearer <key>` header on a protected endpoint, verify 200. Disable the key, verify 401.

---

### `user`

| Operation | What to verify |
|---|---|
| Create | `username`, `password` (bcrypt hash), `active`, `timezone` saved |
| Read | Find by username (case-insensitive if applicable) |
| Update | Password change saves new hash; 2FA secret update |
| Delete | Cascades or blocks based on existing FK constraints — document |

**Business logic**: Password must be bcrypt-hashed. 2FA fields (`twofa_secret`, `twofa_status`) must persist correctly.

**Manual test**: Register via setup wizard, log out, log back in with correct password (200), wrong password (401).

---

### `heartbeat`

| Operation | What to verify |
|---|---|
| Create | `monitorId`, `status`, `msg`, `time`, `ping`, `duration` saved with correct types |
| Read | List by monitor id with time range, latest heartbeat per monitor |
| Bulk insert | High-frequency inserts do not deadlock |
| Delete | Old heartbeat pruning job removes rows correctly |

**Business logic**: Heartbeat `time` must be stored as UTC. `ping` is integer milliseconds. `status` is 0 (down) or 1 (up).

**Manual test**: Start a monitor with 20s interval, wait 2 cycles, verify 2 heartbeats appear in the UI with correct timestamps.

---

### `maintenance`

| Operation | What to verify |
|---|---|
| Create | All fields: `title`, `description`, `strategy`, `active`, `intervalDay`, `dateRange`, `timeRange`, `weekdays`, `daysOfMonth`, `timeslotList` |
| Read | Active maintenances for a monitor |
| Update | Strategy and schedule fields update |
| Delete | Monitor no longer shows maintenance state |

**Business logic**: Maintenance windows must suppress alerting. All cron/schedule strategies must evaluate correctly.

**Manual test**: Create a one-time maintenance window for the next 5 minutes, verify affected monitor shows "under maintenance" status.

---

### `domain_expiry`

| Operation | What to verify |
|---|---|
| Create | `monitorId`, `domain`, `certExpiryDate` saved |
| Read | Find by monitor id |
| Update | Expiry date updates on re-check |
| Delete | Removed when monitor is deleted |

**Manual test**: Add an HTTPS monitor with a domain that has a known cert expiry, verify cert expiry date appears in monitor detail.

---

### `status_page`

| Operation | What to verify |
|---|---|
| Create | `slug`, `title`, `description`, `theme`, `published`, `showTags`, `domainNameList`, `customCSS`, `footerText`, `showPoweredBy` |
| Read | Find by slug (used in routing) |
| Update | All fields including `customCSS` (may contain special chars) |
| Delete | Cascades to incidents, monitor associations |

**Business logic**: Slug must be unique. Domain name list is stored as JSON array.

**Manual test**: Create a status page at slug `test-page`, navigate to `/status/test-page`, verify it loads.

---

### `monitor`

| Operation | What to verify |
|---|---|
| Create | All type-specific fields: `url`, `hostname`, `port`, `keyword`, `invertKeyword`, `maxretries`, `interval`, `retryInterval`, `timeout`, `method`, `body`, `headers`, `basicAuthUser`, `basicAuthPass`, `notificationIDList`, `proxyId`, `dockerContainerId`, `dockerHost`, `mqttTopic`, `mqttSuccessMessage`, `dnsResolveServer`, `dnsResolveType`, `radiusUsername`, `radiusPassword`, `radiusCalledStationId`, `radiusCallingStationId`, `radiusSecret`, `game`, `gamedigExtra`, `httpBodyEncoding` |
| Read | List all for user, find by id |
| Update | Active/inactive toggle, URL change |
| Delete | Cascades to heartbeats, tags, notifications |

**Business logic**: `notificationIDList` stored as JSON. `active` flag controls whether monitoring loop runs. Monitor `type` must map to correct monitor-type handler.

**Manual test**: Create HTTP monitor, verify it starts polling, pause it, verify polling stops, resume, verify polling restarts.

---

## Integration Test Scenarios

Each scenario must pass end-to-end with Prisma in place:

### 1. App startup and DB initialization

- [ ] Server starts with a fresh (empty) SQLite DB
- [ ] Prisma migrations run automatically on startup
- [ ] Setup wizard is presented at `http://localhost:3001/`
- [ ] No `redbean-node` runtime errors in server log

### 2. User creation and authentication

- [ ] POST to setup wizard creates first user
- [ ] Login with correct credentials returns session/token
- [ ] Login with wrong credentials returns 401
- [ ] JWT/session persists across page reloads

### 3. Monitor creation, update, delete

- [ ] Create HTTP monitor via Socket.IO `add` event
- [ ] Monitor appears in monitor list
- [ ] Edit monitor URL via Socket.IO `editMonitor` event
- [ ] Delete monitor removes heartbeats and tag associations
- [ ] Monitor loop starts/stops correctly with `active` flag

### 4. Heartbeat recording

- [ ] Heartbeats inserted at correct interval
- [ ] Heartbeat history shows correct up/down status
- [ ] Uptime percentage calculated correctly
- [ ] Old heartbeats pruned by `clear-old-data` job

### 5. Notification dispatch

- [ ] Create notification provider (e.g., email/webhook)
- [ ] Assign notification to monitor
- [ ] Trigger a down event
- [ ] Verify notification is dispatched (check logs or mock endpoint)

### 6. Tag assignment

- [ ] Create tag, assign to monitor
- [ ] Tag appears on monitor list
- [ ] Filter monitors by tag
- [ ] Delete tag, confirm removed from monitor

### 7. Status page loading

- [ ] Create status page with slug `test`
- [ ] Navigate to `/status/test` — page loads without errors
- [ ] Add monitor to status page, verify it appears
- [ ] Public page accessible without authentication

### 8. Maintenance window creation

- [ ] Create maintenance window
- [ ] Affected monitor enters "maintenance" state during window
- [ ] Alerts suppressed during window
- [ ] Monitor returns to normal state after window

### 9. API key creation and authentication

- [ ] Create API key via UI
- [ ] Use key in `Authorization: Bearer <key>` — protected endpoint returns 200
- [ ] Revoke key — endpoint returns 401
- [ ] Expired key rejected

### 10. Docker host management

- [ ] Add Docker host
- [ ] Create Docker container monitor using that host
- [ ] Delete Docker host — monitor shows error state

---

## Database Validation Steps

### 1. All tables exist after migration

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();
p.\$queryRaw\`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name\`
  .then(r => { console.log(r.map(x => x.name).join('\n')); p.\$disconnect(); });
"
```

Expected tables include (at minimum):
`api_key`, `docker_host`, `domain_expiry`, `group`, `heartbeat`, `incident`, `maintenance`, `maintenance_status_page`, `maintenance_timeslot`, `monitor`, `monitor_maintenance`, `monitor_notification`, `monitor_tag`, `monitor_tls_info`, `notification`, `proxy`, `remote_browser`, `setting`, `stat_daily`, `stat_hourly`, `stat_minutely`, `status_page`, `status_page_cname`, `tag`, `user`

### 2. Knex migrations still run correctly

```bash
# Knex migrations must not conflict with Prisma schema
node -e "
const knex = require('knex')({ client: 'sqlite3', connection: { filename: './data/kuma.db' }, useNullAsDefault: true });
knex.migrate.latest({ directory: './db/knex_migrations' })
  .then(([batch, files]) => { console.log('Batch:', batch, 'Files:', files); knex.destroy(); })
  .catch(e => { console.error(e); knex.destroy(); process.exit(1); });
"
```

### 3. No duplicate migration runs

- Verify `knex_migrations` table shows each migration exactly once
- Verify Prisma migration history in `_prisma_migrations` is consistent
- Run the server twice in a row; second start must not re-run migrations

### 4. Schema diff check

After migration, run:

```bash
npx prisma db pull --print   # inspect detected schema
npx prisma migrate diff --from-schema-datamodel prisma/schema.prisma --to-schema-datasource prisma/schema.prisma
# Should output: "No changes detected"
```

---

## Regression Test Scenarios

### Socket.IO events that touch the DB

Verify each event handler works correctly after migration:

| Event | DB operation |
|---|---|
| `add` / `editMonitor` | Monitor upsert |
| `deleteMonitor` | Monitor + cascade delete |
| `pauseMonitor` / `resumeMonitor` | Monitor `active` update |
| `addNotification` / `editNotification` / `deleteNotification` | Notification CRUD |
| `addProxy` / `deleteProxy` | Proxy CRUD |
| `addTag` / `editTag` / `deleteTag` | Tag CRUD |
| `addMonitorTag` / `deleteMonitorTag` | Monitor-tag join |
| `addStatusPage` / `saveStatusPage` / `deleteStatusPage` | Status page CRUD |
| `addMaintenance` / `editMaintenance` / `deleteMaintenance` | Maintenance CRUD |
| `addDockerHost` / `deleteDockerHost` | Docker host CRUD |
| `addRemoteBrowser` / `deleteRemoteBrowser` | Remote browser CRUD |
| `getHeartbeatList` | Heartbeat read |
| `clearEvents` / `clearHeartbeats` | Bulk delete |
| `changePassword` | User update |
| `setup2fa` / `disable2fa` | User 2FA fields update |

### REST endpoints

Verify responses are identical before and after migration:

- `GET /api/status-page/:slug` — public status page data
- `GET /api/status-page/heartbeat/:slug` — heartbeat data for status page
- `GET /metrics` — Prometheus metrics endpoint
- All endpoints in `server/routers/api-router.js`
- All endpoints in `server/routers/status-page-router.js`

### Setup wizard completion flow

- [ ] `GET /setup` renders setup page on fresh DB
- [ ] `POST /setup` creates admin user and redirects
- [ ] Subsequent `GET /setup` redirects to login (setup not shown again)

### Settings read/write

- [ ] All `setting` table entries readable via `Settings.get()`
- [ ] `Settings.set()` persists correctly
- [ ] JWT secret generated and persisted on first run
- [ ] Server name, check update, etc. all settable

---

## Manual QA Scenarios (step-by-step)

### 1. Complete first-run setup wizard

1. Delete `data/kuma.db` if it exists
2. Run `node server/server.js`
3. Open `http://localhost:3001/` in browser
4. Verify setup wizard page appears
5. Enter admin username and password, submit
6. Verify redirect to dashboard
7. Verify no errors in server console

**Pass criteria**: Setup completes, user is logged in, dashboard loads.

---

### 2. Create a monitor and observe heartbeats

1. Click "Add New Monitor"
2. Select type: HTTP(s)
3. Enter URL: `https://example.com`, Name: `Example`, interval: 60s
4. Save
5. Verify monitor appears in list with "Pending" then "Up" status
6. Wait 2 intervals, verify 2 heartbeats visible in history
7. Check uptime percentage is displayed

**Pass criteria**: Monitor polls successfully, heartbeats recorded, uptime shown.

---

### 3. Create a status page and verify it loads

1. Go to Status Pages → Add New Status Page
2. Set title: `Test Status`, slug: `test`
3. Add the monitor created above to the status page
4. Save
5. Navigate to `http://localhost:3001/status/test` (without login)
6. Verify monitor name and status are visible

**Pass criteria**: Public status page loads, shows correct monitor status, no auth required.

---

### 4. Create a user and verify login

1. Go to Settings → Users → Add User (if multi-user is supported)
   _OR_ verify the admin user created during setup works
2. Log out
3. Log in with correct credentials → verify success
4. Log in with wrong password → verify "Invalid credentials" error
5. Verify session persists across browser refresh

**Pass criteria**: Authentication works, wrong credentials rejected.

---

### 5. Create a maintenance window

1. Go to Maintenance → Schedule Maintenance
2. Set title: `Test Maintenance`, strategy: Single Maintenance
3. Set date/time window to the next 10 minutes
4. Select a monitor to be affected
5. Save
6. Verify affected monitor shows "Under Maintenance" status during window
7. Wait for window to expire, verify monitor returns to normal polling

**Pass criteria**: Maintenance suppresses alerts, monitor returns to normal after window.

---

## Error Handling Validation

### Prisma vs redbean-node error shape differences

Document these differences and ensure error handlers in `server/` are updated:

| Scenario | redbean-node error | Prisma error |
|---|---|---|
| Unique constraint violation | Generic SQL error string | `PrismaClientKnownRequestError` with `code: 'P2002'` |
| Record not found | Returns `null` | Returns `null` (same behavior, no error thrown) |
| FK constraint violation | Generic SQL error | `PrismaClientKnownRequestError` with `code: 'P2003'` |
| Invalid data type | May silently coerce | `PrismaClientValidationError` with field details |
| DB connection failure | `RedBeanNode` connection error | `PrismaClientInitializationError` with `errorCode: 'P1001'` |

### Test cases for error handling

- [ ] Attempt to create two users with the same username → verify 400 with clear error message (not 500)
- [ ] Attempt to delete a monitor with a non-existent ID → verify graceful error response
- [ ] Start server with invalid `DATABASE_URL` → verify server logs clear error and exits (or falls back)
- [ ] Simulate DB file permission error → verify error is caught and logged, not unhandled exception
- [ ] Send malformed data to `add` socket event (missing required field) → verify validation error returned

---

## Startup/Runtime Validation

Verify each item by inspecting server logs on startup:

- [ ] Server starts without `Cannot find module 'redbean-node'` errors
- [ ] No `R is not defined` or `R.* is not a function` runtime errors
- [ ] PrismaClient connects to DB: look for no `PrismaClientInitializationError`
- [ ] Knex migrations complete: `[server] Database: Executing db-migration` messages appear
- [ ] Prisma migrations complete (if Prisma migrate is used at startup)
- [ ] `R` global variable is **not** required anywhere at runtime (grep check below)
- [ ] Server listening message appears: `Listening on 3001`
- [ ] No unhandled promise rejections in first 30 seconds of operation

```bash
# Verify no remaining redbean-node references (except allowed locations)
grep -r "redbean-node\|require.*redbean\|R\." server/ --include="*.js" \
  | grep -v "database.js" \
  | grep -v "node_modules" \
  | grep -v ".test.js"
# Expected: no output
```

---

## Rollback Validation

If the migration causes regressions, follow these steps to revert:

### 1. Git revert

```bash
git checkout master   # or 1.23.X depending on target branch
npm ci
npm run build
```

### 2. Database revert

- Prisma does **not** automatically roll back schema changes to SQLite
- Keep a backup of `data/kuma.db` before running any Prisma migrations
- To restore: `cp data/kuma.db.backup data/kuma.db`

### 3. Pre-merge backup procedure

Before merging `prisma-migration` into any branch:

```bash
cp data/kuma.db data/kuma.db.pre-prisma-$(date +%Y%m%d)
git stash   # or tag the last known-good commit
```

### 4. Verify rollback works

After reverting to redbean-node:

- [ ] `npm run test-backend` passes (same as baseline)
- [ ] Server starts and serves the UI
- [ ] Existing monitors resume polling

---

## Merge Readiness Criteria (explicit checklist)

**All items must be checked before recommending merge.**

### Automated

- [ ] `npm run test-backend` passes (zero failures, same count as baseline)
- [ ] `npm run lint` passes (zero new errors vs baseline)
- [ ] `npm run build` completes successfully

### Runtime

- [ ] App starts successfully with no `redbean-node` runtime errors
- [ ] Setup wizard completes on fresh DB
- [ ] Monitor creation and deletion works
- [ ] Heartbeat recording works (verified in DB and UI)
- [ ] No `require('redbean-node')` in any file except `database.js` (for Knex setup only, if kept)

### Verified by grep

```bash
grep -r "redbean-node\|require.*redbean" server/ --include="*.js" | grep -v "node_modules"
# Expected: no output (or only database.js if knex is still used there)
```

### Integration

- [ ] Docker image builds: `docker build -t uptime-pro-test .`
- [ ] Docker container starts healthy: `docker run --rm -p 3001:3001 uptime-pro-test` returns 200 on `/`
- [ ] All Socket.IO flows touching DB work (see regression test table above)
- [ ] REST endpoints return identical responses to pre-migration baseline

### Quality

- [ ] All Prisma vs redbean-node error shape differences are documented (see Error Handling section)
- [ ] No behavior deviations from baseline are left undocumented
- [ ] Rollback procedure tested at least once in a dev environment
- [ ] `data/kuma.db` backup taken before any production migration

---

*Last updated: prisma-migration branch. Update this document if scope or architecture changes.*
