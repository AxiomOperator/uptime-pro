# Fastify Migration Checklist

Based on the audit in `fastify-migration-review.md` and the plan in `fastify-migration.md`.

Legend: 🔴 Blocking (must complete before next phase) | 🟡 Non-blocking (can defer or run in parallel)

---

## Pre-Phase 1: Unblock the Repo (CRITICAL — server currently cannot start)

- [ ] 🔴 Run `npm install @fastify/socket.io` — package is missing from `package.json` and `node_modules`
- [ ] 🔴 Verify `@fastify/socket.io` supports Fastify v5 (installed: `fastify ^5.8.4`)
- [ ] 🔴 Confirm `express` and `express-static-gzip` are fully absent from `node_modules` (transitive dep check)

---

## Phase 1 — Replace Express with Fastify

### 1.1 — `server/uptime-kuma-server.js`

- [ ] 🔴 Remove `const express = require("express")` (line 1)
- [ ] 🔴 Remove `const http = require("http")` and `const https = require("https")` (used only for createServer)
- [ ] 🔴 Replace `this.app = express()` (line 87) with `const Fastify = require("fastify"); this.app = Fastify({ logger: false })`
- [ ] 🔴 Replace `http.createServer(this.app)` / `https.createServer({...}, this.app)` with `this.app.server` (Fastify exposes its `http.Server` as `fastify.server`)
- [ ] 🔴 Assign `this.httpServer = this.app.server` after Fastify is created
- [ ] 🔴 Register `@fastify/socket.io` on the Fastify instance BEFORE any route plugins: `await this.app.register(require("@fastify/socket.io"), { cors, allowRequest: ... })`
- [ ] 🔴 Replace `this.io = new Server(this.httpServer, {...})` with `this.io = this.app.io` (after plugin registration)
- [ ] 🔴 Preserve the full `allowRequest` WebSocket origin-check callback in the `@fastify/socket.io` options
- [ ] 🔴 Remove `const { Server } = require("socket.io")` — Socket.IO is now managed by the plugin

### 1.2 — `server/server.js`

- [ ] 🔴 Remove `const express = require("express")` (line 84)
- [ ] 🔴 Remove `const expressStaticGzip = require("express-static-gzip")` (line 85)
- [ ] 🔴 Remove `app.use(express.json())` (line 204) — Fastify parses JSON by default
- [ ] 🔴 Remove `app.use(express.urlencoded(...))` (line 289, dev-only) — replace with conditional `@fastify/formbody` registration
- [ ] 🔴 Register `@fastify/cors` plugin with `origin: isDev ? "*" : false` — replaces per-route `allowDevAllOrigin` calls
- [ ] 🔴 Register `@fastify/compress` plugin — replaces `expressStaticGzip`
- [ ] 🔴 Register `@fastify/static` plugin with `root: path.join(__dirname, "../dist"), prefix: "/"` — replaces `expressStaticGzip("dist")`
- [ ] 🔴 Register `@fastify/static` plugin with `root: Database.uploadDir, prefix: "/upload"` (second static instance needs `decorateReply: false`)
- [ ] 🔴 Convert `app.get("/")` entry-page handler to `app.get("/", async (request, reply) => { ... reply.redirect(...) })` — note: `reply.redirect` not `response.redirect`
- [ ] 🔴 Convert `app.get("/setup-database-info", ...)` to Fastify route
- [ ] 🔴 Convert `app.get("/robots.txt", ...)` to Fastify route
- [ ] 🔴 Convert `app.get("/metrics", apiAuth, prometheusAPIMetrics())` — replace `apiAuth` and `prometheusAPIMetrics()` with Fastify-compatible equivalents (see Section 1.6)
- [ ] 🔴 Convert `app.get("/.well-known/change-password", ...)` to Fastify route
- [ ] 🔴 Convert dev-only routes (`/test-webhook`, `/test-x-www-form-urlencoded`, `/_e2e/take-sqlite-snapshot`, `/_e2e/restore-sqlite-snapshot`) to Fastify routes inside an `isDev` conditional block
- [ ] 🔴 Replace `app.use(apiRouter)` with `app.register(require("./routers/api-router"))` (after conversion in 1.3)
- [ ] 🔴 Replace `app.use(statusPageRouter)` with `app.register(require("./routers/status-page-router"))` (after conversion in 1.4)
- [ ] 🔴 Convert wildcard fallback `app.get("*", ...)` to `app.setNotFoundHandler(async (request, reply) => { ... reply.send(server.indexHTML) })`
- [ ] 🔴 Replace all `res.json(...)` → `reply.send(...)`, `res.status(x).json(...)` → `reply.code(x).send(...)`, `res.send(...)` → `reply.send(...)`
- [ ] 🔴 Replace all `request.hostname` with `request.hostname` (same) and `request.headers["x-forwarded-host"]` (same)
- [ ] 🔴 Change `gracefulShutdown(server.httpServer, {...})` (line 2003) to `gracefulShutdown(app.server, {...})` — `server.httpServer` is now `app.server`
- [ ] 🔴 Replace `apicache.clear()` call (line 1193) with Fastify cache-invalidation equivalent

