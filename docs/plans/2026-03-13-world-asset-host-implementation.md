# World Asset Host Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `arena-world-assets.netlify.app` the permanent canonical host for production world assets and provide a repeatable publish path.

**Architecture:** `arena-web` will expose and default to a canonical Netlify asset base instead of assuming the local GLB exists in the Fly image. A dedicated publish script will stage `/assets/world/mega.glb` and deploy it to the separate Netlify site.

**Tech Stack:** Node.js, TypeScript, Vitest, Netlify CLI, Fly.io env config

---

### Task 1: Canonical asset base in web runtime

**Files:**
- Modify: `apps/web/src/server.ts`
- Modify: `apps/web/public/js/play/runtime/network/arena-config.js`
- Modify: `.env.example`
- Test: `apps/web/src/worldAssetHost.test.ts`

**Step 1: Write the failing test**
Create a test that asserts the canonical asset base is `https://arena-world-assets.netlify.app` when no env override is set.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/web test -- src/worldAssetHost.test.ts`
Expected: FAIL until canonical host constant exists.

**Step 3: Write minimal implementation**
Add a shared constant in the web server/runtime config path and use it as the default world asset base. Update `.env.example` to document the canonical production value.

**Step 4: Run tests to verify they pass**
Run: `npm run -w @arena/web test -- src/worldAssetHost.test.ts`
Expected: PASS.

**Step 5: Commit**
`git add apps/web/src/server.ts apps/web/public/js/play/runtime/network/arena-config.js .env.example apps/web/src/worldAssetHost.test.ts`
`git commit -m "fix: set canonical world asset host"`

### Task 2: Add dedicated world asset publish script

**Files:**
- Create: `scripts/publish-world-assets.mjs`
- Create: `apps/web/src/publishWorldAssets.test.js`
- Modify: `package.json`

**Step 1: Write the failing test**
Create a test that runs the script in dry-run/staging mode and asserts it stages `/assets/world/mega.glb` from a source GLB and rejects missing site config.

**Step 2: Run test to verify it fails**
Run: `npm run -w @arena/web test -- src/publishWorldAssets.test.js`
Expected: FAIL until the script exists.

**Step 3: Write minimal implementation**
Implement a Node script that:
- reads `WORLD_ASSET_SOURCE_PATH` or defaults to `train_station_mega_world.glb`
- stages a temp publish dir containing `/assets/world/mega.glb`
- requires `NETLIFY_WORLD_ASSETS_SITE_ID` or `NETLIFY_WORLD_ASSETS_SITE_NAME`
- supports `--dry-run`
- deploys via `netlify deploy --prod`

**Step 4: Run tests to verify they pass**
Run: `npm run -w @arena/web test -- src/publishWorldAssets.test.js`
Expected: PASS.

**Step 5: Commit**
`git add scripts/publish-world-assets.mjs apps/web/src/publishWorldAssets.test.js package.json`
`git commit -m "ops: add world asset publish script"`

### Task 3: Document the operational path

**Files:**
- Create: `docs/world-assets.md`
- Modify: `progress.md`

**Step 1: Write the docs**
Document the canonical host, required env vars, how to publish a new GLB, and why CI does not upload the asset automatically.

**Step 2: Verify references**
Check the doc paths/commands match the actual script and host.

**Step 3: Commit**
`git add docs/world-assets.md progress.md`
`git commit -m "docs: document canonical world asset host"`
