import { profileOG } from '$lib/og';
import { supabase } from '$lib/db';

export const GET = async ({ params }) => {
  const username = params.username.replace(/^@/, '');
  const user = await supabase
    .from('profiles')
    .select('user_id')
    .eq('username', username)
    .single();
  if (!user.data) {
    return new Response('Not found', { status: 404 });
  }
  const { count } = await supabase
    .from('essays')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.data.user_id)
    .eq('is_public', true);
  return await profileOG(username, count ?? 0);
};
