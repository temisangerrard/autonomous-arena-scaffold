# URGENT: Security Credential Rotation Required

**Date:** February 24, 2026
**Severity:** CRITICAL
**Status:** IMMEDIATE ACTION REQUIRED

## Executive Summary

Production secrets were committed to git in the `.env` file. All credentials below must be considered **COMPROMISED** and rotated immediately before any public deployment.

---

## Compromised Credentials

### 1. Blockchain Private Keys (CRITICAL)

**Exposed Keys:**
```
DEPLOYER_PRIVATE_KEY=[REDACTED_COMPROMISED]
ESCROW_RESOLVER_PRIVATE_KEY=[REDACTED_COMPROMISED]
GAS_FUNDING_PRIVATE_KEY=[REDACTED_COMPROMISED]
```

**Address Derived:** [REDACTED_COMPROMISED_ADDRESS]

**Risk:** Complete control of escrow funds and contract deployment.

**Action Required:**
1. Check balance of the compromised derived address on Sepolia
2. If funds present, transfer to new secure wallet IMMEDIATELY
3. Generate 3 NEW private keys (one for each role):
   ```bash
   # Generate new keys
   openssl rand -hex 32  # For deployer
   openssl rand -hex 32  # For escrow resolver
   openssl rand -hex 32  # For gas funder
   ```
4. Update escrow contract to new resolver address (if already deployed)
5. Store new keys in secrets manager (AWS Secrets Manager, HashiCorp Vault, etc)

---

### 2. API Keys

**Exposed:**
```
OPENROUTER_API_KEY=[REDACTED_COMPROMISED]
FLY_API_TOKEN=[REDACTED_COMPROMISED]
```

**Risk:**
- OpenRouter: Attacker can rack up LLM costs, manipulate bot behavior
- Fly.io: Full infrastructure control, can deploy malicious code

**Action Required:**
1. Go to OpenRouter dashboard → API Keys → Revoke key → Generate new
2. Go to Fly.io dashboard → Access Tokens → Revoke token → Generate new
3. Update deployment scripts with new tokens

---

### 3. Database Credentials

**Exposed:**
```
DATABASE_URL=postgresql://postgres:[REDACTED_COMPROMISED]@yamabiko.proxy.rlwy.net:59375/railway
```

**Risk:** Direct database access, can steal user data, modify balances.

**Action Required:**
1. Go to Railway dashboard → Database → Change password
2. Update connection string with new password
3. Add `?sslmode=require` to enforce SSL:
   ```
   postgresql://postgres:NEW_PASSWORD@yamabiko.proxy.rlwy.net:59375/railway?sslmode=require
   ```
4. Restrict IP whitelist to only application servers

---

### 4. Internal Service Token

**Exposed:**
```
INTERNAL_SERVICE_TOKEN=sa_[REDACTED_COMPROMISED]
```

**Risk:** Privilege escalation between services.

**Action Required:**
```bash
openssl rand -hex 32
# Use output as new INTERNAL_SERVICE_TOKEN (prefix with sa_)
```

---

### 5. Admin Credentials

**Exposed:**
```
ADMIN_USERNAME=[REDACTED_COMPROMISED]
ADMIN_PASSWORD=[REDACTED_COMPROMISED]
ADMIN_EMAILS=[REDACTED_COMPROMISED]
```

**Risk:** Complete admin access to game operations.

**Action Required:**
1. Change admin password to 32+ character random string
2. Ensure ADMIN_EMAILS is correct and restricted
3. Consider disabling LOCAL_AUTH_ENABLED in production (use Google OAuth only)

---

### 6. OAuth Credentials

**Exposed:**
```
GOOGLE_CLIENT_ID=[REDACTED_COMPROMISED]
FIREBASE_WEB_API_KEY=[REDACTED_COMPROMISED]
```

**Risk:** Lower (these are client-side anyway), but attacker knows your project IDs.

**Action Required (Optional):**
1. Rotate Google OAuth client (create new OAuth 2.0 Client ID)
2. Update Firebase project and regenerate web API key
3. Update redirect URIs to production domain only

---

### 7. Wallet Encryption Key (NOT SET - CRITICAL)

**Current State:** Falls back to default `arena-dev-wallet-key`

**Risk:** All user wallet private keys can be decrypted.

**Action Required:**
```bash
openssl rand -hex 32
# Set as WALLET_ENCRYPTION_KEY in production
```

**NEVER commit this key to git.**

---

## Rotation Checklist

- [ ] **IMMEDIATE:** Transfer funds from the compromised derived address to secure wallet
- [ ] Generate 3 new blockchain private keys (deployer, escrow, gas funder)
- [ ] Revoke and regenerate OpenRouter API key
- [ ] Revoke and regenerate Fly.io API token
- [ ] Rotate Railway database password
- [ ] Generate new INTERNAL_SERVICE_TOKEN
- [ ] Generate new WALLET_ENCRYPTION_KEY
- [ ] Change admin password to secure value
- [ ] Update all production deployments with new secrets
- [ ] Verify no funds locked in old escrow contracts
- [ ] Remove .env from git history (see next section)

---

## Clean Git History

The `.env` file must be removed from ALL git commits:

```bash
# Option 1: BFG Repo Cleaner (recommended)
brew install bfg
bfg --delete-files .env
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# Option 2: git filter-branch
git filter-branch --force --index-filter \
  "git rm --cached --ignore-unmatch .env" \
  --prune-empty --tag-name-filter cat -- --all

# Force push to all remotes
git push origin --force --all
git push origin --force --tags
```

**WARNING:** This rewrites history. Coordinate with all team members to re-clone.

---

## Post-Rotation Verification

After rotating all credentials:

1. [ ] Test database connection with new password
2. [ ] Test OpenRouter API with new key
3. [ ] Deploy to Fly.io with new token
4. [ ] Verify escrow contract with new resolver key
5. [ ] Test wallet encryption/decryption
6. [ ] Verify admin login with new password
7. [ ] Run full integration test suite

---

## Secrets Management Going Forward

**NEVER commit secrets to git again.**

Use one of these approaches:

### Option 1: Environment Variables (Recommended for Fly.io)
```bash
fly secrets set ESCROW_RESOLVER_PRIVATE_KEY=0xNEW_KEY
fly secrets set OPENROUTER_API_KEY=sk-or-v1-NEW_KEY
```

### Option 2: Secrets Manager (Recommended for production)
- AWS Secrets Manager
- HashiCorp Vault
- Google Cloud Secret Manager
- Azure Key Vault

### Option 3: Encrypted .env.local (Development only)
- Use `git-crypt` or `sops` to encrypt .env.local
- Never commit plain .env files

---

## Contact Information

If credentials have been used maliciously, contact:
- Railway support (database compromise)
- OpenRouter support (API abuse)
- Fly.io support (infrastructure breach)
- Your security team

**Timeline:** Complete rotation within 24 hours of discovery.

**Document Status:** ACTIVE - Do not delete until all items checked.
