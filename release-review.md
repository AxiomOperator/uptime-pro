# Release Review: Uptime Pro Fork

## Executive Summary

Uptime Pro (`AxiomOperator/uptime-pro`) is a fork of Uptime Kuma 2.2.1. The repository is in a **partially rebranded** state: several critical release-path identifiers have already been updated to point at the fork, but a number of meaningful upstream references remain — most notably `extra/download-dist.js`, which hardcodes the upstream release URL and will cause `npm run setup` to break entirely once the fork diverges from upstream versioning. The automated release workflows (`release-final.yml`, `release-beta.yml`) are functional and already configured with the correct Docker registry target, but no tags or GitHub Releases exist yet. The nightly and base-image build workflows are permanently disabled on this fork by hard repo guards. No secrets have been provisioned. The safest first release is a manually created GitHub Release without Docker automation.

---

## Current Release State

| Property | Value |
|---|---|
| Package name | `uptime-pro` (`package.json` line 2) |
| Package version | `2.2.1` (inherited from upstream Uptime Kuma 2.2.1) |
| Repository URL in `package.json` | `https://github.com/AxiomOperator/uptime-pro.git` (line 7) ✅ |
| Remote | `https://github.com/AxiomOperator/uptime-pro.git` |
| Branch | `master` only |
| Git tags | None |
| GitHub Releases | None |
| Docker Hub namespace | Not yet provisioned |
| Actions secrets | Not yet provisioned |

---

## Release Infrastructure Inventory

### Automated Release Workflows

| File | Trigger | Repo Guard | Status |
|---|---|---|---|
| `.github/workflows/release-final.yml` | `workflow_dispatch` | **None** | Functional; will run on this fork |
| `.github/workflows/release-beta.yml` | `workflow_dispatch` | **None** | Functional; will run on this fork |
| `.github/workflows/release-nightly.yml` | `schedule` + `workflow_dispatch` | `louislam/uptime-kuma` (line 14) | **Will never run** on this fork |
| `.github/workflows/build-docker-push.yml` | `schedule` | `louislam/uptime-kuma` (line 14) | **Will never run** on this fork |

### Release Scripts

| File | Purpose |
|---|---|
| `extra/release/final.mjs` | Orchestrates final release: bumps version, builds Docker, pushes, creates GitHub Release |
| `extra/release/beta.mjs` | Same pipeline for beta tags |
| `extra/release/nightly.mjs` | Nightly build (blocked by repo guard in workflow) |
| `extra/release/lib.mjs` | Shared release utilities: `getRepoNames()`, `buildImage()`, `uploadArtifacts()` |
| `extra/update-version.mjs` | Updates `package.json` version field and setup script checkout tag |
| `extra/download-dist.js` | Downloads pre-built `dist.tar.gz` from a GitHub release — used by `npm run setup` |

### Docker Configuration

| File | Purpose |
|---|---|
| `docker/dockerfile` | Multi-target Dockerfile: `release`, `rootless`, `nightly`, `nightly-rootless`, `pr-test2`, `upload-artifact` |
| `docker/debian-base.dockerfile` | Builds upstream base images (`base2`, `base2-slim`) — not fork release targets |
| `docker/builder-go.dockerfile` | Builds upstream Go builder image — not a fork release target |
| `docker/docker-compose-dev.yml` | Development compose using `louislam/uptime-kuma:nightly2` (line 6) |

---

## Upstream References Discovered

### Critical Release Blockers

