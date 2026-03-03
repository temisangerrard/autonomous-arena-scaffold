# Wallet Continuity History

## Tagbajoh Account

- Email: `tagbajoh@gmail.com`
- Legacy wallet observed after continuity rollback:
  - Address: `0xA3beDAB88B56F69e8Dc439cE2f4c8C31aea5e660`
  - Status: older wallet mapping that resurfaced after redeploy
- New funded wallet that must remain canonical going forward:
  - Address: `0xdaeEDe8252FA59C51687ff34B1634b2cD62E8E98`
  - Status: final intended wallet for this account
  - Note: user funded this wallet with USDC and explicitly requested it remain the final wallet

## Continuity Rule

- For verified email-based sign-in, the most recent known identity for the email must win over stale runtime subject links.
- Runtime subject aliases should be rewritten to the chosen canonical profile/wallet when an email-backed identity is preferred.
- Request-time reconciliation must not silently flip the session back to an older wallet for the same email.
