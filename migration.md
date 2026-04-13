# Migration Assessment

## Executive Summary

Uptime Kuma is a mature Node.js/Vue 3 monitoring application with ~20,000 lines of backend logic, ~29,000 lines of frontend code, 51 database migrations, 23 monitor types, and 93 notification providers. This assessment evaluates feasibility and difficulty of migrating to a Next.js frontend combined with either a NestJS backend or a Python (FastAPI) backend.

**Migration is feasible but carries substantial cost and risk.** The project is not in a state where migration would be trivial. The most significant structural barriers are the 894-line global Vue mixin with 484+ direct `$root` references, the Socket.IO-only API surface (no REST fallback), the Redbean-Node ORM coupling across 13 model files (~6,000 lines), and the sheer breadth of the notification provider and monitor type libraries (93 + 23 implementations).

**Difficulty ratings:**

| Target | Difficulty | Estimated Effort |
|---|---|---|
| Next.js frontend | High | 12–16 weeks, 2–3 senior engineers |
| NestJS backend | Medium-High | 10–15 weeks, 2–3 senior engineers |
| Python (FastAPI) backend | High | 16–22 weeks, 3–4 engineers |
| Full stack (Next.js + NestJS) | Very High | 18–24 weeks, 3–4 engineers |
| Full stack (Next.js + Python) | Very High | 22–30 weeks, 3–5 engineers |

**Best overall direction:** Next.js frontend + NestJS backend, pursued as a staged migration with the frontend migrated first (or independently), followed by the backend.

**Biggest risks:** ORM replacement (Redbean-Node is deeply coupled), Socket.IO event routing reorganization, EditMonitor.vue decomposition (4,094 lines), state management refactoring (484+ `$root` refs), and data integrity during migration.

**Whether to migrate at all:** The current stack is not broken. The project is productive, actively maintained, and deployable. Migration should only be pursued if there is a clear strategic reason — type safety, team scaling, framework standardization, or ecosystem alignment — not simply because migration is possible.

---

## Inputs Reviewed

- `review.md` — Full project review (16 findings across architecture, backend, frontend, data layer, security, testing, DevOps)
- `checklist.md` — Prioritized actionable checklist (Critical through Features)
- `server/server.js` — 1,998-line main server entry (direct inspection)
- `server/socket-handlers/` — 10 extracted socket handler files
- `server/monitor-types/` — 23 monitor type implementations
- `server/notification-providers/` — 93 notification provider implementations
- `server/model/` — 13 Redbean-Node model files
- `server/uptime-kuma-server.js` — Core server orchestration
- `server/db.js`, `server/database.js` — Database initialization and ORM bootstrap
- `server/jobs/` — Background cron jobs
- `src/mixins/socket.js` — 894-line global root mixin
- `src/router.js` — Vue Router configuration (15 routes)
- `src/pages/` — 15 page components (~9,923 LOC)
- `src/components/` — 147 component files (~18,814 LOC)
- `src/lang/en.json` — 1,534-line i18n source file (1,500+ keys)
- `config/vite.config.js` — Build configuration
- `db/knex_migrations/` — 51 migration files
- `package.json` — Full dependency inventory
- `compose.yaml`, `docker/dockerfile`, `ecosystem.config.js` — Deployment artifacts

---

## Current Architecture Summary

### Backend

The backend is a Node.js application (Express + Socket.IO) that uses Socket.IO as its primary API protocol. REST routes are minimal: 7 HTTP endpoints covering badges, push heartbeats, Prometheus metrics, and public status page serving. All authenticated CRUD operations — monitor management, notifications, maintenance, users, settings, API keys, proxies — are implemented as Socket.IO events (40+ in `server.js` plus ~1,100 lines across 10 extracted handler files).

`server/server.js` is 1,998 lines and still acts as the central hub for bootstrap, auth, 2FA, monitor CRUD, and lifecycle management. A partial extraction to `server/socket-handlers/` is underway (10 files, 1,577 lines) but core monitor management remains inline.

The 23 monitor types and 93 notification providers follow clean plugin patterns with base classes and a registration map, making them the most portable part of the backend. Each provider averages ~75 lines and depends only on HTTP libraries.

Background jobs are minimal: two Croner jobs (daily data cleanup and incremental vacuum). The monitor heartbeat loop is driven by per-monitor `setInterval` calls in the Node.js event loop — no worker threads, no queue system.

Authentication uses JWT (no expiry set — a known flaw from `review.md`), bcrypt for passwords, TOTP for 2FA, and bcrypt-hashed API keys. All secrets live in the SQLite/MariaDB database.

The ORM is Redbean-Node (Active Record), a Node.js-only library with no TypeScript support and no clean data-access abstraction. Business logic is mixed with persistence in all 13 model files. Switching the ORM is the highest-effort single task in any backend migration.

### Frontend

The frontend is a pure Vue 3 SPA built with Vite. There is no server-side rendering. The entire application state — monitors, heartbeats, auth, notifications, proxies, maintenance, status pages, and the Socket.IO connection itself — is held in a single 894-line root mixin (`src/mixins/socket.js`) that is mounted globally in `src/main.js`. Components access this shared state through 484+ direct `this.$root` property references.

There are 15 pages and 147 components totaling ~29,000 lines. The largest single file is `src/pages/EditMonitor.vue` at 4,094 lines, handling 20+ monitor types with deeply nested conditionals. The notification component directory contains 92 provider-specific form components.

