# Fastify Migration Plan

## Overview

This document outlines a complete, phased migration from the current Express + Socket.IO
backend to Fastify + Socket.IO. The goal is to replace Express as the HTTP layer with
Fastify while preserving Socket.IO for all real-time features, then progressively add
a validated, documented REST API.

The migration is **additive and non-breaking**: Express is replaced, Socket.IO is kept,
and new REST routes are layered in incrementally without disrupting the Vue frontend.

---

## Current Architecture

```
Node.js process
├── Express app
│   ├── express.json() middleware
│   ├── CORS middleware (allowDevAllOrigin)
│   ├── GET  /                          → serve index.html
│   ├── GET  /setup-database-info       → setup wizard
│   ├── GET  /robots.txt
│   ├── GET  /metrics                   → Prometheus (apiAuth guard)
│   ├── GET  /.well-known/change-password
│   ├── Static: dist/                   → Vue SPA (expressStaticGzip)
│   ├── Static: /upload                 → uploaded files
│   ├── api-router.js (Express Router)
│   │   ├── GET  /api/entry-page
│   │   ├── ALL  /api/push/:pushToken   → push monitor receiver
│   │   ├── GET  /api/badge/:id/status
│   │   ├── GET  /api/badge/:id/uptime/:duration?
│   │   ├── GET  /api/badge/:id/ping/:duration?
│   │   ├── GET  /api/badge/:id/avg-response/:duration?
│   │   ├── GET  /api/badge/:id/cert-exp
│   │   └── GET  /api/badge/:id/response
│   └── status-page-router.js (Express Router)
│       ├── GET  /status/:slug
│       ├── GET  /status/:slug/rss
│       ├── GET  /status
│       ├── GET  /status-page
│       └── GET  /api/status-page/:slug  → status page config (public)
│
└── Socket.IO (attached to http.Server)
    ├── server.js socket handlers (~55 events, ~1,900 lines)
    │   ├── Auth: login, loginByToken, logout, setup, needSetup
    │   ├── 2FA: prepare2FA, save2FA, disable2FA, verifyToken, twoFAStatus
    │   ├── Monitors: add, editMonitor, getMonitor, getMonitorList,
    │   │            resumeMonitor, pauseMonitor, deleteMonitor,
    │   │            getMonitorBeats, checkDomain, monitorImportantHeartbeatListCount,
    │   │            monitorImportantHeartbeatListPaged, getPushExample
    │   ├── Tags: getTags, addTag, editTag, deleteTag,
    │   │        addMonitorTag, editMonitorTag, deleteMonitorTag
    │   ├── Notifications: addNotification, deleteNotification, testNotification,
    │   │                  checkApprise, getWebpushVapidPublicKey
    │   ├── Settings: getSettings, setSettings, changePassword, initServerTimezone
    │   └── Stats: clearEvents, clearHeartbeats, clearStatistics
    └── socket-handlers/ (separate handler files)
        ├── api-key-socket-handler.js    → addAPIKey, deleteAPIKey, getAPIKeyList, etc.
        ├── chart-socket-handler.js      → getMonitorChartData
        ├── cloudflared-socket-handler.js → cloudflared:start/stop/join/leave
        ├── database-socket-handler.js   → getDatabaseSize, shrinkDatabase
        ├── docker-socket-handler.js     → addDockerHost, deleteDockerHost, testDockerHost
        ├── general-socket-handler.js    → disconnectOtherSocketClients, getGameList
        ├── maintenance-socket-handler.js → full maintenance CRUD
        ├── proxy-socket-handler.js      → addProxy, deleteProxy
        ├── remote-browser-socket-handler.js → addRemoteBrowser, testRemoteBrowser
        └── status-page-socket-handler.js → addStatusPage, saveStatusPage, deleteStatusPage,
                                            postIncident, editIncident, resolveIncident, etc.
```

---

## Target Architecture

