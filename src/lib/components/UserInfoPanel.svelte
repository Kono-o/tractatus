<script lang="ts">
  import { supabase } from '$lib/db';
  import GeneratedAvatar from '$lib/components/GeneratedAvatar.svelte';

  let {
    user,
    userSelected = $bindable(false),
  }: {
    user: { userId: string; username: string; avatarUrl: string | null; avatarSeed: string | null };
    userSelected?: boolean;
  } = $props();

  let profile = $state<{ username: string; created_at: string | null } | null>(null);
  let essayCount = $state<number | null>(null);
  let loading = $state(true);

  async function loadData() {
    loading = true;
    try {
      const { data: u } = await supabase
        .from('usernames')
        .select('username, created_at')
        .eq('user_id', user.userId)
        .maybeSingle();
      if (u) profile = u;
      const { count } = await supabase
        .from('essays')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.userId)
        .eq('is_public', true);
      essayCount = count ?? 0;
    } catch (e) {
      console.warn('[userinfo] load failed', e);
    } finally {
      loading = false;
    }
  }

  function clearSelection() {
    userSelected = false;
  }

  function onPopState() {
    if (userSelected) clearSelection();
  }

  $effect(() => {
    void loadData();
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  });

  $effect(() => {
    if (!userSelected && profile) {
      profile = null;
      essayCount = null;
    }
  });
</script>

<div class="user-info-panel">
  <div class="user-info-header">
    <div class="user-info-avatar">
      {#key user.avatarSeed + '' + user.avatarUrl}
        <GeneratedAvatar userId={user.userId} seed={user.avatarSeed} avatarUrl={user.avatarUrl} size={80} rounded={8} />
      {/key}
    </div>
    <div class="user-info-meta">
      <div class="user-info-name">{user.username || 'Anonymous'}</div>
      {#if profile?.created_at}
        <div class="user-info-joined">Joined {new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</div>
      {/if}
    </div>
  </div>

  <div class="user-info-stats">
    <div class="user-info-stat">
      <div class="user-info-stat-value">{essayCount ?? '…'}</div>
      <div class="user-info-stat-label">Essays</div>
    </div>
  </div>
</div>

<style>
  .user-info-panel {
    padding: 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .user-info-header {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .user-info-avatar {
    flex-shrink: 0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--rule2);
  }
  .user-info-meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .user-info-name {
    font-family: var(--font-mono);
    font-size: 1rem;
    color: var(--ink);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .user-info-joined {
    font-family: var(--ui);
    font-size: 0.7rem;
    color: var(--hint);
  }
  .user-info-stats {
    display: flex;
    gap: 1.5rem;
  }
  .user-info-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }
  .user-info-stat-value {
    font-family: var(--font-mono);
    font-size: 1.1rem;
    color: var(--ink);
    font-weight: 600;
  }
  .user-info-stat-label {
    font-family: var(--ui);
    font-size: 0.65rem;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
