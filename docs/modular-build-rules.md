# Modular Build Rules (Web Game)

These rules are enforced by `scripts/enforce-modularity.mjs` using `config/modularity-budgets.json`.

## Play Surface

1. `apps/web/public/play.html` stays shell-only.
2. No inline `<style>` blocks in `apps/web/public/play.html`.
3. No inline `style="..."` attributes in `apps/web/public/play.html`.
4. Removed controls (for example `mobile-target`) are permanently blocked.

## Contextual Budgets

1. We use baseline + growth budgets per file, not rigid global line caps.
2. A file fails when it grows beyond its configured growth window.
3. A file emits warnings when near budget so extraction can happen before hard failure.
4. On every run, `.modularity-report.json` is generated with actionable extraction hints.

## Controls and Game Modes

1. Dealer game mode must fail closed:
   - No default coinflip fallback in `apps/web/public/js/play/state.js`.
   - Unknown/future game types show no dealer move controls until explicitly wired.
2. Dealer game-type parsing/derivation lives in `apps/web/public/js/play/runtime/dealer-game-type.js`.
3. Mobile control visibility logic lives in `apps/web/public/js/play/runtime/mobile-controls.js`.
4. `apps/web/public/js/play/runtime/app.js` imports these modules and avoids re-inlining them.

## Workflow

1. Run `npm run lint:modularity` to enforce blocking modularity rules.
2. Run `npm run modularity:report` to generate guidance without blocking.
3. Apply extraction from the report, then rerun tests.
4. Use `/Users/temisan/Downloads/blender implementation/docs/play-runtime-code-map.md` as the authoritative responsibility map for runtime modules.
