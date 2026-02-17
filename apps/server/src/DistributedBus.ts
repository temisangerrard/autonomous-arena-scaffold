import { log as rootLog } from './logger.js';

const log = rootLog.child({ module: 'bus' });

type RedisClientLike = {
  connect: () => Promise<unknown>;
  on: (event: 'error', listener: (error: unknown) => void) => void;
  publish: (channel: string, message: string) => Promise<number>;
  subscribe: (channel: string, listener: (message: string) => void) => Promise<void>;
};

type DirectPlayerMessage = {
  playerId: string;
  payload: object;
};

type ChallengeCommand =
  | {
      type: 'challenge_response';
      challengeId: string;
      actorId: string;
      accept: boolean;
    }
  | {
      type: 'challenge_counter';
      challengeId: string;
      actorId: string;
      wager: number;
    }
  | {
      type: 'challenge_move';
      challengeId: string;
      actorId: string;
      move: 'rock' | 'paper' | 'scissors' | 'heads' | 'tails' | 'd1' | 'd2' | 'd3' | 'd4' | 'd5' | 'd6';
    };

type AdminCommand =
  | {
      type: 'admin_teleport';
      playerId: string;
      x: number;
      z: number;
    };

const PLAYER_DIRECT_CHANNEL = 'arena:bus:player:direct';
const COMMAND_CHANNEL_PREFIX = 'arena:bus:challenge:command:';
const ADMIN_CHANNEL_PREFIX = 'arena:bus:admin:command:';

function commandChannel(serverId: string): string {
  return `${COMMAND_CHANNEL_PREFIX}${serverId}`;
}

function adminChannel(serverId: string): string {
  return `${ADMIN_CHANNEL_PREFIX}${serverId}`;
}

export class DistributedBus {
  private publisher: RedisClientLike | null = null;
  private subscriber: RedisClientLike | null = null;

  constructor(
    private readonly serverId: string,
    private readonly onPlayerMessage: (message: DirectPlayerMessage) => void,
    private readonly onCommand: (command: ChallengeCommand) => void,
    private readonly onAdminCommand: (command: AdminCommand) => void
  ) {}

  async connect(redisUrl: string | undefined): Promise<void> {
    if (!redisUrl) {
      return;
    }
    const mod = await import('redis');
    this.publisher = mod.createClient({ url: redisUrl }) as unknown as RedisClientLike;
    this.subscriber = mod.createClient({ url: redisUrl }) as unknown as RedisClientLike;
    this.publisher.on('error', (error) => log.error({ err: error }, 'publisher redis error'));
    this.subscriber.on('error', (error) => log.error({ err: error }, 'subscriber redis error'));
    await this.publisher.connect();
    await this.subscriber.connect();
    await this.subscriber.subscribe(PLAYER_DIRECT_CHANNEL, (raw) => {
      try {
        const payload = JSON.parse(raw) as DirectPlayerMessage;
        if (!payload?.playerId || !payload?.payload) {
          return;
        }
        this.onPlayerMessage(payload);
      } catch {
        // ignore malformed distributed messages
      }
    });
    await this.subscriber.subscribe(commandChannel(this.serverId), (raw) => {
      try {
        const payload = JSON.parse(raw) as ChallengeCommand;
        if (!payload?.type || !payload.challengeId || !payload.actorId) {
          return;
        }
        this.onCommand(payload);
      } catch {
        // ignore malformed commands
      }
    });
    await this.subscriber.subscribe(adminChannel(this.serverId), (raw) => {
      try {
        const payload = JSON.parse(raw) as AdminCommand;
        if (payload?.type !== 'admin_teleport' || !payload.playerId) {
          return;
        }
        this.onAdminCommand(payload);
      } catch {
        // ignore malformed admin commands
      }
    });
    log.info('connected to redis');
  }

  async publishToPlayer(playerId: string, payload: object): Promise<void> {
    if (!this.publisher) {
      return;
    }
    await this.publisher.publish(
      PLAYER_DIRECT_CHANNEL,
      JSON.stringify({ playerId, payload } satisfies DirectPlayerMessage)
    );
  }

  async publishCommand(serverId: string, command: ChallengeCommand): Promise<void> {
    if (!this.publisher) {
      return;
    }
    await this.publisher.publish(commandChannel(serverId), JSON.stringify(command));
  }

  async publishAdminCommand(serverId: string, command: AdminCommand): Promise<void> {
    if (!this.publisher) {
      return;
    }
    await this.publisher.publish(adminChannel(serverId), JSON.stringify(command));
  }
}

export type { AdminCommand, ChallengeCommand };
