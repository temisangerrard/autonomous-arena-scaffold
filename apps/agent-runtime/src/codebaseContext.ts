/**
 * Static codebase context for Super Agent
 * This provides the Super Agent with knowledge about the application structure
 * to help diagnose issues and assist operators.
 */

export const CODEBASE_CONTEXT = {
  name: 'Autonomous Agent Betting Arena',
  version: '1.0.0',
  
  architecture: {
    description: 'Multi-service architecture with web frontend, game server, and agent runtime',
    services: [
      {
        name: 'web',
        port: 3000,
        description: 'Frontend web server handling authentication, profiles, and static assets',
        responsibilities: [
          'Google OAuth and local auth',
          'Session management',
          'Player profile provisioning',
          'Wallet management API proxy',
          'Static file serving'
        ],
        keyFiles: [
          'apps/web/src/server.ts - Main HTTP server with auth routes',
          'apps/web/public/js/play.js - Game client with 3D world rendering',
          'apps/web/public/js/dashboard.js - Player dashboard for wallet/bot management'
        ]
      },
      {
        name: 'server',
        port: 4000,
        description: 'Game server handling real-time gameplay via WebSocket',
        responsibilities: [
          'WebSocket connections for players and agents',
          'World simulation and player movement',
          'Challenge creation and resolution',
          'Proximity detection between players',
          'Escrow integration for wagers',
          'Distributed presence and challenge state'
        ],
        keyFiles: [
          'apps/server/src/index.ts - Main WebSocket server',
          'apps/server/src/ChallengeService.ts - Challenge state machine',
          'apps/server/src/WorldSim.ts - Player movement simulation',
          'apps/server/src/EscrowAdapter.ts - Blockchain escrow integration'
        ]
      },
      {
        name: 'agent-runtime',
        port: 4100,
        description: 'Agent runtime managing AI bots and Super Agent',
        responsibilities: [
          'Bot lifecycle management',
          'Super Agent orchestration',
          'Wallet management (runtime and onchain)',
          'Profile and bot provisioning',
          'House bank management',
          'NPC budget distribution'
        ],
        keyFiles: [
          'apps/agent-runtime/src/index.ts - Main runtime server',
          'apps/agent-runtime/src/SuperAgent.ts - Super Agent configuration',
          'apps/agent-runtime/src/AgentBot.ts - Individual bot implementation',
          'apps/agent-runtime/src/PolicyEngine.ts - Bot behavior policies'
        ]
      }
    ]
  },
  
  dataFlow: {
    authentication: [
      '1. User visits /welcome',
      '2. Google OAuth or local auth at /api/auth/google or /api/auth/local',
      '3. Web server creates session, provisions profile via agent-runtime',
      '4. Profile gets wallet and bot automatically created',
      '5. User redirected to /dashboard'
    ],
    gameplay: [
      '1. User clicks "Enter Arena" from dashboard',
      '2. Play page fetches /api/player/me for profile + wsAuth token',
      '3. WebSocket connects to game server with wsAuth token',
      '4. Player receives snapshot updates at 20fps',
      '5. Proximity events trigger challenge options',
      '6. Challenges resolved via ChallengeService',
      '7. Escrow locks stakes, resolves to winner'
    ],
    offlinePlay: [
      '1. Player sets bot personality/mode in dashboard',
      '2. When player goes offline, bot continues in agent-runtime',
      '3. Bot connects to game server as agent role',
      '4. Bot follows personality-driven behavior',
      '5. Winnings added to player wallet'
    ]
  },
  
  commonIssues: {
    'player cannot connect': {
      causes: [
        'Missing or expired wsAuth token',
        'GAME_WS_AUTH_SECRET not configured',
        'Game server not running on port 4000',
        'CORS issues if using different origin'
      ],
      solutions: [
        'Check /api/session returns valid user',
        'Ensure GAME_WS_AUTH_SECRET is set in all services',
        'Verify game server health at /health',
        'Check browser console for WebSocket errors'
      ]
    },
    'wallet balance not updating': {
      causes: [
        'Runtime wallet vs onchain mode mismatch',
        'Escrow lock failed',
        'Challenge not properly resolved'
      ],
      solutions: [
        'Check ESCROW_EXECUTION_MODE env var',
        'Review escrow events in /wallets/escrow/history',
        'Verify challenge resolution in database'
      ]
    },
    'bot not playing offline': {
      causes: [
        'Bot mode set to passive',
        'Challenge disabled in bot config',
        'Owner presence not properly cleared'
      ],
      solutions: [
        'Set bot mode to "active" in dashboard',
        'Enable challenges in bot config',
        'Check /owners/{profileId}/presence endpoint'
      ]
    },
    'challenge rejected': {
      causes: [
        'Players not in proximity',
        'Insufficient wallet balance',
        'Wallet policy disabled',
        'Wager exceeds max bet percentage',
        'Target in cooldown from agent challenges'
      ],
      solutions: [
        'Move players closer in game world',
        'Fund wallet via /api/player/wallet/fund',
        'Enable wallet policy via Super Agent',
        'Reduce wager or increase bankroll',
        'Wait for cooldown to expire'
      ]
    }
  },
  
  envVars: {
    required: {
      'GAME_WS_AUTH_SECRET': 'Shared secret for WebSocket authentication',
      'INTERNAL_SERVICE_TOKEN': 'Token for inter-service communication',
      'DATABASE_URL': 'PostgreSQL connection string',
      'REDIS_URL': 'Redis connection for presence/distributed state'
    },
    optional: {
      'GOOGLE_CLIENT_ID': 'Google OAuth client ID',
      'ADMIN_EMAILS': 'Comma-separated admin email addresses',
      'LOCAL_AUTH_ENABLED': 'Enable local admin login (dev only)',
      'ADMIN_USERNAME': 'Local admin username',
      'ADMIN_PASSWORD': 'Local admin password',
      'ESCROW_EXECUTION_MODE': 'runtime or onchain',
      'CHAIN_RPC_URL': 'Ethereum RPC URL for onchain mode',
      'ESCROW_CONTRACT_ADDRESS': 'Escrow contract address',
      'ESCROW_RESOLVER_PRIVATE_KEY': 'Private key for escrow resolution',
      'OPENROUTER_API_KEY': 'API key for LLM advisory',
      'BOT_COUNT': 'Number of background NPCs (default 0)',
      'HOUSE_BANK_START_BALANCE': 'Initial house bank tokens',
      'NPC_WALLET_FLOOR': 'Minimum NPC wallet balance',
      'NPC_WALLET_TOPUP_AMOUNT': 'Amount to top up NPCs from house'
    }
  },
  
  database: {
    tables: [
      'challenges - Challenge state and history',
      'escrow_events - Escrow lock/resolve/refund events',
      'players - Player profiles (via runtime state file)',
      'wallets - Wallet records (via runtime state file)'
    ],
    stateFiles: [
      'output/web-auth-state.json - Web server sessions and identities',
      'output/agent-runtime-state.json - Profiles, wallets, bots, Super Agent config'
    ]
  },
  
  superAgentCapabilities: {
    admin: [
      'status - View system status',
      'mode <balanced|hunter|defensive> - Set worker behavior mode',
      'target <human_only|human_first|any> - Set target preference',
      'cooldown <ms> - Set challenge cooldown',
      'bot count <n> - Set number of background NPCs (0 recommended)',
      'enable/disable challenges - Toggle challenge system',
      'enable/disable wallet policy - Toggle wallet features',
      'apply delegation - Re-apply worker directives',
      'sync ethskills - Refresh ETHSkills knowledge'
    ],
    player: [
      'status - View personal status',
      'fund <amount> - Add tokens to wallet',
      'withdraw <amount> - Remove tokens from wallet',
      'set personality <social|aggressive|conservative>',
      'set target <human_first|human_only|any>',
      'set mode <active|passive>',
      'set cooldown <ms>',
      'set wager base <n> max <n>'
    ]
  }
};

