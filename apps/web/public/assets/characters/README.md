# NPC Character Assets

Place the 8 production NPC GLB files in this folder:

- `npc_01.glb`
- `npc_02.glb`
- `npc_03.glb`
- `npc_04.glb`
- `npc_05.glb`
- `npc_06.glb`
- `npc_07.glb`
- `npc_08.glb`

Each file should include animation clips named:

- `idle`
- `walk`
- `attack`
- `hurt`
- `death`

Runtime behavior:

- Static section NPCs (`agent_bg_*`) load these models deterministically by id.
- If a model is missing or fails to load, the client falls back to the procedural avatar.
