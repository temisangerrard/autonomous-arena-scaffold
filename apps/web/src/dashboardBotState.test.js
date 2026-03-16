import { describe, expect, it } from 'vitest';
import {
  deriveDashboardBotState,
  formatDashboardBotSubtitle
} from '../public/js/dashboard-bot-state.js';

describe('dashboard bot state labels', () => {
  it('shows autoplay armed for an offline bot with autoplay enabled', () => {
    const state = deriveDashboardBotState({
      connected: false,
      behavior: {
        autoplay: {
          enabled: true
        }
      },
      meta: {
        controlState: 'idle_offline'
      }
    });

    expect(state.statusText).toBe('Autoplay armed');
    expect(state.autoplayText).toBe('Autoplay on');
  });

  it('shows human controlling while the owner is online', () => {
    const state = deriveDashboardBotState({
      connected: false,
      behavior: {
        autoplay: {
          enabled: true
        }
      },
      meta: {
        controlState: 'human_active'
      }
    });

    expect(state.statusText).toBe('Human controlling');
  });

  it('shows bot roaming when the owner bot is active offline', () => {
    const state = deriveDashboardBotState({
      connected: true,
      behavior: {
        autoplay: {
          enabled: true
        }
      },
      meta: {
        controlState: 'bot_active'
      }
    });

    expect(state.statusClass).toBe('active');
    expect(state.statusText).toBe('Bot roaming');
  });

  it('formats the modal subtitle with patrol and autoplay state', () => {
    expect(formatDashboardBotSubtitle({
      id: 'agent_profile_3',
      behavior: {
        autoplay: {
          enabled: true
        }
      },
      meta: {
        patrolSection: 4,
        controlState: 'idle_offline'
      }
    })).toContain('patrol S5');
  });
});
