import type { GameType, GameMove, SnapshotStation, StationUiView } from '@arena/shared';
import type { ChallengeService, ChallengeEvent } from '../../ChallengeService.js';
import type { EscrowAdapter } from '../../EscrowAdapter.js';
import type { StationInteractMessage } from '../../websocket/messages.js';
import { computeCoinflipFromSeeds, sha256Hex } from '../../coinflip.js';
import { buildStations } from './catalog.js';
import { COINFLIP_DEALER_METHOD, oppositeCoinflipPick } from './handlers/dealerCoinflip.js';
import { DICE_DUEL_DEALER_METHOD, pickHouseDiceGuess } from './handlers/dealerDiceDuel.js';
import { RPS_DEALER_METHOD, pickHouseRpsMove } from './handlers/dealerRps.js';
import { unsupportedCashierActionView } from './handlers/cashier.js';

type PendingDealerRound = {
  playerId: string;
  stationId: string;
  gameType: GameType;
  wager: number;
  houseSeed: string;
  commitHash: string;
  method: string;
  createdAt: number;
  preflightApproved: boolean;
};

type EscrowFailure = {
  reason: string;
  reasonCode?: string;
  reasonText?: string;
  preflight?: { playerOk: boolean; houseOk: boolean };
};

type StationRouterContext = {
  diceDuelEnabled: boolean;
  stationProximityThreshold: number;
  lastPlayerPos: Map<string, { x: number; z: number }>;
  challengeEscrowTxById: Map<string, { lock?: string; resolve?: string; refund?: string }>;
  challengeEscrowFailureById: Map<string, EscrowFailure>;
  escrowLockedChallenges: Set<string>;
  challengeService: ChallengeService;
  escrowAdapter: EscrowAdapter;
  walletIdFor: (playerId: string) => string | null;
  getHouseWalletId: () => string | null;
  sendTo: (playerId: string, payload: object) => void;
  sendToDistributed: (playerId: string, payload: object) => void;
  registerCreatedChallenge: (event: ChallengeEvent, actorId: string) => Promise<{ ok: boolean; reason?: string }>;
  dispatchChallengeEventWithEscrow: (event: ChallengeEvent) => Promise<void>;
  stationErrorFromEscrowFailure: (input: { reason?: string; raw?: Record<string, unknown> }) => EscrowFailure;
  newSeedHex: (bytes?: number) => string;
};

type StationStartMessage = Extract<StationInteractMessage, { action: 'coinflip_house_start' | 'rps_house_start' | 'dice_duel_start' }>;
type StationPickMessage = Extract<StationInteractMessage, { action: 'coinflip_house_pick' | 'rps_house_pick' | 'dice_duel_pick' }>;

function renderReadyState(gameType: GameType): StationUiView['state'] {
  if (gameType === 'rps') return 'dealer_ready_rps';
  if (gameType === 'dice_duel') return 'dealer_ready_dice';
  return 'dealer_ready';
}

function renderRevealState(gameType: GameType): StationUiView['state'] {
  if (gameType === 'rps') return 'dealer_reveal_rps';
  if (gameType === 'dice_duel') return 'dealer_reveal_dice';
  return 'dealer_reveal';
}

function stationGameType(stationKind: SnapshotStation['kind']): GameType | null {
  if (stationKind === 'dealer_coinflip') return 'coinflip';
  if (stationKind === 'dealer_rps') return 'rps';
  if (stationKind === 'dealer_dice_duel') return 'dice_duel';
  return null;
}

function isStartMessage(payload: StationInteractMessage): payload is StationStartMessage {
  return payload.action === 'coinflip_house_start'
    || payload.action === 'rps_house_start'
    || payload.action === 'dice_duel_start';
}

function isPickMessage(payload: StationInteractMessage): payload is StationPickMessage {
  return payload.action === 'coinflip_house_pick'
    || payload.action === 'rps_house_pick'
    || payload.action === 'dice_duel_pick';
}

function interactionDetailFor(tag: string): { title: string; detail: string; useLabel: string; afterUse: string } {
  switch (tag) {
    case 'atm_terminal':
      return {
        title: 'ATM Terminal',
        detail: 'Quick account and world status terminal.',
        useLabel: 'Run Check',
        afterUse: 'Terminal check complete. No issues detected.'
      };
    case 'train_gate':
      return {
        title: 'Train Gate',
        detail: 'Security gate for platform transit lanes.',
        useLabel: 'Open Gate',
        afterUse: 'Gate cycled open for 10 seconds.'
      };
    case 'vendor_counter':
      return {
        title: 'Vendor Counter',
        detail: 'Fast snack vendor for roleplay interactions.',
        useLabel: 'Order Snack',
        afterUse: 'Order accepted. Vendor is preparing your snack.'
      };
    default:
      return {
        title: 'Info Kiosk',
        detail: 'Local station information and travel tips.',
        useLabel: 'Open Info',
        afterUse: 'Kiosk refreshed with nearby station details.'
      };
  }
}

