# Project Review

## Executive Summary

Uptime Kuma is a feature-rich, mature self-hosted monitoring product with real breadth: many monitor types, many notification providers, status pages, incidents, maintenance windows, Prometheus metrics, Docker packaging, and a cross-platform CI matrix. The project clearly solves real user needs and has accumulated a lot of practical implementation knowledge in `server/model/monitor.js`, `server/notification.js`, `server/uptime-kuma-server.js`, `src/pages/StatusPage.vue`, and the migration history in `db/knex_migrations/`.

The main strengths are feature completeness, extensibility, pragmatic operational support, and a surprisingly broad automated test/build setup for a project of this size. The main weaknesses are security boundary inconsistencies, very large central modules, plaintext secret handling, and uneven operational hardening outside the happy path. The overall risk level is **medium-high**: the project looks **production-ready for the common single-admin self-hosted case**, but **only partially ready** for stricter multi-user, audited, or larger-scale environments.

Overall implementation maturity is **high on product breadth, medium on internal architecture, and medium-low on defense-in-depth**.

## What Is Working Well

- The monitor-type and notification-provider model is a real extensibility seam, not just folder sprawl. `server/monitor-types/*`, `server/notification-providers/*`, `server/notification.js`, and `server/client.js` form a workable plugin-style architecture.
- The product surface is strong. Status pages, incidents, maintenance windows, remote browsers, Docker monitoring, API keys, metrics, and many protocol-specific checks are all implemented in the same product rather than stubbed out.
- CI coverage is better than expected: `.github/workflows/auto-test.yml` runs build/tests across multiple OSes and Node versions, and `.github/workflows/validate.yml` checks migrations, language files, and package metadata.
- The data layer shows ongoing maintenance rather than abandonment. The migration history is long and active, and the project has clearly handled real upgrade paths over time.
- Security is not absent: passwords and API keys are hashed, WebSocket origin checks exist by default, status-page markdown is sanitized with DOMPurify on the frontend, SSR preload data is escaped with `jsesc`, and container images include a healthcheck.
- The status-page product experience is one of the strongest parts of the codebase. `src/pages/StatusPage.vue`, `server/model/status_page.js`, and the related Playwright specs show real polish rather than a minimal admin screen.

## Key Risks and Concerns

- The most important issue is **authorization drift in Socket.IO handlers**. Several code paths check only that the user is logged in, then read or mutate resources by raw IDs without enforcing ownership.
- Sensitive monitor, proxy, and notification secrets are stored and re-hydrated in plaintext, which increases blast radius if the database or admin session is compromised.
- JWT sessions are long-lived and browser-stored, with no expiry or revocation identifier.
- The backend and frontend both have oversized central modules (`server/server.js`, `server/model/monitor.js`, `src/pages/EditMonitor.vue`, `src/mixins/socket.js`, `src/pages/StatusPage.vue`), which slows safe change velocity.
- Test coverage is broad on protocols and selected UI flows, but weak where the highest-risk bugs actually live: authz, multi-user isolation, settings hardening, and operational failure modes.
- Operational posture is decent for Docker/home lab use, but still light for stricter deployments: no dedicated liveness/readiness endpoint for the main service, minimal compose defaults, and inconsistent error/logging discipline.

## Detailed Findings

### Architecture

#### 1. Cross-cutting server logic is still centralized in a god module
**Severity:** High

**Why it matters:** `server/server.js` owns bootstrap, auth, routing, Socket.IO event registration, settings mutation, monitor lifecycle, and shutdown behavior. That concentration makes review, testing, and refactoring harder, and it increases the chance that future changes break unrelated flows.

**Evidence from the codebase:** `server/server.js` is roughly 2,000 lines and still contains many inline socket handlers even though specialized handlers already exist in `server/socket-handlers/`. The file mixes Express setup, JWT login, 2FA, settings, monitor actions, and process lifecycle in one module.