```
Node.js process
├── Fastify app
│   ├── @fastify/cors plugin
│   ├── @fastify/static plugin           → dist/ (Vue SPA)
│   ├── @fastify/static plugin           → /upload
│   ├── @fastify/compress plugin         → replaces expressStaticGzip
│   ├── @fastify/swagger plugin          → OpenAPI spec generation
│   ├── @fastify/swagger-ui plugin       → /docs UI
│   ├── @fastify/socket.io plugin        → Socket.IO attached to Fastify's http.Server
│   │
│   ├── routes/public/                   → unauthenticated routes
│   │   ├── entry.js                     → GET /api/entry-page
│   │   ├── push.js                      → ALL /api/push/:pushToken
│   │   ├── badges.js                    → GET /api/badge/:id/*
│   │   ├── status-pages.js              → GET /status/:slug, /api/status-page/:slug, RSS
│   │   └── robots.js                    → GET /robots.txt
│   │
│   ├── routes/setup/                    → pre-auth setup routes
│   │   └── setup.js                     → GET /setup-database-info
│   │
│   ├── routes/api/v1/                   → NEW authenticated REST API (future phases)
│   │   ├── monitors.js                  → CRUD /api/v1/monitors
│   │   ├── heartbeats.js                → GET /api/v1/monitors/:id/heartbeats
│   │   ├── tags.js                      → CRUD /api/v1/tags
│   │   ├── notifications.js             → CRUD /api/v1/notifications
│   │   ├── status-pages.js              → CRUD /api/v1/status-pages
│   │   ├── maintenance.js               → CRUD /api/v1/maintenance
│   │   └── settings.js                  → GET/PUT /api/v1/settings
│   │
│   └── routes/internal/                 → admin/internal routes
│       └── metrics.js                   → GET /metrics (apiAuth guard)
│
└── Socket.IO (attached to Fastify's http.Server via @fastify/socket.io)
    └── [unchanged] all 55+ socket event handlers preserved as-is
```

---

## What Stays in Socket.IO (Do Not Migrate)

These events are **real-time by nature** and should permanently remain in Socket.IO:

| Event Category | Events | Reason |
|---|---|---|
| Real-time push | `heartbeat`, `heartbeatList`, `avgPing`, `uptime`, `monitorList` | Server-initiated pushes to all clients |
| Live logs | `logStream`, `info`, `avgPing` | Continuous streaming |
| Connection lifecycle | `connect`, `disconnect`, `connection` | WebSocket transport only |
| Cloudflare Tunnel | `cloudflared:*` events | Long-lived async tunnel process |

These Socket.IO events are **candidates for REST migration** (Phase 3) but may also stay
as Socket.IO permanently — the frontend already works with them:

| Event Category | Events | REST API Equivalent |
|---|---|---|
| Monitor CRUD | `add`, `editMonitor`, `deleteMonitor`, `getMonitor`, `getMonitorList` | `POST/PUT/DELETE/GET /api/v1/monitors` |
| Monitor actions | `resumeMonitor`, `pauseMonitor` | `POST /api/v1/monitors/:id/resume` |
| Tags | `addTag`, `editTag`, `deleteTag`, `getTags` | `CRUD /api/v1/tags` |
| Notifications | `addNotification`, `deleteNotification` | `CRUD /api/v1/notifications` |
| Settings | `getSettings`, `setSettings` | `GET/PUT /api/v1/settings` |
| Auth | `login`, `logout`, `setup` | `POST /api/v1/auth/login` (new REST consumers only) |

> **Decision**: The Vue frontend continues using Socket.IO exclusively. The REST API is
> an additive layer for scripts, integrations, and external consumers. No frontend refactor
> is required or planned.

---

## Phased Migration Plan

### Phase 1 — Replace Express with Fastify (HTTP Server Swap)

**Goal:** Fastify runs the HTTP server. Socket.IO re-attaches to it. All existing routes
continue to work identically. No Socket.IO changes. No new REST routes.

**Scope of changes:**

