# Fastify Migration Validation Guide

Phase-by-phase validation gates, startup checks, and merge readiness criteria.

---

## Pre-Phase 1 Validation

### Dependency check

```bash
# Confirm fastify packages are installed
ls node_modules | grep fastify
# Expected: fastify  (and @fastify/ directory)
ls node_modules/@fastify/
# Expected: compress  cors  formbody  static  socket.io  (after npm install @fastify/socket.io)

# Confirm Express is gone
ls node_modules | grep -E "^express$"
# Expected: no output

ls node_modules | grep "express-static-gzip"
# Expected: no output
```

---

## Phase 1 Validation — Replace Express with Fastify

### Step 1: No Express imports remain in server code

```bash
grep -rn "require(\"express\")" server/ --include="*.js"
# Expected: no output (all 6 files cleared)

grep -rn "require(\"express-static-gzip\")" server/ --include="*.js"
# Expected: no output

grep -rn "apicache" server/ --include="*.js"
# Expected: no output (apicache directory deleted)
```

### Step 2: Startup validation

```bash
node server/server.js
```

Expected console output sequence:
```
Welcome to Uptime Pro
Your Node.js version: X.Y.Z
Uptime Pro Version: X.Y.Z
Loading modules
Creating fastify and socket.io instance        ← key line (was "express and socket.io")
Server Type: HTTP (or HTTPS)
...
Listening on port 3001
```

No errors, no `MODULE_NOT_FOUND` for `express` or `express-static-gzip`.

### Step 3: Vue SPA serving

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/
# Expected: 200 (or 302 redirect to /dashboard or /status/...)

curl -s -o /dev/null -w "%{http_code}" http://localhost:3001/dashboard
# Expected: 200

curl -s http://localhost:3001/ | grep -c "<!DOCTYPE html"
# Expected: 1
```

### Step 4: Socket.IO connection validation

```bash
# Install wscat if needed: npm install -g wscat
# Test Socket.IO polling endpoint (initial handshake)
curl -s "http://localhost:3001/socket.io/?EIO=4&transport=polling" | head -c 100
# Expected: response starting with 0{ (Socket.IO EIO4 handshake)

# Or test with socket.io-client
node -e "
const io = require('socket.io-client');
const socket = io('http://localhost:3001');
socket.on('connect', () => { console.log('CONNECTED', socket.id); process.exit(0); });
socket.on('connect_error', (e) => { console.error('ERROR', e.message); process.exit(1); });
setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 5000);
"
# Expected: CONNECTED <socket-id>
```

### Step 5: Badge route validation

```bash
# Returns SVG (monitor may not exist, but route must respond, not 500)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/badge/1/status"
# Expected: 200 (SVG with N/A if monitor not public) or 200

curl -s "http://localhost:3001/api/badge/1/status" | grep -c "svg"
# Expected: 1

# Test with invalid ID — should return SVG N/A, not 500
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/badge/notanumber/status"
# Expected: 400 (after Phase 2 schema validation) or 200 N/A badge (Phase 1 acceptable)
```

### Step 6: Push monitor validation

```bash
# With a valid push token (create a push monitor in the UI first)
PUSH_TOKEN="your-push-token"
curl -s -X POST "http://localhost:3001/api/push/${PUSH_TOKEN}?status=up&msg=OK"
# Expected: {"ok":true}

# With an invalid token
curl -s -X POST "http://localhost:3001/api/push/invalidtoken"
# Expected: {"ok":false,"msg":"Monitor not found or not active."}

# Verify HTTP status
curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3001/api/push/invalidtoken"
# Expected: 404
```

### Step 7: Upload directory

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/upload/"
# Expected: 403 or 404 (directory listing disabled) — NOT 500

curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/upload/nonexistent.png"
# Expected: 404
```

### Step 8: Robots.txt

```bash
curl -s "http://localhost:3001/robots.txt"
# Expected: "User-agent: *\nDisallow:" or "User-agent: *\nDisallow: /"
```

### Step 9: Well-known change-password redirect

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/.well-known/change-password"
# Expected: 302

curl -s -D - "http://localhost:3001/.well-known/change-password" | grep "location:"
# Expected: location: https://github.com/louislam/uptime-kuma/wiki/Reset-Password-via-CLI
```

### Step 10: Metrics endpoint

```bash
# Without auth (when disableAuth is false) — expect 401
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/metrics"
# Expected: 401

# With valid credentials
curl -s -o /dev/null -w "%{http_code}" -u "admin:password" "http://localhost:3001/metrics"
# Expected: 200

