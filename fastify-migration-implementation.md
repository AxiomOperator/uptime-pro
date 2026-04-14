# Fastify Migration Implementation Guide

Detailed implementation order, file-by-file changes, and strategy decisions.

---

## Implementation Order

```
Pre-Phase 1:  npm install @fastify/socket.io  ← unblocks everything
Phase 1a:     Rewrite server/uptime-kuma-server.js (Fastify init + Socket.IO)
Phase 1b:     Rewrite server/setup-database.js (standalone setup wizard)
Phase 1c:     Rewrite server/utils/simple-migration-server.js (migration status server)
Phase 1d:     Convert server/routers/api-router.js to Fastify plugin
Phase 1e:     Convert server/routers/status-page-router.js to Fastify plugin
Phase 1f:     Rewrite server/auth.js (replace express-basic-auth preHandler)
Phase 1g:     Rewrite server/server.js (main bootstrap)
Phase 1h:     Remove server/modules/apicache/ directory
Phase 1i:     Update package.json (remove express-basic-auth after auth rewrite)
Phase 1 test: npm run test-backend — must be green
Phase 2:      @fastify/swagger + schemas on all existing routes
Phase 3:      server/middleware/auth.js + server/routes/api/v1/*
Phase 4:      @fastify/rate-limit, @fastify/helmet, dead code removal
```

Order rationale: `uptime-kuma-server.js` must change first because `server.js` imports
`UptimeKumaServer.getInstance()` at line 105 and then aliases `server.app` as `app`. Once
`uptime-kuma-server.js` exports a Fastify instance as `app`, the rest of `server.js` can
be rewritten against the Fastify API.

---

## Dependency Install / Remove Plan

```bash
# Phase 1 — missing critical package
npm install @fastify/socket.io

# Phase 2 — OpenAPI
npm install @fastify/swagger @fastify/swagger-ui

# Phase 4 — hardening
npm install @fastify/rate-limit @fastify/helmet

# Phase 1 / 3 — remove express remnant (after auth.js rewrite)
npm uninstall express-basic-auth
```

Already in `package.json` (no install needed):

| Package | Installed version |
|---|---|
| `fastify` | ^5.8.4 |
| `@fastify/compress` | — |
| `@fastify/cors` | — |
| `@fastify/formbody` | — |
| `@fastify/static` | — |

Already removed from `package.json` (no action needed):

| Package | Notes |
|---|---|
| `express` | Removed; still required in 6 source files — code must catch up |
| `express-static-gzip` | Removed; still required in 2 source files |
| `apicache` (npm) | Was never in package.json; local copy at `server/modules/apicache/` |

---

## File-by-File Change Plan

### `server/uptime-kuma-server.js`

**Why:** This is the singleton that owns `app`, `httpServer`, and `io`. Everything else depends on it.

**Changes:**

1. Remove `const express = require("express")`, `const http = require("http")`,
   `const https = require("https")`.
2. Add `const Fastify = require("fastify")`.
3. Replace constructor body's Express+http.Server block:

   ```js
   // Before
   this.app = express();
   this.httpServer = isSSL
       ? https.createServer({ key, cert, passphrase }, this.app)
       : http.createServer(this.app);

   // After
   this.app = Fastify({
       logger: false,
       ...(isSSL ? { https: { key: fs.readFileSync(sslKey), cert: fs.readFileSync(sslCert) } } : {}),
   });
   this.httpServer = this.app.server; // Fastify exposes underlying http.Server here
   ```

4. Register `@fastify/socket.io` FIRST, before any routes, preserving the `allowRequest` callback:

   ```js
   let cors = isDev ? { origin: "*" } : undefined;
   await this.app.register(require("@fastify/socket.io"), {
       cors,
       allowRequest: async (req, callback) => { /* existing origin check logic — unchanged */ },
   });
   this.io = this.app.io;
   ```

   **Critical:** `await this.app.register(...)` must complete before any code accesses `this.io`.
   Wrap the constructor body in an async factory or make `getInstance()` async.

5. Remove `const { Server } = require("socket.io")`.

**Side effect:** `UptimeKumaServer.getInstance()` is called synchronously in many places.
If the constructor needs `await`, use a two-step pattern:

```js
static async createInstance() {
    if (!UptimeKumaServer.instance) {
        UptimeKumaServer.instance = new UptimeKumaServer();
        await UptimeKumaServer.instance.registerPlugins();
    }
    return UptimeKumaServer.instance;
}
```

And call `await UptimeKumaServer.createInstance()` at the top of `server.js`.

