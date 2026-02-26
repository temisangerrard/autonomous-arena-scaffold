# Security Fixes Progress Report

**Date:** February 24, 2026
**Status:** IN PROGRESS (5/18 critical & major tasks completed)

## ✅ COMPLETED FIXES

### 1. Secrets Rotation & Documentation
**Status:** ✅ DONE
**Files Changed:**
- `.env` - Cleaned all production secrets
- `SECURITY_ROTATION_REQUIRED.md` - Comprehensive rotation guide created

**Actions Required by You:**
- [ ] **CRITICAL:** Transfer any funds from compromised wallet address (redacted)
- [ ] Rotate all secrets per SECURITY_ROTATION_REQUIRED.md
- [ ] Generate new private keys: `openssl rand -hex 32` (3 times for deployer, escrow, gas)
- [ ] Generate new WALLET_ENCRYPTION_KEY: `openssl rand -hex 32`
- [ ] Generate new INTERNAL_SERVICE_TOKEN: `openssl rand -hex 32` (prefix with `sa_`)
- [ ] Rotate OpenRouter API key
- [ ] Rotate Fly.io API token
- [ ] Rotate Railway database password

---

### 2. Wallet Encryption Key Security
**Status:** ✅ DONE
**Files Changed:**
- `apps/agent-runtime/src/index.ts` (lines 105-124)
- `apps/server/src/middleware/security.ts` (lines 208-214)

**What Fixed:**
- Production now **requires** WALLET_ENCRYPTION_KEY (no fallback to default)
- Min 32 characters enforced
- Server exits immediately if not set properly in production

**Test:**
```bash
NODE_ENV=production npm run -w @arena/agent-runtime start
# Should fail with: "WALLET_ENCRYPTION_KEY is required in production"
```

---

### 3. Private Key Separation
**Status:** ✅ DONE
**Files Changed:**
- `apps/agent-runtime/src/index.ts` (line 116-122)

**What Fixed:**
- Removed fallback where GAS_FUNDING_PRIVATE_KEY used ESCROW_RESOLVER_PRIVATE_KEY
- Production now requires separate keys for each role
- Server exits if gas funding key not set when onchain enabled

---

### 4. Internal Service Token Security
**Status:** ✅ DONE
**Files Changed:**
- `apps/agent-runtime/src/index.ts` (lines 209-218)
- `apps/server/src/config.ts` (lines 103-114)
- `apps/web/src/server.ts` (lines 20-30)

**What Fixed:**
- Removed derivation from private keys (was predictable)
- Now **requires** explicit INTERNAL_SERVICE_TOKEN
- No more `sa_${hash(privateKey)}` pattern

---

### 5. CORS Security
**Status:** ✅ DONE
**Files Changed:**
- `apps/server/src/middleware/security.ts` (lines 42-62)
- `apps/agent-runtime/src/lib/http.ts` (lines 11-43)
- `apps/server/src/routes/index.ts` (lines 30-62)
- `.env.example` (added CORS_ALLOWED_ORIGINS)

**What Fixed:**
- Removed wildcard `*` CORS origins
- Now uses explicit whitelist from `CORS_ALLOWED_ORIGINS` env var
- Development: defaults to localhost ports
- Production: requires explicit configuration or denies all

**Set in production:**
```bash
CORS_ALLOWED_ORIGINS=https://yourgame.com,https://www.yourgame.com,https://app.yourgame.com
```

---

## 🔧 REMAINING CRITICAL & MAJOR FIXES (13 tasks)

### 6. Payment Security Pre-Flight Validation
**Priority:** CRITICAL
**Location:** `apps/server/src/index.ts` (challenge_send handler)
**Issue:** Wallet balance not validated BEFORE challenge creation

**What Needs Fixing:**
- Add balance check before `challengeService.createChallenge()`
- Validate wager ≤ 5% of wallet balance
- Add daily wager limit per user
- Add double-spend protection
- Move preflight BEFORE challenge creation (not after)

**Example Fix:**
```typescript
// BEFORE creating challenge:
const challengerWallet = await getWallet(challengerWalletId);
const opponentWallet = await getWallet(opponentWalletId);

if (challengerWallet.balance < wager) {
  return sendTo(playerId, { type: 'challenge', event: 'invalid', reason: 'insufficient_balance' });
}

const maxBet = Math.min(challengerWallet.balance, opponentWallet.balance) * 0.05;
if (wager > maxBet) {
  return sendTo(playerId, { type: 'challenge', event: 'invalid', reason: 'wager_too_high' });
}

// Then create challenge...
```

---

### 7. Database Credential Exposure
**Priority:** MAJOR
**Location:** `.env`, `apps/server/src/Database.ts`

**What Needs Fixing:**
- Add `?sslmode=require` to all Postgres connection strings
- Update .env.example to show SSL format
- Add validation to require SSL in production

**Example:**
```
DATABASE_URL=postgresql://user:pass@host:5432/db?sslmode=require
```

---

### 8. Challenge Rate Limiting
**Priority:** MAJOR
**Location:** `apps/server/src/middleware/rateLimit.ts`, challenge handler

**Current:** 30 challenges/minute per user (too high)
**Fix To:** 5 challenges/minute per user

**Add:**
- Per-player cooldown (30 seconds between challenges)
- Exponential backoff for repeated failures
- Log violations for pattern detection

---

### 9. Admin Audit Logging
**Priority:** MAJOR
**Location:** `apps/server/src/routes/index.ts` (admin teleport, etc)

**What Needs Fixing:**
- Create `audit_log` database table
- Log all admin actions with: admin ID, target, action, params, timestamp, IP
- Add audit log viewer endpoint

