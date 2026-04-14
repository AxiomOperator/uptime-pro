# Prisma Cutover Plan

## Cutover Strategy

**Hard cutover** — not a gradual migration. Once complete:

1. **Prisma is the only ORM.** No redbean-node code paths remain.
2. **All `R.*` calls are removed** from production, scripts, and tests.
3. **`redbean-node` is removed** from `package.json` dependencies.
4. **Variable names are cleaned** — no `bean` naming convention remains.

This is a one-way migration. There is no dual-ORM compatibility layer.

---

## Schema Strategy

### Field Naming Convention

Convert database column names from snake_case to camelCase Prisma field names using `@map` annotations:

```prisma
model Monitor {
  id        Int      @id @default(autoincrement())
  userId    Int      @map("user_id")
  upsideDown Boolean @default(false) @map("upside_down")
  dockerHost Int?    @map("docker_host")
  // ...
}
```

**Rules:**
- Prisma field names → camelCase (JavaScript convention)
- Database columns → snake_case (preserved via `@map`)
- Raw SQL queries (`$queryRaw`, `$executeRaw`) → always use snake_case column names
- Prisma client calls → always use camelCase field names
- Table names → keep snake_case via `@@map` on model (e.g., `@@map("monitor")`)

### Schema Migration Authority

**Knex remains the schema migration authority.** The 49 existing migration files in `db/knex_migrations/` manage the actual SQLite table structure. Prisma introspects this schema — it does not manage it.

To update the schema:
1. Write a new Knex migration in `db/knex_migrations/`
2. Run the migration
3. Run `npx prisma db pull` to sync `prisma/schema.prisma`
4. Run `npx prisma generate` to rebuild the client

---

## File-by-File Rewrite Order

### Phase 1: Schema (Complete ✅)
1. `prisma/schema.prisma` — Define all 26 models
2. `prisma.config.ts` — Configure Prisma
3. `server/prisma.js` — Create PrismaClient singleton
4. `npx prisma generate` — Build client to `server/generated/prisma/`

### Phase 2: Server Core (Complete ✅)
Work in parallel across files:
1. `server/model/*.js` — All 13 model files
2. `server/server.js` — Main server logic
3. `server/uptime-kuma-server.js` — Server class
4. `server/socket-handlers/*.js` — All 10 socket handlers
5. `server/routers/*.js` — Both routers
6. `server/uptime-calculator.js`, `server/notification.js`, `server/proxy.js`, `server/settings.js`, `server/remote-browser.js`

### Phase 3: Scripts and Tests (Pending)
1. `extra/remove-2fa.js` — Replace R.findOne with prisma.user.findFirst
2. `extra/reset-password.js` — Replace R.findOne with prisma.user.findFirst
3. `extra/reset-migrate-aggregate-table-state.js` — Replace R.exec with prisma.$executeRaw
4. `db/knex_init_db.js` — Replace R.knex with direct Knex import
5. `test/backend-test/test-domain.js` — Replace R.findOne with Prisma or Knex
6. `test/backend-test/test-migration.js` — Replace R.setup/R.exec with Prisma/Knex

### Phase 4: Naming Cleanup (Pending)
1. Rename `bean` → contextual names (e.g., `monitor`, `heartbeat`, `maintenance`, `notification`, `proxy`, `row`)
2. Rename `beanMeta` → `_meta` (defined as non-enumerable via `Object.defineProperty`)
3. Update JSDoc `@param {Bean}` annotations to proper types

### Phase 5: Dependency Removal (Pending)
1. Remove `redbean-node` from `package.json`
2. Run `npm ci` to clean dependency tree
3. Remove migration planning docs

---

## PrismaClient Pattern

### Singleton Access

```javascript
const { getPrisma } = require("./prisma");

async function someOperation() {
    const prisma = getPrisma();
    const result = await prisma.monitor.findFirst({ where: { id } });
    return result;
}
```

### Initialization

PrismaClient is lazily initialized on first `getPrisma()` call. It uses the better-sqlite3 adapter:

```javascript
const { PrismaClient } = require("./generated/prisma");
const { PrismaBetterSqlite3 } = require("@prisma/adapter-better-sqlite3");

function getPrisma() {
    if (!prisma) {
        const adapter = new PrismaBetterSqlite3(resolvedDbUrl);
        prisma = new PrismaClient({ adapter });
    }
    return prisma;
}
```

### Shutdown

```javascript
const { disconnectPrisma } = require("./prisma");
await disconnectPrisma(); // Called during graceful shutdown
```

---

## Replacement Patterns

### CRUD Operations

