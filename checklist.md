# Project Checklist

## Critical

- [ ] Add ownership enforcement to all Socket.IO and backend resource handlers so monitor, heartbeat, maintenance, chart, proxy, and API-key actions always verify `user_id` before reading or mutating data.
- [ ] Add regression tests for cross-user access to monitor history, chart data, maintenance assignments, API key enable/disable, event clearing, and heartbeat clearing.

## High

- [ ] Add JWT expiry, revocation/versioning, and logout invalidation so stolen admin tokens do not remain valid indefinitely.
- [ ] Move admin session tokens out of `localStorage`/`sessionStorage` and use a safer cookie-based session model if the Socket.IO flow can support it.
- [ ] Encrypt monitor, proxy, and notification secrets at rest and stop returning secret fields in routine JSON/socket payloads.
- [ ] Enforce `published` and password protection for status pages on every public route and API response.
- [ ] Refactor `server/server.js` into focused auth, monitor, settings, and lifecycle modules with shared guard/error utilities.
- [ ] Split `src/pages/EditMonitor.vue`, `src/pages/StatusPage.vue`, and `src/mixins/socket.js` into smaller components/composables with clearer state boundaries.
- [ ] Add backend and E2E coverage for login, 2FA, API key ownership, session expiry, and `disableAuth` transitions.
- [ ] Add a first-class liveness/readiness endpoint for the main server instead of relying on `/metrics` or the temporary migration server.

## Medium

- [ ] Batch latest-heartbeat, uptime, and status-page queries to remove N+1 reads in dashboard and public-status-page paths.
- [ ] Replace serial monitor startup/restart sleeps with bounded concurrency plus jitter to improve restart time on large instances.
- [ ] Scope login/API/2FA rate limits by IP or actor so one noisy client cannot exhaust the global bucket for everyone.
- [ ] Lazy-load heavyweight frontend routes and remove the empty `manualChunks` placeholder from `config/vite.config.js`.
- [ ] Replace silent catch blocks with explicit logging or typed handling in socket handlers, monitor execution, and server startup paths.
- [ ] Replace stray `console.log` / `console.warn` calls in runtime code with the project logger or remove them entirely.
- [ ] Expand the sample `compose.yaml` with a healthcheck, safer exposure guidance, and explicit reverse-proxy/environment recommendations.
- [ ] Add an in-repo production operations guide covering backups, health checks, exposure model, reverse proxy, and upgrade posture.

## Low

- [ ] Align `.github/workflows/validate.yml` branch coverage with `.github/workflows/auto-test.yml`.
- [ ] Rename `test/e2e/specs/fridendly-name.spec.js` to fix the typo and keep test naming consistent.
- [ ] Remove stale TODOs and placeholder comments where the intended follow-up is now known.
- [ ] Review frontend and server debug logging for leftover development-only noise before release builds.
- [ ] Simplify or document the current route/import strategy in `src/router.js` so future code-splitting work has a clear direction.

## Features

- [ ] Add RBAC or at least read-only/operator roles so the project has a supported multi-user model instead of effectively assuming one admin.
- [ ] Add an audit log for settings changes, monitor edits, maintenance updates, login events, and API key actions.
- [ ] Add encrypted secret management with rotation support for monitor, proxy, and notification credentials.
- [ ] Add backup/export/restore tooling with integrity validation so operators can safely migrate and recover instances.
- [ ] Add per-tenant or per-user activity isolation tests and admin UX if multi-user support is meant to be a real feature.