---

### `server/setup-database.js`

**Why:** Uses `express` and `express-static-gzip`, both absent from node_modules. Server fails
to start if a DB setup is needed.

**Changes:**

Replace the Express-based `SetupDatabase` HTTP server with a plain `http.createServer` approach
(preferred for simplicity — this is a one-page wizard with minimal routing needs):

```js
const http = require("http");
const fs = require("fs");
const path = require("path");

// In start() method:
const server = http.createServer((req, res) => {
    if (req.url === "/" || req.url === "/index.html") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(fs.readFileSync(path.join(__dirname, "../extra/setup-database.html")));
    } else if (req.url.startsWith("/api/")) {
        // route JSON API calls
    } else {
        res.writeHead(404); res.end();
    }
});
```

Alternatively, use a minimal Fastify instance — but plain `http` is simpler for this use case.

---

### `server/utils/simple-migration-server.js`

**Why:** Uses `express`, absent from node_modules. Used during DB migrations.

**Changes:**

Rewrite using plain `http.createServer`. This server only serves a simple HTML status page and
one JSON endpoint — no framework required:

```js
const http = require("http");

class SimpleMigrationServer {
    start(port, hostname) {
        return new Promise((resolve) => {
            this.server = http.createServer((req, res) => {
                if (req.url === "/") {
                    res.writeHead(200, { "Content-Type": "text/html" });
                    res.end(this.getHTML());
                } else {
                    res.writeHead(404); res.end();
                }
            });
            this.server.listen(port, hostname, resolve);
        });
    }
}
```

---

### `server/routers/api-router.js`

**Why:** Express Router with `apicache` middleware. Must become a Fastify plugin.

**Route conversion strategy (Express Router → Fastify plugin):**

```js
// Before
let router = express.Router();
router.get("/api/entry-page", async (request, response) => {
    response.json(result);
});
module.exports = router;

// After
module.exports = async function apiRouterPlugin(fastify, opts) {
    fastify.get("/api/entry-page", async (request, reply) => {
        return result;  // Fastify auto-serializes returned objects
    });
};
```

**apicache → Fastify caching strategy:**

`apicache.middleware` wraps `res.json()` to intercept and cache the response. Replace each
`cache("5 minutes")` call with a Fastify `onSend` hook or a simple in-memory TTL map:

```js
// Simple in-memory TTL cache hook (Phase 1 approach)
const ttlCache = new Map();

function cacheHook(ttlMs) {
    return {
        onSend: async (request, reply, payload) => {
            ttlCache.set(request.url, { payload, expires: Date.now() + ttlMs });
            return payload;
        },
        onRequest: async (request, reply) => {
            const cached = ttlCache.get(request.url);
            if (cached && Date.now() < cached.expires) {
                reply.send(cached.payload);
            }
        },
    };
}

// Usage per route:
fastify.get("/api/badge/:id/status", {
    onRequest: cacheHook(5 * 60 * 1000).onRequest,
    onSend: cacheHook(5 * 60 * 1000).onSend,
    handler: async (request, reply) => { ... }
});
```

For Phase 1 simplicity, a shared `Map`-based cache keyed by URL is sufficient. Phase 4 can
upgrade to `@fastify/caching` with `abstract-cache`.

**Cache invalidation** (replaces `apicache.clear()` at `server.js:1193`):

```js
// Add to the cache module or server context
function clearCache() {
    ttlCache.clear();
}
```

Call `clearCache()` where `apicache.clear()` was previously called.

**`io` reference in push handler:**

`api-router.js` line 27: `let io = server.io` — captured at module load time.  
After Fastify migration, `server.io` is set after `@fastify/socket.io` registration.  
**Fix:** Make the `io` reference lazy:

```js
function getIO() {
    return UptimeKumaServer.getInstance().io;
}
// Use getIO() inside route handlers instead of the cached `io` variable
```

**`ALL` method handler:**

Express `router.all(...)` maps to Fastify:

```js
fastify.route({
    method: ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"],
    url: "/api/push/:pushToken",
    handler: async (request, reply) => { ... }
});
```

---

### `server/routers/status-page-router.js`

**Why:** Same Express Router pattern as `api-router.js`.

**Changes:** Same conversion strategy as `api-router.js`:
- Convert to Fastify plugin
- Remove `apicache` middleware calls, replace with TTL cache hook
- Replace `response.json(...)` with `return result` or `reply.send(result)`
- Replace `sendHttpError(response, msg)` with:
  ```js
  reply.code(500).send({ ok: false, msg });
  ```