There is no Vuex or Pinia. There are no route guards; authentication is enforced by socket event responses (`loginRequired`). The router uses an unusual `/empty` root wrapper.

The design system is Bootstrap 5 with light customization. Chart.js is used for ping charts and heartbeat bars via vue-chartjs. i18n covers 52 languages via vue-i18n.

### Data Layer

SQLite is the default database. MariaDB and PostgreSQL are also supported. Knex.js handles migrations (51 files) and acts as a database-agnostic query builder. Redbean-Node sits on top of Knex and provides Active Record-style persistence.

The schema is well-normalized with 15 core tables and 7 aggregate/stat tables. The heartbeat and stat tables can grow into the tens or hundreds of millions of rows. All 51 Knex migrations are database-agnostic (no SQLite-specific query functions). The SQLite pragmas used (WAL mode, cache size, vacuum) are initialization concerns that live in a few files and do not affect the portability of the schema or query logic.

### Deployment

Docker is the primary deployment target. The image runs a single Node.js process on port 3001. A `./data` volume holds the database and configuration. PM2 is supported via `ecosystem.config.js` but the file is nearly empty. The Dockerfile includes a healthcheck; `compose.yaml` does not.

---

## Migration to Next.js Frontend

### Feasibility

Technically feasible. No part of the Vue frontend is impossible to rewrite in Next.js. However, the migration is non-trivial due to deep global state coupling, complete Socket.IO dependency, and the size of several page components.

### Likely Migration Approach

A parallel-rewrite approach is most practical given the depth of coupling. An incremental strangler approach would require splitting the global mixin's state into independently replaceable slices first, which is itself significant work. A fresh Next.js project built alongside the existing Vue app, route by route, is cleaner.

The public status page (`/status/:slug`) is a natural starting point because it has no auth dependency, would benefit most from SSR, and is the highest-visibility user-facing surface. The admin UI migration can follow.

### Reusable Pieces

| Asset | Reusability | Notes |
|---|---|---|
| i18n JSON files (78 languages) | 100% | Direct reuse with next-intl or next-i18next |
| Utility functions (src/util.ts, src/util-frontend.js) | 70–80% | Mostly framework-agnostic |
| SCSS/CSS customizations | 80–90% | Bootstrap classes reusable directly |
| Business logic in component methods | 60–70% | Validation patterns, form logic portable |
| Notification component logic | 30–50% | Provider-specific config is portable; markup is Vue |
| Chart.js integration | Moderate | Replace vue-chartjs with react-chartjs-2 |
| DOMPurify sanitization | 100% | Framework-agnostic |
| Socket.IO event contracts | 100% | Server stays the same; client reuses event names |

### Rewrite-Heavy Areas

- **`src/mixins/socket.js`** — Must become React context + Zustand store + Socket.IO hooks. Zero lines of Vue mixin code carry over. This is the highest-effort single item.
- **`src/pages/EditMonitor.vue`** (4,094 lines) — Must be decomposed into 20+ per-monitor-type sub-components before or during migration.
- **`src/pages/StatusPage.vue`** (1,785 lines) — Needs SSR-aware rewrite as a Next.js App Router page.
- **`src/router.js`** — Vue Router concepts do not transfer. App Router file-based routing is a different model entirely.
- **All 147 `.vue` SFC templates** — Vue single-file component syntax (template/script/style) does not transfer to React/Next.js JSX. Every template must be rewritten.
- **`$root` references (484+)** — Each one is a manual fix; there is no automated codemod for this.

### Key Risks

1. **Global state refactoring is the critical path.** The 484+ `$root` references are pervasive. Until the mixin is broken into composable state slices, no meaningful component migration can proceed cleanly.
2. **No REST API exists.** Next.js Server Components, API routes, and data-fetching patterns all assume HTTP. The Socket.IO-only backend requires a custom Socket.IO client wrapper that must replicate all 27 client-to-server events and 31 server-to-client event listeners. This is manageable but architecturally unusual for Next.js.
3. **EditMonitor.vue size.** At 4,094 lines, this page cannot be migrated as a unit. It must be decomposed first; that decomposition is itself risky given its deeply nested monitor-type conditionals.
4. **Auth model.** Vue currently has no route guards; Next.js middleware-based auth (via `middleware.ts`) needs to be designed from scratch.
5. **Socket.IO in Next.js App Router.** Next.js does not host a Socket.IO server natively. The existing Express backend must be kept running, or a custom server setup is required. This affects deployment architecture.

### Estimated Effort

**12–16 weeks** with 2–3 senior React/Next.js developers.

- Architecture setup and Socket.IO hooks: 1–2 weeks
- State management refactor (mixin → Zustand/context): 4–6 weeks
- Router and auth middleware: 1–2 weeks
- Public status page (SSR): 2–3 weeks
- Admin dashboard and settings pages: 3–4 weeks
- Notification components (92): 2–3 weeks
- Charts and specialized components: 1–2 weeks
- i18n, theming, RTL: 1–2 weeks
- Testing and QA: 2–3 weeks

### Recommended Migration Phases

**Phase F1 — Foundation**
Establish the Next.js app, Zustand store design, Socket.IO React hooks, auth middleware, and route structure. Migrate the login page and main layout. No user-visible UI yet.

