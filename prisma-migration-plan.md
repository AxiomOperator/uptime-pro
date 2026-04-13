# Prisma Migration Plan

**Branch:** `prisma-migration`  
**Scope:** Replace redbean-node Active Record (284 R.\* usages across 44 files) with Prisma Client  
**Status:** Planning — do not merge to `master` until all validation criteria are met

---

## 1. Overview and Goals

Replace all `redbean-node` (`R.*`) usage with Prisma Client while:

- Keeping the system runnable at every commit (no big-bang swap)
- Preserving all existing public method signatures exactly
- Staying in JavaScript (no TypeScript conversion of the backend)
- Retaining all 49 Knex migrations as the source of truth for schema changes

**What changes:** ORM calls inside model classes and server files.  
**What does not change:** The Knex migration pipeline, database schema, Socket.IO contracts, REST API contracts, frontend code.

---

## 2. Branch Strategy

- All work happens on the `prisma-migration` branch.
- Never merge to `master` until the Definition of Done (section 16) is fully satisfied.
- Each phase is a separate PR review checkpoint; squash-merge phases into `prisma-migration` so `master` merge is a single clean PR.
- The branch must pass `npm run lint`, `npm run build`, and `npm run test-backend` at the end of every phase before proceeding.

---

## 3. Chosen Migration Strategy and Rationale

**Approach: Incremental model-by-model, dual-ORM period**

Both `redbean-node` and `@prisma/client` coexist on `package.json` during migration. Files are migrated one at a time, smallest first. A file is only switched to Prisma when all its R.\* usages are replaced. Files that still use R.\* continue to work normally.

**Rationale:**
- A big-bang rewrite of 44 files in one commit is untestable and unreviewed.
- Redbean auto-maps model class names to table names via `R.autoloadModels`; after migration each class loses that mapping, so partial migration per class is safe as long as callers haven't been changed yet.
- `R.freeze(true)` and `R.autoloadModels` in `database.js` only matter to the files that still import from `redbean-node`; files that import from `server/prisma.js` are decoupled from that path entirely.

---

## 4. Prisma Setup Steps

Run these commands in order from the project root on the `prisma-migration` branch:

```bash
# 1. Install Prisma CLI and client
npm install @prisma/client
npm install --save-dev prisma

# 2. Initialise Prisma (creates prisma/schema.prisma and .env)
npx prisma init --datasource-provider sqlite

# 3. After manually writing schema.prisma (section 5), generate the client
npx prisma generate

# 4. Verify the generated client resolves without errors
node -e "const { PrismaClient } = require('@prisma/client'); console.log('OK');"
```

> **Note:** Do NOT run `prisma migrate dev` or `prisma db push`. The Knex migration pipeline is the only migration tool used in this project.

---

## 5. Schema.prisma Derivation Strategy

`schema.prisma` is written by hand, derived from all 49 files in `db/knex_migrations/`. Prisma is used **only** for the client; Prisma Migrate is not used.

### Derivation process

1. Read every migration in `db/knex_migrations/` in filename order.
2. For each `createTable` block, record every column with its Knex type → Prisma type mapping below.
3. For each `table.alter` / `addColumn` / `dropColumn` in later migrations, apply the change to the running schema.
4. For each foreign key reference (`references(...).inTable(...)`), add a `@relation` to both sides.

### Knex → Prisma type mapping

| Knex type | Prisma type |
|-----------|-------------|
| `increments("id")` | `id Int @id @default(autoincrement())` |
| `integer(col)` | `col Int` |
| `integer(col).unsigned()` | `col Int` (SQLite ignores unsigned) |
| `string(col)` / `varchar` | `col String` |
| `text(col)` | `col String` |
| `boolean(col)` | `col Boolean` |
| `float(col)` | `col Float` |
| `smallint(col)` | `col Int` |
| `timestamp(col)` / `datetime(col)` | `col DateTime` (or `String` if stored as ISO text) |
| `json(col)` | `col String` (stored as JSON string in SQLite) |
| `.nullable()` | `col Type?` |
| `.notNullable()` | `col Type` |
| `.defaultTo(val)` | `@default(val)` |