| Redbean (Old) | Prisma (New) |
|---------------|-------------|
| `R.findOne("monitor", " id = ? ", [id])` | `prisma.monitor.findFirst({ where: { id } })` |
| `R.find("monitor", " user_id = ? ORDER BY weight ", [uid])` | `prisma.monitor.findMany({ where: { userId: uid }, orderBy: { weight: "asc" } })` |
| `R.load("monitor", id)` | `prisma.monitor.findUnique({ where: { id } })` |
| `bean.name = "test"; await R.store(bean)` (INSERT) | `prisma.monitor.create({ data: { name: "test", ... } })` |
| `bean.name = "updated"; await R.store(bean)` (UPDATE) | `prisma.monitor.update({ where: { id }, data: { name: "updated" } })` |
| `await R.trash(bean)` | `prisma.monitor.delete({ where: { id: bean.id } })` |

### Raw SQL

| Redbean (Old) | Prisma (New) |
|---------------|-------------|
| `R.exec(sql, [params])` | `` prisma.$executeRaw`...` `` or `prisma.$executeRawUnsafe(sql, ...params)` |
| `R.getAll(sql, [params])` | `` prisma.$queryRaw`...` `` or `prisma.$queryRawUnsafe(sql, ...params)` |
| `R.knex("table").where(...)` | Use Knex directly (for migrations) or convert to Prisma query |

### Counting

| Redbean (Old) | Prisma (New) |
|---------------|-------------|
| `R.count("monitor", " user_id = ? ", [uid])` | `prisma.monitor.count({ where: { userId: uid } })` |

### Existence Check

| Redbean (Old) | Prisma (New) |
|---------------|-------------|
| `R.findOne(...)` then null check | `prisma.model.findFirst({ where: ... })` then null check |

---

## Transaction Handling

### Single Transaction

```javascript
const prisma = getPrisma();
await prisma.$transaction(async (tx) => {
    await tx.monitor.update({ where: { id }, data: { active: false } });
    await tx.heartbeat.deleteMany({ where: { monitorId: id } });
    await tx.monitorNotification.deleteMany({ where: { monitorId: id } });
});
```

### Batch Operations

```javascript
await prisma.$transaction([
    prisma.monitorTag.deleteMany({ where: { monitorId: id } }),
    prisma.monitorGroup.deleteMany({ where: { monitorId: id } }),
    prisma.monitor.delete({ where: { id } }),
]);
```

---

## Relation Handling

### Current State: Raw SQL for Complex Joins

Most complex queries currently use raw SQL via `prisma.$queryRaw`. This preserves existing behavior during migration:

```javascript
const rows = await prisma.$queryRawUnsafe(`
    SELECT m.*, mg.group_id, mg.weight
    FROM monitor m
    JOIN monitor_group mg ON m.id = mg.monitor_id
    WHERE mg.group_id = ?
    ORDER BY mg.weight
`, groupId);
```

### Future: Prisma Relations

Once `@map` field naming is complete, Prisma relations can replace many raw SQL JOINs:

```javascript
const group = await prisma.group.findUnique({
    where: { id: groupId },
    include: { monitorGroups: { include: { monitor: true } } }
});
```

This is a future enhancement — not required for cutover.

---

## Error Handling

### Prisma Error Types

```javascript
const { Prisma } = require("./generated/prisma");

try {
    await prisma.user.create({ data: { username, password } });
} catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === "P2002") {
            // Unique constraint violation
            throw new Error("Username already exists");
        }
    }
    throw e;
}
```

### Common Error Codes

| Code | Meaning | Typical Scenario |
|------|---------|-----------------|
| P2002 | Unique constraint violation | Duplicate username, duplicate slug |
| P2025 | Record not found | Update/delete on non-existent ID |
| P2003 | Foreign key constraint failure | Delete parent with children |

---

## Cleanup Order

1. **Remove `redbean-node` from `package.json`**
   ```bash
   npm uninstall redbean-node
   ```

2. **Remove all `require("redbean-node")` statements**
   - `extra/remove-2fa.js`
   - `extra/reset-password.js`
   - `extra/reset-migrate-aggregate-table-state.js`
   - `db/knex_init_db.js`
   - `test/backend-test/test-domain.js`
   - `test/backend-test/test-migration.js`

3. **Clean documentation**
   - Remove migration planning files after cutover is verified
   - Update README if it references redbean-node

4. **Remove old migration-related files** (after full validation)
   - `prisma-migration-checklist.md`
   - `prisma-migration-plan.md`
   - `prisma-migration-review.md`
   - `prisma-migration-test-plan.md`
   - `migration.md`

---

## Hardening

### Automated Validation
```bash
npm run lint            # Linting passes
npm run build           # Frontend builds
npx prisma generate     # Client generates
npm run test-backend    # Backend tests pass (212/213, 1 known flaky)
```

### Manual QA
1. Fresh startup — server initializes, connects to database
2. Login flow — user authentication works
3. Monitor CRUD — create, edit, pause, resume, delete
4. Status page — create, publish, view publicly
5. Notifications — add provider, test send, receive alert
6. Maintenance — create window, verify monitors affected
7. Settings — change and persist settings
8. Docker deployment — build image, start container, verify operation

### Docker Validation
```bash
docker build -f docker/dockerfile -t uptime-pro:test .
docker run -d -p 3001:3001 uptime-pro:test
curl http://localhost:3001  # Verify response
```