| File | Change |
|---|---|
| `server/server.js` | Replace `require("express")` with `require("fastify")`. Re-register all existing routes as Fastify routes. Remove `express.json()`, `express.urlencoded()`, `express.static()`. |
| `server/routers/api-router.js` | Convert from Express `Router` to Fastify plugin (no logic changes). |
| `server/routers/status-page-router.js` | Convert from Express `Router` to Fastify plugin. |
| `server/uptime-kuma-server.js` | Replace Express `app` init with Fastify `app` init. Update `httpServer` reference. |
| `package.json` | Add `fastify`, `@fastify/cors`, `@fastify/static`, `@fastify/compress`, `@fastify/socket.io`. Remove `express`, `express-static-gzip`. |

**New packages:**

```
fastify
@fastify/cors
@fastify/static
@fastify/compress
@fastify/socket.io
```

**Packages removed:**

```
express
express-static-gzip
```

**Key behavioral mappings (Express → Fastify):**

| Express | Fastify equivalent |
|---|---|
| `express.json()` | Built-in (content-type parser, enabled by default) |
| `express.urlencoded()` | `@fastify/formbody` plugin |
| `express.static("dist")` | `@fastify/static` with `root: "dist"` |
| `expressStaticGzip("dist")` | `@fastify/static` + `@fastify/compress` |
| `app.use(router)` | `fastify.register(plugin)` |
| `req.params`, `req.body` | `request.params`, `request.body` |
| `res.json()` | `reply.send()` |
| `res.status(x).json()` | `reply.code(x).send()` |
| `next()` middleware | `fastify` hooks (`onRequest`, `preHandler`) |
| `apicache.middleware` | `@fastify/caching` or manual hook |

**Validation gate:** All existing backend tests pass. Docker container starts and serves
the Vue SPA. Socket.IO connects. Existing badge routes respond correctly.

---

### Phase 2 — Add Schema Validation + OpenAPI Docs

**Goal:** Add Fastify's JSON Schema validation to all existing HTTP routes. Add `@fastify/swagger`
and `@fastify/swagger-ui`. Every existing route gets a schema. No new routes.

**New packages:**

```
@fastify/swagger
@fastify/swagger-ui
```

**Route schemas to define:**

| Route | Request schema | Response schema |
|---|---|---|
| `GET /api/entry-page` | — | `{ type, hosturl }` |
| `ALL /api/push/:pushToken` | `params: { pushToken: string }`, `query: { status, msg, ping }` | `{ ok, msg }` |
| `GET /api/badge/:id/status` | `params: { id: integer }`, `query: { label?, upColor? }` | SVG (no schema) |
| `GET /api/badge/:id/uptime/:duration?` | `params: { id, duration }` | SVG |
| `GET /api/status-page/:slug` | `params: { slug: string }` | Full status page JSON |

**OpenAPI output:** `GET /docs` serves Swagger UI. `GET /docs/json` returns the full OpenAPI 3.0 spec.

**Validation gate:** All routes reject bad input with `400` + structured error. `/docs` is accessible.

---

### Phase 3 — Add Authenticated REST API (`/api/v1/`)

**Goal:** Build the new REST API layer for external consumers. The Vue frontend is unaffected
and continues using Socket.IO. These are **new routes only** — they call the same underlying
model/service functions already used by socket handlers.

**Authentication:** API key via `Authorization: Bearer <key>` header. Keys stored in the
`api_key` table (already exists). The socket handler `api-key-socket-handler.js` already
manages key creation — the REST auth layer reads the same table.

**New routes by resource:**

#### Monitors

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/monitors` | List all monitors for authenticated user |
| `GET` | `/api/v1/monitors/:id` | Get single monitor |
| `POST` | `/api/v1/monitors` | Create monitor (same logic as `add` socket event) |
| `PUT` | `/api/v1/monitors/:id` | Edit monitor (same logic as `editMonitor`) |
| `DELETE` | `/api/v1/monitors/:id` | Delete monitor |
| `POST` | `/api/v1/monitors/:id/pause` | Pause monitor |
| `POST` | `/api/v1/monitors/:id/resume` | Resume monitor |
| `GET` | `/api/v1/monitors/:id/heartbeats` | Paginated heartbeat history |
| `GET` | `/api/v1/monitors/:id/uptime/:period` | Uptime percentage for period |

#### Tags

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/tags` | List all tags |
| `POST` | `/api/v1/tags` | Create tag |
| `PUT` | `/api/v1/tags/:id` | Edit tag |
| `DELETE` | `/api/v1/tags/:id` | Delete tag |

