import { describe, expect, it, vi } from 'vitest';
import { createStationInteractionsController } from '../public/js/play/runtime/station-interactions.js';

describe('station interactions controller', () => {
  it('marks host stations as quick-play interactions when routing to live dealer stations', () => {
    const send = vi.fn();
    const controller = createStationInteractionsController({
      state: {},
      showToast: vi.fn(),
      getSocket: () => ({
        readyState: WebSocket.OPEN,
        send
      }),
      resolveStationIdForSend: () => 'station_dealer_coinflip_a'
    });

    const sent = controller.sendStationInteract({
      id: 'station_npc_host_3',
      source: 'host',
      kind: 'dealer_coinflip',
      proxyStationId: 'station_dealer_coinflip_a'
    }, 'coinflip_house_start', { wager: 5 });

    expect(sent).toBe(true);
    expect(send).toHaveBeenCalledWith(JSON.stringify({
      type: 'station_interact',
      stationId: 'station_dealer_coinflip_a',
      action: 'coinflip_house_start',
      wager: 5,
      quickPlay: true
    }));
  });

  it('preserves explicit quick-play requests for direct station launches', () => {
    const send = vi.fn();
    const controller = createStationInteractionsController({
      state: {},
      showToast: vi.fn(),
      getSocket: () => ({
        readyState: WebSocket.OPEN,
        send
      }),
      resolveStationIdForSend: () => 'station_dealer_rps_a'
    });

    const sent = controller.sendStationInteract('station_dealer_rps_a', 'rps_house_start', {
      wager: 3,
      quickPlay: true
    });

    expect(sent).toBe(true);
    expect(send).toHaveBeenCalledWith(JSON.stringify({
      type: 'station_interact',
      stationId: 'station_dealer_rps_a',
      action: 'rps_house_start',
      wager: 3,
      quickPlay: true
    }));
  });
});