**Phase F2 — Public Status Page**
Migrate `/status/:slug` as a Next.js App Router SSR page. This delivers a meaningful improvement (faster public loads) independently of the admin UI.

**Phase F3 — Core Admin Pages**
Dashboard/home, monitor list, monitor details. These pages have moderate `$root` usage and are representative of the socket-driven data pattern.

**Phase F4 — EditMonitor**
Decompose `EditMonitor.vue` into per-type components, then migrate each to React. This is the riskiest phase and should not be attempted before the state layer is stable.

**Phase F5 — Settings, Maintenance, Notifications**
Migrate settings sub-pages and the 92 notification provider forms. The notification forms are formula-driven and benefit from shared component patterns established in earlier phases.

**Phase F6 — Cutover**
Parallel deployment, feature-flag rollout, final QA, removal of Vue app.

---

## Migration to NestJS Backend

### Feasibility

Feasible. NestJS is a Node.js framework that can host Socket.IO gateways, keep the same JavaScript/TypeScript ecosystem, and reuse many existing utility libraries. The monitor type and notification provider plugin patterns map reasonably well to NestJS dynamic modules or provider factories. The biggest challenge is replacing Redbean-Node with a type-safe ORM.

### Likely Migration Approach

A strangler pattern is viable here. NestJS can be introduced as a parallel module alongside the existing Express server, gradually taking over individual socket handler domains. The existing `server/socket-handlers/` decomposition provides natural module boundaries. The Redbean-Node ORM must be replaced early — it is a dependency of almost everything and cannot be incrementally swapped.

### Reusable Pieces

| Component | Portability | Notes |
|---|---|---|
| 93 notification providers | High | Business logic (HTTP calls, templates) is Node.js and reusable; base class needs adapting |
| 23 monitor type implementations | High | Core check logic is portable; heartbeat loop mechanics need reworking |
| `src/util-server.js` utilities | High | Framework-agnostic helpers |
| JWT auth logic | Medium | Replace `jsonwebtoken` raw calls with `@nestjs/jwt` + Passport strategy |
| bcrypt password handling | High | `bcryptjs` stays as-is |
| 2FA (notp + thirty-two) | High | Libraries stay as-is |
| Prometheus metrics | Medium | Replace `prometheus-api-metrics` with custom NestJS interceptor + prom-client |
| Knex migrations | High | 51 database-agnostic migration files are reusable as-is |
| Config loading (args + env + dotenv) | Medium | Replace with `@nestjs/config` |
| Rate limiting | High | Replace custom class with `@nestjs/throttler` |
| Croner background jobs | Medium | Replace with `@nestjs/schedule` |

### Rewrite-Heavy Areas

- **Redbean-Node ORM (13 models, ~6,000 lines)** — Must be replaced with TypeORM entities or Prisma schema definitions. Every model's persistence calls must be rewritten. This is the highest-effort item and carries the most data-integrity risk.
- **`server/server.js`** — The monolithic 1,998-line entry point must be decomposed into NestJS modules. The 40+ inline socket handlers must become `@SubscribeMessage()` gateway methods.
- **Auth flow** — Custom JWT and 2FA handling must be refactored into Passport strategies and NestJS guards.
- **Monitor heartbeat loop** — The `setInterval`-per-monitor pattern should be redesigned as `@nestjs/schedule`-driven tasks or a custom scheduler service.
- **Database initialization and multi-DB config** — The `db-config.json` + Knex init pattern must be replaced with NestJS DataSource configuration factory, handling SQLite/MySQL/PostgreSQL variants.

### Key Risks

1. **ORM migration is the highest single risk.** Redbean-Node is a dynamic, schema-less Active Record library with no TypeScript types. Migrating to TypeORM requires writing entity classes, migration files, and all repository calls for all 13 models. Any mistake in entity mapping could corrupt heartbeat or stat data.
2. **Socket.IO gateway organization.** Reorganizing 40+ inline socket events into NestJS `@WebSocketGateway()` classes introduces risk of auth bypass if ownership guards are not correctly applied to every handler. The existing authorization drift problem (`review.md` Critical finding) could be replicated or made worse if guards are not central.
3. **Multi-database support.** NestJS + TypeORM can support SQLite/MySQL/PostgreSQL but requires a database-aware `DataSource` factory. The existing flexible config model (db-config.json + env) must be preserved.
4. **Monitor heartbeat reliability.** The single-threaded `setInterval` pattern is simple but fragile at scale. A NestJS migration is an opportunity to improve it, but also a risk of introducing check delays or dropped heartbeats during the transition.
5. **Plugin system for 93 providers.** NestJS DI makes dynamic loading more complex than the current `require()` + registry pattern. This is solvable but requires careful design.

### Estimated Effort

**10–15 weeks** with 2–3 senior TypeScript/NestJS developers.

- Project setup, module structure, config: 1 week
- TypeORM entity design and migration of 13 models: 3–4 weeks
- Socket.IO gateway migration (auth, monitor, maintenance, etc.): 2–3 weeks
- Auth (Passport, JWT, 2FA, API keys, guards): 1–2 weeks
- Background jobs and heartbeat scheduler: 1–2 weeks
- Monitor types and notification providers migration: 1–2 weeks
- Prometheus and observability: 0.5 weeks
- Testing: 2–3 weeks

### Recommended Migration Phases

