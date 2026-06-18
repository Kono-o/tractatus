<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { db, supabase, type Essay } from '$lib/db';
  import ProfileView from '$lib/components/ProfileView.svelte';

  let username = $derived(($page.params.username).replace(/^@/, ''));

  let preview = $derived<{ username: string; avatarUrl: string | null | undefined; avatarSeed: string | null | undefined } | null>(($page.state as any)?.userPreview ?? null);

  let profile = $state<{ user_id: string; username: string; avatar_seed: string | null; avatar_url: string | null; created_at: string | null } | null>(null);
  let essays = $state<Essay[]>([]);
  let loading = $state(true);
  let error = $state<string | null>(null);

  $effect(() => {
    if (preview) {
      profile = { user_id: '', username: preview.username, avatar_seed: preview.avatarSeed ?? null, avatar_url: preview.avatarUrl ?? null, created_at: null };
      loading = false;
    }
  });

  let essayCount = $state<number | null>(null);

  async function load() {
    loading = true;
    error = null;
    profile = null;
    essays = [];
    try {
      if (!username) throw new Error('Missing username');
      const u = await db.getUserByUsername(username);
      if (!u) {
        error = 'User not found.';
        return;
      }
      profile = u;
      const { count } = await supabase
        .from('essays')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', u.user_id)
        .eq('is_public', true);
      const found = await db.getPublicEssaysByUser(u.user_id);
      essayCount = count ?? 0;
      essays = found;
    } catch (e: any) {
      console.error(e);
      error = 'Failed to load profile.';
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (username) void load();
  });

  function handleEssayClick(essay: Essay) {
    void goto('/@' + encodeURIComponent(username) + '/' + encodeURIComponent(essay.slug) + '/');
  }

  function goBack() {
    void goto('/');
  }
</script>

<svelte:head>
  <title>{profile?.username || 'User'}</title>
</svelte:head>

{#if loading}
  <div class="pub-empty"><svg class="pub-loading-spinner" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round" /></svg></div>
{:else if error}
  <div class="pub-empty">
    <div class="pub-empty-title">{error}</div>
    <button type="button" onclick={goBack} class="pub-article-back-link">← Back</button>
  </div>
{:else if profile}
  <ProfileView
    username={profile.username}
    userId={profile.user_id}
    avatarSeed={profile.avatar_seed}
    avatarUrl={profile.avatar_url}
    createdAt={profile.created_at}
    {essayCount}
    {essays}
    onEssayClick={handleEssayClick}
  />
{/if}