### 1.3 — `server/routers/api-router.js`

- [ ] 🔴 Remove `let express = require("express")` (line 1)
- [ ] 🔴 Remove `let router = express.Router()` (line 23)
- [ ] 🔴 Remove `const apicache = require("../modules/apicache")` (line 10)
- [ ] 🔴 Remove `let cache = apicache.middleware` (line 25)
- [ ] 🔴 Convert file to export a Fastify plugin: `module.exports = async function (fastify, opts) { ... }`
- [ ] 🔴 Replace `router.get(...)` / `router.all(...)` with `fastify.get(...)` / `fastify.route({ method: ["GET","POST","PUT","DELETE","PATCH"], ... })` for `ALL` handler
- [ ] 🔴 Replace `cache("5 minutes")` middleware arguments with Fastify `onSend` hook or `@fastify/caching` per-route
- [ ] 🔴 Replace `response.json(...)` → `reply.send(...)`, `response.status(x).json(...)` → `reply.code(x).send(...)`, `response.type(...)` → `reply.type(...)`, `response.send(...)` → `reply.send(...)`
- [ ] 🔴 Replace per-route `allowAllOrigin(response)` and `allowDevAllOrigin(response)` calls with plugin-level CORS (set in `@fastify/cors` config) or `reply.header(...)` calls
- [ ] 🔴 Replace `request.params.pushToken`, `request.query.msg`, etc. — same API in Fastify, no change needed
- [ ] 🔴 Update `io` reference: obtain from `require("../uptime-kuma-server").UptimeKumaServer.getInstance().io` (or from fastify.io if accessible in scope)
- [ ] 🟡 Remove `module.exports = router` — plugin function is the export

### 1.4 — `server/routers/status-page-router.js`

- [ ] 🔴 Remove `let express = require("express")` (line 1)
- [ ] 🔴 Remove `let router = express.Router()` (line 12)
- [ ] 🔴 Remove `const apicache = require("../modules/apicache")` (line 2)
- [ ] 🔴 Remove `let cache = apicache.middleware` (line 14)
- [ ] 🔴 Convert to Fastify plugin: `module.exports = async function (fastify, opts) { ... }`
- [ ] 🔴 Replace `router.get(...)` with `fastify.get(...)`
- [ ] 🔴 Replace `cache("X minutes")` with Fastify `onSend` hook per-route
- [ ] 🔴 Replace `response.json(...)` → `reply.send(...)`, `sendHttpError(response, ...)` → `reply.code(500).send({ ok:false, msg: ... })`
- [ ] 🔴 Replace per-route `allowDevAllOrigin(response)` with `reply.header(...)` or global CORS plugin

### 1.5 — `server/setup-database.js`

- [ ] 🔴 Remove `const express = require("express")` (line 1)
- [ ] 🔴 Remove `const expressStaticGzip = require("express-static-gzip")` (line 3)
- [ ] 🔴 Rewrite `SetupDatabase` class to use Fastify (or plain `http`) for the temporary setup wizard
- [ ] 🔴 Replace `expressStaticGzip(...)` with `@fastify/static` + `@fastify/compress` (or serve inline since this is a one-page wizard)
- [ ] 🟡 Consider replacing with a minimal plain `http.createServer` to avoid Fastify overhead for the temporary setup wizard

### 1.6 — `server/utils/simple-migration-server.js`

- [ ] 🔴 Remove `const express = require("express")` (line 1)
- [ ] 🔴 Rewrite `SimpleMigrationServer` class to use plain `http.createServer` (no need for a full framework for a status-display page)
- [ ] 🟡 Alternatively, use a minimal Fastify instance

### 1.7 — `server/auth.js`