1. **`extra/download-dist.js` line 11** — hardcodes the upstream download URL:
   ```js
   const url = `https://github.com/louislam/uptime-kuma/releases/download/${version}/${filename}`;
   ```
   This is called by `npm run setup` to download the pre-built frontend dist. Once `v2.2.1` diverges from upstream versioning or the fork's first release uses a different tag format, `npm run setup` will fetch an incompatible or nonexistent artifact. This is the most operationally dangerous unfixed reference.

2. **`extra/uptime-kuma-push/package.json` line 3** — `build-docker` script pushes to upstream Docker Hub:
   ```json
   "build-docker": "npm run build-all && docker buildx build ... -t louislam/uptime-kuma:push ... --target release"
   ```
   If a developer runs `npm run build-docker` from `extra/uptime-kuma-push/`, the resulting image is pushed to the upstream `louislam/uptime-kuma:push` repository (or fails with auth error using fork credentials).

3. **No Git tags or GitHub Releases exist.** `extra/release/final.mjs` and `extra/release/beta.mjs` assume a prior version tag exists in the changelog logic. Running an automated release from a cold start (no prior tags) may produce empty or incorrect changelogs.

4. **No Actions secrets provisioned.** `release-final.yml` and `release-beta.yml` both require `DOCKERHUB_USERNAME`, `DOCKERHUB_TOKEN`, `GHCR_USERNAME`, and `GHCR_TOKEN` to be set on `AxiomOperator/uptime-pro`. Without them, any triggered workflow fails at the Docker login step.

### High Risk Issues

5. **`extra/release/lib.mjs` line 211** — deprecated `uploadArtifacts()` function (marked `@deprecated`) still hardcodes `louislam/uptime-kuma:upload-artifact` as the Docker tag in both the JSDoc comment (line 196) and the `args` array (line 211). Although it is not called by any active release script, it could be inadvertently reintroduced.

6. **`extra/release/lib.mjs` lines 317–318** — `getWorkflowUrl()` fallback URL hardcodes `https://github.com/louislam/uptime-kuma/actions/workflows/beta-release.yml`. This URL appears in GitHub Release descriptions and would point users to the upstream repository's workflow page instead of the fork's.

7. **`extra/release/lib.mjs` line 103 comment** — inline comment `// louislam/uptime-kuma` inside `checkTagExists()` is a stale annotation that could mislead future maintainers about what repository is actually being checked.

8. **`package.json` lines 40–44, 65** — dev-only npm scripts (`build-docker-base`, `build-docker-base-slim`, `build-docker-builder-go`, `build-docker-nightly-local`, `build-docker-pr-test`, `quick-run-nightly`) all reference `louislam/uptime-kuma` image names. These are upstream infrastructure scripts for building/testing base images that the fork consumes. They are not release targets, but running them accidentally would push to or pull from upstream namespaces.

### Medium Risk Issues

9. **`.github/FUNDING.yml`** — `github: louislam` and `open_collective: uptime-kuma`. Any sponsorship clicks from the fork's GitHub UI route to the original author's accounts.

10. **`.github/ISSUE_TEMPLATE/ask_for_help.yml`** (lines 19, 22, 31, 34), **`bug_report.yml`** (lines 20–21, 31, 34), **`feature_request.yml`** (lines 22–23) — all issue templates contain links pointing to `github.com/louislam/uptime-kuma/issues` and `security/policy`. Users filing issues from this fork will be directed to the upstream tracker.

11. **`extra/close-incorrect-issue.js` lines 12, 40** — hardcodes `owner: "louislam"` and `repo: "uptime-kuma"`. The `.github/workflows/close-incorrect-issue.yml` workflow triggers this script; if it runs on `AxiomOperator/uptime-pro`, it will attempt API calls against the upstream repository (will fail or affect upstream if the token somehow has permission).

12. **`.github/workflows/codeql-analysis.yml` lines 14, 48** — contains `if: github.event_name != 'schedule' || github.repository == 'louislam/uptime-kuma'`. Scheduled CodeQL scans are suppressed on this fork; manual/push triggers still run correctly.

13. **`.github/workflows/conflict-labeler.yml` line 21**, **`new-contributor-pr.yml` line 18**, **`npm-update.yml` line 15**, **`stale-bot.yml` line 12** — all have `louislam/uptime-kuma` repo guards. These workflow features (conflict labeling, welcome messages, npm updates, stale issue management) are fully disabled on the fork. The `new-contributor-pr.yml` welcome message also contains upstream-branded links (lines 29, 40).

### Low Risk Issues

14. **`docker/docker-compose-dev.yml` line 6** — references `louislam/uptime-kuma:nightly2` as the development image. Local developers running `docker-compose up` in the dev environment would pull the upstream nightly, not the fork's.

15. **`extra/release/final.mjs` line 64** and **`extra/release/beta.mjs` lines 64, 71** — `BASE_IMAGE=louislam/uptime-kuma:base2-slim` is passed as a build argument to Docker. This is intentional and correct: `louislam/uptime-kuma:base2-slim` is a legitimate upstream shared base image that the fork's production Docker builds consume. It is **not** a release push target. No change needed unless the fork wants to maintain its own base images.

16. **`extra/uptime-kuma-push/`** — the Prometheus push gateway client binary. Its `package.json` `build-docker` script (item 2 above) is the only problematic reference; the Go source code itself contains no hard-coded upstream references.

