import { db, supabase } from '$lib/db';

export const load = async ({ params }) => {
  const username = params.username.replace(/^@/, '');
  const user = await db.getUserByUsername(username);
  if (!user) {
    return { profile: null, essays: [], essayCount: 0, logs: [], logCount: 0 };
  }
  const { count: essayCount } = await supabase
    .from('essays')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.user_id)
    .eq('is_public', true);
  const { count: logCount } = await supabase
    .from('reading_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.user_id);
  const essays = await db.getPublicEssaysByUser(user.user_id);
  const logs = await db.getPublicReadingLogsByUser(user.user_id);
  return { profile: user, essays, essayCount: essayCount ?? 0, logs, logCount: logCount ?? 0 };
};