**Phase B1 — Foundation and ORM**
Set up NestJS project, configure TypeORM with multi-DB factory, define all 13 entity classes, run existing Knex migrations to establish the schema, validate data access.

**Phase B2 — Auth and Security**
Implement Passport JWT strategy, 2FA guard, API key guard, `@nestjs/throttler` rate limiting with per-IP keying, and ownership guard helpers (`assertOwnedMonitor`, `assertOwnedProxy`, etc.) fixing the Critical finding from `review.md`.

**Phase B3 — Socket Gateways**
Migrate each `server/socket-handlers/` file to a NestJS `@WebSocketGateway()` module. Migrate the remaining inline handlers in `server.js` last.

**Phase B4 — Monitor Heartbeat and Jobs**
Migrate the monitor startup and heartbeat loop to NestJS scheduler. Migrate Croner jobs to `@nestjs/schedule`.

**Phase B5 — Providers and Monitors**
Register all 23 monitor types and 93 notification providers in the NestJS DI container. Validate each works end-to-end.

**Phase B6 — Cutover**
Run NestJS server in parallel with old server under a feature flag, validate all socket events and REST endpoints, then cut over.

---

## Migration to Python Backend

### Feasibility

Technically feasible but substantially more effort than the NestJS path. Python has equivalents for every major backend concern, but the breadth of the monitor type and notification provider libraries — many of which use Node.js-specific packages (gamedig, net-snmp, mqtt, kafkajs, @grpc/grpc-js, nodemailer) — means that approximately 6–8 of the 23 monitor types require significant reimplementation or finding Python-native library equivalents. The 93 notification providers are simpler (mostly HTTP calls) and port more cleanly.

FastAPI is the recommended Python framework for this use case: async-native, Pydantic validation, good Socket.IO support via `python-socketio`, and SQLAlchemy 2.0 for database access.

### Likely Migration Approach

A parallel rewrite is the only realistic approach. The Python codebase would be a greenfield project consuming the same database (via SQLAlchemy targeting the same schema) and the same Socket.IO client protocol. The Knex migration files cannot be used directly in Python; they would be replicated as Alembic migrations. The Vue frontend stays unchanged during backend migration.

### Reusable Pieces

| Component | Portability | Notes |
|---|---|---|
| Database schema (51 Knex migrations) | Medium | Must be recreated as Alembic migrations; SQL is standard |
| Notification provider logic (93 providers) | Medium | HTTP call logic ports to httpx/aiohttp; templates port to Jinja2 |
| JWT auth model | High | PyJWT is a direct equivalent |
| bcrypt password handling | High | passlib is a direct equivalent |
| 2FA (TOTP) | High | pyotp is a direct equivalent |
| Prometheus metrics | High | prometheus-client (Python) is well-supported |
| Monitor type protocols (HTTP, TCP, ping, DNS) | High | aiohttp, asyncio socket, aiodns |
| Monitor type protocols (MQTT, Kafka, gRPC) | Medium | paho-mqtt, kafka-python, grpcio exist |
| Monitor type protocols (gamedig, net-snmp) | Low | gamedig has no mature Python equivalent; pysnmp for SNMP |
| Configuration model (env + file) | High | Pydantic Settings is a direct improvement |
| API contracts (REST endpoints) | High | FastAPI route definitions are simpler |
| E2E tests | High | Playwright tests are language-agnostic HTTP tests |
| Backend unit test logic | Medium | Patterns port; framework-specific setup changes |

### Rewrite-Heavy Areas

- **All 23 monitor type implementations** — The check logic ports to Python asyncio, but 6–8 types depend on Node-exclusive packages (gamedig, nodemailer SMTP testing, tailscale-ping subprocess calls) that have no equivalent and must be reimplemented.
- **Socket.IO server** — `python-socketio` with Uvicorn works but is a third-party integration. Connection lifecycle, room management, and reconnection behavior differ from the Node.js `socket.io` server in subtle ways that affect the existing Vue client.
- **All 13 data models** — Redbean-Node Active Record → SQLAlchemy 2.0 AsyncSession. Every model, every query, every transaction must be rewritten.
- **Monitor heartbeat loop** — asyncio + APScheduler or Celery is a paradigm change from Node.js `setInterval`. Concurrency model is fundamentally different; blocking I/O in any check function will stall the event loop.
- **`server.js` initialization logic** — Python startup, dependency injection via FastAPI `Depends()`, and service container design all require a ground-up redesign.

### Key Risks

1. **Async correctness is the most dangerous risk.** Python asyncio is unforgiving of blocking calls. Any one of the 23 monitor types or 93 providers accidentally blocking the event loop will stall all concurrent checks. This requires careful library selection and testing for every integration.
2. **gamedig has no Python equivalent.** Game server monitoring (one of the 23 types) uses a Node.js-specific library. Python migration would require either calling the Node binary as a subprocess, building a Python implementation from scratch, or dropping the feature.
3. **python-socketio compatibility with the existing Vue client.** The Vue frontend uses socket.io-client v4.8.x. `python-socketio` supports Socket.IO v4 but has historically had minor compatibility issues with newer clients. This requires thorough compatibility testing.
4. **Team context switching.** If the current team is Node.js-native, a Python backend means a full ecosystem change: dependency management (Poetry vs npm), testing patterns (pytest vs Node test runner), linting (flake8/ruff vs ESLint), and async debugging tools.
5. **Migration duration risk.** At 16–22 weeks estimated, this migration has a longer tail than NestJS and more surface area to get wrong. Scope creep risk is higher.

