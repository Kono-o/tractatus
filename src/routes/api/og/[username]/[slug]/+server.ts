import { essayOG } from '$lib/og';
import { db } from '$lib/db';

export const GET = async ({ params }) => {
  const username = params.username.replace(/^@/, '');
  const slug = params.slug;

  const essay = await db.getPublicEssayByUsernameAndSlug(username, slug);
  if (!essay) {
    return new Response('Not found', { status: 404 });
  }

  const snippet = essay.content
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);

  return await essayOG(
    essay.title,
    essay.author_username ?? username,
    snippet,
    essay.published_at,
    essay.content,
  );
};
