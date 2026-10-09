# Manchester world scaffold

Open `/manchester/` from the existing static frontend, or run:

```sh
python3 -m http.server 5188 --directory apps/web/public
```

Then open `http://localhost:5188/manchester/`.

## Included

- Five procedurally constructed, stylised district interpretations: Salford Quays, Old Trafford, Trafford Centre, Northern Quarter, Castlefield.
- Camera-relative keyboard walking/running, drag-to-look, mobile thumbstick, world boundaries and building/canal collision.
- Interactive tram rides with carriage/window views, stop bell and explicit disembarking; only one destination is loaded at a time.
- In-world phone with activities, tram connections, home entry, a local visit journal and the Quays & Co. furniture shop. Eight products offer stylised previews, compatible-room selection, game-money purchase and instant placement. Owned furniture can be moved free or stored; a replacement keeps the previous piece in storage. Phone shopping works inside the penthouse and saves locally.
- Close character-follow camera with an optional city overview and obstruction avoidance.
- Owned two-floor Quays penthouse: living room, kitchen/dining room, games room, main and guest bedrooms, bathroom/spa and terrace. Walk-through doorway transitions and stairs connect rooms; room buttons walk the avatar along the route. Cooking uses preparation/timing/serving; darts scores three throws; bedroom breathing uses a timing zone; showering requires temperature control; TV channels and terrace landmark spotting are interactive. Four included decor pieces can be shown or put away.
- Game-money balance starts at £250,000; existing v1 saves receive a one-time upgrade. Meals and all apartment decor are included. Activities unlock two exclusive wearable jackets, a football badge, a captain title and a private sunset-cruise variant. Collectibles and decor arrangement persist locally. No real-money value or transfers.
- Lowry foyer and auditorium with an original animated captioned play, seating, pause/replay and optional synthesized audio.
- Waterfront running with stamina/cones, alternating-oar rowing, a captioned canal tour towards Sale, penalties, outfit colours, rhythm pads and an interactive canal lock.
- Five-bee discovery trail at Salford Quays, restart, timer and optional local personal-best storage.
- Pinned, locally served Three.js 0.172.0 under its MIT license. No third-party runtime network calls or API keys.

## Scope

This is a **solo playable prototype**. It does not connect to the arena's multiplayer server, accounts, wallet or settlement code. Districts and the 48-second Castlefield–Sale boat tour are compressed fictional interpretations, not a geographically accurate model or navigation route. Tour narration is captioned. The street districts use procedural landmarks; authored GLB landmarks can replace them later, alongside collision updates.

## Performance

Static primitives are instanced by geometry/material. Lighting uses hemisphere/directional light without dynamic shadow maps; water uses inexpensive static geometry. Pixel ratio is capped at 1.5. Resource disposal is checked across repeated district switches. Browser emulation is not evidence of frame rate or thermal performance on a physical phone; the 30-fps target still needs actual device measurement.

## Verification

With the static server running:

```sh
node scripts/manchester-smoke.mjs
node scripts/manchester-experiences-smoke.mjs
node scripts/manchester-activities-smoke.mjs
node scripts/manchester-outdoors-smoke.mjs
node scripts/manchester-life-state-test.mjs
node scripts/manchester-life-smoke.mjs
node scripts/manchester-penthouse-smoke.mjs
node scripts/manchester-shop-state-test.mjs
node scripts/manchester-shop-smoke.mjs
```

The script checks a full trail via keyboard navigation, collision, reset, modal pause, all district transitions, stable geometry resource counts, local best persistence, touch cancellation, and storage-unavailable handling. Screenshots and a report go to `output/manchester/`. `window.render_game_to_text()` exposes inspectable state; `window.advanceTime(ms)` steps simulation for browser tests.

## Cloudflare deployment

The standalone static-assets Worker is configured in `apps/manchester-preview/wrangler.jsonc`.

```sh
node_modules/.bin/wrangler deploy --config apps/manchester-preview/wrangler.jsonc
```

Only this directory is published; the existing arena backend is a separate Worker. No build step, wallet secrets, or runtime AI service is required. The README is excluded by `.assetsignore`.

Verify the published URL with:

```sh
MANCHESTER_URL=https://YOUR-WORKER.workers.dev/ node scripts/manchester-deployment-smoke.mjs
```

This focused check uses mobile Chromium emulation and native touch input, checks portrait/landscape screenshots and keyboard control after closing the tram dialog, and saves results under `output/manchester/live/`. Physical iPhone/Android performance remains to be measured.

### Culture trail
The tram now connects eight destinations. Manchester Art Gallery offers an original abstract-art curator, Manchester Museum a stylised fossil assembly, and the Science and Industry Museum a model-engine power challenge. All three interiors/exhibits are fictional interpretations, not replicas or current exhibition listings. Visits appear in the phone journal. Phone access is a large fixed control; on portrait phones it occupies the bottom-left beside tram travel.

Venue references: https://manchesterartgallery.org/visit-manchester-art-gallery/ , https://www.museum.manchester.ac.uk/venue/galleries-and-spaces , https://www.scienceandindustrymuseum.org.uk/ .

Run `node scripts/manchester-culture-smoke.mjs` for the three mobile phone → tram → activity → street → journal journeys.
