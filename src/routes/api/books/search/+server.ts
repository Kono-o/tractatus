import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { checkRateLimit } from '$lib/rateLimit';

interface OLDoc {
  key: string;
  title?: string;
  author_name?: string[];
  cover_i?: number;
  first_publish_year?: number;
  edition_count?: number;
}

export const GET: RequestHandler = async ({ url, request }) => {
  const q = url.searchParams.get('q')?.trim();
  if (!q || q.length < 2) {
    throw error(400, 'Query too short (min 2 characters)');
  }
  if (q.length > 100) {
    throw error(400, 'Query too long (max 100 characters)');
  }

  const ip = request.headers.get('x-forwarded-for') || 'anonymous';
  const rl = checkRateLimit('openlibrary-search', ip, 30, 60_000);
  if (!rl.allowed) {
    throw error(429, 'Too many searches. Try again later.');
  }

  const res = await fetch(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=12&fields=key,title,author_name,cover_i,first_publish_year,edition_count`,
    { headers: { 'User-Agent': 'Tractatus/1.0' } },
  );

  if (!res.ok) {
    throw error(502, 'OpenLibrary search failed');
  }

  const data = await res.json() as { docs: OLDoc[] };
  const results = (data.docs ?? []).map((doc) => ({
    id: doc.key,
    title: doc.title || 'Untitled',
    author: doc.author_name?.[0] ?? null,
    coverUrl: doc.cover_i
      ? `https://covers.openlibrary.org/b/id/${doc.cover_i}-M.jpg`
      : null,
    year: doc.first_publish_year ?? null,
  }));

  return json({ results });
};
