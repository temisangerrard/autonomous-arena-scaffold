type ResolveAuthSubjectsParams = {
  provider: 'firebase' | 'google';
  firebaseLocalId?: string | null;
  googleSub?: string | null;
};

function firebaseSubject(localId: string): string {
  return `firebase:${localId}`;
}

function googleSubject(sub: string): string {
  return `google:${sub}`;
}

export function resolveAuthSubjects(params: ResolveAuthSubjectsParams): {
  canonical: string;
  aliases: string[];
} {
  const firebaseLocalId = String(params.firebaseLocalId || '').trim();
  const googleSub = String(params.googleSub || '').trim();

  if (params.provider === 'firebase') {
    if (!firebaseLocalId) {
      throw new Error('firebase_local_id_required');
    }
    const canonical = firebaseSubject(firebaseLocalId);
    return { canonical, aliases: [canonical] };
  }

  if (firebaseLocalId) {
    const canonical = firebaseSubject(firebaseLocalId);
    const aliases = [canonical];
    if (googleSub) aliases.push(googleSubject(googleSub));
    return { canonical, aliases: [...new Set(aliases)] };
  }

  if (!googleSub) {
    throw new Error('google_sub_required');
  }
  const canonical = googleSubject(googleSub);
  return { canonical, aliases: [canonical] };
}
