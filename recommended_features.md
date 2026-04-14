# Uptime Pro — Recommended Features

A comprehensive review of features that are missing, underdeveloped, or would materially improve the product. Based on a full codebase audit against industry standards for uptime monitoring tools.

---

## What Currently Exists (Baseline)

Before identifying gaps, the current feature set includes:

**Monitor Types (23):** HTTP/HTTPS (keyword, JSON query, certificate), TCP/Port, Ping, Push, DNS, Docker Container, MQTT, gRPC keyword, Steam game server, GameDig, Tailscale Ping, WebSocket Upgrade, PostgreSQL, MySQL, MSSQL, MongoDB, Redis, RabbitMQ, SNMP, SMTP, SIP Options, Oracle DB, Real Browser, Globalping, System Service, Manual, Group

**Notification Providers (93):** Discord, Slack, PagerDuty, OpsGenie, Teams, Telegram, Email (SMTP), Webhook, Pushover, Gotify, ntfy, Signal, WhatsApp (multiple), Twilio, Apprise, and ~75 more

**Auth:** Single-user with JWT, 2FA (TOTP), API keys, bcrypt passwords

**Status Pages:** Custom domains, themes (light/dark/auto), incidents, maintenance windows, monitor groups, custom CSS, RSS, badges, analytics integrations, footer text, logo upload

**Monitoring Config:** Retry logic, retry intervals, resend intervals, custom headers, authentication (Basic, OAuth2), TLS ignore, upside-down mode, heartbeat history, response time tracking, response body saving, accepted status codes

**Other:** Maintenance windows (recurring/one-time/cron-based), Docker host monitoring, proxy support, remote browser (Chromium), Cloudflare Tunnel built-in, data retention settings, SQLite/MariaDB/MySQL database support, tags, badge API, web push notifications, RDAP domain expiry tracking

---

## Missing Features by Category

---

### 🔴 Critical — Core Product Gaps

#### 1. Role-Based Access Control (RBAC)
**What's missing:** Multiple user accounts exist and monitors/tags/proxies are scoped per user, but all non-admin users have identical permissions. There are no roles, no viewer access, and no way to grant limited access to specific monitors or status pages.
- No user roles (admin / editor / viewer)
- Any logged-in user can create, edit, or delete any resource they own
- No read-only user role (e.g., for NOC staff who should only view dashboards)
- No per-monitor or per-status-page access control list
- No team/organization concept — no way to share ownership of monitors between users
- No audit log of who changed what

**Why it matters:** Teams need differentiated access — not everyone who needs to view dashboards should also be able to delete monitors or change notifications.

**Suggested implementation:**
- Extend the existing `user` table with a `role` field (admin/editor/viewer)
- Viewer role: read-only dashboard and status pages
- Editor role: can manage monitors/notifications but not users/global settings
- Admin role: full access
- Optional: per-monitor ACL table for fine-grained sharing

---

#### 2. Scheduled / Periodic Reports
**What's missing:** No email or export-based reporting. Users cannot get a weekly summary of uptime, incidents, or SLA compliance without manually checking the dashboard.
- No scheduled PDF or CSV uptime reports
- No SLA calculation or SLA dashboard widget
- No weekly/monthly summary emails
- No incident summary exports

**Why it matters:** Stakeholders and customers need to receive uptime reports without logging into the tool.

**Suggested implementation:**
- Add a `reports` settings section with configurable schedule (daily/weekly/monthly)
- Generate a summary: uptime %, incident count, avg response time per monitor
- Deliver via email notification provider or downloadable from UI

---

#### 3. REST API — Read/Write Completeness
**What's missing:** The existing REST API (`/api/badge/...`) is extremely limited — only badge image endpoints are exposed publicly. All monitor management, status reads, and configuration go through Socket.IO, which is not a standard integration interface.
- No REST endpoint to list monitors
- No REST endpoint to get monitor status
- No REST endpoint to create/update/delete monitors
- No REST endpoint to trigger manual checks
- No OpenAPI/Swagger documentation

**Why it matters:** Integrating Uptime Pro with CI/CD pipelines, infrastructure-as-code tools (Terraform, Ansible), or other dashboards requires a proper REST or GraphQL API.

**Suggested implementation:**
- Add authenticated REST endpoints under `/api/v1/monitors`
- Secure with existing API key mechanism
- Add OpenAPI spec generated from routes
- At minimum: GET /monitors, GET /monitors/:id/status, POST /monitors, PUT /monitors/:id, DELETE /monitors/:id