### Expected tables (from migration scan)

Tables created by the Knex migrations that must appear in `schema.prisma`:

```
api_key, docker_host, domain_expiry, group, heartbeat, incident,
maintenance, maintenance_status_page, maintenance_timeslot,
monitor, monitor_group, monitor_maintenance, monitor_notification,
monitor_tag, monitor_tls_info, notification, proxy, remote_browser,
stat_daily, stat_hourly, stat_minutely, status_page, status_page_cname,
tag, user
```

### schema.prisma skeleton (excerpt — fill in all columns)

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "sqlite"
  url      = env("DATABASE_URL")
}

model User {
  id            Int      @id @default(autoincrement())
  username      String   @unique
  password      String
  active        Boolean  @default(true)
  twofa_status  Int      @default(0)
  twofa_secret  String?
  twofa_last_token String?

  api_keys      ApiKey[]

  @@map("user")
}

model Tag {
  id    Int     @id @default(autoincrement())
  name  String
  color String

  monitor_tags MonitorTag[]

  @@map("tag")
}

model ApiKey {
  id           Int      @id @default(autoincrement())
  key          String
  name         String
  user_id      Int
  active       Boolean  @default(true)
  expires      DateTime?
  created_date DateTime @default(now())

  user         User     @relation(fields: [user_id], references: [id], onDelete: Cascade)

  @@map("api_key")
}

// ... (complete all remaining models in the same pattern)
```

> Set `DATABASE_URL` in `.env` to `file:./data/kuma.db` for local dev. Never commit `.env`.

---

## 6. PrismaClient Singleton Pattern

Create `server/prisma.js` (new file):

```js
const { PrismaClient } = require("@prisma/client");

let prisma;

/**
 * Return the shared PrismaClient instance, creating it on first call.
 * @returns {PrismaClient}
 */
function getPrisma() {
    if (!prisma) {
        prisma = new PrismaClient();
    }
    return prisma;
}

/**
 * Disconnect Prisma — call during graceful server shutdown.
 * @returns {Promise<void>}
 */
async function disconnectPrisma() {
    if (prisma) {
        await prisma.$disconnect();
        prisma = undefined;
    }
}

module.exports = { getPrisma, disconnectPrisma };
```

Usage in any migrated file:

```js
const { getPrisma } = require("../prisma"); // or "./prisma" from server root
const prisma = getPrisma();
```

Add `disconnectPrisma()` call in `server/server.js` shutdown handler alongside the existing `R.close()` during the dual-ORM period, then remove `R.close()` in Phase 6.

---

## 7. R.\* → Prisma Mapping Table

| R method | Prisma equivalent | Example |
|----------|------------------|---------|
| `R.findOne(table, where, params)` | `prisma.model.findFirst({ where: {...} })` | See below |
| `R.find(table, where, params)` | `prisma.model.findMany({ where: {...}, orderBy })` | See below |
| `R.findAll(table, suffix)` | `prisma.model.findMany({ orderBy: {...} })` | See below |
| `R.getAll(sql, params)` | `prisma.$queryRaw\`...\`` | See below |
| `R.getRow(sql, params)` | `prisma.$queryRaw\`...\`` (returns array, take `[0]`) | See below |
| `R.getCell(sql, params)` | `prisma.$queryRaw\`...\`` → extract single value | See below |
| `R.getCol(sql, params)` | `prisma.$queryRaw\`...\`` → map single column | See below |
| `R.getAssoc(sql, params)` | `prisma.$queryRaw\`...\`` → `Object.fromEntries(...)` | See below |
| `R.exec(sql, params)` | `prisma.$executeRaw\`...\`` | See below |
| `R.store(bean)` | `prisma.model.upsert` or `create`/`update` | See below |
| `R.dispense(table)` | plain object `{ ... }` — store via `prisma.model.create` | See below |
| `R.load(table, id)` | `prisma.model.findUnique({ where: { id } })` | See below |
| `R.trash(bean)` | `prisma.model.delete({ where: { id: bean.id } })` | See below |
| `R.count(table, where, params)` | `prisma.model.count({ where: {...} })` | See below |
| `R.begin()` | `prisma.$transaction(async (tx) => { ... })` | See section 9 |
| `R.isoDateTime(dayjs)` | `dayjs.toDate()` (store as `DateTime`) or keep as ISO string | See below |
| `R.isoDateTimeMillis(dayjs)` | `dayjs.toDate()` or `dayjs.toISOString()` | See below |
| `R.knex` | `getPrisma().$queryRawUnsafe(sql, ...params)` (last resort) | — |
| `R.convertToBeans(table, rows)` | Plain rows are already POJOs; instantiate model class manually | See below |

