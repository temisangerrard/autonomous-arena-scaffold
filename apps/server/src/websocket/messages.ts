/**
 * WebSocket message types and parsing utilities
 */
import type { RawData } from 'ws';
import type { GameMove, GameType } from '@arena/shared';

// Client message types
export type InputMessage = {
  type: 'input';
  moveX: number;
  moveZ: number;
};

export type StationInteractMessage = {
  type: 'station_interact';
  stationId: string;
} & (
  | {
      action: 'coinflip_house_start';
      wager: number;
    }
  | {
      action: 'coinflip_house_pick';
      pick: 'heads' | 'tails';
      playerSeed: string;
    }
);

export type ChallengeSendMessage = {
  type: 'challenge_send';
  targetId: string;
  gameType: GameType;
  wager: number;
};

export type ChallengeResponseMessage = {
  type: 'challenge_response';
  challengeId: string;
  accept: boolean;
};

export type ChallengeCounterMessage = {
  type: 'challenge_counter';
  challengeId: string;
  wager: number;
};

export type ChallengeMoveMessage = {
  type: 'challenge_move';
  challengeId: string;
  move: GameMove;
};

export type ClientMessage =
  | InputMessage
  | StationInteractMessage
  | ChallengeSendMessage
  | ChallengeResponseMessage
  | ChallengeCounterMessage
  | ChallengeMoveMessage;

/**
 * Convert raw WebSocket data to string
 */
export function rawToString(raw: RawData): string {
  if (typeof raw === 'string') {
    return raw;
  }
  if (raw instanceof Buffer) {
    return raw.toString('utf8');
  }
  if (Array.isArray(raw)) {
    return Buffer.concat(raw).toString('utf8');
  }
  if (raw instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(raw)).toString('utf8');
  }
  return '';
}

/**
 * Parse a client message from raw WebSocket data
 */
export function parseClientMessage(raw: RawData): ClientMessage | null {
  try {
    const payload = JSON.parse(rawToString(raw)) as Record<string, unknown>;

    if (
      payload.type === 'input' &&
      typeof payload.moveX === 'number' &&
      typeof payload.moveZ === 'number'
    ) {
      return {
        type: 'input',
        moveX: payload.moveX,
        moveZ: payload.moveZ
      };
    }

    if (
      payload.type === 'station_interact' &&
      typeof payload.stationId === 'string'
    ) {
      if (payload.action === 'coinflip_house_start') {
        return {
          type: 'station_interact',
          stationId: payload.stationId,
          action: 'coinflip_house_start',
          wager: typeof payload.wager === 'number' ? payload.wager : 1
        };
      }
      if (
        payload.action === 'coinflip_house_pick' &&
        typeof payload.pick === 'string' &&
        (payload.pick === 'heads' || payload.pick === 'tails') &&
        typeof payload.playerSeed === 'string'
      ) {
        return {
          type: 'station_interact',
          stationId: payload.stationId,
          action: 'coinflip_house_pick',
          pick: payload.pick,
          playerSeed: payload.playerSeed
        };
      }
    }

    if (
      payload.type === 'challenge_send' &&
      typeof payload.targetId === 'string' &&
      (payload.gameType === 'rps' || payload.gameType === 'coinflip')
    ) {
      return {
        type: 'challenge_send',
        targetId: payload.targetId,
        gameType: payload.gameType,
        wager: typeof payload.wager === 'number' ? payload.wager : 1
      };
    }

    if (
      payload.type === 'challenge_response' &&
      typeof payload.challengeId === 'string' &&
      typeof payload.accept === 'boolean'
    ) {
      return {
        type: 'challenge_response',
        challengeId: payload.challengeId,
        accept: payload.accept
      };
    }

    if (
      payload.type === 'challenge_counter' &&
      typeof payload.challengeId === 'string'
    ) {
      return {
        type: 'challenge_counter',
        challengeId: payload.challengeId,
        wager: typeof payload.wager === 'number' ? payload.wager : 1
      };
    }

    if (
      payload.type === 'challenge_move' &&
      typeof payload.challengeId === 'string' &&
      (payload.move === 'rock' ||
        payload.move === 'paper' ||
        payload.move === 'scissors' ||
        payload.move === 'heads' ||
        payload.move === 'tails')
    ) {
      return {
        type: 'challenge_move',
        challengeId: payload.challengeId,
        move: payload.move
      };
    }

    return null;
  } catch {
    return null;
  }
}