---

## Docker Publishing Assessment

### Current State

`extra/release/lib.mjs` `getRepoNames()` (line 31–37) now correctly defaults to:
```js
return ["axiomoperator/uptime-pro", "ghcr.io/axiomoperator/uptime-pro"];
```

Both `release-final.yml` (line 86) and `release-beta.yml` (line 86) already set the override env var as a redundant safety net:
```yaml
RELEASE_REPO_NAMES: "axiomoperator/uptime-pro,ghcr.io/axiomoperator/uptime-pro"
```

The Docker build flow in `extra/release/final.mjs` and `extra/release/beta.mjs`:
1. Calls `getRepoNames()` → returns `["axiomoperator/uptime-pro", "ghcr.io/axiomoperator/uptime-pro"]`
2. Builds multi-arch images with `--platform linux/amd64,linux/arm64,linux/arm/v7`
3. Pushes to Docker Hub as `axiomoperator/uptime-pro:<version>` and `axiomoperator/uptime-pro:latest`
4. Pushes to GHCR as `ghcr.io/axiomoperator/uptime-pro:<version>`

`docker/dockerfile` OCI label (line 32):
```dockerfile
LABEL org.opencontainers.image.source="https://github.com/AxiomOperator/uptime-pro"
```
This is correctly set.

### Remaining Gap

The `axiomoperator/uptime-pro` Docker Hub repository must exist and the `DOCKERHUB_USERNAME` / `DOCKERHUB_TOKEN` secrets must be provisioned before any automated release is triggered. GHCR access uses `GHCR_USERNAME` / `GHCR_TOKEN`; the GHCR package namespace is automatically created on first push if the token has `write:packages` scope.

---

## Recommended Release Strategy

### Option A — Independent Versioning (Recommended)

Tag the first release as `v1.0.0`. This cleanly separates the fork's release history from upstream and signals to users that Uptime Pro has its own release cadence.

- Update `package.json` `version` to `1.0.0` using `extra/update-version.mjs`
- Create a `v1.0.0` tag manually
- Create the GitHub Release manually (no Docker push on first release)
- For subsequent releases, use the automated `release-final.yml` workflow

### Option B — Inherit Upstream Version Baseline

Tag as `v2.2.1-uptimepro.1`. This preserves feature parity signaling with upstream but requires careful semver management as upstream advances.

- Simpler initial migration, more complex long-term maintenance
- The `v2.2.1` tag must be created before automated changelogs can compare against a previous version

### Option C — Mirror Upstream Versioning

Continue tagging as `v2.2.x` in sync with upstream. Highest maintenance burden; only recommended if the fork intends to stay in lockstep with upstream indefinitely.

---

## Recommended First Release

**Approach:** Manual GitHub Release, no Docker automation.

1. Resolve the `extra/download-dist.js` URL (either publish a `dist.tar.gz` artifact or redirect to upstream URL for initial release)
2. Run `npm run build` locally to produce `dist/`
3. Create and push a `v1.0.0` tag: `git tag v1.0.0 && git push origin v1.0.0`
4. Create a GitHub Release via the GitHub UI, attaching the built dist tarball
5. Validate `npm run setup` succeeds against the newly published release artifact
6. Provision Docker secrets and test `release-final.yml` in dry-run mode (`dry_run: true` input) before enabling live Docker pushes

---

## Risk Assessment

| Risk | Severity | Likelihood | Impact |
|---|---|---|---|
| `download-dist.js` fetches from wrong URL after version divergence | High | Certain (on version change) | `npm run setup` broken for all users |
| Docker push to wrong registry if `RELEASE_REPO_NAMES` env var is absent | High | Low (already set in workflows) | Images pushed to upstream namespace |
| Automated release triggered before secrets provisioned | Medium | Possible | Workflow fails at Docker login; no data loss |
| `uploadArtifacts()` (deprecated) reintroduced with upstream target | Low | Unlikely | Images pushed to wrong Docker tag |
| `getWorkflowUrl()` links users to upstream workflow in release notes | Low | Certain (if automated release runs) | User confusion only |
| Issue templates routing users to upstream issue tracker | Medium | Certain (on any issue submission) | Support confusion, upstream noise |
| FUNDING.yml directing sponsors to upstream author | Low | Certain | Missed sponsorships |
| `close-incorrect-issue.js` making API calls against upstream repo | Medium | Certain (if workflow triggers) | Failed API calls or unintended upstream effects |