### Concrete examples

**`R.findOne` → `prisma.model.findFirst`**
```js
// Before
let user = await R.findOne("user", "TRIM(username) = ? AND active = 1", [username.trim()]);

// After
const prisma = getPrisma();
let user = await prisma.user.findFirst({
    where: {
        username: { equals: username.trim() },
        active: true,
    },
});
```

**`R.find` → `prisma.model.findMany`**
```js
// Before (status_page.js:273)
const list = await R.find("group", " public = 1 AND status_page_id = ? ORDER BY weight ", [statusPage.id]);

// After
const list = await prisma.group.findMany({
    where: { public: true, status_page_id: statusPage.id },
    orderBy: { weight: "asc" },
});
```

**`R.findAll` → `prisma.model.findMany`**
```js
// Before (status_page.js:364)
let list = await R.findAll("status_page", " ORDER BY title ");

// After
const list = await prisma.statusPage.findMany({ orderBy: { title: "asc" } });
```

**`R.exec` → `prisma.$executeRaw`**
```js
// Before (user.js:16)
await R.exec("UPDATE `user` SET password = ? WHERE id = ? ", [hashedPassword, userID]);

// After — use Prisma.sql tagged template for parameter safety
const { Prisma } = require("@prisma/client");
await prisma.$executeRaw(Prisma.sql`UPDATE user SET password = ${hashedPassword} WHERE id = ${userID}`);

// Or use the model API when possible (preferred):
await prisma.user.update({
    where: { id: userID },
    data: { password: hashedPassword },
});
```

**`R.getAll` raw SQL → `prisma.$queryRaw`**
```js
// Before (group.js — inside getMonitorList)
const rows = await R.getAll(`
    SELECT monitor.*, monitor_group.send_url, monitor_group.custom_url
    FROM monitor, monitor_group
    WHERE monitor.id = monitor_group.monitor_id
    AND group_id = ?
    ORDER BY monitor_group.weight
`, [this.id]);

// After
const { Prisma } = require("@prisma/client");
const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT monitor.*, monitor_group.send_url, monitor_group.custom_url
    FROM monitor, monitor_group
    WHERE monitor.id = monitor_group.monitor_id
    AND group_id = ${this.id}
    ORDER BY monitor_group.weight
`);
```

**`R.getAssoc` → `prisma.$queryRaw` + `Object.fromEntries`**
```js
// Before (status_page.js:348)
StatusPage.domainMappingList = await R.getAssoc(`
    SELECT domain, status_page_id FROM status_page_cname
`);

// After
const rows = await prisma.$queryRaw`SELECT domain, status_page_id FROM status_page_cname`;
StatusPage.domainMappingList = Object.fromEntries(rows.map(r => [r.domain, r.status_page_id]));
```

**`R.getCell` → `prisma.$queryRaw` → extract value**
```js
// Before (status_page.js:490)
return await R.getCell("SELECT id FROM status_page WHERE slug = ? ", [slug]);

