# Autoresearch: Dead Code / Unused Exports

## Goal

Eliminate all dead code and unused exports in the codebase.

## Metric

`bash autoresearch-deadcode.sh` → total count of files/lines flagged by [knip](https://knip.dev) (lower is better, goal: 0).

Categories tracked:
- **Unused files** — source files not reachable from any entry point
- **Unused exports** — exported values never imported by any consumer
- **Unused exported types** — exported types never referenced externally

## Baseline

141 TypeScript errors (previous autoresearch) → 0. Then this loop began.

| Iteration | Count | Delta | Change |
|-----------|-------|-------|--------|
| 0 (baseline) | 45 | — | Initial measurement after installing knip and configuring knip.config.ts |
| 1 | 35 | −10 | Removed dead crypto functions; deleted 4 unused files; unexported internal-only helpers |
| 2 | 30 | −5 | Unexported 7 route handlers, 4 migration helpers, 5 security functions; deleted 12 unwired metric hooks; deleted 4 unused cookie functions |
| 3 | 5 | −25 | Unexported all 25 unused exported types across agent-runtime, server, and web |
| 4 | **0** | −5 | Configured knip ignoreDependencies for hoisted scripts deps and dynamic pino transport |

---

## Issue Breakdown (Baseline)

### Unused Files (4)
| File | Note |
|------|------|
| `apps/server/src/middleware/index.ts` | Barrel re-export, never imported |
| `apps/server/src/middleware/rateLimit.ts` | Rate limiting middleware, not wired in |
| `apps/web/src/chief/toolExecutor.ts` | Tool executor, not referenced |
| `apps/web/src/middleware/cache.ts` | Cache middleware, not wired in |

### Unused Exports — Values (22 items across 11 files)
| File | Symbols |
|------|---------|
| `apps/agent-runtime/src/codebaseContext.ts` | `CODEBASE_CONTEXT` |
| `apps/agent-runtime/src/lib/crypto.ts` | `sha256`, `createInternalTokenFromKey` |
| `apps/server/src/game/proximity.ts` | `makePairKey` |
| `apps/server/src/game/stations/catalog.ts` | `STATION_POSITIONS` |
| `apps/server/src/metrics.ts` | `trackHttpRequest`, `startSystemMetricsCollection`, `recordChallengeCreated`, `recordChallengeResolved`, `recordWsConnection`, `recordWsDisconnection`, `recordWsMessage`, `recordEscrowLock`, `recordEscrowResolve`, `recordEscrowRefund`, `recordRateLimitExceeded`, `recordDbQuery` |
| `apps/server/src/middleware/security.ts` | `applySecurityHeaders`, `handleCors`, `addRequestId`, `createRequestSizeLimiter`, `createIpAllowlistMiddleware` |
| `apps/server/src/migrations/index.ts` | `getCurrentVersion`, `isMigrationApplied`, `recordMigration`, `removeMigrationRecord` |
| `apps/server/src/routes/index.ts` | `setCorsHeaders`, `handleHealth`, `handlePresence`, `handleChallengesRecent`, `handleFavicon`, `handleNotFound`, `handleAdminTeleport` |
| `apps/server/src/websocket/auth.ts` | `extractCookie` |
| `apps/server/src/websocket/messages.ts` | `rawToString` |
| `apps/web/src/lib/http.ts` | `parseCookies`, `setSessionCookie`, `setCookie`, `clearCookie` |

### Unused Exported Types (25 items across 19 files)
| File | Types |
|------|-------|
| `apps/agent-runtime/src/PolicyEngine.ts` | `PolicyMemory`, `PolicyDecision` |
| `apps/agent-runtime/src/RuntimeDatabase.ts` | `OwnerBotState`, `RuntimeDbState` |
| `apps/agent-runtime/src/SuperAgent.ts` | `WorkerDirective` |
| `apps/agent-runtime/src/gasPolicy.ts` | `GasSponsorshipPolicy` |
| `apps/agent-runtime/src/lib/cdpClient.ts` | `CdpClientConfig`, `CdpClientConfigured`, `CdpClientState` |
| `apps/agent-runtime/src/lib/http.ts` | `HttpHandler`, `Route` |
| `apps/server/src/ChallengeService.ts` | `ChallengeStatus`, `GameType`, `RpsMove`, `CoinflipMove`, `DiceDuelMove`, `GameMove`, `Challenge`, `ChallengeLog` |
| `apps/server/src/Database.ts` | `MarketInteractionEventRecord` |
| `apps/server/src/EscrowAdapter.ts` | `EscrowResult`, `PoolBetInspection`, `EscrowPreflightReasonCode`, `EscrowPreflightWalletStatus`, `EscrowPreflightResult` |
| `apps/server/src/WorldSim.ts` | `InputState`, `PlayerSnapshot`, `WorldSnapshot` |
| `apps/server/src/game/proximity.ts` | `ProximityPlayer`, `ProximityEvent` |
| `apps/server/src/logger.ts` | `Logger` |
| `apps/server/src/markets/MarketService.ts` | `MarketView`, `QuoteResult`, `SettlementIntegrityIssue`, `SettlementIntegrityRow` |
| `apps/server/src/middleware/security.ts` | `SecurityConfig`, `StartupValidationResult` |
| `apps/server/src/migrations/index.ts` | `Migration` |
| `apps/server/src/websocket/messages.ts` | `InputMessage`, `ChallengeSendMessage`, `ChallengeResponseMessage`, `ChallengeCounterMessage`, `ChallengeMoveMessage`, `ClientMessage` |
| `apps/web/src/chief.ts` | `ChiefActionResult`, `ChiefChatResponse`, `ChiefMetrics` |
| `apps/web/src/chief/dbGateway.ts` | `EconomySummary`, `RuntimeIntegrity` |
| `apps/web/src/chief/memory.ts` | `ChiefMemoryTurn` |
| `apps/web/src/chief/runbooks.ts` | `RunbookPlan`, `RunbookSelection` |
| `apps/web/src/chief/skillRouter.ts` | `SkillRouteResult` |
| `apps/web/src/chief2/ai/provider.ts` | `Chief2AiProvider` |
| `apps/web/src/chief2/core/toolRegistry.ts` | `Chief2PlanSelection` |
| `apps/web/src/identityContinuity.ts` | `ContinuityLink`, `EmailIdentityCandidate` |
| `apps/web/src/sessionStore.ts` | `SessionStore` |
