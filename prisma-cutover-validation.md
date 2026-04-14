# Prisma Cutover Validation

Validation plan for confirming the redbean-node → Prisma migration is complete, correct, and production-ready.

---

## 1. Automated Tests

### Backend Test Suite

```bash
npm run test-backend
```

**Expected result:** 212/213 tests passing.

**Known flaky test:** 1 MQTT timeout test fails intermittently due to external service dependency, not related to the ORM migration. This is a pre-existing condition.

**What the tests validate:**
- Monitor type logic (HTTP, TCP, DNS, Docker, etc.)
- Heartbeat processing and uptime calculation
- Notification dispatch logic
- User authentication (login, 2FA)
- API key operations
- Status page rendering
- Maintenance window scheduling
- Tag and group operations
- Domain expiry checking
- Proxy configuration

### Lint Validation

```bash
npm run lint
```

**Expected result:** Zero errors. Verifies code style compliance across all modified files (4-space indent, double quotes, Unix line endings, semicolons, JSDoc).

```bash
npm run lint:prod
```

**Expected result:** Zero errors, zero warnings. Production-grade lint check.

---

## 2. Build Validation

### Frontend Build

```bash
npm run build
```

**Expected result:** Vite builds frontend to `dist/` without errors (~90-120 seconds). Verifies that no server-side ORM code has leaked into frontend bundles.

### Prisma Client Generation

```bash
npx prisma generate
```

**Expected result:** Client generated at `server/generated/prisma/` without errors. Validates that `prisma/schema.prisma` has no syntax errors and all 26 models are well-formed.

### TypeScript Check (Informational)

```bash
npm run tsc
```

**Note:** This currently shows 1400+ pre-existing TypeScript errors unrelated to the migration. It does not block the build. Informational only.

---

## 3. Startup Validation

### Server Initialization

```bash
node server/server.js
```

**Verify:**
- [ ] Server starts without `MODULE_NOT_FOUND` errors for redbean-node
- [ ] PrismaClient initializes and connects to SQLite database
- [ ] No `R is not defined` or `R.findOne is not a function` runtime errors
- [ ] Database migrations run (Knex) if database is new
- [ ] Server listens on configured port (default 3001)
- [ ] WebSocket (Socket.IO) endpoint is accessible
- [ ] First request returns valid HTML (login page or dashboard)

### Database Connection

**Verify:**
- [ ] `data/kuma.db` is created if not present
- [ ] Prisma connects via better-sqlite3 adapter
- [ ] Existing data is readable after migration (no schema mismatch)

---

## 4. CRUD Validation Per Model

### Monitor

| Operation | Test | Expected |
|-----------|------|----------|
| Create | Add new HTTP monitor via UI | Monitor saved, appears in list, begins checking |
| Read | Load dashboard with existing monitors | All monitors displayed with correct status |
| Update | Edit monitor URL, interval, name | Changes persisted, monitor restarts with new config |
| Delete | Delete a monitor | Monitor removed, heartbeats cleaned up |
| Pause/Resume | Toggle monitor active state | Monitor stops/starts checking, `active` boolean correct |

### User

| Operation | Test | Expected |
|-----------|------|----------|
| Login | Enter valid credentials | JWT issued, dashboard loads |
| Create | First-time setup wizard | User created with hashed password |
| Update password | Change password in settings | New password works, old password rejected |
| 2FA enable/disable | Toggle two-factor auth | `twofa_status` boolean correct, TOTP works |

### Heartbeat

| Operation | Test | Expected |
|-----------|------|----------|
| Record | Let monitor check run | Heartbeats inserted with status, ping, duration |
| Query | View monitor detail page | Heartbeat history displayed, chart renders |
| Statistics | View uptime percentage | `StatMinutely`, `StatHourly`, `StatDaily` calculated |

### Notification

| Operation | Test | Expected |
|-----------|------|----------|
| Create | Add notification (e.g., email, webhook) | Notification saved with config JSON |
| Test | Click "Test" button | Notification sent, success/failure reported |
| Link to monitor | Assign notification to monitor | `MonitorNotification` junction record created |
| Default flag | Set notification as default | `isDefault` boolean correctly stored and retrieved |