---

#### 4. Alerting: Escalation Policies and On-Call Scheduling
**What's missing:** Notifications fire immediately to all configured channels with no escalation, deduplication, or routing logic.
- No escalation chains (notify person A, then B if unacknowledged after N minutes)
- No on-call schedules (weekday vs weekend, person rotation)
- No alert acknowledgment tracking in the UI
- No "alert storm" suppression or deduplication window
- No alert routing rules (e.g., critical monitors go to PagerDuty, low-priority go to Slack)

**Why it matters:** At scale, flat notification delivery causes alert fatigue and missed incidents. Tools like PagerDuty and Opsgenie exist because this is a solved but complex problem.

**Suggested implementation (phased):**
- Phase 1: Alert acknowledgment — add "Ack" button on dashboard, suppress re-notifications while acked
- Phase 2: Escalation — if unacknowledged after X minutes, notify secondary channel
- Phase 3: On-call schedules — define time-based routing rules per notification group

---

### 🟠 High — Significant Product Improvements

#### 5. Monitor Import / Export (Backup & Restore)
**What's missing:** No way to export all monitors, notifications, and settings to a portable format, or import them on a fresh install.
- No JSON/YAML export of monitor configurations
- No bulk import of monitors
- No backup/restore workflow beyond raw database copy
- Migration between instances requires manual database file transfer

**Why it matters:** Users lose all configuration if the database is lost or when migrating to a new server. This is a major operational risk.

**Suggested implementation:**
- Add "Export configuration" in Settings → exports a JSON file with all monitors, notifications, proxies, tags, and status page configs (no sensitive data like passwords, or clearly warn)
- Add "Import configuration" with conflict resolution (skip / overwrite / merge)

---

#### 6. Incident Management Workflow
**What's missing:** Incidents can be posted to status pages but there is no structured incident lifecycle.
- No incident severity levels (Critical / Major / Minor / Maintenance)
- No incident timeline / update trail visible on status page
- No automatic incident creation when a monitor goes down
- No auto-resolution when monitor recovers
- No public incident URL / permalink
- No subscriber notifications for status page incidents

**Why it matters:** Users expect a status page to not just show monitor health but to communicate incidents in a structured way, as Statuspage.io and Betterstack do.

**Suggested implementation:**
- Add severity and status fields (investigating → identified → monitoring → resolved) to the incident model
- Auto-create a draft incident when a monitor exceeds a configurable downtime threshold
- Add update timeline (append-only) to incidents
- Add email/webhook subscription for status page updates

---

#### 7. Status Page Subscriber Notifications
**What's missing:** Users cannot subscribe to a status page to receive incident or recovery notifications.
- No email subscription for status page
- No webhook subscription
- No RSS subscription (RSS feed exists but no subscription management)

**Why it matters:** Status pages are most valuable when customers are proactively informed. Currently they must poll the page manually.

**Suggested implementation:**
- Add subscriber model: email, webhook URL, or RSS
- On incident post/update/resolution, send notification to all subscribers
- Add unsubscribe link/token mechanism
- Optionally gate subscription behind CAPTCHA or email confirmation

---

#### 8. PostgreSQL Support
**What's missing:** The Prisma schema supports multiple databases and PostgreSQL is partially wired, but it is not production-ready. The app defaults to SQLite and has no tested PostgreSQL path.
- No `@prisma/adapter-pg` or `pg` driver configured
- Several raw SQL queries use SQLite-specific syntax (backtick table quoting, PRAGMA statements)
- Knex migrations have no PostgreSQL dialect tested
- No `DATABASE_URL` documentation for Postgres connection strings
- `db/knex_init_db.js` creates tables using SQLite-compatible types

**Why it matters:** PostgreSQL is the standard choice for production self-hosted deployments. Many users already run Postgres and need a supported path.

**Suggested implementation:**
- Add `@prisma/adapter-pg` and configure `server/prisma.js` to branch on `DATABASE_URL` prefix
- Audit all `$queryRaw` / `$executeRaw` calls for SQLite-isms (backticks → double quotes, PRAGMA removal)
- Test and document Knex migration path on PostgreSQL
- Add `DATABASE_URL` env var documentation and Docker Compose example

---

#### 9. Public API Authentication via API Keys (Read Access)
**What's missing:** API keys exist in the database and UI but they only work via Socket.IO (`loginByToken`). There are no REST endpoints that accept API key authentication for programmatic read access.

**Why it matters:** CI/CD pipelines, dashboards, and third-party integrations need to query monitor status via HTTP with an API key — not a WebSocket handshake.