### Estimated Effort

**16–22 weeks** with 3–4 engineers experienced in Python async.

- FastAPI project setup, SQLAlchemy models, Alembic migrations: 2–3 weeks
- Socket.IO server setup (python-socketio + Uvicorn): 2–3 weeks
- Auth (JWT, 2FA, API keys, bcrypt, guards): 1–2 weeks
- Monitor heartbeat loop (asyncio scheduler): 2–3 weeks
- 23 monitor type implementations: 4–5 weeks
- 93 notification providers: 3–4 weeks
- Background jobs (APScheduler): 1 week
- Prometheus and observability: 0.5 weeks
- Testing and QA: 3–4 weeks

### Recommended Migration Phases

**Phase P1 — Core Infrastructure**
Set up FastAPI, SQLAlchemy with async sessions, Alembic migrations targeting the existing schema, Pydantic Settings for config, and a minimal Socket.IO gateway. Validate database reads/writes match existing data.

**Phase P2 — Auth**
Implement JWT auth, bcrypt verification, 2FA (pyotp), API key verification, and all Socket.IO auth guards. This must be complete before any user-facing feature works.

**Phase P3 — Monitor Heartbeat Engine**
Implement the monitor scheduling and check loop with asyncio. Start with 5–6 simple monitor types (HTTP, TCP, Ping, DNS). Validate heartbeat emission to connected clients.

**Phase P4 — Full Monitor Type Coverage**
Implement the remaining 17 monitor types. Resolve gamedig and any blocking-library issues in this phase.

**Phase P5 — Notification Providers**
Implement all 93 notification providers. Use a base class pattern identical to the current Node.js approach.

**Phase P6 — REST Endpoints and Observability**
Implement the 7 REST endpoints (badges, push, metrics) and Prometheus integration.

**Phase P7 — Cutover and Testing**
Parallel deployment, compatibility testing of python-socketio vs Vue client, E2E validation, cutover.

---

## Side-by-Side Comparison

| Dimension | Next.js + NestJS | Next.js + Python (FastAPI) |
|---|---|---|
| **Architecture fit** | Strong — same JS/TS ecosystem end-to-end; NestJS Socket.IO gateways map directly to existing patterns | Moderate — Python async is capable but conceptually distant from Node.js event loop; Socket.IO compat is a third-party concern |
| **Migration difficulty** | High (frontend) + Medium-High (backend) = Very High total | High (frontend) + High (backend) = Very High total, longer tail |
| **Code reuse potential** | Higher — Node.js utilities, jwt, bcrypt, Socket.IO patterns, Knex migrations all carry over | Lower — ORM, monitoring libraries, notification providers, async patterns mostly require reimplementation |
| **Runtime complexity** | Single JS/TS runtime for both frontend and backend; Next.js requires keeping Express for Socket.IO | Two distinct runtimes (Next.js + Python); ASGI/Uvicorn for Python + custom Socket.IO server |
| **Operational complexity** | Moderate — Next.js app server + NestJS API/socket server; both Node.js, similar deployment | Higher — Next.js (Node.js) + Python/Uvicorn app; different health checks, logging, resource models |
| **Team productivity** | Higher if team is TS-native; DI and type safety reduce bugs over time | Higher if team is Python-native; faster iteration but more up-front rewrite time |
| **Long-term maintainability** | High — TypeScript throughout, NestJS module architecture, clear separation | Moderate — Python FastAPI is clean but depends on team Python proficiency; asyncio errors are subtle |
| **Testing impact** | Backend tests mostly port; new NestJS testing patterns needed; Playwright E2E stays | Backend logic ports to pytest; asyncio test patterns different; Playwright E2E stays |
| **Deployment impact** | Two Node.js services; familiar Docker model; can share base image | Two heterogeneous services; separate Dockerfiles; more CI/CD complexity |
| **Observability** | prom-client stays; OpenTelemetry for Node.js is mature | prometheus-client (Python) is good; OpenTelemetry for Python less mature than Node.js |
| **Rewrite scope** | ~55–60% of frontend rewrite; ~60–70% of backend rewrite | ~55–60% of frontend rewrite; ~80–90% of backend rewrite |
| **Estimated total effort** | 18–24 weeks | 22–30 weeks |
| **Monitor type coverage risk** | Low — all 23 types use Node.js packages that stay in NestJS | High — 6–8 types depend on Node-exclusive packages needing reimplementation |
| **Socket.IO client compat** | Zero risk — same socket.io library | Non-zero risk — python-socketio compatibility with socket.io-client v4 requires validation |
| **Known issues from review.md** | Security and authz findings are opportunities to fix in NestJS guards/interceptors | Same opportunities, but more migration surface area increases regression risk |

**Summary verdict:** Next.js + NestJS is the superior choice for this codebase. It preserves the Node.js ecosystem that the existing monitor type and notification provider libraries depend on, reduces total rewrite scope, has a shorter migration path, and is a better fit for a team already working in JavaScript/TypeScript. Python is a reasonable choice only if the team has deep Python async experience and the project's Node.js dependencies are acceptable to drop or stub.

---

## Migration Risks

### Technical Risks

