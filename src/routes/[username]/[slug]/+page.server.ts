import { db } from '$lib/db';

export const load = async ({ params }) => {
  const username = params.username.replace(/^@/, '');
  const slug = params.slug;
  const essay = await db.getPublicEssayByUsernameAndSlug(username, slug);
  return { essay };
};