**Migration Needed:**
```sql
CREATE TABLE audit_log (
  id SERIAL PRIMARY KEY,
  admin_id TEXT NOT NULL,
  target_id TEXT,
  action TEXT NOT NULL,
  params JSONB,
  ip_address TEXT,
  timestamp TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_audit_log_admin ON audit_log(admin_id);
CREATE INDEX idx_audit_log_timestamp ON audit_log(timestamp DESC);
```

---

### 10. Require Redis for Production Sessions
**Priority:** MAJOR
**Location:** `apps/web/src/sessionStore.ts`, security validation

**What Needs Fixing:**
- Add REDIS_URL to required env vars in startupValidation
- Remove file-based fallback when `isProduction=true`
- Add Redis health check on startup

---

### 11. WebSocket Rate Limiting
**Priority:** MAJOR
**Location:** `apps/server/src/index.ts` (WebSocket message handler, line ~810)

**What Needs Fixing:**
- Add per-connection message queue with rate limit
- Limit: 10 messages/second per player
- Limit: 1 challenge_send per 2 seconds
- Drop excess messages and log violations
- Close connection if sustained abuse

**Example:**
```typescript
const wsRateLimiters = new Map<string, { messages: number[], lastReset: number }>();

ws.on('message', async (raw) => {
  const now = Date.now();
  const limiter = wsRateLimiters.get(playerId) ?? { messages: [], lastReset: now };

  // Remove messages older than 1 second
  limiter.messages = limiter.messages.filter(t => now - t < 1000);

  if (limiter.messages.length >= 10) {
    log.warn({ playerId }, 'WebSocket rate limit exceeded');
    return; // Drop message
  }

  limiter.messages.push(now);
  wsRateLimiters.set(playerId, limiter);

  // Process message...
});
```

---

### 12. Content Security Policy
**Priority:** MAJOR
**Location:** `apps/server/src/middleware/security.ts` (line 43)

**Current CSP:**
```
script-src 'self' 'unsafe-inline' 'unsafe-eval'
```

**Fix To:**
```
script-src 'self'
```

**Actions:**
- Remove `'unsafe-inline'` and `'unsafe-eval'`
- Implement nonce-based inline scripts if needed
- Add `frame-ancestors 'none'`
- Test all pages still work

---

### 13. Display Name Input Validation
**Priority:** MEDIUM
**Location:** `apps/server/src/index.ts` (WebSocket connect, line ~698)

**What Needs Fixing:**
- Regex validation: alphanumeric + spaces + dashes only
- Max 32 characters
- Reject if matches admin usernames
- HTML encode in all responses

**Example:**
```typescript
function validateDisplayName(name: string): string | null {
  if (!name || name.length > 32) return null;
  if (!/^[a-zA-Z0-9\s\-]+$/.test(name)) return null;
  if (['admin', 'system', 'bot'].includes(name.toLowerCase())) return null;
  return name;
}
```

---

### 14. Orphaned Escrow Recovery
**Priority:** MEDIUM
**Location:** New file needed: `apps/server/src/EscrowRecoveryWorker.ts`

**What Needs Fixing:**
- Scan database for pending escrows on startup
- Run recovery job every 5 minutes
- Auto-refund escrows older than 24 hours
- Query contract to verify state
- Log all recovery actions

---

### 15. Self-Challenge Prevention
**Priority:** MEDIUM
**Location:** `apps/server/src/index.ts` (challenge_send handler)

**What Needs Fixing:**
```typescript
if (payload.type === 'challenge_send') {
  if (playerId === payload.targetId) {
    sendTo(playerId, {
      type: 'challenge',
      event: 'invalid',
      reason: 'cannot_challenge_self'
    });
    return;
  }
  // Continue...
}
```

---

### 16. Error Message Security
**Priority:** MEDIUM
**Location:** Multiple files (EscrowAdapter.ts, etc)

**What Needs Fixing:**
- Remove wallet IDs from user-facing errors
- Use generic labels ("Player", "House")
- Log detailed errors server-side only
- Return error codes instead of verbose messages

---

### 17. Graceful Shutdown Handlers
**Priority:** MEDIUM
**Location:** All services (server, web, agent-runtime)

**What Needs Fixing:**
- Add SIGTERM and SIGINT handlers
- Stop accepting new connections
- Wait for in-flight requests (30s timeout)
- Close database connections
- Finalize pending escrows

**Example:**
```typescript
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed');
  });

  await database.close();
  await presenceStore.close();

  setTimeout(() => {
    console.error('Forced shutdown after timeout');
    process.exit(1);
  }, 30000);
});
```

---

### 18. Remove .env from Git History
**Priority:** CRITICAL
**Location:** Git repository

**What Needs Fixing:**
```bash
# After rotating ALL secrets, run:
brew install bfg
bfg --delete-files .env
git reflog expire --expire=now --all
git gc --prune=now --aggressive
git push origin --force --all
git push origin --force --tags
```

**WARNING:** This rewrites history. Coordinate with all team members.

---

## SUMMARY

**Completed:** 5/18 tasks (28%)
**Remaining:** 13 tasks
**Est. Time:** 8-12 hours for remaining fixes
**Est. Testing:** 4-6 hours

**Next Steps:**
1. Complete remaining 13 code fixes (continue now)
2. Run full test suite to verify no regressions
3. Test production startup with new validations
4. Rotate all secrets per SECURITY_ROTATION_REQUIRED.md
5. Remove .env from git history
6. Deploy to staging for validation
7. Security audit of fixes before production launch

**Still Missing (Not in 18 tasks):**
- Legal documents (Terms, Privacy Policy, etc)
- Age verification system
- KYC/AML compliance
- Responsible gaming tools
- Transaction finality verification (3+ blocks)
- Metrics/observability
- Database backup strategy

---

**Last Updated:** 2026-02-24
**Status:** Active development - continue with remaining tasks
