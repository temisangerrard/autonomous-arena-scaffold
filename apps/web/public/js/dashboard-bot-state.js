export function isAutoplayEnabled(bot) {
  return Boolean(bot?.behavior?.autoplay?.enabled);
}

export function deriveDashboardBotState(bot) {
  const controlMode = String(bot?.controlMode || bot?.meta?.controlState || '').trim().toLowerCase();
  const autoplayEnabled = isAutoplayEnabled(bot);

  if (controlMode === 'human_active') {
    return {
      statusClass: 'idle',
      statusText: 'Human controlling',
      autoplayText: autoplayEnabled ? 'Autoplay on' : 'Autoplay off'
    };
  }
  if (controlMode === 'bot_active') {
    return {
      statusClass: 'active',
      statusText: 'Bot roaming',
      autoplayText: autoplayEnabled ? 'Autoplay on' : 'Autoplay off'
    };
  }
  if (controlMode === 'idle_offline' && autoplayEnabled) {
    return {
      statusClass: 'idle',
      statusText: 'Autoplay armed',
      autoplayText: 'Autoplay on'
    };
  }
  if (controlMode === 'idle_offline') {
    return {
      statusClass: 'idle',
      statusText: 'Bot paused',
      autoplayText: 'Autoplay off'
    };
  }
  if (!bot?.connected && autoplayEnabled) {
    return {
      statusClass: 'idle',
      statusText: 'Autoplay armed',
      autoplayText: 'Autoplay on'
    };
  }
  if (!bot?.connected) {
    return {
      statusClass: 'disconnected',
      statusText: 'Disconnected',
      autoplayText: autoplayEnabled ? 'Autoplay on' : 'Autoplay off'
    };
  }
  if (bot?.behavior?.mode === 'passive' || bot?.behavior?.challengeEnabled === false) {
    return {
      statusClass: 'idle',
      statusText: 'Idle',
      autoplayText: autoplayEnabled ? 'Autoplay on' : 'Autoplay off'
    };
  }
  return {
    statusClass: 'active',
    statusText: 'Active',
    autoplayText: autoplayEnabled ? 'Autoplay on' : 'Autoplay off'
  };
}

export function formatDashboardBotSubtitle(bot) {
  const state = deriveDashboardBotState(bot);
  const section = typeof bot?.meta?.patrolSection === 'number' ? `S${bot.meta.patrolSection + 1}` : '-';
  return `${String(bot?.id || 'bot')} · patrol ${section} · ${state.statusText.toLowerCase()} · ${state.autoplayText.toLowerCase()}`;
}