- [ ] 🔴 Remove `const basicAuth = require("express-basic-auth")` (line 1)
- [ ] 🔴 Rewrite `exports.apiAuth` as a Fastify `preHandler` function `async (request, reply) => { ... }` that:
  - Checks `Settings.get("disableAuth")` — skip if true
  - Checks `Settings.get("apiKeysEnabled")` — if true, validate via `verifyAPIKey` (already in auth.js)
  - Otherwise, validate via HTTP Basic Auth (decode `Authorization: Basic ...` header manually)
  - Returns `reply.code(401).header("WWW-Authenticate", "Basic").send("Unauthorized")` on failure
- [ ] 🔴 Rewrite `exports.basicAuth` similarly as a Fastify preHandler
- [ ] 🔴 Address `prometheus-api-metrics` — it returns an Express `(req,res,next)` handler; replace with direct `prom-client` Fastify route handler or use `express-to-fastify` adapter temporarily
- [ ] 🟡 Remove `express-basic-auth` from `package.json` after rewrite

### 1.8 — `server/util-server.js`

- [ ] 🟡 Update `allowDevAllOrigin(res)` and `allowAllOrigin(res)` to accept either Express `res` or Fastify `reply` (duck-typed on `res.header`/`reply.header`) — or deprecate in favor of `@fastify/cors`

### 1.9 — `server/modules/apicache/`

- [ ] 🔴 Delete entire `server/modules/apicache/` directory after all `require(...)` references are removed

### 1.10 — `package.json`

- [ ] 🔴 `npm install @fastify/socket.io` — add to dependencies
- [ ] 🟡 `npm uninstall express-basic-auth` — remove after auth rewrite (can defer to Phase 3)

### 1.11 — Phase 1 Validation Gate

- [ ] 🔴 Run `npm run test-backend` — all tests must pass
- [ ] 🔴 `node server/server.js` starts without errors
- [ ] 🔴 Vue SPA loads at `http://localhost:3001`
- [ ] 🔴 Socket.IO connects (browser console shows no WebSocket errors)
- [ ] 🔴 `GET /api/badge/1/status` returns an SVG
- [ ] 🔴 `POST /api/push/<token>` returns `{ ok: true }`
- [ ] 🔴 `GET /status/default` serves status page HTML

---

## Phase 2 — Add Schema Validation + OpenAPI Docs

### 2.1 — Install OpenAPI packages

- [ ] 🔴 `npm install @fastify/swagger @fastify/swagger-ui`
- [ ] 🔴 Register `@fastify/swagger` in `server/server.js` with `openapi: { info: { title: "Uptime Pro API", version: "1.0.0" } }` before route plugins

### 2.2 — Route schemas: `server/routers/api-router.js`

- [ ] 🟡 Add JSON Schema to `GET /api/entry-page` — response: `{ type: string, entryPage?: string, statusPageSlug?: string }`
- [ ] 🟡 Add JSON Schema to `ALL /api/push/:pushToken` — params: `{ pushToken: string }`, query: `{ status?, msg?, ping? }`, response 200: `{ ok: boolean }`, response 404: `{ ok: boolean, msg: string }`
- [ ] 🟡 Add JSON Schema to `GET /api/badge/:id/status` — params: `{ id: integer }`, query: `{ label?, upColor?, ... }`
- [ ] 🟡 Add JSON Schema to `GET /api/badge/:id/uptime/:duration?` — params: `{ id: integer, duration?: string }`
- [ ] 🟡 Add JSON Schema to `GET /api/badge/:id/ping/:duration?` — same pattern
- [ ] 🟡 Add JSON Schema to `GET /api/badge/:id/avg-response/:duration?` — same pattern
- [ ] 🟡 Add JSON Schema to `GET /api/badge/:id/cert-exp` — params: `{ id: integer }`
- [ ] 🟡 Add JSON Schema to `GET /api/badge/:id/response` — same pattern

### 2.3 — Route schemas: `server/routers/status-page-router.js`

- [ ] 🟡 Add JSON Schema to `GET /api/status-page/:slug` — params: `{ slug: string }`, response: full status page JSON shape
- [ ] 🟡 Add JSON Schema to `GET /api/status-page/heartbeat/:slug` — params, response
- [ ] 🟡 Add JSON Schema to `GET /api/status-page/:slug/manifest.json`
- [ ] 🟡 Add JSON Schema to `GET /api/status-page/:slug/badge`

### 2.4 — Swagger UI