**Recommended fix or improvement:** Continue the partial extraction pattern already present in `server/socket-handlers/*`. Split auth/session, monitor CRUD, monitor history/actions, settings, and notification management into focused handlers/services with shared guard and error-wrapper utilities.

#### 2. Frontend state is effectively a root-mixin global store
**Severity:** Medium

**Why it matters:** The frontend relies on a very large root mixin (`src/mixins/socket.js`) to hold connection state, auth state, monitor lists, heartbeats, notifications, proxies, remote browsers, and helper methods. That makes component behavior implicit and tightly coupled to `$root`.

**Evidence from the codebase:** `src/mixins/socket.js` is one of the largest frontend modules and is mounted globally in `src/main.js`. Pages and components read and mutate shared state through `$root` rather than through an explicit store boundary.

**Recommended fix or improvement:** Move shared state into composables or a dedicated store layer, then narrow each composable to one concern: auth/session, monitor cache, status-page public data, settings, and socket transport.

### Backend

#### 3. Ownership checks are inconsistent across Socket.IO handlers
**Severity:** Critical

**Why it matters:** This is the highest-risk correctness and security issue in the project. An authenticated user can reach several read/write paths using raw resource IDs without proving resource ownership. In any multi-user deployment, that becomes privilege escalation and cross-tenant data tampering.

**Evidence from the codebase:**  
- `server/server.js` `getMonitorBeats` reads heartbeat data by `monitor_id` only.  
- `server/server.js` `clearEvents` updates `heartbeat` rows by `monitor_id` only.  
- `server/server.js` `clearHeartbeats` clears statistics by `monitorID` only.  
- `server/socket-handlers/chart-socket-handler.js` loads chart data with only `checkLogin(socket)`.  
- `server/socket-handlers/api-key-socket-handler.js` enables/disables API keys by `id` only.  
- `server/socket-handlers/maintenance-socket-handler.js` adds and reads maintenance relations by `maintenance_id` without consistently checking the current user owns that maintenance and the attached resources.

**Recommended fix or improvement:** Add centralized guard helpers such as `assertOwnedMonitor`, `assertOwnedMaintenance`, `assertOwnedProxy`, and `assertOwnedApiKey`. Require `user_id` conditions or ownership joins on every mutation/read path before performing the action.

#### 4. Backend startup and restart behavior is operationally safe but scales poorly
**Severity:** Medium

**Why it matters:** Startup and recovery time grow with monitor count, which becomes noticeable in larger deployments or after upgrades/restarts.

**Evidence from the codebase:** `server/server.js` starts monitors serially and intentionally waits between monitor starts. Background jobs are simple and safe, but there is little bounded concurrency in monitor recovery.

**Recommended fix or improvement:** Replace serial startup sleeps with bounded concurrency plus jitter. Keep the anti-thundering-herd goal, but stop paying O(n) wall-clock restart cost.

### Frontend

#### 5. The main UI is carried by a few very large page modules
**Severity:** High

**Why it matters:** Large single-file components become expensive to reason about, hard to test in isolation, and easy to break during feature work.

**Evidence from the codebase:**  
- `src/pages/EditMonitor.vue` is the largest source file in the repository.  
- `src/pages/StatusPage.vue`, `src/pages/Details.vue`, and `src/pages/EditMaintenance.vue` are also large.  
- `src/router.js` imports most major routes eagerly, so large UI modules are not consistently isolated behind route-level code splitting.

**Recommended fix or improvement:** Split `EditMonitor.vue` by monitor subtype and settings area, split `StatusPage.vue` into editor/view/history modules, and lazy-load more route components in `src/router.js`.

#### 6. Bundle strategy is only partially optimized
**Severity:** Medium

**Why it matters:** A monitoring UI that loads quickly matters, especially for status pages and mobile admin use.

**Evidence from the codebase:** `src/router.js` eagerly imports many heavy pages. `config/vite.config.js` contains an empty `manualChunks` function, which signals unfinished bundle-splitting work rather than an intentional strategy.