export function createStationRouter(ctx: StationRouterContext) {
  const stations = buildStations({ diceDuelEnabled: ctx.diceDuelEnabled });
  const stationById = new Map<string, SnapshotStation>(stations.map((station) => [station.id, station]));
  const pendingDealerRounds = new Map<string, PendingDealerRound>();

  function clearPlayer(playerId: string): void {
    pendingDealerRounds.delete(playerId);
  }

  function clearExpired(now = Date.now()): void {
    for (const [dealerPlayerId, round] of pendingDealerRounds) {
      if (now - round.createdAt > 60_000) {
        pendingDealerRounds.delete(dealerPlayerId);
      }
    }
  }

  async function startRound(playerId: string, station: SnapshotStation, payload: StationStartMessage): Promise<void> {
    if (!isStartMessage(payload)) {
      return;
    }
    const gameType = stationGameType(station.kind);
    if (!gameType) {
      return;
    }

    const wager = Math.max(0, Math.min(10_000, Number(payload.wager || 0)));
    const playerWalletId = ctx.walletIdFor(playerId);
    const currentHouseWalletId = ctx.getHouseWalletId();
    if (wager > 0) {
      if (!playerWalletId || !currentHouseWalletId) {
        ctx.sendTo(playerId, {
          type: 'station_ui',
          stationId: station.id,
          view: {
            ok: false,
            state: 'dealer_error',
            reason: 'wallet_required',
            reasonCode: !playerWalletId ? 'PLAYER_SIGNER_UNAVAILABLE' : 'HOUSE_SIGNER_UNAVAILABLE',
            reasonText: !playerWalletId
              ? 'Player wallet not ready for onchain escrow.'
              : 'House wallet unavailable for onchain escrow.',
            preflight: { playerOk: Boolean(playerWalletId), houseOk: Boolean(currentHouseWalletId) }
          }
        });
        return;
      }
      const preflight = await ctx.escrowAdapter.preflightStake({
        challengerWalletId: playerWalletId,
        opponentWalletId: currentHouseWalletId,
        amount: wager
      });
      if (!preflight.ok) {
        ctx.sendTo(playerId, {
          type: 'station_ui',
          stationId: station.id,
          view: {
            ok: false,
            state: 'dealer_error',
            reason: preflight.reason || 'wallet_prepare_failed',
            reasonCode: preflight.reasonCode,
            reasonText: preflight.reasonText,
            preflight: preflight.preflight
          }
        });
        return;
      }
    }

    const houseSeed = ctx.newSeedHex(24);
    const commitHash = sha256Hex(houseSeed);
    const method = gameType === 'coinflip'
      ? COINFLIP_DEALER_METHOD
      : gameType === 'rps'
        ? RPS_DEALER_METHOD
        : DICE_DUEL_DEALER_METHOD;
    pendingDealerRounds.set(playerId, {
      playerId,
      stationId: station.id,
      gameType,
      wager,
      houseSeed,
      commitHash,
      method,
      createdAt: Date.now(),
      preflightApproved: true
    });

    ctx.sendTo(playerId, {
      type: 'station_ui',
      stationId: station.id,
      view: {
        ok: true,
        state: renderReadyState(gameType),
        stationId: station.id,
        wager,
        commitHash,
        method
      }
    });
  }

  async function pickRound(playerId: string, station: SnapshotStation, payload: StationPickMessage): Promise<void> {
    if (!isPickMessage(payload)) {
      return;
    }
    const pending = pendingDealerRounds.get(playerId);
    if (!pending || pending.stationId !== station.id) {
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId: station.id,
        view: { ok: false, state: 'dealer_error', reason: 'dealer_round_not_started' }
      });
      return;
    }
    if (Date.now() - pending.createdAt > 60_000) {
      pendingDealerRounds.delete(playerId);
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId: station.id,
        view: { ok: false, state: 'dealer_error', reason: 'dealer_round_expired' }
      });
      return;
    }

    const wager = Math.max(0, Math.min(10_000, Number(pending.wager || 0)));
    if (wager > 0 && !pending.preflightApproved) {
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId: station.id,
        view: {
          ok: false,
          state: 'dealer_error',
          reason: 'dealer_preflight_required',
          reasonCode: 'RPC_UNAVAILABLE',
          reasonText: 'Run start round again to complete onchain preflight.',
          preflight: { playerOk: false, houseOk: false }
        }
      });
      return;
    }

    const playerPick = payload.pick as GameMove;
    const playerSeed = String(payload.playerSeed || '').trim().slice(0, 96) || ctx.newSeedHex(12);

    ctx.sendTo(playerId, {
      type: 'station_ui',
      stationId: station.id,
      view: {
        ok: true,
        state: 'dealer_dealing',
        stationId: station.id,
        wager,
        playerPick
      }
    });

    const created = ctx.challengeService.createChallenge(playerId, 'system_house', pending.gameType, wager);
    if (created.event !== 'created' || !created.challenge) {
      pendingDealerRounds.delete(playerId);
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId: station.id,
        view: { ok: false, state: 'dealer_error', reason: created.reason || 'challenge_create_failed' }
      });
      return;
    }

    created.challenge.provablyFair = {
      commitHash: pending.commitHash,
      playerSeed,
      method: pending.method
    };

    created.to = [playerId];
    const createdRegistered = await ctx.registerCreatedChallenge(created, playerId);
    if (!createdRegistered.ok) {
      pendingDealerRounds.delete(playerId);
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId: station.id,
        view: {
          ok: false,
          state: 'dealer_error',
          reason: createdRegistered.reason || 'challenge_lock_failed',
          reasonCode: createdRegistered.reason === 'player_busy' ? 'PLAYER_BUSY' : 'CHALLENGE_LOCK_FAILED',
          reasonText: createdRegistered.reason === 'player_busy'
            ? 'You already have a pending/active round. Wait a moment and retry.'
            : 'Challenge lock failed. Please retry.'
        }
      });
      return;
    }

    ctx.sendToDistributed(playerId, {
      type: 'provably_fair',
      phase: 'commit',
      challengeId: created.challenge.id,
      commitHash: pending.commitHash,
      playerSeed,
      method: pending.method
    });

    await ctx.dispatchChallengeEventWithEscrow(created);

    const accepted = ctx.challengeService.respond(created.challenge.id, 'system_house', true);
    accepted.to = [playerId];
    await ctx.dispatchChallengeEventWithEscrow(accepted);

    const locked = wager <= 0 ? true : ctx.escrowLockedChallenges.has(created.challenge.id);
    if (!locked) {
      const escrowFailure = ctx.challengeEscrowFailureById.get(created.challenge.id);
      pendingDealerRounds.delete(playerId);
      ctx.challengeEscrowFailureById.delete(created.challenge.id);
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId: station.id,
        view: {
          ok: false,
          state: 'dealer_error',
          reason: escrowFailure?.reason || 'escrow_lock_failed',
          reasonCode: escrowFailure?.reasonCode,
          reasonText: escrowFailure?.reasonText,
          preflight: escrowFailure?.preflight
        }
      });
      return;
    }

    if (created.challenge.provablyFair) {
      created.challenge.provablyFair.revealSeed = pending.houseSeed;
    }

    ctx.sendToDistributed(playerId, {
      type: 'provably_fair',
      phase: 'reveal',
      challengeId: created.challenge.id,
      commitHash: pending.commitHash,
      playerSeed,
      houseSeed: pending.houseSeed,
      method: pending.method
    });

    let houseMove: GameMove = 'heads';
    if (pending.gameType === 'coinflip') {
      houseMove = oppositeCoinflipPick(playerPick === 'heads' ? 'heads' : 'tails');
      const result = computeCoinflipFromSeeds(pending.houseSeed, playerSeed, created.challenge.id);
      ctx.challengeService.setCoinflipResultOverride(created.challenge.id, result);
    } else if (pending.gameType === 'rps') {
      houseMove = pickHouseRpsMove(pending.houseSeed, playerSeed, created.challenge.id);
    } else {
      houseMove = pickHouseDiceGuess(pending.houseSeed, playerSeed, created.challenge.id);
    }

    const submitted1 = ctx.challengeService.submitMove(created.challenge.id, playerId, playerPick);
    submitted1.to = [playerId];
    await ctx.dispatchChallengeEventWithEscrow(submitted1);

    const submitted2 = ctx.challengeService.submitMove(created.challenge.id, 'system_house', houseMove);
    submitted2.to = [playerId];
    await ctx.dispatchChallengeEventWithEscrow(submitted2);

    const finalChallenge = submitted2.challenge ?? ctx.challengeService.getChallenge(created.challenge.id);
    const winnerId = finalChallenge?.winnerId ?? null;
    const payoutDelta =
      winnerId === playerId ? wager :
      winnerId && winnerId !== playerId ? -wager :
      0;

    ctx.sendTo(playerId, {
      type: 'station_ui',
      stationId: station.id,
      view: {
        ok: true,
        state: renderRevealState(pending.gameType),
        stationId: station.id,
        challengeId: created.challenge.id,
        wager,
        playerPick,
        challengerPick: playerPick,
        opponentPick: houseMove,
        coinflipResult: finalChallenge?.coinflipResult ?? null,
        diceResult: finalChallenge?.diceResult ?? null,
        winnerId,
        payoutDelta,
        commitHash: pending.commitHash,
        method: pending.method,
        escrowTx: ctx.challengeEscrowTxById.get(created.challenge.id) ?? {}
      }
    });

    pendingDealerRounds.delete(playerId);
    ctx.challengeEscrowTxById.delete(created.challenge.id);
    ctx.challengeEscrowFailureById.delete(created.challenge.id);
  }

  async function handleStationInteract(playerId: string, payload: StationInteractMessage): Promise<boolean> {
    const stationId = payload.stationId.trim();
    const station = stationById.get(stationId);
    if (!station) {
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId,
        view: { ok: false, state: 'dealer_error', reason: 'station_not_found' }
      });
      return true;
    }

    const pos = ctx.lastPlayerPos.get(playerId);
    if (!pos) {
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId,
        view: { ok: false, state: 'dealer_error', reason: 'position_unknown' }
      });
      return true;
    }

    const dist = Math.hypot(pos.x - station.x, pos.z - station.z);
    const proximityThreshold = Number.isFinite(Number(station.radius))
      ? Math.max(2, Number(station.radius))
      : ctx.stationProximityThreshold;
    if (dist > proximityThreshold) {
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId,
        view: { ok: false, state: 'dealer_error', reason: 'not_near_station' }
      });
      return true;
    }

    if (station.kind === 'world_interactable') {
      const action = payload.action;
      const tag = String(station.interactionTag || 'info_kiosk');
      const detail = interactionDetailFor(tag);
      if (action === 'interact_open') {
        ctx.sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: {
            ok: true,
            state: 'dealer_ready',
            stationId,
            method: `${detail.title}: ${detail.detail}`,
            reasonText: detail.useLabel,
            reasonCode: tag
          }
        });
        return true;
      }
      if (action === 'interact_use') {
        ctx.sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: {
            ok: true,
            state: 'dealer_reveal',
            stationId,
            method: `${detail.title}: ${detail.afterUse}`,
            reasonText: detail.afterUse,
            reasonCode: tag
          }
        });
        return true;
      }
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId,
        view: { ok: false, state: 'dealer_error', reason: 'invalid_station_action' }
      });
      return true;
    }

    if (station.kind === 'cashier_bank') {
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId,
        view: unsupportedCashierActionView()
      });
      return true;
    }

    const gameType = stationGameType(station.kind);
    if (!gameType) {
      ctx.sendTo(playerId, {
        type: 'station_ui',
        stationId,
        view: { ok: false, state: 'dealer_error', reason: 'invalid_station_kind' }
      });
      return true;
    }

    const startActionByGame: Record<GameType, string> = {
      coinflip: 'coinflip_house_start',
      rps: 'rps_house_start',
      dice_duel: 'dice_duel_start'
    };
    const pickActionByGame: Record<GameType, string> = {
      coinflip: 'coinflip_house_pick',
      rps: 'rps_house_pick',
      dice_duel: 'dice_duel_pick'
    };

    if (isStartMessage(payload)) {
      if (payload.action !== startActionByGame[gameType]) {
        ctx.sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'invalid_station_action' }
        });
        return true;
      }
      await startRound(playerId, station, payload);
      return true;
    }

    if (isPickMessage(payload)) {
      if (payload.action !== pickActionByGame[gameType]) {
        ctx.sendTo(playerId, {
          type: 'station_ui',
          stationId,
          view: { ok: false, state: 'dealer_error', reason: 'invalid_station_action' }
        });
        return true;
      }
      await pickRound(playerId, station, payload);
      return true;
    }

    ctx.sendTo(playerId, {
      type: 'station_ui',
      stationId,
      view: { ok: false, state: 'dealer_error', reason: 'invalid_station_action' }
    });
    return true;
  }

  return {
    stations,
    stationById,
    clearPlayer,
    clearExpired,
    handleStationInteract
  };
}