- [ ] 🟡 Register `@fastify/swagger-ui` at `routePrefix: "/docs"`
- [ ] 🟡 Verify `GET /docs` returns Swagger UI HTML
- [ ] 🟡 Verify `GET /docs/json` returns valid OpenAPI 3.0 JSON

### 2.5 — Phase 2 Validation Gate

- [ ] 🟡 `GET /api/badge/not-a-number/status` returns `400` with structured error (not a 500)
- [ ] 🟡 `GET /api/push/badtoken?ping=999999999999999` returns `404`
- [ ] 🟡 `GET /docs` returns HTTP 200 and Swagger UI HTML

---

## Phase 3 — Add Authenticated REST API

### 3.1 — Auth middleware

- [ ] 🔴 Create `server/middleware/auth.js` exporting `async function bearerAuth(request, reply)` that:
  - Extracts `Authorization: Bearer <key>` header
  - Looks up key in `api_key` table via `verifyAPIKey` (from `server/auth.js`)
  - Attaches `request.userId` if valid
  - Returns `reply.code(401).send({ ok: false, msg: "Unauthorized" })` if invalid

### 3.2 — Monitors API (`server/routes/api/v1/monitors.js`)

- [ ] 🟡 `GET /api/v1/monitors` — list all monitors (re-use Monitor model `getMonitorList` logic)
- [ ] 🟡 `GET /api/v1/monitors/:id` — get single monitor
- [ ] 🟡 `POST /api/v1/monitors` — create monitor (same logic as `add` socket event in server.js)
- [ ] 🟡 `PUT /api/v1/monitors/:id` — edit monitor
- [ ] 🟡 `DELETE /api/v1/monitors/:id` — delete monitor
- [ ] 🟡 `POST /api/v1/monitors/:id/pause` — pause monitor
- [ ] 🟡 `POST /api/v1/monitors/:id/resume` — resume monitor
- [ ] 🟡 `GET /api/v1/monitors/:id/heartbeats` — paginated heartbeat history
- [ ] 🟡 `GET /api/v1/monitors/:id/uptime/:period` — uptime percentage

### 3.3 — Tags API (`server/routes/api/v1/tags.js`)

- [ ] 🟡 `GET /api/v1/tags` — list tags
- [ ] 🟡 `POST /api/v1/tags` — create tag
- [ ] 🟡 `PUT /api/v1/tags/:id` — edit tag
- [ ] 🟡 `DELETE /api/v1/tags/:id` — delete tag

### 3.4 — Status Pages API (`server/routes/api/v1/status-pages.js`)

- [ ] 🟡 `GET /api/v1/status-pages` — list status pages
- [ ] 🟡 `GET /api/v1/status-pages/:slug` — get config
- [ ] 🟡 `POST /api/v1/status-pages` — create
- [ ] 🟡 `PUT /api/v1/status-pages/:slug` — update
- [ ] 🟡 `DELETE /api/v1/status-pages/:slug` — delete

### 3.5 — Notifications API (`server/routes/api/v1/notifications.js`)

- [ ] 🟡 `GET /api/v1/notifications` — list
- [ ] 🟡 `POST /api/v1/notifications` — add
- [ ] 🟡 `DELETE /api/v1/notifications/:id` — delete

### 3.6 — Maintenance API (`server/routes/api/v1/maintenance.js`)

- [ ] 🟡 `GET /api/v1/maintenance` — list
- [ ] 🟡 `POST /api/v1/maintenance` — create
- [ ] 🟡 `PUT /api/v1/maintenance/:id` — edit
- [ ] 🟡 `DELETE /api/v1/maintenance/:id` — delete
- [ ] 🟡 `POST /api/v1/maintenance/:id/pause` — pause
- [ ] 🟡 `POST /api/v1/maintenance/:id/resume` — resume

### 3.7 — Settings API (`server/routes/api/v1/settings.js`)

- [ ] 🟡 `GET /api/v1/settings` — get current settings
- [ ] 🟡 `PUT /api/v1/settings` — update settings

### 3.8 — Register v1 routes in `server/server.js`

- [ ] 🔴 `app.register(require("./routes/api/v1/monitors"), { prefix: "/api/v1", preHandler: bearerAuth })`
- [ ] 🔴 Same registration for tags, status-pages, notifications, maintenance, settings

### 3.9 — Phase 3 Validation Gate

