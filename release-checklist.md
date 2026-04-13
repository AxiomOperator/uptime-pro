# Release Checklist: Uptime Pro Fork

Items are ordered by the risk they pose to a successful, correctly attributed release. Complete **Critical** items before triggering any automated workflow. Complete **High** items before publishing the first public release.

---

## Critical

These items must be resolved before any automated release workflow is triggered. Skipping them risks pushing Docker images to the wrong registry or breaking the setup pipeline for all users.

- [ ] **Fix `extra/release/lib.mjs` line 36** — change the fallback default in `getRepoNames()` from `louislam/uptime-kuma` to `axiomoperator/uptime-pro` and `ghcr.io/axiomoperator/uptime-pro`.
  > **Current:** `return ["louislam/uptime-kuma", "ghcr.io/louislam/uptime-kuma"];`
  > **Needed:** `return ["axiomoperator/uptime-pro", "ghcr.io/axiomoperator/uptime-pro"];`
  > **Why:** Without this, any invocation of the release scripts outside the GitHub Actions environment (e.g., a local developer running `npm run release-final` without the env var set) will push Docker images to the upstream `louislam/uptime-kuma` namespace.
  > **Status:** ✅ Already fixed — `lib.mjs` line 36 now correctly returns the fork namespaces.

- [ ] **Verify `RELEASE_REPO_NAMES` env var in `release-final.yml` and `release-beta.yml`** — confirm both workflow files include `RELEASE_REPO_NAMES: "axiomoperator/uptime-pro,ghcr.io/axiomoperator/uptime-pro"` in the "Run release-final"/"Run release-beta" step's `env:` block.
  > **Why:** Acts as a redundant safety net for `getRepoNames()`. If the default in `lib.mjs` were accidentally reverted, this env var ensures the workflows always target the fork.
  > **Status:** ✅ Already set — `release-final.yml` line 86, `release-beta.yml` line 86 both have the correct value.

- [ ] **Fix `package.json` line 7** — update `repository.url` to point to the fork.
  > **Current:** `"url": "https://github.com/louislam/uptime-kuma.git"`
  > **Needed:** `"url": "https://github.com/AxiomOperator/uptime-pro.git"`
  > **Why:** Used by `npm publish`, GitHub dependency graph, and tooling that reads npm metadata to link back to source.
  > **Status:** ✅ Already fixed — `package.json` line 7 already reads `https://github.com/AxiomOperator/uptime-pro.git`.

- [ ] **Provision GitHub Actions secrets on `AxiomOperator/uptime-pro`** — before triggering `release-final.yml` or `release-beta.yml`, set the following repository secrets:
  - `DOCKERHUB_USERNAME` — Docker Hub username for the `axiomoperator` namespace
  - `DOCKERHUB_TOKEN` — Docker Hub access token with push permission to `axiomoperator/uptime-pro`
  - `GHCR_USERNAME` — GitHub username (or `AxiomOperator`)
  - `GHCR_TOKEN` — GitHub PAT with `write:packages` scope
  > **Why:** Both workflows (`release-final.yml` lines 69–70, 76–77; `release-beta.yml` same positions) authenticate to both registries before building. Without valid credentials the workflow fails at the Docker login step and no release is created. The `axiomoperator/uptime-pro` Docker Hub repository must exist prior to the first push.

- [ ] **Create `axiomoperator/uptime-pro` Docker Hub repository** — log into Docker Hub as `axiomoperator` and create the public repository `uptime-pro` before the first automated release. GHCR creates the package namespace automatically on first push given a valid `write:packages` token.

---

## High

These items should be resolved before the first public release is announced. They affect user-facing attribution, setup reliability, and the correctness of published release artifacts.

- [ ] **Fix `docker/dockerfile` line 32** — update the OCI source label to point to the fork.
  > **Current:** `LABEL org.opencontainers.image.source="https://github.com/louislam/uptime-kuma"`
  > **Needed:** `LABEL org.opencontainers.image.source="https://github.com/AxiomOperator/uptime-pro"`
  > **Why:** This label is embedded in every published Docker image and is used by GHCR and Docker Hub to link the image to its source repository.
  > **Status:** ✅ Already fixed — `docker/dockerfile` line 32 already points to `https://github.com/AxiomOperator/uptime-pro`.