#### Status Pages

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/status-pages` | List all status pages |
| `GET` | `/api/v1/status-pages/:slug` | Get status page config |
| `POST` | `/api/v1/status-pages` | Create status page |
| `PUT` | `/api/v1/status-pages/:slug` | Update status page |
| `DELETE` | `/api/v1/status-pages/:slug` | Delete status page |

#### Notifications

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/notifications` | List notifications |
| `POST` | `/api/v1/notifications` | Add notification |
| `DELETE` | `/api/v1/notifications/:id` | Delete notification |

#### Maintenance

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/maintenance` | List maintenance windows |
| `POST` | `/api/v1/maintenance` | Create maintenance window |
| `PUT` | `/api/v1/maintenance/:id` | Edit maintenance window |
| `DELETE` | `/api/v1/maintenance/:id` | Delete maintenance window |
| `POST` | `/api/v1/maintenance/:id/pause` | Pause maintenance |
| `POST` | `/api/v1/maintenance/:id/resume` | Resume maintenance |

#### Settings

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/v1/settings` | Get current settings |
| `PUT` | `/api/v1/settings` | Update settings |

**Auth middleware (Fastify `preHandler` hook):**

```
Request
  → Extract Bearer token from Authorization header
  → Look up token in api_key table (where active = 1)
  → If valid: attach userId to request context
  → If invalid: return 401 { ok: false, msg: "Unauthorized" }
```

**Validation gate:** All REST routes return structured JSON errors for invalid input.
OpenAPI spec includes all v1 routes. Postman/curl usable without a WebSocket client.

---

### Phase 4 — Housekeeping and Hardening

**Goal:** Remove dead code, consolidate middleware, add rate limiting, lock down production config.

**Tasks:**

- Add `@fastify/rate-limit` to all `/api/v1/` routes (default: 60 req/min per IP)
- Add `@fastify/rate-limit` stricter policy to `/api/auth/login` (5 req/min)
- Add `@fastify/helmet` for security headers (CSP, HSTS, X-Frame-Options)
- Remove `apicache` module (replaced by Fastify caching hooks)
- Remove the dev-only test routes (`/test-webhook`, `/test-x-www-form-urlencoded`) from production builds
- Consolidate the `allowDevAllOrigin` / `allowAllOrigin` CORS logic into the `@fastify/cors` plugin config
- Add request logging via Fastify's built-in `pino` logger (replaces ad-hoc `console.log` in routes)
- Ensure `http-graceful-shutdown` works with Fastify's `httpServer` reference

**New packages:**

```
@fastify/rate-limit
@fastify/helmet
```

---

## File-by-File Change Map

| File | Phase | Action |
|---|---|---|
| `server/server.js` | 1 | Major rewrite of HTTP setup block; Socket.IO block unchanged |
| `server/uptime-kuma-server.js` | 1 | Replace Express app init with Fastify init |
| `server/routers/api-router.js` | 1 | Convert to Fastify plugin; add schemas in Phase 2 |
| `server/routers/status-page-router.js` | 1 | Convert to Fastify plugin |
| `server/socket-handlers/*.js` | — | **No changes** across all phases |
| `server/model/*.js` | — | **No changes** — business logic reused by REST routes |
| `server/routes/` (new directory) | 3 | New Fastify route plugins for `/api/v1/` |
| `server/middleware/auth.js` (new) | 3 | API key bearer token preHandler hook |
| `package.json` | 1 | Add fastify deps, remove express deps |

---

## Risk Areas

### R1 — Socket.IO Attachment
`@fastify/socket.io` attaches Socket.IO to Fastify's underlying `http.Server`. This is
functionally equivalent to the current Express approach. However, the `io` instance reference
used in `server/server.js` (exported as `module.exports.io`) must be obtained from the
Fastify plugin after registration, not before. If initialization order is wrong, socket
handlers that reference `io` at module load time will get `undefined`.