**Suggested implementation:**
- Accept `Authorization: Bearer <api-key>` header on REST endpoints
- Scope keys by permission (read-only vs full)
- Return monitor list and status as JSON

---

#### 10. Monitor Grouping / Folder Hierarchy in Dashboard
**What's missing:** The dashboard shows a flat list. Groups exist for status pages but the main dashboard has no visual grouping or folder-based organization.
- No folders/groups in the main monitor list
- Groups on status pages are separate from dashboard organization
- No collapse/expand of monitor groups on dashboard
- No per-group summary (X/Y monitors up)

**Why it matters:** Users with 50+ monitors need organizational structure beyond tags.

**Suggested implementation:**
- Group monitor type already exists in the codebase — extend its use to the main dashboard
- Render groups as collapsible sections with aggregate status
- Allow drag-and-drop ordering within groups

---

### 🟡 Medium — Valuable Additions

#### 11. Response Body Assertions / Multi-Step Checks
**What's missing:** HTTP monitors can check status codes and keywords, but cannot:
- Assert response body with JSONPath/regex and multiple conditions chained
- Follow redirects and assert the final URL
- Check response headers (e.g., `Content-Type`, `X-Frame-Options`)
- Execute multi-step flows (login → check protected page)
- Chain requests (pass a token from step 1 to step 2)

**Suggested:** Add a "conditions" system for HTTP monitors (JSONPath assertions, header checks, regex on body) — a partial foundation exists in `EditMonitorConditions.vue` but is limited.

---

#### 12. Alert Silence / Scheduled Downtime Per Monitor
**What's missing:** Maintenance windows exist globally but there is no per-monitor silence/snooze capability.
- No "snooze notifications for this monitor for 2 hours"
- No recurring maintenance per monitor (e.g., nightly backup window)
- No "expected downtime" annotation visible on the uptime chart

**Suggested:** Add a per-monitor maintenance window association, and a quick "snooze" action directly from the dashboard.

---

#### 13. Uptime SLA Reporting Widgets
**What's missing:** Uptime percentages are shown but there is no SLA target tracking.
- No configurable SLA targets per monitor (e.g., 99.9%)
- No "SLA met / SLA missed" indicator
- No cumulative SLA compliance view across all monitors
- No time-range selector beyond preset durations (24h, 7d, 30d)

**Suggested:** Add an SLA target field per monitor. Show SLA compliance on dashboard and status pages.

---

#### 14. Dark/Light Theme Per-User Preference (Persisted Server-Side)
**What's missing:** Theme preference is currently stored in localStorage only. On a new device or browser, users lose their theme preference.

**Suggested:** Store theme preference in user settings (already exists in DB) so it follows the user session.

---

#### 15. Webhook Inbound (Generic Push Monitor Enhancement)
**What's missing:** The Push monitor receives a GET/POST to `/api/push/:token` but has limited payload inspection.
- Cannot validate a custom field in the push payload
- Cannot map push payload fields to monitor status
- No support for signed/HMAC-verified push payloads

**Suggested:** Add payload validation options to the Push monitor — verify an HMAC signature or match a required JSON field.

---

#### 16. Monitor Templates / Cloning
**What's missing:** No way to create a "template" monitor that can be instantiated multiple times with minor variations (e.g., same auth headers but different URLs).
- Clone monitor button exists (partial implementation) but cloned monitors don't inherit grouped notification sets
- No template library

**Suggested:** Full monitor cloning with configurable overrides, and a "monitor template" feature for bulk creation.

---

#### 17. Alerting Based on Response Time Threshold
**What's missing:** Alerts only fire on up/down status changes. There is no alert for degraded performance.
- No "slow response" alert (e.g., alert if avg response time > 2000ms)
- No P95/P99 response time tracking
- No anomaly detection on response time

**Suggested:** Add a `responseTimeThreshold` field to monitors. Trigger a "degraded" status (distinct from down) and send alert when exceeded.

---

#### 18. Audit Log
**What's missing:** No record of who did what and when.
- No log of monitor creation/deletion
- No log of setting changes
- No log of user login/logout events
- No log of API key usage

**Suggested:** Add an `audit_log` table. Record actor, action, target entity, and timestamp for all write operations.

---

#### 19. Uptime Chart Annotations
**What's missing:** The uptime/heartbeat chart has no annotations.
- Incidents are not overlaid on the chart timeline
- Maintenance windows are not shown on the chart
- Deployments or events cannot be marked