export function formatCodebaseContext(): string {
  const ctx = CODEBASE_CONTEXT;
  return `
# ${ctx.name} v${ctx.version}

## Architecture
${ctx.architecture.description}

### Services
${ctx.architecture.services.map(s => `
#### ${s.name} (port ${s.port})
${s.description}

Responsibilities:
${s.responsibilities.map(r => `- ${r}`).join('\n')}

Key Files:
${s.keyFiles.map(f => `- ${f}`).join('\n')}
`).join('\n')}

## Data Flows

### Authentication
${ctx.dataFlow.authentication.map(s => s).join('\n')}

### Gameplay
${ctx.dataFlow.gameplay.map(s => s).join('\n')}

### Offline Play
${ctx.dataFlow.offlinePlay.map(s => s).join('\n')}

## Common Issues
${Object.entries(ctx.commonIssues).map(([issue, info]) => `
### ${issue}
Causes:
${info.causes.map(c => `- ${c}`).join('\n')}

Solutions:
${info.solutions.map(s => `- ${s}`).join('\n')}
`).join('\n')}

## Environment Variables

### Required
${Object.entries(ctx.envVars.required).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

### Optional
${Object.entries(ctx.envVars.optional).map(([k, v]) => `- ${k}: ${v}`).join('\n')}

## Database
Tables: ${ctx.database.tables.join(', ')}

State Files: ${ctx.database.stateFiles.join(', ')}
`.trim();
}

export function getTroubleshootingGuide(issue: string): string | null {
  const normalized = issue.toLowerCase().trim();
  for (const [key, info] of Object.entries(CODEBASE_CONTEXT.commonIssues)) {
    if (normalized.includes(key.toLowerCase()) || key.toLowerCase().includes(normalized)) {
      return `Issue: ${key}\n\nCauses:\n${info.causes.map(c => `- ${c}`).join('\n')}\n\nSolutions:\n${info.solutions.map(s => `- ${s}`).join('\n')}`;
    }
  }
  return null;
}