---

### `server/auth.js`

**Why:** `apiAuth` and `basicAuth` are Express-style `(req, res, next)` middleware using
`express-basic-auth`. Must become Fastify preHandler functions.

**Rewrite `apiAuth` as Fastify preHandler:**

```js
exports.apiAuth = async function (request, reply) {
    const disabledAuth = await Settings.get("disableAuth");
    if (disabledAuth) return; // pass

    const authHeader = request.headers["authorization"] || "";

    if (await Settings.get("apiKeysEnabled")) {
        // API key mode: accept Bearer or Basic with API key as password
        const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
        const basicMatch = authHeader.startsWith("Basic ")
            ? Buffer.from(authHeader.slice(6), "base64").toString().split(":")[1]
            : null;
        const key = bearer || basicMatch;
        if (!key || !(await verifyAPIKey(key))) {
            reply.code(401).header("WWW-Authenticate", "Basic").send("Unauthorized");
        }
    } else {
        // Basic auth mode: username:password against user table
        if (!authHeader.startsWith("Basic ")) {
            reply.code(401).header("WWW-Authenticate", "Basic").send("Unauthorized");
            return;
        }
        const [username, password] = Buffer.from(authHeader.slice(6), "base64")
            .toString()
            .split(":", 2);
        const user = await login(username, password);
        if (!user) {
            reply.code(401).header("WWW-Authenticate", "Basic").send("Unauthorized");
        }
    }
};
```

**`prometheus-api-metrics` replacement:**

`prometheusAPIMetrics()` returns an Express handler. Replacement options:

1. **Preferred:** Use `prom-client` directly. Register a Fastify route that calls
   `register.metrics()`:

   ```js
   const { register } = require("prom-client");
   fastify.get("/metrics", { preHandler: apiAuth }, async (request, reply) => {
       reply.type(register.contentType).send(await register.metrics());
   });
   ```

2. **Temporary bridge:** Use `middie` (Fastify Express middleware compatibility layer) to wrap
   the Express handler — but this adds a dependency and is not recommended long-term.

---

### `server/server.js`

**Why:** Main bootstrap file; currently registers all Express routes and starts the server.

**Key structural changes:**

#### Fastify plugin registration order (critical)

```js
// 1. @fastify/socket.io — MUST be first (done in uptime-kuma-server.js constructor)
// 2. @fastify/cors
await app.register(require("@fastify/cors"), {
    origin: isDev ? "*" : false,
});
// 3. @fastify/compress
await app.register(require("@fastify/compress"));
// 4. @fastify/formbody (dev only, for urlencoded body)
if (isDev) {
    await app.register(require("@fastify/formbody"));
}
// 5. @fastify/static (Vue SPA — must have wildcard fallback AFTER route registration)
await app.register(require("@fastify/static"), {
    root: path.join(__dirname, "../dist"),
    prefix: "/",
    decorateReply: true,
});
// 6. @fastify/static (upload dir)
await app.register(require("@fastify/static"), {
    root: Database.uploadDir,
    prefix: "/upload",
    decorateReply: false, // second registration must set this
});
// 7. route plugins
await app.register(require("./routers/api-router"));
await app.register(require("./routers/status-page-router"));
```

#### Static file serving strategy

`@fastify/static` serves files from `dist/`. For pre-compressed Brotli/gzip files:
- `@fastify/compress` handles on-the-fly compression for non-pre-compressed responses.
- Pre-compressed `.br`/`.gz` files in `dist/` are NOT automatically served by `@fastify/static`.
- **Decision for Phase 1:** Use on-the-fly compression via `@fastify/compress`. The build already
  generates pre-compressed files via `vite-plugin-compression`, but serving them requires custom
  logic. On-the-fly is acceptable for initial migration.
- **Phase 4 improvement:** If pre-compressed serving is needed for performance, implement a custom
  `onRequest` hook that rewrites the request URL to `.br`/`.gz` if the client accepts brotli/gzip
  and the pre-compressed file exists.

#### Graceful shutdown

```js
// Before (line 2003)
gracefulShutdown(server.httpServer, { ... });

// After
gracefulShutdown(app.server, { ... });
// server.httpServer is still valid (it equals app.server after migration)
```

#### Universal fallback (SPA handler)

```js
// Before
app.get("*", async (_request, response) => {
    if (_request.originalUrl.startsWith("/upload/")) {
        response.status(404).send("File not found.");
    } else {
        response.send(server.indexHTML);
    }
});

// After — Fastify setNotFoundHandler
app.setNotFoundHandler(async (request, reply) => {
    if (request.url.startsWith("/upload/")) {
        reply.code(404).send("File not found.");
    } else {
        reply.type("text/html").send(server.indexHTML);
    }
});
```