**Recommended fix or improvement:** Lazy-load heavyweight routes, remove the dead `manualChunks` placeholder, and measure admin/status-page bundles separately.

#### 7. Runtime console logging and silent catches remain in user-facing code
**Severity:** Low

**Why it matters:** Debug leftovers make browser and server behavior noisier in production and hide failures that should be diagnosable.

**Evidence from the codebase:** `src/mixins/socket.js`, `src/pages/EditMonitor.vue`, `src/pages/SetupDatabase.vue`, `src/components/TagsManager.vue`, `server/notification-providers/slack.js`, and other modules still use `console.log` / `console.warn`. Empty catch blocks also exist in `server/socket-handlers/general-socket-handler.js`, `server/uptime-kuma-server.js`, `server/model/monitor.js`, and related files.

**Recommended fix or improvement:** Replace ad hoc console calls with the existing logger where appropriate, and remove or document silent catches.

### Data Layer

#### 8. Secret material is stored and returned in plaintext
**Severity:** High

**Why it matters:** If the database or an admin session is compromised, monitor credentials, TLS keys, proxy passwords, OAuth secrets, and notification credentials are immediately exposed.

**Evidence from the codebase:**  
- `server/model/monitor.js` includes `basic_auth_pass`, `oauth_client_secret`, `tlsKey`, `radiusSecret`, `mqttPassword`, and other secrets in `toJSON()` when `includeSensitiveData` is true.  
- `server/model/proxy.js` returns proxy `password` from `toJSON()`.  
- `server/notification.js` stores notification config as raw `JSON.stringify(notification)` in the database.

**Recommended fix or improvement:** Encrypt secrets at rest, split secret-bearing fields from routine JSON payloads, and redact secrets from default API/socket payloads unless explicitly requested for edit flows.

#### 9. Public/status-page and dashboard data paths still use N+1 patterns
**Severity:** Medium

**Why it matters:** These queries will get more expensive as monitor count, incident history, and status-page complexity grow.

**Evidence from the codebase:** `server/client.js` and status-page logic in `server/model/status_page.js` and `server/routers/api-router.js` repeatedly query per monitor and per group rather than batching summaries.

**Recommended fix or improvement:** Batch latest-heartbeat and uptime reads, cache public aggregates, and lazily fetch heavy history instead of fan-out loading it on connect/render.

### Security

#### 10. JWT sessions do not expire and live in browser storage
**Severity:** High

**Why it matters:** Stolen tokens remain valid until password change or JWT-secret rotation. Browser storage also leaves tokens exposed to any XSS event in the admin UI.

**Evidence from the codebase:** `server/model/user.js` signs JWTs without `exp`, `iat`, `aud`, `jti`, or revocation metadata. `src/mixins/socket.js` persists tokens in `localStorage` or `sessionStorage`.

**Recommended fix or improvement:** Add short token expiry, server-side revocation/versioning, and move to HttpOnly/SameSite cookies if the transport model allows it.

#### 11. Status-page publication/password settings are not meaningfully enforced server-side
**Severity:** Medium

**Why it matters:** A feature that looks like access control but is not enforced is worse than no feature, because operators assume protection exists.

**Evidence from the codebase:** The schema includes `published` / `password` support, but public routes in `server/routers/status-page-router.js` and rendering in `server/model/status_page.js` do not enforce those controls, and related save logic is incomplete/commented in the status-page socket handler.

**Recommended fix or improvement:** Enforce `published` and password checks on every public status-page route and API response, then add E2E coverage for private/unpublished flows.

#### 12. Rate limiting is global rather than actor-aware
**Severity:** Medium

**Why it matters:** One noisy client can exhaust the shared bucket and degrade login/API access for everyone.

**Evidence from the codebase:** `server/rate-limiter.js` defines singleton limiters, and the auth flows in `server/auth.js` and `server/server.js` use them without per-IP or per-username keys.

**Recommended fix or improvement:** Key rate limits by IP/user and log abuse with enough context to support blocking and investigation.

### Testing