### Status Page

| Operation | Test | Expected |
|-----------|------|----------|
| Create | Create new status page with slug | Page saved, accessible at `/status/{slug}` |
| Publish | Set published=true | Page visible without authentication |
| Add monitors | Add monitors to groups on page | `Group` and `MonitorGroup` records created |
| CNAME | Add custom domain | `StatusPageCname` record created |

### Maintenance

| Operation | Test | Expected |
|-----------|------|----------|
| Create | Create maintenance window | Maintenance saved with schedule |
| Activate | Maintenance window starts | Affected monitors show maintenance status |
| End | Maintenance window ends | Monitors resume normal checking |
| Recurring | Create recurring maintenance | Croner job scheduled, `beanMeta.job` set |

### Tags

| Operation | Test | Expected |
|-----------|------|----------|
| Create | Create tag with name and color | Tag saved |
| Assign | Assign tag to monitor with value | `MonitorTag` record created |
| Filter | Filter monitors by tag | Correct monitors returned |

### Additional Models

| Model | Validation |
|-------|-----------|
| ApiKey | Create, list, revoke API keys |
| Proxy | Create proxy, assign to monitor, verify monitor uses proxy |
| DockerHost | Add Docker host, list containers |
| RemoteBrowser | Add remote browser endpoint |
| DomainExpiry | Monitor tracks domain expiry date |
| Incident | Create and resolve incident on status page |

---

## 5. Boolean Type Validation

SQLite stores booleans as integers (0/1). Prisma maps these to native JavaScript booleans (`true`/`false`). Validate that all boolean fields work correctly:

| Field | Model | Test |
|-------|-------|------|
| `twofa_status` | User | Enable 2FA → value is `true` not `1`; disable → `false` not `0` |
| `active` | Monitor | Pause monitor → `false`; resume → `true` |
| `active` | Maintenance | Active maintenance → `true`; ended → `false` |
| `active` | User | Active user → `true` |
| `active` | ApiKey | Active key → `true`; revoked → `false` |
| `isDefault` | Proxy | Default proxy → `true`; mapped from `default` column |
| `is_default` | Notification | Default notification → `true` |
| `upside_down` | Monitor | Inverted monitor → `true`; `isUpsideDown()` returns boolean |
| `published` | StatusPage | Published page → `true` |
| `search_engine_index` | StatusPage | SEO enabled → `true` |
| `important` | Heartbeat | Important heartbeat → `true` |
| `pin` | Incident | Pinned incident → `true` |
| `auth` | Proxy | Proxy requires auth → `true` |
| `ignoreTls` | Monitor | TLS validation skipped → `true` |
| `accepted_statuscodes_json` | Monitor | Not a boolean, but JSON field — verify no type confusion |

**Verification method:** Insert a record with boolean `true`, read it back, verify `=== true` (not `=== 1`). Same for `false`/`0`.

---

## 6. Transaction Validation

### Multi-Step Monitor Deletion

Delete a monitor and verify all related records are cleaned up atomically:

```
1. Create monitor with heartbeats, tags, notifications, and group membership
2. Delete the monitor
3. Verify: monitor row deleted
4. Verify: heartbeats deleted (or cascade applied)
5. Verify: MonitorNotification junction records deleted
6. Verify: MonitorTag records deleted
7. Verify: MonitorGroup records deleted
8. Verify: No orphaned records remain
```

### Status Page with Groups

```
1. Create status page with multiple groups and monitors
2. Delete the status page
3. Verify: StatusPage row deleted
4. Verify: Group records deleted
5. Verify: MonitorGroup records deleted
6. Verify: StatusPageCname records deleted
```

### Maintenance with Associations

```
1. Create maintenance linked to monitors and status pages
2. Delete the maintenance
3. Verify: Maintenance row deleted
4. Verify: MonitorMaintenance records deleted
5. Verify: MaintenanceStatusPage records deleted
```

---

## 7. Error Path Validation