// After
const rows = await prisma.$queryRaw`SELECT id FROM status_page WHERE slug = ${slug}`;
return rows[0]?.id ?? null;
```

**`R.getCol` → `prisma.$queryRaw` → map column**
```js
// Before (status_page.js:562)
let maintenanceIDList = await R.getCol(`SELECT id FROM maintenance ...`, [...]);

// After
const rows = await prisma.$queryRaw`SELECT id FROM maintenance WHERE ...`;
const maintenanceIDList = rows.map(r => r.id);
```

**`R.count` → `prisma.model.count`**
```js
// Before (status_page.js:528)
const total = await R.count("incident", " status_page_id = ? ", [statusPageId]);

// After
const total = await prisma.incident.count({ where: { status_page_id: statusPageId } });
```

**`R.store` → `prisma.model.create` / `update` / `upsert`**
```js
// Before (incident.js:13-14)
this.last_updated_date = R.isoDateTime(dayjs.utc());
await R.store(this);

// After — if id exists, update; if not, create
const data = {
    active: this.active,
    pin: this.pin,
    last_updated_date: dayjs.utc().toDate(),
    // ... all other fields
};
if (this.id) {
    await prisma.incident.update({ where: { id: this.id }, data });
} else {
    const created = await prisma.incident.create({ data });
    this.id = created.id;
}
```

**`R.dispense` → plain object, then `prisma.model.create`**
```js
// Before (api_key.js:62)
let bean = R.dispense("api_key");
bean.key = key.key;
bean.name = key.name;
bean.user_id = userID;
bean.active = key.active;
bean.expires = key.expires;
await R.store(bean);
return bean;

// After
const created = await prisma.apiKey.create({
    data: {
        key: key.key,
        name: key.name,
        user_id: userID,
        active: key.active,
        expires: key.expires ? new Date(key.expires) : null,
    },
});
return created; // plain POJO; callers use created.id, created.key, etc.
```

**`R.load` → `prisma.model.findUnique`**
```js
// Before
let bean = await R.load("monitor", id);

// After
const bean = await prisma.monitor.findUnique({ where: { id } });
```

**`R.trash` → `prisma.model.delete`**
```js
// Before
await R.trash(bean);

// After
await prisma.monitor.delete({ where: { id: bean.id } });
```

**`R.convertToBeans` → manual instantiation**
```js
// Before (group.js:34)
return R.convertToBeans("monitor", rows);

// After — rows from $queryRaw are plain objects; instantiate Monitor if needed
// If callers only call toPublicJSON() or toJSON(), a plain object works:
return rows; // only if callers don't call instance methods

// If callers DO call instance methods (e.g., bean.toPublicJSON()):
return rows.map(row => Object.assign(new Monitor(), row));
```

**`R.isoDateTime` / `R.isoDateTimeMillis` → ISO string or Date**
```js
// Before
this.last_updated_date = R.isoDateTime(dayjs.utc());
bean.expiry = R.isoDateTimeMillis(expiryDate);

// After — store as ISO string to match existing DB column format
this.last_updated_date = dayjs.utc().toISOString();
bean.expiry = expiryDate.toISOString();

// When writing to Prisma DateTime field, pass a Date object:
data.last_updated_date = dayjs.utc().toDate();
```

---

## 8. BeanModel Replacement Pattern

`BeanModel` provides: property auto-mapping (`this.someField` ↔ DB column), `this.id` (maps to `_id`), and the `R.store(this)` / `R.trash(this)` identity tracking.

**Rule:** Remove `extends BeanModel`. The class becomes a plain class. Static methods query Prisma directly. Instance methods that call `R.store(this)` are replaced with instance methods that build a data object and call the appropriate Prisma operation.

### Minimal example — Tag (0 R.\* usages, trivial)

```js
// Before
const { BeanModel } = require("redbean-node/dist/bean-model");

class Tag extends BeanModel {
    toJSON() {
        return { id: this._id, name: this._name, color: this._color };
    }
}

// After
class Tag {
    constructor(row) {
        Object.assign(this, row); // id, name, color come from Prisma result
    }