#### Dev-only routes

```js
if (isDev) {
    await app.register(require("@fastify/formbody"));

    app.post("/test-webhook", async (request, reply) => {
        log.debug("test", request.headers);
        log.debug("test", request.body);
        reply.send("OK");
    });

    app.post("/test-x-www-form-urlencoded", async (request, reply) => {
        log.debug("test", request.headers);
        log.debug("test", request.body);
        reply.send("OK");
    });

    app.get("/_e2e/take-sqlite-snapshot", async (request, reply) => {
        await Database.close();
        fs.cpSync(Database.sqlitePath, `${Database.sqlitePath}.e2e-snapshot`);
        await Database.connect();
        reply.send("Snapshot taken.");
    });

    app.get("/_e2e/restore-sqlite-snapshot", async (request, reply) => {
        if (!fs.existsSync(`${Database.sqlitePath}.e2e-snapshot`)) {
            throw new Error("Snapshot doesn't exist.");
        }
        await Database.close();
        fs.cpSync(`${Database.sqlitePath}.e2e-snapshot`, Database.sqlitePath);
        await Database.connect();
        reply.send("Snapshot restored.");
    });
}
```

#### Prometheus metrics route

```js
const { register: promRegister } = require("prom-client");

app.get("/metrics", { preHandler: apiAuth }, async (request, reply) => {
    reply.type(promRegister.contentType).send(await promRegister.metrics());
});
```

Remove `require("prometheus-api-metrics")` from imports.

---

### `server/middleware/auth.js` (new file — Phase 3)

**Bearer token preHandler for `/api/v1/` routes:**

```js
const { getPrisma } = require("../prisma");
const { verifyAPIKey } = require("../auth");

module.exports = async function bearerAuth(request, reply) {
    const authHeader = request.headers["authorization"] || "";
    if (!authHeader.startsWith("Bearer ")) {
        return reply.code(401).send({ ok: false, msg: "Unauthorized" });
    }
    const key = authHeader.slice(7);
    const result = await verifyAPIKey(key);
    if (!result) {
        return reply.code(401).send({ ok: false, msg: "Unauthorized" });
    }
    // Attach userId to request context for route handlers
    request.userId = result.userId;
};
```

---

### `server/routes/api/v1/*.js` (new files — Phase 3)

**Plugin structure pattern:**

```js
// server/routes/api/v1/monitors.js
const Monitor = require("../../../model/monitor");
const { getPrisma } = require("../../../prisma");

module.exports = async function monitorsPlugin(fastify, opts) {
    fastify.get("/monitors", async (request, reply) => {
        const prisma = getPrisma();
        const monitors = await prisma.monitor.findMany({
            where: { userId: request.userId },
        });
        return { ok: true, monitors };
    });

    fastify.get("/monitors/:id", async (request, reply) => {
        // ... same logic as getMonitor socket event
    });

    // etc.
};
```

Each v1 plugin is registered in `server.js` with a shared `preHandler`:

```js
const bearerAuth = require("./middleware/auth");

await app.register(require("./routes/api/v1/monitors"), {
    prefix: "/api/v1",
    preHandler: bearerAuth,
});
```

---

### `server/modules/apicache/` (delete)

Delete the entire directory. No replacement module is needed — the TTL cache hooks inline
in the route files replace the functionality.

---

## Swagger / OpenAPI Rollout Strategy (Phase 2)

```js
// Register BEFORE route plugins in server.js
await app.register(require("@fastify/swagger"), {
    openapi: {
        info: {
            title: "Uptime Pro API",
            description: "REST API for Uptime Pro",
            version: "1.0.0",
        },
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: "http",
                    scheme: "bearer",
                },
            },
        },
    },
});

await app.register(require("@fastify/swagger-ui"), {
    routePrefix: "/docs",
    uiConfig: { docExpansion: "list" },
});
```

Add `schema` objects to each route in the plugin files:

```js
fastify.get("/api/entry-page", {
    schema: {
        description: "Get the entry page configuration",
        tags: ["public"],
        response: {
            200: {
                type: "object",
                properties: {
                    type: { type: "string" },
                    entryPage: { type: "string" },
                    statusPageSlug: { type: "string" },
                },
            },
        },
    },
    handler: async (request, reply) => { ... }
});
```

---

## Rate Limit and Helmet Rollout Strategy (Phase 4)

