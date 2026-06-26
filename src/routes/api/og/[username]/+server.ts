import { profileOG } from '$lib/og';
import { supabase } from '$lib/db';

export const GET = async ({ params }) => {
  const username = params.username.replace(/^@/, '');
  const user = await supabase
    .from('profiles')
    .select('user_id, created_at')
    .eq('username', username)
    .single();
  if (!user.data) {
    return new Response('Not found', { status: 404 });
  }
  const { count: essayCount } = await supabase
    .from('essays')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.data.user_id)
    .eq('is_public', true);
  const { count: logCount } = await supabase
    .from('reading_logs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.data.user_id);
  return await profileOG(username, essayCount ?? 0, logCount ?? 0, user.data.created_at);
};