1. **ORM replacement (Critical)** — Migrating from Redbean-Node to TypeORM (NestJS) or SQLAlchemy (Python) affects all 13 models and ~6,000 lines of persistence code. A mapping error in any heartbeat, monitor, or stat table could cause data loss or corruption. This risk is present in both backend targets.

2. **Socket.IO event contract fidelity (High)** — The Vue frontend depends on 31 server-to-client events and 27 client-to-server events. Any event renamed, removed, or payload-changed in the new backend will break the frontend silently unless tested. A socket event contract test suite must be established before cutover.

3. **Authorization drift replication (High)** — The existing backend has inconsistent ownership checks (`review.md` Critical finding). Migrating socket handlers to NestJS gateways without building proper guards first risks replicating or worsening these vulnerabilities.

4. **EditMonitor.vue decomposition (High)** — The 4,094-line page component cannot be safely migrated without first being decomposed into smaller units. That decomposition in Vue is itself risky, and doing it during a framework migration increases the blast radius of errors.

5. **gamedig and protocol library coverage (Medium)** — In the NestJS path, gamedig and other Node.js libraries stay as-is. In the Python path, gamedig has no Python equivalent. If game server monitoring matters to users, this is a blocking feature gap.

6. **asyncio blocking in Python (High, Python path only)** — Any monitor type or notification provider that accidentally blocks the event loop in Python will degrade all concurrent monitoring. This is a category of bug that does not exist in the current Node.js code and requires active vigilance during Python migration.

### Delivery Risks

7. **Underestimated `$root` coupling scope (High)** — 484+ direct `$root` references in the Vue frontend are a known count but each reference requires human judgment to replace correctly. Automated codemods cannot reliably resolve these. Scope estimate could slip by 30–50%.

8. **Multi-database support complexity (Medium)** — Maintaining SQLite, MariaDB, and PostgreSQL support in a new ORM (TypeORM or SQLAlchemy) requires conditional DataSource configuration and testing across all three DB types. Teams often undertest the non-primary DB paths.

9. **Timeline compression on 93 providers (Medium)** — The notification providers are individually simple but there are 93 of them. If cut scope is not accepted early, provider implementation becomes a long tail that delays cutover.

### Regression Risks

10. **Heartbeat reliability during migration (Critical)** — Uptime Kuma's core value is continuous monitoring. Any migration-induced downtime or missed check during the heartbeat loop migration is a direct product failure.

11. **Public status page availability (High)** — Status pages are external-facing and often embedded in dashboards. A broken SSR render or routing error during migration is immediately visible to end users.

### Operational Cutover Risks

12. **Database schema compatibility (Medium)** — Running the new and old backend against the same database in parallel is possible but requires that both systems agree on schema at the moment of cutover. Any in-flight migration that the new backend assumes but the old backend has not run will cause errors.

13. **Session invalidation on cutover (Low)** — If JWT secrets change or the JWT payload format changes during the NestJS migration, existing logged-in users will be forcibly logged out at cutover.

### Team and Process Risks

14. **Parallel maintenance burden (High)** — During any phased migration, both the old and new systems must be kept working. Bug fixes in the old system must be evaluated for backport to the new one. This doubles the cognitive load during the migration period.

15. **Scope creep from security improvements (Medium)** — The security findings in `review.md` (JWT expiry, secret encryption, rate limiting, ownership guards) are legitimate improvements that should be made during migration. However, combining security hardening with framework migration increases risk if not carefully sequenced.

---

## Recommended Migration Strategy

### Recommendation

Migrate the **frontend first** (Vue 3 → Next.js), then migrate the **backend** (Express/Socket.IO → NestJS). Do not attempt a simultaneous full-stack rewrite.

The frontend migration can proceed independently: the Next.js app connects to the same existing Express + Socket.IO backend. There is no need to change the backend at all during frontend migration. This isolates risk and delivers the first benefit (SSR for status pages, Next.js ecosystem, TypeScript throughout the UI) before any backend disruption.

If the team has limited bandwidth or the current state is operationally acceptable, the frontend migration alone may be the correct stopping point. NestJS backend migration is worthwhile primarily if the team needs the improved module architecture, TypeScript-native ORM, or NestJS DI for testability — not just for migration's sake.

### Pattern

**Frontend:** Parallel rewrite with progressive route cutover. Build the Next.js app as a standalone project. Route by route, switch traffic from Vue to Next.js. The status page public route ships first; admin routes follow. The Vue app is removed only after all routes are validated.

**Backend:** Strangler pattern within the same Node.js process is possible (NestJS can be introduced as an Express middleware adapter), but a cleaner approach is a new NestJS app sharing the same database, running in parallel on a different port with traffic routed by an upstream proxy, until NestJS handles 100% of events.

### What to Migrate First

1. Public status page (Next.js SSR, no auth complexity)
2. Login and session management (establishes auth model for all subsequent pages)
3. Monitor list and dashboard (high-frequency admin view)
4. Settings pages (low-risk, self-contained)
5. EditMonitor (after decomposition is complete)

**Backend migration order:**

1. ORM migration (TypeORM entities — no user-facing impact, just schema validation)
2. Auth module (JWT, 2FA, guards)
3. Monitor read paths (list, get, heartbeats)
4. Monitor write paths (add, edit, delete, start, pause)
5. Maintenance, notifications, proxies, status pages, API keys

### What Not to Migrate Early

