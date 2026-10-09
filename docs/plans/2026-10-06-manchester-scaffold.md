# Manchester neighbourhood scaffold

**Goal:** A beautiful, lightweight, walkable Manchester preview at `/manchester/`, with Salford Quays as the first detailed district and four additional landmark districts accessible by tram selection.

**Approved direction:** Three.js browser rendering; compact, stylised Greater Manchester; mobile controls; no wallet or gambling gate. Use existing Three.js version 0.172.0. This first scaffold is a solo exploration prototype, not a claim of production multiplayer readiness.

**Architecture:** Add a standalone static entry under the existing public directory. Keep district data, scene construction, controls, and application state separate. Construct lightweight instanced architectural geometry locally; switch district groups to bound GPU memory. Avoid an external asset-generation dependency for the initial blockout. Blender/GLB landmark replacements can follow the same district boundaries.

**Tasks:**

1. Create `apps/web/public/manchester/index.html` and `style.css`: responsive world shell, accessible help/tram dialogs, progress display and touch joystick.
2. Create `districts.js` and `world.js`: five condensed landmark interpretations, reusable instanced architecture, safe ground/collision bounds, spawn points and discovery markers. Use official Visit Manchester references for place identity; label the map as compressed and the models as interpretations.
3. Create `main.js` and `controls.js`: walk/run, drag camera, touch controls, tram district switching, a repeatable timed discovery trail, storage that fails safely, rendering/context failure handling, and inspectable game state.
4. Validate using the develop-web-game Playwright client, then targeted desktop/mobile browser checks: movement, obstacles/water, all districts, trail completion/reset, dialog input release, storage failure, viewport resizing, no page/console errors. Inspect screenshots. Record renderer draw calls and triangles, without claiming real-phone frame rates from emulation.
5. Update `progress.md` and show the working local preview. Preserve existing arena files and user changes.

**Performance targets:** capped pixel ratio, no dynamic shadow maps, batched repeated geometry, no full-city payload. Actual 30-fps mobile acceptance remains pending physical device testing.

**Next phase:** replace key landmark blockouts with authored GLBs, implement a multiplayer activity and shared presence, then test real phones. No deployment or paid services are required for this preview.

**References:** https://www.visitmanchester.com/things-to-see-and-do/explore/the-quays/ ; https://www.visitmanchester.com/things-to-see-and-do/ ; https://threejs.org/docs/pages/WebGPURenderer.html

## 2026-10-09: Enterable Lowry and interactive tram

User selected an original animated in-world play and requested interactive tram journeys.

- Add lazy-loaded `theatre.js`: walkable foyer, auditorium, selectable seat, 90-second original captioned play, stage lighting/character movement, opt-in synthesized sound, applause, repeat and exit. This is a fictional interior/production, not an actual Lowry programme or replica.
- Add lazy-loaded `tram.js`: short route journey with carriage seating/view choices, passing district scenery, stop request bell, arrival and explicit disembark. Destination selection now boards instead of teleporting.
- Add shared `experience-ui.js` / `experience.css` and opt-in `sound.js`. Keep normal city movement and trail isolated from experience state. Pause experiences in dialogs/hidden tabs, stop sound on exit, restore the outdoor scene and safe position.
- Validate through normal controls: full entrance → foyer → auditorium → seat → play → bow → replay → exit; tram board → view change → bell → arrival → leave; mobile UI and no console errors. Redeploy the verified update to the existing Cloudflare preview.

## Expanded playable activity scope (9 October)
User requested Lagos Life-style phone/activity discovery and games within the world. Added eight-item phone, local visit journal and tram-linked entry points. Outdoor activities are a 100m stamina/cone run, alternating-oar 100m row and a captioned, pausable fictional Castlefield–Sale canal tour. Preserve all five district activities and original Lowry play. Validate portrait touch flows, completion/reset, safe exits and live static deployment. Multiplayer invitations/group outings remain future work, not simulated users.
