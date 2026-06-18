<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import { db, supabase, type Essay, estimateReadTimeMinutes } from '$lib/db';
  import GeneratedAvatar from '$lib/components/GeneratedAvatar.svelte';
  import { ArrowLeft, Eye, EyeClosed } from '@lucide/svelte';
  import { setAppIcon as _setAppIcon } from '$lib/icon-switcher';
  import { renderExcerpt } from '$lib/markdown';

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

  let logoEyeOpen = $state(
    typeof localStorage !== 'undefined' && localStorage.getItem('logoEyeOpen') === 'true'
  );

  let essayCount = $state<number | null>(null);

  function goBack() {
    void goto('/');
  }

  function countWords(s: string): number {
    return (s || '').trim().split(/\s+/).filter(Boolean).length;
  }

  function toggleLogoEye() {
    logoEyeOpen = !logoEyeOpen;
    if (typeof localStorage !== 'undefined') {
      try { localStorage.setItem('logoEyeOpen', String(logoEyeOpen)); } catch {}
    }
  }

  $effect(() => {
    if (typeof document === 'undefined') return;
    try {
      const html = document.documentElement;
      const isDark = !logoEyeOpen;
      html.classList.toggle('dark', isDark);
      html.classList.add('theme-transitioning');
      setTimeout(() => html.classList.remove('theme-transitioning'), 250);
      _setAppIcon(isDark ? 'dark' : 'light');
    } catch (e) {
      console.warn('[logoEye] failed to apply theme class', e);
    }
  });

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
      essayCount = count ?? 0;
      const found = await db.getPublicEssaysByUser(u.user_id);
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

  function fmtReadTime(n: number): string {
    return n === 1 ? '~1 min' : `~${n} mins`;
  }

  function formatDate(iso: string): string {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }
</script>

<svelte:head>
  <title>{profile?.username || 'User'}</title>
</svelte:head>

<div class="app app--pub w-full h-dvh max-h-dvh overflow-hidden select-none flex flex-col font-sans">
  <div class="pub-shell flex flex-col flex-1 min-h-0 w-full" style="overflow: hidden;">
    <div class="pub-header-wrap">
      <header class="pub-header pub-header--article">
        <div class="pub-header-start">
          <div class="pub-header-logo">
            <button
              type="button"
              class="pub-header-logo-eye"
              onclick={toggleLogoEye}
              aria-label={logoEyeOpen ? 'Close eye' : 'Open eye'}
            >
              {#if logoEyeOpen}
                <Eye class="pub-header-logo-icon" aria-hidden="true" />
              {:else}
                <EyeClosed class="pub-header-logo-icon" aria-hidden="true" />
              {/if}
            </button>
            <span class="pub-header-logo-text" role="button" tabindex="0" onclick={goBack} onkeydown={(e) => { if (e.key === 'Enter') goBack(); }}>Tractatus</span>
          </div>
        </div>
        <div class="pub-header-actions"></div>
      </header>
      <div class="pub-header-sub">
        <button type="button" onclick={goBack} class="pub-header-back-btn">
          <ArrowLeft class="size-3.5" aria-hidden="true" />
          Back
        </button>
      </div>
    </div>
    <div class="flex flex-col flex-1 min-h-0 h-0 overflow-y-auto" style="scrollbar-width: thin; scrollbar-color: var(--border) transparent;">
      {#if loading}
        <div class="pub-empty">Loading profile…</div>
      {:else if error}
        <div class="pub-empty">
          <div class="pub-empty-title">{error}</div>
          <button type="button" onclick={goBack} class="pub-article-back-link">← Back</button>
        </div>
      {:else if profile}
        <div class="user-profile">
          <div class="user-profile-header">
            <div class="user-profile-avatar">
              {#key profile.avatar_seed + '' + profile.avatar_url}
                <GeneratedAvatar userId={profile.user_id} seed={profile.avatar_seed} avatarUrl={profile.avatar_url} size={80} rounded={8} />
              {/key}
            </div>
            <div class="user-profile-meta">
              <div class="user-profile-name">{profile.username}</div>
              {#if profile.created_at}
                <div class="user-profile-joined">Joined {new Date(profile.created_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long' })}</div>
              {/if}
            </div>
          </div>
          <div class="user-profile-stats">
            <div class="user-profile-stat">
              <div class="user-profile-stat-value">{essayCount ?? '…'}</div>
              <div class="user-profile-stat-label">Essays</div>
            </div>
          </div>

          {#if essays.length > 0}
            <div class="user-profile-essays">
              <div class="user-profile-essays-heading">Essays</div>
              {#each essays as essay (essay.id)}
                <a href="/@{encodeURIComponent(profile.username)}/{encodeURIComponent(essay.slug)}/" class="user-profile-essay">
                  <div class="user-profile-essay-title">{essay.title || 'Untitled'}</div>
                  <div class="user-profile-essay-meta">
                    {countWords(essay.content)} words · {fmtReadTime(estimateReadTimeMinutes(essay.content))}
                    {#if essay.published_at}
                      · {formatDate(essay.published_at)}
                    {/if}
                  </div>
                  {#if essay.content}
                    <div class="user-profile-essay-excerpt">{@html renderExcerpt(essay.content, 2)}</div>
                  {/if}
                </a>
              {/each}
            </div>
          {:else}
            <div class="user-profile-empty">No public essays yet.</div>
          {/if}
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .user-profile {
    padding: 1.5rem 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.25rem;
  }
  .user-profile-header {
    display: flex;
    align-items: center;
    gap: 1rem;
  }
  .user-profile-avatar {
    flex-shrink: 0;
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 0 0 1px var(--rule2);
  }
  .user-profile-meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    min-width: 0;
  }
  .user-profile-name {
    font-family: var(--font-mono);
    font-size: 1rem;
    color: var(--ink);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .user-profile-joined {
    font-family: var(--ui);
    font-size: 0.7rem;
    color: var(--hint);
  }
  .user-profile-stats {
    display: flex;
    gap: 1.5rem;
  }
  .user-profile-stat {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
  }
  .user-profile-stat-value {
    font-family: var(--font-mono);
    font-size: 1.1rem;
    color: var(--ink);
    font-weight: 600;
  }
  .user-profile-stat-label {
    font-family: var(--ui);
    font-size: 0.65rem;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
  .user-profile-essays {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .user-profile-essays-heading {
    font-family: var(--font-mono);
    font-size: 0.7rem;
    color: var(--hint);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding-bottom: 0.25rem;
    border-bottom: 1px solid var(--rule);
  }
  .user-profile-essay {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.5rem 0.6rem;
    border-radius: 6px;
    text-decoration: none;
    color: inherit;
    transition: background 0.15s ease;
  }
  .user-profile-essay:hover {
    background: var(--surf);
  }
  .user-profile-essay-title {
    font-family: var(--dm);
    font-size: 0.9rem;
    color: var(--ink);
    line-height: 1.3;
  }
  .user-profile-essay-meta {
    font-family: var(--ui);
    font-size: 0.65rem;
    color: var(--hint);
  }
  .user-profile-essay-excerpt {
    font-family: var(--ss);
    font-size: 0.75rem;
    color: var(--muted);
    line-height: 1.5;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    line-clamp: 2;
  }
  .user-profile-empty {
    font-family: var(--ui);
    font-size: 0.75rem;
    color: var(--hint);
    text-align: center;
    padding: 2rem 0;
  }
</style>
