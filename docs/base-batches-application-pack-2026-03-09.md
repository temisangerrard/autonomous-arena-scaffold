# Base Batches Application Pack (March 9, 2026)

## Output Schema A: Application Answers

| Field Name | Answer | Confidence |
| --- | --- | --- |
| Company Name* | AutoBett | final |
| Website / Product URL | https://autobett.netlify.app | final |
| If you have a demo, what is the URL? | TBD (recording in progress) | TBD |
| Describe what your company does.* (in ~50 chars) | Onchain multiplayer betting arena with bot wallets. | final |
| What is your product’s unique value proposition?* | AutoBett combines a live multiplayer arena with onchain settlement on Base and wallet-native bot play. Users can either play directly or fund bot wallets that execute strategy in the same economy. | final |
| What part of your product is onchain?* | Onchain escrow settlement, payout/refund flow, treasury accounting, and contract-side pool logic for game outcomes are handled on Base. | final |
| What is your ideal customer profile?* | Crypto-native gamers and early Web3 users who want provable settlement, fast game loops, and optional automation through funded bot wallets. | final |
| Which category best describes your company?* | Onchain gaming | final |
| Where are you located now, and where would the company be based after the program?* | Manchester now, and Manchester after the program. | final |
| Do you already have a token?* | No. | final |
| If so, share the contract address and network. | N/A (no token launched). | final |
| What part of your product uses Base?* Specify what is exclusive to Base vs other networks. | Exclusive to Base today: onchain escrow settlement, wallet funding/withdraw flows tied to Base USDC, treasury operations, and production game settlement rails. Legacy testnet work exists for historical validation, but the live product focus is Base. | final |
| Founder(s) Names and Contact Information.* | Temisan Agbajo. Email: tagbajo@gmail.com. LinkedIn: https://linkedin.com/temisangerrard | final |
| Please describe each founder’s background and add their LinkedIn profile(s).* | Solo founder (Temisan Agbajo) building AutoBett end-to-end: product, frontend, backend, contracts, runtime, and deployment. LinkedIn: https://linkedin.com/temisangerrard | final |
| URL of a ~1-minute unlisted video introducing the founder(s) and what you’re building.* | TBD (recording in progress) | TBD |
| Who writes code or handles technical development?* Mention non-founders if any. | All code is written by the founder (Temisan Agbajo). No non-founder technical contributors. | final |
| How long have the founders known each other and how did you meet?* | Solo founder company. | final |
| How far along are you?* | Launched | final |
| How long have you been working on this?* Full-time vs part-time? | About 1 month so far (started around February 2026), part-time. | final |
| What part of your product is magic or impressive?* | A player can move from wallet funding to multiplayer gameplay to onchain settlement in one loop, while the same economy supports autonomous bot wallets and operator-grade treasury controls. | final |
| What is your unique insight or advantage in the market you are building for?* | The market underestimates how much retention comes from combining synchronous social gameplay with verifiable onchain settlement and wallet-level automation. AutoBett is built as a unified arena, not disconnected mini-games. | final |
| Do you plan on raising capital from VCs? Additionally, do you plan to launch a token?* | Yes, we plan to raise VC capital. No token at this stage. | final |
| Do you have users or customers? If yes, how many active users/customers, how many are paying, and who pays you the most and how much? | No active users/customers yet. | final |
| Revenue, if any (monthly/last few months/sources). | No revenue yet. | final |
| Include any Dune analytics dashboards and/or public smart contract addresses you’ve deployed. | Public contracts and analytics are listed below under "Public Contracts & Analytics". Dune dashboard: TBD. | final |
| Why do you want to join Base Batches?* | Base Batches is the best path to get AutoBett in front of the right builder community, tighten product quality with direct ecosystem feedback, and accelerate distribution while we scale from shipped infrastructure to usage. | final |
| Anything else you’d like us to know? | AutoBett already supports 5 game experiences and multiplayer architecture with onchain settlement. The next milestone is converting this shipped stack into repeat user activity and bot-driven arena liquidity loops. | final |

## Public Contracts & Analytics

Current canonical repo-backed deployment artifact:
- Base mainnet escrow deployment (artifact timestamp: 2026-03-02T13:35:03.572Z)
  - Network: Base
  - Escrow contract: `0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d`
  - Token (USDC): `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`
  - Source artifact: `output/escrow-deploy-base.json`

Legacy/testnet historical context:
- Sepolia escrow deployment (artifact timestamp: 2026-02-14T10:42:13.292Z)
  - Escrow contract: `0x57CA81bAA10A0eDF72EE2aE8Af51954F76becd77`
  - Source artifact: `output/escrow-deploy-sepolia.json`

Analytics:
- Dune dashboard: TBD

## Output Schema B: LLM Input Brief

### Immutable Facts
- Company name: AutoBett.
- Product URL: https://autobett.netlify.app
- Founder: Temisan Agbajo (solo founder).
- Founder contact: tagbajo@gmail.com
- Founder LinkedIn: https://linkedin.com/temisangerrard
- Location: Manchester (current and post-program base).
- Stage: Launched.
- Category: Onchain gaming.
- Time building: about 1 month, part-time.
- Technical ownership: founder builds all code; no non-founder technical contributors.
- Product today supports:
  - Multiplayer shared world and live gameplay.
  - 5 live game experiences: Coinflip, Rock Paper Scissors, Dice Duel, BTC 5-minute rail, BTC 24-hour rail.
  - Onchain settlement stack on Base and admin treasury/contract operations.
  - Bot-wallet model where users can fund wallets for autonomous play.
- Traction and business:
  - Users/customers: none yet.
  - Paying users: none yet.
  - Revenue: none yet.
- Token status:
  - No token launched.
  - No token commitment in current plan.
- Fundraising intent:
  - Intends to raise VC capital.
- Public contract disclosure policy:
  - Include current Base artifact-backed deployment plus legacy/testnet historical context.
  - Base artifact escrow address: `0xc071a2a0da5901a8c036cc5d2d2d4ffc7b09787d`.
  - Legacy Sepolia escrow address: `0x57CA81bAA10A0eDF72EE2aE8Af51954F76becd77`.
- Missing links to keep as placeholders:
  - Demo URL: TBD (recording in progress).
  - Founder intro video URL: TBD (recording in progress).
  - Dune dashboard: TBD.

### Narrative Priorities
- Emphasize credibility through what is already built and shipped, not speculative promises.
- Frame AutoBett as an arena system (multiplayer + bots + onchain settlement), not a single game.
- Highlight Base-native execution as a deliberate focus for product reliability and ecosystem fit.
- Keep claims measurable and concrete.

### Hard Constraints
- Do not fabricate metrics, users, revenue, or growth.
- Do not claim a token exists or is scheduled unless explicitly provided.
- Keep mandatory form fields filled; if unknown, use explicit `TBD`.
- Keep the short company description at or under 50 characters.
- Keep current-vs-legacy contract context clearly separated.

### Requested Formats
Generate all three:
1. Polished full field-by-field application answers (ready to paste).
2. Partner-forward version that is about 40% shorter.
3. A short VC partner intro note (about 120-150 words).

## Validation Checklist (Completed)

- Mandatory fields are filled except explicitly marked `TBD` for missing URLs.
- 50-character description check:
  - `Onchain multiplayer betting arena with bot wallets.`
  - Character count: 49
- Consistency check passed:
  - Solo founder throughout.
  - No users/revenue reflected consistently.
  - Timeline is ~1 month, part-time.
  - Base-focused production positioning with legacy context separated.