    toJSON() {
        return { id: this.id, name: this.name, color: this.color };
    }
}
```

Note: `BeanModel` uses underscore-prefixed accessors (`this._id`, `this._name`) when the field has a Redbean property. After migration, Prisma returns plain objects with direct property names (`this.id`, `this.name`). All `this._field` accesses must be changed to `this.field`.

### Medium example — Incident (2 R.\* usages)

```js
// Before
const { BeanModel } = require("redbean-node/dist/bean-model");
const { R } = require("redbean-node");
const dayjs = require("dayjs");

class Incident extends BeanModel {
    async resolve() {
        this.active = false;
        this.pin = false;
        this.last_updated_date = R.isoDateTime(dayjs.utc());
        await R.store(this);
    }
    toPublicJSON() { /* ... uses this.id, this.style, etc. */ }
}

// After
const { getPrisma } = require("../prisma");
const dayjs = require("dayjs");

class Incident {
    constructor(row) {
        Object.assign(this, row);
    }

    /**
     * Resolve the incident and mark it as inactive
     * @returns {Promise<void>}
     */
    async resolve() {
        this.active = false;
        this.pin = false;
        this.last_updated_date = dayjs.utc().toISOString();

        await getPrisma().incident.update({
            where: { id: this.id },
            data: {
                active: this.active,
                pin: this.pin,
                last_updated_date: this.last_updated_date,
            },
        });
    }

    toPublicJSON() {
        return {
            id: this.id,
            style: this.style,
            title: this.title,
            content: this.content,
            pin: !!this.pin,
            active: !!this.active,
            createdDate: this.created_date,
            lastUpdatedDate: this.last_updated_date,
            status_page_id: this.status_page_id,
        };
    }
}
```

### Factory helper for loading rows as class instances

When callers expect an instance (e.g., to call `.toPublicJSON()`), use a static factory:

```js
class Incident {
    /**
     * Load an Incident by ID
     * @param {number} id
     * @returns {Promise<Incident|null>}
     */
    static async load(id) {
        const row = await getPrisma().incident.findUnique({ where: { id } });
        return row ? new Incident(row) : null;
    }

    /**
     * Find incidents for a status page
     * @param {number} statusPageId
     * @returns {Promise<Incident[]>}
     */
    static async findByStatusPage(statusPageId) {
        const rows = await getPrisma().incident.findMany({
            where: { status_page_id: statusPageId },
            orderBy: { created_date: "desc" },
        });
        return rows.map(r => new Incident(r));
    }
}
```

---

## 9. Transaction Handling

`R.begin()` returns a transaction object with `.exec`, `.dispense`, `.store`, `.commit`, `.rollback`.

Prisma uses `prisma.$transaction(async (tx) => { ... })` where `tx` is a transactional PrismaClient.

### Example — status_page.js updateDomainNameList

```js
// Before
let trx = await R.begin();
await trx.exec("DELETE FROM status_page_cname WHERE status_page_id = ?", [this.id]);
try {
    for (let domain of domainNameList) {
        await trx.exec("DELETE FROM status_page_cname WHERE domain = ?", [domain]);
        let mapping = trx.dispense("status_page_cname");
        mapping.status_page_id = this.id;
        mapping.domain = domain;
        await trx.store(mapping);
    }
    await trx.commit();
} catch (error) {
    await trx.rollback();
    throw error;
}