- **EditMonitor.vue** — Migrate this last in the frontend. It has the most monitor-type-specific logic and is the highest regression risk.
- **93 notification providers** — Migrate these as a batch late in the process. They are individually low-risk but collectively high-volume. Migrating them early wastes effort that may need to be repeated.
- **Monitor heartbeat loop** — Do not attempt to change the heartbeat scheduling mechanism at the same time as ORM migration. Separate these concerns into distinct phases.
- **The database itself** — Do not change from SQLite to PostgreSQL during the migration. That is a separate concern and adds unnecessary risk. Existing Knex migrations and the new TypeORM schema should both target SQLite initially.

### How to Reduce Risk

- Establish a **socket event contract test suite** (recording/replaying all 58 socket events) before any backend change. This acts as a compatibility regression harness.
- Fix the **Critical authorization drift** (ownership checks in socket handlers) at the start of the NestJS migration, not after. Build `assertOwnedMonitor` and similar guards as the first thing placed in the NestJS gateway middleware.
- Keep the **old server running in parallel** during the NestJS migration and only cut over when the socket event test suite passes 100%.
- Do not combine **security hardening with framework migration** in the same sprint. Fix JWT expiry, secret storage, and rate limiting as a separate prior pass.

---

## Proposed Migration Phases

### Frontend Phases

**Phase F1 — Foundation** (1–2 weeks)
- Objective: Establish Next.js project structure, state management, and Socket.IO integration
- Scope: Next.js 14+ app scaffolding, Zustand store design replacing socket.js mixin, Socket.IO hooks for all 27 client-to-server events and 31 server-to-client events, auth middleware skeleton, route structure
- Dependencies: None (no user-visible change)
- Deliverables: Working Next.js app that can log in and receive heartbeats from the existing backend
- Exit criteria: Authenticated socket connection established; monitorList populated in Zustand store

**Phase F2 — Public Status Page** (2–3 weeks)
- Objective: Ship SSR-rendered public status page
- Scope: `/status/:slug` route as Next.js App Router page with SSR, incident display, monitor status badges, DOMPurify sanitization preserved
- Dependencies: Phase F1 socket hooks (or REST endpoint if added)
- Deliverables: Public status page served by Next.js with full SSR
- Exit criteria: Lighthouse performance improvement over SPA version; all existing status page features work

**Phase F3 — Core Admin UI** (3–4 weeks)
- Objective: Migrate dashboard, monitor list, monitor details
- Scope: Login page, dashboard home, monitor list view, monitor detail/history view, heartbeat bar and ping chart components
- Dependencies: Phase F1 complete
- Deliverables: Functional admin UI for viewing monitors
- Exit criteria: All monitor read operations work; charts render correctly; i18n functional

**Phase F4 — Settings and Maintenance** (2–3 weeks)
- Objective: Migrate settings sub-pages and maintenance windows
- Scope: All 12 settings sub-routes, maintenance create/edit/list
- Dependencies: Phase F3
- Deliverables: Full settings management in Next.js
- Exit criteria: Settings save/load round-trip verified; no regressions in notifications/proxies config

**Phase F5 — EditMonitor** (4–5 weeks)
- Objective: Migrate monitor creation and editing
- Scope: Decompose Vue `EditMonitor.vue` into 20+ sub-components then rewrite each in React; per-monitor-type form components; conditions UI
- Dependencies: Phase F3, F4
- Deliverables: Full monitor CRUD in Next.js
- Exit criteria: All 23 monitor types can be created and edited; E2E monitor form tests pass

**Phase F6 — Notification Components and Cutover** (3–4 weeks)
- Objective: Migrate 92 notification provider forms and complete cutover
- Scope: All 92 notification Vue components rewritten as React; parallel deployment testing; Vue app removal
- Dependencies: Phase F5
- Deliverables: Complete Next.js admin UI; Vue app retired
- Exit criteria: All Playwright E2E tests pass on Next.js app; Vue app serving zero traffic for 2 weeks

### Backend Phases (after frontend, or in parallel by separate team)

**Phase B1 — ORM Migration** (3–4 weeks)
- Objective: Replace Redbean-Node with TypeORM, validate schema integrity
- Scope: Define TypeORM entities for all 13 models; run existing 51 Knex migrations to establish schema; write TypeORM repositories; validate all data read/write operations against existing SQLite database
- Dependencies: None (no user-facing change; old server still runs)
- Deliverables: TypeORM data layer passing all existing backend tests
- Exit criteria: All 13 entity types read/write correctly; data from existing DB is accessible without corruption

**Phase B2 — Auth and Security** (1–2 weeks)
- Objective: Implement auth in NestJS with security improvements
- Scope: Passport JWT strategy, 2FA guard, API key guard, `@nestjs/throttler` rate limiting with per-IP keying, ownership guard helpers fixing Critical finding from `review.md`
- Dependencies: Phase B1
- Deliverables: Secure auth layer; socket gateway auth middleware
- Exit criteria: Login, logout, 2FA, and API key flows tested; cross-user resource access returns 403

**Phase B3 — Socket Gateways** (2–3 weeks)
- Objective: Migrate all socket handlers to NestJS gateways
- Scope: One NestJS gateway module per handler domain (monitor, maintenance, status-page, api-key, proxy, docker, general); migrate 40+ inline handlers from `server.js`
- Dependencies: Phase B2
- Deliverables: All socket events handled by NestJS; socket event contract test suite passing
- Exit criteria: 100% of socket events handled; frontend client connects without changes

