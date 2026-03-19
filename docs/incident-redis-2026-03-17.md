# Incident: Redis URL mismatch — 2026-03-17

**Status:** Resolved
**Duration:** ~5h (approx 16:00–21:40 UTC)
**Impact:** All API endpoints returning 503/504 — `/onboarding`, `/bootstrap`, `/worlds`, `/playable`, WebSocket unavailable.

---

## Root cause

`REDIS_URL` on `arena-server-broken-haze-6531` and `arena-web` was set to a **Railway Redis** URL (`shortline.proxy.rlwy.net:46165`). Railway's proxy closes connections from Fly.io's network immediately (TCP handshakes succeed, but the server returns 0 bytes and closes before any AUTH response).

Both servers call `await presenceStore.connect(redisUrl)` (and `distributedBus.connect`, `distributedChallengeStore.connect`) **before** `server.listen()`. With the Redis connection stuck in an infinite reconnect loop, the HTTP port was never bound — Fly health checks went critical and Fly's proxy refused all inbound traffic.

The Fly Upstash Redis instance (`arena-web-redis`) was healthy the entire time. Tested from inside the Fly private network: AUTH + PING returned `+OK +PONG` in under 100ms.

---

## Timeline

| Time (UTC) | Event |
|---|---|
| ~16:00 | `REDIS_URL` changed (direct `fly secrets set`) to Railway URL — machines restart |
| 16:04 | `arena-server` TCP health checks go critical (`connection refused` on port 4000) |
| 16:54 | `arena-web` TCP health checks go critical (`gone` on port 3000) |
| 18:12 | Spectacle-first arena commit pushed — Netlify deploy succeeds, backend unaffected |
| 21:37 | `REDIS_URL` corrected to Fly Upstash private URL on both apps |
| 21:38 | All 4 machines pass health checks, endpoints return 200 |

---

## Fix

```bash
REDIS_URL="redis://default:<password>@fly-arena-web-redis.upstash.io:6379"

fly secrets set REDIS_URL="$REDIS_URL" --app arena-server-broken-haze-6531
fly secrets set REDIS_URL="$REDIS_URL" --app arena-web
```

Get the current correct URL at any time with:

```bash
fly redis status arena-web-redis
# shows: Private URL = redis://default:<password>@fly-arena-web-redis.upstash.io:6379
```

---

## Key diagnostic commands (for future incidents)

```bash
# Check health of all machines
fly status --app arena-server-broken-haze-6531
fly status --app arena-web

# Stream logs (Redis errors = startup blocked)
fly logs --app arena-server-broken-haze-6531 --no-tail | tail -50

# SSH into a machine and check if the port is actually bound
fly ssh console --app arena-server-broken-haze-6531 --machine <ID> \
  -C "sh -c 'netstat -ln'"
# Port 4000 absent = server stuck in startup (usually Redis)

# Test Redis connectivity from inside Fly network
fly ssh console --app arena-server-broken-haze-6531 --machine <ID> \
  -C "sh -c 'nc -z fly-arena-web-redis.upstash.io 6379; echo rc=$?'"

# Check actual REDIS_URL value inside a machine (password redacted)
fly ssh console --app arena-server-broken-haze-6531 --machine <ID> \
  -C "sh -c 'node -e \"console.log(process.env.REDIS_URL.replace(/:[^:@]+@/, /:PASS@/))\"'"
```

---

## Prevention

- `REDIS_URL` on Fly.io **must** use the Fly private URL (`fly-arena-web-redis.upstash.io`), not a public/Railway URL. Railway closes connections from Fly's network.
- If migrating Redis providers, test connectivity from inside the Fly network **before** updating the secret.
- The Fly private URL is shown in `fly redis status arena-web-redis` and is the authoritative source.
- Both `arena-server` and `arena-web` must have matching `REDIS_URL` values — they share the same Fly Upstash instance.