// After
const { Prisma } = require("@prisma/client");
await getPrisma().$transaction(async (tx) => {
    await tx.$executeRaw(Prisma.sql`DELETE FROM status_page_cname WHERE status_page_id = ${this.id}`);
    for (let domain of domainNameList) {
        if (typeof domain !== "string" || domain.trim() === "") {
            continue;
        }
        await tx.$executeRaw(Prisma.sql`DELETE FROM status_page_cname WHERE domain = ${domain}`);
        await tx.statusPageCname.create({
            data: { status_page_id: this.id, domain },
        });
    }
    // No explicit commit/rollback — $transaction handles it automatically
});
```

---

## 10. Relations Handling

Redbean-node lazy-loads relations on demand via `R.find(relatedTable, "foreign_key = ?", [id])`. After migration:

- **Explicit JOIN queries** using `$queryRaw` stay as-is (see `group.js` example in section 7).
- **Prisma include** can replace multi-step loads:

```js
// Example: load a monitor with its tags in one query
const monitor = await prisma.monitor.findUnique({
    where: { id: monitorId },
    include: { monitor_tags: { include: { tag: true } } },
});
```

- Only add `include` where a file already performs the join; do not speculatively add `include` to every query — keep the query surface minimal.
- Many-to-many bridging tables (`monitor_tag`, `monitor_group`, `monitor_notification`, `monitor_maintenance`) must be explicit models in `schema.prisma` since they carry extra columns (`send_url`, `weight`, etc.).

---

## 11. Raw SQL Handling

Use `$executeRaw` / `$queryRaw` with the `Prisma.sql` tagged template for parameterised queries. Never concatenate user input into SQL strings.

```js
const { Prisma } = require("@prisma/client");

// Read — returns array of plain objects
const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT * FROM heartbeat
    WHERE monitor_id = ${monitorId}
    ORDER BY time DESC
    LIMIT ${limit}
`);

// Write — returns count of affected rows
const affected = await prisma.$executeRaw(Prisma.sql`
    UPDATE user SET password = ${hash} WHERE id = ${userId}
`);
```

`$queryRawUnsafe` and `$executeRawUnsafe` accept a plain string and are the last resort for truly dynamic SQL (e.g., runtime-constructed ORDER BY). They must never receive user-controlled input without validation.

```js
// Acceptable — column name is from an internal constant, never user input
const col = "ping"; // validated against whitelist before this point
const rows = await prisma.$queryRawUnsafe(
    `SELECT ${col} FROM heartbeat WHERE monitor_id = ?`, monitorId
);
```

---

## 12. Model-by-Model Migration Order

### Phase 1 — Setup (no production code changed)

1. Install `@prisma/client` and `prisma` dev dependency.
2. Write `prisma/schema.prisma` derived from all 49 Knex migrations.
3. Run `npx prisma generate`.
4. Create `server/prisma.js` singleton.
5. Verify: `node -e "require('./server/prisma').getPrisma()"` exits 0.

### Phase 2 — Small models (0–2 R.\* usages)

Order and rationale — fewest dependencies, safest to break in isolation:

| File | R.\* count | Notes |
|------|-----------|-------|
| `server/model/tag.js` | 0 | Only `extends BeanModel`; trivial drop-in |
| `server/model/proxy.js` | 0 | Only `extends BeanModel` |
| `server/model/docker_host.js` | 0 | Only `extends BeanModel` |
| `server/model/remote_browser.js` | 0 | Only `extends BeanModel` |
| `server/model/group.js` | 2 | `R.convertToBeans` + `R.getAll` |
| `server/model/incident.js` | 2 | `R.isoDateTime` + `R.store` |

### Phase 3 — Medium models

| File | R.\* count | Notes |
|------|-----------|-------|
| `server/model/api_key.js` | 2 | `R.dispense` + `R.store` in `APIKey.save()` |
| `server/model/user.js` | 2 | Two `R.exec` UPDATE calls |
| `server/model/heartbeat.js` | 0 | Only `extends BeanModel`; but called heavily from monitor.js — migrate after monitor |
| `server/model/maintenance.js` | 2 | `R.getAll` (PRAGMA lines) + 1 `R.find` |

### Phase 4 — Complex models

| File | R.\* count | Notes |
|------|-----------|-------|
| `server/model/domain_expiry.js` | 6 | `R.findOne`, `R.dispense`, `R.isoDateTimeMillis` ×2, `R.store` ×2 |
| `server/model/status_page.js` | 15 | Transaction (`R.begin`), `R.getAssoc`, `R.findAll`, `R.count`, `R.getCol` |
| `server/model/monitor.js` | 28 | Largest file; `R.dispense` of heartbeat, `R.isoDateTimeMillis`, nested calls |