curl -s -u "admin:password" "http://localhost:3001/metrics" | grep "^# HELP"
# Expected: Prometheus metric help lines
```

### Step 11: Setup database info

```bash
curl -s "http://localhost:3001/setup-database-info"
# Expected: {"runningSetup":false,"needSetup":false}
```

### Step 12: Backend test suite

```bash
npm run test-backend
# Expected: All tests pass (zero failures)
# The test suite does NOT test HTTP routes directly, but it validates models and utilities
# that are called by the migrated routes.
```

### Step 13: Entry page API

```bash
curl -s "http://localhost:3001/api/entry-page"
# Expected: {"type":"entryPage","entryPage":"dashboard"}
# or {"type":"statusPageMatchedDomain","statusPageSlug":"..."}
```

### Phase 1 gate: ALL of steps 1–13 must pass before proceeding to Phase 2.

---

## Phase 2 Validation — Schema Validation + OpenAPI Docs

### Swagger UI

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/docs"
# Expected: 200

curl -s "http://localhost:3001/docs" | grep -c "swagger"
# Expected: >= 1 (Swagger UI HTML contains "swagger")
```

### OpenAPI JSON spec

```bash
curl -s "http://localhost:3001/docs/json" | python3 -m json.tool > /dev/null
# Expected: exit code 0 (valid JSON)

curl -s "http://localhost:3001/docs/json" | python3 -c "
import json,sys; d=json.load(sys.stdin)
print('openapi:', d.get('openapi','MISSING'))
print('routes:', len(d.get('paths',{})))
"
# Expected: openapi: 3.0.x, routes: >= 10
```

### Schema validation rejects bad input

```bash
# Invalid monitor ID (not an integer)
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/badge/notanumber/status"
# Expected: 400

curl -s "http://localhost:3001/api/badge/notanumber/status"
# Expected: {"statusCode":400,"error":"Bad Request","message":"..."}

# Invalid push token format (empty)
curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:3001/api/push/"
# Expected: 404 (no route) or 400 (schema)
```

### Phase 2 gate: Swagger UI accessible, all routes in OpenAPI spec, bad input returns 400.

---

## Phase 3 Validation — Authenticated REST API

### 401 without API key

```bash
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/api/v1/monitors"
# Expected: 401

curl -s "http://localhost:3001/api/v1/monitors"
# Expected: {"ok":false,"msg":"Unauthorized"}
```

### 401 with invalid / expired API key

```bash
curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer uk999_invalidkey" \
    "http://localhost:3001/api/v1/monitors"
# Expected: 401
```

### 200 with valid API key

```bash
# First create an API key via the UI (Settings → API Keys) or via Socket.IO addAPIKey event
API_KEY="uk<id>_<key>"

curl -s -o /dev/null -w "%{http_code}" \
    -H "Authorization: Bearer ${API_KEY}" \
    "http://localhost:3001/api/v1/monitors"
# Expected: 200

curl -s -H "Authorization: Bearer ${API_KEY}" "http://localhost:3001/api/v1/monitors" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok:', d['ok'], 'monitors:', len(d.get('monitors',[])))"
# Expected: ok: True monitors: <count>
```

### REST API does not break Socket.IO

```bash
# After creating a monitor via REST API, it should appear in Socket.IO monitorList
node -e "
const io = require('socket.io-client');
const socket = io('http://localhost:3001');
socket.on('monitorList', (list) => {
    console.log('Monitor count:', Object.keys(list).length);
    process.exit(0);
});
socket.emit('loginByToken', 'your-jwt-token', (res) => {
    if (!res.ok) { console.error('Login failed'); process.exit(1); }
});
setTimeout(() => { console.error('TIMEOUT'); process.exit(1); }, 5000);
"
# Expected: Monitor count: N (where N matches what REST API returns)
```

### OpenAPI spec includes v1 routes

```bash
curl -s "http://localhost:3001/docs/json" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); v1=[p for p in d['paths'] if '/api/v1/' in p]; print('v1 routes:', len(v1))"
# Expected: v1 routes: >= 20
```

### Phase 3 gate: 401 without key, 200 with valid key, Socket.IO unaffected.

---

## Phase 4 Validation — Hardening

### Rate limiting

```bash
# Exceed 60 requests/min on /api/v1/ routes
API_KEY="uk<id>_<key>"
for i in $(seq 1 65); do
    STATUS=$(curl -s -o /dev/null -w "%{http_code}" \
        -H "Authorization: Bearer ${API_KEY}" \
        "http://localhost:3001/api/v1/monitors")
    echo "Request $i: $STATUS"
done
# Expected: requests 1-60 return 200, request 61+ return 429

# Verify 429 response body
curl -s -H "Authorization: Bearer ${API_KEY}" "http://localhost:3001/api/v1/monitors" \
    # (after exceeding limit)
# Expected: {"statusCode":429,"error":"Too Many Requests","message":"Rate limit exceeded, retry in X seconds"}
```

### Security headers

```bash
curl -s -D - "http://localhost:3001/" -o /dev/null | grep -i "x-content-type-options"
# Expected: x-content-type-options: nosniff

curl -s -D - "http://localhost:3001/" -o /dev/null | grep -i "x-frame-options"
# Expected: x-frame-options: SAMEORIGIN (or DENY depending on helmet config)

curl -s -D - "http://localhost:3001/" -o /dev/null | grep -i "x-powered-by"
# Expected: no output (header removed)
```

### No Express in node_modules