- [ ] 🔴 `GET /api/v1/monitors` with valid key → HTTP 200, monitor list JSON
- [ ] 🔴 `GET /api/v1/monitors` without key → HTTP 401 `{ ok: false, msg: "Unauthorized" }`
- [ ] 🔴 `GET /api/v1/monitors` with expired/invalid key → HTTP 401
- [ ] 🟡 `POST /api/v1/monitors` creates a monitor and it appears in Socket.IO `getMonitorList`
- [ ] 🟡 OpenAPI spec at `/docs/json` includes all `/api/v1/` routes

---

## Phase 4 — Housekeeping and Hardening

### 4.1 — Rate limiting

- [ ] 🟡 `npm install @fastify/rate-limit`
- [ ] 🟡 Register `@fastify/rate-limit` globally with `max: 60, timeWindow: "1 minute"` for all `/api/v1/` routes
- [ ] 🟡 Add stricter limit for auth-sensitive routes (e.g., login equivalents): `max: 5, timeWindow: "1 minute"`

### 4.2 — Security headers

- [ ] 🟡 `npm install @fastify/helmet`
- [ ] 🟡 Register `@fastify/helmet` globally for CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- [ ] 🟡 Verify X-Frame-Options is set (currently set manually via `res.setHeader` in `server.js` line 208)

### 4.3 — Logging

- [ ] 🟡 Enable Fastify's built-in `pino` logger: `Fastify({ logger: { level: "info" } })` in production, `false` in dev to preserve existing console output behavior
- [ ] 🟡 Remove ad-hoc `console.log` calls from route handlers (use `request.log.info(...)`)

### 4.4 — Dead code removal

- [ ] 🔴 Delete `server/modules/apicache/` directory
- [ ] 🔴 Remove `const apicache = require("./modules/apicache")` from `server/server.js` (line 198) and `apicache.clear()` call (line 1193)
- [ ] 🟡 `npm uninstall express-basic-auth` (after `server/auth.js` is rewritten)
- [ ] 🟡 Remove `allowDevAllOrigin`/`allowAllOrigin` helper functions from `server/util-server.js` if fully replaced by `@fastify/cors`

### 4.5 — CORS consolidation

- [ ] 🟡 Confirm `@fastify/cors` `origin` config covers all cases previously handled by per-route `allowDevAllOrigin`/`allowAllOrigin` calls
- [ ] 🟡 Verify Vite dev proxy config (`config/vite.config.js`) still works with Fastify CORS headers

### 4.6 — Phase 4 Validation Gate

- [ ] 🔴 `/api/v1/monitors` returns HTTP 429 after >60 requests/min from same IP
- [ ] 🟡 All responses include `X-Content-Type-Options: nosniff`, `X-Frame-Options`, etc.
- [ ] 🟡 `grep -r "express\b" server/ --include="*.js"` returns no results (except `express-basic-auth` if not yet removed)
- [ ] 🟡 `ls node_modules | grep -E "^express$|express-static-gzip"` returns empty

---

## Post-Migration Validation

- [ ] 🔴 `npm run test-backend` passes all tests
- [ ] 🔴 `npm run lint` passes with zero errors
- [ ] 🔴 Docker build succeeds: `docker build -t uptime-pro .`
- [ ] 🔴 Docker container starts: `docker run -p 3001:3001 uptime-pro`
- [ ] 🔴 Vue SPA loads and authenticates via Socket.IO
- [ ] 🔴 All 86+ socket events function correctly (tested via UI)
- [ ] 🔴 Push monitor endpoint `POST /api/push/<token>` works end-to-end
- [ ] 🔴 Badge routes return correct SVGs
- [ ] 🔴 Status pages render correctly
- [ ] 🔴 `GET /docs` returns Swagger UI
- [ ] 🔴 REST API (`/api/v1/`) returns 401 without key, 200 with valid key
- [ ] 🔴 Rate limits trigger 429 on excess requests
- [ ] 🔴 Graceful shutdown via SIGTERM completes without hanging

---

## Cleanup

- [ ] 🟡 Delete `server/modules/apicache/` (if not done in Phase 4)
- [ ] 🟡 Delete any orphaned Express Router files under `server/routers/` after Fastify plugin conversions are confirmed working
- [ ] 🟡 Remove `fastify-migration.md`, `fastify-migration-review.md`, `fastify-migration-checklist.md`, `fastify-migration-implementation.md`, `fastify-migration-validation.md` from the repository root once migration is complete and merged
- [ ] 🟡 Update `README.md` to reflect Fastify as the HTTP framework