### Phase 5 — Server files

Migrate after all models are done so models can be called via Prisma consistently:

| File | R.\* count | Notes |
|------|-----------|-------|
| `server/auth.js` | 3 | `R.findOne` user lookup, `R.exec` password update, `R.findOne` api_key |
| `server/2fa.js` | 1 | Single `R.exec` UPDATE |
| `server/settings.js` | 8 | Mixed reads/writes |
| `server/notification.js` | 9 | `R.findOne`, `R.store`, etc. |
| `server/proxy.js` | 10 | `R.find`, `R.store`, `R.trash` |
| `server/remote-browser.js` | 7 | `R.find`, `R.store`, `R.trash` |
| `server/docker.js` | 6 | `R.find`, `R.store` |
| `server/uptime-calculator.js` | 22 | Heavy read queries |
| `server/server.js` | 42 | Largest server file; do last |
| `server/socket-handlers/status-page-socket-handler.js` | 29 | |
| `server/socket-handlers/maintenance-socket-handler.js` | 15 | |
| `server/socket-handlers/api-key-socket-handler.js` | 3 | |

### Phase 6 — Cleanup

1. Remove `redbean-node` from `package.json`.
2. Remove `R.setup`, `R.freeze`, `R.autoloadModels`, `R.debug`, `R.close` calls from `server/database.js`.
3. Remove `knex` setup code from `database.js` if Knex is only used for migrations (keep Knex if migrations still run via Knex at startup — check `database.js`).
4. Remove `server/model` from `R.autoloadModels` path (no longer needed).
5. Add `disconnectPrisma()` call to graceful shutdown in `server/server.js`.
6. Run full lint, build, and test suite.

---

## 13. How to Keep the System Shippable During Migration

1. **Never remove `R.setup` until Phase 6.** The `R.setup(knexInstance)` call in `database.js` stays active as long as any file still imports from `redbean-node`.

2. **Never delete `redbean-node` from `package.json` until all imports are removed.** Both packages coexist in `node_modules`.

3. **Migrated files import `getPrisma()`; unmigrated files import `R`.** There is no shared state between them; they talk to the same SQLite file independently.

4. **Test after every file migration.** `npm run test-backend` must pass. Spot-test the specific feature in development with `npm run dev`.

5. **Keep `R.autoloadModels("./server/model")` working.** During Phase 2–4, some model classes in `./server/model` no longer extend `BeanModel`. `R.autoloadModels` will skip classes that don't extend `BeanModel` — that is the desired behaviour, not an error.

6. **Do not change callers until the callee is migrated.** If `server.js` calls `Monitor.load(id)` and `Monitor` is being migrated, `Monitor.load` must still return an object with the same shape. Use the `Object.assign(new Monitor(), row)` pattern to preserve instance method availability.

---

## 14. File-by-File Migration Plan

