<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { db, supabase, type Essay } from '$lib/db';
  import ProfileView from '$lib/components/ProfileView.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let username = $derived(($page.params.username).replace(/^@/, ''));

  let preview = $derived<{ username: string; avatarUrl: string | null | undefined; avatarSeed: string | null | undefined } | null>(($page.state as any)?.userPreview ?? null);

  let profile = $state<{ user_id: string; username: string; avatar_seed: string | null; avatar_url: string | null; created_at: string | null } | null>(data.profile);
  let essays = $state<Essay[]>(data.essays);
  let loading = $state(data.profile === null);
  let error = $state<string | null>(null);
  let essayCount = $state<number | null>(data.essayCount);

  $effect(() => {
    if (preview) {
      profile = { user_id: '', username: preview.username, avatar_seed: preview.avatarSeed ?? null, avatar_url: preview.avatarUrl ?? null, created_at: null };
      loading = false;
    }
  });

  async function load() {
    if (profile) return;
    loading = true;
    error = null;
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
    if (username && !profile && !preview) void load();
  });

  function handleEssayClick(essay: Essay) {
    void goto('/@' + encodeURIComponent(username) + '/' + encodeURIComponent(essay.slug) + '/');
  }

  function goBack() {
    void goto('/');
  }
</script>

<svelte:head>
  <title>{profile?.username || 'User'} · Tractatus</title>
  {#if profile}
    <meta name="description" content="{profile.username}'s profile on Tractatus — {essayCount ?? 0} {essayCount === 1 ? 'essay' : 'essays'} written." />
    <meta property="og:title" content="{profile.username} · Tractatus" />
    <meta property="og:description" content="{profile.username}'s profile on Tractatus — {essayCount ?? 0} {essayCount === 1 ? 'essay' : 'essays'} written." />
    <meta property="og:image" content="{$page.url.origin}/api/og/{profile.username}" />
    <meta property="og:url" content="{$page.url.origin}/@{profile.username}" />
    <meta property="og:type" content="profile" />
    <meta name="twitter:title" content="{profile.username} · Tractatus" />
    <meta name="twitter:description" content="{profile.username}'s profile on Tractatus — {essayCount ?? 0} {essayCount === 1 ? 'essay' : 'essays'} written." />
    <meta name="twitter:image" content="{$page.url.origin}/api/og/{profile.username}" />
    <link rel="canonical" href="{$page.url.origin}/@{profile.username}" />
  {/if}
</svelte:head>

{#if loading && !profile}
  <div class="pub-empty"><svg class="pub-loading-spinner" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="31.4 31.4" stroke-linecap="round" /></svg></div>
{:else if error && !profile}
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
