import { createHash } from 'node:crypto';

type BuildCoinbaseEndUserIdentityParams = {
  profileId: string;
  externalSubject: string;
  email?: string;
};

function normalizeIdentitySeed(value: string): string {
  return String(value || '').trim().toLowerCase();
}

function sanitizeSlug(value: string): string {
  return normalizeIdentitySeed(value)
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function buildCoinbaseEndUserIdentity(params: BuildCoinbaseEndUserIdentityParams) {
  const normalizedEmail = normalizeIdentitySeed(params.email || '');
  const normalizedSubject = normalizeIdentitySeed(params.externalSubject || '');
  const normalizedProfileId = normalizeIdentitySeed(params.profileId || '');
  const identitySeed = normalizedEmail || normalizedSubject || normalizedProfileId || `profile-${Date.now()}`;
  const slugBase = sanitizeSlug(identitySeed) || 'arena-user';
  const hash = createHash('sha256').update(identitySeed).digest('hex').slice(0, 12);
  const slug = slugBase.slice(0, Math.max(1, 100 - hash.length - 1));
  const userId = `${slug}-${hash}`.slice(0, 100);

  return {
    userId,
    authenticationMethods: normalizedEmail
      ? [{ type: 'email', email: normalizedEmail }]
      : [{ type: 'jwt', kid: 'arena-runtime', sub: params.externalSubject || params.profileId }]
  };
}

export function isExistingEndUserConflict(error: unknown): boolean {
  const message = String((error as Error | undefined)?.message || error || '').toLowerCase();
  return message.includes('end user with the given user id already exists');
}