| Scenario | Expected Behavior |
|----------|-------------------|
| Create monitor with invalid URL | Validation error, monitor not saved |
| Create user with duplicate username | Unique constraint error, meaningful message |
| Delete monitor that doesn't exist | P2025 error handled gracefully |
| Access status page with invalid slug | 404 response, no crash |
| Login with wrong password | Authentication failure, no ORM error leakage |
| Create notification with invalid config | Validation error returned to client |
| Exceed rate limits | Proper error response, no database corruption |
| Database locked (concurrent access) | Retry or meaningful error, no crash |
| Prisma connection failure | Server logs error, does not crash silently |

---

## 8. Manual QA Scenarios

### Scenario 1: Fresh Install

```
1. Start with no data/kuma.db
2. Launch server
3. Verify setup wizard appears
4. Create admin account
5. Verify login works
6. Verify empty dashboard loads
```

### Scenario 2: Monitor Lifecycle

```
1. Create HTTP monitor targeting a known-good URL
2. Wait for first heartbeat
3. Verify status shows UP with ping time
4. Edit monitor: change interval, add notification
5. Pause monitor, verify checks stop
6. Resume monitor, verify checks restart
7. Delete monitor, verify cleanup
```

### Scenario 3: Status Page

```
1. Create status page with custom slug
2. Add 2 groups with monitors
3. Set page to published
4. Access /status/{slug} in browser (unauthenticated)
5. Verify monitors display with correct status
6. Add incident to status page
7. Verify incident appears on public page
8. Resolve incident
```

### Scenario 4: Maintenance Window

```
1. Create one-time maintenance window for 5 minutes from now
2. Assign 2 monitors to the maintenance
3. Wait for maintenance to start
4. Verify affected monitors show maintenance status
5. Wait for maintenance to end
6. Verify monitors return to normal status
```

### Scenario 5: Notification Round-Trip

```
1. Add a webhook notification provider
2. Assign to a monitor
3. Use "Test" button — verify webhook receives test payload
4. Simulate monitor down — verify notification fires
5. Simulate monitor recovery — verify recovery notification fires
```

### Scenario 6: Settings Persistence

```
1. Change application title in settings
2. Change timezone setting
3. Restart server
4. Verify settings persisted (Setting model CRUD)
```

---

## 9. Raw SQL Validation

Verify that all `prisma.$queryRaw` and `prisma.$executeRaw` calls use the correct snake_case column names (not camelCase Prisma field names):

```bash
# Find all raw SQL usage
grep -rn "\$queryRaw\|\$executeRaw" server/ --include="*.js"
```

For each raw SQL call, verify:
- Column names match SQLite schema (snake_case)
- Table names match SQLite schema
- Parameter binding is correct (no SQL injection)
- Results are mapped correctly to the expected format

---

## 10. Docker Validation

```bash
# Build image
docker build -f docker/dockerfile -t uptime-pro:cutover-test .

# Run container
docker run -d --name uptime-pro-test -p 3001:3001 -v uptime-pro-data:/app/data uptime-pro:cutover-test

# Verify startup
sleep 10
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001
# Expected: 200 or 302 (redirect to login)

# Check logs for errors
docker logs uptime-pro-test 2>&1 | grep -i "error\|redbean\|R\."
# Expected: no ORM-related errors

# Cleanup
docker stop uptime-pro-test && docker rm uptime-pro-test
```

---

## 11. Completion Criteria

All of the following must be true before the cutover is considered complete:

- [ ] `npm run lint` — zero errors
- [ ] `npm run build` — completes successfully
- [ ] `npx prisma generate` — generates client without errors
- [ ] `npm run test-backend` — 212/213 pass (1 known flaky MQTT timeout)
- [ ] No `require("redbean-node")` in any production code (`server/`)
- [ ] No `R.` method calls in any production code (`server/`)
- [ ] Server starts and accepts connections without ORM errors
- [ ] All CRUD operations work for every model
- [ ] Boolean fields return `true`/`false` (not `1`/`0`)
- [ ] Transactions maintain atomicity
- [ ] Docker image builds and runs successfully
- [ ] No data loss or corruption on existing databases
- [ ] All migration planning files cleaned up (after validation)
