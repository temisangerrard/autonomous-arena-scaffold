# Lucky Puff Plaza Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build Lucky Puff Plaza as a separate cute, bright, walkable stage that can be loaded without replacing or destabilizing the existing production world.

**Architecture:** Add a stage registry path around the existing world loader, publish the new GLB as an isolated asset, and bind named Blender objects to existing station/runtime behavior. The first pass proves safe loading, movement, station prompts, and one low-risk environmental interaction before adding richer avatars or Arc-specific actions.

**Tech Stack:** Blender 5, GLB/glTF, Three.js runtime, existing `/play` world loader, existing station interaction modules, Playwright world exploration tests.

---

### Task 1: Add Stage Registry Test

**Files:**
- Create or modify test: `apps/web/src/worldAssets.test.ts`
- Inspect: `apps/web/public/js/play/runtime/world-loader.js`
- Inspect: `apps/web/public/runtime-config.js`

**Step 1: Write the failing test**

Add a test that proves a named stage can resolve to a world bundle without changing the default world. The expected behavior:

- default world alias remains `mega-shell`
- `lucky-puff-plaza` resolves to its own bundle URL or manifest entry
- unknown stage falls back safely or fails closed with a clear error

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- --run apps/web/src/worldAssets.test.ts
```

Expected: FAIL because the stage registry does not exist yet.

**Step 3: Implement minimal registry**

Add a small stage registry module near the world runtime code. Keep the initial API simple:

```js
export const WORLD_STAGES = {
  default: {
    id: "default",
    alias: "mega-shell",
  },
  "lucky-puff-plaza": {
    id: "lucky-puff-plaza",
    alias: "lucky-puff-plaza",
  },
};

export function resolveWorldStage(stageId) {
  if (!stageId) return WORLD_STAGES.default;
  return WORLD_STAGES[stageId] || WORLD_STAGES.default;
}
```

Wire this only where the world alias is selected. Do not alter station behavior.

**Step 4: Run test to verify it passes**

Run:

```bash
npm test -- --run apps/web/src/worldAssets.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/src/worldAssets.test.ts apps/web/public/js/play/runtime
git commit -m "feat: add world stage registry"
```

### Task 2: Build Blender Blockout GLB

**Files:**
- Create: `blender_outputs/lucky_puff_plaza/lucky_puff_plaza.blend`
- Create: `blender_outputs/lucky_puff_plaza/lucky_puff_plaza.glb`
- Modify or create script: `scripts/build_lucky_puff_plaza.py`
- Reference: `docs/plans/2026-05-21-lucky-puff-plaza-design.md`

**Step 1: Create a repeatable Blender script**

Use Blender headless scripting to create the first blockout:

- circular plaza floor
- train arrival platform
- central soft arena
- four station carts
- Arc stamp terminal
- prize wheel landmark
- blocker rails
- player spawn empties
- named station empties

Use warm pastel materials and rounded geometry.

**Step 2: Run Blender export**

Run:

```bash
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup --python scripts/build_lucky_puff_plaza.py
```

Expected: creates `.blend` and `.glb` in `blender_outputs/lucky_puff_plaza/`.

**Step 3: Validate object names**

Run or create a small GLB inspection script that verifies these names exist:

```txt
StageRoot_LuckyPuffPlaza
Spawn_Player_A
Station_TicketBooth
Station_PrizeWheel
Station_ArcTerminal
Station_Cashier
Station_CoinflipCart
Station_RpsCart
Blocker_PlazaRail_*
```

Expected: PASS.

**Step 4: Commit**

```bash
git add scripts/build_lucky_puff_plaza.py blender_outputs/lucky_puff_plaza
git commit -m "feat: add Lucky Puff Plaza blockout"
```

### Task 3: Add Local Stage Asset Wiring

**Files:**
- Modify: `apps/web/public/js/play/runtime/world-loader.js`
- Modify: `apps/web/public/sw-world-cache.js`
- Modify: `scripts/publish-world-assets.mjs`
- Test: `apps/web/src/worldAssets.test.ts`

**Step 1: Write asset resolution test**

Add coverage that `lucky-puff-plaza` resolves to `/assets/world/lucky-puff-plaza.glb` while default still resolves to `mega-shell.glb`.

**Step 2: Run test to verify it fails**

Run:

```bash
npm test -- --run apps/web/src/worldAssets.test.ts
```

Expected: FAIL until publishing/resolution supports the new bundle.

**Step 3: Implement minimal asset support**

Teach the world asset publisher and loader about the new alias. Keep compatibility aliases for existing world files untouched.

**Step 4: Run tests**

Run:

```bash
npm test -- --run apps/web/src/worldAssets.test.ts
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/public/js/play/runtime/world-loader.js apps/web/public/sw-world-cache.js scripts/publish-world-assets.mjs apps/web/src/worldAssets.test.ts
git commit -m "feat: wire Lucky Puff Plaza world asset"
```

### Task 4: Bind Named Stations To Existing Interactions

**Files:**
- Modify: `apps/web/public/js/play/runtime/world-stations.js`
- Modify: `apps/web/public/js/play/runtime/station-routing.js`
- Test: `apps/web/src/worldNpcHosts.test.js`
- Test: `apps/web/src/stationMarkers.test.js`

**Step 1: Write station binding tests**

Add tests that named stage objects map to existing station kinds:

```txt
Station_Cashier -> cashier
Station_CoinflipCart -> dealer_coinflip
Station_RpsCart -> dealer_rps
Station_PrizeWheel -> world_interactable
Station_ArcTerminal -> arc_terminal
```

**Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- --run apps/web/src/worldNpcHosts.test.js apps/web/src/stationMarkers.test.js
```