```bash
ls node_modules | grep -E "^express$"
# Expected: no output

ls node_modules | grep "express-static-gzip"
# Expected: no output

# express-basic-auth should also be gone after Phase 3 auth rewrite
ls node_modules | grep "express-basic-auth"
# Expected: no output
```

### No apicache references in source

```bash
grep -rn "apicache" server/ --include="*.js"
# Expected: no output

ls server/modules/ 2>/dev/null
# Expected: apicache directory should NOT appear (or server/modules/ may not exist)
```

### Phase 4 gate: Rate limits active, security headers present, no Express in node_modules.

---

## Docker Validation

### Build

```bash
docker build -t uptime-pro-test .
# Expected: Build SUCCESS, no errors
```

### Container starts

```bash
docker run -d --name uptime-pro-test -p 3001:3001 uptime-pro-test
sleep 10  # allow startup

docker logs uptime-pro-test 2>&1 | grep -E "Listening|Error"
# Expected: "Listening on port 3001" — no Error lines

curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/"
# Expected: 200 or 302

docker stop uptime-pro-test && docker rm uptime-pro-test
```

### Docker health check

```bash
docker run -d --name uptime-pro-test -p 3001:3001 uptime-pro-test
sleep 15
docker inspect uptime-pro-test --format "{{.State.Health.Status}}"
# Expected: healthy
docker stop uptime-pro-test && docker rm uptime-pro-test
```

---

## Graceful Shutdown Validation

```bash
# Start server in background
node server/server.js &
SERVER_PID=$!
sleep 5

# Send SIGTERM
kill -TERM $SERVER_PID

# Wait up to 35 seconds for clean exit
TIMEOUT=35
while kill -0 $SERVER_PID 2>/dev/null && [ $TIMEOUT -gt 0 ]; do
    sleep 1
    TIMEOUT=$((TIMEOUT - 1))
done

if kill -0 $SERVER_PID 2>/dev/null; then
    echo "FAIL: Server did not exit within timeout"
    kill -9 $SERVER_PID
else
    echo "PASS: Server exited cleanly"
fi
```

Expected log output during shutdown:
```
Shutdown requested
Called signal: SIGTERM
Stopping all monitors
Graceful shutdown successful!
```

---

## Status Page Validation

```bash
# Assumes a status page with slug "default" exists
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/status/default"
# Expected: 200

curl -s "http://localhost:3001/status/default" | grep -c "<!DOCTYPE html"
# Expected: 1

# Status page API
curl -s "http://localhost:3001/api/status-page/default" \
    | python3 -c "import json,sys; d=json.load(sys.stdin); print('title:', d.get('config',{}).get('title','N/A'))"
# Expected: title: <your status page title>

# RSS feed
curl -s -o /dev/null -w "%{http_code}" "http://localhost:3001/status/default/rss"
# Expected: 200

curl -s "http://localhost:3001/status/default/rss" | grep -c "<rss"
# Expected: 1
```

---

## Merge Readiness Criteria

All of the following must be true before the `fastify-migration` branch is merged to `master`:

### Functional

- [ ] `npm run test-backend` passes with zero failures
- [ ] `npm run lint` passes with zero errors and zero warnings (`npm run lint:prod`)
- [ ] Docker build succeeds
- [ ] Docker container starts and health check reports `healthy`
- [ ] Vue SPA loads and authenticates via Socket.IO in a browser
- [ ] All 86+ socket events verified via UI smoke test (login, add monitor, get heartbeats, 2FA)
- [ ] Push monitor end-to-end: `POST /api/push/<token>` creates heartbeat, visible in UI
- [ ] Badge routes return correct SVGs for UP/DOWN/PENDING states
- [ ] Status pages render HTML, RSS, and JSON API correctly
- [ ] Prometheus `/metrics` returns valid Prometheus exposition format with Basic Auth
- [ ] Graceful shutdown completes within 30 seconds on SIGTERM

### Phase 2+

- [ ] `GET /docs` returns Swagger UI
- [ ] `GET /docs/json` returns valid OpenAPI 3.0 JSON with all routes documented
- [ ] Invalid badge ID returns HTTP 400 (schema validation active)

### Phase 3+

- [ ] `GET /api/v1/monitors` returns 401 without key, 200 with valid key
- [ ] API key management via Socket.IO still works (create, delete, list)

### Phase 4+

- [ ] Rate limiting returns 429 after threshold on `/api/v1/` routes
- [ ] Security headers present: `X-Content-Type-Options`, `X-Frame-Options`
- [ ] `express`, `express-static-gzip`, `express-basic-auth` absent from `node_modules`
- [ ] No `require("express")` in any `server/` file (verify with grep)
- [ ] `server/modules/apicache/` directory deleted

### Performance (optional but recommended)

- [ ] Static asset response time for `dist/index.html` ≤ previous baseline (measure with `ab` or `wrk`)
- [ ] Memory usage after 10 minutes idle ≤ previous baseline

### Documentation

- [ ] `README.md` updated to mention Fastify as the HTTP framework
- [ ] `fastify-migration.md` and planning documents archived or removed from repo root