```js
// Rate limit — register before route plugins
await app.register(require("@fastify/rate-limit"), {
    max: 60,
    timeWindow: "1 minute",
    // Only apply to /api/v1/ routes
    skipOnRoutes: (req) => !req.url.startsWith("/api/v1/"),
});

// Helmet — register before route plugins
await app.register(require("@fastify/helmet"), {
    contentSecurityPolicy: false, // CSP needs app-specific config for Vue
});
```

Stricter rate limit on auth-sensitive endpoints (register BEFORE the global rate limit):

```js
await app.register(require("@fastify/rate-limit"), {
    max: 5,
    timeWindow: "1 minute",
    keyGenerator: (req) => req.ip,
    // Only for specific routes — handled per-route via routeConfig
});
```

---

## Known Tricky Areas and Mitigations

### 1. `apicache` wrapping `res.json`

**Problem:** `apicache.middleware` patches `res.json` to intercept the response body. In Fastify,
`reply.send()` is not patchable the same way.  
**Mitigation:** Replace with a simple `Map`-based TTL cache keyed by URL (see api-router.js section
above). For Phase 1, accuracy is preferred over performance — on a miss, the route handler runs
normally.

### 2. `expressStaticGzip` serving pre-compressed files

**Problem:** `expressStaticGzip("dist", { enableBrotli: true })` transparently serves `file.js.br`
when the client sends `Accept-Encoding: br`. `@fastify/static` does not do this.  
**Mitigation Phase 1:** Use `@fastify/compress` for on-the-fly compression. Slightly less efficient
but functionally equivalent.  
**Mitigation Phase 4 (optional):** Add an `onRequest` hook that checks for pre-compressed files:
```js
fastify.addHook("onRequest", async (request, reply) => {
    const ae = request.headers["accept-encoding"] || "";
    if (ae.includes("br") && fs.existsSync(`dist${request.url}.br`)) {
        request.url = request.url + ".br";
        reply.header("Content-Encoding", "br");
    }
});
```

### 3. Graceful shutdown server reference

**Problem:** `gracefulShutdown(server.httpServer, {...})` at `server.js:2003`. After migration,
`server.httpServer` must equal `fastify.server`.  
**Mitigation:** In `uptime-kuma-server.js` constructor: `this.httpServer = this.app.server`.
No change needed at the call site in `server.js` since `server.httpServer` is still valid.

### 4. Dev-only routes

**Problem:** `/test-x-www-form-urlencoded` requires `express.urlencoded()` which is Express-only.  
**Mitigation:** Register `@fastify/formbody` inside the `isDev` block before the dev routes.
`request.body` will then contain parsed form data (same API as Express urlencoded).

### 5. CORS consolidation

**Problem:** `allowDevAllOrigin(response)` and `allowAllOrigin(response)` are called per-route
(13+ call sites across 2 router files). They call Express `res.header(...)`.  
**Mitigation Phase 1:** Consolidate all CORS into `@fastify/cors` plugin with:
```js
origin: isDev ? "*" : (origin, cb) => cb(null, false)
```
Remove all per-route `allowDevAllOrigin` / `allowAllOrigin` calls. The `util-server.js` helpers
can be kept but deprecated (they won't be called by Fastify routes).

### 6. `UptimeKumaServer` constructor async issue

**Problem:** `@fastify/socket.io` registration is async (`await fastify.register(...)`), but the
`UptimeKumaServer` constructor is synchronous. `io` will be undefined until the plugin registers.  
**Mitigation:** Move plugin registration out of the constructor into a separate `async initialize()`
method. Call it from `server.js` before any route registration:
```js
const server = UptimeKumaServer.getInstance();
await server.initialize(); // registers @fastify/socket.io, sets this.io
const io = server.io;
const app = server.app;
```

### 7. `express-basic-auth` in metrics route

**Problem:** `server/auth.js` `apiAuth` uses `express-basic-auth` which is an Express
`(req, res, next)` middleware.  
**Mitigation:** Rewrite as a Fastify `preHandler` (see auth.js section above). The logic is
simple: check `Authorization` header, validate credentials, return 401 on failure.

### 8. `prometheus-api-metrics` Express middleware

**Problem:** `prometheusAPIMetrics()` returns an Express handler. Cannot be used directly in Fastify.  
**Mitigation:** Replace with a direct `prom-client` Fastify route handler (see server.js section).
The `prometheus-api-metrics` package wraps `prom-client` — using `prom-client` directly provides
the same Prometheus exposition format with no Express dependency.