- [ ] **Fix `extra/download-dist.js` line 11** — update the dist download URL from the upstream releases to the fork's releases.
  > **Current:** `` const url = `https://github.com/louislam/uptime-kuma/releases/download/${version}/${filename}`; ``
  > **Needed:** `` const url = `https://github.com/AxiomOperator/uptime-pro/releases/download/${version}/${filename}`; ``
  > **Why:** `npm run setup` (used in Docker builds and by users installing from source) calls this script to download the pre-built frontend dist tarball. Once the fork's releases diverge from upstream versioning, this URL will fetch from the wrong repository — silently downloading stale or non-existent artifacts. This must be fixed before the first release artifact is published.

- [ ] **Fix `extra/uptime-kuma-push/package.json` line 3** — update the `build-docker` script's push target from upstream to the fork.
  > **Current:** `"build-docker": "npm run build-all && docker buildx build ... -t louislam/uptime-kuma:push ... --target release"`
  > **Needed:** Replace `louislam/uptime-kuma:push` with `axiomoperator/uptime-pro:push` (or the fork's equivalent tag convention)
  > **Why:** A developer running this script from `extra/uptime-kuma-push/` would push the Prometheus push gateway client image to the upstream namespace. Low-frequency operation but creates an incorrect release artifact in the wrong registry.

- [ ] **Decide on Docker Hub namespace convention before first automated release** — confirm that `axiomoperator` is the intended Docker Hub organization/username, that the `uptime-pro` repository is created there (see Critical item above), and that the tag scheme (`v1.0.0`, `latest`, `1`, `1.0`, `1.0.0`) matches what `extra/release/lib.mjs` produces (search `buildTags()` in `lib.mjs` around line 70).

- [ ] **Create the first GitHub Release manually** — do not rely on the automated workflow for the first release. Create the release via the GitHub UI to validate tagging, changelog generation, and artifact attachment without risking a misconfigured Docker push. Steps:
  1. Determine version strategy (see Recommended Release Strategy in `release-review.md`)
  2. Run `npm run build` locally to produce `dist/`
  3. Package dist: `tar -czf dist.tar.gz dist/`
  4. Create and push tag: `git tag v1.0.0 && git push origin v1.0.0`
  5. Create GitHub Release via UI, attach `dist.tar.gz` as a release asset
  6. Verify `extra/download-dist.js` can successfully download the attached artifact

---

## Medium

These items affect the community experience and operational correctness of GitHub-hosted workflows. They do not block the first release but should be addressed before the repository is actively promoted.

- [ ] **Fix `.github/ISSUE_TEMPLATE/ask_for_help.yml` lines 19, 22, 31, 34** — replace all `github.com/louislam/uptime-kuma/issues` and `github.com/louislam/uptime-kuma/security/policy` URLs with the fork equivalents (`github.com/AxiomOperator/uptime-pro/issues`, `github.com/AxiomOperator/uptime-pro/security/policy`). Repeat for `bug_report.yml` (lines 20–21, 31, 34) and `feature_request.yml` (lines 22–23).
  > **Why:** Every issue filed from this fork currently directs users to the upstream issue tracker. This pollutes upstream with fork issues and denies the fork maintainers visibility.

- [ ] **Fix `extra/close-incorrect-issue.js` lines 12 and 40** — change `owner: "louislam"` to `owner: "AxiomOperator"` and `repo: "uptime-kuma"` to `repo: "uptime-pro"`.
  > **Why:** The `close-incorrect-issue.yml` workflow invokes this script when issues are filed. As-is, it attempts GitHub API calls against the upstream repository. With a fork-scoped `GITHUB_TOKEN`, calls will fail (403); if ever run with a broader token, it would affect upstream issues.

- [ ] **Fix `.github/workflows/codeql-analysis.yml` lines 14 and 48** — change `github.repository == 'louislam/uptime-kuma'` guards to `github.repository == 'AxiomOperator/uptime-pro'` so scheduled CodeQL scans run on the fork.
  > **Why:** Scheduled security scans are currently suppressed on this fork. Only push/PR-triggered scans run; the periodic full scan is silently skipped.

- [ ] **Update `.github/FUNDING.yml`** — replace `github: louislam` with `github: AxiomOperator` and `open_collective: uptime-kuma` with the fork's Open Collective slug (or remove the `open_collective` line if no collective exists).
  > **Why:** The "Sponsor" button on the fork's GitHub page currently routes all donations to the upstream author.

- [ ] **Fix `extra/release/lib.mjs` lines 317–318** — `getWorkflowUrl()` fallback URL points to upstream:
  > **Current:** `` `https://github.com/louislam/uptime-kuma/actions/workflows/beta-release.yml` ``
  > **Needed:** `` `https://github.com/AxiomOperator/uptime-pro/actions/workflows/release-beta.yml` ``
  > **Why:** This URL is embedded in GitHub Release descriptions when the `GITHUB_RUN_ID` env var is not available. Users clicking the link are sent to the upstream repository's workflow page.

- [ ] **Re-enable or update disabled workflow guards** — the following workflows are permanently disabled on the fork due to `louislam/uptime-kuma` repo guards. Decide whether to enable them for the fork and update guards if so:
  - `.github/workflows/conflict-labeler.yml` line 21 → change guard to `AxiomOperator/uptime-pro`
  - `.github/workflows/new-contributor-pr.yml` line 18 → change guard; also update in-message links (lines 29, 40)
  - `.github/workflows/npm-update.yml` line 15 → change guard if automated dependency PRs are wanted
  - `.github/workflows/stale-bot.yml` line 12 → change guard and line 28 (`exempt-issue-assignees: "louislam"` → `"AxiomOperator"`) if stale issue management is wanted
  - `.github/workflows/release-nightly.yml` line 14 → change guard if nightly builds are wanted
  - `.github/workflows/build-docker-push.yml` line 14 → change guard if scheduled Docker pushes are wanted

---

## Low

These items are cosmetic, affect only local development workflows, or reference deprecated code. They do not block releases.

- [ ] **Fix `docker/docker-compose-dev.yml` line 6** — update the dev image reference from `louislam/uptime-kuma:nightly2` to the fork's dev image (e.g., `axiomoperator/uptime-pro:nightly` once nightly builds are operational, or remove if not yet available).
  > **Why:** Local developers spinning up the dev environment via `docker-compose` pull the upstream nightly image instead of the fork's.

- [ ] **Clean up deprecated `uploadArtifacts()` in `extra/release/lib.mjs` lines 192–226** — the function is marked `@deprecated` and is not called by any active script, but still contains `louislam/uptime-kuma:upload-artifact` (lines 196, 211). Either remove the function or update the references.
  > **Why:** Prevents accidental reintroduction and reduces future maintainer confusion.

- [ ] **Update stale inline comment `extra/release/lib.mjs` line 103** — the comment `// louislam/uptime-kuma` inside `checkTagExists()` is a leftover annotation from before the fork. Replace with `// axiomoperator/uptime-pro` or remove.

- [ ] **Audit `package.json` dev scripts (lines 40–44, 65)** — scripts `build-docker-base`, `build-docker-base-slim`, `build-docker-builder-go`, `build-docker-nightly-local`, `build-docker-pr-test`, and `quick-run-nightly` all reference `louislam/uptime-kuma` image names. These are upstream base image maintenance scripts, not fork release targets. Consider renaming or adding a comment clarifying that these scripts are for upstream base image maintenance and are **not** intended for fork release use.

---

## Future Enhancements

These items go beyond rebranding cleanup and represent longer-term improvements to the fork's release maturity.

- [ ] **Implement nightly builds for the fork** — update `.github/workflows/release-nightly.yml` line 14 repo guard to `AxiomOperator/uptime-pro` and ensure `extra/release/nightly.mjs` uses the correct repo names. Nightly builds provide a continuous integration signal and a dev image for `docker-compose-dev.yml`.

- [ ] **Create `axiomoperator/uptime-pro` base images** — `docker/dockerfile` consumes `louislam/uptime-kuma:base2`, `louislam/uptime-kuma:base2-slim`, and `louislam/uptime-kuma:builder-go` as build-stage FROM images. Currently these are consumed directly from upstream, which is fine. Long-term, maintaining fork-owned base images (`axiomoperator/uptime-pro:base2`, etc.) avoids upstream build breaking changes affecting the fork.

- [ ] **Configure Dependabot or `npm-update.yml`** — once the `npm-update.yml` guard is updated (see Medium), configure automated dependency PR creation with appropriate reviewer assignment.

- [ ] **Set up branch protection on `master`** — require PR reviews, passing status checks (`auto-test.yml`, `validate.yml`), and signed commits before merge to protect release integrity.

- [ ] **Establish a changelog/release notes process** — `extra/release/lib.mjs` generates changelogs from commit messages between version tags. Define and document the commit message convention (conventional commits recommended) so changelog generation is meaningful from the first automated release.

- [ ] **Add a fork-specific `SECURITY.md`** — the current `SECURITY.md` was inherited from upstream. Update contact information and vulnerability reporting channels to reflect the fork maintainers.

- [ ] **Publish `uptime-pro` to npm** (optional) — once `package.json` is correctly attributed and versioned, consider publishing to npm under the `uptime-pro` package name for users who install via `npx`.