Expected: FAIL until station name mapping is added.

**Step 3: Implement minimal mapping**

Add mapping through the existing station modules. Do not add new UI panels unless required. `arc_terminal` may initially use the world interactable panel with disabled/testnet copy.

**Step 4: Run tests**

Run:

```bash
npm test -- --run apps/web/src/worldNpcHosts.test.js apps/web/src/stationMarkers.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add apps/web/public/js/play/runtime/world-stations.js apps/web/public/js/play/runtime/station-routing.js apps/web/src/worldNpcHosts.test.js apps/web/src/stationMarkers.test.js
git commit -m "feat: bind Lucky Puff Plaza stations"
```

### Task 5: Add Playwright Smoke Coverage

**Files:**
- Modify: `scripts/e2e/world-exploration.test.js`
- Modify or create: `scripts/e2e/lucky-puff-plaza.test.js`

**Step 1: Write e2e smoke test**

The test should:

- open `/play?stage=lucky-puff-plaza`
- wait for world load
- assert the player can move
- assert at least one station prompt appears near a named station
- assert no default-world failure UI appears

**Step 2: Run test to verify it fails if wiring is incomplete**

Run:

```bash
npm run e2e -- scripts/e2e/lucky-puff-plaza.test.js
```

Expected: FAIL until stage wiring and asset serving are complete.

**Step 3: Fix runtime issues only inside the stage path**

Address loader, path, camera, or prompt issues without changing the current default world behavior.

**Step 4: Run e2e again**

Run:

```bash
npm run e2e -- scripts/e2e/lucky-puff-plaza.test.js
```

Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/e2e/lucky-puff-plaza.test.js scripts/e2e/world-exploration.test.js
git commit -m "test: cover Lucky Puff Plaza exploration"
```

### Task 6: Avatar Upgrade Spike

**Files:**
- Inspect: `apps/web/public/js/play/avatars`
- Inspect: `apps/web/public/assets/characters`
- Create: `docs/plans/2026-05-21-lucky-puff-avatar-notes.md`

**Step 1: Audit current avatar assets**

List existing GLB characters, detected animation clips, approximate file sizes, and fit for the cute stage.

**Step 2: Pick one pilot avatar**

Choose one avatar to normalize for Lucky Puff Plaza. It must support at least `idle` and `walk`.

**Step 3: Document the avatar contract**

Write a short notes doc covering:

- selected pilot avatar
- missing clips
- target proportions
- export or runtime normalization changes needed

**Step 4: Commit**

```bash
git add docs/plans/2026-05-21-lucky-puff-avatar-notes.md
git commit -m "docs: define Lucky Puff avatar pilot"
```

### Task 7: Final Verification

**Files:**
- Read: `docs/world-rollout-checklist.md`
- Read: `docs/play-runtime-code-map.md`

**Step 1: Run focused tests**

Run:

```bash
npm test -- --run apps/web/src/worldAssets.test.ts apps/web/src/worldNpcHosts.test.js apps/web/src/stationMarkers.test.js
```

Expected: PASS.

**Step 2: Run modularity check**

Run:

```bash
npm run enforce:modularity
```

Expected: PASS or only known unrelated warnings.

**Step 3: Run e2e smoke**

Run:

```bash
npm run e2e -- scripts/e2e/lucky-puff-plaza.test.js
```

Expected: PASS.

**Step 4: Manual browser check**

Open:

```txt
/play?stage=lucky-puff-plaza
```

Verify:

- bright cheerful first impression
- player spawns facing central plaza
- movement works
- camera does not clip into major props
- station prompts appear
- existing default `/play` still works

**Step 5: Commit final fixes**

```bash
git add .
git commit -m "fix: polish Lucky Puff Plaza stage rollout"
```

## Execution Choice

Plan complete and saved to `docs/plans/2026-05-21-lucky-puff-plaza-implementation.md`.

Two execution options:

1. Subagent-Driven in this session: dispatch fresh subagent per task, review between tasks, fast iteration.
2. Parallel Session: open a separate session with `superpowers:executing-plans`, batch execution with checkpoints.

