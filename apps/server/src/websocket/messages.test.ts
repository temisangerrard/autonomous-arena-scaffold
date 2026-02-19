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

  it('accepts rps and dice dealer actions', () => {
    const rpsStart = parseClientMessage(
      Buffer.from(
        JSON.stringify({
          type: 'station_interact',
          stationId: 'station_dealer_rps_a',
          action: 'rps_house_start',
          wager: 3
        })
      )
    );
    expect(rpsStart).toEqual({
      type: 'station_interact',
      stationId: 'station_dealer_rps_a',
      action: 'rps_house_start',
      wager: 3
    });

    const dicePick = parseClientMessage(
      Buffer.from(
        JSON.stringify({
          type: 'station_interact',
          stationId: 'station_dealer_dice_a',
          action: 'dice_duel_pick',
          pick: 'd4',
          playerSeed: 'seed'
        })
      )
    );
    expect(dicePick).toEqual({
      type: 'station_interact',
      stationId: 'station_dealer_dice_a',
      action: 'dice_duel_pick',
      pick: 'd4',
      playerSeed: 'seed'
    });
  });

  it('accepts prediction station actions', () => {
    const open = parseClientMessage(
      Buffer.from(
        JSON.stringify({
          type: 'station_interact',
          stationId: 'station_dealer_prediction_a',
          action: 'prediction_markets_open'
        })
      )
    );
    expect(open).toEqual({
      type: 'station_interact',
      stationId: 'station_dealer_prediction_a',
      action: 'prediction_markets_open'
    });

    const quote = parseClientMessage(
      Buffer.from(
        JSON.stringify({
          type: 'station_interact',
          stationId: 'station_dealer_prediction_a',
          action: 'prediction_market_quote',
          marketId: 'poly_1',
          side: 'yes',
          stake: 5
        })
      )
    );
    expect(quote).toEqual({
      type: 'station_interact',
      stationId: 'station_dealer_prediction_a',
      action: 'prediction_market_quote',
      marketId: 'poly_1',
      side: 'yes',
      stake: 5
    });
  });
});