| File | Phase | Key R methods | Complexity |
|------|-------|--------------|-----------|
| `server/model/tag.js` | 2 | (none — only BeanModel) | Low |
| `server/model/proxy.js` | 2 | (none — only BeanModel) | Low |
| `server/model/docker_host.js` | 2 | (none — only BeanModel) | Low |
| `server/model/remote_browser.js` | 2 | (none — only BeanModel) | Low |
| `server/model/group.js` | 2 | `R.convertToBeans`, `R.getAll` | Low |
| `server/model/incident.js` | 2 | `R.isoDateTime`, `R.store` | Low |
| `server/model/api_key.js` | 3 | `R.dispense`, `R.store` | Medium |
| `server/model/user.js` | 3 | `R.exec` ×2 | Medium |
| `server/model/heartbeat.js` | 3 | (none — only BeanModel, but used by monitor.js) | Medium |
| `server/model/maintenance.js` | 3 | `R.getAll`, `R.find`, `R.isoDateTimeMillis` | Medium |
| `server/model/domain_expiry.js` | 4 | `R.findOne`, `R.dispense`, `R.isoDateTimeMillis`, `R.store` | Medium-High |
| `server/model/status_page.js` | 4 | `R.begin`, `R.getAssoc`, `R.findAll`, `R.find`, `R.count`, `R.getCol`, `R.getCell`, `R.findOne` | High |
| `server/model/monitor.js` | 4 | `R.dispense` (heartbeat, tls_info), `R.isoDateTimeMillis`, `R.findOne`, `R.find`, `R.getAll`, `R.exec` | Very High |
| `server/auth.js` | 5 | `R.findOne` ×2, `R.exec` | Low |
| `server/2fa.js` | 5 | `R.exec` | Low |
| `server/settings.js` | 5 | `R.findOne`, `R.store`, `R.exec` | Medium |
| `server/notification.js` | 5 | `R.findOne`, `R.store`, `R.find`, `R.trash` | Medium |
| `server/proxy.js` | 5 | `R.find`, `R.store`, `R.trash`, `R.findOne` | Medium |
| `server/remote-browser.js` | 5 | `R.find`, `R.store`, `R.trash` | Medium |
| `server/docker.js` | 5 | `R.find`, `R.store` | Medium |
| `server/uptime-calculator.js` | 5 | `R.getAll`, `R.getRow`, `R.find`, `R.exec` ×many | High |
| `server/socket-handlers/api-key-socket-handler.js` | 5 | `R.findOne`, `R.store`, `R.trash` | Low |
| `server/socket-handlers/maintenance-socket-handler.js` | 5 | `R.find`, `R.store`, `R.trash`, `R.dispense` | Medium |
| `server/socket-handlers/status-page-socket-handler.js` | 5 | `R.findOne`, `R.find`, `R.store`, `R.trash`, `R.dispense`, `R.exec` | High |
| `server/server.js` | 5 | `R.findOne` ×many, `R.store`, `R.exec`, `R.find`, `R.dispense` | Very High |
| `server/database.js` | 6 | `R.setup`, `R.freeze`, `R.autoloadModels`, `R.debug`, `R.close` | Cleanup only |

---

## 15. Fallback Strategy

If a phase produces bugs that cannot be fixed quickly:

1. **Per-file revert:** Each file migration is a separate commit. `git revert <commit>` restores the single file to its R.\* form without touching other migrated files.

2. **Emergency switch:** Because both `redbean-node` and `@prisma/client` are in `package.json` throughout Phase 2–5, reverting any file to R.\* usage is safe as long as `R.setup` is still called in `database.js`.

3. **Branch reset to Phase 1:** If multiple models are broken, reset the branch to the last known-good Phase 1 commit (post-setup, pre-model-migration) and redo from there.

4. **Never cherry-pick partial phase changes to master.** If `master` needs a hotfix during migration, apply the fix to `master` and `git merge master` into `prisma-migration`.

---

## 16. Definition of Done / Merge Criteria

All of the following must be true before opening a PR from `prisma-migration` to `master`:

- [ ] Zero `require("redbean-node")` imports anywhere in `server/` (verified with `grep -r "redbean-node" server/`)
- [ ] Zero `R\.` usages anywhere in `server/` (verified with `grep -rn "R\." server/ --include="*.js"` returns no redbean calls)
- [ ] `redbean-node` removed from `package.json` `dependencies`
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run build` succeeds
- [ ] `npm run test-backend` passes (all existing tests green)
- [ ] Manual smoke test: server starts, a monitor is created, a heartbeat is recorded, status page loads
- [ ] `prisma generate` runs without errors from a clean checkout
- [ ] `.env` is in `.gitignore` and no secrets are committed
- [ ] `disconnectPrisma()` is called in the `server.js` graceful shutdown handler
- [ ] All public method signatures on every model class are identical to the pre-migration signatures (diff checked against `master`)
- [ ] Code review sign-off from at least one other contributor