**Phase B4 — Monitor Engine** (2–3 weeks)
- Objective: Migrate heartbeat scheduler to NestJS
- Scope: Replace `setInterval`-per-monitor with `@nestjs/schedule`-driven scheduler; implement bounded concurrency at startup; migrate Croner background jobs
- Dependencies: Phase B3
- Deliverables: Monitor checks running under NestJS scheduler
- Exit criteria: No dropped heartbeats over 24-hour soak test; startup time measurably improved

**Phase B5 — Providers and Types** (1–2 weeks)
- Objective: Register and validate all monitor types and notification providers
- Scope: Register all 23 monitor types and 93 notification providers in NestJS DI container; validate each works end-to-end
- Dependencies: Phase B4
- Deliverables: Full provider and type coverage under NestJS
- Exit criteria: One integration test per monitor type; notification provider send paths verified

**Phase B6 — Cutover** (1–2 weeks)
- Objective: Cut traffic from old Express server to NestJS
- Scope: Parallel deployment, traffic shifting, socket event regression testing, old server removal
- Dependencies: Phase B5
- Deliverables: NestJS serving 100% of traffic; old server retired
- Exit criteria: No user-reported regressions for 2 weeks post-cutover; all E2E tests pass

---

## Rough Effort Assessment

### Next.js Frontend Migration

**Rating: High**

Driven by:
- 484+ `$root` references requiring manual resolution — no codemod automation possible
- 894-line global Vue mixin must be fully redesigned as React hooks and Zustand store
- 147 Vue SFC components must be rewritten as React/TSX — template syntax has no equivalent
- Socket.IO-only backend means custom React hook wrappers for 58 socket events
- `EditMonitor.vue` (4,094 lines) must be decomposed before migration can proceed
- 92 notification provider components are individually simple but collectively high volume

Mitigating factors: i18n JSON files, utility functions, business logic, and chart integration are all highly portable. The Vue/React conceptual model is similar enough that experienced engineers can move quickly once the state layer is established.

### NestJS Backend Migration

**Rating: Medium-High**

Driven by:
- Redbean-Node ORM replacement across 13 models and ~6,000 lines — highest single-task effort
- Socket.IO gateway reorganization of 40+ inline events from a 1,998-line monolith
- Multi-database support (SQLite/MySQL/PostgreSQL) requires careful TypeORM DataSource factory
- Auth refactor (JWT + 2FA + API keys) must be done correctly without introducing regressions

Mitigating factors: The Node.js ecosystem is preserved — no library replacement for monitor types or notification providers. TypeScript carries over. NestJS supports all the patterns used in the existing code. The partial extraction to `server/socket-handlers/` provides natural module boundaries.

### Python Backend Migration

**Rating: High**

Driven by:
- Full ecosystem change — every Node.js runtime dependency must be replaced
- 6–8 monitor types depend on Node-exclusive packages with no Python equivalents
- asyncio async model requires careful library selection throughout; blocking-I/O bugs are silent
- `python-socketio` + Uvicorn compatibility with the Vue socket.io-client v4 is third-party and non-trivial
- 93 notification providers are individually simple but require Python HTTP client and template engine replacements
- Team context switching from Node.js to Python ecosystem

Mitigating factors: FastAPI is simpler to scaffold than NestJS. Python has mature equivalents for HTTP, JWT, bcrypt, TOTP, and Prometheus. Alembic migrations from the existing Knex schema are straightforward. SQLAlchemy 2.0 async is capable.

---

## Conclusion

Uptime Kuma is a productive, deployable, and actively maintained project. Migration to Next.js + NestJS is a valid engineering investment if the team has clear strategic goals — type safety, modular architecture, improved testability, or broader contributor accessibility. It is not an emergency necessity.

**The recommended path is:**

1. **Frontend first: Vue 3 → Next.js App Router.** Begin with the public status page (SSR benefit is immediate), then move the admin UI progressively. This migration is independent of the backend and delivers value without disrupting monitoring reliability.

2. **Before or alongside the frontend migration: address the Critical and High security findings from `review.md`.** JWT expiry, ownership guard inconsistencies, and secret handling should not wait for a framework migration. Fix them in the existing codebase first.

3. **Backend second: NestJS (not Python).** After the frontend is stable on Next.js, migrate the backend to NestJS. Begin with the ORM (TypeORM replacing Redbean-Node), then auth, then socket gateways. The Node.js ecosystem is preserved, the monitor type and notification provider libraries stay as-is, and TypeScript coverage improves across the stack.

4. **Do not migrate to Python** unless the team has a specific, compelling reason. The Python path requires a near-complete rewrite of the backend including 6–8 monitor types that depend on Node.js-exclusive libraries, carries higher compatibility risk with the Socket.IO client, and delivers no meaningful advantage over NestJS for this project's architecture.

**Total estimated effort for full migration (Next.js + NestJS):** 18–24 weeks with 3–4 engineers, assuming the security hardening work is done in parallel as a separate track. The frontend and backend migrations can be run by different team members concurrently after Phase F1 is complete, reducing wall-clock time.

**A migration that is not fully committed to is worse than no migration.** A half-migrated codebase — some Vue, some Next.js; some Express, some NestJS — is harder to maintain than either alone. If the team cannot staff and fund this to completion, the better investment is hardening the existing codebase using the `checklist.md` action items.