**Mitigation:** Register `@fastify/socket.io` first before any route plugins. Use
`fastify.io` (the plugin's attached property) as the io reference.

### R2 — apicache Compatibility
`apicache` is an Express middleware. It wraps `res.json()` and intercepts the response
object. It is not compatible with Fastify's reply model. All routes currently using
`cache("5 minutes")` need to be re-implemented using Fastify hooks or `@fastify/caching`.

**Affected routes:** `/api/badge/*`, `/api/entry-page`, `/api/status-page/:slug`, `/status/:slug`.

**Mitigation:** Replace with a Fastify `onSend` hook or `@fastify/caching` in Phase 1.
Cache TTLs are already documented in the route definitions.

### R3 — Static File Serving + Compression
`expressStaticGzip` serves pre-compressed `.gz` and `.br` files from `dist/`. Fastify's
`@fastify/static` does not serve pre-compressed files by default. `@fastify/compress`
compresses responses on-the-fly which is acceptable but slightly different.

**Mitigation:** Confirm that `dist/` pre-compressed files are generated by the Vite build
(`npm run build`). Use `@fastify/compress` for on-the-fly compression or configure
`@fastify/static` with `serve-static`'s `setHeaders` option if pre-compressed serving is required.

### R4 — E2E Test Routes (dev-only)
`/test-webhook`, `/test-x-www-form-urlencoded`, `/_e2e/take-sqlite-snapshot`,
`/_e2e/restore-sqlite-snapshot` are conditionally added in `isDev` mode. These must be
preserved in the Fastify setup with the same `isDev` guard.

### R5 — Graceful Shutdown
`http-graceful-shutdown` wraps `server.httpServer`. After migration, this reference must
point to Fastify's underlying server (`fastify.server`), not an Express-created server.

### R6 — `allowDevAllOrigin` CORS Logic
The current CORS middleware in `server.js` is applied as a one-liner function that sets
`Access-Control-Allow-Origin: *` in dev mode. In Fastify this moves to the `@fastify/cors`
plugin config. The logic is simple but must be verified against the frontend's dev proxy
configuration in `vite.config.js`.

---

## Success Criteria by Phase

| Phase | Criteria |
|---|---|
| 1 | All 213 backend tests pass. Docker container starts. Vue SPA loads. Socket.IO connects and all events function. Badge routes work. Push monitor works. |
| 2 | `/docs` returns Swagger UI. `/docs/json` returns valid OpenAPI 3.0. Invalid badge requests return `400`. |
| 3 | `GET /api/v1/monitors` returns monitor list with valid API key. Returns `401` without key. Postman collection covers all routes. |
| 4 | Rate limiting returns `429` after threshold. Security headers present on all responses. No `apicache` or `express` in `node_modules` after prune. |

---

## Recommended Implementation Order

1. **Phase 1 first** — get Fastify running with a green test suite before adding any new capabilities
2. **Phase 2 immediately after Phase 1** — schema validation and docs have zero user impact and de-risk Phase 3
3. **Phase 3 as a separate sprint** — new REST routes, no disruption to existing Socket.IO users
4. **Phase 4 inline with Phase 3** — rate limiting and helmet are low-risk additions that should ship with the public API

Do not attempt to migrate Socket.IO events to REST in Phase 3. The Vue frontend is not
being refactored. Socket.IO remains the frontend transport indefinitely.

---

## Packages Summary

| Package | Action | Phase |
|---|---|---|
| `express` | Remove | 1 |
| `express-static-gzip` | Remove | 1 |
| `fastify` | Add | 1 |
| `@fastify/cors` | Add | 1 |
| `@fastify/static` | Add | 1 |
| `@fastify/compress` | Add | 1 |
| `@fastify/socket.io` | Add | 1 |
| `@fastify/formbody` | Add | 1 |
| `@fastify/swagger` | Add | 2 |
| `@fastify/swagger-ui` | Add | 2 |
| `@fastify/rate-limit` | Add | 4 |
| `@fastify/helmet` | Add | 4 |
| `apicache` | Remove | 1–2 |
