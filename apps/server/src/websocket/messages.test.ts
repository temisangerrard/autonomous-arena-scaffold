import { describe, expect, it } from 'vitest';
import { parseClientMessage } from './messages.js';

describe('parseClientMessage station_interact', () => {
  it('accepts dealer start action', () => {
    const parsed = parseClientMessage(
      Buffer.from(
        JSON.stringify({
          type: 'station_interact',
          stationId: 'station_dealer_coinflip',
          action: 'coinflip_house_start',
          wager: 5
        })
      )
    );
    expect(parsed).toEqual({
      type: 'station_interact',
      stationId: 'station_dealer_coinflip',
      action: 'coinflip_house_start',
      wager: 5
    });
  });

  it('accepts dealer pick action', () => {
    const parsed = parseClientMessage(
      Buffer.from(
        JSON.stringify({
          type: 'station_interact',
          stationId: 'station_dealer_coinflip',
          action: 'coinflip_house_pick',
          pick: 'heads',
          playerSeed: 'abcd1234'
        })
      )
    );
    expect(parsed).toEqual({
      type: 'station_interact',
      stationId: 'station_dealer_coinflip',
      action: 'coinflip_house_pick',
      pick: 'heads',
      playerSeed: 'abcd1234'
    });
  });

  it('rejects invalid station action', () => {
    const parsed = parseClientMessage(
      Buffer.from(
        JSON.stringify({
          type: 'station_interact',
          stationId: 'station_dealer_coinflip',
          action: 'coinflip_house',
          wager: 5
        })
      )
    );
    expect(parsed).toBeNull();
  });
});
