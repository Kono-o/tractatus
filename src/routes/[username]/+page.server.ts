import { db, supabase } from '$lib/db';

export const load = async ({ params }) => {
  const username = params.username.replace(/^@/, '');
  const user = await db.getUserByUsername(username);
  if (!user) {
    return { profile: null, essays: [], essayCount: 0 };
  }
  const { count } = await supabase
    .from('essays')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.user_id)
    .eq('is_public', true);
  const essays = await db.getPublicEssaysByUser(user.user_id);
  return { profile: user, essays, essayCount: count ?? 0 };
};
