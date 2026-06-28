import { db } from '$lib/db';
import type { ReadingLogWithAuthor } from '$lib/db';
import type { PageLoad } from './$types';

export const load: PageLoad = async (): Promise<{ publicReadingLogs: ReadingLogWithAuthor[] }> => {
  try {
    const publicReadingLogs = await db.listPublicReadingLogs();
    return { publicReadingLogs };
  } catch {
    return { publicReadingLogs: [] };
  }
};
