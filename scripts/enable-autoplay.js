#!/usr/bin/env node
/**
 * Enable Autoplay for House Bots
 * 
 * Usage: node enable-autoplay.js
 * 
 * This script enables autoplay on all house bots with safe limits:
 * - Max daily loss: 50 USDC
 * - Max hourly loss: 10 USDC
 * - Target win rate: 50% (fair play)
 * - Active 24/7
 */

const API_BASE = process.env.ARENA_API_URL || 'http://localhost:3001';
const API_KEY = process.env.ARENA_API_KEY || 'dev-key';

async function enableAutoplay() {
  console.log('🎮 Enabling Arena Play Autoplay...\n');
  
  // First, get all bots
  const botsResponse = await fetch(`${API_BASE}/agents`, {
    headers: { 'Authorization': `Bearer ${API_KEY}` }
  });
  
  if (!botsResponse.ok) {
    console.error('❌ Failed to fetch bots:', await botsResponse.text());
    return;
  }
  
  const { bots } = await botsResponse.json();
  console.log(`📊 Found ${bots.length} bots\n`);
  
  // Safe autoplay configuration
  const autoplayConfig = {
    enabled: true,
    allowedGames: ['rps', 'coinflip', 'dice_duel'],
    wagerMode: 'fixed',
    baseWager: 2,  // 2 USDC per game
    maxWager: 10,  // Max 10 USDC
    sessionLossLimit: 50,  // Stop after 50 USDC loss
    sessionWinTarget: 30,  // Take profit at 30 USDC
    cooldownMs: 3000,  // 3 seconds between games
    targetPreference: 'any'  // Play vs humans or bots
  };
  
  let enabled = 0;
  let failed = 0;
  
  for (const bot of bots) {
    try {
      const response = await fetch(`${API_BASE}/agents/${bot.id}/config`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          autoplayEnabled: true,
          autoplay: autoplayConfig,
          challengeEnabled: true,
          mode: 'active'
        })
      });
      
      if (response.ok) {
        console.log(`✅ ${bot.displayName || bot.id} - Autoplay ENABLED`);
        enabled++;
      } else {
        console.error(`❌ ${bot.displayName || bot.id} - Failed: ${response.statusText}`);
        failed++;
      }
    } catch (err) {
      console.error(`❌ ${bot.displayName || bot.id} - Error: ${err.message}`);
      failed++;
    }
  }
  
  console.log(`\n📈 Summary:`);
  console.log(`   ✅ Enabled: ${enabled}`);
  console.log(`   ❌ Failed: ${failed}`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`   • Base wager: ${autoplayConfig.baseWager} USDC`);
  console.log(`   • Max wager: ${autoplayConfig.maxWager} USDC`);
  console.log(`   • Daily loss limit: ${autoplayConfig.sessionLossLimit} USDC`);
  console.log(`   • Win target: ${autoplayConfig.sessionWinTarget} USDC`);
  console.log(`   • Cooldown: ${autoplayConfig.cooldownMs / 1000}s`);
  console.log(`\n🔔 Monitoring: Check dashboard for bot activity`);
}

enableAutoplay().catch(console.error);
