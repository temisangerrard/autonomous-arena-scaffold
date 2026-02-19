# Play Runtime Code Map

This file explains what each major `/play` runtime module is responsible for.

## Entry + Orchestration

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/app.js`
  - Boots scene, systems, and plugins.
  - Wires module dependencies together.
  - Owns high-level update/render loop and minimal wrappers that delegate to modules.

## Runtime Modules

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/network/arena-config.js`
  - Loads `/api/config` with retry/fallback.
  - Resolves websocket base URL safely across local/prod/test contexts.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/api-client.js`
  - Owns authenticated fetch wrapper and JSON error normalization for runtime API calls.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/network/socket-runtime.js`
  - Owns websocket connect/open/close/message pipeline.
  - Applies snapshot/proximity/station/challenge feed events to runtime state.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/network/retry-scheduler.js`
  - Owns bounded exponential reconnect scheduling and retry status messaging.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/templates/interaction-card.js`
  - Renders and binds station + player interaction card UI.
  - Handles dealer/cashier/prediction/world interaction card branches.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/game-moves.js`
  - Validates and routes match/dealer move submissions.
  - Enforces game-type specific move constraints.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/challenge-events.js`
  - Applies challenge lifecycle transitions (`created/accepted/resolved/...`) to state.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/challenge-bridge.js`
  - Bridges challenge event handling, reason mapping, and backward-compatible RPS visibility hooks.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/challenge-settlement-ui.js`
  - Owns post-resolution wallet delta sync and win/loss/draw splash messaging.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/escrow-approval.js`
  - Owns escrow approval readiness flow and approval-related reason classification.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/challenge-reason.js`
  - Maps server reason codes to user-facing challenge status copy.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/formatting.js`
  - Owns currency/tx/wager/prediction formatting and dealer reveal status rendering helpers.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/result-splash.js`
  - Owns transient win/loss/draw overlay rendering and animation timing.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/feed.js`
  - Renders structured challenge activity feed cards + tx links.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/feed-events.js`
  - Owns challenge feed append/dedupe/truncation lifecycle and feed render dispatch.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/escrow-policy.js`
  - Owns client escrow policy resolution (mode/network/caps) and state sync.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/interaction-shell.js`
  - Owns interaction open/close state transitions and top prompt visibility/copy.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/interaction-bindings.js`
  - Owns interaction prompt/help/close button event binding and open-state toggling.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/wallet-sync.js`
  - Owns wallet summary polling, in-flight dedupe, and websocket/visibility-aware scheduler behavior.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/station-routing.js`
  - Owns server/local station proxy mapping and merged station index construction.
  - Resolves outgoing and incoming station IDs so host/baked proxies route deterministically.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/station-interactions.js`
  - Owns station interaction send routing, station status UI tags, and player seed generation.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/world-loader.js`
  - Handles world load lifecycle (connect/download/process/fail) and progress dispatch.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/world-stations.js`
  - Owns world-root/NPC-host station lifecycle and host+baked station synchronization.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/world-map-renderer.js`
  - Draws minimap panel (sections, players, stations, coords).

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/dealer-game-type.js`
  - Derives dealer game type from station_ui payload/state safely (fail-closed).

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/mobile-controls.js`
  - Computes mobile control visibility + minimap hide conditions.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/mobile-controls-renderer.js`
  - Owns mobile controls DOM visibility toggles and minimap obscuring behavior wiring.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/player-normalization.js`
  - Owns snapshot normalization, yaw normalization, and render-Y sanitization helpers.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/scene-dynamics.js`
  - Owns local avatar interpolation + camera follow and spotlight/separation scene dynamics.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/frame-loop.js`
  - Owns frame loop progression and test-aware render scheduling behavior.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/runtime-update.js`
  - Owns per-frame orchestration sequencing for movement, world UI, interaction card, mobile controls, and HUD updates.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/selectors.js`
  - Owns shared station/player labeling and station-id selector helpers.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/spotlights.js`
  - Owns spotlight mesh construction and scene registration for match/target highlighting.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/targeting.js`
  - Owns nearby target selection, cycling, and station/player proximity distance sync.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/test-hooks.js`
  - Owns deterministic test stepping and `render_game_to_text` debug snapshot hooks.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/js/play/runtime/startup-lifecycle.js`
  - Owns world-load startup kick-off and visibility-driven wallet sync scheduler behavior.

## UI/CSS Structure

- `/Users/temisan/Downloads/blender implementation/apps/web/public/play.html`
  - Shell markup only, no inline style blocks or style attributes.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/css/play/play-shell.css`
  - Import-only css entrypoint for play UI styles.

- `/Users/temisan/Downloads/blender implementation/apps/web/public/css/play/*.css`
  - Sectioned style modules (HUD, map, interaction card, mobile controls, etc.).

## Guardrails

- `/Users/temisan/Downloads/blender implementation/config/modularity-budgets.json`
  - Contextual budgets + boundary rules.

- `/Users/temisan/Downloads/blender implementation/scripts/enforce-modularity.mjs`
  - Enforces modular boundaries and emits `.modularity-report.json` guidance.