**Suggested:** Add event markers on the heartbeat bar/chart for incidents, maintenance windows, and manual annotations.

---

#### 20. Two-Factor Authentication — Backup Codes
**What's missing:** 2FA is implemented (TOTP) but there are no backup/recovery codes.
- If a user loses their TOTP device, they must use the CLI `remove-2fa.js` script
- No in-app backup code generation or download

**Suggested:** Generate 8–10 single-use backup codes at 2FA setup time. Allow viewing/regenerating them in security settings.

---

### 🟢 Low / Future — Nice to Have

#### 21. Grafana / Prometheus Integration
- No native Prometheus metrics endpoint (e.g., `/metrics`)
- Uptime and response time data cannot be scraped by Prometheus
- No Grafana dashboard template published

#### 22. Mobile App / PWA Improvements
- App is technically installable as PWA but has no push notification support via service worker for mobile
- No native mobile app (iOS/Android)

#### 23. CLI Tool
- No `uptime-pro-cli` for scripting monitor management from the command line
- All management requires browser or raw Socket.IO connection

#### 24. Synthetic Transaction Monitoring
- Real Browser monitor exists but only supports simple single-URL checks
- No support for multi-step Playwright scripts uploaded by the user
- No screenshot diffing or visual regression checks

#### 25. Integrations: Infrastructure as Code
- No Terraform provider
- No Ansible module
- No Kubernetes operator or Helm chart with monitor CRDs

#### 26. Custom Branding Per Status Page
- Custom CSS and logo are supported
- Missing: custom fonts, custom error pages, fully white-labeled domain experience, removal of all "Uptime Pro" references per status page

#### 27. Alert Deduplication / Flap Detection
- No flap detection (monitor oscillating up/down rapidly)
- No deduplication window to suppress repeated alerts for the same failure
- Could be configured as: "only alert if down for more than N consecutive checks"

#### 28. Bulk Monitor Operations
- No bulk pause/resume all monitors
- No bulk delete
- No bulk tag assignment
- No bulk notification assignment

#### 29. IPv6 Monitoring
- Ping monitor supports IPv6 syntax stripping but no explicit IPv6-only monitoring mode
- No dual-stack (IPv4 + IPv6 parallel) check

#### 30. Response Caching Headers / CDN Check
- No monitor type specifically for cache hit/miss verification
- No check for `Cache-Control`, `CDN-Cache-Status`, `CF-Cache-Status` headers

---

## Priority Summary

| # | Feature | Priority | Effort |
|---|---------|----------|--------|
| 1 | Multi-user / RBAC | 🔴 Critical | High |
| 2 | Scheduled uptime reports | 🔴 Critical | Medium |
| 3 | Full REST API | 🔴 Critical | Medium |
| 4 | Escalation policies | 🔴 Critical | High |
| 5 | Monitor import/export | 🟠 High | Low |
| 6 | Incident lifecycle | 🟠 High | Medium |
| 7 | Status page subscriptions | 🟠 High | Medium |
| 8 | PostgreSQL support | 🟠 High | Medium |
| 9 | API key REST auth | 🟠 High | Low |
| 10 | Dashboard grouping | 🟠 High | Low |
| 11 | Multi-condition assertions | 🟡 Medium | Medium |
| 12 | Per-monitor silence/snooze | 🟡 Medium | Low |
| 13 | SLA targets and tracking | 🟡 Medium | Medium |
| 14 | Server-side theme preference | 🟡 Medium | Low |
| 15 | Signed push payloads | 🟡 Medium | Low |
| 16 | Monitor templates/cloning | 🟡 Medium | Low |
| 17 | Response time threshold alerts | 🟡 Medium | Low |
| 18 | Audit log | 🟡 Medium | Low |
| 19 | Chart annotations | 🟡 Medium | Medium |
| 20 | 2FA backup codes | 🟡 Medium | Low |
| 21–30 | Future/nice-to-have | 🟢 Low | Varies |

---

## Recommended First Sprint

Based on impact-to-effort ratio, the following features provide the highest value for the least risk:

1. **Monitor Import/Export** — low effort, eliminates a real operational risk
2. **API key REST auth + `/api/v1/monitors` read endpoint** — low effort, unlocks integrations
3. **2FA backup codes** — low effort, critical safety net
4. **Bulk monitor operations** — low effort, improves daily usability significantly
5. **Response time threshold alerting** — low effort, adds a meaningful new alert class
6. **Alert acknowledgment (snooze)** — medium effort, reduces alert fatigue immediately