#### 13. Test breadth is good, but risk alignment is weak
**Severity:** High

**Why it matters:** The suite covers many monitor types and some key status-page/monitor-form flows, but the most dangerous bugs are in authz and multi-user isolation, which currently have little visible protection.

**Evidence from the codebase:** `test/backend-test/` has many protocol and utility tests, and `test/e2e/specs/` covers status-page and monitor-form flows. There is little visible coverage for login/session expiry, 2FA edge cases, API-key authorization, cross-user isolation, or settings hardening paths such as `disableAuth`.

**Recommended fix or improvement:** Add backend and E2E tests for authz boundaries, multi-user resource isolation, API key ownership, maintenance ownership, and token/session behavior.

### DevOps / Deployment

#### 14. Operational surface is decent, but production defaults are still sparse
**Severity:** Medium

**Why it matters:** The project ships well for Docker and PM2 users, but the default examples still leave operators to assemble too much of the production posture themselves.

**Evidence from the codebase:**  
- `docker/dockerfile` includes a real healthcheck.  
- `compose.yaml` is minimal and does not carry that healthcheck forward.  
- The sample compose file binds `3001:3001` directly.  
- `ecosystem.config.js` is minimal.  
- The main service exposes `/metrics`, but there is no dedicated liveness/readiness endpoint for the normal server flow; the only explicit health-oriented server is `server/utils/simple-migration-server.js` during migrations.

**Recommended fix or improvement:** Add first-class readiness/liveness endpoints, enrich the compose example with healthcheck and safer exposure guidance, and document production reverse-proxy/TLS expectations in-repo rather than relying so heavily on external wiki pages.

#### 15. Workflow hygiene is strong overall, but there are signs of drift
**Severity:** Low

**Why it matters:** Small workflow mismatches become future maintenance tax.

**Evidence from the codebase:** `auto-test.yml` includes branch `3.0.0`, while `validate.yml` does not. There is also at least one misspelled E2E filename (`test/e2e/specs/fridendly-name.spec.js`).

**Recommended fix or improvement:** Align branch coverage across workflows and clean small naming/workflow drift before it accumulates.

### Documentation

#### 16. Contributor guidance is strong; operator guidance is fragmented
**Severity:** Low

**Why it matters:** Contributors are well-served, but production operators still need to bounce between README, wiki pages, and scattered scripts.

**Evidence from the codebase:** `CONTRIBUTING.md` is detailed and practical. `README.md` is strong for install/update entry points but pushes advanced deployment and update details out to the wiki. In-repo deployment examples are intentionally minimal.

**Recommended fix or improvement:** Keep the wiki, but add an in-repo “production deployment checklist” covering backups, reverse proxy, exposure model, health checks, and upgrade posture.

## Recommended Priorities

1. **Fix authorization boundaries first.** The Socket.IO ownership bugs are the clearest path to privilege escalation and cross-user data tampering.
2. **Harden session and secret handling next.** Add expiring sessions, revocation/versioning, and a safer secret-storage story.
3. **Back those fixes with tests.** The critical bugs found here survived because authz/multi-user cases are under-tested.
4. **Refactor the large modules that carry most future change risk.** Start with `server/server.js`, `src/pages/EditMonitor.vue`, and `src/mixins/socket.js`.
5. **Improve operational readiness.** Add proper readiness/liveness endpoints, better compose defaults, and tighter production docs.
6. **Then attack performance and code health.** Batch public/dashboard queries, improve startup concurrency, and remove silent failure patterns.

## Conclusion

This is a strong product with real user value, real breadth, and active engineering effort behind it. It is not a toy project, and many parts of it are already solid enough for real-world use.

The project is best described as **production-capable but unevenly hardened**. It is ready enough for the common self-hosted single-admin deployment, but it is **not yet where it should be for stricter multi-user, security-sensitive, or highly scaled environments**. The next step should be a focused hardening cycle: authorization, session handling, secret handling, and tests for those areas before more surface area is added.
