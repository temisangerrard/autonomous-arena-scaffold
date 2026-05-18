# Cloudflare Backend Cutover

This repo now includes a dedicated Worker project at `apps/cloudflare-backend`.

## Purpose

The Worker becomes the single backend origin Netlify points to:

- `/api/*` proxies to the current web backend
- `/runtime/*` is now hosted directly in the Worker on top of D1
- scheduled bot turns run from a Worker cron trigger against the existing station server
- `/health` reports Worker-level aggregated upstream health

This keeps the frontend on Netlify while moving runtime-owned state and bot scheduling onto Cloudflare.

## Local dev

1. Copy `apps/cloudflare-backend/.dev.vars.example` to `apps/cloudflare-backend/.dev.vars`.
2. Point `WEB_UPSTREAM` at the local web backend and `SERVER_UPSTREAM` at the local game server.
3. Create a D1 database and bind it as `STATE_DB`.
3. Run `npm run dev:cf`.

## Deploy

1. Install dependencies so local `wrangler` is available.
2. Authenticate with Cloudflare using `npx wrangler login` or ensure existing auth is present.
3. Create the D1 database:
   - `wrangler d1 create arena-runtime-state`
4. Copy the returned database id into `apps/cloudflare-backend/wrangler.jsonc`.
5. Set Worker vars and secrets:
   - `WEB_UPSTREAM`
   - `SERVER_UPSTREAM`
   - `INTERNAL_SERVICE_TOKEN`
6. Run `npm run deploy:cf`.

## Netlify integration

`scripts/netlify-build.mjs` now routes both `/api/*` and `/runtime/*` through `ARENA_BACKEND_ORIGIN`, which should be the Cloudflare Worker URL after deploy.

## Remaining work

- Point `arena-web` and `arena-server` at the Worker-hosted runtime routes.
- Remove the `arena-agent-runtime` Fly app after parity verification.
- Move the remaining web BFF and station backend off Fly.
- After that, migrate the database off Fly Postgres and delete the remaining Fly apps.
