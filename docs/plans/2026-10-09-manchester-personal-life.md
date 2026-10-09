# Manchester personal life implementation plan

**Goal:** Make the player's character, game-money balance and owned apartment central to the existing solo city.
**Architecture:** A validated local life-state module owns game pounds, needs and owned decor. Main passes it into apartment/phone and grants a single reward for completed activity visits. An apartment experience reuses the renderer and disposal lifecycle. Street camera follows the avatar closely, with an optional city view.
**Tech stack:** Existing Three.js, DOM UI, localStorage, Node assertions and Playwright.

1. Add life-state tests for initial £250, valid purchases, duplicate/insufficient-fund rejection, save/reload and malformed storage. Implement the store with explicit reward/purchase/cook/rest operations.
2. Create furnished cutaway apartment, local walkable avatar, furniture collision and rest/cook/relax interactions. Decor purchases visibly modify home, persist, never debit twice.
3. Integrate phone Home and balance, visible street balance/home/camera buttons, closer avatar follow camera and activity completion rewards. Preserve existing tram and activity flows. Save only bounded validated state.
4. Browser-test closer camera, home entry/walking/actions, purchases and reload, insufficient funds, activity reward once per visit, exit/reentry, portrait/landscape. Run required game client and inspect screenshots.
5. Deploy existing Cloudflare static Worker, verify live life flow, update README/progress. Physical-device performance remains unmeasured. No real money, accounts or multiplayer introduced.

## Approved fantasy-life revision
User rejected scarcity and approved a wealthy start. Version-2 local state grants £250,000 once to old saves, preserves higher existing balances, includes all furniture, makes meals free and stores decor visibility. Activities unlock persistent one-time collectibles (gold/violet jackets, badge, title, private sunset-tour variant) instead of cash. Tests now exercise migration and actual usable unlocks rather than purchase debits.

## Approved multi-room penthouse revision
User approved separate bedrooms/bathroom/kitchen/living/games/terrace, stairs and interactive activities. Build seven connected room scenes across two floors, loaded one at a time for mobile rendering. Open doorway gaps trigger spatial transitions; room navigation follows the graph through actual portals. Add chop/heat/serve cooking, three-dart timing/aim challenge, temperature-controlled shower, timed breathing/rest, changing TV channels and three-view terrace spotting. Preserve game-money and decor state. Test all room routes, manual doorway entry, activity success/cancel, upstairs/downstairs and mobile layout before static deployment.

## Phone furniture shop
Add a phone Shop tab usable outdoors and inside home. Curated eight-item catalog includes previews and room compatibility. Purchases debit game money once, store inventory and immediately update visible room geometry. Replacements store prior items; owned pieces can be moved or stored without another charge. Validate old saves, bad IDs/rooms, duplicate purchase, insufficient balance, storage and persistence. Keep static deployment and no real-world commerce.
