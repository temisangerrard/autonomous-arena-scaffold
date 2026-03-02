export type ContinuityLink = {
  profileId: string;
  walletId: string;
  linkedAt: number;
  updatedAt: number;
  continuitySource: string;
};

export async function findMatchingContinuityLink(
  subjects: string[],
  lookup: (subject: string) => Promise<ContinuityLink | null>
): Promise<{
  link: ContinuityLink | null;
  matchedSubject: string | null;
  hadLookupFailure: boolean;
}> {
  const ordered = [...new Set(subjects.map((entry) => String(entry || '').trim()).filter(Boolean))];
  let hadLookupFailure = false;

  for (const subject of ordered) {
    try {
      const link = await lookup(subject);
      if (link?.profileId && link?.walletId) {
        return {
          link,
          matchedSubject: subject,
          hadLookupFailure
        };
      }
    } catch {
      hadLookupFailure = true;
    }
  }

  return {
    link: null,
    matchedSubject: null,
    hadLookupFailure
  };
}
