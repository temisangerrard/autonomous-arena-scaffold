import { randomBytes } from 'node:crypto';
import type { Chief2Session } from '../contracts.js';

export class Chief2SessionStore {
  private readonly byOwner = new Map<string, Chief2Session>();

  getOrCreate(ownerSub: string): Chief2Session {
    const existing = this.byOwner.get(ownerSub);
    if (existing) {
      existing.updatedAt = Date.now();
      return existing;
    }
    const session: Chief2Session = {
      id: `chief2_${randomBytes(8).toString('hex')}`,
      ownerSub,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.byOwner.set(ownerSub, session);
    return session;
  }
}
