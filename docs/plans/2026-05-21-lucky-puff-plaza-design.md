# Lucky Puff Plaza Design

## Goal

Build a new optional stage that makes the arena feel bright, warm, cheerful, and deeply cute while preserving the existing production world. The gambling and Arc testnet mechanics should feel like toy-town challenge systems on the surface: tickets, charms, stamps, prize jars, soft portals, and friendly hosts.

## Design Direction

Lucky Puff Plaza is a pastel 3D mobile-game hub: rounded geometry, warm sunlight, soft shadows, oversized props, readable silhouettes, and tiny delightful motion everywhere. It should feel closer to a cozy social arcade than a casino.

Reference qualities:

- Rounded, chunky, plush-like forms.
- Bright warm palette: peach, coral, butter yellow, mint, sky blue, strawberry, lavender accents.
- Toy-town scale: booths and signs are slightly oversized for readability.
- Friendly avatars with chibi proportions, expressive idle animations, and collectible outfits.
- Clear mobile readability: every station should be recognizable from a distance.
- Cute reward language: tickets, badges, charms, stickers, jars, stamps, confetti.

Avoid:

- Dark neon casino language.
- Gritty underground fight-club styling.
- Hard sci-fi terminals as the primary visual language.
- Realistic gambling tables.
- Heavy visual noise that hides interactable stations.

## World Layout

The stage is a walkable circular plaza with four readable rings:

1. Arrival ring: a candy-colored train platform where players spawn.
2. Social ring: avatar display spots, NPC greeters, small toy props, and idle animations.
3. Game ring: dealer carts, prize wheel, challenge pads, cashier booth, and Arc testnet terminal.
4. Arena ring: a soft central challenge floor with rounded rails and animated entry gates.

The layout should support quick sessions. A player should understand where to go within three seconds of spawn:

- Spawn faces the central plaza.
- Highest visual landmark is the Prize Cloud Tower.
- Main Arc testnet action is in a bright kiosk, not hidden in a menu.
- Dealer booths sit on clear colored pads.
- Central arena is visible from nearly every spot.

## Interaction Map

Blender owns placement and naming. The runtime owns behavior.

Required named objects:

- `StageRoot_LuckyPuffPlaza`
- `Spawn_Player_A`
- `Spawn_Player_B`
- `Spawn_Player_C`
- `Station_TicketBooth`
- `Station_PrizeWheel`
- `Station_ArcTerminal`
- `Station_Cashier`
- `Station_DiceCart`
- `Station_CoinflipCart`
- `Station_RpsCart`
- `Portal_MiniArena`
- `Portal_CurrentWorld`
- `NPC_Greeter_Puff`
- `NPC_Cashier_Momo`
- `NPC_Dealer_Bibi`
- `Interactable_PrizeChest_01`
- `Interactable_StickerWall`
- `Blocker_PlazaRail_*`

Interaction treatments:

- Ticket Booth: buy-in, wallet readiness, and onboarding. Visual metaphor: smiling ticket cart.
- Prize Wheel: random challenge entry or cosmetic reward reveal. Visual metaphor: toy wheel with chunky wedges.
- Arc Terminal: Arc testnet actions. Visual metaphor: cheerful stamp machine with USDC/ticket iconography.
- Cashier: funds, withdraw, transfer. Visual metaphor: tiny bank booth with soft jar counters.
- Dealer carts: existing mini-games, each with a unique cute prop silhouette.
- Sticker Wall: profile/achievement board, later phase.
- Prize Chest: low-risk environmental interaction to prove world interactivity.

## Avatar Direction

Use stylized soft 3D avatars rather than realistic fighters.

Baseline proportions:

- Head: 30-40% of body height.
- Hands and feet: slightly oversized.
- Body height: normalized around 1.7 runtime units.
- Materials: matte, soft, high color contrast.
- Faces: simple expressive eyes/mouth where possible.
- Animation: idle, walk, wave, cheer, challenge-ready, win, lose.

Minimum animation contract remains:

- `idle`
- `walk`
- `attack` or `challenge`
- `hurt` or `lose`
- `death` or `knockout`

Recommended additional clips:

- `wave`
- `cheer`
- `jump`
- `spin`
- `special`

## Blender Production Rules

Build the stage as a separate GLB asset. Do not mutate the production world bundle during the first pass.

Target path:

- `assets/world/lucky-puff-plaza.glb` or CDN equivalent after publishing

Blender conventions:

- Stage centered around the central arena.
- Walkable area should fit roughly inside a 24x24 unit footprint.
- Player spawn points should face toward the main landmark.
- Collision-relevant rails and walls should be named `Blocker_*`.
- Stations and NPC hosts should be named with stable prefixes.
- Keep geometry stylized and efficient; prefer repeated modular props.
- Embed textures in the GLB where possible.
- Use warm baked-looking materials, but let runtime lights handle primary illumination.

Export checklist:

- Origin centered.
- Ground plane aligned to runtime Y expectations.
- No huge hidden helper objects.
- No external texture paths.
- Mesh names are stable.
- Named station objects survive export.
- GLB loads in the existing viewer.
- Player can walk without camera clipping into hero props.

## Runtime Rollout

Lucky Puff Plaza must be an optional stage.

First production-safe shape:

- Existing `/play` default world stays unchanged.
- Add a stage registry entry for `lucky-puff-plaza`.
- Add an opt-in route, query param, or UI entry that loads the new stage.
- Keep all current station handlers and wallet flows unchanged.
- Attach behavior to named objects through the existing station/runtime systems.
- Hide Arc-specific action surfaces unless the player enters Arc testnet mode.

The first playable version only needs:

- Load the stage.
- Spawn the player.
- Walk around without clipping major props.
- Show station prompts for named stations.
- Open existing interaction cards at matching stations.
- Include at least one harmless environmental interaction, such as a prize chest or sticker wall.

## Non-Goals For First Pass

- Replacing the current world.
- Full cosmetic inventory.
- Full avatar creator.
- Real-money production gambling changes.
- New smart contracts.
- Physics-heavy mini-games.
- Complex NPC schedules.

## Success Criteria

- The world reads as cheerful and cute within the first viewport.
- A new user can identify three interactable areas without instructions.
- Existing production world remains available and unchanged.
- Stage exports as one GLB and loads through the current viewer/runtime path.
- Existing mini-game interaction cards can be opened from at least two plaza stations.
- Arc testnet presence is visually clear but not required for basic exploration.

