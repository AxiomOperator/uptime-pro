# Release Process: Uptime Pro

## Overview

Uptime Pro is a fork of Uptime Kuma 2.2.1, maintained by AxiomOperator at
`https://github.com/AxiomOperator/uptime-pro`. This runbook covers everything
needed to cut a release, from first-time manual releases through fully
automated GitHub Actions workflows.

**Before automating any release, read "Pre-release Code Fixes Required" below.**
Several upstream references remain in the codebase that will push Docker images
to the wrong registries and trigger nightly builds on the wrong repository.
Skipping those fixes will silently pollute upstream Docker Hub namespaces.

---

## Versioning Strategy

- **Scheme**: [Semantic Versioning](https://semver.org/) — `MAJOR.MINOR.PATCH`
- **Pre-releases**: `-beta.N` suffix (e.g., `1.0.0-beta.1`)
- **Git tags**: always prefixed with `v` (e.g., `v1.0.0`, `v1.0.0-beta.1`)
- **Docker tags**: no `v` prefix (e.g., `1.0.0`, `1.0.0-beta.1`)
- **Fork versioning**: the fork starts at `v1.0.0`, independent of the upstream
  2.2.1 version number. Do **not** continue upstream numbering.
- **Release branches**: named `release-{VERSION}` (e.g., `release-1.0.0`).
  The release scripts enforce this naming — you must be on the correct branch.

---

## Prerequisites

### Tools Required

| Tool | Minimum version | Check |
|------|-----------------|-------|
| Node.js | >= 20.4.0 | `node --version` |
| npm | >= 9.3 | `npm --version` |
| Git | any recent | `git --version` |
| Docker | with buildx | `docker buildx version` |
| GitHub CLI (`gh`) | >= 2.x | `gh --version` |

For automated releases you also need a GitHub account with write access to
`AxiomOperator/uptime-pro` and the required secrets configured (see below).

Install `gh` and authenticate before running any release script:

```bash
gh auth login
gh auth status          # must show AxiomOperator/uptime-pro or the org
```

### GitHub Secrets Required

Navigate to **Settings → Secrets and variables → Actions** in the repo and
ensure the following secrets exist:

| Secret | Description |
|--------|-------------|
| `DOCKERHUB_USERNAME` | Docker Hub account username (e.g., `axiomoperator`) |
| `DOCKERHUB_TOKEN` | Docker Hub access token (not your login password) |
| `GHCR_USERNAME` | GitHub username with package write access |
| `GHCR_TOKEN` | GitHub PAT with `write:packages` scope |

`GITHUB_TOKEN` is automatically provided by GitHub Actions — no manual secret
needed for that one.

To create a Docker Hub access token: Docker Hub → Account Settings →
Security → New Access Token (read/write/delete permissions).

To create a GHCR token: GitHub → Settings → Developer settings →
Personal access tokens → Fine-grained or classic with `write:packages`.

### Pre-release Code Fixes Required

> ⚠️ **These issues MUST be resolved before the automated release workflows
> are safe to run.** Without them, Docker images will be pushed to upstream
> `louislam/` registries instead of `axiomoperator/`.**

#### Fix 1 — Default Docker registry names in `extra/release/lib.mjs`

File: `extra/release/lib.mjs`, function `getRepoNames()`.

Current (broken) defaults:
```js
return ["louislam/uptime-kuma", "ghcr.io/louislam/uptime-kuma"];
```

Change to:
```js
return ["axiomoperator/uptime-pro", "ghcr.io/axiomoperator/uptime-pro"];
```

Until this is fixed, you **must** always pass `RELEASE_REPO_NAMES` explicitly
when running release scripts (see Environment Variable Reference).

#### Fix 2 — Add `RELEASE_REPO_NAMES` to both workflow files

File: `.github/workflows/release-final.yml`, step `Run release-final`:

```yaml
env:
  RELEASE_VERSION: ${{ inputs.version }}
  RELEASE_PREVIOUS_VERSION: ${{ inputs.previous_version }}
  DRY_RUN: ${{ inputs.dry_run }}
  GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  GITHUB_RUN_ID: ${{ github.run_id }}
  RELEASE_REPO_NAMES: "axiomoperator/uptime-pro,ghcr.io/axiomoperator/uptime-pro"   # ADD THIS
```

Same addition needed in `.github/workflows/release-beta.yml`, step
`Run release-beta`.

#### Fix 3 — Update `package.json` repository URL

`package.json` currently contains:
```json
"repository": {
  "type": "git",
  "url": "https://github.com/louislam/uptime-kuma.git"
}
```

Change to:
```json
"repository": {
  "type": "git",
  "url": "https://github.com/AxiomOperator/uptime-pro.git"
}
```

#### Fix 4 — Enable nightly workflow for this fork

File: `.github/workflows/release-nightly.yml`, line:
```yaml
if: github.repository == 'louislam/uptime-kuma'
```

Change to:
```yaml
if: github.repository == 'AxiomOperator/uptime-pro'
```

Also add `RELEASE_REPO_NAMES` to the nightly `Run release-nightly` step (the
script calls `getRepoNames()` which has the same defaulting issue as Fix 1).

---

## Branch Strategy

| Branch | Purpose |
|--------|---------|
| `master` | Main development branch; PRs target this |
| `release-{VERSION}` | Created automatically by release script; exists only during release |

The release scripts (`final.mjs`, `beta.mjs`) call `checkReleaseBranch()` which
**aborts** if you are not on the `release-{VERSION}` branch. You cannot run
`npm run release-final` from `master`.

---

## Release Types

### Final Release

- Script: `extra/release/final.mjs` (`npm run release-final`)
- Workflow: `.github/workflows/release-final.yml` (workflow_dispatch)
- Version env: `RELEASE_VERSION` (e.g., `1.0.0`) — must be plain semver, no pre-release identifier
- What it does:
  1. Verifies you are on branch `release-{VERSION}`
  2. Checks Docker Hub to ensure the tag does not already exist
  3. Runs `extra/update-version.mjs` to bump `package.json` and `package-lock.json`
  4. Creates a draft PR from `release-{VERSION}` → `master` via `gh pr create`
  5. Builds the frontend with `npm run build`
  6. Builds and pushes six Docker image variants (full, slim, rootless) to all registries
  7. Creates `./tmp/dist.tar.gz`

### Beta Release

- Script: `extra/release/beta.mjs` (`npm run release-beta`)
- Workflow: `.github/workflows/release-beta.yml` (workflow_dispatch)
- Version env: `RELEASE_BETA_VERSION` (e.g., `1.0.0-beta.1`) — must include `-beta.N` identifier
- Behaviour identical to final release except Docker images are tagged `beta`, `beta-slim`, etc.

### Nightly Build

- Script: `extra/release/nightly.mjs` (`npm run release-nightly`)
- Workflow: `.github/workflows/release-nightly.yml` (scheduled: 02:00 UTC daily + workflow_dispatch)
- **Currently blocked** by the `if: github.repository == 'louislam/uptime-kuma'` guard (Fix 4 above)
- No version bump or changelog; pushes image tags `nightly2` and `nightly2-rootless`
- Docker targets: full image and rootless variant only

---

## Performing a Manual Release (Recommended for First Release)

Use this approach for `v1.0.0`. It requires no Docker push and no automation
fixes. You need: Git, Node.js, npm, and the `gh` CLI authenticated.

### Step 1: Pre-release validation

```bash
# Ensure you are on a clean master with all tests passing
cd /path/to/uptime-pro
git checkout master
git pull origin master
git status          # must show "nothing to commit"

# Install dependencies and run linters
npm ci
npm run lint

# Build frontend to verify it compiles cleanly
npm run build

# Run backend tests
npm run test-backend
```

### Step 2: Create and push the release tag

```bash
# Tag the current HEAD with an annotated tag
git tag -a v1.0.0 -m "Uptime Pro v1.0.0"

# Verify the tag was created
git tag -l "v1.0.0"

# Push the tag to origin
git push origin v1.0.0
```

> **Important**: Never force-push a tag after publishing a GitHub Release.
> If you push the wrong commit, delete the tag and re-create it before
> creating the release (see Rollback section).

### Step 3: Create the GitHub Release

Option A — using `gh` CLI:

```bash
gh release create v1.0.0 \
  --repo AxiomOperator/uptime-pro \
  --title "Uptime Pro v1.0.0" \
  --notes "Initial release of Uptime Pro, forked from Uptime Kuma 2.2.1." \
  --latest
```

Option B — via the GitHub web UI:

1. Go to `https://github.com/AxiomOperator/uptime-pro/releases/new`
2. Select tag `v1.0.0`
3. Set title: `Uptime Pro v1.0.0`
4. Write release notes
5. Check **Set as the latest release**
6. Click **Publish release**

### Step 4: Verify the release

```bash
# Confirm the release exists
gh release view v1.0.0 --repo AxiomOperator/uptime-pro

# Confirm the tag points to the right commit
git ls-remote --tags origin | grep v1.0.0
```

Also visit `https://github.com/AxiomOperator/uptime-pro/releases` to confirm
the release is shown as latest.

---

## Performing an Automated Release (After Fixes Applied)

**Complete all four fixes in "Pre-release Code Fixes Required" before
proceeding. Without Fix 1 + Fix 2, Docker images will be pushed to the wrong
registries.**

### Pre-flight checklist

- [ ] Fix 1–4 are merged to `master`
- [ ] All four GitHub Actions secrets are configured
- [ ] `gh auth status` shows authenticated access to `AxiomOperator/uptime-pro`
- [ ] Docker Hub repository `axiomoperator/uptime-pro` exists (create it if not)
- [ ] GHCR package visibility is set correctly (if needed)
- [ ] `master` branch is in the state you want to release

### Using the release-final workflow

1. Navigate to **Actions → Final Release → Run workflow** in the GitHub UI, or:

```bash
gh workflow run release-final.yml \
  --repo AxiomOperator/uptime-pro \
  --field version=1.0.0 \
  --field previous_version=1.0.0-beta.3 \
  --field dry_run=false
```

2. Monitor the workflow run:

```bash
gh run list --repo AxiomOperator/uptime-pro --workflow release-final.yml --limit 5
gh run watch --repo AxiomOperator/uptime-pro   # interactive watch of latest run
```

3. After the run succeeds:
   - A draft PR `release-1.0.0` → `master` will be open — review and merge it
   - Download `dist-1.0.0` artifact from the workflow run
   - Create the GitHub Release (the PR body lists all manual steps)
   - Upload `dist.tar.gz` to the release as an attachment
   - Publish the release

### Using the release-beta workflow

```bash
gh workflow run release-beta.yml \
  --repo AxiomOperator/uptime-pro \
  --field version=1.0.0-beta.1 \
  --field previous_version=1.0.0-alpha.1 \
  --field dry_run=false
```

Beta releases create images tagged `beta`, `beta-slim`, `beta-rootless`, and
the full version string. Set **Pre-release** when creating the GitHub Release.

### Environment variable reference

These are used by scripts when running locally (not needed when using the
workflow — the workflow injects them):

| Variable | Used by | Description | Example |
|----------|---------|-------------|---------|
| `RELEASE_VERSION` | `final.mjs`, `update-version.mjs` | Target version, no pre-release suffix | `1.0.0` |
| `RELEASE_BETA_VERSION` | `beta.mjs` | Beta version with `-beta.N` suffix | `1.0.0-beta.1` |
| `RELEASE_PREVIOUS_VERSION` | both | Previous tag for changelog generation | `1.0.0-beta.3` |
| `RELEASE_REPO_NAMES` | `lib.mjs` `getRepoNames()` | Comma-separated Docker registry targets | `axiomoperator/uptime-pro,ghcr.io/axiomoperator/uptime-pro` |
| `DRY_RUN` | both | `true` skips Docker push; PR is still created | `true` |
| `GH_TOKEN` | `lib.mjs` `createReleasePR()` | GitHub token for `gh pr create` | (PAT or `GITHUB_TOKEN`) |
| `RELEASE_DRY_RUN` | `lib.mjs` top-level | Alternative dry-run flag (value `"1"`) | `1` |

To run `release-final` locally (after applying all fixes):

```bash
# Create and switch to the release branch first
git checkout -b release-1.0.0

export RELEASE_VERSION=1.0.0
export RELEASE_PREVIOUS_VERSION=1.0.0-beta.3
export RELEASE_REPO_NAMES="axiomoperator/uptime-pro,ghcr.io/axiomoperator/uptime-pro"
export DRY_RUN=true          # set to false only when ready to push Docker images
export GH_TOKEN=$(gh auth token)

npm run release-final
```

---

## Building and Attaching Artifacts

The release scripts automatically produce `./tmp/dist.tar.gz` (the compiled
frontend). When running via GitHub Actions, this is uploaded as workflow
artifact `dist-{VERSION}` (retained for 90 days).

To attach `dist.tar.gz` to a GitHub Release:

```bash
# Download artifact from workflow (if created by CI)
gh run download --repo AxiomOperator/uptime-pro --name dist-1.0.0

# Upload to the release
gh release upload v1.0.0 dist.tar.gz \
  --repo AxiomOperator/uptime-pro
```

Or via the web UI: go to the release → **Edit** → drag the file into the
assets section.

Docker images produced by a final release (after fixes):

| Tag | Variant |
|----|---------|
| `{VERSION}` | Full image |
| `2` | Floating major tag (full) |
| `next` | Floating next tag (full) |
| `{VERSION}-slim` | Slim image |
| `2-slim` | Floating slim tag |
| `next-slim` | Floating slim tag |
| `{VERSION}-rootless` | Rootless variant |
| `2-rootless` | Floating rootless tag |
| `{VERSION}-slim-rootless` | Slim rootless |
| `2-slim-rootless` | Floating slim rootless tag |

All tags are pushed to both `axiomoperator/uptime-pro` (Docker Hub) and
`ghcr.io/axiomoperator/uptime-pro` (GHCR) once Fix 1 and Fix 2 are applied.

Base images used during build (upstream, read-only):
- `louislam/uptime-kuma:base2`
- `louislam/uptime-kuma:base2-slim`
- `louislam/uptime-kuma:builder-go`

---

## Verifying a Release

After any release (manual or automated), verify:

```bash
# 1. Tag exists on remote
git ls-remote --tags origin | grep "refs/tags/v1.0.0"

# 2. GitHub Release is published (not draft)
gh release view v1.0.0 --repo AxiomOperator/uptime-pro

# 3. Release is marked as latest
gh release list --repo AxiomOperator/uptime-pro --limit 5

# 4. Docker image pulls correctly (after automated release with Docker push)
docker pull axiomoperator/uptime-pro:1.0.0
docker pull ghcr.io/axiomoperator/uptime-pro:1.0.0

# 5. Image runs
docker run --rm -p 3001:3001 axiomoperator/uptime-pro:1.0.0 &
sleep 5
curl -sf http://localhost:3001 | head -5
```

---

## Rollback and Correction

### Deleting a bad tag

```bash
# Delete local tag
git tag -d v1.0.0

# Delete remote tag
git push origin --delete v1.0.0

# Verify it is gone
git ls-remote --tags origin | grep v1.0.0   # should return nothing
```

### Deleting a bad GitHub Release

```bash
gh release delete v1.0.0 \
  --repo AxiomOperator/uptime-pro \
  --yes \
  --cleanup-tag        # also deletes the tag; omit if you want to keep the tag
```

Or via web UI: Releases → click the release → **Delete**.

### Re-releasing the same version

1. Delete the GitHub Release (see above)
2. Delete the git tag (see above)
3. Delete the `release-{VERSION}` branch if it exists:
   ```bash
   git push origin --delete release-1.0.0
   git branch -D release-1.0.0
   ```
4. If `package.json` was already bumped by `update-version.mjs`, revert that
   commit before re-running:
   ```bash
   git revert HEAD --no-edit   # or git reset --hard HEAD~1 if not yet pushed
   ```
5. Re-run the release procedure from the beginning.

> **Note**: Docker Hub does not allow re-using a tag by default once a manifest
> is pushed. You must delete the tag from Docker Hub Settings, or bump to a
> patch version instead of re-releasing the same one.

---

## First Release: Exact Steps (v1.0.0)

This is a self-contained checklist. Complete every step in order.
No Docker push. No automation prerequisites.

**Time estimate**: 10–15 minutes.

### Prerequisites check

```
[ ] Node.js >= 20.4 installed:   node --version
[ ] npm >= 9.3 installed:        npm --version
[ ] gh CLI authenticated:        gh auth status
[ ] On the correct repo remote:  git remote -v   (should show AxiomOperator/uptime-pro)
```

### Steps

1. **Sync master to latest HEAD**

   ```bash
   cd /path/to/uptime-pro
   git checkout master
   git pull origin master
   git status    # expect: "nothing to commit, working tree clean"
   ```

2. **Install dependencies**

   ```bash
   npm ci
   ```

3. **Run linter** (fix any errors before continuing)

   ```bash
   npm run lint
   ```

4. **Build the frontend** (confirms production build works)

   ```bash
   npm run build
   ```

5. **Run backend tests**

   ```bash
   npm run test-backend
   ```

6. **Create the annotated git tag**

   ```bash
   git tag -a v1.0.0 -m "Uptime Pro v1.0.0"
   ```

7. **Confirm the tag is correct**

   ```bash
   git show v1.0.0 --quiet   # verify it points to the expected commit
   ```

8. **Push the tag to GitHub**

   ```bash
   git push origin v1.0.0
   ```

9. **Create the GitHub Release**

   ```bash
   gh release create v1.0.0 \
     --repo AxiomOperator/uptime-pro \
     --title "Uptime Pro v1.0.0" \
     --notes "Initial release of Uptime Pro, based on Uptime Kuma 2.2.1.

   ## What's included
   - All features from Uptime Kuma 2.2.1
   - Rebranded as Uptime Pro

   ## Installation
   See README.md for installation instructions." \
     --latest
   ```

10. **Verify the release is visible and marked as latest**

    ```bash
    gh release view v1.0.0 --repo AxiomOperator/uptime-pro
    ```

    Also visit: `https://github.com/AxiomOperator/uptime-pro/releases`

11. **(Optional) Attach the dist tarball**

    ```bash
    # The build from step 4 is already in ./dist
    # Create the tarball manually
    mkdir -p tmp
    tar -zcf tmp/dist.tar.gz dist/

    # Upload to the release
    gh release upload v1.0.0 tmp/dist.tar.gz \
      --repo AxiomOperator/uptime-pro
    ```

12. **Post-release: apply code fixes for future automated releases**

    Open issues or PRs to apply the four fixes listed in
    "Pre-release Code Fixes Required" so the next release can use
    automation safely.

---

*Runbook maintained by AxiomOperator. Update this file whenever release
infrastructure changes.*
